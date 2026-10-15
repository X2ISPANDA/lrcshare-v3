/**
 * 全局图片源灾备开关（settings.image_source）
 *
 *   origin（默认）：前台所有图片走原始外链（B站图床等），OSS 零请求零流量费用；
 *   aliyun：站长在后台一键切换，前台图片统一走 OSS 备份（缺备份的行自动回退原外链）。
 *
 * 生效链路（实时生效，无需重新部署）：
 *   - SSG 构建：main.ts 引导时直读数据库 settings 行，预渲染 HTML 即按当时模式生成；
 *   - 浏览器：水合先套用构建时模式，随后异步拉库内最新值并直接更新运行模式；
 *     若两者不一致（站长切换过开关），标记 stale，useSSGData 丢弃 HTML 内嵌的
 *     旧源数据并在 onMounted 强制重拉，经 fetch 拦截器按新模式替换图链；
 *   - 运行期：supabase 客户端的自定义 fetch 在 aliyun 模式下递归把
 *     响应里的图片主列替换为对应 *_backup 值（备份为空保留原值）。
 *
 * 后台（adminApi/supabaseAdmin）不经过此开关，管理员始终看到、编辑原始外链。
 */

export type ImageSource = 'origin' | 'aliyun'

let mode: ImageSource = 'origin'

/**
 * 构建时预渲染的图片源与库内当前值不一致（仅客户端引导时可能置 true）。
 * true 时 useSSGData 必须丢弃 HTML 内嵌数据强制重拉，否则页面会一直用旧源图链。
 * 下次按新模式重新部署后，构建值与库值一致，自动恢复 false（零额外请求）。
 */
let staleBuild = false

export function getImageSource(): ImageSource {
  return mode
}

export function isImageSourceStale(): boolean {
  return staleBuild
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
 * 客户端水合时校对库内最新值，模式被站长切过则置 stale（不重载页面），
 * 由 useSSGData 丢弃内嵌旧数据强制重拉，拦截器按新模式换链。
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
    // 直接把运行模式更新为库内最新值：此后本页所有数据请求（含强制重拉与站内导航）都按新源替换
    setImageSource(live)
    staleBuild = live !== buildMode
  } catch {
    // 拉取失败时沿用构建时模式，不标记 stale：继续使用 HTML 内嵌数据，不增加请求、不影响浏览
  }
}
