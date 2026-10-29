# 21 · API Key 管理：api_keys 建表 + RLS

> 状态：**已上线**

## 一句话现状

开放 API 从「匿名调用」升级为「注册制 API Key + catalog-first」。新建 `api_keys` 表存储客户端的 API Key（SHA-256 哈希，不存明文），管理员在后台手动签发和封禁。Cloudflare Worker 查此表验证调用方身份。

## 一、表结构

| 列 | 类型 | 说明 |
|----|------|------|
| `id` | uuid | 主键，自动生成 |
| `name` | text | 客户端名称（如「Lyrico 插件」） |
| `key_hash` | text | API Key 的 SHA-256 哈希（64 位十六进制），不存明文 |
| `key_prefix` | text | Key 前 8 位，后台列表识别用，不用于校验 |
| `status` | text | `active` / `banned`，默认 active |
| `note` | text | 备注（谁在用、联系方式） |
| `created_at` | timestamptz | 创建时间 |
| `updated_at` | timestamptz | 更新时间，触发器自动维护 |

约束：`key_hash` 长度必须 64，`key_prefix` 长度必须 8。

## 二、安全模型

- **RLS 开启**，仅 `authenticated`（管理员）可增删改查；`anon` 完全不可访问。
- **纵深防御**：`REVOKE ALL ON api_keys FROM PUBLIC, anon` 双保险。
- **不存明文**：`key_hash` 为 SHA-256 十六进制串，不可逆。
- **封禁机制**：`status` 置 `banned`，配合 Worker 端 KV 缓存即时失效。

## 三、Worker 查询 RPC

`get_active_api_key_hashes()` 以 `SECURITY DEFINER` 执行，仅返回 `active` 状态的 `key_hash` 数组（不含 name/note 等）。允许 `anon` 调用（Worker 端用 anon key）。

## 四、相关文件

- 迁移脚本：[`sql/21-api-keys.sql`](./21-api-keys.sql)
- Worker 实现：`cloudflare/open-api.js`
