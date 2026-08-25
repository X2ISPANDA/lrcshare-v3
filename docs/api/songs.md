# 歌曲与歌词

## 歌曲列表 {#song-list}

```
GET /v1/songs
```

最新收录的歌曲（按收录时间倒序），用于增量同步全站曲目。

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `limit` | `20` | 每页数量，1 ~ 100 |
| `offset` | `0` | 偏移量 |

返回**轻量摘要**（与搜索 `type=song` 同构），适合渲染选择列表：

```json
{
  "code": 200,
  "data": {
    "total": 532,
    "limit": 20,
    "offset": 0,
    "items": [
      {
        "id": "s_purplesoul_013",
        "title": "歌名",
        "artists": [{ "id": "art_xxx", "name": "歌手" }],
        "album": { "id": "alb_xxx", "name": "专辑名", "year": "2024", "cover": "https://..." },
        "genres": ["Hip-Hop"]
      }
    ]
  }
}
```

## 歌曲详情 {#song-detail}

```
GET /v1/song/:id
```

用户在列表中确认目标后调用，**一次请求返回全部数据**——元数据、词曲编署名、歌词、来源 comment 全在这里。

```json
{
  "code": 200,
  "data": {
    "id": "s_purplesoul_013",
    "title": "歌名",
    "aliases": ["别名", "英文名"],
    "artists": [{ "id": "art_a", "name": "歌手A" }, { "id": "art_b", "name": "歌手B" }],
    "album": { "id": "alb_xxx", "name": "专辑名", "year": "2024", "cover": "https://..." },
    "track": 3,
    "disc": 1,
    "genres": ["Hip-Hop", "Trap"],
    "lyricist": ["词作者A", "词作者B"],
    "composer": ["曲作者"],
    "arranger": ["编曲"],
    "comment": "本歌词来自于:贡献者@lrcshare.com",
    "lrc": "[00:00.00] ...\n本歌词来自于:贡献者@lrcshare.com"
  }
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `lrc` | 完整时间轴的 LRC 歌词，**末尾自动追加一行来源署名**（纯文本行，不带时间戳），写入播放器或音乐文件标签后来源可溯；无 LRC 数据时为 `null` |
| `comment` | 署名字符串，可直接整串写入音乐文件的 comment 标签；无贡献者时为 `本歌词来自于:lrcshare.com` |
| `lyricist` / `composer` / `arranger` | 作词 / 作曲 / 编曲（名字数组，多人合作多项，写入标签时自行拼接） |
| `genres` | 流派数组（多风格并存，写入标签时自行拼接） |

各字段与 ID3v2 / Vorbis 标签帧的对应关系见[数据对象](/api/objects)。

- `id` 不存在或未发布时返回 `404`
- 写音乐标签建议：`LYRICS` ← `lrc`，`COMMENT` ← `comment`，其余按字段对应

## 示例

```bash
curl "https://api.lrcshare.com/v1/songs?limit=10&offset=20"
curl "https://api.lrcshare.com/v1/song/s_purplesoul_013"
```
