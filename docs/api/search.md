# 搜索

```
GET /v1/search
```

四维度搜索，一次搜一个维度（与主站搜索框的四个 tab 一致）。

## 参数

| 参数 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `keyword` | 是 | — | 搜索关键词 |
| `type` | 否 | `song` | 搜索维度：`song` 单曲 / `album` 专辑 / `artist` 艺术家 / `lyric` 歌词 |
| `limit` | 否 | `20` | 每页数量，1 ~ 100 |
| `offset` | 否 | `0` | 偏移量 |

## 各维度行为

| type | 匹配范围 |
| --- | --- |
| `song` | 歌名 + 别名/译名（如日文歌的中文译名可直接搜） |
| `album` | 专辑名 |
| `artist` | 艺术家名（含 `is_show=true` 的展示艺术家） |
| `lyric` | 歌词内容（LRC 与纯文本），返回命中歌曲的元数据 |

## 响应

```json
{
  "code": 200,
  "data": {
    "keyword": "紫",
    "type": "song",
    "total": null,
    "items": [ { Song 对象 } ]
  }
}
```

- `type=song` 时 `items` 为 [Song 对象](/api/objects#song)数组（不含歌词内容），`total` 不返回（库端模糊搜索无精确计数）
- `type=album` / `artist` / `lyric` 时带 `total`
- `type=album` 的 `items` 为 [Album 对象](/api/objects#album)数组；`type=artist` 为 [Artist 对象](/api/objects#artist)数组

## 示例

```bash
# 搜单曲
curl "https://api.lrcshare.com/v1/search?keyword=紫&type=song"

# 搜专辑
curl "https://api.lrcshare.com/v1/search?keyword=逍遥客&type=album"

# 用歌词内容反查歌曲
curl "https://api.lrcshare.com/v1/search?keyword=我说的&type=lyric&limit=5"
```
