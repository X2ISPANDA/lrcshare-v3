-- ============================================================
-- 16 · 歌曲分享投稿「联系方式是否公开」意愿字段 submitter_public_contact
-- 执行环境：Supabase SQL Editor（PostgreSQL）
-- 用法：整段一次性执行（单事务，任一失败整体回滚；幂等可重跑）。
--
-- 背景（2026-10）：
--   与歌词投稿链路对齐：投稿人在歌曲分享投稿页自行勾选是否公开联系方式，
--   意愿随投稿记录保存；站长审核通过且因此「新建」贡献者账号时，
--   系统按该意愿写入 contributors.public_contact（站长审核界面不展示此字段）。
--   绑定已有贡献者时不覆盖其既有公开设置；投稿人勾错可自行提交资料更新，
--   或由站长在贡献者管理中修改。
--
-- 字段语义：
--   * false（默认）= 不公开，联系方式仅站长在审核时可见；
--   * true        = 审核通过并新建贡献者后，联系方式展示在音乐人主页/自荐卡片。
--   历史行一律 false（不洗数据）。
--
-- 安全说明（对照 12/13 号脚本的列级白名单）：
--   * 列级 GRANT 为并集：本次仅把新列追加进 anon 的 INSERT 白名单，
--     不影响 12/13 号既有列授权（重复执行安全）；
--   * anon 的 SELECT 是表级 RLS（USING status='approved'）。该列随表可读，
--     但前台查询不引用它，仅后台审核弹窗回填使用，无敏感信息（只是布尔意愿）。
-- ============================================================

-- ★★★ Supabase SQL Editor 直接全选粘贴本文件即可 ★★★
BEGIN;

-- ============ 1. 新增列：投稿人是否申请公开联系方式（历史行默认 false） ============
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'music_shares'
      AND column_name = 'submitter_public_contact'
  ) THEN
    ALTER TABLE public.music_shares
      ADD COLUMN submitter_public_contact boolean NOT NULL DEFAULT false;
  END IF;
END $$;

COMMENT ON COLUMN public.music_shares.submitter_public_contact IS
  '投稿人勾选的联系方式公开意愿：false=仅站长可见（默认）；true=审核通过新建贡献者时按此写入 contributors.public_contact。绑定已有贡献者不覆盖其设置';

-- ============ 2. anon INSERT 白名单追加该列（列级 GRANT 为并集，幂等安全） ============
GRANT INSERT (submitter_public_contact)
  ON public.music_shares TO anon;

COMMIT;  -- ★ 事务结束，以上任一步失败整体回滚 ★

-- ============================================================
-- 验证查询（COMMIT 之后单独执行；执行后把结果贴回核对）
-- ============================================================
-- 1) 列存在且类型/默认值正确：预期 submitter_public_contact | boolean | NO | false
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='music_shares' AND column_name='submitter_public_contact';

-- 2) anon 对新列同时具备 INSERT（投稿写入）与 SELECT（后台列表 * 带出）
-- SELECT has_column_privilege('anon', 'public.music_shares', 'submitter_public_contact', 'INSERT') AS anon_can_insert,  -- 预期 true
--        has_column_privilege('anon', 'public.music_shares', 'submitter_public_contact', 'SELECT') AS anon_can_select; -- 预期 true

-- 3) 历史行默认值核对：预期全部 false
-- SELECT count(*) AS total,
--        count(*) FILTER (WHERE submitter_public_contact) AS want_public
-- FROM public.music_shares;
