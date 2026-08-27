-- 双源等价性验证（修正版）：structured 的 artist 命中路径
-- 对比「song_performer_ids(双源) 命中」vs「旧 artist_ids 命中」的歌曲集合差异，预期 only_* 均为 0
WITH old_hit AS (
  SELECT DISTINCT s.id FROM public.songs s
  WHERE s.status = 'published' AND EXISTS (
    SELECT 1 FROM public.artists ar
    WHERE ar.is_show IS NOT false AND ar.id = ANY(s.artist_ids)
      AND ar.name ILIKE '%a%'
  )
),
new_hit AS (
  SELECT DISTINCT s.id FROM public.songs s
  WHERE s.status = 'published' AND EXISTS (
    SELECT 1 FROM public.artists ar
    WHERE ar.is_show IS NOT false AND ar.id = ANY(public.song_performer_ids(s.id))
      AND ar.name ILIKE '%a%'
  )
)
SELECT
  (SELECT count(*) FROM old_hit) AS old_count,
  (SELECT count(*) FROM new_hit) AS new_count,
  (SELECT count(*) FROM (SELECT id FROM old_hit EXCEPT SELECT id FROM new_hit) x) AS only_in_old,
  (SELECT count(*) FROM (SELECT id FROM new_hit EXCEPT SELECT id FROM old_hit) y) AS only_in_new;
