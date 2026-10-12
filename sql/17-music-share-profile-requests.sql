-- ============================================================================
-- 17 · 歌曲分享投稿对齐歌词投稿：已有贡献者「更新资料 / 清空资料」动作 + 简介
-- ----------------------------------------------------------------------------
-- 背景：
--   歌词投稿（submissions）早已支持：选中已有贡献者后，投稿人可勾选
--   submitter_request_update（用本次填写全量覆盖资料）或
--   submitter_request_clear（清空该贡献者资料），并可携带 submitter_bio。
--   歌曲分享（music_shares）此前没有这三个字段，导致选了已有账号的音乐人
--   在投稿页填的资料会被后台忽略，前端却没有锁定，造成「每次都要填」的误导。
--
-- 本迁移：
--   music_shares 新增三列：
--     submitter_request_update boolean NOT NULL DEFAULT false
--     submitter_request_clear  boolean NOT NULL DEFAULT false
--     submitter_bio            text
--   并把三列并入 anon 列级 INSERT 白名单（GRANT 为列并集，重复执行安全）。
--   历史行：两个布尔意愿自动为 false，简介为 NULL，不洗数据。
--
-- 幂等：可重复执行（IF NOT EXISTS 守卫 + 注释/授权均可重复）。
-- 回滚：
--   -- REVOKE INSERT(submitter_request_update, submitter_request_clear, submitter_bio)
--   --   ON public.music_shares FROM anon;
--   -- ALTER TABLE public.music_shares
--   --   DROP COLUMN IF EXISTS submitter_request_update,
--   --   DROP COLUMN IF EXISTS submitter_request_clear,
--   --   DROP COLUMN IF EXISTS submitter_bio;
-- ============================================================================

-- ============ 1. 新增三列（幂等） ============
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'music_shares'
      AND column_name = 'submitter_request_update'
  ) THEN
    ALTER TABLE public.music_shares
      ADD COLUMN submitter_request_update boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'music_shares'
      AND column_name = 'submitter_request_clear'
  ) THEN
    ALTER TABLE public.music_shares
      ADD COLUMN submitter_request_clear boolean NOT NULL DEFAULT false;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'music_shares'
      AND column_name = 'submitter_bio'
  ) THEN
    ALTER TABLE public.music_shares
      ADD COLUMN submitter_bio text;
  END IF;
END $$;

-- ============ 2. 列注释（语义与 submissions 同名字段对齐） ============
COMMENT ON COLUMN public.music_shares.submitter_request_update IS
  '投稿人勾选「更新我的信息」：true=审核通过时用本次提交的邮箱/简介/联系方式/公开意愿全量覆盖该贡献者资料；仅当 contributor_id 指向已有贡献者时有意义';
COMMENT ON COLUMN public.music_shares.submitter_request_clear IS
  '投稿人勾选「清空我的信息」：true=审核通过时把该贡献者除 ID/昵称/标签外的资料字段置空；与 request_update 互斥（前端保证，后台双保险）';
COMMENT ON COLUMN public.music_shares.submitter_bio IS
  '投稿快照：本次提交的简介文本。新建贡献者时写入 contributors.bio；勾选更新时一并覆盖；否则不影响已有资料';

-- ============ 3. anon 列级 INSERT 白名单（列 GRANT 为并集，重复执行安全） ============
GRANT INSERT (submitter_request_update, submitter_request_clear, submitter_bio)
  ON public.music_shares TO anon;

-- ============ 4. 验证（执行后应输出 3 行新列；anon_can_insert=true） ============
-- SELECT column_name, data_type, is_nullable, column_default
-- FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='music_shares'
--   AND column_name IN ('submitter_request_update','submitter_request_clear','submitter_bio')
-- ORDER BY column_name;
--
-- SELECT has_column_privilege('anon', 'public.music_shares', 'submitter_request_update', 'INSERT') AS upd_can_insert,
--        has_column_privilege('anon', 'public.music_shares', 'submitter_request_clear',  'INSERT') AS clear_can_insert,
--        has_column_privilege('anon', 'public.music_shares', 'submitter_bio',            'INSERT') AS bio_can_insert;
