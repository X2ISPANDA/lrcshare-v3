-- ============================================================
-- 12 · 歌曲分享（音乐挂件）：music_shares 建表 + RLS + 去重查重 RPC
-- 执行环境：Supabase SQL Editor（PostgreSQL）
-- 用法：整段一次性执行（幂等：IF NOT EXISTS / CREATE OR REPLACE，可重跑）。
--       执行后把文末「验证查询」的结果贴回核对。
--
-- 设计依据：sql/12-music-shares-evolution.md（已确认方案）
-- 库内事实核对（2026-10-11，PostgREST OpenAPI 实查）：
--   * contributors.id 类型为 text（如 'ct_owner'），故 contributor_id 用 text 外键；
--   * submissions / articles 均无 reviewed_by 审核人列，本站不跟踪具体管理员，
--     本表也只留 reviewed_at / approved_at，不设 reviewed_by；
--   * 项目所有表均 updated_at 自行维护或触发器维护，通用函数是否存在无源码可查，
--     本脚本在 DO 块内探测，存在 set_updated_audit/set_updated_at 则复用，否则建私有函数。
-- 安全模型：RLS 双策略 + REVOKE 纵深防御；anon 仅能 SELECT approved、INSERT 投稿白名单列；
--           查重走 SECURITY DEFINER RPC（pending 行 anon 直读不到，需要函数代为判断）。
-- ============================================================

-- ★★★ Supabase SQL Editor 直接全选粘贴本文件即可（单事务，失败整体回滚） ★★★
BEGIN;

-- ============ 1. 建表 ============
CREATE TABLE IF NOT EXISTS public.music_shares (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ===== 平台与内容标识（服务端 resolve-music 解析后写入，不信任前端传值） =====
  platform          text NOT NULL,
  -- 2026-10 起仅保留三家：netease 网易云 / youtube / soundcloud
  media_type        text NOT NULL,
  -- song / album（视频/单曲类内容一律 song；合辑须投稿者声明为专辑 + 人工审核）
  platform_id       text NOT NULL,
  -- 平台内容 ID：
  --   netease → 单曲/专辑数字 ID
  --   youtube → 11 位视频 ID（单曲）或播放列表 ID（专辑）
  --   soundcloud → 规范化后的 track / sets 永久链接 URL
  source_url        text NOT NULL,        -- 原始回链（「原平台打开」用，必须 https）

  -- ===== 展示信息 =====
  title             text NOT NULL,
  artist            text,
  cover_url         text,                 -- 官方封面；缺失时前端用站点默认图
  -- 专辑曲目快照（单曲 NULL）：识别时写入 [{id,title,artist,duration,cover_url}]，
  -- 播放时据此展开队列顺序连播；直链类平台（网易云）每首播放时再实时换时效音频地址
  tracks            jsonb,
  reason            text,                 -- 推荐理由，可空，1~200 字
  is_own_work       boolean NOT NULL DEFAULT false,
  -- 本条是否为投稿人本人原创作品（自荐声明，管理员审核时核实/可改）；
  -- 仅这一条使用创作者卡片样式，不是账号级属性

  -- ===== 投稿人：审核通过后关联 contributors（id 为 text，见文件头核对） =====
  contributor_id    text REFERENCES public.contributors(id) ON DELETE SET NULL,
  submitter_name    text NOT NULL,        -- 投稿时昵称快照（待审列表/兜底展示）
  submitter_contact jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- 复用 contributors.contact_value 同构：{"qq":"123","email":"a@b.c"}，仅后台可见
  user_email        text,                 -- 邮箱冗余列（接收审核结果通知，可空）

  -- ===== 前台排序：sort>0 手动置顶（数字小在前），sort=0 按 approved_at 倒序 =====
  sort              integer NOT NULL DEFAULT 0,

  -- ===== 审核状态 =====
  status            text NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','approved','rejected')),
  reject_reason     text,
  reviewed_at       timestamptz,
  approved_at       timestamptz,

  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),

  -- ===== 跨平台同曲去重规范化生成列（仅 trim+小写，与查重 RPC 表达式严格一致） =====
  norm_title        text GENERATED ALWAYS AS (lower(btrim(title))) STORED,
  norm_artist       text GENERATED ALWAYS AS (lower(btrim(artist))) STORED,

  CONSTRAINT music_shares_platform_chk    CHECK (platform IN
                        ('netease','youtube','soundcloud')),
  CONSTRAINT music_shares_media_type_chk  CHECK (media_type IN ('song','album')),
  CONSTRAINT music_shares_reason_len_chk  CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 200),
  CONSTRAINT music_shares_source_url_chk  CHECK (source_url ~ '^https://'),
  CONSTRAINT music_shares_sort_chk        CHECK (sort >= 0),
  -- approved 必须已关联贡献者账号（与歌词投稿发布同语义；pending/rejected 可为空）
  CONSTRAINT music_shares_approved_owner_chk
                        CHECK (status <> 'approved' OR contributor_id IS NOT NULL)
);

COMMENT ON TABLE  public.music_shares IS '歌曲分享：用户投稿的单曲/专辑分享（网易云/YouTube/SoundCloud 三家统一播放器），审核制';
COMMENT ON COLUMN public.music_shares.platform_id    IS '平台内容 ID（youtube 为视频 ID/列表 ID，soundcloud 为规范化永久链接，netease 为数字 ID）';
COMMENT ON COLUMN public.music_shares.tracks         IS '专辑曲目快照 jsonb：[{id,title,artist,duration,cover_url}]，单曲 NULL；播放时展开为队列';
COMMENT ON COLUMN public.music_shares.is_own_work    IS '投稿人自荐本人原创作品，仅影响这一条的创作者卡片样式，审核可改';
COMMENT ON COLUMN public.music_shares.contributor_id IS '审核通过后绑定的贡献者账号（contributors.id，text）';

-- ============ 2. 索引（双层去重硬兜底 + 列表/审核查询） ============

-- ① 同平台同内容：仅允许一条 approved
CREATE UNIQUE INDEX IF NOT EXISTS uq_music_shares_approved_platform
  ON public.music_shares (platform, platform_id)
  WHERE status = 'approved';

-- ② 跨平台同曲：规范化「歌名+歌手」仅允许一条 approved（歌手缺失无法可靠比对，不纳入）
CREATE UNIQUE INDEX IF NOT EXISTS uq_music_shares_approved_song
  ON public.music_shares (norm_title, norm_artist)
  WHERE status = 'approved' AND norm_artist IS NOT NULL AND norm_artist <> '';

-- 后台待审列表 / 状态筛选
CREATE INDEX IF NOT EXISTS idx_music_shares_status_created
  ON public.music_shares (status, created_at DESC);

-- 前台分享页排序：sort=0 的沉底，置顶按数字升序，其余按通过时间倒序
CREATE INDEX IF NOT EXISTS idx_music_shares_page_sort
  ON public.music_shares ((sort = 0), sort, approved_at DESC)
  WHERE status = 'approved';

-- ============ 3. RLS 策略（anon 只读 approved + 仅可投 pending 白名单列） ============
ALTER TABLE public.music_shares ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  -- 重跑前先清旧策略，保证脚本幂等
  EXECUTE (
    SELECT COALESCE(string_agg(format('DROP POLICY %I ON public.music_shares;', polname), ' '), 'SELECT 1;')
    FROM pg_policy
    WHERE polrelid = 'public.music_shares'::regclass
  );
END $$;

-- anon：仅能看到 approved
CREATE POLICY music_shares_anon_select ON public.music_shares
  FOR SELECT TO anon
  USING (status = 'approved');

-- anon：仅能插入 pending（status/is_own_work/sort 等的列级约束见下方 GRANT + WITH CHECK）
CREATE POLICY music_shares_anon_insert ON public.music_shares
  FOR INSERT TO anon
  WITH CHECK (status = 'pending');

-- authenticated（本站注册已关闭，即管理员）：全权
CREATE POLICY music_shares_authenticated_all ON public.music_shares
  FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

-- service_role（Netlify 函数/管理脚本）：全权
CREATE POLICY music_shares_service_role_all ON public.music_shares
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- ============ 4. GRANT 收口（项目红线：新建表默认授权过宽，先 REVOKE 再最小授予） ============
REVOKE ALL ON public.music_shares FROM PUBLIC, anon;
GRANT SELECT ON public.music_shares TO anon;
-- anon 投稿白名单列：
--   可带 is_own_work（自荐声明）与 contributor_id（声明「我是已有账号」，FK 保证账号真实存在）；
--   不可带 status/sort/reject_reason/reviewed_*/approved_at/norm_* 等审核与生成列。
GRANT INSERT (id, platform, media_type, platform_id, source_url,
              title, artist, cover_url, tracks, reason, is_own_work,
              contributor_id,
              submitter_name, submitter_contact, user_email, created_at)
  ON public.music_shares TO anon;
GRANT ALL ON public.music_shares TO authenticated, service_role;

-- ============ 5. updated_at 触发器（探测通用函数优先复用，否则建私有函数） ============
DO $$
DECLARE
  v_existing_fn text;
BEGIN
  -- 注意：不能用 pg_get_function_arguments(p)（该函数只收 OID，不收 pg_proc 整行），
  -- 直接用 proargtypes = 空 oidvector 判断「零参函数」，兼容所有 PG 版本
  SELECT p.proname INTO v_existing_fn
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN ('set_updated_at', 'set_updated_audit')
    AND p.proargtypes = ''::oidvector
    AND p.prorettype = 'trigger'::regtype
  LIMIT 1;

  IF v_existing_fn IS NOT NULL THEN
    -- 复用库内已有通用触发器函数（不重建、不改名）
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_music_shares_updated_at ON public.music_shares;
       CREATE TRIGGER trg_music_shares_updated_at
         BEFORE UPDATE ON public.music_shares
         FOR EACH ROW EXECUTE FUNCTION public.%I()',
      v_existing_fn
    );
  ELSE
    -- 库内无通用函数：建私有函数（CREATE OR REPLACE 保证可重跑）
    CREATE OR REPLACE FUNCTION public.music_shares_set_updated_at()
    RETURNS trigger
    LANGUAGE plpgsql
    AS $f$
    BEGIN
      NEW.updated_at := now();
      RETURN NEW;
    END;
    $f$;
    -- 触发器函数不应对外暴露直接 EXECUTE
    EXECUTE 'REVOKE ALL ON FUNCTION public.music_shares_set_updated_at() FROM PUBLIC, anon';
    DROP TRIGGER IF EXISTS trg_music_shares_updated_at ON public.music_shares;
    CREATE TRIGGER trg_music_shares_updated_at
      BEFORE UPDATE ON public.music_shares
      FOR EACH ROW EXECUTE FUNCTION public.music_shares_set_updated_at();
  END IF;
END $$;

-- ============ 6. 投稿去重查重 RPC ============
-- 背景：anon 的 SELECT 策略只放行 approved，pending 直读不到；
--       投稿前需要同时判断 approved + pending 的重复情况，故用 SECURITY DEFINER 代为判断，
--       只返回「是否重复 + 最小展示信息」，不泄露待审内容全量。
-- 返回 jsonb：
-- {
--   "platform_pending": false,
--   "platform_approved": {"id":"...","title":"...","contributor_name":"..."} | null,
--   "song_pending": false,
--   "song_approved":  {"id":"...","title":"...","artist":"...","contributor_name":"..."} | null
-- }
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

-- 权限收口：先收（默认会授给 anon），再按需授予（anon 本来就要调用；authenticated 后台也复用）
REVOKE EXECUTE ON FUNCTION public.check_music_share_dup(text, text, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.check_music_share_dup(text, text, text, text) FROM anon;
GRANT  EXECUTE ON FUNCTION public.check_music_share_dup(text, text, text, text) TO anon, authenticated, service_role;

COMMIT;  -- ★ 事务到此结束，以上任一步失败都会整体回滚 ★

-- ============================================================
-- 验证查询（COMMIT 之后单独执行；执行后把结果贴回）
-- ============================================================
-- 1) RLS 开关：relrowsecurity 必须为 true
-- SELECT relname, relrowsecurity
-- FROM pg_class
-- WHERE oid = 'public.music_shares'::regclass;

-- 2) 策略清单：预期 4 条 anon_select / anon_insert / authenticated_all / service_role_all
-- SELECT polname, polcmd, pg_get_expr(polqual, polrelid) AS using_expr,
--        pg_get_expr(polwithcheck, polrelid) AS check_expr
-- FROM pg_policy WHERE polrelid = 'public.music_shares'::regclass
-- ORDER BY polname;

-- 3) 部分唯一索引：预期 2 个 uq_music_shares_*（indisunique=t，带 WHERE）
-- SELECT indexname, indexdef FROM pg_indexes
-- WHERE tablename = 'music_shares' ORDER BY indexname;

-- 4) 函数权限：预期 anon_can_exec = true（此函数本就要对 anon 开放）
-- SELECT p.proname,
--        has_function_privilege('anon', p.oid, 'EXECUTE')          AS anon_can_exec,
--        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_can_exec
-- FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
-- WHERE n.nspname = 'public' AND p.proname = 'check_music_share_dup';
