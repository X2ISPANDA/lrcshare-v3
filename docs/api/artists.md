# 艺术家

## 艺术家列表

```
GET /v1/artists
```

按名称排序的展示艺术家列表（仅 `is_show=true`，唱片公司等非创作者实体不返回）。

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `limit` | `20` | 每页数量，1 ~ 100 |
| `offset` | `0` | 偏移量 |

```json
{
  "code": 200,
  "data": {
    "total": 300,
    "limit": 20,
    "offset": 0,
    "items": [ { Artist 对象 } ]
  }
}
```

## 艺术家详情

```
GET /v1/artist/:id
```

```json
{
  "code": 200,
  "data": {
    "id": "art_xxx",
    "name": "艺术家名",
    "aliases": ["别名"],
    "types": ["singer", "lyricist"],
    "avatar": "https://...",
    "bio": "简介",
    "disambiguation": "同名艺术家消歧义说明"
  }
}
```

`types` 取值：`singer` 歌手 / `lyricist` 词作者 / `composer` 曲作者 / `arranger` 编曲等。

## 艺术家作品

```
GET /v1/artist/:id/songs
```

该艺术家参与的全部歌曲（演唱 + 作词 + 作曲 + 编曲），每首带 `roles` 标注实际参与身份。

```json
{
  "code": 200,
  "data": {
    "total": 25,
    "limit": 20,
    "offset": 0,
    "items": [
      {
        "id": "s_xxx",
        "title": "歌名",
        "artists": [{ "id": "art_xxx", "name": "歌手" }],
        "album": { "id": "alb_xxx", "name": "专辑名", "year": "2024", "cover": "https://..." },
        "genres": ["Hip-Hop"],
        "cover": "https://...",
        "roles": ["singer", "composer"]
      }
    ]
  }
}
```

- `items` 每项为[歌曲摘要](/api/objects#song-summary) + `roles`，选中后用 `id` 调 [/v1/song/:id](/api/songs#song-detail) 获取全部数据
- `roles` 取值：`singer` / `lyricist` / `composer` / `arranger`

## 示例

```bash
curl "https://api.lrcshare.com/v1/artists?limit=50"
curl "https://api.lrcshare.com/v1/artist/art_gai/songs?limit=100"
```
