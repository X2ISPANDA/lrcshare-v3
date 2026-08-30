# Phase4 歌词拆行：同戳 N 行通用化 + 多语言检测扩展

> 前端 `src/lib/lyricLines.ts` 已同步改完（`splitLrcToVersions` / `detectLang` / `LYRIC_LANG_OPTIONS`）。
> 本 MD 为 SQL 侧变更，确认后再生成 `.sql` 执行。

## 背景

- 现行 `rebuild_song_lyric_lines` 对同戳多行只写了 2 行 / 3 行两个特判分支，>3 行全部判回原文并存疑。
- 前端已按「同戳 N 行：第 1 行 = 原文，第 2~N 行 = 译文，语言按各行检测，检测错由用户手动改」通用化，SQL 侧需对齐，否则审核编辑/触发器重建时会把用户手动调好的多语言版本打回原状。
- 语言检测新增：泰语（th）、老挝语（lo）、藏语（bo）、蒙语（mn）、缅甸语（my）、高棉语（km）、印地语（hi）、阿拉伯语（ar）、希伯来语（he）、希腊语（el）、俄语（ru）——独立文字系统均可自动检测；拉丁字母语言（法/德/西/越/印尼等）无法与英语自动区分，只能手动选（前端下拉已全量提供，常用顺序：中英日粤韩在前）。

## 变更点

1. `lyric_lang_detect`：新增 11 个独立文字系统分支，判定顺序：假名 → 谚文 → 泰文 → 老挝文 → 藏文 → 蒙文 → 缅甸文 → 高棉文 → 天城文 → 阿拉伯文 → 希伯来文 → 希腊文 → 西里尔 → 汉字 → 拉丁 → 未知。
2. `rebuild_song_lyric_lines` 第三遍重写为「歌级结构判定 + N 行通用」：
   - 歌级判定（满足任一即翻译歌，多行组 = 同戳 ≥2 个非空文本行）：① 多行组 ≥ 3 且语言互异组占比 ≥ 50%（真多语翻译）；② 多行组 ≥ 3 且多行组占全部时间戳组比例 ≥ 60%（同文字系统对译，如粤→普、意→英——`lyric_lang_detect` 分不出粤语/中文，靠「整首歌成对」的结构信号判定）。注解堆叠（`[00:00.00]作词:XX / [00:00.00]作曲:XX`）只出现在歌头，两个条件都不满足；间奏的大量单行组不参与判定；
   - 翻译歌：组内非空行按行序拆，第 1 行 `original`，第 2~N 行 `translation`（同语言组也拆，如 Hello→Hello、粤→普，语言标注由用户手动修正）；每行语言 = `lyric_lang_detect`，`latin` → `en`，`unknown` → primary_lang；
   - 空文本行（间奏清屏点）不参与判定与拆分，恒为 `original`；
   - 非翻译歌：多行组视为注解堆叠，全归 `original(primary)` + `multi_same_ts` 存疑人工处理（空文本行不存疑）——与投稿注意事项第 2 条语义一致；
   - 删除原「第三遍前三位置众数统计」（posLang/threePosClear）与 2/3 行特判。
3. 行为变化（有意为之）：
   - 同戳 >3 行且属于翻译歌：从「全判原文 + 存疑」变为正常按位置拆分；
   - 翻译歌内个别同语言组（Hello→Hello）：正常拆分不存疑，语言撞车由用户改标注；
   - 同文字系统对译歌（粤→普等）：从「语言全同判非翻译歌、全存疑」变为按成对结构正常拆分；
   - 非翻译歌的注解堆叠：维持「归原文 + 存疑」，不会误拆成译文；
   - 带长间奏的翻译歌（如 ECHO，中段 60 秒单行表情/清屏行）：条件②的分母含间奏单行组，但条件①语言互异可覆盖；纯同语言对译 + 超长间奏（>40% 单行组）的极端组合会漏判为非翻译歌（存疑人工兜底）。

## 步骤 1：语言判定函数

```sql
BEGIN;

-- 判定顺序：假名(含长音) → 谚文 → 泰文 → 老挝文 → 藏文 → 蒙文 → 缅甸文 → 高棉文 → 天城文 → 阿拉伯文 → 希伯来文 → 希腊文 → 西里尔 → 汉字 → 纯拉丁 → 未知
-- 返回 'latin' 表示「纯拉丁字母但无法确定语言」（en/fr/de/罗马音都是拉丁），由调用方决定映射：
--   · original 单行 / primary 统计：latin → en（英文原文合理默认）
--   · 同戳第 2~N 行译文：latin → en（罗马音/法语判英语，用户手动改）
CREATE OR REPLACE FUNCTION public.lyric_lang_detect(p_text text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_text ~ '[ぁ-んァ-ヶー]' THEN 'ja'
    WHEN p_text ~ '[가-힣]' THEN 'ko'
    WHEN p_text ~ '[\u0E00-\u0E7F]' THEN 'th'
    WHEN p_text ~ '[\u0E80-\u0EFF]' THEN 'lo'
    WHEN p_text ~ '[\u0F00-\u0FFF]' THEN 'bo'
    WHEN p_text ~ '[\u1800-\u18AF]' THEN 'mn'
    WHEN p_text ~ '[\u1000-\u109F]' THEN 'my'
    WHEN p_text ~ '[\u1780-\u17FF]' THEN 'km'
    WHEN p_text ~ '[\u0900-\u097F]' THEN 'hi'
    WHEN p_text ~ '[\u0600-\u06FF]' THEN 'ar'
    WHEN p_text ~ '[\u0590-\u05FF]' THEN 'he'
    WHEN p_text ~ '[\u0370-\u03FF]' THEN 'el'
    WHEN p_text ~ '[\u0400-\u04FF]' THEN 'ru'
    WHEN p_text ~ '[一-龥]' THEN 'zh'
    WHEN p_text ~ '[A-Za-z]' THEN 'latin'
    ELSE 'unknown'
  END
$$;

COMMIT;
```

## 步骤 2：拆行主函数（幂等，迁移与触发器复用）

与 phase4-lyric-p1.md 相比仅改：声明区删去 v_lang/v_lang2/v_lang3/v_pos1~3/v_ps/v_line1/v_line2；删「第三遍前」整块；第三遍替换为 N 行通用 UPDATE。其余（第一遍解析、第二遍 primary、第四遍兜底、第五遍 seq 入库）不变。

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
  v_orig_lang text;
  v_is_translation boolean;
  v_multi_cnt int;
  v_diverse_cnt int;
  v_total_cnt int;
  v_grp       record;
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

  -- ── 第三遍前：歌级结构判定（满足任一即翻译歌，多行组 = 同戳 ≥2 个非空文本行）──
  -- ① 多行组 ≥ 3 且语言互异组占比 ≥ 50%（真多语翻译，原文+译文文字系统不同）；
  -- ② 多行组 ≥ 3 且多行组占全部时间戳组比例 ≥ 60%（同文字系统对译，如粤→普、意→英——
  --    lyric_lang_detect 分不出粤语/中文，靠「整首歌成对」的结构信号判定）。
  -- 注解堆叠（[00:00.00]作词 / [00:00.00]作曲）只出现在歌头，占比极低，两个条件都不满足。
  SELECT count(*) FILTER (WHERE t.cnt >= 2),
         count(*) FILTER (WHERE t.cnt >= 2 AND t.langs >= 2),
         count(*)
  INTO v_multi_cnt, v_diverse_cnt, v_total_cnt
  FROM (
    SELECT time_ms,
           count(*) FILTER (WHERE btrim(text) <> '') AS cnt,
           count(DISTINCT CASE WHEN btrim(text) <> '' THEN
                  CASE lyric_lang_detect(text)
                    WHEN 'unknown' THEN v_orig_lang
                    ELSE lyric_lang_detect(text)
                  END
                END) AS langs
    FROM _parsed WHERE time_ms IS NOT NULL
    GROUP BY time_ms
  ) t;
  v_is_translation := (coalesce(v_multi_cnt, 0) >= 3 AND (
    coalesce(v_diverse_cnt, 0) >= 0.5 * coalesce(v_multi_cnt, 0)
    OR coalesce(v_multi_cnt, 0) >= 0.6 * coalesce(v_total_cnt, 0)
  ));

  -- ── 第三遍：同戳组判定（N 行通用）──
  -- 翻译歌：组内非空行按行序拆，第 1 行 original，第 2~N 行 translation；语言按各行 detect（latin→en，unknown→primary）。
  --   同语言组也拆（如 Hello→Hello），语言标注由用户手动修正，不存疑。
  --   空文本行（间奏清屏点）不参与拆分，恒为 original。
  -- 非翻译歌：多行组视为注解堆叠，全归原文 + 存疑人工处理（空文本行不存疑）。
  FOR v_grp IN
    SELECT time_ms AS ts
    FROM _parsed WHERE time_ms IS NOT NULL
    GROUP BY time_ms
    HAVING count(*) FILTER (WHERE btrim(text) <> '') > 1
    ORDER BY time_ms
  LOOP
    IF NOT v_is_translation THEN
      UPDATE _parsed SET lang = v_orig_lang, kind = 'original' WHERE time_ms = v_grp.ts;
      INSERT INTO public.song_lyric_doubts (song_id, line_no, raw_text, reason)
      SELECT p_song_id, line_no, text, 'multi_same_ts' FROM _parsed
      WHERE time_ms = v_grp.ts AND btrim(text) <> '';
    ELSE
      UPDATE _parsed p
      SET lang = CASE sub.det
                   WHEN 'unknown' THEN v_orig_lang
                   WHEN 'latin' THEN 'en'
                   ELSE sub.det
                 END,
          kind = CASE WHEN sub.pos = 1 OR sub.pos IS NULL THEN 'original' ELSE 'translation' END
      FROM (
        SELECT line_no,
               CASE WHEN btrim(text) <> ''
                    THEN row_number() OVER (PARTITION BY (btrim(text) <> '') ORDER BY line_no)
                    ELSE NULL
               END AS pos,
               lyric_lang_detect(text) AS det
        FROM _parsed WHERE time_ms = v_grp.ts
      ) sub
      WHERE p.time_ms = v_grp.ts AND p.line_no = sub.line_no;
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

## 验证

1. 抽查检测：`สวัสดี`→th、`ສະບາຍດີ`→lo、`ཕབ་ལེན་`→bo、`ᠮᠤᠩᠭᠤᠯ`→mn、`မင်္ဂလာပါ`→my、`សួស្តី`→km、`नमस्ते`→hi、`مرحبا`→ar、`שלום`→he、`γεια`→el、`Привет`→ru。
2. 找一首同戳 >3 行的歌词（或临时改 `songs.lrc_text` 造一首）执行 `SELECT public.rebuild_song_lyric_lines('<song_id>')`，查 `song_lyric_lines`：第 1 行 original、其余 translation，语言分布符合各行检测。
3. 重建已有人工校对过的多语言歌曲，确认不再被 2/3 行特判打回原文。

## 步骤 3：存量重刷（可选，按需在 Supabase 控制台单独跑）

> 背景：`trg_song_lyric_rebuild` 触发器**仅 INSERT**（P2 起行表权威、lrc_text 派生，UPDATE 不再触发重拆，否则会反向覆盖行表编辑）。存量歌的 lrc_text 没再变过，行表还是旧逻辑的结果，需直接调函数重拆。
> ⚠️ 重拆是从 lrc_text 全新生成行表，**会覆盖人工校对过的语言标注**；已人工校对多的先评估再跑。
> 重拆同时会清掉该歌旧存疑再按新逻辑重插：旧 `multi_same_ts` 存疑消失（新逻辑不产），`bare_line` 裸行存疑重新生成。

**只刷多语言歌（推荐，旧特判只影响同戳多行的歌）：**

```sql
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT s.id FROM public.songs s
    JOIN public.song_lyric_lines l ON l.song_id = s.id
    GROUP BY s.id, l.time_ms
    HAVING count(*) > 1
  LOOP
    PERFORM public.rebuild_song_lyric_lines(r.id);
  END LOOP;
END $$;
```

**全量刷（对齐 p1 步骤 5c，幂等可重复跑）：**

```sql
DO $$
DECLARE
  r record;
  total int := 0;
BEGIN
  FOR r IN
    SELECT id FROM public.songs
    WHERE status = 'published' AND lrc_text IS NOT NULL AND btrim(lrc_text) <> ''
  LOOP
    total := total + public.rebuild_song_lyric_lines(r.id);
  END LOOP;
  RAISE NOTICE '迁移完成：共 % 行歌词', total;
END $$;
```

> 跑完抽几首多语言歌查 `song_lyric_lines` 确认：同戳第 1 行 original、其余 translation。
