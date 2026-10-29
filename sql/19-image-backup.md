# 19 · 全站图片灾备：7 张表新增 OSS 备份列

> 状态：**已上线**（随提交 1e05d47）

## 一句话现状

为防止外链图片失效，全站 7 张表新增 8 个 `*_backup` 列，存储图片在阿里云 OSS 的备份 URL。前台图片源拦截器在备份列非空时自动替换为 OSS 地址，空时保留原外链。后台「系统设置」提供图片源一键切换开关。

## 一、备份列映射

| 表 | 主列 | 备份列 |
|----|------|--------|
| `albums` | `cover` | `cover_backup` |
| `artists` | `avatar` | `avatar_backup` |
| `artists` | `bg_image` | `bg_image_backup` |
| `songs` | `cover` | `cover_backup` |
| `contributors` | `avatar` | `avatar_backup` |
| `articles` | `cover` | `cover_backup` |
| `friends` | `avatar` | `avatar_backup` |
| `music_shares` | `cover_url` | `cover_url_backup` |

全部为可空 text，未备份时为 NULL。

## 二、工作流程

1. `scripts/backup-images.mjs` 扫描各表主列的外链图片，下载后上传至阿里云 OSS，把 OSS URL 写回对应 `*_backup` 列。
2. 前台 `src/lib/supabase.ts` 的 `swapImageFields` 拦截器在查询时自动把主列替换为备份列（非空时）。
3. 后台 `settings.image_source` 开关控制全站使用「外链」还是「OSS 备份」。

## 三、归档说明

本文件在 1e05d47 提交时因操作疏漏为 0 字节（DDL 当时直接在 Supabase 执行，未入库归档）。后据线上库验证、`backup-images.mjs` 的 TARGETS、`adminApi.ts` 的 IMAGE_BACKUP_COLUMNS、`supabase.ts` 的 IMAGE_FIELD_MAP 四处证据 1:1 重建，仅含可证实的加列 DDL。

## 四、相关文件

- 迁移脚本：[`sql/19-image-backup.sql`](./19-image-backup.sql)
- 补全 RPC：[`sql/20-image-backup-rpc.sql`](./20-image-backup-rpc.sql)
- 备份脚本：`scripts/backup-images.mjs`
