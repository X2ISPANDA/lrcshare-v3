/**
 * 全局图片源灾备开关（settings.image_source）
 *
 *   origin（默认）：前台所有图片走原始外链（B站图床等），OSS 零请求零流量费用；
 *   aliyun：站长在后台一键切换，前台图片统一走 OSS 备份（缺备份的行自动回退原外链）。
 *
 * 生效链路：
 *   - SSG 构建：main.ts 引导时直读数据库 settings 行，预渲染 HTML 即按当时模式生成；
 *   - 浏览器：水合先用构建时模式（零闪烁），随后异步拉最新值；
 *     若站长已切换，页面自动重载一次拿新模式数据（sessionStorage 防循环）；
 *   - 运行期：supabase 客户端的自定义 fetch 在 aliyun 模式下递归把
 *     响应里的图片主列替换为对应 *_backup 值（备份为空保留原值）。
 *
 * 后台（adminApi/supabaseAdmin）不经过此开关，管理员始终看到、编辑原始外链。
 */

export type ImageSource = 'origin' | 'aliyun'

const STORAGE_RELOAD_FLAG = 'lrcshare_image_source_reloaded'

let mode: ImageSource = 'origin'

export function getImageSource(): ImageSource {
  return mode
}

export function setImageSource(v: unknown): ImageSource {
  mode = v === 'aliyun' ? 'aliyun' : 'origin'
  return mode
}

/** 从 settings 表读开关（anon REST；RLS 仅放行 image_source 这一行），失败默认 origin */
export async function fetchImageSource(): Promise<ImageSource> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined
  if (!url || !key) return 'origin'
  try {
    const res = await fetch(
      `${url}/rest/v1/settings?key=eq.image_source&select=value`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } },
    )
    if (!res.ok) return 'origin'
    const rows = await res.json()
    return Array.isArray(rows) && rows[0]?.value === 'aliyun' ? 'aliyun' : 'origin'
  } catch {
    return 'origin'
  }
}

/**
 * 应用引导：SSG 构建时读库并写入 initialState（随预渲染 HTML 下发）；
 * 客户端水合后校对最新值，模式变化时自动重载一次。
 */
export async function bootstrapImageSource(initialState: Record<string, unknown> | undefined): Promise<void> {
  if (import.meta.env.SSR) {
    const live = await fetchImageSource()
    if (initialState) initialState.__image_source = live
    setImageSource(live)
    return
  }

  const buildMode = setImageSource(initialState?.__image_source)
  try {
    const live = await fetchImageSource()
    if (live === buildMode) {
      // 模式一致：清掉历史防循环标记，保证站长下次切换时还能触发一次重载
      sessionStorage.removeItem(STORAGE_RELOAD_FLAG)
      return
    }
    // 构建时模式与库内最新模式不一致（站长刚切换）：重载一次，让页面数据按新模式渲染。
    // 以"目标模式"作为标记：若重载后仍是旧值（极端下发缓存场景），同值标记已存在，不再重复重载。
    if (sessionStorage.getItem(STORAGE_RELOAD_FLAG) === live) return
    sessionStorage.setItem(STORAGE_RELOAD_FLAG, live)
    window.location.reload()
  } catch {
    // 拉取失败时沿用构建时模式，不影响浏览
  }
}
