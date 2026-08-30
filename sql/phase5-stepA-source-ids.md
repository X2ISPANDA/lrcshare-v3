# Phase5 阶段 A：songs 加 source_ids / origin 列（phase5-stepA）

> 依据：`sql/phase5-lyric-versions-ttml-hub.md` 第八节阶段 A。
> 执行日期：____（执行后填写）
> 性质：**纯加列，零代码影响**——现有 API/RPC/前端不感知新列，可立即执行。
>
> ⚠️ 执行前提：本次包含 `search_songs` / `search_songs_structured` 两个 `RETURNS SETOF songs`
> 函数的重建（补新列占位）。脚本以 `search-recall-two-stage.md`（两段式召回，当前线上版本）
> 的函数体为基准。**若两段式召回之后数据库里还有人工改动过这两个函数，请先告知，勿直接执行。**

## 为什么必须重建这两个函数

`RETURNS SETOF songs` 要求函数输出列与 songs 表**列数一致、位置对齐**。songs 加列后，
函数体内显式列清单（以 `null::text as search_text` 结尾）比表少 2 列，查询会报
「return type mismatch」。按项目纪律补 `null::jsonb as source_ids, null::text as origin`
占位（新列追加在表尾，占位按同序追加在 select 清单尾）。

`get_artist_songs` 是 `RETURNS TABLE(...)`（自定义形状），不受影响；其余 RPC 不返回 songs 行类型，不受影响。

## SQL（一个事务，整段复制执行）

```sql
BEGIN;

-- ── 1a. songs.source_ids：平台曲目 ID（与 ttml-hub schema v2 数组语义对齐）──
ALTER TABLE public.songs
  ADD COLUMN source_ids jsonb NOT NULL DEFAULT '{}'::jsonb;
-- 形如 {"appleMusicId":["1411387590"],"qqMusicId":["..."],"ncmMusicId":["..."]}

-- ── 1b. songs.origin：歌本体来源标记（仅删除跟随判断用，展示层不用）──
ALTER TABLE public.songs
  ADD COLUMN origin text NOT NULL DEFAULT 'user'
  CHECK (origin IN ('user','ttml-hub'));

-- ── 2. source_ids 检索索引（平台 ID 精确匹配走 @> 查询）──
CREATE INDEX IF NOT EXISTS songs_source_ids_gin ON public.songs USING gin (source_ids);

-- ── 3. 列级授权：songs 是列级授权表（phase1 基线），新列显式授予 anon
--      （open-api 用 anon key 直查 songs；authenticated 保留表级权限无需处理）──
GRANT SELECT (source_ids, origin) ON public.songs TO anon;

-- ── 4a. search_songs 重建：占位追加（与 search-recall-two-stage.md 第 6 节一字不差，仅补 2 占位）──
CREATE OR REPLACE FUNCTION public.search_songs(p_q text)
RETURNS SETOF songs
LANGUAGE plpgsql
STABLE
AS $function$
      declare
        tokens text[] := array(
          select distinct t from regexp_split_to_table(trim(coalesce(p_q, '')), '\s+') t where t <> ''
        );
        p_lower text := lower(trim(coalesce(p_q, '')));
      begin
        if cardinality(tokens) = 0 then
          return;
        end if;

        return query
        select * from (
          select id, title, album_id, duration, lrc_text, status, created_at, track, contributor_id, lyrics_text, video_url, description, is_hidden, genres, disc, cover, aliases, null::text as search_text, null::jsonb as source_ids, null::text as origin
          from public.songs s
          where s.status = 'published'
            -- ① 召回臂（trgm 索引加速）：search_text 命中任一 token 的候选才进排序层
            and exists (
              select 1 from unnest(tokens) tok
              where lower(s.search_text) like '%' || lower(tok) || '%'
            )
            -- ② 精确复核臂（= 6f 原入围判定，滤掉拼接边界假阳性）
            and exists (
              select 1 from unnest(tokens) tok
              where song_title_hit(s.title, s.aliases, tok)
                 or song_artist_hit(s.id, tok)
            )
          order by
            -- ① 整串连续命中（title/aliases 含完整查询串，strpos 判定）排绝对第一
            (
              select case when strpos(lower(s.title), p_lower) > 0
                            or exists (select 1 from unnest(coalesce(s.aliases, '{}')) a
                                       where strpos(lower(a), p_lower) > 0)
                          then 1 else 0 end
            ) desc,
            -- ② 命中 token 数（已去重）：全命中的排前，部分命中的靠后
            (
              select count(*) from unnest(tokens) tok
              where song_title_hit(s.title, s.aliases, tok)
                 or song_artist_hit(s.id, tok)
            ) desc,
            -- ③ 权重总分（struct_hit 内部即 sum(song_token_weight)）
            struct_hit(s.id, s.title, s.aliases, tokens) desc,
            s.title asc
        ) t;
      end
$function$;

-- ── 4b. search_songs_structured 重建：占位追加（与 search-recall-two-stage.md 第 7 节一字不差，仅补 2 占位）──
CREATE OR REPLACE FUNCTION public.search_songs_structured(p_title text DEFAULT NULL::text, p_artist text DEFAULT NULL::text)
RETURNS SETOF songs
LANGUAGE sql STABLE
AS $function$
      select id, title, album_id, duration, lrc_text, status, created_at, track, contributor_id, lyrics_text, video_url, description, is_hidden, genres, disc, cover, aliases, null::text as search_text, null::jsonb as source_ids, null::text as origin
      from public.songs s
      where s.status = 'published'
        and (
          p_title is null
          or (
            lower(s.search_text) like '%' || lower(btrim(p_title)) || '%'
            and (
              s.title ilike '%' || p_title || '%'
              or exists (select 1 from unnest(coalesce(s.aliases, '{}')) a where a ilike '%' || p_title || '%')
            )
          )
        )
        and (
          p_artist is null
          or (
            lower(s.search_text) like '%' || lower(btrim(p_artist)) || '%'
            and exists (
              select 1
              from public.artists ar
              where ar.is_show is not false
                and (
                  ar.id = any(public.song_performer_ids(s.id))
                  or ar.id in (
                    select ac.artist_id
                    from public.album_contributors ac
                    where ac.album_id = s.album_id
                  )
                )
                and (
                  ar.name ilike '%' || p_artist || '%'
                  or exists (select 1 from unnest(coalesce(ar.aliases, '{}')) al where al ilike '%' || p_artist || '%')
                )
            )
          )
        )
      order by s.title asc
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

**预期结果**：Success, no rows returned。

## 验证清单（执行后逐条过）

```sql
-- 1. 新列存在且默认值正确
SELECT column_name, data_type, column_default
FROM information_schema.columns
WHERE table_name = 'songs' AND column_name IN ('source_ids', 'origin');
-- 预期 2 行：source_ids jsonb '{}'::jsonb；origin text 'user'

-- 2. 搜索 RPC 不报列数错（加列后最容易炸的点）
SELECT count(*) FROM public.search_songs('爱');
SELECT count(*) FROM public.search_songs_structured('爱', NULL);

-- 3. 搜索结果与顺序不变（两段式召回的验收口径抽查）
SELECT id, title FROM public.search_songs('No Money No Friend 阴三儿In3') LIMIT 15;
SELECT id, title FROM public.search_songs('intro') LIMIT 3;
SELECT count(*) FROM public.search_songs('100%');

-- 4. anon 可读新列（用 anon 语义验证：service role 绕过授权测不出来）
--    前台搜一首歌、打开一首歌详情，无 403/42501 即通过

-- 5. CHECK 约束生效
UPDATE public.songs SET origin = 'xxx' WHERE id = (SELECT id FROM public.songs LIMIT 1);
-- 预期报错 check constraint；确认后无需回滚（事务内未生效）
```

## 回滚（如需）

```sql
BEGIN;
DROP INDEX IF EXISTS songs_source_ids_gin;
ALTER TABLE public.songs DROP COLUMN IF EXISTS origin;
ALTER TABLE public.songs DROP COLUMN IF EXISTS source_ids;
-- search_songs / search_songs_structured 回滚 = 重新执行 search-recall-two-stage.md 第 6/7 节
NOTIFY pgrst, 'reload schema';
COMMIT;
```

## 执行后后续阶段

| 阶段 | 状态 |
|---|---|
| B（lyric_versions 建表 + 行表挂 version） | 待出 SQL（需先核对 `song_lyric_lines` 全部读写方）|
| C（API 输出版本 + 投影） | 待 B 部署后 |
| D（投稿侧切版本表） | 待 C 后 |
| E（Workers Cron 同步） | 待 D 后 |
| F（播放页 tab + TTML 渲染升级） | 待 E 后 |
