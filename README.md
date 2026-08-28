# LrcShare V3

「全球最小滚动歌词分享网站」——收录歌词、专辑、艺术家信息，支持投稿审核、邮件通知、全站预渲染与开放 API。

## 功能

### 前台

- **首页**：单曲 / 专辑 / 歌手 / 歌词四维搜索，实时下拉建议，歌词命中片段预览，结果过多时进入全局搜索弹窗
- **歌曲页**：文本歌词 / LRC 歌词双视图，外文歌词原文译文对照，日文假名注音，一键复制 LRC，页内嵌入 B 站 / YouTube 播放器，口令解锁隐藏歌词
- **艺术家**：按名称、别名搜索，按身份类型筛选，A-Z 拼音分组 + 首字母索引；艺术家主页含社交平台链接，作品按演唱 / 作词 / 作曲 / 编曲分组
- **专辑页**：多碟专辑按 Disc 分组展示曲目表，点击直达歌词页
- **贡献者**：卡片墙 + 个人主页，记录贡献标签（歌词 / 翻译 / 校对 / LOGO / 文案 / 代码等）与作品列表
- **投稿**：单曲 / 批量双模式，老贡献者自动沿用资料、自助更新个人信息、多艺术家标注、专辑自动联想、编曲标注、支持视频链接；批量模式支持多选 LRC / ZIP 上传，公共字段预设 + 逐行覆盖
- **文章区**：站长随笔与公告，浏览量统计、分页浏览
- **其他**：评论（Twikoo）、关于页、友链、赞赏

### 管理后台

歌曲 / 专辑 / 艺术家 / 贡献者 / 文章 / 友链 / 赞赏 / 投稿审核 / 站点设置管理，桌面表格 + 移动端卡片双形态自适应，见 `src/views/admin/`。

- **艺术家即建即补**：录歌 / 审核中输入新艺术家回车即建，点头像弹窗补全 ID、资料；库内艺术家同样点头像就地更新（含社交链接）
- **批量审核**：批量投稿按批折叠为一行、一键审核整批；Excel 式表格逐列统一填充（可指定仅勾选行）、单元格逐行微调、展开行核对歌词、行级通过/拒绝混合决定、单曲封面独立设置、一键全部发布 / 批量拒绝（含原因通知）；专辑信息（专辑艺术家 / 封面 / 年份 / 简介）统一在专辑弹窗中编辑，已关联专辑差异写回、新专辑随发布创建

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
- 通过 Netlify Functions（`netlify/functions/mailer.mjs`）实现，`SUPABASE_SERVICE_ROLE_KEY` 仅存于云端环境变量

## 技术栈

- **框架**：Vue 3 + TypeScript + Vue Router + Pinia
- **构建**：Vite + vite-ssg（全站预渲染，五百余页面点开即达）
- **UI**：Element Plus + Tailwind CSS 4 + unplugin-icons
- **数据**：Supabase
- **开放 API**：Cloudflare Workers
- **API 文档**：VitePress
- **邮件**：Netlify Functions + Nodemailer
- **其他**：marked（Markdown 渲染）、pinyin-pro（拼音分组）、fflate（批量投稿 ZIP 解压）、@vueuse/core

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

## 部署

- **前台主站**：GitHub Pages（lrcshare.com），构建流程见 `.github/workflows/deploy.yml`，数据每 6 小时自动同步一次
- **开放 API**：Cloudflare Workers（api.lrcshare.com），源码 [cloudflare/open-api.js](cloudflare/open-api.js)，需在 Worker 环境变量配置 `SUPABASE_URL` / `SUPABASE_ANON_KEY`
- **API 文档站**：Cloudflare Pages（源站 lrcshare-v3.pages.dev），构建命令 `npm run docs:build`，输出目录 `docs/.vitepress/dist`；主入口 [api.lrcshare.com/docs](https://api.lrcshare.com/docs/)（由开放 API Worker 剥 `/docs` 前缀反代，VitePress `base: '/docs/'`）
- **邮件服务**：独立 Netlify 站点，仅部署 Functions，配置见 [netlify.toml](netlify.toml)，需在 Netlify 环境变量配置 `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`，并通过 `VITE_MAIL_BASE` 指向该站点
- **数据库变更**：历史 SQL 脚本存于 `sql/`（口令验证函数、unlock_code 权限回收、结构化搜索、贡献关系中间表迁移 `phase2-song-contributors.md` 等），执行记录见各文件头部说明

## 目录结构

```
├── cloudflare/           # 开放 API Worker（api.lrcshare.com）
├── docs/                 # API 文档站（VitePress → api.lrcshare.com/docs/）
│   ├── api/              # 六组端点文档 + 数据对象字段表
│   └── guide/            # 快速开始 / Lyrico 客户端集成教程
├── netlify/functions/    # 邮件服务（mailer）
├── sql/                  # 数据库变更脚本
├── src/
│   ├── components/       # 组件（admin / common / contributor / layout / song / submit）
│   ├── composables/      # useAdminAuth / useSSGData
│   ├── layouts/          # 默认布局 / 后台布局
│   ├── lib/              # API 封装、Supabase 客户端、常量、类型等
│   ├── router/           # 路由
│   ├── views/            # 页面（前台 + admin 后台）
│   └── styles/           # 全局样式
└── verify-ssg.mjs        # SSG 构建校验脚本
```

## 更新日志

### 2026-08-28

- 开放 API 搜索补专辑艺术家匹配：keyword 与结构化查询均覆盖专辑艺术家（TPE2，含别名）——音乐文件演唱者与组合名分置 TPE1/TPE2 时均可搜到
- keyword 搜索改宽松语义（网易/QQ 式）：至少命中一个关键词即返回，命中越多排越前；告别单个关键词无关联数据时整首 0 结果
- 不蒜子统计修复：SPA 路由切换后重新计数、本页浏览量随页面刷新（原先换链接不更新）；文章页与 footer 共享同一份数据，不再出现空白浏览量
- Footer 新增「本站已运行 N 天」（自 2023-03-01 起算）
- 隐藏口令拆表：`unlock_code` 从 `songs` 拆至独立表 `song_secrets`（anon 零授权，`verify_hidden_unlock_code` RPC 是唯一校验正门），songs 表不再承载敏感数据，原有列级收权补丁链随之作废
- 隐藏歌词解锁改「通行证」语义：全局口令验证一次，会话内对所有无独立口令的隐藏歌生效；设了独立口令的歌逐首校验，不被全局口令绕过；解锁状态按歌记账，关闭标签页重置
- 歌词内容搜索排除隐藏歌（单曲搜索照常命中，Worker API 维持全量开放）
- 后台歌曲编辑：口令与隐藏开关联动提示（填口令未开隐藏时内联提醒，口令照存不生效）
- 修复 B 段遗留故障：`get_artist_songs` 引用已删除的旧贡献列导致艺术家作品页报错

### 2026-08-27

- 数据库重构阶段二完成：歌曲贡献关系（歌手 / 作词 / 作曲 / 编曲）与专辑艺术家全面迁移至 `song_contributors` / `album_contributors` 多对多中间表，外键级联与引用保护生效（删歌自动清关系行、被引用艺术家禁止删除），`songs.artist_ids` / `lyricist` / `composer` / `arranger` 及 `albums.artist_ids` 旧列删除，中间表成为唯一数据源；前台、后台、开放 API 同步切换
- 艺术家类型改为自动派生：`recompute_artist_types` RPC 按歌曲 / 专辑贡献关系重算（后台保留「重算全部类型」入口），不再依赖人工维护，杜绝类型固化与筛选错误
- 存量投稿数据规范化：`song_data` 内 v2 拼接字符串字段（artist / lyricist 等）全部转为数组格式（artists / lyricist_arr 等），消灭双键漂移；投稿端停写兼容字段
- 批量投稿升级为「按批审核」：同一次批量投稿共用批次 ID（`submissions.batch_id`），后台待审核列表按批折叠为一行（「《专辑》等 N 首歌曲」），点「审核整批」进批量审核弹窗
- 批量审核弹窗新增行级「通过/拒绝」决定列：混合场景（A 通过 B 拒绝）逐行标记 + 拒绝原因，一键按标记提交；未留邮箱自动跳过
- 审核结果邮件按批合并为一封：全部通过 / 全部拒绝 / 部分通过（逐首列表 + 各自原因）三种模板；跨提交人混审时按提交人各发一封
- 新投稿站长提醒按批合并：「【批量投稿】《专辑》等 N 首歌曲」一封代替 N 封
- 投稿新增批量模式：多选 LRC / ZIP 上传（UTF-8 / GBK 自动识别），歌名取 `[ti:]` 标签；公共字段预设 + 逐行覆盖，一批可混投不同歌手 / 专辑的单曲
- 管理后台新增批量审核：Excel 式表格列头统一填充（可仅作用于勾选行）、单元格逐行编辑、展开核对歌词，一键全部发布或批量拒绝
- 后台录歌 / 审核支持新建艺术家即时补全：点击头像弹窗填写 ID 与资料，发布时自动创建，无需再跳转艺术家管理页
- 专辑信息编辑统一收敛至专辑弹窗（专辑艺术家 / 封面 / 年份 / 简介），已关联专辑改完差异写回，新专辑随发布创建；单曲封面独立字段（songs.cover，空则回退专辑封面）
- 艺术家 / 专辑匹配全面改为大小写不敏感，杜绝「AA」被重复建成「aa」
- 批量场景修复：连续创建同毫秒主键冲突（ID 加随机尾）、ElMessage 被多层弹窗遮挡（z-index 层级补丁）、后台挂载图片预览组件
- 投稿审核拒绝支持批量（列表多选 + 批量审核表格内），共用一次拒绝原因，逐条发通知邮件
- 删除已通过投稿支持级联回收：发布链把本次新建的歌曲 / 专辑 / 艺术家 / 贡献者记入 `submissions.published_refs`，删除时按引用检查回收（被其他内容引用的保留），测试 / 误发布不再污染数据库
- 投稿成功页新增「继续投稿」：保留投稿人信息清空歌曲表单，连续投稿不用重填昵称邮箱

### 2026-08-26

- 投稿新增编曲字段，编曲信息不再误填作曲
- 贡献者联系方式简化：删除冗余 `contact_types` 字段，联系方式统一由 `contact_value`（键即类型）管理，后台编辑改为动态行（类型 + 号码/链接），彻底消除双字段不同步问题
- LrcShare API 正式发布（api.lrcshare.com），文档站同步上线并支持在 Lyrico 中调用；文档主入口后迁移至 api.lrcshare.com/docs（doc.lrcshare.com 已下线）
- API 支持结构化查询（`title`/`artist` 组合精确匹配）与全库目录快照端点，批量调用方可先拉目录本地预过滤，避免无效请求
- API 防御上线：Cloudflare 边缘缓存（命中不进 Worker）+ 单 IP 速率限制，免费额度无忧
- 搜索接口返回精确 total，分页信息完整
- 管理后台移动端适配：抽屉菜单、卡片式列表、自适应弹窗、吸底分页，随身可审核
- 支持不投稿直接修改贡献者信息
- 投稿审核优化：投稿专辑名可复制、输入项智能置顶、专辑年份可见可改、沿用已有专辑时可回填年份
- 移除评论区口令验证逻辑（评论统一由 Twikoo 承担）
- 修复刷新页面时 404 页面闪现问题

### 2026-08-25

- 文章发布功能排序 bug 修复
- 投稿绑定艺术家、专辑逻辑优化，避免出现输入了没有点击下拉栏没有绑定专辑 ID 的情况
- 投稿审核结果邮件通知，新投稿即时邮件提醒站长
- 修复关于 RLS 策略导致歌曲口令无法验证通过的问题，修改为函数验证避免解锁口令泄露
- 修复 QQ 联系方式跳转异常（腾讯已废弃 url 调用 QQ 方式），改为弹窗复制
- 修复管理后台、首页艺术家作品计数 bug
- 修改联系方式对应 key 为英文

### 2026-08-24

- 网站从内到外完整重构，正式上线 V3

## 联系

发现问题可通过关于页面联系站长，或在任意歌曲页评论区留言。
