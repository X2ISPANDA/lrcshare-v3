# submissions 表新增批次字段（批量投稿按批审核）

> 背景：批量投稿（投稿页「批量」模式，一次上传多个 LRC）被视为**一次投稿动作**，
> 后台按批次折叠展示与审核、邮件按批合并通知。
> 存量数据无需迁移：`batch_id` 为 NULL 的旧行自然按「单曲投稿」语义逐首处理。

## 执行（Supabase SQL Editor）

```sql
-- 1. 加列（可空，兼容存量单曲投稿）
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS batch_id text,
  ADD COLUMN IF NOT EXISTS batch_size int;

-- 2. 索引：待审核列表按批分组查询用
CREATE INDEX IF NOT EXISTS idx_submissions_batch_id
  ON submissions (batch_id)
  WHERE batch_id IS NOT NULL;

-- 3. 注释
COMMENT ON COLUMN submissions.batch_id IS '批次 ID（UUID）：同一次批量投稿共用；单曲投稿为 NULL';
COMMENT ON COLUMN submissions.batch_size IS '批次内投稿总数（冗余存于批内每行）';
```

## 验证

```sql
-- 列已存在且类型正确
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'submissions' AND column_name IN ('batch_id', 'batch_size');
-- 期望：batch_id text / batch_size integer

-- 索引存在
SELECT indexname FROM pg_indexes WHERE tablename = 'submissions' AND indexname = 'idx_submissions_batch_id';
```

## 回滚（如需）

```sql
DROP INDEX IF EXISTS idx_submissions_batch_id;
ALTER TABLE submissions
  DROP COLUMN IF EXISTS batch_id,
  DROP COLUMN IF EXISTS batch_size;
```
