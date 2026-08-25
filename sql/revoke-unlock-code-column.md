# SQL 方案：unlock_code 列级收权 v3（动态列授权，修复 v2 grant 未生效）

日期：2026-08-25
状态：已确认（v3），待执行

## 版本沿革

- **v1**（列级 revoke）：空操作。Supabase 给 anon 的是表级授权，列级 revoke 撤不掉
- **v2**（表级收回 + 手写列清单重授）：revoke 生效了，但 **grant 大概率没有成功执行**。证据：回归自测 ② 报 `permission denied for table songs`（表级措辞）= anon 对 songs 零可用读权限。最可能原因：手写列清单从 types.ts 推导，与真实表结构不符，grant 报 "column does not exist" 被跳过（整段粘贴执行时 revoke 在前已生效）
- **v3**：列清单改为**从 pg_attribute 动态生成**，不再依赖手写，自动适配真实表结构

## v3 变更内容（一键脚本，可重复执行）

```sql
-- 1) 收回表级（幂等，重复执行无害）
revoke select on public.songs from anon;

-- 2) 动态按列重授：除 unlock_code 外的全部列（列清单从系统目录生成）
do $do$
declare
  col_list text;
begin
  select string_agg(quote_ident(attname), ', ' order by attnum)
    into col_list
  from pg_attribute
  where attrelid = 'public.songs'::regclass
    and attnum > 0
    and not attisdropped
    and attname <> 'unlock_code';

  execute format('grant select (%s) on public.songs to anon', col_list);
end
$do$;
```

## 执行顺序

1. 部署最新前端（songs 查询已换成显式列的版本）
2. 执行本文件 v3（revoke + 动态 grant）
3. 执行 [search-songs-hardening.md](search-songs-hardening.md) v2（动态重建 search_songs）
4. 回归自测（下方修正版）

## 回归自测（v3 修正：count(*) → count(id)）

v2 自测里的裸 `count(*)` 不引用具体列，列级授权模式下可能仍要求表级权限而报表级错误——**不影响线上**（前端所有统计请求都带具体列，如 `select('id', { count: 'exact', head: true })`），但会让裸 SQL 自测误报，故改为 count(id)。

```sql
-- ① 预期报 permission denied（收权生效的标志；单独跑，错误会中断事务）
begin;
set local role anon;
select unlock_code from public.songs limit 1;
rollback;

-- ② 预期全部通过：授权列可读 / 带列统计可用 / 单曲搜索正常且 unlock_code 恒为 null
begin;
set local role anon;
select id, title, lrc_text from public.songs where status = 'published' limit 3;
select count(id) from public.songs where status = 'published';
select id, unlock_code from public.search_songs('a') limit 3;
rollback;
```

## 说明

- authenticated / service_role 不动：管理后台照常读写 unlock_code（注册入口已关闭）
- 动态 grant 授予「除 unlock_code 外的全部列」，比前端当前实际使用的列更宽——将来 songs 加新列也不用回来补授权（unlock_code 除外）
- 若 ① 未报错反而返回数据 → 存在其他授权来源，把结果发我排查：
  ```sql
  select relacl from pg_class where relname = 'songs';
  ```
