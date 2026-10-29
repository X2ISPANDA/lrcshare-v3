# 11 · 贡献者账号合并 RPC（后台「合并账号」功能）

> 状态：**已上线**

## 一句话现状

后台贡献者管理新增「合并账号」功能：把两个重复的贡献者账号合并为一个，保留账号接收逐字段挑选后的个人资料，源账号的全部作品引用（歌曲、歌词版本、投稿、歌曲分享）整体转给保留账号，然后删除源账号。单次 RPC 调用封装为单个事务，任一环节失败整体回滚，不会出现半写状态。

## 一、合并语义

合并三步，全部在一个事务里完成：

1. **写保留账号资料**：前端把「每个字段选左还是选右」解析成最终值，通过 `p_profile` 传入，逐字段覆盖保留账号。`is_owner`（站长标识）与 `created_at` 不参与合并，保留账号自身属性。
2. **引用置换**：把源账号在 `songs` / `lyric_versions` / `submissions` / `music_shares` 四张表的 `contributor_id` 全部改成保留账号 ID。
3. **删除源账号**：引用已全部置换，删除源账号本人。

## 二、p_profile 契约

前端传入 8 个必填键，类型严格校验：

| 键 | 类型 | 说明 |
|----|------|------|
| `name` | text | 昵称，去空白后非空 |
| `avatar` | text \| null | 头像 URL |
| `bio` | text \| null | 简介 |
| `public_bio` | boolean | 简介是否公开 |
| `contact_value` | jsonb object | 联系方式，允许 `{}` |
| `public_contact` | boolean | 联系方式是否公开 |
| `tags` | jsonb text[] | 标签数组，允许 `[]` |
| `sort` | integer | 排序权重 |

守卫要求 8 个键必须齐全且类型正确，缺失键直接拒绝，避免「漏传 = 静默置空」把保留账号资料清掉。

## 三、安全兜底

1. **守卫 4 兜底扫描**：动态扫描所有引用 `contributors(id)` 的外键（排除已知四表），若源账号在其他表还有引用，中止回滚。防止将来新增了引用表却忘了同步本函数。
2. **权限收口**：函数无 RLS，EXECUTE 是唯一防线。从 `PUBLIC` 和 `anon` 收回执行权，只授予 `authenticated`（本站注册关闭，即管理员）。
3. **明确不处理**：`submissions.published_refs`（发布产物快照）不改，避免撤回旧投稿时误删目标账号；`lyric_versions.source_credit` 外部署名自由文本不动。

## 四、返回值

```json
{
  "source_id": "...", "source_name": "...",
  "target_id": "...", "target_name_old": "...", "target_name": "...",
  "songs_moved": 5, "versions_moved": 3,
  "submissions_moved": 2, "music_shares_moved": 1
}
```

供前端结果提示使用。

## 五、相关文件

- 迁移脚本：[`sql/11-contributor-merge.sql`](./11-contributor-merge.sql)
- 后续补充：[`sql/14-contributor-merge-music-shares.sql`](./14-contributor-merge-music-shares.sql)（纳入 music_shares）
