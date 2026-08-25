# 数据对象

核心对象字段说明。歌曲有两个形态：**摘要**（列表/搜索返回，轻量）与**详情**（确认目标后获取，全量）。

**标签映射**：字段命名对齐音频标签标准，调用方可直接写入音乐文件元数据。`ID3v2` 列为 MP3 的帧标识，`Vorbis` 列为 FLAC / OGG / Opus 的字段名（两者在常见标签编辑器里是同一栏）。

## Song 摘要 {#song-summary}

搜索、歌曲列表、专辑曲目、艺术家作品中的列表项。

| 字段 | 类型 | ID3v2 | Vorbis | 说明 |
| --- | --- | --- | --- | --- |
| `id` | string | — | — | 歌曲 ID，全局唯一，如 `s_purplesoul_013`，用它调 `/v1/song/:id` 取详情 |
| `title` | string | TIT2 | TITLE | 歌名 |
| `artists` | `{id, name}[]` | TPE1 | ARTIST | 演唱者列表，多艺人合作曲返回多项，写入标签时自行拼接 |
| `album` | `{id, name, year, cover}` \| null | TALB | ALBUM | 所属专辑（单曲专辑也是专辑）；`cover` 为专辑封面，全站唯一封面来源 |
| `genres` | string[] | TCON | GENRE | 流派标签，多风格并存，如 `["Hip-Hop", "Trap", "Boom Bap"]`，写入标签时自行拼接 |

变体（特定端点额外附加的字段）：

- 专辑详情 `songs[]`：附加 `track`（曲目号）、`disc`（碟号）
- 艺术家作品 `items[]`：附加 `roles`（该艺术家实际参与身份：`singer` / `lyricist` / `composer` / `arranger`）

## Song 详情 {#song-detail}

`/v1/song/:id` 返回，含摘要全部字段，另加：

| 字段 | 类型 | ID3v2 | Vorbis | 说明 |
| --- | --- | --- | --- | --- |
| `aliases` | string[] | —（可并入 TITLE） | —（可并入 TITLE） | 别名/译名（同一首歌可并存中日英多名），无标准帧，需要时以括号并入歌名，如 `歌名 (别名)` |
| `track` | number \| null | TRCK | TRACKNUMBER | 专辑内曲目号 |
| `disc` | number \| null | TPOS | DISCNUMBER | 碟号（多碟专辑） |
| `lyricist` | string[] | TEXT | LYRICIST | 作词（名字数组），多人合作如 `["盖世冰牙", "艾福杰尼"]`，写入时拼接 |
| `composer` | string[] | TCOM | COMPOSER | 作曲（名字数组），多人合作多项返回 |
| `arranger` | string[] | —（部分编辑器映射 TXXX:Arranger） | ARRANGER | 编曲（名字数组），ID3v2 无标准帧，Vorbis 原生支持；ID3 可写入自定义帧 TXXX |
| `comment` | string | COMM | COMMENT | 署名字符串：`本歌词来自于:{贡献者名}@lrcshare.com`，可直接整串写入 |
| `lrc` | string \| null | USLT | LYRICS | 完整时间轴 LRC 歌词，末尾自动追加一行来源署名（无时间戳） |
| `album.year` | string \| null | TDRC | DATE | 发行年份（经所属专辑获取） |

## Album {#album}

专辑对象。

| 字段 | 类型 | ID3v2 | Vorbis | 说明 |
| --- | --- | --- | --- | --- |
| `id` | string | — | — | 专辑 ID，如 `alb_xxx` |
| `name` | string | TALB | ALBUM | 专辑名 |
| `year` | string \| null | TDRC | DATE | 发行年份 |
| `cover` | string \| null | APIC | METADATA_BLOCK_PICTURE | 专辑封面 |
| `artists` | `{id, name}[]` | TPE2 | ALBUMARTIST | 专辑艺术家（可能含唱片公司实体），写入标签时拼接 |

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

Artist 为站内实体，不直接对应音频标签；需要写入标签时从关联歌曲的 `lyricist` / `composer` / `arranger` 字段取名。
