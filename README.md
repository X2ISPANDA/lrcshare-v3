# LrcShare V3

「全球最小滚动歌词分享网站」——收录歌词、专辑、艺术家信息，支持多语言逐字歌词、投稿审核、听众歌曲分享、全站图片灾备、开放 API 与全站静态预渲染。

- 主站：[lrcshare.com](https://lrcshare.com)（GitHub Pages，558+ 页 SSG 预渲染）
- 开放 API：[api.lrcshare.com](https://api.lrcshare.com) ｜文档：[api.lrcshare.com/docs](https://api.lrcshare.com/docs/)
- 仓库：[X2ISPANDA/lrcshare-v3](https://github.com/X2ISPANDA/lrcshare-v3)

## 功能

### 歌词核心

- **歌曲页**：歌词区双下拉自由组合——**版本下拉**（多语言版本与各来源版本混排，可整体混合或单选）× **格式下拉**（LRC / 增强逐字 / 逐字 / TTML 四格式，无词级数据自动置灰）；外文歌词原文译文上下对照、日文假名注音与中文/粤拼逐字注音、单选译文时自动补齐原文公共行（语气词 / 间奏）；TTML 版本结构化渲染——对唱左右分列、和声斜体、翻译随行、段落（songPart）分组；复制内容跟随当前所选版本与格式，页内嵌入 B 站 / YouTube 播放器，口令解锁隐藏歌词
- **多语言歌词体系**：歌词行表按「语言 × 类型（原文/译文/罗马音）」存储，一首歌任意多版本、多语言；LRC / TTML 上传自动识别语言并拆轨（29 种语言标注、15 个文字系统自动检测）；音译语言码全线遵循 BCP47（`zh-Latn-jyutping` / `ja-Latn` 等，不折叠不臆造）
- **歌词版本与 LunaBeat 来源**：外部公开曲库 [LunaBeat TTML Hub](https://2755337087.github.io/ttml-hub/) 的清单由同步 Worker 抓取，**仅人工挑选合并**（挂到已有歌 / 新建展示 / 忽略，非全量搬运）后入库，来源版本带 LunaBeat 署名，来源侧下架时跟随回收；版本展示顺序由管理端「版本」弹框统一维护（填位次 + 置顶），一个序号同时控制歌曲页 TTML 版本下拉与 LRC 源下拉的混排顺序和默认选中
- **歌词库**（`/songs`）：全站收录歌曲一页浏览，每页 30 张卡片服务端分页，歌名 / 歌手 / 专辑搜索，分页与搜索状态写入 URL，首页静态预渲染、翻页零刷新

### 搜索与浏览

- **首页**：单曲 / 专辑 / 歌手 / 歌词四维搜索，实时下拉建议，歌词命中片段预览，结果过多时进入全局搜索浮层；终版权重排序（整串连续命中 > 名称全等 > 整词 / 子串分档），召回层为 `search_text` 冗余列 + pg_trgm GIN 索引，为万级曲库储备
- **艺术家**：按名称、别名搜索，按身份类型（演唱 / 作词 / 作曲 / 编曲）筛选，A-Z 拼音分组 + 首字母索引；艺术家主页含社交平台链接，作品按四种身份分组
- **专辑页**：多碟专辑按 Disc 分组展示曲目表，点击直达歌词页
- **贡献者**：卡片墙 + 个人主页，记录贡献标签（歌词 / 翻译 / 校对 / LOGO / 文案 / 代码等）与作品列表；重复账号可由管理员在后台事务化一键合并
- **其他**：文章区（浏览量统计、分页）、友链、赞赏页、关于页、评论（Twikoo）、更新日志（`/changelog`，按日期归档折叠）、开发文档（`/docs`，数据库架构演进记录，随仓库发布自动同步）

### 歌曲分享与全站播放器

- **歌曲分享墙**（`/music-shares`）：听众与音乐人可分享单曲或整张专辑，粘贴链接当场识别标题、艺人、封面并可试播验证；同曲同平台与跨平台同名同歌手双重查重；投稿进审核队列，通过后才上墙
- **三家平台**：网易云音乐（支持单曲 / 专辑识别、逐句歌词、专辑曲目快照自动联播）、YouTube、SoundCloud；播放链路**服务端实时换链，不保存任何音频直链**，会员 / 无版权曲目返回明确中文提示
- **专辑联播**：专辑链接自动拉取完整曲目清单作为快照入库，卡片带「专辑 · N 首」角标，全局播放器显示「专辑第 X/Y 首」，队列面板列出整张专辑，支持上下首、点击定位、播完自动联播
- **全局悬浮播放器**：左下角 APlayer 风格悬浮球（封面播放中旋转）→ 展开粉白卡片（旋转封面 / 进度 / 音量 / 逐句歌词面板 / 队列）；SPA 单例跨页保活、站内跳转不中断；列表循环 / 单曲循环 / 随机播放三态模式记忆在本地；首次进站随机加载一首（遵循浏览器自动播放策略，不做静音绕过）
- **音乐人自荐**：创作者分享本人原创作品显示琥珀色「音乐人」标签与公开联系方式（链接类一键跳转、号码类一键复制，填哪些展示哪些），自荐作品首页顶部跑马灯展示；普通听众分享仍标注「推荐人」，两套体系互斥
- **首页音乐推荐**：全库随机推荐卡（封面 / 平台 / 推荐理由 / 播放 / 换一首）+ 站长限时推荐位（后台设截止时间，有效期内固定卡位、多条 30 秒轮播、到期自动回落随机，不下线分享本身）；底部优秀贡献者头像通栏，纯歌曲分享账号不进贡献者榜单（与歌词作品物理隔离）

### 投稿体系

- **歌词投稿**：单曲 / 批量双模式，老贡献者自动沿用资料、多艺术家标注、专辑自动联想、编曲标注、视频链接；批量模式支持多选 LRC / ZIP 上传，公共字段预设 + 逐行覆盖，「含音译」逐行勾选
- **歌曲分享投稿**：平台按推荐优先级分组并标注各家局限，识别结果可当场试播自证；投稿人可自选是否公开联系方式，可借投稿「更新 / 清空」本人资料（两个投稿页共用同一身份区组件，意愿互斥，审核端不展示）
- **投稿时间轴查重**：提交补充版本前自动比对该歌全部已发布版本（含 TTML 转 LRC 跨格式）——原文前 3 行开始时间戳毫秒级一致即判定照抄他人时间轴并拦截；仅提交更好译文（连原文带译文一起粘贴）放行；数据加载失败不拦截，由审核端兜底
- **统一时长组件**：全链路（6 个输入点 + 存量数据）收口为 `mm:ss`，分 / 秒双数字框、秒 0–59 硬限制，空值统一为 null

### 管理后台

歌曲 / 专辑 / 艺术家 / 贡献者 / 文章 / 友链 / 赞赏 / 歌词投稿审核 / 歌曲分享审核 / TTML Hub 队列 / 歌词存疑 / 邮件日志 / 站点设置，桌面表格 + 移动端卡片双形态自适应，见 `src/views/admin/`。

- **批量审核**：批量投稿按批折叠一键整审；Excel 式表格逐列统一填充（可指定仅勾选行）、单元格逐行微调、行级通过 / 拒绝混合决定；移动端自动切折叠卡片，顶部吸附工具条
- **歌词版本管理**：「版本」弹框列出全部已发布版本，填位次或置顶即可调整前台顺序，保存批量归一化写回 `sort_order`
- **TTML Hub 待确认队列**：抓回条目按 multi_candidate / low_confidence / conflict 分档，人工「挂到歌」/「新建展示」/「忽略」；已导入版本仅原文哈希变化时自动更新，Hub 侧删除跟随回收
- **歌曲管理服务端分页**：10/20/50 条每页 + 跨歌名 / 别名 / 歌手 / 专辑名搜索下推数据库（专用 RPC，执行权已从 anon 收回）
- **合并贡献者**：单事务 RPC 完成「字段 8 项左右二选一 → 转移三类作品外键（含歌曲分享）→ 删除源账号」，四道守卫 + 动态外键扫描，任一步失败整体回滚
- **歌曲分享管理**：手动识别添加、审核通过 / 拒绝（带邮件通知）、编辑、撤回、删除、查重提示，通过后幂等追加「歌曲分享」标签
- **艺术家即建即补**：录歌 / 审核中输入新艺术家回车即建，点头像弹窗就地补全 ID、资料与社交链接

### 全站图片灾备

- **双备份架构**：站内全部图片（专辑封面、艺人头像与背景图、单曲封面、贡献者头像、友链头像、文章封面、歌曲分享封面共 7 张表 8 个备份列）在保留原外链（B站图床等）的同时，自动备份一份到阿里云 OSS；站点 Logo / favicon、首页大图、赞赏码、隐藏歌词占位图等代码常量图同样纳入
- **内容哈希寻址**：对象 key 为图片内容 SHA-256（`backup/{哈希前2位}/{哈希}.{ext}`），同一张图物理上只存一份（647 处引用去重为 615 个对象）；公共读桶，RAM 子账号仅授 `backup/` 目录读写，密钥只存服务端
- **自动转存**：后台新增 / 修改图片保存时由阿里云 FC（国内节点）服务端抓图转存，URL 未变更且已有备份自动短路，转存失败不阻断保存并提示回填脚本（`scripts/backup-images.mjs`）补齐
- **一键切换图片源**：后台系统设置在「原外链 / OSS 备份」间切换：默认原外链（OSS 零流量费用），图床故障时一键切 OSS，前台经 Supabase 自定义 fetch 递归替换全部图链，缺备份自动回退原地址；客户端引导时校对库内最新值，构建快照过期则丢弃内嵌数据强制重拉，**切换实时生效、无需重新部署**，任意一次重新构建后自动恢复零额外请求
- **前后台隔离**：灾备开关只作用于前台；后台管理界面始终显示、编辑原始外链

### 开放 API（api.lrcshare.com）

- **六组端点**：搜索 / 歌曲列表与详情 / 专辑 / 艺术家 / 歌词 / 全库目录快照
- **双查询模式**：关键词模糊搜索 + `title`/`artist` 结构化组合查询（artist 支持数组多艺人 AND 查询与斜杠串兜底），歌名、艺术家别名全覆盖
- **一份词级数据四种格式**：LRC / 增强逐字 / 逐字 / TTML，语言筛选与译文公共行补齐由服务端完成
- **行表 = TTML 语义全量投影**：双值词标签 `<偏移:词长>`、行级属性（ttm:agent / 角色等）原样透传、段落时间窗、head 元数据（songwriters / amll:meta）全量透传、词级 Ruby 注音（支持多音节）、body dur 参考总时长；`ttml_text` 原文保持字符级真相源——下游无需自己写 TTML 解析器
- **字段对齐音频标签标准**（ID3v2 / Vorbis Comment）：作词 / 作曲 / 编曲 / 曲目号 / 碟号 / 流派 / 专辑艺术家一应俱全，封面统一取专辑封面；歌词响应携带来源署名链路
- **省额度设计**：全库目录快照供批量调用方本地预过滤；边缘缓存（列表 10 分钟 / 详情 1 小时）+ 单 IP 速率限制 + robots/WAF 两层反爬
- **文档与生态**：[api.lrcshare.com/docs](https://api.lrcshare.com/docs/)（VitePress，含快速开始、字段表、FAQ 与 Lyrico 客户端集成保姆教程）；官方 Lyrico 插件已提交 [Lyrico-Plugins](https://github.com/Replica0110/Lyrico-Plugins) 仓库

### 邮件与云函数

- 新投稿即时通知站长；审核结果（通过 / 拒绝及原因）邮件通知投稿人；发信状态全程可感知，9 类常见 SMTP 错误翻译为中文结论并保留原始错误
- 管理端发信接口校验管理员会话、锁死单收件人（无开放中继）、CORS 收紧为 `*.lrcshare.com`；审核邮件在整条发布链成功后才发送，杜绝中途失败重试导致的重发
- 后台邮件日志页可查每封邮件的发送结果

## 技术栈

| 分类 | 技术 / 版本 |
| ---- | ----------- |
| 框架 | Vue 3.5 · Vue Router 5.2 · Pinia 4.0 |
| 语言 / 构建 | TypeScript 5.9 · Vite 8.2 · vite-ssg 28.3 |
| UI / 样式 | Element Plus 2.14 · Tailwind CSS 4.3 · unplugin-icons · @unhead/vue 2 |
| 数据 | Supabase JS 2.112（Postgres + Auth + RLS + RPC） |
| 音乐播放 | @meting/core 1.6（网易云解析）· YouTube / SoundCloud 嵌入 SDK |
| 开放 API / 同步 | Cloudflare Workers · Wrangler 4 |
| 文档 | VitePress 1.6 |
| 服务端函数 | Netlify Functions · Nodemailer 7 |
| 安全 | isomorphic-dompurify 3（SSR/CSR 同构 XSS 消毒） |
| 其他 | marked 18（Markdown）· pinyin-pro 3.29（拼音分组）· fflate 0.8（ZIP）· @vueuse/core 14 · @xmldom/xmldom |
| TTML 解析 | [@applemusic-like-lyrics/ttml](https://github.com/amll-dev/applemusic-like-lyrics)（AMLL 官方，AGPL-3.0） |

## 快速开始

```bash
npm install
cp .env.example .env   # 填入 Supabase 地址与 anon key
npm run dev            # 前台
npm run docs:dev       # API 文档站（可选）
```

环境变量说明见 [.env.example](.env.example)：

- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`：Supabase 项目凭据（anon key 为公开密钥）
- `VITE_MAIL_BASE`：Netlify 函数站基地址（邮件通知 + 音乐识别取链），留空则跳过邮件通知
- `VITE_IMAGE_BACKUP_URL`：阿里云 FC 图片灾备转存服务地址（国内节点，避免 Netlify 美国节点抓 B站失败），留空则跳过自动转存
- OSS / SMTP / service_role 等服务端密钥仅配置在云端，不入库不下发

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 前台本地开发 |
| `npm run build` | vite-ssg 预渲染构建（构建时直读数据库生成全部实体页） |
| `npm run preview` | 预览前台构建产物 |
| `npm run type-check` | vue-tsc 类型检查 |
| `npm run docs:dev` / `docs:build` / `docs:preview` | API 文档站开发 / 构建 / 预览 |
| `npm run changelog:sync` | 更新日志同步：`src/data/changelog.ts` → `CHANGELOG.md`（通常无需手跑——提交含 changelog.ts 时 git pre-commit 钩子自动执行，钩子由 postinstall 自动启用） |
| `node scripts/backup-images.mjs` | OSS 图片灾备存量回填 / 异常补救（日常新增图片自动转存，无需手跑） |
| `node scripts/run-ttml-sync.mjs` | 本地手动触发 TTML Hub 同步 |

## 部署架构

```
访客浏览器
   │  静态页（SSG HTML/JS/CSS）
   ▼
GitHub Pages（lrcshare.com）◄── GitHub Actions：push 到 main 即构建 + 每 6 小时定时重建 + 支持手动触发
   │
   ├─► Supabase（Postgres / Auth / RLS / RPC）——主数据源
   │
   ├─► Cloudflare Worker · open-api（api.lrcshare.com）——开放 API，边缘缓存 + 限流
   ├─► Cloudflare Worker · ttml-sync——Cron 抓取 LunaBeat TTML Hub，人工队列入库
   ├─► Cloudflare Pages · VitePress 文档站（/docs 由 open-api Worker 反代）
   │
   ├─► Netlify Functions 函数站（VITE_MAIL_BASE）：
   │     ├─ /api/mailer          投稿/审核邮件
   │     ├─ /api/resolve-music   三平台链接识别（标题/艺人/封面/专辑曲目）
   │     ├─ /api/music-stream    实时播放换链（公益 Meting 优先，官方接口回退）
   │     └─ /api/music-lyric     网易云逐句歌词实时获取（不入库）
   │
   ├─► 阿里云函数计算 FC（VITE_IMAGE_BACKUP_URL，上海·与 OSS 同地域）：
   │     └─ image-backup         外链图片转存阿里云 OSS（仅管理员，Netlify 美国节点抓 B站失败故迁国内）
   │
   └─► 阿里云 OSS（lrcshare 桶，backup/ 前缀）——图片灾备源，SHA-256 内容寻址公共读
```

各部分部署要点：

- **前台主站**：构建流程见 [.github/workflows/deploy.yml](.github/workflows/deploy.yml)，需在 Actions Secrets 配置 `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` / `VITE_MAIL_BASE` / `VITE_IMAGE_BACKUP_URL`；数据库新增内容最迟 6 小时随定时重建上线
- **开放 API**：源码 [cloudflare/open-api.js](cloudflare/open-api.js)，在 `cloudflare/` 目录执行 `wrangler deploy`（共享模块经 esbuild 打包），密钥用 `wrangler secret put` 配置
- **TTML Hub 同步**：[cloudflare/ttml-sync/](cloudflare/ttml-sync/)，Cron 定时 + `X-Sync-Token` 请求头手动触发，外部地址强制同源校验防 SSRF
- **API 文档站**：Cloudflare Pages，构建命令 `npm run docs:build`，输出 `docs/.vitepress/dist`
- **Netlify 函数站**：独立站点仅部署函数（[netlify.toml](netlify.toml)），需配置 `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` 及 SMTP 变量
- **图片灾备转存（阿里云 FC）**：源码 [cloud-fn/image-backup/](cloud-fn/image-backup/)，Node.js 18+ HTTP 触发器，需配置 `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `OSS_REGION` / `OSS_BUCKET` / `OSS_ACCESS_KEY_ID` / `OSS_ACCESS_KEY_SECRET`；FC 每月 100 万次调用免费
- **数据库变更**：迁移脚本存于 `sql/`，一律单事务、幂等（`IF NOT EXISTS` / `CREATE OR REPLACE` / 先 DROP 再建）；RPC 显式声明列清单、显式 REVOKE anon 执行权

## 目录结构

```
├── .github/workflows/   # deploy.yml：SSG 构建 → GitHub Pages（push + 6h cron + 手动）
├── cloudflare/          # open-api（开放 API）· ttml-sync（曲库同步）· shared/（三端共享语言规则）
├── cloud-fn/            # 阿里云函数计算：image-backup（图片灾备转存）· netease-stream（网易云取链·SCF备用）
├── docs/                # API 文档站（VitePress → api.lrcshare.com/docs/）
│   ├── api/             # 六组端点文档 + 数据对象字段表
│   └── guide/           # 快速开始 / Lyrico 集成教程
├── netlify/
│   ├── functions/       # mailer / resolve-music / music-stream / music-lyric
│   └── functions/_lib/  # oss.mjs（转存/SHA-256 寻址，FC 版见 cloud-fn/image-backup/）· netease-public.mjs（公益 Meting）
├── public/              # robots.txt 等静态文件
├── scripts/             # changelog 同步 · git 钩子安装 · OSS 回填 · TTML 同步触发
├── sql/                 # 数据库迁移脚本 + 架构演进文档（站内 /docs 数据源）
├── src/
│   ├── assets/icons/    # 社交/平台 SVG 图标
│   ├── components/      # admin / common / contributor / layout / music / song / submit
│   ├── composables/     # useSSGData（SSG 数据复用/灾备重拉）· useAdminAuth · useBusuanzi
│   ├── data/            # changelog.ts（更新日志单一数据源）
│   ├── layouts/         # 默认布局 / 后台布局
│   ├── lib/             # api / adminApi / supabase（灾备 fetch）/ imageSource / lyricLines / musicPlayerApi 等
│   ├── router/          # 前台 + /admin 路由与登录守卫
│   ├── stores/          # musicPlayer（全局播放器）· ui
│   ├── styles/          # 全局样式
│   └── views/           # 前台 20+ 页面 + admin 15 个后台页
├── verify-ssg.mjs       # SSG 构建校验脚本
├── netlify.toml         # Netlify 函数站配置（主站不部署在这里）
└── vite.config.ts       # vite-ssg 配置（includedRoutes 构建时从库拉实体清单）
```

## 数据库演进

`sql/` 目录同时存放**可执行迁移**（`.sql`，单事务幂等）与**架构演进文档**（`.md`，记录「出发点 → 怎么做 → 最终形态 → 踩坑」）。演进文档由构建时内联打包，在 [lrcshare.com/docs](https://lrcshare.com/docs) 直接浏览：

每号均含可执行迁移（`.sql`）与架构演进文档（`.md`）：01 贡献者关系中间表 · 02 搜索演进 · 03 口令拆表 · 04 歌词行表 · 05 多版本与 TTML Hub · 06 歌词写入事务化与语言治理 · 07 投稿与邮件 · 08 联系方式与外链 · 09 安全加固总纲 · 10 时长统一 · 11 贡献者账号合并 · 12 歌曲分享体系 · 13 分享平台收窄三家 · 14 合并联动歌曲分享 · 15 限时推荐位 · 16 公开联系方式意愿 · 17 投稿资料更新意愿 · 18 专辑封面迁移 B站图床 · 19 图片灾备加列 · 20 灾备 RPC 补列 · 21 API Key 鉴权

### 数据库灾备

`db/` 目录存放 schema 自动导出相关文件：`export_schema.sql`（在 Supabase 运行一次，创建 `export_schema()` 函数）与 `schema.sql`（自动生成的完整 schema，含建表/RLS/RPC/触发器，git 跟踪）。灾备脚本位于 `scripts/`（`db-dump.mjs` / `db-pull.mjs` / `db-restore.mjs`），CI 工作流位于 `.github/workflows/`（`db-backup.yml` 每周 OSS 冷备、`db-sync.yml` 每小时热备同步）。详见 `运维手册.md`。

## 更新日志

完整历史见 [CHANGELOG.md](./CHANGELOG.md)，主站浏览版（按日期归档、可折叠展开）：[lrcshare.com/changelog](https://lrcshare.com/changelog)

## 赞助 / 支持

如果 LrcShare 对你有帮助，可以通过爱发电支持本站的持续运营：
👉 [https://afdian.com/a/x2ispanda](https://afdian.com/a/x2ispanda)

## 联系

发现问题可通过关于页面联系站长，或在任意歌曲页评论区留言。
