# 25 · 移除 ttml-hub 同步（LunaBeat TTML HUB 连接）

> 状态：**待部署**（SQL 需在 Supabase 执行；代码删除已随本次提交落地）

## 一句话现状

终止与第三方歌词库 **LunaBeat TTML HUB** 的同步接入：删除同步链路（Cloudflare Worker / GitHub Actions 定时任务 / Node 入口脚本）与后台「TTML Hub 同步管理」页，删除同步过程使用的两张中间表。**TTML 作为歌词格式保留**，已入库的 `source='ttml-hub'` 歌词版本及其「来自 TTML Hub」来源署名不受影响。

## 一、为什么移除

1. **给网站轻量化**：移除一套只服务于外部歌词库接入的同步基础设施（Worker + 定时任务 + 两张同步表 + 后台管理页），减少维护面与运行成本。
2. **歌词重叠量低**：该库与lrcshare重叠量较低。

## 二、代码删除

| 位置                                | 说明                                         |
| --------------------------------- | ------------------------------------------ |
| `cloudflare/ttml-sync/`（整目录）      | Worker（`worker.js`）+ 部署配置（`wrangler.toml`） |
| `.github/workflows/ttml-sync.yml` | 每 6 小时的同步定时任务                              |
| `scripts/run-ttml-sync.mjs`       | Node 本地/CI 同步入口                            |
| `src/views/admin/TtmlHubView.vue` | 后台「TTML Hub 同步管理」页                         |
| `src/router/index.ts`             | 路由 `admin-ttml-hub`                        |
| `src/layouts/AdminLayout.vue`     | 侧边栏菜单项「TTML Hub」                           |
| `src/lib/constants.ts`            | 常量 `TTML_HUB_BASE`（删除后无引用）                 |

## 三、数据库变更

删除两张仅由同步过程使用的中间表（见 [`25-remove-ttml-hub-sync.sql`](./25-remove-ttml-hub-sync.sql)）：

| 表                  | 用途                               |
| ------------------ | -------------------------------- |
| `ttml_hub_pending` | 待确认匹配队列                          |
| `ttml_hub_state`   | 同步游标（revision / etag / snapshot） |

## 四、保留内容（不删）

- `lyric_versions` 表：`source='ttml-hub'` 的已入库歌词版本、`external_id`、`content_hash`、`ttml_text` 全部保留
- 前台展示：`source='ttml-hub'` 版本的「来自 TTML Hub」署名照常显示
- TTML 歌词格式：前端渲染（`TtmlReviewPreview.vue` / `LyricReviewPreview.vue`）、解析（`detectTtmlLangs`）、语言规则（`cloudflare/shared/lang.mjs`）均与同步无关，保留
- 前序演进记录 [`05-ttml-hub-evolution.md`](./05-ttml-hub-evolution.md) 保留作历史

## 五、相关文件

- 迁移脚本：[`sql/25-remove-ttml-hub-sync.sql`](./25-remove-ttml-hub-sync.sql)
- 前序演进：[`sql/05-ttml-hub-evolution.md`](./05-ttml-hub-evolution.md)
