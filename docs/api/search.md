# 搜索

```
GET /v1/search
```

四维度搜索，一次搜一个维度（与主站搜索框的四个 tab 一致）。

## 参数

| 参数 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `keyword` | 与 `title`/`artist` 二选一 | string | 模糊搜索关键词（整串匹配，适合网站式搜索） |
| `title` | 与 `keyword` 二选一 | string | 结构化查询：歌名（`type=song`）或专辑名（`type=album`），模糊匹配含别名/译名 |
| `artist` | 与 `keyword` 二选一 | string | 结构化查询：演唱者（`type=song`，TPE1/ARTIST）或专辑艺术家（`type=album`，TPE2/ALBUMARTIST），模糊匹配含别名 |
| `type` | 否 | string | 搜索维度：`song` 单曲 / `album` 专辑 / `artist` 艺术家 / `lyric` 歌词（默认 `song`） |
| `limit` | 否 | number | 每页数量，1 ~ 100（默认 20） |
| `offset` | 否 | number | 偏移量（默认 0） |

## 各维度行为

| type | 匹配范围 | 返回 |
| --- | --- | --- |
| `song` | 歌名 + 歌的别名/译名 + 艺术家名/别名（如日文歌的中文译名、艺术家简称或译名可直接搜，命中艺术家即返回其全部已发布歌曲） | [歌曲摘要](/api/objects#song-summary)数组 |
| `album` | 专辑名 | [Album 对象](/api/objects#album)数组 |
| `artist` | 艺术家名（含 `is_show=true` 的展示艺术家） | [Artist 对象](/api/objects#artist)数组 |
| `lyric` | 歌词内容，返回命中歌曲 | [歌曲摘要](/api/objects#song-summary)数组 |

`type=song` / `lyric` 返回的是**轻量摘要**（歌名/歌手/专辑名+年份/风格/封面），渲染选择列表用；用户确认目标后用 `id` 调 [/v1/song/:id](/api/song#song-detail) 获取全部数据。

批量匹配场景请先看 [目录快照](/api/catalog)：查询词不在目录文本中即可直接跳过，不必发搜索请求。

## 关键词搜索的排序机制（type=song）

面向想精确控制选择逻辑的调用方（如打标工具「自动取第一条」），这里公开 `keyword` 搜索的内部排序规则。整个排序在数据库端完成，API 返回的顺序即最终顺序。

### 第一层：入围判定（宽松语义）

关键词按空白拆分为 token（去重），**至少命中 1 个 token** 的已发布歌曲即入围：

- 命中 = 歌名/歌的别名**包含**该 token（子串，大小写不敏感，`%`/`_` 为普通字符）
- 或 演唱/词/曲/编任一关联艺术家（含专辑艺术家）的**名字或别名包含**该 token

宁多勿无：多词查询部分落空也返回结果（命中越多越靠前），不会因某个词不匹配直接给 0 结果。

### 第二层：排序（依次比较，前一级相同时才看后一级）

**① 整串命中优先**——歌名或别名**连续包含完整查询串**（如搜 `No Money No Friend`，别名恰为这个串）排绝对第一。这是安全网：任何分数叠加都翻不过它，精确匹配永远置顶。

**② 命中 token 数**——5 个 token 命中 4 个的排命中 1 个的前面。

**③ 相关度总分**——每个 token 按下表取**单字段最高一档**（不叠加），跨 token 求和：

| 档位 | 分值 | 判定 |
| --- | --- | --- |
| 歌名/别名**完全相等** | 6 | token 与整段歌名（或任一别名）精确相等（lower + trim 归一） |
| 艺术家**完全相等** | 4 | token 与任一关联艺术家（含别名，含专辑艺术家）的名字精确相等 |
| 歌名**强包含** | 3 | 纯 ASCII：词边界整词（`no` 命中 `No Cap`，不命中 `Nothing`）；含中文：≥2 字符的子串 |
| 别名**强包含** | 2.5 | 同上，作用于别名 |
| 艺术家**子串** | 1.5 | token 是艺术家名/别名的子串（搜《孤勇者》不会因歌手名含「孤」被抬高） |
| 歌名**子串** | 1.5 | 普通子串（`no` 命中 `November` 是弱信号） |
| 别名**子串** | 1 | 同上，作用于别名 |

设计取舍说明：

- **精确相等和完全匹配给绝对高分**：搜完整歌名时目标歌曲几乎不可能被其他字段叠加反超
- **艺术家完全相等（4）> 歌名整词（3）**：用户输入等于某歌手名时，返回该歌手的歌优先是正常预期
- **中英文平权**：中文没有词边界概念，≥2 字的中文子串选择性 ≈ 英文整词（`北京` 命中《北京晚报》拿 3 分）；单字中文是弱信号压回 1.5（搜「爱」不会让几百首带爱的歌霸榜）
- **单字段单次计分**：一条歌多个别名命中同一 token 只算一次，靠 case 顺序保证

**④ 歌名字母序**——前三层全相同时按歌名排（ASCII 在前，中文按 Unicode 码点），保证结果稳定。

### 给调用方的实践建议

- **自动取第一条**的场景基本可靠：整串命中 + 高分匹配永远在前
- 排序不满意时**多传一个词**收敛范围（如补上艺术家名），比指望排序猜对你的意图更稳
- 有更精确的结构化数据（文件 tag 的独立歌名/艺术家字段）优先走下面的结构化查询，不参与这套打分

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

**错误响应**

```json
// keyword 与 title/artist 同传，或两者都缺
{ "code": 400, "message": "keyword 与 title/artist 互斥" }
```

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
