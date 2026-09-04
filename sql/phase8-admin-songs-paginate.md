# SQL 方案：后台歌曲管理分页 + 跨字段搜索（phase8）

日期：2026-09-04
状态：待执行

## 背景

后台「歌曲管理」页（admin/SongsView）此前一次性全表拉取 songs / song_contributors /
song_secrets，数据量增长后页面加载随曲库线性变慢。改造为服务端分页后，搜索也必须下推到
库端（否则只能筛当前页）。

前台五 tab 搜索（`search_songs` 等）**不做任何改动**。本文件新增两个后台专用函数：

- `admin_search_songs(p_q)`：跨 **歌名 / 歌别名 / 歌手名 / 歌手别名 / 专辑名**
  模糊搜索，**不限歌曲状态**（草稿、隐藏的歌后台也要能搜到）。
- `admin_search_songs_count(p_q)`：同条件计数，供分页 total。

匹配范围比旧版后台前端过滤（歌名/歌别名/歌手名）多出：歌手别名（旧版遗漏）、专辑名。
专辑表无 aliases 列（与前台专辑搜索一致，仅按专辑名匹配）。

权限：仅 `authenticated`（登录管理员）可执行，`anon`（匿名/前台）收权，避免成为绕过
`status='published'` 过滤的公开搜索通道。函数为 SECURITY INVOKER（默认），行级安全策略
对调用者照常生效。

## SQL（Supabase SQL Editor 执行）

以下整块为**一个事务**，整段复制粘贴、一次执行即可（任一句失败全部回滚，不会留半成品）：

```sql
BEGIN;

-- ① 后台歌曲搜索：歌名/歌别名/歌手名/歌手别名/专辑名，不限状态
CREATE OR REPLACE FUNCTION public.admin_search_songs(p_q text)
RETURNS SETOF public.songs
LANGUAGE sql
STABLE
AS $function$
  select s.*
  from public.songs s
  where nullif(trim(p_q), '') is not null
    and (
      s.title ilike '%' || p_q || '%'
      or exists (
        select 1 from unnest(coalesce(s.aliases, '{}'::text[])) a
        where a ilike '%' || p_q || '%'
      )
      -- 歌手：演唱/词/曲/编 + 专辑艺术家（复用现成的 song_artist_ids 汇总）
      or exists (
        select 1
        from public.artists ar
        where ar.id = any(public.song_artist_ids(s.id))
          and (
            ar.name ilike '%' || p_q || '%'
            or exists (
              select 1 from unnest(coalesce(ar.aliases, '{}'::text[])) al
              where al ilike '%' || p_q || '%'
            )
          )
      )
      -- 专辑：所属专辑的名称（albums 表无 aliases 列，与前台专辑搜索一致）
      or exists (
        select 1
        from public.albums al
        where al.id = s.album_id
          and al.name ilike '%' || p_q || '%'
      )
    )
  order by s.created_at desc
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_search_songs(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_search_songs(text) TO authenticated;

-- ② 同条件计数（分页 total；包一层保证与列表条件永远一致）
CREATE OR REPLACE FUNCTION public.admin_search_songs_count(p_q text)
RETURNS bigint
LANGUAGE sql
STABLE
AS $function$
  select count(*) from public.admin_search_songs(p_q)
$function$;

REVOKE EXECUTE ON FUNCTION public.admin_search_songs_count(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_search_songs_count(text) TO authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

说明：
- 排序/翻页由 PostgREST 在函数结果集外层下推（`?order=&limit=&offset=`），与 open-api
  Worker 调 `search_songs` 的方式一致；函数内 `order by created_at desc` 仅为默认序。
- `duration` 为文本列（如 "3:45"），不提供列头排序；可排序列为歌名、创建时间。

## 验证

```sql
-- 歌名命中
select id, title, status from public.admin_search_songs('intro');
-- 歌手名/别名命中：应返回该艺术家关联的全部歌曲（含草稿/隐藏）
select id, title, status from public.admin_search_songs('龙胆紫');
-- 专辑名命中：应返回该专辑下全部歌曲
select id, title from public.admin_search_songs('在动物园散步才是正经事');
-- 计数一致
select public.admin_search_songs_count('intro') =
       (select count(*) from public.admin_search_songs('intro')) as ok;
-- 空关键词返回 0 行
select count(*) as empty_ok from public.admin_search_songs('   ');
```

权限验证（anon key 调用应拒绝；anon key 为公开密钥。Windows PowerShell/CMD 直接粘贴整行，
用 `curl.exe` 避免 PowerShell 的 curl 别名冲突）：

```powershell
curl.exe -s "https://spb-fr3kfwlu71j1wx89.supabase.opentrust.net/rest/v1/rpc/admin_search_songs" -H "apikey: eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6InNwYi1mcjNrZndsdTcxajF3eDg5IiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODU5Nzk0MjcsImV4cCI6MjEwMTU1NTQyN30.96Ml9CB_eg0tdECDU3qJgqHFPNqx--kRYze5-_mZ3jA" -H "Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiIsInJlZiI6InNwYi1mcjNrZndsdTcxajF3eDg5IiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODU5Nzk0MjcsImV4cCI6MjEwMTU1NTQyN30.96Ml9CB_eg0tdECDU3qJgqHFPNqx--kRYze5-_mZ3jA" -H "Content-Type: application/json" -d '{\"p_q\":\"test\"}'
```

预期返回包含 `permission denied for function admin_search_songs`（REVOKE 生效）。
注意 PowerShell 下 body 必须写成 `-d '{\"p_q\":\"test\"}'`（单引号包外、引号加反斜杠），
否则引号被 PowerShell 吞掉会报 PGRST102 Empty or invalid json。

Mac/Linux（bash）同样是单行，末尾 body 用 `-d '{"p_q":"test"}'`。

## 执行顺序

**先执行本 SQL，再发布前端**（前端新代码依赖这两个函数；SQL 执行前旧前端不受影响，
函数为新增、不改动任何现有对象）。
