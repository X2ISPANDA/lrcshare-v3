# 更新日志

## v1.4.2 - 2026-09-03

- **音译语言码跟随 BCP47 国际标准**：`kind: romanization` 版本的 `lang` 不再折叠为站内码，直接使用 TTML 源中的拉丁化标签原值——日语罗马音 `ja-Latn`、粤拼 `zh-Latn-jyutping`、韩语罗马音 `ko-Latn`（与 Apple Music TTML 标注一致）；修复日语罗马音被错误归类为英语（`ja-Latn → en`）的历史问题
- **繁体中文支持地区细分**：新增 `zh-Hant-HK`（繁体中文·香港）/ `zh-Hant-TW`（繁体中文·台湾）两个语言码，后台歌词语言下拉可手动标注；修复 `zh-HK` / `zh-TW` 标签被误归简体中文的问题
- **语言筛选支持 BCP47 层级匹配**：`lyric_lang` / `lyric_translation_lang` 传基础码自动命中其下细分标签（`zh-Hant` 命中 `zh-Hant-HK/TW`，`zh` 命中全部中文子标签），老客户端无需改动；精确码优先，原文层级命中只取一个版本
- 全局语言名「中文」改为「简体中文」，与繁体并列时不再混淆
- **合成 TTML 修复为 Apple sidecar 结构**：`lyric_format=ttml` 与 `lyrics[]` 合成的 TTML 原为无 `itunes:key`、无 `xml:lang`、译文混排 body 的形态，AMLL 等标准库解析结果为**空歌词**（对无 `itunes:key` 的 `<p>` 整行跳过，div `xml:lang` 不被识别）。现重写为苹果标准结构——正文 `<p itunes:key>` + 词级 span，译文/音译进 head `iTunesMetadata` 侧车按行 key 配对，根标签带 `xml:lang`（BCP47）与 `itunes:timing`，已用 AMLL 官方库实测往返完整解析
- 自行合成 TTML 的语言码符合 BCP47：站内简体码 `zh` 输出到 TTML 时补全为 `zh-Hans`（后台编辑器导出、`versionsToTtml` 同步修正）
- 修复后台标注的正文语言写在 `<body xml:lang>` 而 AMLL/Apple 标准库只读 `<tt>` 根标签 `xml:lang`，导致 API 拆行语言丢失、合成 TTML 根语言为 `und` 的问题：后台读写改为 `<tt>` 根标签（读取兼容旧 `body` 标注），Worker 对历史库内原文正则兜底读取——历史数据无需重新保存即恢复正确语言
- 后台 TTML 编辑器修复：Apple Music Line 级 sidecar 中**整行纯文本音译**（`<text>` 内无词级 `<span>`，如粤拼）检测不出来的问题

## v1.4.1 - 2026-09-03

- **歌词署名跟随实际来源版本**：修复词级歌词跨版本合成（如 LunaBeat TTML 原文 + 用户版译文）时署名仍取歌曲顶层 `comment`（默认版本贡献者）的错配——内容来自哪个版本就署哪个版本
- `lyric_lines=1` 的 `versions[]` 每项新增 `source` / `comment` 字段（版本来源与版本独立署名）；调用方应优先使用版本级 `comment`，不要用歌曲顶层 `comment`
- `lyric_format` 合成文本（`ttml` / `enhanced` / `verbatim` / `line`）与 `lyrics[]` 的署名按实际参与合成的版本取；跨版本合并时多来源署名去重、多行并列；版本署名缺失时兜底默认版本署名
- TTML 署名补齐：`lyric_versions[].ttml_text` 与合成 TTML 输出时追加超界署名行 `<p begin="06:59:19.999" end="06:59:20.999">本歌词来自于:...</p>`（与 LRC 的 `[419:19.999]` 同机制——播放器不渲染、打标工具按普通字幕行收录；库内原文不改动，追加幂等）
- Lyrico 插件 v1.5.1：写入音乐文件 COMMENT 标签的署名改用歌词版本自带 `comment`（多来源时多行并列），修复实际写入 LunaBeat 词级歌词却署用户版贡献者的问题
- 现有客户端零破坏：顶层 `comment` / LRC 末尾署名语义不变，版本级字段均为纯新增

## v1.4.0 - 2026-08-30

- **多歌词版本模型开放**：一首歌可挂多个歌词版本（不同格式 / 不同贡献者各自独立）。歌曲详情新增 `lyric_versions` 数组——每项含 `id` / `format` / `source` / `langs` / `is_primary` / `comment`（版本独立署名），按默认展示优先级排序（管理员置顶 > TTML > 逐字 > 行级），**首位即默认版本**，顶层 `comment` 跟随默认版本
- 带歌词参数时各版本附完整内容：`lrc` / `enhanced` 版本附结构化行 `lines`；`ttml` 版本附 `ttml_text` 原文（保留对唱声部、左右显示、行样式，不走行表合成）；`ttml-hub` 来源版本额外带 `external_id`
- `lyric_lines` 结构化行基于默认 lrc/enhanced 版本；TTML 版本不参与行合成，原文经 `lyric_versions[].ttml_text` 获取
- 现有客户端零破坏：`lrc` / `comment` / `lyric_lines` 的既有语义不变，`lyric_versions` 为纯新增字段

## v1.3.0 - 2026-08-30

- **多语言歌词开放**：歌曲详情新增歌词参数 `lyric_lang`（原文语言）/ `lyric_translation_lang`（译文语言，逗号分隔或 `all`）/ `lyric_format`（`line` / `enhanced` / `verbatim` / `ttml`）/ `lyric_lines=1`（结构化行）。歌词以版本为单位组织——`original` 原文 / `translation` 译文 / `romanization` 罗马音，详见[获取歌词](/api/lyric#get-lyric)
- 新增 `lyric_lines` 结构化响应：`{primary_lang, versions[]}`，`rows[]` 带毫秒时间戳与逐字 `end_ms`，自绘歌词 UI 无需解析 LRC 文本
- 新增 `lyrics` 数组：每个选中版本一份独立完整文本（含公共行补齐，译文版本完整可独立渲染）
- 语言支持扩展至 29 种（新增粤语对译、法语、泰语、藏语、蒙语、俄语等），自动检测覆盖 15 种独立文字系统

## v1.2.0 - 2026-08-28

- **搜索排序重做**（`keyword` + `type=song`）：宽松入围（多词查询部分落空也返回，命中越多越靠前）+ 四级排序（整串命中优先 → 命中 token 数 → 相关度总分 → 歌名稳定序）。相关度采用分档计分（完全相等 6 / 艺术家精确 4 / 整词与中文 ≥2 字 3 / 子串 1.5），中英文平权，单字段单次计分。完整规则见搜索文档「关键词搜索的排序机制」
- 匹配范围扩展：**专辑艺术家**（TPE2/ALBUMARTIST）参与歌曲搜索的 token 命中——打标工具传「歌名 + 专辑艺术家」组合查询不再落空
- 歌词详情 `lrc` 末尾署名行升级为带时间戳的合法 LRC 行：`[99:99.999]本歌词来自于:...`（超界时间点，播放器永不渲染滚动，但歌词工具可按普通时间轴行解析收录）
- 通配符安全：搜索关键词中的 `%` / `_` 按普通字符处理，不再是 LIKE 通配符
- 结构化查询（`title`/`artist`）的艺术家匹配范围同步扩展至专辑艺术家

## v1.1.1 - 2026-08-26

- 文档站主入口迁移至 `https://api.lrcshare.com/docs/`（原 `doc.lrcshare.com` 已下线）

## v1.1.0 - 2026-08-26

- 新增目录快照端点 `GET /v1/catalog`：一次返回全库可搜索文本（歌名/别名、艺术家名/别名、专辑名，小写去重），供调用方做本地**负向预过滤**——查询词不在快照中 ⇒ 搜索必然为空 ⇒ 跳过请求，批量工具省掉海量无效搜索
- 快速开始新增「给调用者的忠告」：目录预过滤、保护边缘缓存、限流（100 次/10 秒/IP）、空结果兜底
- 新增指南《在 Lyrico 中使用 LrcShare API》：从 GitHub Releases 下载 APK 与插件 zip、导入、搜索打标的完整图文教程

## v1.0.2 - 2026-08-26

- `/v1/search` 新增结构化查询参数 `title` / `artist`（与 `keyword` 互斥）：面向音乐软件/打标工具直接传文件 tag 的歌名与艺术家字段（TIT2/TPE1、TALB/TPE2），AND 语义，均含别名匹配，支持 `type=song` 与 `type=album`，可单传
- `keyword` 模糊搜索（`type=song`）的匹配范围扩展至演唱/词/曲/编关联艺术家的名与别名（此前仅歌名与歌的别名），搜艺术家名/简称/译名即可返回其作品
- 所有搜索（含 `type=song` 与结构化查询）返回精确 `total`（此前 `type=song` 为 `null`）

## v1.0.1 - 2026-08-26

- 歌曲摘要/详情的 `album` 对象新增 `artists`（专辑艺术家，对应 TPE2 / ALBUMARTIST 标签帧），此前仅 `/v1/album/:id` 提供

## v1.0.0 - 2026-08-25

开放 API 首个版本，基础地址 `https://api.lrcshare.com`。

- 两段式流程：搜索/列表返回轻量歌曲摘要（歌名/歌手/专辑名+年份/风格/封面），确认目标后经 `/v1/song/:id` 一次获取歌词、词曲编署名、comment 等全部数据
- 四维搜索：单曲 / 专辑 / 艺术家 / 歌词内容
- 歌曲元数据开放：别名、曲目号、碟号、流派、词曲编、封面（字段严格对齐 ID3v2 / Vorbis Comment 标准帧，网站内部数据不出门）
- 歌词：LRC 随详情一次性下发，末尾自动附来源署名行
- 专辑详情（含完整曲目表）、艺术家详情与作品列表（带角色标注）
- 署名链路：song 详情 `comment` 字段与 LRC 末尾统一为 `本歌词来自于:贡献者名@lrcshare.com`
- 匿名调用、跨域支持、边缘缓存（详情 1h / 列表 10min）
