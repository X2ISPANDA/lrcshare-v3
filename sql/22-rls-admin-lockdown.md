# 22 · RLS 管理员收紧：越权漏洞修复

> 状态：**已上线**

## 一句话现状

后台所有「管理员可…」策略原本只校验 `auth.role() = 'authenticated'`，导致**任何注册登录用户**都能写入、删除核心业务数据（包括 API Key 表）。本次统一改为校验 `app_metadata.role = 'admin'`，共收紧 **21 张表、51 条策略**。

## 一、漏洞成因

原策略模式：

```sql
CREATE POLICY "歌曲：管理员可写入" ON public.songs
  FOR INSERT TO authenticated WITH CHECK (true);
```

`TO authenticated` 只表示「已登录」，不区分管理员与普通用户。任何注册用户拿到的 JWT 都满足该条件，因此可以直接调 Supabase REST API 写库，绕过前端后台的权限控制。

`api_keys` 表尤其严重（原为 `TO authenticated USING (true)`），意味着任何登录用户可增删改 API Key。

## 二、解决方案

新增判定函数 `public.is_admin()`：

```sql
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path TO public
AS $$
  SELECT COALESCE(auth.jwt() -> 'app_metadata' ->> 'role', '') = 'admin';
$$;
```

- 从 JWT 的 `app_metadata.role` 取值——`app_metadata` 用户端不可写（用户能改的是 `user_metadata`），无法伪造
- `SECURITY DEFINER` 保证函数以所有者权限执行，不受调用方 RLS 限制
- 所有策略改为 `USING (public.is_admin())` / `WITH CHECK (public.is_admin())`

## 三、覆盖范围

| 分类 | 表 |
|------|-----|
| 内容主表 | `songs`、`albums`、`artists`、`contributors`、`articles`、`sponsors`、`friends`、`friend_categories` |
| 歌词相关 | `lyric_versions`、`song_lyric_lines`、`song_lyric_doubts`、`song_secrets` |
| 投稿与贡献 | `submissions`、`song_contributors`、`album_contributors` |
| 密钥与管理 | `api_keys`、`settings`、`mail_logs`、`music_shares` |
| TTML 同步 | `ttml_hub_pending`、`ttml_hub_state` |

共计 21 张表、51 条策略。

## 四、前置操作：设置管理员

执行本脚本**前**必须给管理员账号设置 `app_metadata.role = 'admin'`，否则管理员自己也会被拒之门外：

```sql
UPDATE auth.users
SET app_metadata = jsonb_set(app_metadata, '{role}', '"admin"')
WHERE email = '你的管理员邮箱';
```

该字段只能由 service_role 或 Auth Admin API 修改，前端用户无法自行设置。

## 五、相关文件

- 迁移脚本：[`sql/22-rls-admin-lockdown.sql`](./22-rls-admin-lockdown.sql)
