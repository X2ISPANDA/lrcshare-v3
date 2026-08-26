# 快速开始

## ⚠️ 给调用者的忠告（务必先读）

LrcShare 是**小众人工整理曲库**（中文说唱/歌词为主），API 免费开放、无需注册，但服务能力有限（Cloudflare Workers 免费额度 10 万请求/天）。请把请求花在「库里真有的歌」上：

1. **先取目录，再搜索**：[`GET /v1/catalog`](/api/catalog) 一次返回全库可搜索文本快照。**快照里连查询词都找不到的歌，搜索接口必然返回空**——批量工具应先拉目录在本地过滤，命中候选才发搜索请求。一次目录请求（建议本地缓存 24h）可以替你省掉成千上万次无效搜索。官方 Lyrico 插件已内置此逻辑。
2. **别破坏边缘缓存**：相同 URL 的响应在 Cloudflare 边缘缓存（列表 10 分钟 / 详情 1 小时），不要在 URL 里加时间戳、随机数等噪声参数，让重复查询直接命中边缘节点。
3. **留意限流**：单个 IP 超过 100 次/10 秒会被临时阻止（HTTP 429，10 秒后自动解封）。正常手动使用远达不到，批量工具请控制并发、串行处理。
4. **空结果是正常业务结果**：小库命中是概率事件，`items: []` 不是错误，请做好兜底逻辑而不是重试轰炸。

## 基础信息

| 项目 | 说明 |
| --- | --- |
| 基础地址 | `https://api.lrcshare.com` |
| 鉴权 | 无需 API Key，匿名直接调用 |
| 请求方式 | 仅 `GET` |
| 响应格式 | JSON（UTF-8） |
| 跨域 | 支持，`Access-Control-Allow-Origin: *`，浏览器可直接 `fetch` |

## 核心流程：先搜索，后取详情

API 采用两段式设计：

```
① 关键词搜索 / 翻列表  →  轻量歌曲列表（歌名/歌手/专辑名/年份/风格/封面）
② 用户选中某首         →  /v1/song/:id 一次拿全部数据（歌词/词曲编/comment/...）
```

搜索结果刻意保持轻量（不含歌词、词曲编署名等大字段），适合直接渲染选择列表；用户确认目标后再按 `id` 取详情，一次请求拿到写标签所需的全部数据。

## 响应格式

所有接口统一包裹：

```json
// 成功：HTTP 200
{ "code": 200, "data": { ... } }

// 失败
{ "code": 404, "message": "song not found" }
```

`code` 与 HTTP 状态码一致：`200` 成功、`400` 参数错误、`404` 资源不存在、`405` 方法不允许、`500/502` 服务端错误。

## 分页

列表类接口（`/v1/songs`、`/v1/albums`、`/v1/artists`、搜索）统一使用 `limit` / `offset` 分页：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `limit` | `20` | 每页数量，1 ~ 100 |
| `offset` | `0` | 偏移量 |

列表响应中带 `total`（符合条件的总条数），可据此遍历全量数据。

## 第一个请求

按关键词搜索（返回轻量列表）：

```bash
curl "https://api.lrcshare.com/v1/search?keyword=紫"
```

从结果里选中一首，拿它的 `id` 获取全部数据（含歌词与署名）：

```bash
curl "https://api.lrcshare.com/v1/song/s_purplesoul_013"
```

## 浏览器 / Node.js 调用

```js
// 浏览器控制台直接可跑（支持跨域）
const res = await fetch('https://api.lrcshare.com/v1/search?keyword=紫')
const { code, data } = await res.json()
console.log(data.items) // 轻量列表：[{ id, title, artists, album, genres }]（封面在 album.cover）

// 选中后取详情
const detail = await fetch(`https://api.lrcshare.com/v1/song/${data.items[0].id}`)
const { data: song } = await detail.json()
console.log(song.title, song.lyricist, song.comment, song.lrc)
```

```python
# Python
import requests
r = requests.get('https://api.lrcshare.com/v1/search?keyword=紫')
song_id = r.json()['data']['items'][0]['id']
d = requests.get(f'https://api.lrcshare.com/v1/song/{song_id}').json()['data']
print(d['comment'])
print(d['lrc'])
```

## 数据说明

- 数据与 [LrcShare 主站](https://lrcshare.com) 同源（同一份数据库），接口读库，新歌审核通过后即可查到
- 歌词由贡献者人工整理校对，署名见 song 详情的 `comment` 字段与 `lrc` 末尾行
- 隐藏歌曲（主站需口令解锁的歌曲）在 API 中同样可获取——歌曲的词曲信息与歌词一并提供
