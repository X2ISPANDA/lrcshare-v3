-- ============================================================
-- 13 · 歌曲分享平台收窄为三家 + 专辑曲目快照 tracks 列
-- 执行环境：Supabase SQL Editor（PostgreSQL）
-- 用法：整段一次性执行（幂等：IF NOT EXISTS / CREATE OR REPLACE，可重跑）。
--
-- 背景（2026-10）：
--   播放器统一改造后只保留 netease / youtube / soundcloud 三家：
--     * 网易云：非官方 Meting 链路实时换 mp3 直链，原生 <audio> 播放；
--     * YouTube / SoundCloud：官方 JS API 完整控制；专辑=播放列表/sets（声明制 + 人工审核）。
--   QQ 音乐 / 酷狗 / 酷我免登录取链实测失效，不引入；
--   bilibili / bandcamp / spotify / apple_music / deezer / tidal 六家下架。
--   功能未上线、无生产数据，本迁移直接物理删除六平台残留行（开发库）。
--
-- 变更内容：
--   1) 删除六平台全部残留行；
--   2) 新增 tracks jsonb（专辑曲目快照）；
--   3) platform CHECK 收窄为三平台枚举（先 DROP CONSTRAINT 再 ADD）；
--   4) anon INSERT 列白名单加入 tracks；
--   5) check_music_share_dup RPC 平台白名单同步收窄（CREATE OR REPLACE 全量重定义）。
-- ============================================================

-- ★★★ Supabase SQL Editor 直接全选粘贴本文件即可（单事务，失败整体回滚） ★★★
BEGIN;

-- ============ 1. 清理已下架六平台的残留行（含三态，功能未上线无生产数据） ============
DELETE FROM public.music_shares
WHERE platform NOT IN ('netease','youtube','soundcloud');

-- ============ 2. 新增专辑曲目快照列（幂等：已存在则跳过） ============
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'music_shares'
      AND column_name = 'tracks'
  ) THEN
    ALTER TABLE public.music_shares ADD COLUMN tracks jsonb;
  END IF;
END $$;

COMMENT ON COLUMN public.music_shares.tracks IS '专辑曲目快照 jsonb：[{id,title,artist,duration,cover_url}]，单曲 NULL；播放时展开为队列';
COMMENT ON COLUMN public.music_shares.platform_id IS '平台内容 ID（youtube 为视频 ID/列表 ID，soundcloud 为规范化永久链接，netease 为数字 ID）';
COMMENT ON TABLE public.music_shares IS '歌曲分享：用户投稿的单曲/专辑分享（网易云/YouTube/SoundCloud 三家统一播放器），审核制';

-- ============ 3. platform CHECK 收窄为三平台 ============
ALTER TABLE public.music_shares
  DROP CONSTRAINT IF EXISTS music_shares_platform_chk;
ALTER TABLE public.music_shares
  ADD CONSTRAINT music_shares_platform_chk
  CHECK (platform IN ('netease','youtube','soundcloud'));

-- ============ 4. anon INSERT 白名单加入 tracks（列 GRANT 为并集，重复执行安全） ============
GRANT INSERT (id, platform, media_type, platform_id, source_url,
              title, artist, cover_url, tracks, reason, is_own_work,
              contributor_id,
              submitter_name, submitter_contact, user_email, created_at)
  ON public.music_shares TO anon;

-- ============ 5. 查重 RPC：平台白名单同步收窄（函数体与 12 号脚本保持一致） ============
CREATE OR REPLACE FUNCTION public.check_music_share_dup(
  p_platform    text,
  p_platform_id text,
  p_title       text,
  p_artist      text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER            -- 需绕过 RLS 检查 pending 行
SET search_path = public    -- SECURITY DEFINER 固定 search_path，防依赖劫持
AS $$
DECLARE
  v_norm_title  text := lower(btrim(COALESCE(p_title, '')));
  v_norm_artist text := lower(btrim(COALESCE(p_artist, '')));
  v_platform_pending boolean := false;
  v_song_pending     boolean := false;
  v_platform_row public.music_shares%ROWTYPE;
  v_song_row     public.music_shares%ROWTYPE;
  v_platform_contributor text;
  v_song_contributor     text;
BEGIN
  -- 入参基本校验（平台枚举 + ID/标题非空）
  IF p_platform NOT IN ('netease','youtube','soundcloud') THEN
    RAISE EXCEPTION '不支持的平台';
  END IF;
  IF btrim(COALESCE(p_platform_id, '')) = '' OR v_norm_title = '' THEN
    RAISE EXCEPTION '平台 ID 与标题不能为空';
  END IF;

  -- ① 同平台同内容：pending 是否存在（任意人提交的待审都算）
  SELECT EXISTS (
    SELECT 1 FROM public.music_shares m
    WHERE m.status = 'pending'
      AND m.platform = p_platform
      AND m.platform_id = p_platform_id
  ) INTO v_platform_pending;

  -- 同平台同内容：approved 命中行（显式列名，取最小展示字段）
  SELECT m.* INTO v_platform_row
  FROM public.music_shares m
  WHERE m.status = 'approved'
    AND m.platform = p_platform
    AND m.platform_id = p_platform_id
  LIMIT 1;

  -- ② 跨平台同曲：pending（要求歌手非空，规则与唯一索引一致）
  IF v_norm_artist <> '' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.music_shares m
      WHERE m.status = 'pending'
        AND m.norm_title = v_norm_title
        AND m.norm_artist = v_norm_artist
    ) INTO v_song_pending;

    SELECT m.* INTO v_song_row
    FROM public.music_shares m
    WHERE m.status = 'approved'
      AND m.norm_title = v_norm_title
      AND m.norm_artist = v_norm_artist
    LIMIT 1;
  END IF;

  -- 关联账号昵称（显式列名，不取联系方式等隐私列）
  IF v_platform_row.contributor_id IS NOT NULL THEN
    SELECT c.name INTO v_platform_contributor
    FROM public.contributors c
    WHERE c.id = v_platform_row.contributor_id;
  END IF;
  IF v_song_row.contributor_id IS NOT NULL THEN
    SELECT c.name INTO v_song_contributor
    FROM public.contributors c
    WHERE c.id = v_song_row.contributor_id;
  END IF;

  RETURN jsonb_build_object(
    'platform_pending', v_platform_pending,
    'platform_approved',
      CASE WHEN v_platform_row.id IS NULL THEN NULL ELSE
        jsonb_build_object(
          'id', v_platform_row.id,
          'title', v_platform_row.title,
          'contributor_name', COALESCE(v_platform_contributor, v_platform_row.submitter_name)
        )
      END,
    'song_pending', v_song_pending,
    'song_approved',
      CASE WHEN v_song_row.id IS NULL THEN NULL ELSE
        jsonb_build_object(
          'id', v_song_row.id,
          'title', v_song_row.title,
          'artist', v_song_row.artist,
          'platform', v_song_row.platform,
          'contributor_name', COALESCE(v_song_contributor, v_song_row.submitter_name)
        )
      END
  );
END;
$$;

-- 权限收口（CREATE OR REPLACE 不改变既有 ACL，这里显式重申以防函数曾被重建为默认权限）
REVOKE EXECUTE ON FUNCTION public.check_music_share_dup(text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_music_share_dup(text, text, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.check_music_share_dup(text, text, text, text) TO anon, authenticated, service_role;

COMMIT;  -- ★ 事务到此结束，以上任一步失败都会整体回滚 ★

-- ============================================================
-- 验证查询（COMMIT 之后单独执行；执行后把结果贴回）
-- ============================================================
-- 1) tracks 列存在：预期返回 1 行
-- SELECT column_name, data_type FROM information_schema.columns
-- WHERE table_schema='public' AND table_name='music_shares' AND column_name='tracks';

-- 2) 平台 CHECK 已收窄：确认 def 里只有 netease/youtube/soundcloud
-- SELECT pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conname = 'music_shares_platform_chk';

-- 3) 六平台残留行必须为 0
-- SELECT platform, count(*) FROM public.music_shares
-- WHERE platform NOT IN ('netease','youtube','soundcloud') GROUP BY platform;

-- 4) 专辑行应有 tracks 快照（历史单曲/缺快照专辑可据此排查）
-- SELECT platform, media_type, count(*) FILTER (WHERE tracks IS NOT NULL) AS with_tracks,
--        count(*) FILTER (WHERE tracks IS NULL) AS without_tracks
-- FROM public.music_shares GROUP BY 1,2 ORDER BY 1,2;
