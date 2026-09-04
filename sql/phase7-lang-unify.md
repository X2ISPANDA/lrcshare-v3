# Phase 7：语言码统一（繁体归并 zh-Hant + 音译轨拉丁化标准化）

> 背景：
> 1. **繁体细分标签下游读不到**：AMLL 等播放器对 `xml:lang` 做**精确字符串匹配**
>    （`translations.find(t => t.language === options.translationLanguage)`，默认请求 `zh-Hans`/`zh-Hant`
>    这种 Apple 标准粗标签），`zh-Hant-HK`/`zh-Hant-TW`/`yue` 会直接 miss。open-api 的 BCP47
>    层级匹配只对 JSON 接口客户端有效，吃 TTML 的播放器兜不住。
> 2. **粤语正文统一 zh-Hant**：Apple 生态粤语 TTML 正文即标 `zh-Hant`；粤语身份由 Cantopop
>    曲风与粤拼音译轨 `zh-Latn-jyutping` 承载。
> 3. **音译轨错标修正**：`<transliteration xml:lang="yue">` 应为 `zh-Latn-jyutping`
>    （音译轨必须是 BCP47 拉丁化方案标签，en/yue 等自然语言码语义错误）。
>
> 代码侧已同步：下拉选项移除 yue/zh-Hant-HK/zh-Hant-TW；音译轨单独使用
> TRANSLIT_LANG_OPTIONS（zh-Latn-pinyin / zh-Latn-jyutping / ja-Latn / ko-Latn）；
> 解析端对音译轨自然语言错标自动纠错；shared/lang.mjs 归一目标统一 zh-Hant。

---

## ① 先查影响范围（执行前核对）

```sql
-- 行表：待修正的 lang 分布（按 kind 分语境）
SELECT kind, lang, count(*)
FROM public.song_lyric_lines
WHERE lang IN ('yue','zh-Hant-HK','zh-HK','zh-Hant-MO','zh-MO','zh-Hant-TW','zh-TW',
               'zh','zh-Hans','zh-CN','zh-SG','ja','ko')
GROUP BY kind, lang ORDER BY kind, lang;

-- TTML 原文：含待修标签的版本数
SELECT count(*) FROM public.lyric_versions
WHERE format = 'ttml' AND ttml_text ~* 'xml:lang="(yue|zh-hant-hk|zh-hk|zh-hant-mo|zh-mo|zh-hant-tw|zh-tw)"';

-- 存疑表已处理结果里的旧码（应为 0 或极少）
SELECT resolved_kind, resolved_lang, count(*) FROM public.song_lyric_doubts
WHERE resolved_lang IN ('yue','zh-Hant-HK','zh-HK','zh-Hant-TW','zh-TW','zh','ja','ko')
GROUP BY 1,2;
```

## ② 执行迁移（整段粘贴；幂等，可重跑）

```sql
-- ═══ 1. 行表 song_lyric_lines ═══
-- 1a. 音译轨（kind='romanization'）：自然语言错标 → BCP47 拉丁化方案
UPDATE public.song_lyric_lines SET lang = 'zh-Latn-jyutping'
WHERE kind = 'romanization' AND lang = 'yue';
UPDATE public.song_lyric_lines SET lang = 'zh-Latn-pinyin'
WHERE kind = 'romanization' AND lang IN ('zh','zh-Hans','zh-CN','zh-SG');
UPDATE public.song_lyric_lines SET lang = 'ja-Latn'
WHERE kind = 'romanization' AND lang = 'ja';
UPDATE public.song_lyric_lines SET lang = 'ko-Latn'
WHERE kind = 'romanization' AND lang = 'ko';
-- 注：音译轨 lang='zh-Hant' 不自动纠（粤拼/拼音有歧义），需人工在后台编辑器手选

-- 1b. 原文/译文轨：粤语/繁体地区变体统一 zh-Hant
UPDATE public.song_lyric_lines
SET lang = 'zh-Hant'
WHERE kind IN ('original','translation')
  AND lang IN ('yue','zh-Hant-HK','zh-HK','zh-Hant-MO','zh-MO','zh-Hant-TW','zh-TW');

-- ═══ 2. lyric_versions.langs 摘要 ═══
-- 2a. lrc/enhanced 版本：langs 直接从修正后的行表重新聚合（与行表保证一致）
UPDATE public.lyric_versions lv
SET langs = sub.langs
FROM (
  SELECT version_id, array_agg(DISTINCT lang ORDER BY lang) AS langs
  FROM public.song_lyric_lines
  WHERE version_id IS NOT NULL
  GROUP BY version_id
) sub
WHERE lv.id = sub.version_id
  AND lv.format IN ('lrc','enhanced');

-- 2b. ttml 版本（行表不落地，langs 为独立摘要）：数组内旧码按正文规则替换
UPDATE public.lyric_versions SET langs = array_replace(langs, 'yue', 'zh-Hant')          WHERE format = 'ttml' AND 'yue' = ANY(langs);
UPDATE public.lyric_versions SET langs = array_replace(langs, 'zh-Hant-HK', 'zh-Hant')   WHERE format = 'ttml' AND 'zh-Hant-HK' = ANY(langs);
UPDATE public.lyric_versions SET langs = array_replace(langs, 'zh-HK', 'zh-Hant')        WHERE format = 'ttml' AND 'zh-HK' = ANY(langs);
UPDATE public.lyric_versions SET langs = array_replace(langs, 'zh-Hant-MO', 'zh-Hant')   WHERE format = 'ttml' AND 'zh-Hant-MO' = ANY(langs);
UPDATE public.lyric_versions SET langs = array_replace(langs, 'zh-MO', 'zh-Hant')        WHERE format = 'ttml' AND 'zh-MO' = ANY(langs);
UPDATE public.lyric_versions SET langs = array_replace(langs, 'zh-Hant-TW', 'zh-Hant')   WHERE format = 'ttml' AND 'zh-Hant-TW' = ANY(langs);
UPDATE public.lyric_versions SET langs = array_replace(langs, 'zh-TW', 'zh-Hant')        WHERE format = 'ttml' AND 'zh-TW' = ANY(langs);

-- ═══ 3. 存疑表已处理结果（resolved_kind 区分语境）═══
UPDATE public.song_lyric_doubts SET resolved_lang = 'zh-Latn-jyutping'
WHERE resolved_kind = 'romanization' AND resolved_lang = 'yue';
UPDATE public.song_lyric_doubts SET resolved_lang = 'zh-Latn-pinyin'
WHERE resolved_kind = 'romanization' AND resolved_lang IN ('zh','zh-Hans','zh-CN','zh-SG');
UPDATE public.song_lyric_doubts SET resolved_lang = 'ja-Latn'
WHERE resolved_kind = 'romanization' AND resolved_lang = 'ja';
UPDATE public.song_lyric_doubts SET resolved_lang = 'ko-Latn'
WHERE resolved_kind = 'romanization' AND resolved_lang = 'ko';
UPDATE public.song_lyric_doubts SET resolved_lang = 'zh-Hant'
WHERE resolved_kind <> 'romanization'
  AND resolved_lang IN ('yue','zh-Hant-HK','zh-HK','zh-Hant-MO','zh-MO','zh-Hant-TW','zh-TW');

-- ═══ 4. TTML 原文 ttml_text 内 xml:lang 修正 ═══
-- 嵌套调用最内层最先执行：先修 <transliteration> 标签 → 再修行内 x-roman span
-- （role/lang 两种属性顺序）→ 最后兜底把其余位置（body/div/p/tt/<translation>）旧码归 zh-Hant。
-- regexp 大小写不敏感、只匹配双引号（项目 composeTtml 输出双引号）；只替换匹配片段，标签其余部分保留。
UPDATE public.lyric_versions
SET ttml_text =
  regexp_replace(
  regexp_replace(
  regexp_replace(
  regexp_replace(
  regexp_replace(
  regexp_replace(
  regexp_replace(
  regexp_replace(
  regexp_replace(
  regexp_replace(
  regexp_replace(
  regexp_replace(
  regexp_replace(
    ttml_text,
    '(<transliteration\b[^>]*?xml:lang=")yue(")', '\1zh-Latn-jyutping\2', 'gi'),
  '(<transliteration\b[^>]*?xml:lang=")(zh|zh-Hans|zh-CN|zh-SG)(")', '\1zh-Latn-pinyin\3', 'gi'),
  '(<transliteration\b[^>]*?xml:lang=")ja(")', '\1ja-Latn\2', 'gi'),
  '(<transliteration\b[^>]*?xml:lang=")ko(")', '\1ko-Latn\2', 'gi'),
  '(<span\b[^>]*?xml:lang=")yue("([^>]*?x-roman))', '\1zh-Latn-jyutping\2', 'gi'),
  '(<span\b[^>]*?x-roman[^>]*?xml:lang=")yue(")', '\1zh-Latn-jyutping\2', 'gi'),
  '(<span\b[^>]*?xml:lang=")(zh|zh-Hans|zh-CN|zh-SG)("([^>]*?x-roman))', '\1zh-Latn-pinyin\3', 'gi'),
  '(<span\b[^>]*?x-roman[^>]*?xml:lang=")(zh|zh-Hans|zh-CN|zh-SG)(")', '\1zh-Latn-pinyin\3', 'gi'),
  '(<span\b[^>]*?xml:lang=")ko("([^>]*?x-roman))', '\1ko-Latn\2', 'gi'),
  '(<span\b[^>]*?x-roman[^>]*?xml:lang=")ko(")', '\1ko-Latn\2', 'gi'),
  '(<span\b[^>]*?xml:lang=")ja("([^>]*?x-roman))', '\1ja-Latn\2', 'gi'),
  '(<span\b[^>]*?x-roman[^>]*?xml:lang=")ja(")', '\1ja-Latn\2', 'gi'),
  'xml:lang="(yue|zh-Hant-HK|zh-HK|zh-Hant-MO|zh-MO|zh-Hant-TW|zh-TW)"', 'xml:lang="zh-Hant"', 'gi')
WHERE format = 'ttml'
  AND ttml_text ~* 'xml:lang="(yue|zh-hant-hk|zh-hk|zh-hant-mo|zh-mo|zh-hant-tw|zh-tw|zh"|zh-hans"|zh-cn"|zh-sg"|ja"|ko")';
```

## ③ 验证（迁移后跑，应全部返回 0 / 无旧码）

```sql
-- 行表旧码残留（zh-Hant 繁体为正常值；romanization 语境不应再有自然语言码）
SELECT kind, lang, count(*) FROM public.song_lyric_lines
WHERE lang IN ('yue','zh-Hant-HK','zh-HK','zh-Hant-MO','zh-MO','zh-Hant-TW','zh-TW')
   OR (kind = 'romanization' AND lang IN ('zh','zh-Hans','ja','ko','en','yue'))
GROUP BY 1,2;

-- TTML 原文旧码残留
SELECT count(*) FROM public.lyric_versions
WHERE format = 'ttml' AND ttml_text ~* 'xml:lang="(yue|zh-hant-hk|zh-hk|zh-hant-mo|zh-mo|zh-hant-tw|zh-tw)"';

-- 音译标签抽查：transliteration 上应为 *-Latn-* 标签
SELECT count(*) AS translit_yue_bad FROM public.lyric_versions
WHERE format = 'ttml' AND ttml_text ~* '<transliteration[^>]*xml:lang="(yue|zh"|ja"|ko")';
```

## 回滚

语言码迁移为单向标准化（旧码是新码的子集语义），**无需回滚**。若迁移后发现个别歌曲
音译轨语言判断错误（如繁体国语歌的音译被误判），在后台歌词编辑器音译表格手选正确方案
（下拉仅 4 项：拼音/粤拼/日罗/韩罗）后保存即可。

## 上线顺序

1. **先执行本 SQL**；
2. 发布前端（下拉分流 + 解析纠错）；
3. open-api 在 `cloudflare/` 目录 `npx wrangler deploy`（shared/lang.mjs 归一规则变更）；
4. CF 边缘缓存自然过期（歌词响应缓存 TTL 内旧内容仍带旧标签，过期后刷新）。
