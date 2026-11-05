# 错误码

所有接口统一返回 JSON，HTTP 状态码与响应体 `code` 字段一致：

```json
{ "code": 404, "message": "song not found" }
```

> 例外：未携带 `X-API-Key`、Key 不在 WAF 白名单内，或触发速率限制的请求会在 Cloudflare 边缘被拦截，返回 HTML 拦截页（HTTP 403 / 429），没有 JSON 响应体。
>
> 因此客户端**不要假定所有错误响应都是 JSON**：建议按 HTTP 状态码做分支，403 且响应体为 HTML 时提示用户检查 API Key。

## 错误码对照

| 状态码 | 含义 | 触发场景 | 处理建议 |
| --- | --- | --- | --- |
| 200 | 成功 | 请求正常 | — |
| 400 | 请求参数错误 | 缺参数、参数互斥、非法百分号编码等 | 检查参数，详见各端点文档 |
| 401 | 缺少 API Key（Worker 兜底） | 请求绕过边缘规则直接到达 Worker | 正常公开端点不会出现；补上 `X-API-Key` |
| 403 | Key 不在白名单（边缘拦截） | 未携带 `X-API-Key`，或携带的 Key 未通过 WAF 白名单校验 | 返回 HTML 拦截页（非 JSON）；确认 Key 已签发且在白名单内 |
| 403 | Key 已封禁（Worker） | Key 通过白名单，但后台状态为 `banned` | 返回 JSON；联系站长确认 Key 状态 |
| 404 | 资源不存在 | 歌曲 / 专辑 / 艺术家不存在，或路径未知 | 检查 ID 是否正确；待审核 / 下架歌曲 API 不返回 |
| 405 | 方法不允许 | 非 GET 请求 | 所有接口仅支持 GET |
| 419 | Session 过期 | `X-LrcShare-Session` 缺失、无效或过期 | 重新调用 `GET /v1/catalog` 获取新的 `session_token` |
| 429 | 请求过于频繁 | 单个 IP 超过 300 次 / 10 秒，被 Cloudflare 边缘拦截 | 退避重试，约 10 秒后自动解封；批量工具请控制并发 |
| 500 | 内部错误 | Worker 运行异常 | 稍后重试；持续出现请联系站长 |
| 502 | 上游错误 | Supabase 查询失败 | 稍后重试 |

## 鉴权相关

| 状态码 | 说明 |
| --- | --- |
| 403 | 未携带 `X-API-Key` 或 Key 不在白名单：Cloudflare 边缘拦截，返回 HTML 拦截页（非 JSON） |
| 403 | Key 在白名单内但已被后台封禁（JSON 响应，封禁即时生效） |
| 401 | 缺少 `X-API-Key`（仅边缘规则未覆盖时由 Worker 兜底） |
| 419 | 未携带 `X-LrcShare-Session`，或 session_token 已过期（24h） |

鉴权流程详见[使用要求](/guide/requirements)。
