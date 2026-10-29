# 17 · 歌曲分享投稿对齐歌词投稿：更新/清空资料动作 + 简介

> 状态：**已上线**

## 一句话现状

`music_shares` 表新增 3 个字段，与歌词投稿（`submissions`）链路对齐：投稿人选中已有贡献者后，可勾选「更新我的信息」或「清空我的信息」，并可携带简介文本。此前歌曲分享没有这些字段，选了已有账号的音乐人填的资料会被后台忽略，前端却没有锁定，造成「每次都要填」的误导。

## 一、新增字段

| 字段 | 类型 | 默认 | 说明 |
|------|------|------|------|
| `submitter_request_update` | boolean | false | 审核通过时用本次提交的邮箱/简介/联系方式/公开意愿全量覆盖该贡献者资料 |
| `submitter_request_clear` | boolean | false | 审核通过时把该贡献者除 ID/昵称/标签外的资料字段置空（与 update 互斥） |
| `submitter_bio` | text | NULL | 本次提交的简介文本，新建贡献者时写入 `contributors.bio`，勾选更新时一并覆盖 |

历史行两个布尔意愿自动为 false，简介为 NULL，不洗数据。

## 二、安全说明

- 三列并入 `anon` 列级 INSERT 白名单（GRANT 为列并集，重复执行安全）。
- 仅当 `contributor_id` 指向已有贡献者时，update/clear 意愿才有意义；新建贡献者时 `submitter_bio` 直接写入 `contributors.bio`。

## 三、相关文件

- 迁移脚本：[`sql/17-music-share-profile-requests.sql`](./17-music-share-profile-requests.sql)
- 上游：[`sql/12-music-shares-evolution.md`](./12-music-shares-evolution.md)
