# 专辑

## 专辑列表

```
GET /v1/albums
```

按专辑名排序的全量专辑列表。

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `limit` | `20` | 每页数量，1 ~ 100 |
| `offset` | `0` | 偏移量 |

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

```
GET /v1/album/:id
```

专辑信息 + 完整曲目表（按碟号、曲目号排序，多碟专辑自动分组于 `disc` 字段）。

```json
{
  "code": 200,
  "data": {
    "id": "alb_xxx",
    "name": "专辑名",
    "year": "2024",
    "cover": "https://...",
    "artists": [{ "id": "art_xxx", "name": "专辑艺术家" }],
    "description": "专辑介绍（Markdown 富文本）",
    "created_at": "2026-01-01T00:00:00+00:00",
    "songs": [ { Song 对象 } ]
  }
}
```

- `songs` 内每项为完整 [Song 对象](/api/objects#song)（含各自独立的词曲编署名）
- `id` 不存在时返回 `404`

## 示例

```bash
curl "https://api.lrcshare.com/v1/albums?limit=30"
curl "https://api.lrcshare.com/v1/album/alb_xxx"
```
