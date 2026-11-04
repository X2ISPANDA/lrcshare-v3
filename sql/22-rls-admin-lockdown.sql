-- =====================================================================
-- 22-rls-admin-lockdown.sql
-- 修复越权漏洞：所有"管理员可..."策略原本只校验 auth.role()='authenticated'，
-- 导致任何登录用户都能执行写操作。改为校验 app_metadata.role='admin'。
--
-- 前置：管理员用户的 auth.users.app_metadata 需设置 role='admin'
--   （通过 Auth Admin API 或 SQL: UPDATE auth.users SET app_metadata =
--    jsonb_set(app_metadata, '{role}', '"admin"') WHERE email = '...';）
-- =====================================================================

BEGIN;

-- ── 管理员判定函数（SECURITY DEFINER，绕过 RLS 读取 app_metadata）──────
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';
$$;

-- =====================================================================
-- album_contributors
-- =====================================================================
DROP POLICY IF EXISTS "专辑贡献：管理员可删" ON public.album_contributors;
CREATE POLICY "专辑贡献：管理员可删" ON public.album_contributors AS PERMISSIVE FOR DELETE TO public USING (public.is_admin());

DROP POLICY IF EXISTS "专辑贡献：管理员可增" ON public.album_contributors;
CREATE POLICY "专辑贡献：管理员可增" ON public.album_contributors AS PERMISSIVE FOR INSERT TO public WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "专辑贡献：管理员可改" ON public.album_contributors;
CREATE POLICY "专辑贡献：管理员可改" ON public.album_contributors AS PERMISSIVE FOR UPDATE TO public USING (public.is_admin()) WITH CHECK (public.is_admin());

-- =====================================================================
-- albums
-- =====================================================================
DROP POLICY IF EXISTS "专辑：管理员可写入" ON public.albums;
CREATE POLICY "专辑：管理员可写入" ON public.albums AS PERMISSIVE FOR INSERT TO public WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "专辑：管理员可删除" ON public.albums;
CREATE POLICY "专辑：管理员可删除" ON public.albums AS PERMISSIVE FOR DELETE TO public USING (public.is_admin());

DROP POLICY IF EXISTS "专辑：管理员可更新" ON public.albums;
CREATE POLICY "专辑：管理员可更新" ON public.albums AS PERMISSIVE FOR UPDATE TO public USING (public.is_admin()) WITH CHECK (public.is_admin());

-- =====================================================================
-- api_keys（最严重：原 TO authenticated USING(true) 任何登录用户可操作密钥）
-- =====================================================================
DROP POLICY IF EXISTS api_keys_delete ON public.api_keys;
CREATE POLICY api_keys_delete ON public.api_keys AS PERMISSIVE FOR DELETE TO public USING (public.is_admin());

DROP POLICY IF EXISTS api_keys_insert ON public.api_keys;
CREATE POLICY api_keys_insert ON public.api_keys AS PERMISSIVE FOR INSERT TO public WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS api_keys_select ON public.api_keys;
CREATE POLICY api_keys_select ON public.api_keys AS PERMISSIVE FOR SELECT TO public USING (public.is_admin());

DROP POLICY IF EXISTS api_keys_update ON public.api_keys;
CREATE POLICY api_keys_update ON public.api_keys AS PERMISSIVE FOR UPDATE TO public USING (public.is_admin()) WITH CHECK (public.is_admin());

-- =====================================================================
-- articles
-- =====================================================================
DROP POLICY IF EXISTS "文章：管理员可写入" ON public.articles;
CREATE POLICY "文章：管理员可写入" ON public.articles AS PERMISSIVE FOR INSERT TO public WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "文章：管理员可删除" ON public.articles;
CREATE POLICY "文章：管理员可删除" ON public.articles AS PERMISSIVE FOR DELETE TO public USING (public.is_admin());

DROP POLICY IF EXISTS "文章：管理员可更新" ON public.articles;
CREATE POLICY "文章：管理员可更新" ON public.articles AS PERMISSIVE FOR UPDATE TO public USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "文章：管理员可读全部" ON public.articles;
CREATE POLICY "文章：管理员可读全部" ON public.articles AS PERMISSIVE FOR SELECT TO public USING (public.is_admin());

-- =====================================================================
-- artists
-- =====================================================================
DROP POLICY IF EXISTS "艺术家：管理员可写入" ON public.artists;
CREATE POLICY "艺术家：管理员可写入" ON public.artists AS PERMISSIVE FOR INSERT TO public WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "艺术家：管理员可删除" ON public.artists;
CREATE POLICY "艺术家：管理员可删除" ON public.artists AS PERMISSIVE FOR DELETE TO public USING (public.is_admin());

DROP POLICY IF EXISTS "艺术家：管理员可更新" ON public.artists;
CREATE POLICY "艺术家：管理员可更新" ON public.artists AS PERMISSIVE FOR UPDATE TO public USING (public.is_admin()) WITH CHECK (public.is_admin());

-- =====================================================================
-- contributors
-- =====================================================================
DROP POLICY IF EXISTS "贡献者：管理员可写入" ON public.contributors;
CREATE POLICY "贡献者：管理员可写入" ON public.contributors AS PERMISSIVE FOR INSERT TO public WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "贡献者：管理员可删除" ON public.contributors;
CREATE POLICY "贡献者：管理员可删除" ON public.contributors AS PERMISSIVE FOR DELETE TO public USING (public.is_admin());

DROP POLICY IF EXISTS "贡献者：管理员可更新" ON public.contributors;
CREATE POLICY "贡献者：管理员可更新" ON public.contributors AS PERMISSIVE FOR UPDATE TO public USING (public.is_admin()) WITH CHECK (public.is_admin());

-- =====================================================================
-- friend_categories
-- =====================================================================
DROP POLICY IF EXISTS "友链分类：管理员可写入" ON public.friend_categories;
CREATE POLICY "友链分类：管理员可写入" ON public.friend_categories AS PERMISSIVE FOR ALL TO public USING (public.is_admin()) WITH CHECK (public.is_admin());

-- =====================================================================
-- friends
-- =====================================================================
DROP POLICY IF EXISTS "友链：管理员可写入" ON public.friends;
CREATE POLICY "友链：管理员可写入" ON public.friends AS PERMISSIVE FOR INSERT TO public WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "友链：管理员可删除" ON public.friends;
CREATE POLICY "友链：管理员可删除" ON public.friends AS PERMISSIVE FOR DELETE TO public USING (public.is_admin());

DROP POLICY IF EXISTS "友链：管理员可更新" ON public.friends;
CREATE POLICY "友链：管理员可更新" ON public.friends AS PERMISSIVE FOR UPDATE TO public USING (public.is_admin()) WITH CHECK (public.is_admin());

-- =====================================================================
-- lyric_versions
-- =====================================================================
DROP POLICY IF EXISTS "歌词版本：管理员全权" ON public.lyric_versions;
CREATE POLICY "歌词版本：管理员全权" ON public.lyric_versions AS PERMISSIVE FOR ALL TO public USING (public.is_admin()) WITH CHECK (public.is_admin());

-- =====================================================================
-- mail_logs
-- =====================================================================
DROP POLICY IF EXISTS mail_logs_authenticated_select ON public.mail_logs;
CREATE POLICY mail_logs_authenticated_select ON public.mail_logs AS PERMISSIVE FOR SELECT TO public USING (public.is_admin());

-- =====================================================================
-- music_shares
-- =====================================================================
DROP POLICY IF EXISTS music_shares_authenticated_all ON public.music_shares;
CREATE POLICY music_shares_authenticated_all ON public.music_shares AS PERMISSIVE FOR ALL TO public USING (public.is_admin()) WITH CHECK (public.is_admin());

-- =====================================================================
-- settings
-- =====================================================================
DROP POLICY IF EXISTS "设置：管理员可写入" ON public.settings;
CREATE POLICY "设置：管理员可写入" ON public.settings AS PERMISSIVE FOR INSERT TO public WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "设置：管理员可更新" ON public.settings;
CREATE POLICY "设置：管理员可更新" ON public.settings AS PERMISSIVE FOR UPDATE TO public USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "设置：管理员可读全部" ON public.settings;
CREATE POLICY "设置：管理员可读全部" ON public.settings AS PERMISSIVE FOR SELECT TO public USING (public.is_admin());

-- =====================================================================
-- song_contributors
-- =====================================================================
DROP POLICY IF EXISTS "歌曲贡献：管理员可删" ON public.song_contributors;
CREATE POLICY "歌曲贡献：管理员可删" ON public.song_contributors AS PERMISSIVE FOR DELETE TO public USING (public.is_admin());

DROP POLICY IF EXISTS "歌曲贡献：管理员可增" ON public.song_contributors;
CREATE POLICY "歌曲贡献：管理员可增" ON public.song_contributors AS PERMISSIVE FOR INSERT TO public WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "歌曲贡献：管理员可改" ON public.song_contributors;
CREATE POLICY "歌曲贡献：管理员可改" ON public.song_contributors AS PERMISSIVE FOR UPDATE TO public USING (public.is_admin()) WITH CHECK (public.is_admin());

-- =====================================================================
-- song_lyric_doubts
-- =====================================================================
DROP POLICY IF EXISTS "存疑：管理员全权" ON public.song_lyric_doubts;
CREATE POLICY "存疑：管理员全权" ON public.song_lyric_doubts AS PERMISSIVE FOR ALL TO public USING (public.is_admin()) WITH CHECK (public.is_admin());

-- =====================================================================
-- song_lyric_lines
-- =====================================================================
DROP POLICY IF EXISTS "歌词行：管理员全权" ON public.song_lyric_lines;
CREATE POLICY "歌词行：管理员全权" ON public.song_lyric_lines AS PERMISSIVE FOR ALL TO public USING (public.is_admin()) WITH CHECK (public.is_admin());

-- =====================================================================
-- song_secrets
-- =====================================================================
DROP POLICY IF EXISTS "口令：管理员可删" ON public.song_secrets;
CREATE POLICY "口令：管理员可删" ON public.song_secrets AS PERMISSIVE FOR DELETE TO public USING (public.is_admin());

DROP POLICY IF EXISTS "口令：管理员可增" ON public.song_secrets;
CREATE POLICY "口令：管理员可增" ON public.song_secrets AS PERMISSIVE FOR INSERT TO public WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "口令：管理员可改" ON public.song_secrets;
CREATE POLICY "口令：管理员可改" ON public.song_secrets AS PERMISSIVE FOR UPDATE TO public USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "口令：管理员可读" ON public.song_secrets;
CREATE POLICY "口令：管理员可读" ON public.song_secrets AS PERMISSIVE FOR SELECT TO public USING (public.is_admin());

-- =====================================================================
-- songs
-- =====================================================================
DROP POLICY IF EXISTS "歌曲：管理员可写入" ON public.songs;
CREATE POLICY "歌曲：管理员可写入" ON public.songs AS PERMISSIVE FOR INSERT TO public WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "歌曲：管理员可删除" ON public.songs;
CREATE POLICY "歌曲：管理员可删除" ON public.songs AS PERMISSIVE FOR DELETE TO public USING (public.is_admin());

DROP POLICY IF EXISTS "歌曲：管理员可更新删除" ON public.songs;
CREATE POLICY "歌曲：管理员可更新删除" ON public.songs AS PERMISSIVE FOR UPDATE TO public USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "歌曲：管理员可读全部" ON public.songs;
CREATE POLICY "歌曲：管理员可读全部" ON public.songs AS PERMISSIVE FOR SELECT TO public USING (public.is_admin());

-- =====================================================================
-- sponsors
-- =====================================================================
DROP POLICY IF EXISTS "赞助：管理员可写入" ON public.sponsors;
CREATE POLICY "赞助：管理员可写入" ON public.sponsors AS PERMISSIVE FOR INSERT TO public WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "赞助：管理员可删除" ON public.sponsors;
CREATE POLICY "赞助：管理员可删除" ON public.sponsors AS PERMISSIVE FOR DELETE TO public USING (public.is_admin());

DROP POLICY IF EXISTS "赞助：管理员可更新" ON public.sponsors;
CREATE POLICY "赞助：管理员可更新" ON public.sponsors AS PERMISSIVE FOR UPDATE TO public USING (public.is_admin()) WITH CHECK (public.is_admin());

-- =====================================================================
-- submissions
-- =====================================================================
DROP POLICY IF EXISTS "投稿：管理员可删除" ON public.submissions;
CREATE POLICY "投稿：管理员可删除" ON public.submissions AS PERMISSIVE FOR DELETE TO public USING (public.is_admin());

DROP POLICY IF EXISTS "投稿：管理员可更新" ON public.submissions;
CREATE POLICY "投稿：管理员可更新" ON public.submissions AS PERMISSIVE FOR UPDATE TO public USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "投稿：管理员可查看所有" ON public.submissions;
CREATE POLICY "投稿：管理员可查看所有" ON public.submissions AS PERMISSIVE FOR SELECT TO public USING (public.is_admin());

-- =====================================================================
-- ttml_hub_pending
-- =====================================================================
DROP POLICY IF EXISTS "待匹配：管理员全权" ON public.ttml_hub_pending;
CREATE POLICY "待匹配：管理员全权" ON public.ttml_hub_pending AS PERMISSIVE FOR ALL TO public USING (public.is_admin()) WITH CHECK (public.is_admin());

-- =====================================================================
-- ttml_hub_state
-- =====================================================================
DROP POLICY IF EXISTS "同步状态：管理员只读" ON public.ttml_hub_state;
CREATE POLICY "同步状态：管理员只读" ON public.ttml_hub_state AS PERMISSIVE FOR SELECT TO public USING (public.is_admin());

COMMIT;
