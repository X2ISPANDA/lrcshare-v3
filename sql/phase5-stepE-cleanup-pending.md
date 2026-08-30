# phase5 阶段 E 补充：清理待确认队列陈旧记录

## 背景

首次 dry-run 把索引全部 2750 首都写入了 `ttml_hub_pending`（设计为观察用）。随后正式同步合并/建歌 2687 首，但这 2687 条队列记录未清理，仍是 `resolution=NULL`，导致后台「待确认队列」显示 2750（真实待确认仅 63）。

同步脚本已修复（合并/建歌成功后轮末清理对应记录），但 manifest 未变时同步 304 短路，存量噪音需本次 SQL 手动清一次。

## SQL

```sql
-- 清理陈旧待确认记录：TTML 版本已导入（external_id 命中）且尚未人工处理的队列行
DELETE FROM public.ttml_hub_pending p
WHERE p.resolution IS NULL
  AND EXISTS (
    SELECT 1 FROM public.lyric_versions v
    WHERE v.external_id = p.id
      AND v.source = 'ttml-hub'
  );
```

## 预期结果

- 删除约 **2687** 行（dry-run 遗留噪音）
- 保留 **63** 行真实待确认（`external_id` 未命中 = 未导入）
- 已人工处理（`resolution` 非 NULL）的行一律不动

## 验证

```sql
SELECT count(*) FROM public.ttml_hub_pending WHERE resolution IS NULL;  -- 预期 63
```
