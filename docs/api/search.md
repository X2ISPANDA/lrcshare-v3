# 搜索

```
GET /v1/search
```

四维度搜索，一次搜一个维度（与主站搜索框的四个 tab 一致）。

## 参数

| 参数 | 必填 | 默认 | 说明 |
| --- | --- | --- | --- |
| `keyword` | 与 `title`/`artist` 二选一 | — | 模糊搜索关键词（整串匹配，适合网站式搜索） |
| `title` | 与 `keyword` 二选一 | — | 结构化查询：歌名（`type=song`）或专辑名（`type=album`），模糊匹配含别名/译名 |
| `artist` | 与 `keyword` 二选一 | — | 结构化查询：演唱者（`type=song`，TPE1/ARTIST）或专辑艺术家（`type=album`，TPE2/ALBUMARTIST），模糊匹配含别名 |
| `type` | 否 | `song` | 搜索维度：`song` 单曲 / `album` 专辑 / `artist` 艺术家 / `lyric` 歌词 |
| `limit` | 否 | `20` | 每页数量，1 ~ 100 |
| `offset` | 否 | `0` | 偏移量 |

## 各维度行为

| type | 匹配范围 | 返回 |
| --- | --- | --- |
| `song` | 歌名 + 歌的别名/译名 + 艺术家名/别名（如日文歌的中文译名、艺术家简称或译名可直接搜，命中艺术家即返回其全部已发布歌曲） | [歌曲摘要](/api/objects#song-summary)数组 |
| `album` | 专辑名 | [Album 对象](/api/objects#album)数组 |
| `artist` | 艺术家名（含 `is_show=true` 的展示艺术家） | [Artist 对象](/api/objects#artist)数组 |
| `lyric` | 歌词内容，返回命中歌曲 | [歌曲摘要](/api/objects#song-summary)数组 |

`type=song` / `lyric` 返回的是**轻量摘要**（歌名/歌手/专辑名+年份/风格/封面），渲染选择列表用；用户确认目标后用 `id` 调 [/v1/song/:id](/api/songs#song-detail) 获取全部数据。

批量匹配场景请先看 [目录快照](/api/catalog)：查询词不在目录文本中即可直接跳过，不必发搜索请求。

## 结构化查询（title / artist）

面向音乐软件/打标工具：调用方从文件 tag 拿到的是独立的歌名与艺术家字段（TIT2/TPE1、TALB/TPE2），直接传结构化参数，无需拼串。

- 仅支持 `type=song` 和 `type=album`，其他 type 传 `title`/`artist` 返回 400
- `keyword` 与 `title`/`artist` 互斥，同传返回 400；两者都缺返回 400
- `title` 与 `artist` 为 AND 关系：同名作品靠另一维度过滤（如多张同名专辑 + 专辑艺术家精确定位）
- 可单传一个：只传 `artist` 等于列出该艺术家（含别名命中）的全部作品
- 响应回显 `title`/`artist` 而非 `keyword`，其余结构一致（含 `total`）

| type | title 匹配 | artist 匹配 |
| --- | --- | --- |
| `song` | 歌名 + 歌的别名/译名 | 演唱者名 + 别名（TPE1） |
| `album` | 专辑名 | 专辑艺术家名 + 别名（TPE2） |

## 响应

```json
{
  "code": 200,
  "data": {
    "keyword": "紫",
    "type": "song",
    "total": null,
    "items": [
      {
        "id": "s_purplesoul_013",
        "title": "歌名",
        "artists": [{ "id": "art_a", "name": "歌手A" }, { "id": "art_b", "name": "歌手B" }],
        "album": { "id": "alb_xxx", "name": "专辑名", "year": "2024", "cover": "https://...", "artists": [{ "id": "art_a", "name": "歌手A" }] },
        "genres": ["Hip-Hop", "Trap"]
      }
    ]
  }
}
```

- 所有搜索（含结构化查询）均返回 `total`（命中总数，用于分页）；上游计数不可用时为 `null`

## 示例

```bash
# 搜单曲
curl "https://api.lrcshare.com/v1/search?keyword=紫&type=song"

# 搜专辑
curl "https://api.lrcshare.com/v1/search?keyword=逍遥客&type=album"

# 用歌词内容反查歌曲
curl "https://api.lrcshare.com/v1/search?keyword=我说的&type=lyric&limit=5"

# 结构化查询：歌名 + 演唱者（打标场景，来自文件 tag）
curl "https://api.lrcshare.com/v1/search?type=song&title=Right%20now&artist=YoungQueenz"

# 结构化查询：只传艺术家，列出其全部已发布歌曲（含别名命中）
curl "https://api.lrcshare.com/v1/search?type=song&artist=龙胆紫"

# 结构化查询：同名专辑 + 专辑艺术家精确定位
curl "https://api.lrcshare.com/v1/search?type=album&title=II&artist=西红"
```
