// @ts-check
/**
 * 阿里云 OSS 最小客户端（零三方依赖，Node 18+ 内置 fetch / Web Crypto）
 *
 * 仅供图片灾备转存使用：
 *   - headObject  判断对象是否已存在（配合 SHA-256 key 做内容去重，同图只传一份）
 *   - putObject   上传图片（公共读 bucket，PUT 走 V1 签名，不受防盗链 Referer 限制）
 *   - backupImage 从外链抓图 → 校验 → 哈希去重 → 上传，返回可公共访问的 OSS URL
 *
 * OSS Key 规则（内容寻址）：
 *   backup/{sha256前2位}/{sha256完整值}.{扩展名}
 *   * 同一张图片（字节级一致）哈希相同 → 物理上只存一份，多次引用只传一次；
 *   * 所有灾备对象统一在 backup/ 前缀下，RAM 子账号只授该前缀权限即可收口。
 *
 * 所需环境变量（Netlify 函数环境 / 本地回填脚本环境）：
 *   OSS_REGION             地域 ID，如 cn-shanghai（华东2-上海）
 *   OSS_BUCKET             bucket 名，如 lrcshare
 *   OSS_ACCESS_KEY_ID      RAM 子账号 AccessKey Id
 *   OSS_ACCESS_KEY_SECRET  RAM 子账号 AccessKey Secret
 *   OSS_HOST               可选，默认 {bucket}.oss-{region}.aliyuncs.com
 */
import crypto from 'node:crypto'

/** 单图大小上限：10MB（封面/头像类图片足够，异常大图直接拒绝，避免内存/流量滥用） */
const MAX_IMAGE_BYTES = 10 * 1024 * 1024

/** 抓图超时（B站图床正常情况下毫秒级返回） */
const FETCH_TIMEOUT_MS = 15000

function getConfig() {
  const region = process.env.OSS_REGION
  const bucket = process.env.OSS_BUCKET
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET
  if (!region || !bucket || !accessKeyId || !accessKeySecret) {
    throw new Error('缺少 OSS 环境变量：OSS_REGION / OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET')
  }
  return {
    region,
    bucket,
    accessKeyId,
    accessKeySecret,
    host: process.env.OSS_HOST || `${bucket}.oss-${region}.aliyuncs.com`,
  }
}

/**
 * 生成 OSS V1 签名所需的 Authorization 头。
 * 签名串：VERB\nContent-MD5\nContent-Type\nDate\nCanonicalizedResource
 * 文档：https://help.aliyun.com/zh/oss/developer-reference/include-signatures-in-the-authorization-header
 */
function authHeader(method, key, contentType, date) {
  const { bucket, accessKeyId, accessKeySecret } = getConfig()
  const canonicalizedResource = `/${bucket}/${key}`
  const stringToSign = [method, '', contentType || '', date, canonicalizedResource].join('\n')
  const signature = crypto
    .createHmac('sha1', accessKeySecret)
    .update(stringToSign, 'utf8')
    .digest('base64')
  return `OSS ${accessKeyId}:${signature}`
}

function gmtDate() {
  return new Date().toUTCString()
}

function objectUrl(key) {
  const { host } = getConfig()
  return `https://${host}/${key}`
}

/**
 * HEAD 对象：返回 true=已存在（200），false=不存在（404），其他状态码视为错误抛出。
 * HEAD 权限随 GetObject，签名时不带 Content-Type。
 */
export async function headObject(key) {
  const { host } = getConfig()
  const date = gmtDate()
  const res = await fetch(`https://${host}/${encodeURI(key).replace(/%2F/g, '/')}`, {
    method: 'HEAD',
    headers: {
      Date: date,
      Authorization: authHeader('HEAD', key, '', date),
    },
  })
  if (res.status === 200) return true
  if (res.status === 404) return false
  throw new Error(`OSS HEAD 异常：HTTP ${res.status}`)
}

/** PUT 上传对象（覆盖语义：同 key 重传幂等） */
export async function putObject(key, body, contentType) {
  const { host } = getConfig()
  const date = gmtDate()
  const res = await fetch(`https://${host}/${encodeURI(key).replace(/%2F/g, '/')}`, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(body.byteLength),
      Date: date,
      Authorization: authHeader('PUT', key, contentType, date),
    },
    body,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`OSS PUT 失败：HTTP ${res.status} ${text.slice(0, 300)}`)
  }
  return objectUrl(key)
}

/** Content-Type → 文件后缀（白名单映射，防伪造 URL 后缀） */
const EXT_BY_TYPE = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
  'image/avif': 'avif',
}

function extFromResponse(contentType, sourceUrl) {
  const ct = (contentType || '').split(';')[0].trim().toLowerCase()
  if (EXT_BY_TYPE[ct]) return EXT_BY_TYPE[ct]
  // Content-Type 缺失时仅作兜底：取 URL 路径后缀并限定为安全短字符
  try {
    const pathExt = new URL(sourceUrl).pathname.split('.').pop() || ''
    if (/^[a-z0-9]{1,5}$/i.test(pathExt)) return pathExt.toLowerCase()
  } catch { /* 非法 URL 交由上层拦截 */ }
  return 'img'
}

/** 判断 URL 是否已经是阿里云 OSS 地址（调用方据此跳过重复转存） */
export function isAliyunOssUrl(url) {
  try {
    const host = new URL(url).hostname
    return host === 'aliyuncs.com' || host.endsWith('.aliyuncs.com')
  } catch {
    return false
  }
}

/**
 * 外链图片 → OSS 备份（内容寻址去重）。
 * @param {string} sourceUrl 外链图片地址（http/https）
 * @returns {Promise<{url:string, key:string, sha256:string, size:number, contentType:string, cached:boolean}>}
 */
export async function backupImage(sourceUrl) {
  getConfig() // 提前校验环境变量，错误信息统一
  let u
  try {
    u = new URL(sourceUrl)
  } catch {
    throw new Error('图片地址不是合法 URL')
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new Error('仅支持 http/https 图片地址')
  }

  // 抓取源图：限制超时、跟随重定向（部分图床会 302 到实际 CDN 节点）
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  let res
  try {
    res = await fetch(sourceUrl, {
      method: 'GET',
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { Accept: 'image/*' },
    })
  } catch (e) {
    throw new Error(`抓取源图失败：${e?.name === 'AbortError' ? '超时' : (e?.message || '网络错误')}`)
  } finally {
    clearTimeout(timer)
  }
  if (!res.ok) throw new Error(`抓取源图失败：HTTP ${res.status}`)

  const contentType = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase()
  if (!contentType.startsWith('image/')) {
    throw new Error(`源地址不是图片（Content-Type: ${contentType || '未知'}）`)
  }

  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength === 0) throw new Error('源图为空（0 字节）')
  if (buf.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(`图片超过 10MB 上限（实际 ${(buf.byteLength / 1024 / 1024).toFixed(1)}MB）`)
  }

  const hash = crypto.createHash('sha256').update(buf).digest('hex')
  const ext = extFromResponse(contentType, sourceUrl)
  const key = `backup/${hash.slice(0, 2)}/${hash}.${ext}`

  // 内容去重：同哈希对象已存在则跳过上传，直接复用既有 OSS 地址
  const exists = await headObject(key)
  if (exists) {
    return { url: objectUrl(key), key, sha256: hash, size: buf.byteLength, contentType, cached: true }
  }
  await putObject(key, buf, contentType || 'application/octet-stream')
  return { url: objectUrl(key), key, sha256: hash, size: buf.byteLength, contentType, cached: false }
}
