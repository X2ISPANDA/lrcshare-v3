# LrcShare V3

「全球最小滚动歌词分享网站」——收录歌词、专辑、艺术家信息，支持投稿审核、邮件通知、全站预渲染与开放 API。

## 功能

### 前台

- **首页**：单曲 / 专辑 / 歌手 / 歌词四维搜索，实时下拉建议，歌词命中片段预览，结果过多时进入全局搜索弹窗
- **歌曲页**：歌词区双下拉自由组合——**版本下拉**（多语言版本与各来源版本混排，可整体混合或单选）× **格式下拉**（LRC / 增强逐字 / 逐字 / TTML 四格式，无词级数据自动置灰）；外文歌词原文译文上下对照、日文假名注音、单选译文时自动补齐原文公共行（语气词 / 间奏）；TTML 版本结构化渲染——对唱左右分列、和声斜体、翻译随行；复制内容跟随当前所选版本与格式，页内嵌入 B 站 / YouTube 播放器，口令解锁隐藏歌词
- **歌词版本与 LunaBeat 来源**：歌词以版本容器存储（LRC / 增强逐字 / TTML 三类，每首歌任意多版本、多语言）；外部公开曲库 [LunaBeat TTML Hub](https://2755337087.github.io/ttml-hub/) 的清单由同步 Worker 抓取，**仅人工挑选合并**（挂到已有歌 / 新建展示 / 忽略，非全量搬运）后入库，来源版本带 LunaBeat 署名，来源侧下架时跟随回收；版本展示顺序由管理端「版本」弹框统一维护（填位次 + 置顶），一个序号同时控制歌曲页 TTML 版本下拉与 LRC 源下拉的混排顺序和默认选中
- **艺术家**：按名称、别名搜索，按身份类型筛选，A-Z 拼音分组 + 首字母索引；艺术家主页含社交平台链接，作品按演唱 / 作词 / 作曲 / 编曲分组
- **专辑页**：多碟专辑按 Disc 分组展示曲目表，点击直达歌词页
- **贡献者**：卡片墙 + 个人主页，记录贡献标签（歌词 / 翻译 / 校对 / LOGO / 文案 / 代码等）与作品列表
- **投稿**：单曲 / 批量双模式，老贡献者自动沿用资料、自助更新个人信息、多艺术家标注、专辑自动联想、编曲标注、支持视频链接；批量模式支持多选 LRC / ZIP 上传，公共字段预设 + 逐行覆盖
- **投稿查重**：提交补充版本前自动比对该歌全部已发布版本（含 TTML 转 LRC 跨格式）——原文前 3 个行开始时间戳毫秒级一致即判定照抄他人时间轴并拦截（手打时间戳不可能毫秒级相同）；仅提交更好译文的场景放行（需连原文带译文一起粘贴）；数据加载失败时不拦截，由审核端兜底
- **文章区**：站长随笔与公告，浏览量统计、分页浏览
- **其他**：评论（Twikoo）、关于页、友链、赞赏、更新日志（`/changelog`，按日期归档折叠）、开发文档（`/docs`，数据库架构演进记录）

### 管理后台

歌曲 / 专辑 / 艺术家 / 贡献者 / 文章 / 友链 / 赞赏 / 投稿审核 / 站点设置 / 歌词版本管理，桌面表格 + 移动端卡片双形态自适应，见 `src/views/admin/`。

- **歌词版本管理**：歌曲列表「版本」弹框列出该歌全部已发布版本（格式 / 贡献者 / 语言 / 来源），填位次或点置顶即可调整前台展示顺序，保存批量写回 `sort_order`（10/20/30… 归一化，新投稿版本无序号自动排最后）
- **TTML Hub 待确认队列**：同步 Worker 抓回的 LunaBeat 条目按 multi_candidate / low_confidence / conflict 分档，人工「挂到歌」（合并已有歌）/「新建展示」（确认建歌）/「忽略」三动作处理；已导入版本仅原文哈希变化时自动更新，Hub 侧删除跟随回收

- **艺术家即建即补**：录歌 / 审核中输入新艺术家回车即建，点头像弹窗补全 ID、资料；库内艺术家同样点头像就地更新（含社交链接）
- **批量审核**：批量投稿按批折叠为一行、一键审核整批；Excel 式表格逐列统一填充（可指定仅勾选行）、单元格逐行微调、展开行核对歌词、行级通过/拒绝混合决定、单曲封面独立设置、一键全部发布 / 批量拒绝（含原因通知）；专辑信息（专辑艺术家 / 封面 / 年份 / 简介）统一在专辑弹窗中编辑，已关联专辑差异写回、新专辑随发布创建；移动端自动切折叠卡片形态——一行一歌纵览全批、点开编辑，顶部吸附工具条（全选 / 勾选标拒），每个字段支持「应用到勾选行 / 全部行」

### 开放 API（api.lrcshare.com）

- **六组端点**：搜索 / 歌曲列表与详情 / 专辑 / 艺术家 / 歌词 / 全库目录快照
- **双查询模式**：关键词模糊搜索 + `title`/`artist` 结构化组合查询，歌名、艺术家别名全覆盖
- **字段对齐音频标签标准**（ID3v2 / Vorbis Comment）：作词 / 作曲 / 编曲 / 曲目号 / 碟号 / 流派 / 专辑艺术家一应俱全，封面统一取专辑封面
- **省额度设计**：全库目录快照供批量调用方本地预过滤；边缘缓存（列表 10 分钟 / 详情 1 小时）+ 单 IP 速率限制
- **文档站**：[api.lrcshare.com/docs](https://api.lrcshare.com/docs/)（VitePress），含快速开始、字段表、FAQ 与 Lyrico 客户端集成保姆教程
- **官方 Lyrico 插件**已提交至 [Lyrico-Plugins](https://github.com/Replica0110/Lyrico-Plugins) 仓库，搜索、打标、取词一步到位

### 邮件服务

- 新投稿即时通知站长
- 审核结果（通过 / 拒绝及原因）邮件通知投稿人
- 发送状态可感知：未配置 / 未留邮箱 / 失败均有明确提示，发信失败时常见 SMTP 错误（收件地址不存在 / 认证失败 / 被拒收等）翻译为中文结论并保留原始错误，无需再查错误码
- 通过 Netlify Functions（`netlify/functions/mailer.mjs`）实现，`SUPABASE_SERVICE_ROLE_KEY` 仅存于云端环境变量

## 技术栈

| 分类 | 技术 / 版本 |
| ---- | ----------- |
| 框架 | Vue 3.5 · Vue Router 5.2 · Pinia 4.0 |
| 语言 / 构建 | TypeScript 5.9 · Vite 8.2 · vite-ssg 28.3 |
| UI / 样式 | Element Plus 2.14 · Tailwind CSS 4.3 · unplugin-icons |
| 数据 | Supabase JS 2.11（Postgres + Auth + RLS） |
| 开放 API | Cloudflare Workers |
| 文档 | VitePress 1.6 |
| 邮件 | Netlify Functions · Nodemailer 7 |
| 其他 | marked 18（Markdown 渲染）· pinyin-pro 3.29（拼音分组）· fflate 0.8（ZIP 解压）· @vueuse/core 14 |
| TTML 解析 | [@applemusic-like-lyrics/ttml](https://github.com/amll-dev/applemusic-like-lyrics)（AMLL 官方，AGPL-3.0）· @xmldom/xmldom |

## 快速开始

```bash
npm install
cp .env.example .env   # 填入 Supabase 地址与 anon key
npm run dev            # 前台
npm run docs:dev       # API 文档站（可选）
```

环境变量说明见 [.env.example](.env.example)：

- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`：Supabase 项目凭据
- `VITE_MAIL_BASE`：邮件服务站点基地址，留空则跳过邮件通知

## 常用脚本

| 命令                   | 说明                    |
| ---------------------- | ----------------------- |
| `npm run dev`          | 前台本地开发             |
| `npm run build`        | vite-ssg 预渲染构建      |
| `npm run preview`      | 预览前台构建产物          |
| `npm run type-check`   | vue-tsc 类型检查         |
| `npm run docs:dev`     | API 文档站本地开发        |
| `npm run docs:build`   | API 文档站构建           |
| `npm run changelog:sync` | 更新日志同步：`src/data/changelog.ts` → `CHANGELOG.md`（通常无需手跑——提交含 changelog.ts 时 git pre-commit 钩子自动执行，钩子由 `npm install` 后 postinstall 自动启用） |

## 部署

- **前台主站**：GitHub Pages（lrcshare.com），构建流程见 `.github/workflows/deploy.yml`，数据每 6 小时自动同步一次
- **开放 API**：Cloudflare Workers（api.lrcshare.com），源码 [cloudflare/open-api.js](cloudflare/open-api.js) + [cloudflare/wrangler.toml](cloudflare/wrangler.toml)，`wrangler deploy` 部署（依赖打包进 bundle），需用 `wrangler secret put` 配置 `SUPABASE_URL` / `SUPABASE_ANON_KEY`
- **TTML Hub 同步**：独立 Cloudflare Worker（[cloudflare/ttml-sync/](cloudflare/ttml-sync/)，Worker 名 `lrcshare-ttml-sync`），抓取 LunaBeat TTML 曲库清单并增量下载，未导入条目一律进人工待确认队列；`TTML_HUB_BASE` 为普通变量，需 `wrangler secret put` 配置 `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `SYNC_TOKEN`（`/__sync?token=` 手动触发令牌）；本地可用 `node scripts/run-ttml-sync.mjs` 手动触发
- **API 文档站**：Cloudflare Pages（源站 lrcshare-v3.pages.dev），构建命令 `npm run docs:build`，输出目录 `docs/.vitepress/dist`；主入口 [api.lrcshare.com/docs](https://api.lrcshare.com/docs/)（由开放 API Worker 剥 `/docs` 前缀反代，VitePress `base: '/docs/'`）
- **邮件服务**：独立 Netlify 站点，仅部署 Functions，配置见 [netlify.toml](netlify.toml)，需在 Netlify 环境变量配置 `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`，并通过 `VITE_MAIL_BASE` 指向该站点
- **数据库变更**：SQL 演进文档存于 `sql/`，按主题整合为 01-09 九份（01 贡献者关系中间表、02 搜索演进、03 口令拆表、04 歌词行表、05 多版本与 TTML Hub、06 歌词写入事务化与语言治理、07 投稿与邮件、08 联系方式与外链、09 安全加固总纲），每份记录「出发点 → 怎么做 → 最终形态 → 踩坑」，站内可直接浏览：[lrcshare.com/docs](https://lrcshare.com/docs)（文档源即 `sql/` 目录，随主站发布自动同步）

## 目录结构

```
├── cloudflare/           # Cloudflare Workers：open-api（开放 API）+ ttml-sync（LunaBeat 曲库同步）
├── docs/                 # API 文档站（VitePress → api.lrcshare.com/docs/）
│   ├── api/              # 六组端点文档 + 数据对象字段表
│   └── guide/            # 快速开始 / Lyrico 客户端集成教程
├── netlify/functions/    # 邮件服务（mailer）
├── sql/                  # 数据库演进文档（01-09 主题整合，即站内 /docs 页面的数据源）
├── scripts/              # 构建/运维脚本（更新日志同步、TTML 同步手动触发等）
├── src/
│   ├── components/       # 组件（admin / common / contributor / layout / song / submit）
│   ├── composables/      # useAdminAuth / useSSGData
│   ├── data/             # 静态数据源（changelog.ts 更新日志，同步至 CHANGELOG.md 与 /changelog 页）
│   ├── layouts/          # 默认布局 / 后台布局
│   ├── lib/              # API 封装、Supabase 客户端、常量、类型、站内文档加载等
│   ├── router/           # 路由
│   ├── views/            # 页面（前台 + admin 后台）
│   └── styles/           # 全局样式
└── verify-ssg.mjs        # SSG 构建校验脚本
```

## 更新日志

完整历史见 [CHANGELOG.md](./CHANGELOG.md)，主站浏览版（按日期归档、可折叠展开）：[lrcshare.com/changelog](https://lrcshare.com/changelog)

## 赞助 / 支持

如果 LrcShare 对你有帮助，可以通过爱发电支持本站的持续运营：
👉 [https://afdian.com/a/x2ispanda](https://afdian.com/a/x2ispanda)

## 联系

发现问题可通过关于页面联系站长，或在任意歌曲页评论区留言。
