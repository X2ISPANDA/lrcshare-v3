-- ============================================================
-- 14 · 贡献者合并/删除纳入歌曲分享 + 推荐理由强制非空
-- 执行环境：Supabase SQL Editor（PostgreSQL）
-- 用法：整段一次性执行（单事务，任一失败整体回滚；幂等可重跑）。
--
-- 背景（2026-10）：
--   12 号脚本新建 music_shares（含 contributor_id → contributors(id)
--   ON DELETE SET NULL 外键），但 11 号「贡献者合并」RPC 只置换
--   songs / lyric_versions / submissions 三表：
--     * 合并时，守卫 4 会扫到 music_shares 外键引用，源账号只要有
--       任意一条分享（含 pending/rejected），整个合并事务回滚；
--     * 删除贡献者时，approved 行的 contributor_id 被 SET NULL，
--       与 music_shares_approved_owner_chk（approved 必须有归属）
--       冲突，删除直接失败。
--
-- 本迁移：
--   1) 全量重定义 admin_merge_contributors：显式把源账号在
--      music_shares 的全部状态行（pending/approved/rejected）转给
--      保留账号；守卫 4 已知表白名单加入 music_shares；
--      返回新增 music_shares_moved。
--   2) 新增 contributors BEFORE DELETE 触发器：删除贡献者时，
--      其名下 music_shares（全部状态）物理删除——歌曲分享是用户
--      投稿内容而非本站既有财产，删账号即删干净；approved_owner
--      防护 CHECK 保持不动。合并 RPC 在 DELETE 源账号前已转走分享，
--      触发器实际删 0 行，互不影响。
--      对照：songs / lyric_versions / submissions 仍维持 ON DELETE
--      SET NULL，歌词等既有内容删账号后保留、仅解除署名。
--   3) 推荐理由 reason 收紧为必填（1~200 字）：
--      DROP 旧 CHECK（允许 NULL）→ 加非空 + 去空白后长度校验 →
--      ALTER COLUMN SET NOT NULL。功能未上线无生产数据，可直接执行。
-- ============================================================

-- ★★★ Supabase SQL Editor 直接全选粘贴本文件即可 ★★★
BEGIN;

-- ============ 1. 推荐理由收紧为必填（1~200 字，纯空白也拒绝） ============
ALTER TABLE public.music_shares
  DROP CONSTRAINT IF EXISTS music_shares_reason_len_chk;

ALTER TABLE public.music_shares
  ADD CONSTRAINT music_shares_reason_len_chk
  CHECK (char_length(btrim(reason)) BETWEEN 1 AND 200);

-- SET NOT NULL：若库中仍有 reason 为空的历史行会报错中止（功能未上线，预期 0 行）
UPDATE public.music_shares SET reason = '（历史投稿，理由补录中）' WHERE reason IS NULL OR btrim(reason) = '';
ALTER TABLE public.music_shares ALTER COLUMN reason SET NOT NULL;

COMMENT ON COLUMN public.music_shares.reason IS '推荐理由（必填，1~200 字）：首页随机推荐卡展示给听众的推荐语';

-- ============ 2. 删除贡献者 → 级联物理删除其歌曲分享（全部状态） ============
CREATE OR REPLACE FUNCTION public.tg_delete_music_shares_on_contributor_del()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- 歌曲分享属用户投稿内容，删账号即随账号一并删除（区别于歌词的 SET NULL 保留语义）
  DELETE FROM public.music_shares WHERE contributor_id = OLD.id;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS contributors_delete_music_shares ON public.contributors;
CREATE TRIGGER contributors_delete_music_shares
  BEFORE DELETE ON public.contributors
  FOR EACH ROW EXECUTE FUNCTION public.tg_delete_music_shares_on_contributor_del();

-- ============ 3. 合并 RPC 全量重定义（纳入 music_shares） ============
--    契约与 11 号完全一致（p_source / p_target / p_profile 八字段），
--    仅新增：music_shares 引用置换、守卫白名单、返回 music_shares_moved。
CREATE OR REPLACE FUNCTION public.admin_merge_contributors(
  p_source   text,
  p_target   text,
  p_profile  jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
declare
  v_source_name  text;
  v_target_name  text;
  v_final_name   text;
  v_avatar       text;
  v_bio          text;
  v_public_bio   boolean;
  v_contact      jsonb;
  v_public_contact boolean;
  v_tags         text[];
  v_sort         int;
  v_songs        int;   -- 转移的歌曲行数
  v_versions     int;   -- 转移的歌词版本行数
  v_submissions  int;   -- 转移的投稿行数
  v_music_shares int;   -- 转移的歌曲分享行数（全部状态：pending/approved/rejected）
  v_cnt          int;
  r              record;
begin
  -- ===== 守卫 1：入参合法性 =====
  if p_source is null or btrim(p_source) = ''
     or p_target is null or btrim(p_target) = '' then
    raise exception '源账号与目标账号 id 均不能为空';
  end if;
  if p_source = p_target then
    raise exception '源账号与目标账号不能是同一账号';
  end if;
  if p_profile is null then
    raise exception '资料参数 p_profile 不能为空（需含 8 个字段的最终值）';
  end if;

  -- ===== 守卫 2：两个账号必须都存在 =====
  select name into v_source_name from public.contributors where id = p_source;
  if not found then
    raise exception '源贡献者 % 不存在，中止（整体回滚）', p_source;
  end if;
  select name into v_target_name from public.contributors where id = p_target;
  if not found then
    raise exception '目标贡献者 % 不存在，中止（整体回滚）', p_target;
  end if;

  -- ===== 守卫 3：p_profile 八个键必须齐全且类型正确 =====
  v_final_name := nullif(btrim(p_profile ->> 'name'), '');
  if v_final_name is null then
    raise exception 'p_profile.name 缺失或为空';
  end if;

  if not (p_profile ? 'avatar') or jsonb_typeof(p_profile -> 'avatar') not in ('string', 'null') then
    raise exception 'p_profile.avatar 缺失或类型错误（需文本或 null）';
  end if;
  if not (p_profile ? 'bio') or jsonb_typeof(p_profile -> 'bio') not in ('string', 'null') then
    raise exception 'p_profile.bio 缺失或类型错误（需文本或 null）';
  end if;
  v_avatar := nullif(p_profile ->> 'avatar', '');
  v_bio    := nullif(p_profile ->> 'bio', '');

  if jsonb_typeof(p_profile -> 'public_bio') <> 'boolean' then
    raise exception 'p_profile.public_bio 缺失或类型错误（需布尔）';
  end if;
  if jsonb_typeof(p_profile -> 'public_contact') <> 'boolean' then
    raise exception 'p_profile.public_contact 缺失或类型错误（需布尔）';
  end if;
  v_public_bio     := (p_profile ->> 'public_bio')     = 'true';
  v_public_contact := (p_profile ->> 'public_contact') = 'true';

  if jsonb_typeof(p_profile -> 'contact_value') <> 'object' then
    raise exception 'p_profile.contact_value 缺失或类型错误（需 jsonb 对象，允许 {}）';
  end if;
  v_contact := p_profile -> 'contact_value';

  if jsonb_typeof(p_profile -> 'tags') <> 'array' then
    raise exception 'p_profile.tags 缺失或类型错误（需文本数组，允许 []）';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_profile -> 'tags') t
    where jsonb_typeof(t) <> 'string'
  ) then
    raise exception 'p_profile.tags 含有非文本元素';
  end if;
  v_tags := array(select jsonb_array_elements_text(p_profile -> 'tags'));

  if jsonb_typeof(p_profile -> 'sort') <> 'number' then
    raise exception 'p_profile.sort 缺失或类型错误（需整数）';
  end if;
  v_sort := (p_profile ->> 'sort')::int;

  -- ===== 守卫 4：兜底扫描已知四表之外的外键引用 =====
  -- songs / lyric_versions / submissions / music_shares 四张已知表在下方显式处理
  for r in
    select nsp.nspname as schema_name,
           con.relname as table_name,
           att.attname as col_name
    from pg_constraint c
    join pg_class con on con.oid = c.conrelid
    join pg_class fre on fre.oid = c.confrelid
    join pg_namespace nsp on nsp.oid = con.relnamespace
    join pg_attribute att on att.attrelid = con.oid and att.attnum = c.conkey[1]
    where c.contype = 'f'
      and nsp.nspname = 'public'
      and fre.relname = 'contributors'
      and con.relname not in ('songs', 'lyric_versions', 'submissions', 'music_shares')
  loop
    execute format('select count(*) from %I.%I where %I = %L',
                   r.schema_name, r.table_name, r.col_name, p_source)
      into v_cnt;
    if v_cnt > 0 then
      raise exception 'Schema % 表 % 列 % 尚有 % 行引用源贡献者（已知四表之外），中止回滚',
        r.schema_name, r.table_name, r.col_name, v_cnt;
    end if;
  end loop;

  -- ===== 变更 1：写保留账号资料（is_owner / created_at 不动） =====
  update public.contributors
     set name           = v_final_name,
         avatar         = v_avatar,
         bio            = v_bio,
         public_bio     = v_public_bio,
         contact_value  = v_contact,
         public_contact = v_public_contact,
         tags           = v_tags,
         sort           = v_sort
   where id = p_target;

  -- ===== 变更 2：四张表引用置换 =====
  update public.songs
     set contributor_id = p_target
   where contributor_id = p_source;
  get diagnostics v_songs = row_count;

  update public.lyric_versions
     set contributor_id = p_target
   where contributor_id = p_source;
  get diagnostics v_versions = row_count;

  update public.submissions
     set contributor_id = p_target
   where contributor_id = p_source;
  get diagnostics v_submissions = row_count;

  -- 歌曲分享：全部状态（pending/approved/rejected）整单转给保留账号；
  -- 转走后下方 DELETE 源账号时，级联触发器对该账号删 0 行。
  update public.music_shares
     set contributor_id = p_target
   where contributor_id = p_source;
  get diagnostics v_music_shares = row_count;

  -- ===== 变更 3：删除源账号本人（触发器会顺带清理其残留分享，预期 0 行） =====
  delete from public.contributors where id = p_source;

  return jsonb_build_object(
    'source_id',         p_source,
    'source_name',       v_source_name,
    'target_id',         p_target,
    'target_name_old',   v_target_name,
    'target_name',       v_final_name,
    'songs_moved',       v_songs,
    'versions_moved',    v_versions,
    'submissions_moved', v_submissions,
    'music_shares_moved', v_music_shares
  );
end $$;

-- 权限收口（CREATE OR REPLACE 不改变既有 ACL，此处显式重申）
revoke execute on function public.admin_merge_contributors(text, text, jsonb) from public;
revoke execute on function public.admin_merge_contributors(text, text, jsonb) from anon;
grant  execute on function public.admin_merge_contributors(text, text, jsonb) to authenticated;

COMMIT;

-- ============================================================
-- 验证查询（全部为只读 SELECT，已包含在同一文件内）
-- 用法：本文件从头到尾整段复制，一次性粘贴进 Supabase SQL Editor 执行。
-- 前半段 BEGIN…COMMIT 是一个原子事务（任一失败整体回滚）；
-- 后半段 4 条 SELECT 在事务提交后自动执行，无任何副作用，无需分段。
-- ============================================================
-- 1) reason 已 NOT NULL：is_nullable 预期 NO
SELECT column_name, is_nullable FROM information_schema.columns
WHERE table_schema='public' AND table_name='music_shares' AND column_name='reason';

-- 2) 删除触发器已挂载：预期返回 1 行
SELECT tgname FROM pg_trigger
WHERE tgrelid = 'public.contributors'::regclass AND tgname = 'contributors_delete_music_shares';

-- 3) 合并函数返回体含 music_shares_moved：预期 t
SELECT position('music_shares_moved' in pg_get_functiondef('public.admin_merge_contributors(text,text,jsonb)'::regprocedure)) > 0 AS has_field;

-- 4) reason 必填 CHECK 已挂载：预期返回 1 行
SELECT conname FROM pg_constraint
WHERE conrelid = 'public.music_shares'::regclass AND conname = 'music_shares_reason_len_chk';
