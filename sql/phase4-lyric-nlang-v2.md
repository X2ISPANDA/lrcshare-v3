# Phase4 歌词拆行 v3：成对占比判定 + 创作者信息按行序拆

> 前端 `src/lib/lyricLines.ts` 已同步改完（`splitLrcToVersions` 的「三层过滤 + 成对占比」判定）。
> 本 MD 为 SQL 侧变更，**一个事务直接复制执行**。
> 前置：`lyric_lang_detect`（15 文字系统）已在 phase4-lyric-nlang.md 步骤 1 执行过，无需重跑。

## 背景（相对上一版 phase4-lyric-nlang.md 的第三次迭代）

上一版用「多行组语言互异占比 + 多行组占全部组比例」两个条件判翻译歌，反复踩坑：
- 粤语/普通话、法语/英语同文字系统，语言检测分不出 → 误判非翻译歌；
- 长间奏（`:-)` 单行）稀释占比 → 误判非翻译歌；
- 角色标注行（`Yamy：`/`合：`）被当成多行组 → 误存疑；
- 译文的创作者信息（`Lyrics By:AAA`）被恒归原文 → 丢失翻译语义。

本版改为**「先剔除非歌词行，再只看歌词成对占比」**：

1. 三类「非歌词行」从判定里剔除：空行（清屏点）、纯符号行（间奏 `:-)`）、创作者信息行（`作词/作曲/Lyrics By/Video` 等前缀+冒号）。
2. 剩余「真歌词行」上统计「同戳 ≥2 行」的组占比 ≥ 50% → 翻译歌。
3. 拆分：空行/符号恒归原文；非翻译歌全归原文（**不再存疑**）；翻译歌同戳组内「非空非符号行」按行序拆（第 1 行原文、其余译文），**创作者信息也按行序走**——译文的 `Lyrics By` 跟着译文版本。

## 变更点

- 新增 `lyric_is_credit(text)`：创作者信息行识别（前缀+冒号）。
- `rebuild_song_lyric_lines`：
  - 声明区删 `v_diverse_cnt`（不再需要语言互异统计）；
  - 「第三遍前」改为成对占比判定（剔除空/符号/创作者信息后统计）；
  - 「第三遍」拆分：HAVING 排除纯符号行；非翻译歌归原文**不写存疑**；翻译歌 sub 查询只排除空/符号（不排除创作者信息），按行序拆。

## 步骤 1：SQL（一个事务）

```sql
BEGIN;

-- ── 1. 创作者信息行识别：前缀（词/曲/编/Lyrics/Video 等）+ 冒号 ──
CREATE OR REPLACE FUNCTION public.lyric_is_credit(p_text text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT p_text ~ '^(作词|作詞|词|詞|作曲|曲|编曲|編曲|演唱|歌手|混音|混声|制作人|製作人|制作|製作|监制|監製|和声|和聲|吉他|结他|鼓|贝斯|貝斯|贝司|键盘|鍵盤|录音|錄音|母带|母帶|后期|後期|字幕|翻译|翻譯|校对|校對|时间轴|時間軸|歌词|歌詞|LRC|Lyrics?|Composer|Composed|Music|Arranger|Arranged|Mixed|Mixing|Mastering|Mastered|Produced|Producer|Video|VSQ|Song|Art|feat\.?|by)[[:space:]]*[:：]'
$$;

-- ── 2. 拆行主函数（幂等；仅改声明区 / 第三遍前 / 第三遍，其余与 p1 一致）──
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
  IF NOT FOUND OR v_lrc IS NULL OR btrim(v_lrc) = '' THEN
    DELETE FROM public.song_lyric_lines WHERE song_id = p_song_id;
    DELETE FROM public.song_lyric_doubts WHERE song_id = p_song_id;
    RETURN 0;
  END IF;

  -- 幂等：清空旧行与旧存疑
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
  -- 真歌词行 = 非空 + 非纯符号 + 非创作者信息；统计「同戳 ≥2 个真歌词行」的组占比 ≥ 50% → 翻译歌。
  -- 剔除干扰后翻译歌占比 →100%、注解堆叠占比 →0%，单一阈值即可区分，不依赖语言检测（粤/普、法/英靠成对）。
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
  -- 翻译歌：组内非空非符号行按行序拆（第 1 行原文、其余译文）；创作者信息也按行序走（译文的 Lyrics By 归译文）。
  -- 非翻译歌：全归原文，不存疑（归原文是安全兜底，不再产生 multi_same_ts 噪音）。
  -- 空行/纯符号行不参与拆分，恒为 original。
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

  -- ── 第五遍：分配 seq 并入库 ──
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

REVOKE ALL ON FUNCTION public.rebuild_song_lyric_lines(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rebuild_song_lyric_lines(text) TO authenticated;

COMMIT;
```

## 验证

1. `lyric_is_credit`：`作词:AAA`→t、`Lyrics By:AAA`→t、`Video:XX`→t、`我爱你`→f、`:-)`→f。
2. 造一首翻译歌（`[00:00]作词:AAA / [00:00]Lyrics By:AAA` + 歌词成对）执行 `SELECT public.rebuild_song_lyric_lines('<song_id>')`，查 `song_lyric_lines`：
   - `作词:AAA` → original(zh)、`Lyrics By:AAA` → translation(en)（译文的创作者信息跟着译文）；
   - 歌词第 1 行 original、第 2 行 translation。
3. 造一首单语歌（`[00:00]作词:AAA / [00:00]作曲:BBB` 同戳 + 歌词单行）重拆：全归 original，`song_lyric_doubts` 无 `multi_same_ts`。
4. 带间奏的翻译歌（ECHO 式 `:-)` 单行）重拆：仍判翻译歌，`:-)` 归 original。

## 步骤 2：存量重刷（可选，按需在 Supabase 控制台单独跑）

> 触发器仅 INSERT，存量歌需直接调函数重拆。⚠️ 会覆盖人工校对过的语言标注，评估后再跑。

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

> 跑完抽几首多语言歌查 `song_lyric_lines` 确认：同戳第 1 行 original、其余 translation；`song_lyric_doubts` 不再出现 `multi_same_ts`（新逻辑不产），只有 `bare_line`（裸行）会重新生成。
