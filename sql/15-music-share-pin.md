# 15 · 歌曲分享「首页推荐位」置顶字段 pinned_until

> 状态：**已上线**

## 一句话现状

`music_shares` 表新增 `pinned_until` timestamptz 列，站长可把指定歌曲分享设为首页「新歌推荐」卡位的限时置顶。多条置顶时首页大卡每 30 秒轮播；到期自动回落随机，无需定时任务，也不删除分享本身。

## 一、字段语义

| 值 | 含义 |
|----|------|
| `NULL` | 未置顶，该位走原有随机逻辑 |
| `> now()` | 置顶中，多条按投稿时间轮播 |
| `<= now()` | 已到期，前端直接过滤，自动回落随机 |

## 二、安全设计

- `anon` 的 SELECT 是表级 RLS（`USING status='approved'`），新列随表可读，无需额外 GRANT。
- `anon` 的 INSERT 走列级白名单，`pinned_until` 不在其中——投稿人无法自行置顶，置顶权仅在站长后台（authenticated/service_role）。

## 三、索引

部分索引 `idx_music_shares_pinned_until` 只索引 `status='approved' AND pinned_until IS NOT NULL` 的行，供首页/曲库高效过滤。Postgres 不允许在索引谓词里直接用 `now()`，因此「是否到期」由前端按当前时间判断。

## 四、相关文件

- 迁移脚本：[`sql/15-music-share-pin.sql`](./15-music-share-pin.sql)
- 上游：[`sql/12-music-shares-evolution.md`](./12-music-shares-evolution.md)
