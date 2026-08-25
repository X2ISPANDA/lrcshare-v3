# 数据对象

核心对象字段说明。歌曲有两个形态：**摘要**（列表/搜索返回，轻量）与**详情**（确认目标后获取，全量）。

## Song 摘要 {#song-summary}

搜索、歌曲列表、专辑曲目、艺术家作品中的列表项。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 歌曲 ID，全局唯一，如 `s_purplesoul_013`，用它调 `/v1/song/:id` 取详情 |
| `title` | string | 歌名 |
| `artists` | `{id, name}[]` | 演唱者列表 |
| `album` | `{id, name, year, cover}` \| null | 所属专辑（单曲专辑也是专辑） |
| `genres` | string[] | 流派标签，如 `["Hip-Hop", "Pop"]` |
| `cover` | string \| null | 封面图，单曲封面缺省时回退专辑封面 |

变体（特定端点额外附加的字段）：

- 专辑详情 `songs[]`：附加 `track`（曲目号）、`disc`（碟号）
- 艺术家作品 `items[]`：附加 `roles`（该艺术家实际参与身份：`singer` / `lyricist` / `composer` / `arranger`）

## Song 详情 {#song-detail}

`/v1/song/:id` 返回，含摘要全部字段，另加：

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `aliases` | string[] | 别名/译名（同一首歌可并存中日英多名） |
| `duration` | string \| null | 时长，`mm:ss.xxx` 格式 |
| `track` | number \| null | 专辑内曲目号 |
| `disc` | number \| null | 碟号（多碟专辑） |
| `lyricist` | string[] | 作词（名字数组） |
| `composer` | string[] | 作曲（名字数组） |
| `arranger` | string[] | 编曲（名字数组） |
| `contributor` | string \| null | 歌词贡献者昵称 |
| `comment` | string | 署名字符串：`本歌词来自于:{贡献者名}@lrcshare.com`，可直接写入音乐文件 comment 标签 |
| `lrc` | string \| null | 完整时间轴 LRC 歌词，末尾自动追加一行来源署名（无时间戳） |
| `text` | string \| null | 纯文本/对照歌词，仅部分歌曲有 |
| `video_url` | string \| null | 歌曲 MV/视频链接（B 站 / YouTube） |
| `created_at` | string \| null | 收录时间（ISO 8601） |

## Album {#album}

专辑对象。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 专辑 ID，如 `alb_xxx` |
| `name` | string | 专辑名 |
| `year` | string \| null | 发行年份 |
| `cover` | string \| null | 专辑封面 |
| `artists` | `{id, name}[]` | 专辑艺术家（可能含唱片公司实体） |
| `description` | string \| null | 专辑介绍（Markdown 富文本） |
| `created_at` | string \| null | 收录时间（ISO 8601） |

专辑详情（`/v1/album/:id`）额外附 `songs`：Song 摘要 + `track`/`disc` 数组，按碟号/曲目号排序。

## Artist {#artist}

艺术家对象。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 艺术家 ID，如 `art_gai` |
| `name` | string | 名字 |
| `aliases` | string[] | 别名 |
| `types` | string[] | 身份：`singer` / `lyricist` / `composer` / `arranger` 等 |
| `avatar` | string \| null | 头像 |
| `bio` | string \| null | 简介 |
| `disambiguation` | string \| null | 同名艺术家消歧义说明 |
