# Phase5 B 阶段补丁 1：langs 摘要维护（phase5-stepB-fix1）

> 问题：B 阶段只在存量迁移时回填过一次 `lyric_versions.langs`，此后的行表写入路径
> （`rebuild_song_lyric_lines` RPC、前端 `saveLyricLines`）都不维护它——新发布的歌 langs 恒为空。
> 修复：rebuild 函数末尾维护 langs（SQL）+ saveLyricLines 末尾维护 langs（前端，随代码发布）。
> 幂等：可重复执行；重跑只刷新摘要，不影响行数据。

## SQL（整段复制执行）

```sql
BEGIN;

-- ① rebuild 函数：仅在 B 阶段版本基础上于「第五遍入库」后新增 langs 维护段（标注 ★）
DROP FUNCTION IF EXISTS public.rebuild_song_lyric_lines(text, text);
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
      UPDATE public.lyric_versions SET langs = '{}' WHERE id = v_vid;
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

  -- ★ langs 摘要维护（fix1）：随行表变化同步刷新该版本的语言摘要
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

-- ② 全表 langs 回填（修复存量 + B 阶段后新建的歌）
UPDATE public.lyric_versions lv
SET langs = coalesce((
  SELECT array_agg(DISTINCT l.lang ORDER BY l.lang)
  FROM public.song_lyric_lines l
  WHERE l.version_id = lv.id
), '{}')
WHERE lv.format IN ('lrc','enhanced');

NOTIFY pgrst, 'reload schema';

COMMIT;
```

## 验证

```sql
-- 1. 全表无空 langs（lrc/enhanced 版本至少 ['und'] 不出现空数组；从未有行的歌为 '{}' 属正常）
SELECT count(*) FROM public.lyric_versions
WHERE format IN ('lrc','enhanced') AND langs = '{}' 
  AND EXISTS (SELECT 1 FROM public.song_lyric_lines WHERE version_id = lyric_versions.id);
-- 预期 0

-- 2. 用户刚才那首 TTML 测试歌：lrc 版本 langs 应已有值
SELECT id, format, langs FROM public.lyric_versions WHERE song_id = '<测试歌id>';
```

## 前端配套（saveLyricLines，随代码提交生效，无需额外操作）
