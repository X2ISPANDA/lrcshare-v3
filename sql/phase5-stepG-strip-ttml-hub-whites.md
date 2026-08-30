# Phase5 Step G：剥离 ttml-hub 白板歌（全量回退）

> **目的**：同步脚本曾把 ttml-hub 索引里 ~2686 首歌自动建成白板歌（歌+歌手+专辑+关系全部入库），污染主站。
> 本脚本将其连根拔除：白板歌 → 空壳专辑 → 孤立艺术家，三步全清。
> **不碰的内容**：你自己的歌、手动合并/挂到歌的 TTML 版本、你的艺术家和专辑。

## ⚠️ 执行顺序（重要）

1. **先完成新版 worker.js 部署**（A 阶段改造：取消自动建歌/自动合并路径），否则下一轮同步会把白板歌再建一遍
2. 再跑本脚本
3. 最后手动跑一轮同步（`node scripts/run-ttml-sync.mjs`），全部条目重新进入待确认队列

---

## Step 0：预检

```sql
-- 0.1 白板歌数量（预期 ~2686）
SELECT count(*) FROM songs WHERE origin = 'ttml-hub';

-- 0.2 挂在「非白板歌」上的 hub 版本清单（你手动合并的在这里，清理不会碰它们）
SELECT v.id, v.song_id, s.title, s.origin
FROM lyric_versions v
JOIN songs s ON s.id = v.song_id
WHERE v.source = 'ttml-hub'
  AND s.origin IS DISTINCT FROM 'ttml-hub';
```

## Step 1：删白板歌的歌词版本

```sql
-- 显式先删版本，不依赖 FK 级联行为（预期 ~2686 行）
DELETE FROM lyric_versions
WHERE song_id IN (SELECT id FROM songs WHERE origin = 'ttml-hub');
```

## Step 2：删白板歌本体

```sql
-- 级联清掉 song_contributors 等关系（预期 ~2686 行）
DELETE FROM songs WHERE origin = 'ttml-hub';

-- 防御性清理（预期 0 行）
DELETE FROM song_lyric_lines WHERE song_id NOT IN (SELECT id FROM songs);
```

## Step 3：清空壳专辑（无任何歌曲引用的）

```sql
-- 3.1 预览清单（过目确认全是同步带来的，不含你自己的空专辑）
SELECT al.id, al.name,
  (SELECT count(*) FROM album_contributors ac WHERE ac.album_id = al.id) AS artist_refs
FROM albums al
WHERE NOT EXISTS (SELECT 1 FROM songs s WHERE s.album_id = al.id)
ORDER BY al.name;

-- 3.2 若清单混有你自己的专辑，先记下 id，在下面两处追加 AND id NOT IN ('保留id1', ...)

-- 3.3 清专辑-歌手关系
DELETE FROM album_contributors
WHERE album_id IN (
  SELECT id FROM albums al
  WHERE NOT EXISTS (SELECT 1 FROM songs s WHERE s.album_id = al.id)
);

-- 3.4 删空壳专辑
DELETE FROM albums al
WHERE NOT EXISTS (SELECT 1 FROM songs s WHERE s.album_id = al.id);
```

## Step 4：清孤立艺术家（陈昇这类）

> 必须在 Step 2/3 之后跑，清单才准确。

```sql
-- 4.1 预览清单（预期 ~600 个，人工过目）
SELECT a.id, a.name
FROM artists a
WHERE NOT EXISTS (SELECT 1 FROM song_contributors sc WHERE sc.artist_id = a.id)
  AND NOT EXISTS (SELECT 1 FROM album_contributors ac WHERE ac.artist_id = a.id)
ORDER BY a.name;

-- 4.2 过目确认后删除（预期 ~600 行）
DELETE FROM artists a
WHERE NOT EXISTS (SELECT 1 FROM song_contributors sc WHERE sc.artist_id = a.id)
  AND NOT EXISTS (SELECT 1 FROM album_contributors ac WHERE ac.artist_id = a.id);
```

## Step 5：刷新艺术家身份类型

```sql
SELECT recompute_artist_types();
```

## Step 6：验证

```sql
SELECT (SELECT count(*) FROM songs)  AS songs_total,   -- 应回落到你原有的几百首
       (SELECT count(*) FROM artists) AS artists_total, -- 应回落到 ~400
       (SELECT count(*) FROM albums)  AS albums_total,
       (SELECT count(*) FROM lyric_versions WHERE source = 'ttml-hub') AS hub_versions_kept;
-- hub_versions_kept = 你手动合并的那几首（挂在你自己的歌上，保留）
```

---

## 清理后

1. 跑 `node scripts/run-ttml-sync.mjs`（新版脚本）→ 索引全部条目重新进入待确认队列
2. 后台「TTML Hub 同步管理」逐条处理：
   - **挂到歌** = 合并到已有歌
   - **新建展示** = 库里没有但想展示，确认后才建歌（B 阶段实现）
   - 不处理 = 永远不出现在主站
