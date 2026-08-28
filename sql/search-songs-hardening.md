# SQL 方案：search_songs RPC 加固 v2（动态列生成，替代手写清单）

日期：2026-08-25
状态：**已废弃**——unlock_code 已随 [phase3-song-secrets.md](phase3-song-secrets.md) 拆表删除，占位列补丁连根作废；搜索 RPC 权威版本为 phase3 6f。仅作方案沿革记录，请勿按本文重跑 SQL。

## v1 → v2

v1 手写 21 列清单（从 types.ts 推导），若与真实表结构有任何出入（列缺失/多列/顺序不同），`create function` 会报 "structure of query does not match function result type" 直接失败。v2 改为**从 pg_attribute 动态生成 select 清单**：`unlock_code` 用 `null::实际类型` 占位，其余列原样引用——列数、顺序、类型与表结构严格一致，不可能错位。

## 背景（为什么必须改）

现函数体 `select s.* from songs` 以调用者（anon）身份执行。列级收权 v3 生效后，`s.*` 展开含 unlock_code → 每次调用报 permission denied → 前端单曲搜索整体不可用。不能改 security definer 绕过：definer 会把真实口令填进返回的复合类型，PostgREST 从复合类型取列不经过列权限检查（`?select=unlock_code` 直接取值），等于焊死泄露路径。

## 变更内容（一键脚本，可重复执行）

```sql
do $do$
declare
  sel_list text;
begin
  select string_agg(
           case when attname = 'unlock_code'
             then format('null::%s as %I', format_type(atttypid, atttypmod), attname)
             else quote_ident(attname)
           end,
           ', ' order by attnum)
    into sel_list
  from pg_attribute
  where attrelid = 'public.songs'::regclass
    and attnum > 0
    and not attisdropped;

  execute format($fn$
    create or replace function public.search_songs(p_q text)
    returns setof public.songs
    language sql
    stable
    as $body$
      select %s
      from public.songs s
      where s.status = 'published'
        and (s.title ilike '%%' || p_q || '%%'
             or exists (select 1 from unnest(coalesce(s.aliases, '{}')) a where a ilike '%%' || p_q || '%%'))
    $body$;
  $fn$, sel_list);
end
$do$;
```

- 保留原有过滤逻辑（status=published、title/aliases 模糊匹配）与返回类型 `SETOF songs`（PostgREST 的 `albums(name)` embed 依赖表类型，前端无需改动）
- `%%` 是 format() 的转义百分号，生成后即为普通 `%`
- 仅把 `s.*` 换成显式列 + unlock_code 置 null：复合类型里该字段恒为 null，`?select=unlock_code` 也只能拿到 null

## 执行后验证

```sql
select pg_get_functiondef(oid) from pg_proc where proname = 'search_songs';
```

确认生成的 select 清单覆盖全部列、unlock_code 为 `null::类型` 占位。功能回归见 [revoke-unlock-code-column.md](revoke-unlock-code-column.md) v3 回归自测 ② 第三条。

## 执行顺序

见 [revoke-unlock-code-column.md](revoke-unlock-code-column.md) v3「执行顺序」：部署前端 → 收权 v3 → 本文件 v2 → 回归自测
