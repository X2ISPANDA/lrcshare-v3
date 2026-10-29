# 18 · 专辑封面迁移：阿里云 OSS → B站图床

> 状态：**已执行完成**

## 一句话现状

25 张专辑封面由原阿里云 OSS 地址批量迁移到 B站开放平台图床（`i0.hdslb.com`）。仅更新 `albums.cover` 一列，其他列不动。歌曲卡片、歌曲详情等位置的专辑封面均为查询时实时 join `albums` 表取得，提交后全站自动生效。

## 一、迁移范围

25 个专辑 ID，包括：
- 火炭丽琪、你说之后会找我（my little airport）
- ansasaki 系列 17 张（001-017）
- 翘脚老板、勒是雾都（L4WUDU）
- 半斤八两（徐官捷）、赵小雷（赵雷）、落泪的戏子（郑智化）、一起又看流星雨 OST

其中 `alb_ansaski_013` 与 `alb_ansaski_014` 在来源清单中本就使用同一张封面 URL，按清单原样写入。

## 二、安全保障

- 使用会话级临时表 `ON COMMIT DROP`，执行完自动清理，不留任何库对象。
- 更新前先校验 25 个 ID 全部存在，缺任一 ID 直接 `RAISE EXCEPTION` 整体回滚，杜绝半更新。
- 纯 DML（UPDATE），不涉及表结构、GRANT、RLS 任何变更。

## 三、相关文件

- 迁移脚本：[`sql/18-albums-cover-bilibili.sql`](./18-albums-cover-bilibili.sql)
