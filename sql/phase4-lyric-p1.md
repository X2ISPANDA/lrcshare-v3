# 阶段四 P1：歌词行表建表 + 存量迁移 + 校验（phase4-lyric-p1）

> 依据：`sql/phase4-lyric-versions.md`（v2 定稿，六项决策已拍板）。
> 执行日期：____（执行后填写）
> 前置：phase3 已收尾；`songs.lrc_text` 为存量唯一 LRC 来源。
>
> **本脚本全部为增量操作**：只加两张新表 + 三个函数 + 一个触发器，**不改 songs 表结构、不碰 lrc_text 内容**。回滚 = DROP 新对象，存量零影响。
>
> 实现决策（与 MD 对齐，两处务实落地）：
> 1. **语言判定只判 ja/ko/zh/latin/unknown**，不自动细分 `zh-Hant`（繁体字表维护成本高、误判风险大）；繁体样本由 P2 存疑清单人工精化。
> 2. **迁移前预检用「小规模试跑 + 看存疑清单分布」落地**：试跑 5 首能直接暴露「同戳 >2 行」「双行判不出」的真实规模，比纯只读预检更准。
> 3. **新歌拆行闭环用触发器**：`songs.lrc_text` 任何 INSERT/UPDATE 自动重拆，发布链（SubmissionsView `insert('songs', {lrc_text})`）零改动。

---

## 步骤 1：建表 + RLS + 索引

```sql
BEGIN;

-- ── 1a. 歌词行表 ──
CREATE TABLE IF NOT EXISTS public.song_lyric_lines (
  song_id    text NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,
  lang       text NOT NULL CHECK (lang <> ''),
  kind       text NOT NULL CHECK (kind IN ('original','translation','romanization')),
  seq        integer NOT NULL CHECK (seq >= 1),
  time_ms    integer CHECK (time_ms IS NULL OR time_ms >= 0),
  end_ms     integer CHECK (end_ms IS NULL OR end_ms >= 0),
  text       text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (song_id, lang, kind, seq)
);

-- 存量表补列（已建表环境执行；新建表时上方 CREATE TABLE 已含 end_ms，此 ALTER 幂等无副作用）
ALTER TABLE public.song_lyric_lines ADD COLUMN IF NOT EXISTS end_ms integer CHECK (end_ms IS NULL OR end_ms >= 0);

-- ── 1b. 存疑清单表（迁移判不出的行，P2 人工处理）──
CREATE TABLE IF NOT EXISTS public.song_lyric_doubts (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  song_id    text NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,
  line_no    integer,
  raw_text   text NOT NULL,
  reason     text NOT NULL CHECK (reason IN ('multi_same_ts','bare_line','word_tag_ambiguous')),
  resolved   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lyric_doubts_song ON public.song_lyric_doubts (song_id);
CREATE INDEX IF NOT EXISTS idx_lyric_doubts_open ON public.song_lyric_doubts (resolved, created_at);

-- ── 1c. RLS/权限（Supabase 默认授权坑：先 REVOKE 再最小重授）──
REVOKE ALL ON public.song_lyric_lines FROM anon, authenticated;
GRANT SELECT ON public.song_lyric_lines TO anon;            -- API（anon key）读
GRANT SELECT, INSERT, UPDATE, DELETE ON public.song_lyric_lines TO authenticated;  -- 后台编辑（P2）

REVOKE ALL ON public.song_lyric_doubts FROM anon, authenticated;
GRANT SELECT, UPDATE ON public.song_lyric_doubts TO authenticated;  -- 后台存疑页读+标记 resolved

ALTER TABLE public.song_lyric_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY "歌词行：公开可读" ON public.song_lyric_lines
  FOR SELECT TO anon USING (true);
CREATE POLICY "歌词行：管理员全权" ON public.song_lyric_lines
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

ALTER TABLE public.song_lyric_doubts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "存疑：管理员全权" ON public.song_lyric_doubts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- ── 1d. updated_at 维护触发器（否则永远等于 created_at，沦为装饰列）──
CREATE OR REPLACE FUNCTION public.set_lyric_line_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_lyric_lines_updated_at
BEFORE UPDATE ON public.song_lyric_lines
FOR EACH ROW EXECUTE FUNCTION public.set_lyric_line_updated_at();

COMMIT;
```

> 说明：`song_lyric_doubts` 不给 anon 任何策略 = 默认拒绝，仅后台（authenticated）可见。拆行函数是 SECURITY DEFINER，不受上表 RLS 限制。

---

## 步骤 2：语言判定函数

```sql
BEGIN;

-- 判定顺序：假名(含长音) → 谚文 → 汉字 → 纯拉丁 → 未知
-- 返回 'latin' 表示「纯拉丁字母但无法确定语言」（en/fr/de/罗马音都是拉丁），由调用方决定映射：
--   · original 单行：latin → en（英文原文合理默认）
--   · 同戳双行第二行：latin → 'und' + 存疑（不硬判）
CREATE OR REPLACE FUNCTION public.lyric_lang_detect(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_text ~ '[ぁ-んァ-ヶー]' THEN 'ja'
    WHEN p_text ~ '[가-힣]' THEN 'ko'
    WHEN p_text ~ '[一-龥]' THEN 'zh'
    WHEN p_text ~ '[A-Za-z]' THEN 'latin'
    ELSE 'unknown'
  END
$$;

COMMIT;
```

---

## 步骤 3：拆行主函数（幂等，迁移与触发器复用）

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.rebuild_song_lyric_lines(p_song_id text)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lrc       text;
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
  v_line_ts   int;      -- verbatim 行时间（行首第一个时间戳）
  v_result    text;     -- verbatim 拼接结果 text
  v_cur       text;     -- verbatim 剩余待处理文本
  v_word      text;     -- verbatim 当前词
  v_rest      text;     -- verbatim 时间戳后的剩余文本
  v_end_ms    int;      -- verbatim 行尾结束时间（毫秒）；非 verbatim 行 NULL
  v_meta_key  text;
  v_meta_rank int;
  v_has_ts    boolean;
  v_lang      text;
  v_lang2     text;
  v_lang3     text;
  v_orig_lang text;
  v_pos1      text;
  v_pos2      text;
  v_pos3      text;
  v_grp       record;
  v_ps        record;
  v_line1     int;
  v_line2     int;
  v_cnt       int := 0;
BEGIN
  SELECT lrc_text INTO v_lrc FROM public.songs WHERE id = p_song_id;
  IF NOT FOUND OR v_lrc IS NULL OR btrim(v_lrc) = '' THEN
    -- 无歌词：清空行表与存疑，返回 0
    DELETE FROM public.song_lyric_lines WHERE song_id = p_song_id;
    DELETE FROM public.song_lyric_doubts WHERE song_id = p_song_id;
    RETURN 0;
  END IF;

  -- 幂等：清空旧行与旧存疑（先 DELETE 再 INSERT，可重复跑）
  DELETE FROM public.song_lyric_lines WHERE song_id = p_song_id;
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

    -- ① 元数据行 [key:value]（key 为字母：ti/ar/al/by 及其他）
    v_m := regexp_match(v_line, '^\[([A-Za-z][A-Za-z0-9]*):(.*)\]$');
    IF v_m IS NOT NULL THEN
      v_meta_key := lower(v_m[1]);
      v_meta_rank := CASE v_meta_key
        WHEN 'ti' THEN 1 WHEN 'ar' THEN 2 WHEN 'al' THEN 3 WHEN 'by' THEN 4 ELSE 5 END;
      INSERT INTO _parsed (line_no, time_ms, text, meta_key, meta_rank, lang, kind)
      VALUES (v_i, NULL, v_line, v_meta_key, v_meta_rank, NULL, 'original');
      CONTINUE;
    END IF;

    -- ② 时间戳行 [t] 或 [t1][t2]：提取所有时间戳，去掉前导标签得文本
    IF v_line ~ '^\[\d{1,3}:\d{2}[.:]\d{2,3}\]' THEN
      v_text := regexp_replace(v_line, '^(\[\d{1,3}:\d{2}[.:]\d{2,3}\])+', '');
      v_has_ts := false;

      -- verbatim（纯方括号逐字）：剥行首连续时间戳后 v_text 仍含 [mm:ss.xx] → N+1 时间戳的逐字格式。
      -- 前 N 个 [t] = 词开始（第 1 个 = 行时间），最后 1 个 [t]（后无词）= 行尾 → end_ms。
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
            -- 剩余纯词（无 [time]）：作为当前 offset 的词收尾
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
            v_end_ms := v_ts_ms; -- 行尾时间戳（后无词）→ end_ms
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
        -- 词标签转换：<mm:ss.xx> 绝对 → <偏移> 相对（相对本行 time_ms，独立副本避免污染多时间戳共享文本）
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

    -- ③ 裸行（无时间戳、非元数据）→ 进存疑，不静默丢弃
    IF btrim(v_line) <> '' THEN
      INSERT INTO public.song_lyric_doubts (song_id, line_no, raw_text, reason)
      VALUES (p_song_id, v_i, v_line, 'bare_line');
    END IF;
  END LOOP;

  -- ── 第二遍：确定 primary_lang（歌级语言，非行级）──
  -- 统计所有时间戳行 detect，latin → en（英文原文/Japanglish）；最多者 = primary_lang
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

  -- ── 第三遍前：统计三行同戳组的「位置结构」（每位置语言众数，整体判断，不靠逐行 detect）──
  -- 例：Tokyo Bon 三行组 = 英文(位置1) + 中文(位置2) + 日语(位置3)；第三行写纯汉字也按位置判日语
  v_pos1 := NULL; v_pos2 := NULL; v_pos3 := NULL;
  FOR v_ps IN
    SELECT pos, lang, count(*) AS cnt
    FROM (
      SELECT row_number() OVER (PARTITION BY time_ms ORDER BY line_no) AS pos,
             CASE lyric_lang_detect(text)
               WHEN 'latin' THEN 'en'
               WHEN 'unknown' THEN NULL
               ELSE lyric_lang_detect(text)
             END AS lang
      FROM _parsed
      WHERE time_ms IN (
        SELECT time_ms FROM _parsed WHERE time_ms IS NOT NULL
        GROUP BY time_ms HAVING count(*) = 3
      )
    ) t
    WHERE lang IS NOT NULL
    GROUP BY pos, lang
    ORDER BY pos, cnt DESC
  LOOP
    IF v_ps.pos = 1 AND v_pos1 IS NULL THEN v_pos1 := v_ps.lang; END IF;
    IF v_ps.pos = 2 AND v_pos2 IS NULL THEN v_pos2 := v_ps.lang; END IF;
    IF v_ps.pos = 3 AND v_pos3 IS NULL THEN v_pos3 := v_ps.lang; END IF;
  END LOOP;

  -- ── 第三遍：同戳组判定 ──
  FOR v_grp IN
    SELECT time_ms AS ts, count(*) AS cnt
    FROM _parsed WHERE time_ms IS NOT NULL
    GROUP BY time_ms HAVING count(*) > 1
    ORDER BY time_ms
  LOOP
    IF v_grp.cnt = 2 THEN
      v_line1 := (SELECT line_no FROM _parsed WHERE time_ms = v_grp.ts ORDER BY line_no LIMIT 1);
      v_line2 := (SELECT line_no FROM _parsed WHERE time_ms = v_grp.ts ORDER BY line_no LIMIT 1 OFFSET 1);
      v_lang  := (SELECT lyric_lang_detect(text) FROM _parsed WHERE time_ms = v_grp.ts ORDER BY line_no LIMIT 1);
      v_lang2 := (SELECT lyric_lang_detect(text) FROM _parsed WHERE time_ms = v_grp.ts ORDER BY line_no LIMIT 1 OFFSET 1);
      -- 两行语言都明确且不同 → 第一行 original，第二行 translation
      IF v_lang NOT IN ('latin','unknown') AND v_lang2 NOT IN ('latin','unknown') AND v_lang <> v_lang2 THEN
        UPDATE _parsed SET lang = v_lang,  kind = 'original'    WHERE time_ms = v_grp.ts AND line_no = v_line1;
        UPDATE _parsed SET lang = v_lang2, kind = 'translation' WHERE time_ms = v_grp.ts AND line_no = v_line2;
      ELSE
        -- 其余（latin/unknown/相同）→ 都归 primary_lang 的 original（不拆、不 und、不存疑）
        UPDATE _parsed SET lang = v_orig_lang, kind = 'original' WHERE time_ms = v_grp.ts;
      END IF;
    ELSIF v_grp.cnt = 3 THEN
      -- 位置结构明确（pos1=原文语言且三位置互异）→ 按位置分配，不靠逐行 detect
      IF v_pos1 IS NOT NULL AND v_pos2 IS NOT NULL AND v_pos3 IS NOT NULL
         AND v_pos1 = v_orig_lang
         AND v_pos1 <> v_pos2 AND v_pos2 <> v_pos3 AND v_pos1 <> v_pos3 THEN
        UPDATE _parsed p
        SET lang = CASE sub.pos WHEN 1 THEN v_pos1 WHEN 2 THEN v_pos2 ELSE v_pos3 END,
            kind = CASE sub.pos WHEN 1 THEN 'original' ELSE 'translation' END
        FROM (
          SELECT line_no, time_ms,
                 row_number() OVER (PARTITION BY time_ms ORDER BY line_no) AS pos
          FROM _parsed WHERE time_ms = v_grp.ts
        ) sub
        WHERE p.time_ms = sub.time_ms AND p.line_no = sub.line_no;
      ELSE
        -- 位置结构不明确 → 归 original + 存疑
        UPDATE _parsed SET lang = v_orig_lang, kind = 'original' WHERE time_ms = v_grp.ts;
        INSERT INTO public.song_lyric_doubts (song_id, line_no, raw_text, reason)
        SELECT p_song_id, line_no, text, 'multi_same_ts' FROM _parsed WHERE time_ms = v_grp.ts;
      END IF;
    ELSE
      -- 同戳 >3 行：全部 original(primary_lang) + 存疑
      UPDATE _parsed SET lang = v_orig_lang, kind = 'original' WHERE time_ms = v_grp.ts;
      INSERT INTO public.song_lyric_doubts (song_id, line_no, raw_text, reason)
      SELECT p_song_id, line_no, text, 'multi_same_ts' FROM _parsed WHERE time_ms = v_grp.ts;
    END IF;
  END LOOP;

  -- ── 第四遍：单行（非同戳）全部归 primary_lang 的 original ──
  UPDATE _parsed
  SET kind = 'original', lang = v_orig_lang
  WHERE time_ms IS NOT NULL AND kind IS NULL;

  -- 元数据行 + 空文本时间戳行 lang 跟 primary_lang（空文本行无语言特征，归主语言）
  UPDATE _parsed SET lang = v_orig_lang WHERE time_ms IS NULL OR btrim(text) = '';

  -- ── 第五遍：分配 seq 并入库（元数据在前按 key 序，时间戳按 time_ms 升序，同戳按行序）──
  INSERT INTO public.song_lyric_lines (song_id, lang, kind, seq, time_ms, end_ms, text)
  SELECT p_song_id, lang, kind,
         row_number() OVER (
           ORDER BY
             CASE WHEN time_ms IS NULL THEN 0 ELSE 1 END,
             CASE WHEN time_ms IS NULL THEN meta_rank ELSE time_ms END,
             line_no
         ),
         time_ms, end_ms, text
  FROM _parsed;

  GET DIAGNOSTICS v_cnt = ROW_COUNT;
  DROP TABLE IF EXISTS pg_temp._parsed;
  RETURN v_cnt;
END;
$$;

-- 仅后台可调用（anon 投稿不直接调，走触发器）
REVOKE ALL ON FUNCTION public.rebuild_song_lyric_lines(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rebuild_song_lyric_lines(text) TO authenticated;

COMMIT;
```

---

## 步骤 4：新歌拆行闭环（触发器）

```sql
BEGIN;

-- songs 任一 INSERT 后自动重拆（P2 起仅 INSERT：UPDATE lrc_text 是后台「重合成写回」，不能再反向重拆行表）
CREATE OR REPLACE FUNCTION public.trg_song_lyric_rebuild()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.rebuild_song_lyric_lines(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_song_lyric_rebuild ON public.songs;
CREATE TRIGGER trg_song_lyric_rebuild
AFTER INSERT ON public.songs
FOR EACH ROW
EXECUTE FUNCTION public.trg_song_lyric_rebuild();

COMMIT;
```

> ✅ **已改仅 INSERT（P2 执行）**：P2 起「行表权威、lrc_text 派生」——后台版本管理保存 = 先写行表 → 重合成写回 lrc_text，若 UPDATE lrc_text 仍触发重拆会**反向覆盖行表编辑**，故本触发器已改为**仅 INSERT**。存量迁移直接调 `rebuild_...`，**不经过触发器**（不写 songs），无递归。

---

## 步骤 5：存量迁移（备份 → 试跑 → 全量）

### 5a. 迁移前备份 lrc_text（纯只读快照，双保险）

```sql
DROP TABLE IF EXISTS public._backup_p4_lrc_text;
CREATE TABLE public._backup_p4_lrc_text AS
SELECT id, lrc_text, created_at FROM public.songs;
```

### 5b. 试跑 5 首（先看效果 + 存疑分布，再决定全量）

```sql
-- 换成 5 首实际存在的 published 歌 ID
SELECT id, public.rebuild_song_lyric_lines(id) AS rows_inserted
FROM public.songs
WHERE status = 'published' AND lrc_text IS NOT NULL AND btrim(lrc_text) <> ''
ORDER BY created_at
LIMIT 5;
```

试跑后检查：

```sql
-- 试跑歌的行表分布
SELECT song_id, kind, lang, count(*) FROM public.song_lyric_lines
WHERE song_id IN (SELECT id FROM public.songs WHERE status='published' AND lrc_text IS NOT NULL AND btrim(lrc_text)<>'' ORDER BY created_at LIMIT 5)
GROUP BY song_id, kind, lang ORDER BY song_id, kind, lang;

-- 存疑分布（决定全量节奏的关键）
SELECT reason, count(*) FROM public.song_lyric_doubts GROUP BY reason ORDER BY 2 DESC;
```

> 判断：`multi_same_ts`（同戳>2）预期 0；`pair_unresolved`（双行判不出）若比例高（如 >5% 歌），先人工看几例再全量。`bare_line`（裸行）少量可接受，全量后统一处理。

### 5c. 全量迁移（可重复跑，幂等）

```sql
DO $$
DECLARE
  r record;
  n int := 0;
  total int := 0;
BEGIN
  FOR r IN
    SELECT id FROM public.songs
    WHERE status = 'published' AND lrc_text IS NOT NULL AND btrim(lrc_text) <> ''
  LOOP
    n := public.rebuild_song_lyric_lines(r.id);
    total := total + n;
  END LOOP;
  RAISE NOTICE '迁移完成：共 % 行歌词', total;
END $$;
```

---

## 步骤 6：守恒校验（时间戳数守恒，逐歌比对）

> 完整「合成回读逐行比对」在 Worker 合成逻辑实现后另出 JS 脚本；此处 SQL 先做**时间戳标签数 = 行表时间戳行数**的精确守恒校验（迁移丢行/多行的硬指标）。

```sql
-- 守恒校验①：时间戳标签数 vs 行表时间戳行数（预期 0 行；注记行、空文本行都入库，两侧一致）
SELECT s.id, s.title,
       (SELECT count(*) FROM regexp_matches(s.lrc_text, '\[\d{1,3}:\d{2}[.:]\d{2,3}\]', 'g')) AS src_ts,
       (SELECT count(*) FROM public.song_lyric_lines l WHERE l.song_id = s.id AND l.time_ms IS NOT NULL) AS tbl_ts
FROM public.songs s
WHERE s.status = 'published' AND s.lrc_text IS NOT NULL AND btrim(s.lrc_text) <> ''
  AND (SELECT count(*) FROM regexp_matches(s.lrc_text, '\[\d{1,3}:\d{2}[.:]\d{2,3}\]', 'g'))
    <> (SELECT count(*) FROM public.song_lyric_lines l WHERE l.song_id = s.id AND l.time_ms IS NOT NULL);

-- 迁移覆盖率：有歌词但行表无行的歌（预期 0；仅当歌词全是裸行/空白时才会 0 行，此时存疑清单应有记录）
SELECT s.id, s.title
FROM public.songs s
WHERE s.status = 'published' AND s.lrc_text IS NOT NULL AND btrim(s.lrc_text) <> ''
  AND NOT EXISTS (SELECT 1 FROM public.song_lyric_lines l WHERE l.song_id = s.id);

-- 全库分布总览
SELECT kind, lang, count(*) FROM public.song_lyric_lines GROUP BY kind, lang ORDER BY kind, lang;
SELECT reason, count(*) FROM public.song_lyric_doubts GROUP BY reason ORDER BY 2 DESC;
```

---

## 验收清单

| # | 项 | 方法 |
|---|---|---|
| 1 | 重复跑幂等 | 试跑 5 首跑两遍，`rows_inserted` 与行数不变 |
| 2 | 时间戳守恒 | 步骤 6 第一条预期 0 行 |
| 3 | 迁移覆盖率 | 步骤 6 第二条无意外漏歌 |
| 4 | 同戳拆分正确 | 抽一首「日文+中文」双语歌，original(ja) + translation(zh) 各一行 |
| 5 | 元数据行 | 抽一首有 `[ti:]` 的歌，行表 time_ms=NULL 的 original 行存在，seq 排最前 |
| 6 | 存疑清单 | `pair_unresolved` 记录含 song_id + line_no + 原文 |
| 7 | 空文本行保留 | 抽一首有 `[mm:ss.xx]`（后无内容）的歌，行表 time_ms 有值、text='' 的行存在（间奏清屏点不丢） |
| 8 | 新歌闭环 | 后台发布一首带 LRC 的新歌，行表自动出现该歌行（触发器） |
| 9 | 存量 lrc_text 未动 | 对比 `_backup_p4_lrc_text` 与 `songs.lrc_text` 逐字一致 |

---

## 回滚（全部增量，DROP 即回，songs 零影响）

```sql
BEGIN;
DROP TRIGGER IF EXISTS trg_song_lyric_rebuild ON public.songs;
DROP FUNCTION IF EXISTS public.trg_song_lyric_rebuild();
DROP TRIGGER IF EXISTS trg_lyric_lines_updated_at ON public.song_lyric_lines;
DROP FUNCTION IF EXISTS public.set_lyric_line_updated_at();
DROP FUNCTION IF EXISTS public.rebuild_song_lyric_lines(text);
DROP FUNCTION IF EXISTS public.lyric_lang_detect(text);
DROP TABLE IF EXISTS public.song_lyric_doubts;
DROP TABLE IF EXISTS public.song_lyric_lines;
COMMIT;
-- 备份表确认无误后再删：
-- DROP TABLE IF EXISTS public._backup_p4_lrc_text;
```
