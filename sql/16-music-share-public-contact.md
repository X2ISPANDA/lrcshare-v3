# 16 · 歌曲分享投稿「联系方式是否公开」意愿字段

> 状态：**已上线**

## 一句话现状

`music_shares` 表新增 `submitter_public_contact` boolean 列（默认 false），投稿人在歌曲分享投稿页自行勾选是否公开联系方式，意愿随投稿记录保存。站长审核通过且因此「新建」贡献者账号时，系统按该意愿写入 `contributors.public_contact`。

## 一、字段语义

| 值 | 含义 |
|----|------|
| `false`（默认） | 不公开，联系方式仅站长在审核时可见 |
| `true` | 审核通过并新建贡献者后，联系方式展示在音乐人主页/自荐卡片 |

历史行一律 false（不洗数据）。

## 二、绑定已有贡献者的行为

- 绑定已有贡献者时**不覆盖**其既有公开设置。
- 投稿人勾错可自行提交资料更新，或由站长在贡献者管理中修改。
- 站长审核界面不展示此字段，避免审核员手动干预。

## 三、安全说明

- 列级 GRANT 为并集：仅把新列追加进 `anon` 的 INSERT 白名单，不影响 12/13 号既有列授权。
- `anon` 的 SELECT 是表级 RLS（`USING status='approved'`），该列随表可读，但前台查询不引用它，仅后台审核弹窗回填使用，无敏感信息（只是布尔意愿）。

## 四、相关文件

- 迁移脚本：[`sql/16-music-share-public-contact.sql`](./16-music-share-public-contact.sql)
- 上游：[`sql/12-music-shares-evolution.md`](./12-music-shares-evolution.md)
