# 快速开始

## 基础信息

| 项目 | 说明 |
| --- | --- |
| 基础地址 | `https://api.lrcshare.com` |
| 鉴权 | 无需 API Key，匿名直接调用 |
| 请求方式 | 仅 `GET` |
| 响应格式 | JSON（UTF-8） |
| 跨域 | 支持，`Access-Control-Allow-Origin: *`，浏览器可直接 `fetch` |

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

获取最新收录的 5 首歌：

```bash
curl "https://api.lrcshare.com/v1/songs?limit=5"
```

按关键词搜索：

```bash
curl "https://api.lrcshare.com/v1/search?keyword=紫"
```

获取某首歌的歌词（含来源署名）：

```bash
curl "https://api.lrcshare.com/v1/song/s_example_001/lyric"
```

## 浏览器 / Node.js 调用

```js
// 浏览器控制台直接可跑（支持跨域）
const res = await fetch('https://api.lrcshare.com/v1/search?keyword=紫')
const { code, data } = await res.json()
console.log(data.items)
```

```js
// Node.js 18+
const res = await fetch('https://api.lrcshare.com/v1/song/s_example_001')
const { data: song } = await res.json()
console.log(song.title, song.artists, song.comment)
```

```python
# Python
import requests
r = requests.get('https://api.lrcshare.com/v1/song/s_example_001/lyric')
print(r.json()['data']['lrc'])
```

## 数据说明

- 数据与 [LrcShare 主站](https://v3.lrcshare.com) 实时同步（主站每 6 小时重建一次，数据库为同一份）
- 歌词由贡献者人工整理校对，署名信息见每个 song 对象的 `comment` 字段
- 隐藏歌曲（主站需口令解锁的歌曲）在 API 中同样可获取——歌曲的词曲信息与歌词一并提供
