# 幽灵 ID 修复：v2 人名遗留建档（ghost-artists-fix）

> 背景：阶段二迁移首次拆解 lyricist/composer/arranger 逗号串，发现 16 处 v2 时代直接写人名的遗留数据。
> 用户已人工处理：Mc Hotdog/大支/168、王波Webber（库中已有王波的档，已手动换 ID）。
> 剩余 9 人数据库无档，本脚本建档 + 置换为 ID。
> 执行日期：____

## ① 建档（9 人）

```sql
BEGIN;

INSERT INTO public.artists (id, name, types, is_show, initial, bio, avatar, urls) VALUES
  ('art_john_lee',     'JOHN LEE',     ARRAY['composer']::text[],  true, 'J', NULL, NULL, NULL),
  ('art_soulspeak',    'Soulspeak',    ARRAY['composer']::text[],  true, 'S',
    'Jeff “Soulspeak” Liang，来自洛杉矶的美籍华裔超级音乐制作人，电子音乐家和DJ，东西方跨界最值得关注的声音。',
    'https://i0.hdslb.com/bfs/openplatform/c1d191cfd2d1496cc229280e64d74e3cdf5afd0f.png',
    jsonb_build_object('netease', 'https://music.163.com/#/artist?id=1135224')),
  ('art_xonthebeat',   'xonthebeat',   ARRAY['composer']::text[],  true, 'X', NULL, NULL, NULL),
  ('art_zay',          'zay',          ARRAY['composer']::text[],  true, 'Z', NULL, NULL, NULL),
  ('art_s_x',          'S-X',          ARRAY['composer','arranger']::text[], true, 'S', NULL, NULL, NULL),
  ('art_johnny_wu',    'Johnny Wu',    ARRAY['arranger']::text[],  true, 'J', NULL, NULL, NULL),
  ('art_laykx_prod',   'Laykx Prod',   ARRAY['arranger']::text[],  true, 'L', NULL, NULL, NULL),
  ('art_wangdi',       '王迪',          ARRAY['arranger']::text[],  true, 'W', NULL, NULL, NULL),
  ('art_tidien_ten',   '梯依恩TeN',     ARRAY['arranger']::text[],  true, 'T',
    '梯依恩 A.K.A TeN
2006年加入跳蛋工廠，創始元老之一 !
也是一位伯樂系的音樂製作人，除了對音樂有 Sense 之外也獨具慧眼他挑選並引薦許多優秀作業員進入跳蛋工廠。
2013 年決定暫離跳蛋工廠加本色音樂，成功的為 頑童MJ116 以及 兄弟本色 在台灣嘻哈圈打下一片江山
2017年，重回跳蛋工廠溫暖懷抱，並擔任艾克斯娛樂旗下擔任品牌行銷總監。',
    'https://i0.hdslb.com/bfs/openplatform/ddd82ca27e1ddc96500df8276468279bfab8224d.png', NULL)
ON CONFLICT (id) DO NOTHING;

COMMIT;
```

> 注：
> - 梯依恩为新建档（`art_tidien_ten`），名字直接用最终名 `梯依恩TeN`——② 置换时字段里的“梯依恩”三字经大小写不敏感匹配**不会**命中（名字已带 TeN 后缀），见 ② 里的特判。
> - soul-speak 同理靠 ② 的 lower() 匹配命中 `Soulspeak`。

## ② 置换：字段中的人名 → 艺术家 ID

```sql
BEGIN;

UPDATE public.songs s
SET lyricist = (
  SELECT coalesce(string_agg(
    CASE
      WHEN EXISTS (SELECT 1 FROM public.artists a WHERE a.id = trim(x)) THEN trim(x)
      WHEN EXISTS (SELECT 1 FROM public.artists a WHERE lower(a.name) = lower(trim(x)))
        THEN (SELECT a2.id FROM public.artists a2 WHERE lower(a2.name) = lower(trim(x)) LIMIT 1)
      WHEN EXISTS (SELECT 1 FROM public.artists a WHERE trim(x) = ANY(coalesce(a.aliases, '{}')))
        THEN (SELECT a3.id FROM public.artists a3 WHERE trim(x) = ANY(coalesce(a3.aliases, '{}')) LIMIT 1)
      ELSE trim(x)
    END, ',' ORDER BY ord), '')
  FROM unnest(string_to_array(coalesce(s.lyricist, ''), ',')) WITH ORDINALITY AS u(x, ord)
  WHERE trim(u.x) <> ''
)
WHERE coalesce(s.lyricist, '') <> '';

UPDATE public.songs s
SET composer = (
  SELECT coalesce(string_agg(
    CASE
      WHEN EXISTS (SELECT 1 FROM public.artists a WHERE a.id = trim(x)) THEN trim(x)
      WHEN EXISTS (SELECT 1 FROM public.artists a WHERE lower(a.name) = lower(trim(x)))
        THEN (SELECT a2.id FROM public.artists a2 WHERE lower(a2.name) = lower(trim(x)) LIMIT 1)
      WHEN EXISTS (SELECT 1 FROM public.artists a WHERE trim(x) = ANY(coalesce(a.aliases, '{}')))
        THEN (SELECT a3.id FROM public.artists a3 WHERE trim(x) = ANY(coalesce(a3.aliases, '{}')) LIMIT 1)
      ELSE trim(x)
    END, ',' ORDER BY ord), '')
  FROM unnest(string_to_array(coalesce(s.composer, ''), ',')) WITH ORDINALITY AS u(x, ord)
  WHERE trim(u.x) <> ''
)
WHERE coalesce(s.composer, '') <> '';

UPDATE public.songs s
SET arranger = (
  SELECT coalesce(string_agg(
    CASE
      WHEN EXISTS (SELECT 1 FROM public.artists a WHERE a.id = trim(x)) THEN trim(x)
      WHEN EXISTS (SELECT 1 FROM public.artists a WHERE lower(a.name) = lower(trim(x)))
        THEN (SELECT a2.id FROM public.artists a2 WHERE lower(a2.name) = lower(trim(x)) LIMIT 1)
      WHEN EXISTS (SELECT 1 FROM public.artists a WHERE trim(x) = ANY(coalesce(a.aliases, '{}')))
        THEN (SELECT a3.id FROM public.artists a3 WHERE trim(x) = ANY(coalesce(a3.aliases, '{}')) LIMIT 1)
      ELSE trim(x)
    END, ',' ORDER BY ord), '')
  FROM unnest(string_to_array(coalesce(s.arranger, ''), ',')) WITH ORDINALITY AS u(x, ord)
  WHERE trim(u.x) <> ''
)
WHERE coalesce(s.arranger, '') <> '';

COMMIT;
```

> 前置：更名艺术家的旧名匹配——① 建档名与字段旧值不一致（`Soulspeak` vs `soul-speak`、`梯依恩TeN` vs `梯依恩`），
> 精确匹配不上，先把旧名挂为别名（同时保留旧名可搜索），② 的别名分支即可命中换 ID。

```sql
UPDATE public.artists
SET aliases = array_append(coalesce(aliases, '{}'), 'soul-speak')
WHERE id = 'art_soulspeak' AND NOT ('soul-speak' = ANY(coalesce(aliases, '{}')));

UPDATE public.artists
SET aliases = array_append(coalesce(aliases, '{}'), '梯依恩')
WHERE id = 'art_tidien_ten' AND NOT ('梯依恩' = ANY(coalesce(aliases, '{}')));
```

## ③ 幽灵清零确认（预期 0 行）

```sql
SELECT 'songs.lyricist' AS src, s.id AS ref, trim(x) AS ghost_id
FROM public.songs s, unnest(string_to_array(coalesce(s.lyricist,''), ',')) x
WHERE trim(x) <> '' AND NOT EXISTS (SELECT 1 FROM public.artists a WHERE a.id = trim(x))
UNION ALL
SELECT 'songs.composer', s.id, trim(x) FROM public.songs s, unnest(string_to_array(coalesce(s.composer,''), ',')) x
WHERE trim(x) <> '' AND NOT EXISTS (SELECT 1 FROM public.artists a WHERE a.id = trim(x))
UNION ALL
SELECT 'songs.arranger', s.id, trim(x) FROM public.songs s, unnest(string_to_array(coalesce(s.arranger,''), ',')) x
WHERE trim(x) <> '' AND NOT EXISTS (SELECT 1 FROM public.artists a WHERE a.id = trim(x))
UNION ALL
SELECT 'songs.artist_ids', s.id, trim(x) FROM public.songs s, unnest(s.artist_ids) x
WHERE trim(x) <> '' AND NOT EXISTS (SELECT 1 FROM public.artists a WHERE a.id = trim(x))
UNION ALL
SELECT 'albums.artist_ids', al.id, trim(x) FROM public.albums al, unnest(al.artist_ids) x
WHERE trim(x) <> '' AND NOT EXISTS (SELECT 1 FROM public.artists a WHERE a.id = trim(x));
```

## ④ 重跑 phase2 ③ 迁移 + ⑤ 验证

置换完成后，**重跑** `phase2-song-contributors.md` 的 ③ 五段 INSERT（幂等，新换入的 ID 会被补进中间表）和 ⑤ 验证（行数等式 + 类型重算零漂移 + 搜索冒烟）。

## 执行记录

| 节 | 结果 | 备注 |
|---|---|---|
| ① 建档 | ☐ 通过 | |
| ② 置换 | ☐ 通过 | |
| ③ 幽灵清零 | ☐ 通过 | 0 行 |
| ④ 重跑迁移+验证 | ☐ 通过 | |
