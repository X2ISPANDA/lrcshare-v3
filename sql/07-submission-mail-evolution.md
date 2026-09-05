# 07 · 投稿流程与邮件通知演进（批次投稿 + 发信日志）

> 合并自：add-submission-batch.sql.md（submissions 批次/发布产物字段）、
> phase9-mail-log.md（mail_logs 发信日志表）（全部已执行，2026-08 ~ 09；
> 完整执行版 SQL 见 git 历史原文件）

## 一句话现状

批量投稿（投稿页「批量」模式）作为**一次投稿动作**：`submissions` 记 `batch_id /
batch_size / published_refs`，后台按批折叠审核、邮件按批合并通知；每次发信请求落
`mail_logs` 表（pending/sent/failed/skipped + 失败原因），pg_cron 每周日凌晨自动
清理 14 天前日志。

## 出发点

1. **批量投稿需要批次维度**：一次上传多个 LRC 被视为一次投稿动作，后台按批次
   折叠展示与审核、邮件按批合并通知——需要把「同批」信息记进 submissions。
2. **测试/误发布需要级联回收**：发布链把本次新建的实体 ID 记入 `published_refs`，
   删除已通过投稿时按引用检查回收，避免污染 artists/albums/songs/contributors。
3. **mailer 是 fire-and-forget**：发成功还是失败无迹可寻，丢信排查无据可查。

## 一、submissions 批次字段（add-submission-batch）

```sql
ALTER TABLE submissions
  ADD COLUMN IF NOT EXISTS batch_id text,        -- 批次 ID（UUID）：同批共用；单曲投稿为 NULL
  ADD COLUMN IF NOT EXISTS batch_size int,      -- 批内投稿总数（冗余存于批内每行）
  ADD COLUMN IF EXISTS published_refs jsonb;
  -- 发布产物：{song_id, album_id, artist_ids[], contributor_id}
  -- 发布链新建的实体 ID，删除已通过投稿时按引用检查级联回收

CREATE INDEX IF NOT EXISTS idx_submissions_batch_id
  ON submissions (batch_id) WHERE batch_id IS NOT NULL;  -- 待审核列表按批分组查询
```

- **存量数据无需迁移**：`batch_id` 为 NULL 的旧行自然按「单曲投稿」语义逐首处理。
- 回滚 = DROP 三列一索引（列可空、无依赖）。

## 二、发信日志 mail_logs（phase9-mail-log）

### 表结构（现行，DDL 备查）

```sql
CREATE TABLE public.mail_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  action      text NOT NULL,            -- notify / approve / reject / batch / test
  to_email    text NOT NULL,
  subject     text,
  song_title  text,
  user_name   text,
  status      text NOT NULL DEFAULT 'pending',  -- pending / sent / failed / skipped
  error       text,                     -- 失败时存 humanizeMailError 结果
  created_at  timestamptz NOT NULL DEFAULT now()
);
```

### 权限模型

| 角色 | 权限 | 用途 |
|---|---|---|
| authenticated | RLS 只读（SELECT 策略） | 后台发信日志页展示 |
| service_role | RLS 全权（ALL 策略） | Netlify mailer.mjs 进程写 pending/sent/failed/skipped |
| anon | **硬拒**（REVOKE GRANT，连表都不该碰——纵深防御） | 无 |

```sql
-- pg_cron：每周日凌晨 3:05 删 14 天前日志（保留最新两周）
-- cron.schedule 按名字注册自带覆盖语义：同名任务存在时更新而非重复创建，可重复执行
select cron.schedule('cleanup-mail-logs', '5 3 * * 0',
  $$ delete from public.mail_logs where created_at < now() - interval '14 days' $$);
```

**部署顺序**：先跑 SQL，再部署 mailer.mjs——mailer 写日志需要表和策略就位。

## 踩过的坑

| 坑 | 教训 |
|---|---|
| `has_table_privilege` 验证权限返回 true 就以为安全 | 它只查 GRANT 层（Supabase 默认三角色全授，true 是正常的），**完全不反映 RLS**。验证 RLS 要查 `pg_class.relrowsecurity` / `pg_policies`；金标准是拿 anon key curl 实测 |
| cron 任务重建时先 `cron.unschedule` 报 `could not find valid entry for job` | 任务不存在时 unschedule 直接报错；`cron.schedule` 本身就是覆盖语义，不需要先 unschedule |
| GRANT 层给 authenticated 授了 INSERT 是不是漏洞 | **表有 RLS，GRANT 层 true 无所谓**（Supabase 设计哲学：GRANT 放开、RLS 兜底，INSERT 找不到放行策略即被拒）。对比：**函数没有 RLS 这种东西，EXECUTE 权限就是唯一防线**——所以 phase8 的 `admin_search_songs` 必须 REVOKE，那是真漏洞（见 09） |
| 发信失败想查原因时无迹可寻 | 日志是排查的前提——每次发信请求（含 skipped）都落表，error 存人话版（humanizeMailError） |

## 权限验证（正确工具）

```sql
-- ① RLS 已启用（relrowsecurity 应为 true）
select relname, relrowsecurity from pg_class where relname = 'mail_logs';
-- ② 策略列表应恰好两行（mail_logs_authenticated_select / mail_logs_service_role_all）
select policyname, cmd from pg_policies where tablename = 'mail_logs';
-- ③ cron 任务已注册（active 应为 true）
select jobid, jobname, active from cron.job where jobname = 'cleanup-mail-logs';
```

金标准（anon key 实测）：预期 `permission denied for table mail_logs`
（GRANT 已收）或空数组 `[]`（RLS 过滤成零行）——两者都说明 anon 拿不到数据。

## 执行记录

| 步 | 结果 | 备注 |
|---|---|---|
| submissions 加批次/发布产物三列 + 索引 | ✅ | 存量 NULL 行按单曲投稿语义兼容 |
| mail_logs 建表 + RLS + 索引 | ✅ | 先 SQL 后部署 mailer.mjs |
| pg_cron 两周自动清理 | ✅ | 覆盖语义注册，无需 unschedule |
