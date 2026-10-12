-- ============================================================
-- 15 · 歌曲分享「首页推荐位」置顶字段 pinned_until
-- 执行环境：Supabase SQL Editor（PostgreSQL）
-- 用法：整段一次性执行（单事务，任一失败整体回滚；幂等可重跑）。
--
-- 背景（2026-10）：
--   方便站长把贡献者的新歌在首页「随机推荐」卡位设置为限时推荐：
--   * NULL = 未置顶（该位走原有随机逻辑）；
--   * pinned_until > now() = 置顶中，多条时首页大卡每 30s 轮播；
--   * pinned_until <= now() = 已到期，前端直接过滤掉，自动回落随机，
--     无需定时任务，也不删除分享本身（歌曲墙、专辑连播等一切照旧）。
--
-- 安全说明（对照 12 号建表脚本的权限收口，本字段符合最小授权）：
--   * anon 的 SELECT 是表级策略（USING status='approved'），新列随表可读，
--     不需要额外 GRANT；
--   * anon 的 INSERT 走 12 号的列级 GRANT 白名单，pinned_until 不在其中，
--     投稿人无法自行置顶；置顶权仅在站长后台（authenticated/service_role）。
-- ============================================================

-- ★★★ Supabase SQL Editor 直接全选粘贴本文件即可 ★★★
BEGIN;

-- ============ 1. 新增列：首页推荐位置顶截止时间（可空，空=未置顶） ============
ALTER TABLE public.music_shares
  ADD COLUMN IF NOT EXISTS pinned_until timestamptz;

COMMENT ON COLUMN public.music_shares.pinned_until IS
  '首页「新歌推荐」置顶截止时间：NULL/已过期=未置顶（回落随机）；>now()=置顶中，多条按投稿时间轮播。仅站长可设，投稿白名单不含此列';

-- ============ 2. 部分索引：只索引生效中（含未来）的置顶行，供首页/曲库高效过滤 ============
-- 注意：Postgres 不支持在索引谓词里直接 now()（必须是不可变表达式），
--       因此这里只按 NULL 过滤，「是否到期」由前端按当前时间判断；数据量很小。
CREATE INDEX IF NOT EXISTS idx_music_shares_pinned_until
  ON public.music_shares (created_at DESC)
  WHERE status = 'approved' AND pinned_until IS NOT NULL;

COMMIT;  -- ★ 事务结束，以上任一步失败整体回滚 ★

-- ============================================================
-- 验证查询（COMMIT 之后单独执行；执行后把结果贴回核对）
-- ============================================================
-- 1) 列存在且类型正确：预期 pinned_until | timestamp with time zone | nullable
-- SELECT column_name, data_type, is_nullable
-- FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='music_shares' AND column_name='pinned_until';

-- 2) 权限红线：预期 anon 对该列无 INSERT 权限（postgres 只认显式列级授权，pinned_until 必须不在白名单）
-- SELECT has_column_privilege('anon', 'public.music_shares', 'pinned_until', 'SELECT') AS anon_can_select,   -- 预期 true
--        has_column_privilege('anon', 'public.music_shares', 'pinned_until', 'INSERT') AS anon_can_insert;   -- 预期 false

-- 3) 当前置顶清单（执行完后台设置后核对用）
-- SELECT title, pinned_until, pinned_until > now() AS active
-- FROM public.music_shares
-- WHERE pinned_until IS NOT NULL
-- ORDER BY pinned_until DESC;
