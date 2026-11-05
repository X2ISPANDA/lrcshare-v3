# 24 · API Key 明文入库存档

> 状态：**已上线**（Supabase 已执行）

## 一句话现状

在 [21 号脚本](./21-api-keys.md)基础上，给 `api_keys` 表增加 `key_plain` 列保存 API Key 明文。历史 Key 明文已永久丢失、保持 `NULL`；新签发的 Key 同时写入哈希与明文。**校验逻辑不变**——Worker 仍用 SHA-256 哈希比对，明文只用于后台展示和 Cloudflare WAF 白名单维护。

## 一、为什么改

21 号脚本的设计是「明文只显示一次，库内只存 SHA-256」，副作用是管理员自己也再也查不回明文。实际运维中这带来两个硬阻塞：

1. **WAF 白名单**：Cloudflare 自定义规则只能匹配明文字符串，拿哈希配不了
2. **配置找回**：客户端丢失 Key 后，只能删旧签新，无法补发

原顾虑是「拖库后攻击者拿到明文」。但现实中只要攻击者能突破 admin RLS，就已经可以直接改表、调用 RPC 或读全部数据，哈希并不能形成有效防线；且 Key 本就随客户端分发。因此明文存档的增量风险可忽略。

## 二、表结构变更

在 21 号表结构基础上新增一列：

| 列 | 类型 | 说明 |
|----|------|------|
| `key_plain` | text | API Key 明文；历史 Key 为 `NULL` |

其余列（`id` / `name` / `key_hash` / `key_prefix` / `status` / `note` / `created_at` / `updated_at`）不变。

## 三、安全模型

| 角色 | 权限 |
|------|------|
| 管理员（`authenticated`） | 可读全部字段，含 `key_plain` |
| `anon` | 无直读权限，只能通过 `get_active_api_key_hashes()` 取哈希数组 |

- RLS 沿用 21 号的策略（`FOR SELECT/INSERT/UPDATE/DELETE TO authenticated USING (true)`），新列自动继承，**无需新增策略**
- `get_active_api_key_hashes()` 不变，仍只返回 `key_hash` 数组，不暴露明文
- Worker 校验链路不变：`SHA-256(key)` → 与 KV 中 active hash 比对

## 四、历史数据回填

脚本按 `key_hash` 精确匹配回填了已知明文的 3 条记录（依赖 pgcrypto 的 `digest()`）：

| key_prefix | 状态 |
| --- | --- |
| `ls_b9160` | 已回填 |
| `ls_28060` | 已回填 |
| `ls_7d6c93` | 已回填 |

> 未回填的行说明明文已不可考，只能删除后重新签发。

## 五、相关文件

- 迁移脚本：[`sql/24-api-key-plaintext.sql`](./24-api-key-plaintext.sql)
- 前序脚本：[`sql/21-api-keys.sql`](./21-api-keys.sql) / [`sql/21-api-keys.md`](./21-api-keys.md)
- 后台页面：`src/views/admin/ApiKeysView.vue`
- 类型定义：`src/lib/types.ts`（`ApiKey.key_plain`）
