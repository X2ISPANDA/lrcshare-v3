# LrcShare V3

「全球最小滚动歌词分享网站」——收录歌词、专辑、艺术家信息，支持投稿审核、邮件通知与全站预渲染。

## 功能

### 前台

- **首页**：单曲 / 专辑 / 歌手 / 歌词四维搜索，实时下拉建议，歌词命中片段预览，结果过多时进入全局搜索弹窗
- **歌曲页**：文本歌词 / LRC 歌词双视图，外文歌词原文译文对照，日文假名注音，一键复制 LRC，页内嵌入 B 站 / YouTube 播放器，口令解锁隐藏歌词
- **艺术家**：按名称、别名搜索，按身份类型筛选，A-Z 拼音分组 + 首字母索引；艺术家主页含社交平台链接，作品按演唱 / 作词 / 作曲 / 编曲分组
- **专辑页**：多碟专辑按 Disc 分组展示曲目表，点击直达歌词页
- **贡献者**：卡片墙 + 个人主页，记录贡献标签（歌词 / 翻译 / 校对 / LOGO / 文案 / 代码等）与作品列表
- **投稿**：老贡献者自动沿用资料、自助更新个人信息、多艺术家标注、专辑自动联想、支持视频链接
- **文章区**：站长随笔与公告，浏览量统计、分页浏览
- **其他**：评论懒加载（Twikoo）、关于页、友链、赞赏

### 管理后台

歌曲 / 专辑 / 艺术家 / 贡献者 / 文章 / 友链 / 赞赏 / 投稿审核 / 站点设置管理，见 `src/views/admin/`。

### 邮件服务

- 新投稿即时通知站长
- 审核结果（通过 / 拒绝及原因）邮件通知投稿人
- 通过 Netlify Functions（`netlify/functions/mailer.mjs`）实现，`SUPABASE_SERVICE_ROLE_KEY` 仅存于云端环境变量

## 技术栈

- **框架**：Vue 3 + TypeScript + Vue Router + Pinia
- **构建**：Vite + vite-ssg（全站预渲染，五百余页面点开即达）
- **UI**：Element Plus + Tailwind CSS 4 + unplugin-icons
- **数据**：Supabase
- **邮件**：Netlify Functions + Nodemailer
- **其他**：marked（Markdown 渲染）、pinyin-pro（拼音分组）、@vueuse/core

## 快速开始

```bash
npm install
cp .env.example .env   # 填入 Supabase 地址与 anon key
npm run dev
```

环境变量说明见 [.env.example](.env.example)：

- `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`：Supabase 项目凭据
- `VITE_MAIL_BASE`：邮件服务站点基地址，留空则跳过邮件通知

## 常用脚本

| 命令                   | 说明             |
| -------------------- | -------------- |
| `npm run dev`        | 本地开发           |
| `npm run build`      | vite-ssg 预渲染构建 |
| `npm run preview`    | 预览构建产物         |
| `npm run type-check` | vue-tsc 类型检查   |

## 部署

- **前台主站**：GitHub Pages，构建流程见 `.github/workflows/deploy.yml`，数据每 6 小时自动同步一次
- **邮件服务**：独立 Netlify 站点，仅部署 Functions，配置见 [netlify.toml](netlify.toml)，需在 Netlify 环境变量配置 `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`，并通过 `VITE_MAIL_BASE` 指向该站点

## 目录结构

```
├── netlify/functions/    # 邮件服务（mailer）
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

### 2026-08-24

- 网站从内到外完整重构，正式上线 V3

### 2026-08-25

- 文章发布功能排序bug修复
- 投稿绑定艺术家、专辑逻辑优化，避免出现输入了没有点击下拉栏没有绑定专辑ID的情况
- 投稿审核结果邮件通知，新投稿即时邮件提醒站长
- 修复关于RLS策略导致歌曲口令无法验证通过的问题，修改为函数验证避免解锁口令泄露
- 修复QQ联系方式跳转异常(腾讯已废弃url调用QQ方式)，改为弹窗复制
- 修复管理后台、首页艺术家作品计数bug
- 修改联系方式对应key为英文

## 联系

发现问题可通过关于页面联系站长，或在任意歌曲页评论区留言。
