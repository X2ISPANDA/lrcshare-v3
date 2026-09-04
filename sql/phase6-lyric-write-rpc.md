# Phase 6：歌词行写入事务化（B1/B2 修复）

> 背景：前端直连 PostgREST 无事务能力，两处「先删后插」写库链路在中途失败时会留下脏数据：
> - **B1** `saveLyricLines`（歌词编辑保存）：`DELETE song_lyric_lines WHERE version_id` 未检查 error，
>   删除失败时 INSERT 照跑 → 新旧行并存；
> - **B2** DoubtsView「归位」：`DELETE` + `INSERT` + 标记 resolved 三次写库均无事务，
>   删成功、插失败 → 行丢失且提示「已归位」。
>
> 方案：写入逻辑下沉为 SECURITY DEFINER RPC（PL/pgSQL 函数体本身就是事务边界，任一步失败整体回滚）。
> 前端各改为一次 `supabase.rpc(...)` 调用。

---

## 执行脚本（一次性，整段粘贴到 Supabase SQL Editor）

```sql
-- ═══ 0. 存疑表结果列幂等补齐（线上已存在则跳过；早期建表无此两列）═══
ALTER TABLE public.song_lyric_doubts ADD COLUMN IF NOT EXISTS resolved_lang text;
ALTER TABLE public.song_lyric_doubts ADD COLUMN IF NOT EXISTS resolved_kind text;

-- ═══ 1. 存疑行归位：删旧行 → 插目标 lang/kind → 标记 resolved（单事务）═══
-- p_mode:
--   'relocate' 行已存在（改 lang/kind）：锁源行取 time_ms/end_ms/text，删除后插入目标版本末尾
--   'insert'    裸行归位：用表单时间戳（可空=元数据行）+ 文本直接插入目标版本末尾
-- 语义与旧前端完全一致：删/插均不带 version_id（trg_sll_default_version 触发器落 legacy 版本）；
-- 删除谓词按 song_id+lang+kind+seq（与旧前端相同，不按 version_id 过滤）。
CREATE OR REPLACE FUNCTION public.resolve_lyric_doubt(
  p_doubt_id  bigint,
  p_song_id   text,
  p_mode      text,
  p_lang      text,
  p_kind      text,
  p_src_lang  text DEFAULT NULL,   -- relocate：源行 lang
  p_src_kind  text DEFAULT NULL,   -- relocate：源行 kind
  p_src_seq   integer DEFAULT NULL,-- relocate：源行 seq
  p_time_ms   integer DEFAULT NULL,-- insert：时间戳（NULL=元数据行）
  p_text      text DEFAULT NULL    -- insert：行文本
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_seq integer;
  v_old public.song_lyric_lines%ROWTYPE;
BEGIN
  IF p_kind NOT IN ('original','translation','romanization') THEN
    RAISE EXCEPTION '非法 kind: %', p_kind;
  END IF;
  IF p_lang IS NULL OR btrim(p_lang) = '' THEN
    RAISE EXCEPTION 'lang 不能为空';
  END IF;

  IF p_mode = 'relocate' THEN
    -- 锁源行：并发处理同一行时第二个事务在此等待/报缺行
    SELECT * INTO v_old
    FROM public.song_lyric_lines
    WHERE song_id = p_song_id AND lang = p_src_lang AND kind = p_src_kind AND seq = p_src_seq
    FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION '源行不存在（可能已被处理）';
    END IF;

    DELETE FROM public.song_lyric_lines
    WHERE song_id = p_song_id AND lang = p_src_lang AND kind = p_src_kind AND seq = p_src_seq;

    -- 删除后目标 (lang,kind) 末尾 seq（复用空出的号；行序语义不变，该行恒排末尾）
    SELECT COALESCE(MAX(seq), 0) + 1 INTO v_seq
    FROM public.song_lyric_lines
    WHERE song_id = p_song_id AND lang = p_lang AND kind = p_kind;

    INSERT INTO public.song_lyric_lines (song_id, lang, kind, seq, time_ms, end_ms, text)
    VALUES (p_song_id, p_lang, p_kind, v_seq, v_old.time_ms, v_old.end_ms, v_old.text);

  ELSIF p_mode = 'insert' THEN
    SELECT COALESCE(MAX(seq), 0) + 1 INTO v_seq
    FROM public.song_lyric_lines
    WHERE song_id = p_song_id AND lang = p_lang AND kind = p_kind;

    INSERT INTO public.song_lyric_lines (song_id, lang, kind, seq, time_ms, text)
    VALUES (p_song_id, p_lang, p_kind, v_seq, p_time_ms, COALESCE(p_text, ''));
  ELSE
    RAISE EXCEPTION '非法 mode: %', p_mode;
  END IF;

  UPDATE public.song_lyric_doubts
  SET resolved = true, resolved_lang = p_lang, resolved_kind = p_kind
  WHERE id = p_doubt_id;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_lyric_doubt(bigint,text,text,text,text,text,text,integer,integer,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_lyric_doubt(bigint,text,text,text,text,text,text,integer,integer,text) TO authenticated;

-- ═══ 2. 歌词版本行表全量替换：删旧 → 批量插新 → 刷 langs 摘要（单事务）═══
-- 版本解析与前端 resolveDefaultLinesVersionId 同语义：显式 p_version_id 优先，
-- 否则取该歌 format in ('lrc','enhanced') 的主版本（is_primary 优先、最早创建）。
-- p_rows 元素：{lang, kind, seq, time_ms, end_ms, text}
CREATE OR REPLACE FUNCTION public.save_lyric_lines(
  p_song_id    text,
  p_version_id text DEFAULT NULL,
  p_rows       jsonb DEFAULT '[]',
  p_langs      text[] DEFAULT '{}'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vid text;
BEGIN
  v_vid := p_version_id;
  IF v_vid IS NULL THEN
    SELECT id INTO v_vid
    FROM public.lyric_versions
    WHERE song_id = p_song_id AND format IN ('lrc','enhanced')
    ORDER BY is_primary DESC, created_at ASC
    LIMIT 1;
    IF v_vid IS NULL THEN
      RAISE EXCEPTION '歌曲 % 无 lrc/enhanced 歌词版本（lrc_text 为空？）', p_song_id;
    END IF;
  END IF;

  -- 全量替换原子化：删后插失败则整体回滚，杜绝行表丢失/新旧并存
  DELETE FROM public.song_lyric_lines WHERE version_id = v_vid;

  INSERT INTO public.song_lyric_lines (version_id, song_id, lang, kind, seq, time_ms, end_ms, text)
  SELECT v_vid, p_song_id, x.lang, x.kind, x.seq, x.time_ms, x.end_ms, x.text
  FROM jsonb_to_recordset(p_rows) AS x(lang text, kind text, seq integer, time_ms integer, end_ms integer, text text);

  UPDATE public.lyric_versions SET langs = p_langs WHERE id = v_vid;
END;
$$;

REVOKE ALL ON FUNCTION public.save_lyric_lines(text,text,jsonb,text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_lyric_lines(text,text,jsonb,text[]) TO authenticated;
```

---

## 验证（执行后跑）

```sql
-- 函数应存在且仅 authenticated 可执行
SELECT proname, prosecdef FROM pg_proc WHERE proname IN ('resolve_lyric_doubt','save_lyric_lines');
```

## 回滚

```sql
DROP FUNCTION IF EXISTS public.resolve_lyric_doubt(bigint,text,text,text,text,text,text,integer,integer,text);
DROP FUNCTION IF EXISTS public.save_lyric_lines(text,text,jsonb,text[]);
-- 前端回退到旧版即可（旧代码直连表写入，不依赖这两个函数）；resolved_lang/resolved_kind 列保留无害
```

## 上线顺序

**先在 Supabase 执行本脚本，再发布前端**。前端上线后旧函数无人调用；
若先发布前端而函数未建，歌词保存/存疑归位会报「Could not find the function」。
