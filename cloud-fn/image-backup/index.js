// ============================================================================
// LrcShare · 图片灾备转存服务（阿里云函数计算 FC · Node.js 18+ · HTTP 触发器）
//
// 为什么迁到 FC：Netlify（美国节点）抓取 B站图床 i0.hdslb.com 受地域/防盗链
// 限制导致系统性失败；FC 上海节点与 OSS 同地域，国内 CDN 直连 B站毫秒级返回，
// 且 FC 每月 100 万次调用 + 40 万 GBs 永久免费额度，后台保存频率极低 → 实际 0 元。
//
// 部署：
//   1. 阿里云 FC 控制台 → 创建函数 → 事件函数 / HTTP 触发器
//   2. 运行环境 Node.js 18+，代码目录上传 cloud-fn/image-backup/
//   3. 配置环境变量：SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY /
//      OSS_REGION / OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET
//   4. HTTP 触发器得到一个公网地址，填入 VITE_IMAGE_BACKUP_URL
//
// 鉴权：与 Netlify 版一致——请求头 Authorization 必须携带 Supabase Auth 有效 JWT
//       （调 /auth/v1/user 验证）。匿名投稿不调用本函数，防止陌生人刷 OSS 流量。
// ============================================================================
import { backupImage, isAliyunOssUrl } from './oss.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

/** 管理端会话校验：Authorization 必须携带 Supabase Auth 有效 JWT */
async function assertAdmin(headers) {
  const auth = String(headers['authorization'] || headers['Authorization'] || '')
  const token = auth.replace(/^Bearer\s+/i, '').trim()
  if (!token) return false
  if (!SUPABASE_URL || !SERVICE_KEY) return false
  try {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${token}` },
    })
    return res.ok
  } catch {
    return false
  }
}

/** FC HTTP 触发器集成响应格式 */
function respond(statusCode, payload) {
  return {
    isBase64Encoded: false,
    statusCode,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    },
    body: JSON.stringify(payload),
  }
}

export async function handler(event, context) {
  // FC 新版 HTTP 触发器会把整个请求作为 Buffer 传入，需先解析
  if (Buffer.isBuffer(event)) {
    event = JSON.parse(event.toString('utf8'))
  } else if (typeof event === 'string') {
    event = JSON.parse(event)
  }

  const method = event.requestContext?.http?.method || event.http?.method || event.method || event.httpMethod || ''
  // 浏览器预检
  if (method === 'OPTIONS') return respond(200, {})
  if (method !== 'POST') return respond(405, { code: 405, error: '仅支持 POST' })
  if (!(await assertAdmin(event.headers))) {
    return respond(401, { code: 401, error: '未授权：需要管理员登录' })
  }

  let payload
  try {
    const raw = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body
    payload = JSON.parse(raw || '{}')
  } catch {
    return respond(400, { code: 400, error: '请求体不是合法 JSON' })
  }

  const sourceUrl = String(payload?.url || '').trim()
  if (!sourceUrl) return respond(400, { code: 400, error: '缺少 url 参数' })

  // 已是 OSS 地址：幂等直接返回
  if (isAliyunOssUrl(sourceUrl)) {
    return respond(200, { code: 0, data: { url: sourceUrl, cached: true, reused: true } })
  }

  try {
    const data = await backupImage(sourceUrl)
    return respond(200, { code: 0, data })
  } catch (e) {
    return respond(502, { code: 502, error: e?.message || '转存失败' })
  }
}
