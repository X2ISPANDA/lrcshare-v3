-- ============================================================
-- 11 · 贡献者账号合并 RPC（后台「合并账号」功能）
-- 执行环境：Supabase SQL Editor（PostgreSQL）
-- 用法：整段一次性执行（函数创建 + 权限收口包在一个事务里，任一失败整体回滚），
--       幂等可重跑（CREATE OR REPLACE）。事务提交后自动执行文末验证查询。
--
-- 语义：① 按 p_profile 给保留账号写入逐字段挑选后的个人资料
--       ② 把源账号 p_source 的全部引用（songs / lyric_versions / submissions
--          三张表的 contributor_id）置换为目标账号 p_target
--       ③ 删除源账号。
--       单次 RPC 调用 = 单个事务，任一环节失败整体回滚，不会半写。
--
-- p_profile 契约（前端把「每个字段选左还是选右」解析成最终值后传入，8 个键必填）：
--   {
--     "name":           "文本，不能为空",
--     "avatar":         "文本或 null",
--     "bio":            "文本或 null",
--     "public_bio":     true/false,
--     "contact_value":  { "email": "x@y.z" }   -- jsonb 对象，允许 {}
--     "public_contact": true/false,
--     "tags":           ["歌词提交"],            -- jsonb 文本数组，允许 []
--     "sort":           0                        -- 整数
--   }
--
-- 明确不处理：
--   1. submissions.published_refs（jsonb 发布产物快照）不改——
--      它是「本次发布新建实体」的撤回回收依据，改成目标账号反而可能导致
--      撤回旧投稿时误删目标账号。
--   2. is_owner（站长标识）与 created_at 不参与合并——
--      站长身份属于保留账号自身，不应因一次合并被源账号「传染」；
--      创建时间保留账号的原始注册时间。
--   3. lyric_versions.source_credit 外部署名自由文本、TTML 原文内手写名不动。
-- ============================================================

begin;

-- ------------------------------------------------------------
-- 1. 合并函数
--    参数：p_source   = 被合并（执行后删除）的账号 id
--          p_target   = 保留账号 id
--          p_profile  = 逐字段挑选后的保留账号最终资料（契约见文件头）
--    返回：jsonb，含双方名称与三张表实际转移行数，供前端结果提示
-- ------------------------------------------------------------
create or replace function public.admin_merge_contributors(
  p_source   text,
  p_target   text,
  p_profile  jsonb
)
returns jsonb
language plpgsql
as $$
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

  -- ===== 守卫 2：两个账号必须都存在（同时取出名称用于返回与提示） =====
  select name into v_source_name from public.contributors where id = p_source;
  if not found then
    raise exception '源贡献者 % 不存在，中止（整体回滚）', p_source;
  end if;
  select name into v_target_name from public.contributors where id = p_target;
  if not found then
    raise exception '目标贡献者 % 不存在，中止（整体回滚）', p_target;
  end if;

  -- ===== 守卫 3：p_profile 八个键必须齐全且类型正确 =====
  -- name：文本且去空白后非空（贡献者无名不允许入库，与后台新增校验一致）
  v_final_name := nullif(btrim(p_profile ->> 'name'), '');
  if v_final_name is null then
    raise exception 'p_profile.name 缺失或为空';
  end if;

  -- avatar / bio：可空文本。缺失键（? 操作符判存在）直接拒绝，强制前端显式传值，
  -- 避免「漏传 = 静默置空」把保留账号资料清掉
  if not (p_profile ? 'avatar') or jsonb_typeof(p_profile -> 'avatar') not in ('string', 'null') then
    raise exception 'p_profile.avatar 缺失或类型错误（需文本或 null）';
  end if;
  if not (p_profile ? 'bio') or jsonb_typeof(p_profile -> 'bio') not in ('string', 'null') then
    raise exception 'p_profile.bio 缺失或类型错误（需文本或 null）';
  end if;
  v_avatar := nullif(p_profile ->> 'avatar', '');
  v_bio    := nullif(p_profile ->> 'bio', '');

  -- public_bio / public_contact：布尔
  if jsonb_typeof(p_profile -> 'public_bio') <> 'boolean' then
    raise exception 'p_profile.public_bio 缺失或类型错误（需布尔）';
  end if;
  if jsonb_typeof(p_profile -> 'public_contact') <> 'boolean' then
    raise exception 'p_profile.public_contact 缺失或类型错误（需布尔）';
  end if;
  v_public_bio     := (p_profile ->> 'public_bio')     = 'true';
  v_public_contact := (p_profile ->> 'public_contact') = 'true';

  -- contact_value：jsonb 对象（允许空对象 {}；不接受数组/标量/null）
  if jsonb_typeof(p_profile -> 'contact_value') <> 'object' then
    raise exception 'p_profile.contact_value 缺失或类型错误（需 jsonb 对象，允许 {}）';
  end if;
  v_contact := p_profile -> 'contact_value';

  -- tags：jsonb 数组（允许空数组 []），元素必须全是文本，转 text[]
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

  -- sort：数字，取整
  if jsonb_typeof(p_profile -> 'sort') <> 'number' then
    raise exception 'p_profile.sort 缺失或类型错误（需整数）';
  end if;
  v_sort := (p_profile ->> 'sort')::int;

  -- ===== 守卫 4：兜底扫描已知三表之外的外键引用 =====
  -- 若将来新增了引用 contributors(id) 的表但忘了同步本函数，
  -- 只要该表里还有源账号的数据就中止，避免删账号留下 SET NULL 之外的孤儿语义。
  -- （songs / lyric_versions / submissions 三张已知表在下方显式处理，故排除）
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
      and con.relname not in ('songs', 'lyric_versions', 'submissions')
  loop
    -- 动态计数：%I 转义标识符，%L 转义字面量
    execute format('select count(*) from %I.%I where %I = %L',
                   r.schema_name, r.table_name, r.col_name, p_source)
      into v_cnt;
    if v_cnt > 0 then
      -- 4 个 % 对应 4 个参数：schema / 表 / 列 / 行数（少一个会编译报 42601）
      raise exception 'Schema % 表 % 列 % 尚有 % 行引用源贡献者（已知三表之外），中止回滚',
        r.schema_name, r.table_name, r.col_name, v_cnt;
    end if;
  end loop;

  -- ===== 变更 1：按逐字段挑选结果写保留账号资料（is_owner / created_at 不动） =====
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

  -- ===== 变更 2：三张表引用置换（GET DIAGNOSTICS 取实际影响行数） =====
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

  -- ===== 变更 3：删除源账号本人 =====
  -- 三张表外键均为 ON DELETE SET NULL，此处引用已全部置换，删除不会触发置空；
  -- 若有并发写入仍指向源账号，置空也符合数据库既有语义，不阻塞。
  delete from public.contributors where id = p_source;

  return jsonb_build_object(
    'source_id',         p_source,
    'source_name',       v_source_name,
    'target_id',         p_target,
    'target_name_old',   v_target_name,
    'target_name',       v_final_name,
    'songs_moved',       v_songs,
    'versions_moved',    v_versions,
    'submissions_moved', v_submissions
  );
end $$;


-- ------------------------------------------------------------
-- 2. 权限收口（项目红线：函数无 RLS，EXECUTE 是唯一防线）
--    Supabase 默认会把新建函数执行权授予 anon，必须先从 PUBLIC + anon
--    显式收回，再只授 authenticated（本站注册关闭，authenticated 即管理员）。
-- ------------------------------------------------------------
revoke execute on function public.admin_merge_contributors(text, text, jsonb) from public;
revoke execute on function public.admin_merge_contributors(text, text, jsonb) from anon;
grant  execute on function public.admin_merge_contributors(text, text, jsonb) to authenticated;

commit;

-- ------------------------------------------------------------
-- 3. 验证（提交后执行；预期：anon_can_exec = false，auth_can_exec = true）
-- ------------------------------------------------------------
select p.proname,
       has_function_privilege('anon', p.oid, 'EXECUTE')          as anon_can_exec,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_can_exec
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'admin_merge_contributors';
-- 预期：anon_can_exec = false，auth_can_exec = true

-- 3b. 冒烟（可选；把两个 id 换成一对真实重复账号，资料字段按需要改，
--     执行后源账号被真删，谨慎使用）：
-- select public.admin_merge_contributors(
--   'SOURCE_ID_TO_DELETE',
--   'TARGET_ID_TO_KEEP',
--   jsonb_build_object(
--     'name', '无名氏6666',
--     'avatar', null,
--     'bio', '这个人很神秘',
--     'public_bio', true,
--     'contact_value', jsonb_build_object('email', 'x@y.z'),
--     'public_contact', false,
--     'tags', jsonb_build_array('歌词提交'),
--     'sort', 0
--   )
-- );
