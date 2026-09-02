# phase7：歌词版本手动排序（lyric_versions.sort_order）

## 背景

多版本投稿上线后，一首歌可并存多个歌词版本（TTML / 逐字 LRC / 行级 LRC，分属不同贡献者）。
前台歌曲页的「TTML 版本下拉」与「LRC 源下拉」原先按写死规则排序（is_primary → 格式 → 创建时间），
站长无法手动控制展示顺序与默认选中版本。新增 `sort_order` 列，由管理端「歌曲管理 → 版本」弹框维护：

- 排序规则：`sort_order` 升序，NULL 排最后；同值/NULL 之间沿用老规则兜底。
- 新审核通过的投稿版本不写 `sort_order`（NULL → 自动排最后），站长事后调序。
- `is_primary` 不再参与展示排序，仅保留其数据语义（行表默认容器）。

## 迁移 SQL

```sql
-- ═══ 1. 加列 ═══
ALTER TABLE public.lyric_versions
  ADD COLUMN IF NOT EXISTS sort_order int;

-- ═══ 2. 存量回填：按歌分区，沿用老展示规则给 10,20,30…（留间隔） ═══
--   is_primary DESC → 格式（ttml=0 / enhanced=1 / lrc=2）→ 创建时间
WITH ranked AS (
  SELECT id,
         10 * ROW_NUMBER() OVER (
           PARTITION BY song_id
           ORDER BY is_primary DESC,
                    CASE format WHEN 'ttml' THEN 0 WHEN 'enhanced' THEN 1 ELSE 2 END,
                    created_at
         ) AS new_order
  FROM public.lyric_versions
  WHERE status = 'published'
)
UPDATE public.lyric_versions v
SET sort_order = r.new_order
FROM ranked r
WHERE v.id = r.id;

-- ═══ 3. 索引（歌曲页版本列表按歌拉取 + 排序） ═══
CREATE INDEX IF NOT EXISTS lyric_versions_song_sort_idx
  ON public.lyric_versions (song_id, sort_order);
```

## 验证清单

```sql
-- 1. 列已存在且 published 版本全部回填（无 NULL）
SELECT count(*) AS total,
       count(*) FILTER (WHERE sort_order IS NULL) AS null_cnt
FROM public.lyric_versions WHERE status = 'published';
-- 预期：null_cnt = 0

-- 2. 每首歌内部位次唯一且按老规则排列
SELECT song_id, string_agg(format(format, sort_order) , ' | ' ORDER BY sort_order) AS order_chain
FROM public.lyric_versions
WHERE status = 'published'
GROUP BY song_id
HAVING count(*) > 1
LIMIT 10;
```

## 回滚

```sql
DROP INDEX IF EXISTS public.lyric_versions_song_sort_idx;
ALTER TABLE public.lyric_versions DROP COLUMN IF EXISTS sort_order;
```
