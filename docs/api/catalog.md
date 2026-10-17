# 目录快照

```
GET /v1/catalog
```

全库可搜索文本快照，一次请求拿到库内**全部可被搜索命中的文本**：

- 已发布歌曲的**歌名与别名/译名**
- 全部可见艺术家的**名字与别名**（覆盖演唱/作词/作曲/编曲四路关联，与 `type=song` 搜索的匹配范围一致）
- 全部**专辑名**

文本已统一转为小写、去重、按行拼接（`\n` 分隔）。

::: warning 此端点无需 `X-LrcShare-Session`
`/v1/catalog` 是唯一不需要会话凭证的端点，但仍需携带 `X-API-Key`。响应中会返回 `session_token`，用于访问其他端点。
:::

## 为什么需要它：负向预过滤

搜索接口的所有匹配都是**子串匹配**（`keyword` 整串、`title`/`artist` 分字段，均含别名）。因此有一条严格的数学保证：

> 查询串（及其任意「歌名 / 艺术家」切分组合）在快照文本中找不到 ⇒ 搜索必然返回 0 条 ⇒ **无需发请求**

LrcShare 是小众曲库，批量工具面对的歌单里绝大多数歌根本不在库中。先拉一份目录在本地过滤，命中候选才调 [搜索](/api/search)，可以把十万首歌的批量匹配从十万次请求降到「几十次目录翻页 + 库内命中歌曲的少量请求」。

## 响应

```json
{
  "code": 200,
  "data": {
    "generated_at": "2026-08-26T12:00:00.000Z",
    "songs": 1234,
    "artists": 567,
    "albums": 89,
    "text": "right now\nright now (otaku mobb remix)\n龍胆紫\n龙胆紫purplesoul\n...",
    "session_token": "eyJjbGllbnRfaWQiOiIuLi4iLCJpYXQiOjE3OTIyNDUyNzQ3MDJ9.xxxxx"
  }
}
```

| 字段 | 说明 |
| --- | --- |
| `generated_at` | 快照生成时间（ISO 8601），可用于对比新旧 |
| `songs` / `artists` / `albums` | 对应实体数量（计数用途） |
| `text` | 全库可搜索文本，小写、去重、`\n` 分隔。**预过滤只需要这一个字段** |
| `session_token` | 会话凭证，有效期 24h。访问其他端点时需在 `X-LrcShare-Session` 头中携带 |

- 此端点**不走边缘缓存**（响应含 per-client session_token），数据本体由服务端 KV 缓存兜底
- 建议调用方本地缓存 `text` 24 小时（新歌入库后最多一天可搜到）；`session_token` 同样缓存 24h

## 推荐用法：批量匹配模式

```js
// ① 每日拉一次目录（本地缓存 24h），同时拿到 session_token
const API_KEY = 'ls_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
const { data: catalog } = await fetch('https://api.lrcshare.com/v1/catalog', {
  headers: { 'X-API-Key': API_KEY }
}).then(r => r.json())
const sessionToken = catalog.session_token

// ② 本地负向过滤：token 不在目录文本中 → 库里必然没有，跳过
const batch = [
  { title: '晴天', artist: '周杰伦' },       // 目录里没有 → 跳过，0 请求
  { title: 'Right now', artist: 'YoungQueenz' } // 目录里有 → 发搜索确认
]
for (const song of batch) {
  const inLibrary =
    catalog.text.includes(song.title.toLowerCase()) &&
    catalog.text.includes(song.artist.toLowerCase())
  if (!inLibrary) continue

  // ③ 候选才调结构化搜索，带 X-API-Key + X-LrcShare-Session
  const res = await fetch(
    `https://api.lrcshare.com/v1/search?type=song&title=${encodeURIComponent(song.title)}&artist=${encodeURIComponent(song.artist)}`,
    { headers: { 'X-API-Key': API_KEY, 'X-LrcShare-Session': sessionToken } }
  ).then(r => r.json())
  // ...选中后 GET /v1/song/:id
}
```

```python
import requests

API_KEY = 'ls_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
headers = {'X-API-Key': API_KEY}

catalog = requests.get('https://api.lrcshare.com/v1/catalog', headers=headers).json()['data']
text = catalog['text']
session_token = catalog['session_token']
api_headers = {**headers, 'X-LrcShare-Session': session_token}

for song in my_library:  # 十万首
    if song['title'].lower() not in text:
        continue  # 目录里没有 → 必然搜不到 → 跳过，不发请求
    # 候选才搜索
    r = requests.get('https://api.lrcshare.com/v1/search', headers=api_headers, params={
        'type': 'song', 'title': song['title'], 'artist': song['artist'],
    }).json()
```

::: tip 判断逻辑与搜索语义严格对齐
「任一字段在目录中不存在才跳过」是保守判断：跨字段的偶然撞词（如歌名恰好也是某艺术家名）只会多产生一次搜索请求，**绝不会漏掉库里真实存在的歌**。
:::

## 示例

```bash
curl -H "X-API-Key: ls_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" "https://api.lrcshare.com/v1/catalog"
```
