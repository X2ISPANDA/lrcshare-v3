# 批次 2 补充：get_artist_songs RPC（前台艺术家作品页）

> phase2 A 段的补充函数。幂等（CREATE OR REPLACE），可随时执行。
> 前台 `api.getArtistSongs` 从「两次全表查询 + ilike 模糊匹配旧列」改为调用本函数。
> 双源：中间表 ∪ 旧列（与 A 段其他函数同哲学），B 段删列后自动只剩中间表一路。
>
> 显式列清单（项目硬约束：RPC 禁止 SELECT *；unlock_code 不出现）。
> 排序与原前端实现一致：created_at 降序。

```sql
BEGIN;

DROP FUNCTION IF EXISTS public.get_artist_songs(text);
CREATE FUNCTION public.get_artist_songs(p_artist_id text)
RETURNS TABLE (
  id           text,
  title        text,
  aliases      text[],
  artist_ids   text[],
  album_id     text,
  lyricist     text,
  composer     text,
  arranger     text,
  duration     text,
  track        integer,
  disc         integer,
  status       text,
  is_hidden    boolean,
  description  text,
  genres       text[],
  lrc_text     text,
  lyrics_text  text,
  video_url    text,
  cover        text,
  contributor_id text,
  created_at   timestamptz,
  albums       jsonb,
  roles        text[]
)
LANGUAGE sql STABLE
SET search_path = public
AS $function$
  select s.id, s.title, s.aliases, s.artist_ids, s.album_id, s.lyricist, s.composer, s.arranger,
         s.duration, s.track, s.disc, s.status, s.is_hidden, s.description, s.genres,
         s.lrc_text, s.lyrics_text, s.video_url, s.cover, s.contributor_id, s.created_at,
         to_jsonb(al) as albums,
         -- 该艺术家在这首歌担任的角色（双源并集：中间表 ∪ 旧列四路）
         array(
           select distinct r from (
             select sc.role as r from public.song_contributors sc
             where sc.song_id = s.id and sc.artist_id = p_artist_id
             union
             select 'singer' where p_artist_id = any (s.artist_ids)
             union
             select 'lyricist' where p_artist_id = any (string_to_array(coalesce(s.lyricist, ''), ','))
             union
             select 'composer' where p_artist_id = any (string_to_array(coalesce(s.composer, ''), ','))
             union
             select 'arranger' where p_artist_id = any (string_to_array(coalesce(s.arranger, ''), ','))
           ) x where r is not null
         ) as roles
  from public.songs s
  left join public.albums al on al.id = s.album_id
  where s.status = 'published'
    and (
      -- 双源：中间表任意角色命中 ∪ 旧列四路命中
      exists (select 1 from public.song_contributors sc
              where sc.song_id = s.id and sc.artist_id = p_artist_id)
      or p_artist_id = any (s.artist_ids)
      or p_artist_id = any (string_to_array(coalesce(s.lyricist, ''), ','))
      or p_artist_id = any (string_to_array(coalesce(s.composer, ''), ','))
      or p_artist_id = any (string_to_array(coalesce(s.arranger, ''), ','))
    )
  order by s.created_at desc
$function$;

GRANT EXECUTE ON FUNCTION public.get_artist_songs(text) TO anon, authenticated;

COMMIT;
```

## 验证

```sql
-- 与旧前端行为对比：同一艺术家的作品数应一致（双源并集）
SELECT count(*) FROM public.get_artist_songs('art_mchotdog');

-- 冒烟：返回行应含 albums JSONB 且无 unlock_code 列
SELECT id, title, albums->>'name' AS album_name FROM public.get_artist_songs('art_mchotdog') LIMIT 3;
```
