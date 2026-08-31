# 歌曲

## GET /v1/songs {#song-list}

最新收录的歌曲（按收录时间倒序），用于增量同步全站曲目。

### 参数

| 参数 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `limit` | 否 | number | 每页数量，1 ~ 100（默认 20） |
| `offset` | 否 | number | 偏移量（默认 0） |

### 请求

```bash
curl "https://api.lrcshare.com/v1/songs?limit=10&offset=20"
```

### 响应

```json
{
  "code": 200,
  "data": {
    "total": 532,
    "limit": 10,
    "offset": 20,
    "items": [
      {
        "id": "s_masiwei_002",
        "title": "崂山道士",
        "artists": [{ "id": "art_masiwei", "name": "马思唯" }],
        "album": { "id": "alb_masiwei_002", "name": "P.E.I Vol.2", "year": 2014, "cover": "https://...", "artists": [{ "id": "art_masiwei", "name": "马思唯" }] },
        "genres": ["Chinese Rap", "Hip-Hop"]
      }
    ]
  }
}
```

返回轻量摘要（与搜索 `type=song` 同构），适合渲染选择列表。

## GET /v1/song/:id {#song-detail}

返回歌曲的**完整元标签**——歌名、歌手、专辑、曲目号、词曲编署名、comment，以及歌词（歌词本身就是元标签的一种，写音乐文件时与 `TIT2`/`TPE1` 等一起写入）。

### 参数

| 参数 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `id` | 是 | string | 歌曲 ID（如 `s_masiwei_002`） |

### 请求

```bash
curl "https://api.lrcshare.com/v1/song/s_masiwei_002"
```

### 响应

```json
{
  "code": 200,
  "data": {
    "id": "s_masiwei_002",
    "title": "崂山道士",
    "aliases": [],
    "artists": [{ "id": "art_masiwei", "name": "马思唯" }],
    "album": { "id": "alb_masiwei_002", "name": "P.E.I Vol.2", "year": 2014, "cover": "https://...", "artists": [{ "id": "art_masiwei", "name": "马思唯" }] },
    "track": 1,
    "disc": 1,
    "genres": ["Chinese Rap", "Hip-Hop"],
    "lyricist": ["马思唯"],
    "composer": ["马思唯"],
    "arranger": ["马思唯"],
    "comment": "本歌词来自于:X2ISPANDA@lrcshare.com",
    "lrc": "[ti:崂山道士]\n[ar:马思唯]\n[00:04.74]要学神仙 驾鹤飞天\n...",
    "lyric_versions": [
      { "id": "lv_d7cb4765519c", "format": "lrc", "langs": ["zh"], "is_primary": true, "comment": "...", "lrc": "..." },
      { "id": "lv_48e91dc9ac7af755", "format": "ttml", "langs": ["zh", "en"], "is_primary": false, "comment": "...", "ttml_text": "<tt>..." }
    ]
  }
}
```

### 响应字段

| 字段 | 说明 |
| --- | --- |
| `title` / `aliases` | 歌名 / 别名（含译名） |
| `artists` | 歌手数组（`id` + `name`） |
| `album` | 专辑对象（名称、年份、封面、专辑艺术家） |
| `track` / `disc` | 曲目号 / 碟号 |
| `genres` | 流派数组 |
| `lyricist` / `composer` / `arranger` | 作词 / 作曲 / 编曲（名字数组） |
| `comment` | 署名，可直接写入 `COMM`/`COMMENT` 标签 |
| `lrc` | 默认版本的 LRC 文本（含署名），可直接写入 `USLT`/`LYRICS` 标签 |
| `lyric_versions` | 所有歌词版本，见[歌词](/api/lyric) |

各字段与 ID3v2 / Vorbis 标签帧的对应关系见[数据对象](/api/objects)。

### 错误响应

```json
{ "code": 404, "message": "song not found" }
```

- 写标签建议：`TIT2` ← `title`、`TPE1` ← `artists`、`TEXT` ← `lyricist`、`TCOM` ← `composer`、`COMMENT` ← `comment`、`USLT`/`LYRICS` ← `lrc`
- 只要歌词文本、不要其他标签时，用[纯歌词接口](/api/lyric)
