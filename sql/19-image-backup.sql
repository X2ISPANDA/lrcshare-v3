-- ============================================================================
-- 19-image-backup.sql
-- 全站图片灾备：7 张表新增 8 个 OSS 备份列（随 feat 提交 1e05d47 上线）
--
-- 【归档说明 2026-10-15】
--   本文件在 1e05d47 提交时因操作疏漏为 0 字节（DDL 当时直接在 Supabase 执行，
--   未入库归档）。本文件为事后据以下证据 1:1 重建，仅含可证实的加列 DDL：
--     ① 线上库逐表只读验证（anon REST select 备份列，全部存在且返回字符串）；
--     ② scripts/backup-images.mjs 的 TARGETS（注释明确「与 sql/19 白名单一致」）；
--     ③ src/lib/adminApi.ts 的 IMAGE_BACKUP_COLUMNS；
--     ④ src/lib/supabase.ts 的 IMAGE_FIELD_MAP。
--   settings.image_source 开关行由后台「站点设置」保存时 upsert 自动创建
--   （adminApi.upsertBatch('settings')），不属于本 DDL；其 anon 可读行策略
--   为 settings 表既有的公开键策略（site_name/admin_email/image_source），
--   早于本次功能存在，故本文件不含任何 settings/RLS 语句，避免无证据脑补。
--
-- 列约定：
--   - 全部为可空 text（存 OSS 公网 URL）；未备份时为 NULL，前台拦截器对
--     空备份保留原外链（见 src/lib/supabase.ts swapImageFields）。
--   - 主列 → 备份列映射：
--       albums.cover       → cover_backup
--       artists.avatar     → avatar_backup
--       artists.bg_image   → bg_image_backup
--       songs.cover        → cover_backup
--       contributors.avatar→ avatar_backup
--       articles.cover     → cover_backup
--       friends.avatar     → avatar_backup
--       music_shares.cover_url → cover_url_backup
--   - 存量数据的 URL 回填由 scripts/backup-images.mjs 完成（非本 DDL 职责）。
--
-- 单事务，可一次性执行；幂等（ADD COLUMN IF NOT EXISTS，可重复执行）。
-- ============================================================================

begin;

alter table public.albums       add column if not exists cover_backup      text;
alter table public.artists      add column if not exists avatar_backup     text;
alter table public.artists      add column if not exists bg_image_backup   text;
alter table public.songs        add column if not exists cover_backup      text;
alter table public.contributors add column if not exists avatar_backup     text;
alter table public.articles     add column if not exists cover_backup      text;
alter table public.friends      add column if not exists avatar_backup     text;
alter table public.music_shares add column if not exists cover_url_backup  text;

commit;

-- ============================================================================
-- 验收（8 列全部存在；备份非空率取决于 scripts/backup-images.mjs 回填进度）：
-- select
--   (select count(*) from albums       where cover_backup is not null) as albums,
--   (select count(*) from artists      where avatar_backup is not null) as artist_avatar,
--   (select count(*) from artists      where bg_image_backup is not null) as artist_bg,
--   (select count(*) from songs        where cover_backup is not null) as songs,
--   (select count(*) from contributors where avatar_backup is not null) as contributors,
--   (select count(*) from articles     where cover_backup is not null) as articles,
--   (select count(*) from friends      where avatar_backup is not null) as friends,
--   (select count(*) from music_shares where cover_url_backup is not null) as music_shares;
-- ============================================================================
