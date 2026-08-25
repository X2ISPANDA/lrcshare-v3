# SQL 方案：unlock_code 列级收权（anon 不可读）

日期：2026-08-25
状态：已确认，待部署前端后在 Supabase SQL Editor 执行

## 背景

`unlock_code` 目前随 `select *` 全量下发，泄露路径：

1. `getSong`（最严重）：SSG 构建也走此查询，口令被序列化进每首隐藏歌曲的公开 HTML 源码
2. `getArtistSongs` / `getAlbumSongs` / `searchSongs`：艺术家页、专辑页、搜索的接口响应里都带口令明文

前端已改造完毕：以上 4 处全部改为显式列（`SONG_PUBLIC_FIELDS`，不含 `unlock_code`），口令校验只走 `verify_hidden_unlock_code` RPC（见 [verify-hidden-unlock-code.md](verify-hidden-unlock-code.md)）。`lrc_text` 按需求保留可读（歌词本身就是要给人看的）。

## 变更内容

```sql
-- 匿名角色收回 unlock_code 列的 SELECT 权限（直接查表/任意接口带该列均报 permission denied）
revoke select (unlock_code) on public.songs from anon;
```

无表结构变更，无数据变更。

## 说明与顺序要求

- **必须先部署前端，再执行本 SQL**：执行后旧前端的 `select *` 会整体报错，歌曲页 / 专辑页 / 艺术家页 / 搜索全部不可用
- **管理后台不受影响**：admin 登录走 Supabase Auth session（`authenticated` 角色），编辑表单照常读写 `unlock_code`
- **前提自查**：需确认 Supabase Auth 未开放自助注册（Authentication → Sign up 关闭）。若开放，任何人注册即获得 `authenticated` 身份照读口令
- 与 `verify-hidden-unlock-code.md` 的 RPC 可同批执行

## 遗留自查项（可能绕过列级权限）

`search_songs` RPC 若返回 `SETOF songs` 整行（尤其 `security definer`），攻击者直接调 `POST /rpc/search_songs?p_q=x&select=unlock_code` 可能绕过列级收权。请执行下面 SQL 把定义发我确认：

```sql
select proname, prosecdef, pg_get_functiondef(oid) as def
from pg_proc
where proname = 'search_songs';
```

若命中（返回整行），我再出改造方案（改为显式列返回，不含 `unlock_code`）。
