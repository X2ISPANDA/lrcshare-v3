# 专辑

## 专辑列表

按专辑名排序的全量专辑列表。

```
GET /v1/albums
```

| 参数 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `limit` | 否 | number | 每页数量，1 ~ 100（默认 20） |
| `offset` | 否 | number | 偏移量（默认 0） |

```json
{
  "code": 200,
  "data": {
    "total": 120,
    "limit": 20,
    "offset": 0,
    "items": [ { Album 对象 } ]
  }
}
```

## 专辑详情

专辑信息 + 完整曲目表（按碟号、曲目号排序）。

```
GET /v1/album/:id
```

**URL 参数**

| 参数 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `id` | 是 | string | 专辑 ID（如 `alb_xxx`） |

```json
{
  "code": 200,
  "data": {
    "id": "alb_xxx",
    "name": "专辑名",
    "year": "2024",
    "cover": "https://...",
    "artists": [{ "id": "art_xxx", "name": "专辑艺术家" }],
    "songs": [
      {
        "id": "s_xxx",
        "title": "歌名",
        "artists": [{ "id": "art_xxx", "name": "歌手" }],
        "album": { "id": "alb_xxx", "name": "专辑名", "year": "2024", "cover": "https://...", "artists": [{ "id": "art_xxx", "name": "专辑艺术家" }] },
        "genres": ["Hip-Hop"],
        "track": 1,
        "disc": 1
      }
    ]
  }
}
```

- `songs` 内每项为[歌曲摘要](/api/objects#song-summary) + `track`（曲目号）/ `disc`（碟号）——选中心仪曲目后用其 `id` 调 [/v1/song/:id](/api/song#song-detail) 获取词曲编、歌词等全部数据
- 多碟专辑按 `disc` 分组展示即可

**错误响应**

```json
// 专辑不存在或未发布
{ "code": 404, "message": "album not found" }
```

## 示例

```bash
curl "https://api.lrcshare.com/v1/albums?limit=30"
curl "https://api.lrcshare.com/v1/album/alb_xxx"
```
