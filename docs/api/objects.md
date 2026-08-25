# 数据对象

三个核心对象的全字段说明，所有端点返回的都是它们的组合。

## Song {#song}

歌曲对象（搜索 / 列表 / 详情 / 专辑曲目 / 艺术家作品通用）。

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | string | 歌曲 ID，全局唯一，如 `s_purplesoul_013` |
| `title` | string | 歌名 |
| `aliases` | string[] | 别名/译名（同一首歌可并存中日英多名） |
| `artists` | `{id, name}[]` | 演唱者列表 |
| `album` | `{id, name, year, cover}` \| null | 所属专辑（单曲专辑也是专辑） |
| `duration` | string \| null | 时长，`mm:ss.xxx` 格式 |
| `track` | number \| null | 专辑内曲目号 |
| `disc` | number \| null | 碟号（多碟专辑） |
| `genres` | string[] | 流派标签，如 `["Hip-Hop", "Pop"]` |
| `lyricist` | string[] | 作词（名字数组） |
| `composer` | string[] | 作曲（名字数组） |
| `arranger` | string[] | 编曲（名字数组） |
| `cover` | string \| null | 单曲封面，缺省回退专辑封面 |
| `contributor` | string \| null | 歌词贡献者昵称 |
| `comment` | string | 署名字符串：`本歌词来自于:{贡献者名}@lrcshare.com`，可直接写入音乐文件 comment 标签 |
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

专辑详情（`/v1/album/:id`）额外附 `songs`：Song 对象数组，按碟号/曲目号排序。

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
