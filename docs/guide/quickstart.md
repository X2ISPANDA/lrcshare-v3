# 快速开始

## ⚠️ 给调用者的忠告（务必先读）

LrcShare 是**小众人工整理曲库**（中文说唱/歌词为主），API 免费开放，需申请 API Key，但服务能力有限（Cloudflare Workers 免费额度 10 万请求/天）。请把请求花在「库里真有的歌」上：

1. **先取目录，再搜索**：[`GET /v1/catalog`](/api/catalog) 一次返回全库可搜索文本快照 + `session_token`。**快照里连查询词都找不到的歌，搜索接口必然返回空**——批量工具应先拉目录在本地过滤，命中候选才发搜索请求。一次目录请求（建议本地缓存 24h）可以替你省掉成千上万次无效搜索。官方 Lyrico 插件已内置此逻辑。
2. **别破坏边缘缓存**：相同 URL 的响应在 Cloudflare 边缘缓存（列表 10 分钟 / 详情 1 小时），不要在 URL 里加时间戳、随机数等噪声参数，让重复查询直接命中边缘节点。
3. **留意限流**：单个 IP 超过 100 次/10 秒会被临时阻止（HTTP 429，10 秒后自动解封）。正常手动使用远达不到，批量工具请控制并发、串行处理。
4. **妥善保管 API Key**：Key 随客户端分发，若被滥用可在后台封禁。不要把 Key 硬编码到开源仓库的公开代码中。
5. **空结果是正常业务结果**：小库命中是概率事件，`items: []` 不是错误，请做好兜底逻辑而不是重试轰炸。

## 基础信息

| 项目 | 说明 |
| --- | --- |
| 基础地址 | `https://api.lrcshare.com` |
| 文档地址 | `https://api.lrcshare.com/docs/` |
| 鉴权 | 需 `X-API-Key`；非 catalog 端点还需 `X-LrcShare-Session`（由 `/v1/catalog` 返回） |
| 请求方式 | 仅 `GET` |
| 响应格式 | JSON（UTF-8） |
| 跨域 | 支持，`Access-Control-Allow-Origin: *`，浏览器可直接 `fetch` |

## 核心流程：先取目录，再搜索，后取详情

API 采用三段式设计：

```
① GET /v1/catalog        →  拿 session_token（24h 有效）+ 全库文本快照（本地负向过滤）
② 关键词搜索 / 翻列表      →  轻量歌曲列表（歌名/歌手/专辑名/年份/风格/封面）
③ 用户选中某首             →  /v1/song/:id 一次拿全部数据（歌词/词曲编/comment/...）
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

`code` 与 HTTP 状态码一致：`200` 成功、`400` 参数错误、`401` 缺少 API Key、`403` Key 无效/封禁、`419` Session 过期、`404` 资源不存在、`405` 方法不允许、`500/502` 服务端错误。完整错误码见[使用要求](/guide/requirements#错误码)。

## 分页

列表类接口（`/v1/songs`、`/v1/albums`、`/v1/artists`、搜索）统一使用 `limit` / `offset` 分页：

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `limit` | `20` | 每页数量，1 ~ 100 |
| `offset` | `0` | 偏移量 |

列表响应中带 `total`（符合条件的总条数），可据此遍历全量数据。

## 第一个请求

先调目录拿 `session_token`（catalog 是唯一不需要 session 的端点）：

```bash
curl -H "X-API-Key: ls_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" "https://api.lrcshare.com/v1/catalog"
```

响应中 `data.session_token` 即会话凭证。带它搜索：

```bash
curl -H "X-API-Key: ls_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
     -H "X-LrcShare-Session: <上一步的 session_token>" \
     "https://api.lrcshare.com/v1/search?keyword=紫"
```

从结果里选中一首，拿它的 `id` 获取全部数据（含歌词与署名）：

```bash
curl -H "X-API-Key: ls_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" \
     -H "X-LrcShare-Session: <session_token>" \
     "https://api.lrcshare.com/v1/song/s_purplesoul_013"
```

## 浏览器 / Node.js 调用

```js
const API_KEY = 'ls_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'

// ① 取目录，拿 session_token（catalog 不需要 session）
const catalogRes = await fetch('https://api.lrcshare.com/v1/catalog', {
  headers: { 'X-API-Key': API_KEY }
})
const { data: catalog } = await catalogRes.json()
const sessionToken = catalog.session_token // 缓存 24h

// ② 搜索
const res = await fetch('https://api.lrcshare.com/v1/search?keyword=紫', {
  headers: { 'X-API-Key': API_KEY, 'X-LrcShare-Session': sessionToken }
})
const { data } = await res.json()
console.log(data.items) // 轻量列表：[{ id, title, artists, album, genres }]

// ③ 取详情
const detail = await fetch(`https://api.lrcshare.com/v1/song/${data.items[0].id}`, {
  headers: { 'X-API-Key': API_KEY, 'X-LrcShare-Session': sessionToken }
})
const { data: song } = await detail.json()
console.log(song.title, song.lyricist, song.comment, song.lrc)
```

```python
import requests

API_KEY = 'ls_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
headers = {'X-API-Key': API_KEY}

# ① 取目录
catalog = requests.get('https://api.lrcshare.com/v1/catalog', headers=headers).json()['data']
session_token = catalog['session_token']
api_headers = {**headers, 'X-LrcShare-Session': session_token}

# ② 搜索
r = requests.get('https://api.lrcshare.com/v1/search', headers=api_headers, params={'keyword': '紫'})
song_id = r.json()['data']['items'][0]['id']

# ③ 取详情
d = requests.get(f'https://api.lrcshare.com/v1/song/{song_id}', headers=api_headers).json()['data']
print(d['comment'])
print(d['lrc'])
```

## 数据说明

- 数据与 [LrcShare 主站](https://lrcshare.com) 同源（同一份数据库），接口读库，新歌审核通过后即可查到
- 歌词由贡献者人工整理校对，署名见 song 详情的 `comment` 字段与 `lrc` 末尾行
- 隐藏歌曲（主站需口令解锁的歌曲）在 API 中同样可获取——歌曲的词曲信息与歌词一并提供
