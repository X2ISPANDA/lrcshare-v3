# 修复 get_top_artists 作品数重复计数

## 问题

首页「艺术家」卡片的作品数（`song_count`）把一位艺术家在一首歌里的多个身份（演唱+作词+作曲+编曲）重复累加——一首歌被计成 2-4 个作品。

根因：现有函数用 `UNION ALL` 四路展开歌曲-艺术家对（演唱/作词/作曲/编曲），同一首歌同一艺术家出现多次全部保留，`COUNT(*)` 全数累计。

## SQL（Supabase SQL Editor 执行）

```sql
CREATE OR REPLACE FUNCTION public.get_top_artists(limit_count integer DEFAULT 6)
RETURNS TABLE(id text, name text, sort integer, avatar text, types text[], disambiguation text, is_show boolean, aliases text[], song_count integer)
LANGUAGE sql
STABLE
AS $function$
  WITH song_artist_pairs AS (
    SELECT s.id AS song_id, unnest(s.artist_ids) AS artist_id
    FROM songs s WHERE s.status = 'published' AND s.artist_ids IS NOT NULL
    UNION  -- 去重：一首歌对一个艺术家只算一次（演唱/作词/作曲/编曲多身份合一）
    SELECT s.id, unnest(string_to_array(s.lyricist, ','))
    FROM songs s WHERE s.lyricist IS NOT NULL AND s.status = 'published'
    UNION
    SELECT s.id, unnest(string_to_array(s.composer, ','))
    FROM songs s WHERE s.composer IS NOT NULL AND s.status = 'published'
    UNION
    SELECT s.id, unnest(string_to_array(s.arranger, ','))
    FROM songs s WHERE s.arranger IS NOT NULL AND s.status = 'published'
  ),
  song_artist_counts AS (
    SELECT artist_id, COUNT(*) AS cnt
    FROM song_artist_pairs
    WHERE artist_id IS NOT NULL AND artist_id <> ''
    GROUP BY artist_id
  )
  SELECT
    a.id, a.name, a.sort, a.avatar, a.types, a.disambiguation, a.is_show, a.aliases,
    COALESCE(c.cnt, 0) AS song_count
  FROM artists a
  LEFT JOIN song_artist_counts c ON c.artist_id = a.id
  WHERE a.is_show IS NOT FALSE
  ORDER BY
    CASE WHEN a.sort > 0 THEN 0 ELSE 1 END,
    CASE WHEN a.sort > 0 THEN a.sort END NULLS LAST,
    COALESCE(c.cnt, 0) DESC,
    a.name ASC
  LIMIT limit_count;
$function$;

-- 保持原有授权（anon 可调，首页 SSG 用）
GRANT EXECUTE ON FUNCTION public.get_top_artists(integer) TO anon, authenticated;
```

## 与原函数的差异（仅两处）

| 项 | 原版 | 修复版 |
| --- | --- | --- |
| 身份展开 | `UNION ALL`（同一首歌同一艺术家多身份重复保留） | `UNION`（按 song_id+artist_id 整行去重，一首歌一个艺术家只留一行） |
| 空串过滤 | 仅 `artist_id IS NOT NULL` | 追加 `artist_id <> ''`（string_to_array 对 "a,,b" 会产生空串，原版靠 join 不上侥幸无害，显式过滤更严谨） |

返回列签名、排序逻辑（置顶优先 → 作品数降序 → 名字升序）、is_show 过滤、limit 语义全部保持不变。

## 验证

1. SQL Editor 直接调用对比：

```sql
select name, song_count from get_top_artists(6);
```

2. 首页「艺术家」栏的作品数应与对应艺术家主页（`/artist/:id` 顶部「N 首作品」）一致。

执行后首页最迟 6 小时（下次定时构建）自动更新，也可在 GitHub Actions 手动 Run workflow 立即刷新。
