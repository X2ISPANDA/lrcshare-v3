# 20 · 图片灾备补全：修复 5 个公共 RPC 的备份列

> 状态：**已上线**

## 一句话现状

19 号脚本给 `songs` / `artists` / `contributors` 加了 `*_backup` 列后，5 个公共 RPC 的返回类型与内部查询列数不匹配，导致线上搜索报错、前台经 RPC 拿到的数据无法被图片源拦截器替换。本迁移补全这 5 个函数的备份列。

## 一、问题清单

| 函数 | 问题 | 修复方式 |
|------|------|---------|
| `search_songs` | `RETURNS SETOF songs`（表已 21 列），内部 `RETURN QUERY` 仍是旧 20 列 → 42804 失配 | 内部查询补 `cover_backup`，`OR REPLACE` 即可 |
| `search_songs_structured` | 同上 | 同上 |
| `get_artist_songs` | `RETURNS TABLE` 显式列不含 `cover_backup` | DROP 后重建，返回表加 `cover_backup text` |
| `get_top_artists` | `RETURNS TABLE` 不含 `avatar_backup` | DROP 后重建，加 `avatar_backup text` |
| `get_top_contributors` | `RETURNS TABLE` 不含 `avatar_backup` | DROP 后重建，加 `avatar_backup text` |

## 二、技术要点

- 前两个函数声明 `RETURNS SETOF songs`，表结构变更后只需补内部查询列，`CREATE OR REPLACE` 即可。
- 后三个函数是匿名 `RETURNS TABLE` 返回类型，加列 = 改返回类型，`CREATE OR REPLACE` 不允许，必须 `DROP` 后重建。
- DROP 会清掉 EXECUTE 授权，末尾重新 `GRANT` 给 `anon, authenticated`（与原公共函数授权口径一致；`service_role` 本就有全量执行权限）。

## 三、相关文件

- 迁移脚本：[`sql/20-image-backup-rpc.sql`](./20-image-backup-rpc.sql)
- 上游：[`sql/19-image-backup.md`](./19-image-backup.md)
