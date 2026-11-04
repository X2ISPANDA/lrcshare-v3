# 23 · IP 黑名单：banned_ips 建表 + RLS + get_banned_ips()

> 状态：**待部署**（SQL 需在 Supabase 执行，随 Worker 用量分析一起上线）

## 一句话现状

开放 API 接入 Analytics Engine 用量分析后，可按「KEY → IP → 调用量」定位滥用来源。新建 `banned_ips` 表存放被封禁的 IP，管理员在后台一键封禁，Worker 入口读黑名单直接拒绝该 IP 的全部请求。**纯 IP 粒度**——不影响同一 KEY 下其他 IP 的正常调用。

## 一、表结构

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | uuid | 主键，自动生成 |
| `ip` | text | 归一化后的 IP（IPv4 原样 / IPv6 取 `/64` 段），**唯一约束** |
| `reason` | text | 封禁原因，如「KEY lyrico-官 单日调用 1.5 万次」 |
| `expires_at` | timestamptz | 到期时间；`NULL` = 永久封禁。到期自动解除 |
| `created_at` | timestamptz | 创建时间 |

约束：`char_length(ip)` 必须在 3 ~ 64 之间。

## 二、RLS 与权限

策略统一校验 `public.is_admin()`（`app_metadata.role = 'admin'`），与 [22 号脚本](./22-rls-admin-lockdown.md) 保持一致。

| 角色 | 权限 |
|------|------|
| 管理员（`is_admin()` 为真） | 可增删改查全部行 |
| 普通登录用户 | 无任何读写权限 |
| `anon` | 无直读权限（`REVOKE ALL`），只能通过 `get_banned_ips()` RPC 取生效中的 IP 列表 |
| `public` | `REVOKE ALL`（纵深防御） |

> **前置依赖**：`is_admin()` 由 22 号脚本创建，执行本脚本前必须先执行 `22-rls-admin-lockdown.sql`。

## 三、Worker 查询 RPC

`get_banned_ips()` 以 `SECURITY DEFINER` 执行，返回**生效中**（`expires_at IS NULL OR expires_at > now()`）的 IP 字符串数组，不含 `reason` 等管理字段。已过期行不返回，到期自动解除封禁。

Worker 侧读取流程与 `get_active_api_key_hashes` 完全一致：

```
读 KV（key: banned_ips）
  ├─ 命中 → 直接返回 Set
  └─ 未命中 → 调 Supabase RPC → 写回 KV（TTL 5min）
```

正常情况靠后台封禁后调 `/internal/refresh-ips` 删 KV 即时生效，TTL 5min 只是兜底。

## 四、IP 归一化约定（关键）

`ip` 列存的是**归一化结果**，Worker 端 `normalizeIpForBan()` 必须用同一套规则，否则「存的」和「比的」对不上，封禁直接失效。

| IP 类型 | 存储格式 | 示例 |
|---------|---------|------|
| IPv4 | 原样 | `1.2.3.4` |
| IPv6 | 前 4 组 + `::/64` | `2001:db8:85a3:0::/64` |

两个原因：

1. 完整 IPv6 最长 39 字符，超出 Analytics Engine 的 32 字节 blob 上限，会被截断导致不同 IP 塌缩成同一个 → 误封
2. `/64` 是 IPv6 封禁的常规粒度，覆盖同一宽带用户的整个 IPv6 分配段

非法 IPv6（无法展开成 8 组）返回空字符串，不做退化截断——避免多个不同 IP 归一化成同一个值造成误封。

## 五、相关文件

- 迁移脚本：[`sql/23-banned-ips.sql`](./23-banned-ips.sql)
- Worker 实现：`cloudflare/open-api.js`（`normalizeIpForBan` / `getBannedIps` / `handleRefreshIps` / `reportUsage` / `handleUsage`）
