# 歌曲与歌词

## 歌曲列表

```
GET /v1/songs
```

最新收录的歌曲（按收录时间倒序），用于增量同步全站曲目。

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `limit` | `20` | 每页数量，1 ~ 100 |
| `offset` | `0` | 偏移量 |

```json
{
  "code": 200,
  "data": {
    "total": 532,
    "limit": 20,
    "offset": 0,
    "items": [ { Song 对象 } ]
  }
}
```

## 歌曲详情

```
GET /v1/song/:id
```

单首歌的完整元数据（不含歌词内容，歌词走下方歌词接口）。

```json
{
  "code": 200,
  "data": {
    "id": "s_purplesoul_013",
    "title": "歌名",
    "aliases": ["别名"],
    "artists": [{ "id": "art_xxx", "name": "歌手" }],
    "album": { "id": "alb_xxx", "name": "专辑名", "year": "2024", "cover": "https://..." },
    "duration": "03:45.123",
    "track": 3,
    "disc": 1,
    "genres": ["Hip-Hop"],
    "lyricist": ["词作者"],
    "composer": ["曲作者"],
    "arranger": ["编曲"],
    "cover": "https://...",
    "contributor": "贡献者",
    "comment": "本歌词来自于:贡献者@lrcshare.com",
    "video_url": "https://www.bilibili.com/video/...",
    "created_at": "2026-08-01T12:00:00+00:00"
  }
}
```

- `id` 不存在或未发布时返回 `404`
- `comment` 可直接整串写入音乐文件的 comment 标签作为署名

## 歌词

```
GET /v1/song/:id/lyric
```

```json
{
  "code": 200,
  "data": {
    "id": "s_purplesoul_013",
    "title": "歌名",
    "lrc": "[00:00.00] ...\n本歌词来自于:贡献者@lrcshare.com",
    "text": "纯文本歌词（部分歌曲无）",
    "comment": "本歌词来自于:贡献者@lrcshare.com"
  }
}
```

- `lrc`：完整时间轴的 LRC 歌词，**末尾自动追加一行来源署名**（纯文本行，不带时间戳），写入播放器或音乐文件标签后来源可溯
- `text`：纯文本/对照歌词（原文译文上下对照等），仅部分歌曲有，无则为 `null`
- 无 LRC 数据的歌曲 `lrc` 为 `null`（可回退用 `text`）

## 示例

```bash
curl "https://api.lrcshare.com/v1/songs?limit=10&offset=20"
curl "https://api.lrcshare.com/v1/song/s_purplesoul_013"
curl "https://api.lrcshare.com/v1/song/s_purplesoul_013/lyric"
```
