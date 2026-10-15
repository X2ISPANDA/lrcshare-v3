// @ts-check
/**
 * LrcShare 图片灾备转存服务（Netlify Function，单端点）
 *
 * POST /api/image-backup （经 netlify.toml redirect 到 /.netlify/functions/image-backup）
 * body: { url: string }  外链图片地址（B站图床等）
 * 返回: { code: 0, data: { url, key, sha256, size, contentType, cached } }
 *
 * 行为：
 *   服务端抓取外链图片 → 校验为图片/≤10MB → 按内容 SHA-256 寻址上传 OSS
 *   （同图只存一份，已存在则秒回不重复上传）。密钥只存在于函数环境变量，浏览器不可见。
 *
 * 鉴权：与 mailer 同一套管理员 JWT 校验（公开注册已关闭，能通过的仅管理员）。
 *      匿名投稿链路不调用本函数，防止陌生人刷 OSS 流量。
 *
 * 所需 Netlify 环境变量：
 *   SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY   管理员 JWT 校验
 *   OSS_REGION / OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET
 */
import { backupImage, isAliyunOssUrl } from './_lib/oss.mjs'

/** 管理端会话校验：Authorization 必须携带 Supabase Auth 有效 JWT（调 /auth/v1/user 验证） */
async function assertAdmin(req) {
  const token = String(req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return false
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return false
  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
    })
    return res.ok
  } catch {
    return false
  }
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

export default async (req) => {
  if (req.method !== 'POST') return json(405, { code: 405, error: '仅支持 POST' })
  if (!(await assertAdmin(req))) return json(401, { code: 401, error: '未授权：需要管理员登录' })

  let payload
  try {
    payload = await req.json()
  } catch {
    return json(400, { code: 400, error: '请求体不是合法 JSON' })
  }
  const sourceUrl = String(payload?.url || '').trim()
  if (!sourceUrl) return json(400, { code: 400, error: '缺少 url 参数' })
  if (isAliyunOssUrl(sourceUrl)) {
    // 已经是 OSS 地址无需再转存（幂等保护，调用方一般会先自行拦截）
    return json(200, { code: 0, data: { url: sourceUrl, cached: true, reused: true } })
  }

  try {
    const data = await backupImage(sourceUrl)
    return json(200, { code: 0, data })
  } catch (e) {
    return json(502, { code: 502, error: e?.message || '转存失败' })
  }
}
