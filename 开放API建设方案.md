# LrcShare 开放 API 建设方案

日期：2026-08-25
状态：待确认（确认后执行，当前不动任何代码）

## 一、目标

对外提供类网易云/QQ音乐风格的开放数据 API：

- **api.lrcshare.com**：接口站（Cloudflare Worker）
- **doc.lrcshare.com**：文档站（VitePress 静态站）

开放数据范围：歌曲元数据（歌名/别名/歌手/专辑/时长/流派/词曲编署名/封面/视频链接/贡献者）、歌词（LRC + 纯文本）、专辑（含曲目表）、艺术家（含作品）。

## 二、总体架构

```
外部开发者 ──> api.lrcshare.com（CF Worker：open-api）
                   │  /v1/* 路由：字段映射 + 隐藏歌曲过滤 + 缓存 + CORS
                   └──> Supabase PostgREST（anon key）
                          └── RLS + 列级收权（第二道防线，复用现有全部防护）

外部访客 ───> doc.lrcshare.com（Cloudflare Pages：VitePress 静态文档）

主站 v3 ────> 直连 Supabase（现状不变，与开放 API 完全隔离互不影响）
```

## 三、关键设计决策

### 1. 为什么不用 PostgREST 直接开放（反代方案否决）

之前聊天记录里的 supabase-proxy.js（全路径反代）只适合给主站自己换域名用，**不适合当开放 API**：

| 问题 | 反代直开 | Worker 网关 |
| --- | --- | --- |
| 暴露面 | 全部表结构、内部字段（status/is_hidden）、submissions 投稿 insert 全裸露 | 只暴露定义好的端点和字段 |
| 语义 | PostgREST 的 `?select=` 语法小众，外部开发者不熟 | 标准 REST + JSON，国内开发者零学习成本 |
| 防护 | 无法缓存、无法过滤、无法限流 | Worker 层缓存（Cache API）+ CF 免费限流规则 |
| 版本演进 | 表结构一改，外部调用者全炸 | /v1/ 版本化，内部表怎么改对外契约不变 |

### 2. Worker 回源用 anon key（不用 service_role）

Worker 查数据复用 anon key，好处：**这几轮做的所有数据库防护（RLS、unlock_code 列级收权）自动成为第二道防线**。就算 Worker 代码将来写漏了字段，数据库层也只给 anon 可见的内容。service_role 会绕过一切 RLS，Worker 一行 bug 就是数据泄露，不用。

### 3. 隐藏歌曲策略（已定）

API 不过滤隐藏歌曲：搜索、列表、直查、歌词全量开放。网站的隐藏逻辑（列表不显示、直链口令解锁）仅作用于前台，API 侧不复制该限制——第三方写音乐标签时隐藏歌曲的标签也要打。

> 说明：这意味着知道歌曲 id 即可通过 API 获取隐藏歌词，网站口令保护不延伸到 API 层（unlock_code 本身依然永不外发）。

### 4. 贡献者署名（已定，面向写标签场景）

API 的首要用途是给 MusicTag 等标签工具当歌词源，署名链路统一为：

- song 对象带 `comment` 字段，值：`本歌词来自于:{贡献者名}@lrcshare.com`（调用方直接整串填进 MusicTag 的 comment 标签）；无贡献者回退 `本歌词来自于:lrcshare.com`
- lyric 端点的 LRC 末尾自动追加同款字符串（纯文本行，不带时间戳），歌词文件本身自带来源
- 贡献者不出独立端点（联系方式是隐私，前台展示归前台，API 只出署名字符串）

### 5. 第一版不做 API key

匿名开放（类网易云第三方 API 的通行做法），防护靠三层：CF 免费限流规则（同 IP 高频 challenge）+ Worker 缓存（热门内容命中缓存零回源）+ 主站与开放 API 完全隔离（Worker 挂了不影响主站）。将来被滥用再加 key（Worker + KV 白名单，架构预留）。

## 四、API 设计

### 端点清单（v1）

| 端点 | 说明 |
| --- | --- |
| `GET /v1/` | API 信息（版本、端点列表） |
| `GET /v1/search?keyword=&type=song\|album\|artist\|lyric&limit=20&offset=0` | 四维搜索（复用现有 search_songs RPC） |
| `GET /v1/songs?limit=20&offset=0` | 最新收录列表（分页，limit 上限 100） |
| `GET /v1/song/:id` | 歌曲详情（元数据，不含歌词） |
| `GET /v1/song/:id/lyric` | 歌词（LRC + 纯文本） |
| `GET /v1/albums?limit=&offset=` | 专辑列表 |
| `GET /v1/album/:id` | 专辑详情（含曲目表，按 disc/track 排序） |
| `GET /v1/artists?limit=&offset=` | 艺术家列表（仅 is_show=true） |
| `GET /v1/artist/:id` | 艺术家详情 |
| `GET /v1/artist/:id/songs` | 艺术家作品（每首带 roles 标注：singer/lyricist/composer/arranger） |

### 响应格式

网易云风格包裹（国内开发者习惯）：

```json
// 成功：HTTP 200
{ "code": 200, "data": { ... } }
// 失败：HTTP 404
{ "code": 404, "message": "song not found" }
```

### song 对象字段映射（草案）

| 对外字段 | 来源 | 说明 |
| --- | --- | --- |
| id / title / aliases | songs.id / title / aliases | |
| artists[] | songs.artist_ids → artists | { id, name } 数组 |
| album | 外键 embed albums | { id, name, year, cover } |
| duration / track / disc | 同名列 | |
| genres[] | songs.genres | 流派标签 |
| lyricist[] / composer[] / arranger[] | 逗号 id 串 → artists | 名字数组 |
| cover | songs.cover，空则回退 album.cover | 单曲封面 |
| contributor | contributor_id → contributors.name | 贡献者名 |
| comment | 拼装 | `本歌词来自于:{贡献者名}@lrcshare.com`（无贡献者回退 `本歌词来自于:lrcshare.com`），供直接写入 MusicTag comment 标签 |
| video_url | songs.video_url | B站/YouTube |
| created_at | songs.created_at | 收录时间 |

lyric 端点：`{ id, lrc, text }`。`lrc` 为 LRC 原文末尾自动追加一行 `本歌词来自于:{贡献者名}@lrcshare.com`（无时间戳）；`text` 为纯文本歌词原样下发。

### 缓存策略

| 类型 | TTL |
| --- | --- |
| 详情（song/album/artist/lyric） | 1 小时（数据 6 小时才同步一次） |
| 列表/搜索 | 10 分钟 |

GET 才缓存（Cache API），命中缓存的请求零数据库回源。

## 五、文档站设计

- **技术**：VitePress（Vue 生态、SSG、构建快），源码放主仓库 `docs/` 目录，CF Pages 连 GitHub 自动构建（push 即部署），绑定 doc.lrcshare.com
- **内容结构**：首页（简介 + 快速开始 curl/JS/Python 示例）→ 快速开始 → MusicTag 自定义音源配置指南 → 每个端点一页（参数表、响应示例、字段说明）→ 数据对象字段表 → 更新日志 → FAQ（限流、缓存、署名建议）

## 六、实施步骤（确认后）

1. **Worker**：项目内新建 `cloudflare/open-api.js`（路由 + 字段映射 + 缓存 + CORS，约 300 行）→ CF Dashboard 粘贴部署 → 环境变量配 SUPABASE_URL / SUPABASE_ANON_KEY → 绑 api.lrcshare.com → 全端点 curl 冒烟
2. **文档站**：主仓库 `docs/` 建 VitePress（devDependencies 加 vitepress）→ 写接口文档 → CF Pages 建项目连主仓库 → 绑 doc.lrcshare.com → 验证
3. **可选收尾**：CF Dashboard 配限流规则；README 更新日志补一条

工作量：1 个 Worker 文件 + 1 个文档站骨架和内容，全部网页操作部署（沿用你之前的习惯，不装 wrangler）。

## 七、待确认决策点

已定：隐藏歌曲 API 全量开放（仅网站前台隐藏）；署名链路 `本歌词来自于:贡献者名@lrcshare.com`（comment 字段 + LRC 末尾追加）。

| # | 问题 | 建议 |
| --- | --- | --- |
| 1 | 响应格式用 { code, data } 包裹？ | 是（推荐，网易云习惯） |
| 2 | 第一版不做 API key？ | 是（推荐，匿名 + 限流 + 缓存） |
| 3 | 端点集合与字段映射草案有无增删？ | 按草案 |
| 4 | 文档站 VitePress + CF Pages？ | 是（推荐） |

隐私红线（无争议，直接执行）：unlock_code、settings 表内容、贡献者联系方式永不外发；Worker 回源仅 anon key。
