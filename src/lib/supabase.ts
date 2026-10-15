import { createClient } from '@supabase/supabase-js'
import { getImageSource } from './imageSource'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('缺少 Supabase 环境变量，请检查 .env 文件（参考 .env.example）')
}

/**
 * 灾备图片列映射：主列 → OSS 备份列（与 sql/19 一致）。
 * 仅当响应对象中备份列有非空值时才替换主列，备份缺失自动回退原外链。
 */
const IMAGE_FIELD_MAP: Record<string, string> = {
  cover: 'cover_backup',
  avatar: 'avatar_backup',
  bg_image: 'bg_image_backup',
  cover_url: 'cover_url_backup',
}

function swapImageFields(node: unknown): void {
  if (Array.isArray(node)) {
    for (const item of node) swapImageFields(item)
    return
  }
  if (!node || typeof node !== 'object') return
  const obj = node as Record<string, unknown>
  for (const [srcCol, backupCol] of Object.entries(IMAGE_FIELD_MAP)) {
    const backup = obj[backupCol]
    if (typeof backup === 'string' && backup.trim()) obj[srcCol] = backup
  }
  // 递归处理嵌套对象（如 songs 内嵌 albums、RPC 返回结构等）
  for (const key of Object.keys(obj)) swapImageFields(obj[key])
}

/**
 * 前台响应转换 fetch：aliyun 模式下把 JSON 响应中的图片主列就地替换为 OSS 备份地址。
 * 只动响应、不动请求；非 JSON（Auth 等）与 origin 模式原样透传。
 */
const rawFetch = globalThis.fetch.bind(globalThis)
async function imageAwareFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await rawFetch(input as any, init)
  if (getImageSource() !== 'aliyun') return res
  const contentType = res.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) return res
  try {
    const json = JSON.parse(await res.clone().text())
    swapImageFields(json)
    // 用转换后的 JSON 重建响应；丢弃可能失真的长度/编码头，避免消费端误读
    const headers = new Headers(res.headers)
    headers.delete('content-length')
    headers.delete('content-encoding')
    return new Response(JSON.stringify(json), {
      status: res.status,
      statusText: res.statusText,
      headers,
    })
  } catch {
    return res
  }
}

/**
 * 前台共享 Supabase 客户端（anon key，公开只读+投稿权限，RLS 保护）。
 * 挂在响应链路上的 imageAwareFetch 负责灾备开关的图片地址切换，业务层无感知。
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  global: { fetch: imageAwareFetch },
})

/**
 * 管理后台专用客户端：不经过图片源灾备切换的响应转换，后台始终看到/编辑原始外链地址。
 * 与 supabase 共享同一项目凭据与浏览器本地会话存储（supabase-js 按项目 ref 存 session）。
 */
export const supabaseAdmin = createClient(supabaseUrl, supabaseAnonKey, {
  auth: { persistSession: true },
})
