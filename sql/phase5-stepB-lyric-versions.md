# Phase5 阶段 B：lyric_versions 建表 + 行表挂版本（phase5-stepB）

> 依据：`sql/phase5-lyric-versions-ttml-hub.md` 第八节阶段 B。
> 执行日期：____（执行后填写）
> 前置：阶段 A 已执行（songs 已有 source_ids / origin）。
>
> ## 读写方核对结论（出 SQL 前必做项，已完成）
>
> | 读写方 | 方式 | B 阶段影响 | 兼容手段 |
> |---|---|---|---|
> | open-api.js `getLyricVersions` | 按 song_id 读行表 | 无 | song_id 列保留 + 补 song_id 索引 |
> | lyricLines.ts（后台歌词编辑） | 读/删（按 song_id）/插（不带 version_id）/rebuild RPC | 插行不带 version_id | BEFORE INSERT 触发器自动补默认版本 |
> | DoubtsView.vue（存疑处理） | 删（song_id+lang+kind+seq）/插（不带 version_id） | 同上 | 同上 |
> | `rebuild_song_lyric_lines` RPC | 拆行写入 | 签名变化 | DROP 重建，保留 p_song_id 单参调用 |
> | `trg_song_lyric_rebuild`（songs INSERT 触发器） | 调 rebuild | 无需改 | rebuild 内部自建 legacy 版本 |
> | `song_lyric_doubts` | song 级存疑 | 不动 | 多版本存疑细化留到 D 阶段（多版本投稿时） |
>
> ## 核心设计
>
> 1. **legacy 版本确定性 ID**：`lv_` + `md5('legacy:' || song_id)` 前 12 位——迁移、触发器、rebuild 三处共用，天然幂等（重跑不产生重复版本）。
> 2. **旧写入路径零破坏**：所有不带 `version_id` 的 INSERT 由触发器自动落到该歌的 legacy 版本（没有则现场建）。SQL 先行不炸前端，代码改造在 C/D 阶段跟进。
> 3. **主键迁移**：`(song_id, lang, kind, seq)` → `(version_id, lang, kind, seq)`。过渡期每歌只有一个版本，旧代码按 song_id 的删/插不会撞主键。
> 4. **TTML 版本不进行表**（原文落盘 `ttml_text`），本阶段行表数据全部归属 legacy 用户版本。

## SQL（一个事务，整段复制执行）

```sql
BEGIN;

-- ═══ 1. legacy 版本 ID 生成函数（迁移 / 触发器 / rebuild 三处共用）═══
CREATE OR REPLACE FUNCTION public.legacy_version_id(p_song_id text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT 'lv_' || substr(md5('legacy:' || p_song_id), 1, 12)
$$;

-- ═══ 2. lyric_versions 建表（方案 3.1）═══
CREATE TABLE public.lyric_versions (
  id             text PRIMARY KEY,
  song_id        text NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,
  format         text NOT NULL CHECK (format IN ('lrc','enhanced','ttml')),
  source         text NOT NULL DEFAULT 'user' CHECK (source IN ('user','ttml-hub')),
  external_id    text,
  content_hash   text,
  ttml_text      text,
  langs          text[] NOT NULL DEFAULT '{}',
  status         text NOT NULL DEFAULT 'published'
                 CHECK (status IN ('pending','published','rejected','withdrawn')),
  is_primary     boolean NOT NULL DEFAULT false,
  contributor_id text REFERENCES public.contributors(id) ON DELETE SET NULL,
  source_credit  text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  -- TTML 版本必须落盘原文；lrc/enhanced 版本不允许有（行表为准）
  CHECK (format = 'ttml' OR ttml_text IS NULL),
  CHECK (format <> 'ttml' OR ttml_text IS NOT NULL),
  -- ttml-hub 来源必须有外部 ID；用户投稿没有
  CHECK (source <> 'ttml-hub' OR external_id IS NOT NULL)
);

-- Supabase 默认权限坑：建表自动给 anon/authenticated 授 ALL，先收回
REVOKE ALL ON public.lyric_versions FROM anon;
GRANT SELECT ON public.lyric_versions TO anon;                       -- API（anon key）读，行级由 RLS 限 published
GRANT SELECT, INSERT, UPDATE, DELETE ON public.lyric_versions TO authenticated;

CREATE INDEX lyric_versions_song_idx ON public.lyric_versions (song_id);
CREATE UNIQUE INDEX lyric_versions_song_external_uidx
  ON public.lyric_versions(song_id, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX lyric_versions_song_primary_uidx
  ON public.lyric_versions(song_id) WHERE is_primary;

-- RLS：anon 只读 published；authenticated 全权（与 song_lyric_lines p1 同模式）
ALTER TABLE public.lyric_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "歌词版本：公开可读已发布" ON public.lyric_versions
  FOR SELECT TO anon USING (status = 'published');
CREATE POLICY "歌词版本：管理员全权" ON public.lyric_versions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- updated_at 触发器（沿用 p1 模式）
CREATE OR REPLACE FUNCTION public.trg_lyric_versions_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lyric_versions_updated_at ON public.lyric_versions;
CREATE TRIGGER trg_lyric_versions_updated_at
BEFORE UPDATE ON public.lyric_versions
FOR EACH ROW EXECUTE FUNCTION public.trg_lyric_versions_updated_at();

-- ═══ 3. 存量迁移：每首有 lrc_text 的歌生成 legacy 用户版本（幂等）═══
-- format 判定（存储态 regex，对齐 phase4）：text 含 <数字> 词标签 = enhanced，否则 lrc
INSERT INTO public.lyric_versions (id, song_id, format, source, status, is_primary, contributor_id)
SELECT public.legacy_version_id(s.id),
       s.id,
       CASE WHEN s.lrc_text ~ '<\d{1,6}>' THEN 'enhanced' ELSE 'lrc' END,
       'user',
       'published',
       true,
       s.contributor_id
FROM public.songs s
WHERE coalesce(s.lrc_text, '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.lyric_versions lv
    WHERE lv.id = public.legacy_version_id(s.id)
  );

-- langs 摘要回填（从行表统计；无行表的歌保持 '{}'）
UPDATE public.lyric_versions lv
SET langs = coalesce((
  SELECT array_agg(DISTINCT l.lang ORDER BY l.lang)
  FROM public.song_lyric_lines l
  WHERE l.song_id = lv.song_id
), '{}')
WHERE lv.source = 'user';

-- ═══ 4. 行表挂 version_id ═══
-- 4a. 加列（先可空，回填后收紧）
ALTER TABLE public.song_lyric_lines ADD COLUMN version_id text;

-- 4b. 回填：有行的歌必有 lrc_text（行表只来自 rebuild），必有 legacy 版本
UPDATE public.song_lyric_lines l
SET version_id = public.legacy_version_id(l.song_id)
WHERE l.version_id IS NULL;

-- 4c. 收紧：NOT NULL + FK（版本删则行删）
ALTER TABLE public.song_lyric_lines
  ALTER COLUMN version_id SET NOT NULL,
  ADD CONSTRAINT sll_version_fkey
  FOREIGN KEY (version_id) REFERENCES public.lyric_versions(id) ON DELETE CASCADE;

-- 4d. 主键迁移：(song_id,lang,kind,seq) → (version_id,lang,kind,seq)
ALTER TABLE public.song_lyric_lines DROP CONSTRAINT song_lyric_lines_pkey;
ALTER TABLE public.song_lyric_lines ADD PRIMARY KEY (version_id, lang, kind, seq);

-- 4e. song_id 读路径索引（open-api 按 song_id 拉行）
CREATE INDEX IF NOT EXISTS sll_song_idx ON public.song_lyric_lines (song_id);

-- ═══ 5. 旧写入兼容：INSERT 不带 version_id → 自动落默认版本 ═══
CREATE OR REPLACE FUNCTION public.trg_sll_default_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vid text;
BEGIN
  IF NEW.version_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  -- 优先：该歌的 lrc/enhanced 用户主版本
  SELECT id INTO v_vid
  FROM public.lyric_versions
  WHERE song_id = NEW.song_id
    AND source = 'user' AND format IN ('lrc','enhanced')
  ORDER BY is_primary DESC, created_at
  LIMIT 1;
  -- 没有则现场建（确定性 ID，与存量迁移同 ID）
  IF v_vid IS NULL THEN
    INSERT INTO public.lyric_versions (id, song_id, format, source, status, is_primary)
    VALUES (public.legacy_version_id(NEW.song_id), NEW.song_id, 'lrc', 'user', 'published', true)
    ON CONFLICT (id) DO NOTHING;
    v_vid := public.legacy_version_id(NEW.song_id);
  END IF;
  NEW.version_id := v_vid;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sll_default_version ON public.song_lyric_lines;
CREATE TRIGGER trg_sll_default_version
BEFORE INSERT ON public.song_lyric_lines
FOR EACH ROW EXECUTE FUNCTION public.trg_sll_default_version();

-- ═══ 6. rebuild 函数改造：签名加 p_version_id（默认 NULL = 拆主版本）═══
-- 签名变化必须 DROP 重建（项目纪律：避免函数重载）
DROP FUNCTION IF EXISTS public.rebuild_song_lyric_lines(text);
CREATE OR REPLACE FUNCTION public.rebuild_song_lyric_lines(p_song_id text, p_version_id text DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lrc       text;
  v_vid       text;
  v_arr       text[];
  v_i         int;
  v_n         int;
  v_line      text;
  v_text      text;
  v_tmp       text;
  v_m         text[];
  v_t         text[];
  v_ts_ms     int;
  v_abs       int;
  v_off       int;
  v_line_ts   int;
  v_result    text;
  v_cur       text;
  v_word      text;
  v_rest      text;
  v_end_ms    int;
  v_meta_key  text;
  v_meta_rank int;
  v_has_ts    boolean;
  v_orig_lang text;
  v_is_translation boolean;
  v_multi_cnt int;
  v_total_cnt int;
  v_grp       record;
  v_cnt       int := 0;
BEGIN
  SELECT lrc_text INTO v_lrc FROM public.songs WHERE id = p_song_id;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  -- 解析目标版本：显式指定 > 该歌 lrc/enhanced 用户主版本 > 现场建 legacy
  v_vid := p_version_id;
  IF v_vid IS NULL THEN
    SELECT id INTO v_vid
    FROM public.lyric_versions
    WHERE song_id = p_song_id
      AND source = 'user' AND format IN ('lrc','enhanced')
    ORDER BY is_primary DESC, created_at
    LIMIT 1;
  END IF;

  IF v_lrc IS NULL OR btrim(v_lrc) = '' THEN
    -- 无 LRC：清该版本行 + song 级存疑（存疑仍为 song 级，多版本细化留 D 阶段）
    IF v_vid IS NOT NULL THEN
      DELETE FROM public.song_lyric_lines WHERE version_id = v_vid;
    END IF;
    DELETE FROM public.song_lyric_doubts WHERE song_id = p_song_id;
    RETURN 0;
  END IF;

  -- 版本不存在则建 legacy（确定性 ID，幂等）
  IF v_vid IS NULL THEN
    INSERT INTO public.lyric_versions (id, song_id, format, source, status, is_primary, contributor_id)
    VALUES (public.legacy_version_id(p_song_id), p_song_id,
            CASE WHEN v_lrc ~ '<\d{1,6}>' THEN 'enhanced' ELSE 'lrc' END,
            'user', 'published', true,
            (SELECT contributor_id FROM public.songs WHERE id = p_song_id))
    ON CONFLICT (id) DO NOTHING;
    v_vid := public.legacy_version_id(p_song_id);
  END IF;

  -- 幂等：清该版本旧行 + song 级存疑
  DELETE FROM public.song_lyric_lines WHERE version_id = v_vid;
  DELETE FROM public.song_lyric_doubts WHERE song_id = p_song_id;

  DROP TABLE IF EXISTS pg_temp._parsed;
  CREATE TEMP TABLE _parsed (
    line_no   int,
    time_ms   int,
    end_ms    int,
    text      text,
    meta_key  text,
    meta_rank int,
    lang      text,
    kind      text
  );

  -- ── 第一遍：拆行解析 ──
  v_arr := regexp_split_to_array(v_lrc, E'\r?\n');
  v_n := coalesce(array_length(v_arr, 1), 0);

  FOR v_i IN 1..v_n LOOP
    v_line := btrim(v_arr[v_i]);
    CONTINUE WHEN v_line = '';

    -- ① 元数据行 [key:value]
    v_m := regexp_match(v_line, '^\[([A-Za-z][A-Za-z0-9]*):(.*)\]$');
    IF v_m IS NOT NULL THEN
      v_meta_key := lower(v_m[1]);
      v_meta_rank := CASE v_meta_key
        WHEN 'ti' THEN 1 WHEN 'ar' THEN 2 WHEN 'al' THEN 3 WHEN 'by' THEN 4 ELSE 5 END;
      INSERT INTO _parsed (line_no, time_ms, text, meta_key, meta_rank, lang, kind)
      VALUES (v_i, NULL, v_line, v_meta_key, v_meta_rank, NULL, 'original');
      CONTINUE;
    END IF;

    -- ② 时间戳行 [t] 或 [t1][t2]
    IF v_line ~ '^\[\d{1,3}:\d{2}[.:]\d{2,3}\]' THEN
      v_text := regexp_replace(v_line, '^(\[\d{1,3}:\d{2}[.:]\d{2,3}\])+', '');
      v_has_ts := false;

      -- verbatim（纯方括号逐字）：剥行首连续时间戳后 v_text 仍含 [mm:ss.xx] → N+1 时间戳的逐字格式
      IF v_text ~ '\[\d{1,3}:\d{2}[.:]\d{2,3}\]' THEN
        v_t := regexp_match(v_line, '^\[(\d{1,3}):(\d{2})[.:](\d{2,3})\]');
        v_line_ts := v_t[1]::int * 60000 + v_t[2]::int * 1000
                   + CASE WHEN length(v_t[3]) = 2 THEN v_t[3]::int * 10 ELSE v_t[3]::int END;
        v_result := '';
        v_cur := v_text;
        v_off := 0;
        v_end_ms := NULL;
        LOOP
          v_t := regexp_match(v_cur, '^(.*?)\[(\d{1,3}):(\d{2})[.:](\d{2,3})\](.*)$');
          IF v_t IS NULL THEN
            IF v_cur <> '' THEN
              v_result := v_result || CASE WHEN v_off = 0 THEN v_cur ELSE '<' || v_off || '>' || v_cur END;
            END IF;
            EXIT;
          END IF;
          v_word := v_t[1];
          v_ts_ms := v_t[2]::int * 60000 + v_t[3]::int * 1000
                   + CASE WHEN length(v_t[4]) = 2 THEN v_t[4]::int * 10 ELSE v_t[4]::int END;
          v_rest := v_t[5];
          IF v_word <> '' THEN
            v_result := v_result || CASE WHEN v_off = 0 THEN v_word ELSE '<' || v_off || '>' || v_word END;
          END IF;
          IF v_rest = '' THEN
            v_end_ms := v_ts_ms;
            EXIT;
          END IF;
          v_off := v_ts_ms - v_line_ts;
          v_cur := v_rest;
        END LOOP;
        INSERT INTO _parsed (line_no, time_ms, end_ms, text, meta_key, meta_rank, lang, kind)
        VALUES (v_i, v_line_ts, v_end_ms, v_result, NULL, 0, NULL, NULL);
        CONTINUE;
      END IF;

      FOR v_m IN SELECT m FROM regexp_matches(v_line, '\[(\d{1,3}):(\d{2})[.:](\d{2,3})\]', 'g') AS t(m) LOOP
        v_ts_ms := v_m[1]::int * 60000 + v_m[2]::int * 1000
                 + CASE WHEN length(v_m[3]) = 2 THEN v_m[3]::int * 10 ELSE v_m[3]::int END;
        v_has_ts := true;
        v_tmp := v_text;
        WHILE v_tmp ~ '<\d{1,3}:\d{2}\.\d{2,3}>' LOOP
          v_t := regexp_match(v_tmp, '<(\d{1,3}):(\d{2})\.(\d{2,3})>');
          v_abs := v_t[1]::int * 60000 + v_t[2]::int * 1000
                 + CASE WHEN length(v_t[3]) = 2 THEN v_t[3]::int * 10 ELSE v_t[3]::int END;
          v_off := v_abs - v_ts_ms;
          v_tmp := regexp_replace(v_tmp, '<\d{1,3}:\d{2}\.\d{2,3}>', '<' || v_off || '>');
        END LOOP;
        INSERT INTO _parsed (line_no, time_ms, text, meta_key, meta_rank, lang, kind)
        VALUES (v_i, v_ts_ms, v_tmp, NULL, 0, NULL, NULL);
      END LOOP;
      IF NOT v_has_ts THEN
        INSERT INTO public.song_lyric_doubts (song_id, line_no, raw_text, reason)
        VALUES (p_song_id, v_i, v_line, 'bare_line');
      END IF;
      CONTINUE;
    END IF;

    -- ③ 裸行 → 存疑
    IF btrim(v_line) <> '' THEN
      INSERT INTO public.song_lyric_doubts (song_id, line_no, raw_text, reason)
      VALUES (p_song_id, v_i, v_line, 'bare_line');
    END IF;
  END LOOP;

  -- ── 第二遍：确定 primary_lang ──
  SELECT d.lang INTO v_orig_lang
  FROM (
    SELECT CASE lyric_lang_detect(text)
             WHEN 'latin' THEN 'en'
             WHEN 'unknown' THEN NULL
             ELSE lyric_lang_detect(text)
           END AS lang
    FROM _parsed
    WHERE time_ms IS NOT NULL
  ) d
  WHERE d.lang IS NOT NULL
  GROUP BY d.lang
  ORDER BY count(*) DESC, d.lang
  LIMIT 1;
  IF v_orig_lang IS NULL THEN v_orig_lang := 'und'; END IF;

  -- ── 第三遍前：歌级结构判定（成对占比）──
  SELECT count(*) FILTER (WHERE t.cnt >= 2), count(*)
  INTO v_multi_cnt, v_total_cnt
  FROM (
    SELECT time_ms, count(*) AS cnt
    FROM _parsed
    WHERE time_ms IS NOT NULL
      AND btrim(text) <> ''
      AND lyric_lang_detect(text) <> 'unknown'
      AND NOT lyric_is_credit(text)
    GROUP BY time_ms
  ) t;
  v_is_translation := (coalesce(v_total_cnt, 0) > 0
    AND coalesce(v_multi_cnt, 0) >= 0.5 * coalesce(v_total_cnt, 0));

  -- ── 第三遍：同戳组拆分 ──
  FOR v_grp IN
    SELECT time_ms AS ts
    FROM _parsed WHERE time_ms IS NOT NULL
    GROUP BY time_ms
    HAVING count(*) FILTER (WHERE btrim(text) <> '' AND lyric_lang_detect(text) <> 'unknown') > 1
    ORDER BY time_ms
  LOOP
    IF NOT v_is_translation THEN
      UPDATE _parsed SET lang = v_orig_lang, kind = 'original' WHERE time_ms = v_grp.ts;
    ELSE
      UPDATE _parsed p
      SET lang = CASE sub.det
                   WHEN 'unknown' THEN v_orig_lang
                   WHEN 'latin' THEN 'en'
                   ELSE sub.det
                 END,
          kind = CASE WHEN sub.pos = 1 THEN 'original' ELSE 'translation' END
      FROM (
        SELECT line_no,
               row_number() OVER (ORDER BY line_no) AS pos,
               lyric_lang_detect(text) AS det
        FROM _parsed
        WHERE time_ms = v_grp.ts
          AND btrim(text) <> ''
          AND lyric_lang_detect(text) <> 'unknown'
      ) sub
      WHERE p.time_ms = v_grp.ts AND p.line_no = sub.line_no;
    END IF;
  END LOOP;

  -- ── 第四遍：单行（非同戳）全部归 primary_lang 的 original ──
  UPDATE _parsed
  SET kind = 'original', lang = v_orig_lang
  WHERE time_ms IS NOT NULL AND kind IS NULL;

  -- 元数据行 + 空文本时间戳行 lang 跟 primary_lang
  UPDATE _parsed SET lang = v_orig_lang WHERE time_ms IS NULL OR btrim(text) = '';

  -- ── 第五遍：分配 seq 并入库（挂 version_id）──
  INSERT INTO public.song_lyric_lines (version_id, song_id, lang, kind, seq, time_ms, end_ms, text)
  SELECT v_vid, p_song_id, lang, kind,
         row_number() OVER (
           ORDER BY
             CASE WHEN time_ms IS NULL THEN 0 ELSE 1 END,
             CASE WHEN time_ms IS NULL THEN meta_rank ELSE time_ms END,
             line_no
         ),
         time_ms, end_ms, text
  FROM _parsed;

  -- langs 摘要维护（fix1 补丁）：随行表变化同步刷新该版本的语言摘要
  UPDATE public.lyric_versions lv
  SET langs = coalesce((
    SELECT array_agg(DISTINCT l.lang ORDER BY l.lang)
    FROM public.song_lyric_lines l
    WHERE l.version_id = v_vid
  ), '{}')
  WHERE lv.id = v_vid;

  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  DROP TABLE IF EXISTS pg_temp._parsed;
  RETURN v_cnt;
END;
$$;

REVOKE ALL ON FUNCTION public.rebuild_song_lyric_lines(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rebuild_song_lyric_lines(text, text) TO authenticated;

-- ═══ 7. langs 摘要再回填（rebuild 行为变化后保持一致性；存量迁移后跑一次全量）═══
UPDATE public.lyric_versions lv
SET langs = coalesce((
  SELECT array_agg(DISTINCT l.lang ORDER BY l.lang)
  FROM public.song_lyric_lines l
  WHERE l.song_id = lv.song_id
), '{}')
WHERE lv.source = 'user' AND lv.format IN ('lrc','enhanced');

NOTIFY pgrst, 'reload schema';

COMMIT;
```

**预期结果**：Success, no rows returned。

## 验证清单（执行后逐条过）

```sql
-- 1. 迁移完整性：每首有 lrc_text 的歌恰好一个 legacy 版本且 is_primary
SELECT count(*) AS songs_with_lrc,
       (SELECT count(*) FROM public.lyric_versions WHERE source = 'user') AS legacy_versions
FROM public.songs WHERE coalesce(lrc_text, '') <> '';
-- 预期：两个数字相等

-- 2. 行表无悬空：version_id 全部非空且指向存在的版本
SELECT count(*) FROM public.song_lyric_lines WHERE version_id IS NULL;
-- 预期 0

-- 3. 主键已是版本维度
SELECT pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'public.song_lyric_lines'::regclass AND contype = 'p';
-- 预期：PRIMARY KEY (version_id, lang, kind, seq)

-- 4. rebuild 单曲重跑幂等：行数一致
SELECT public.rebuild_song_lyric_lines('<挑一首多语言歌的 song_id>');
SELECT count(*) FROM public.song_lyric_lines WHERE song_id = '<同上>';
-- 再跑一遍 rebuild，count 不变

-- 5. 旧写入兼容：模拟不带 version_id 的插行（DoubtsView 路径）
--    在存疑页处理一条存疑，或：
INSERT INTO public.song_lyric_lines (song_id, lang, kind, seq, time_ms, text)
VALUES ('<song_id>', 'zh', 'original', 9999, 0, 'trigger测试');
SELECT version_id FROM public.song_lyric_lines
WHERE song_id = '<song_id>' AND seq = 9999;
-- 预期：version_id 已自动填充 legacy 版本 ID；确认后删除该测试行
DELETE FROM public.song_lyric_lines WHERE song_id = '<song_id>' AND seq = 9999;

-- 6. 前台回归：打开一首多语言歌详情页，歌词正常显示（open-api 按 song_id 读行表）
-- 7. 后台回归：歌曲编辑里保存一次歌词（lyricLines.ts 全量删插路径），重新打开无异常
-- 8. anon 读 lyric_versions 只见 published
SELECT count(*) FROM public.lyric_versions WHERE status <> 'published';
-- 预期 0（本阶段全是 published）
```

## 回滚（如需）

```sql
BEGIN;
-- 行表回滚：换回旧主键、删 version_id（行数据本身不动，version_id 回填不破坏 song_id 数据）
ALTER TABLE public.song_lyric_lines DROP CONSTRAINT song_lyric_lines_pkey;
ALTER TABLE public.song_lyric_lines ADD PRIMARY KEY (song_id, lang, kind, seq);
ALTER TABLE public.song_lyric_lines DROP CONSTRAINT IF EXISTS sll_version_fkey;
DROP INDEX IF EXISTS sll_song_idx;
DROP TRIGGER IF EXISTS trg_sll_default_version ON public.song_lyric_lines;
DROP FUNCTION IF EXISTS public.trg_sll_default_version();
ALTER TABLE public.song_lyric_lines DROP COLUMN IF EXISTS version_id;
-- rebuild 回滚：执行 phase4-lyric-nlang-v2.md 步骤 1 的函数段（单参签名）
-- 版本表回滚（最后，会连带删行表 FK 依赖——先删行表 version_id 再删表）
DROP TABLE IF EXISTS public.lyric_versions;
DROP FUNCTION IF EXISTS public.legacy_version_id(text);
DROP FUNCTION IF EXISTS public.trg_lyric_versions_updated_at();
NOTIFY pgrst, 'reload schema';
COMMIT;
```

> ⚠️ 回滚顺序注意：必须先做行表部分（换回旧主键、删 version_id），再 DROP lyric_versions，否则 FK 阻塞。
> rebuild 的回滚需单独从 phase4-lyric-nlang-v2.md 复制函数段执行。

## C 阶段预告（代码侧，本 SQL 部署后进行）

- open-api.js：详情接口输出 `lyric_versions` 数组 + `comment` 按版本署名
- lyricLines.ts / DoubtsView.vue：读写显式带 version_id（去掉触发器兜底依赖）
- `lrc_text` 保持只读兼容（主版本投影逻辑在 API 层做，不动表）
