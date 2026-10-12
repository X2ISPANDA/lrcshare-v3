// @ts-check
/**
 * 网易云播放直链 · 公益 Meting 实例取链（共享模块，非 Netlify 函数端点）
 *
 * 放在 netlify/functions/_lib/ 下：下划线开头的目录不会被 Netlify 当作函数部署，
 * 仅被 music-stream.mjs / resolve-music.mjs 以 ESM import 复用。
 *
 * 背景：
 *   网易云对会员曲目下发的「30~45 秒免费试听片段」权益按请求来源 IP 的地区判定。
 *   Netlify 函数机房在境外（美国），用自带 @meting/core 直接请求网易 EAPI 时，
 *   会员曲一律 url=null（code=404），拿不到试听片段；中国大陆出口 IP 则可正常拿到。
 *
 * 公益实例（默认 https://api.injahow.cn/meting/，Meting 生态老牌公共服务，
 * 部署在腾讯云上海）做的事情和我们函数里的 @meting/core 完全一样——只向网易取一次
 * 直链并以 HTTP 302 跳到网易官方 CDN（m*.music.126.net），【音频流不经过公益服务器】，
 * 听众最终仍直连网易 CDN，公益方只承担一次轻量取链请求，这是它可长期白嫖的关键。
 *
 * 安全闸门（防公益实例被攻陷 / 主动投毒）：
 *   1. redirect:'manual' 只取 302 的 Location，绝不跟随、绝不透传第三方内容；
 *   2. Location 必须是 https 且主机名严格匹配 *.music.126.net（网易官方音频域），
 *      否则视为不可信结果，调用方一律回退本地 @meting/core 逻辑；
 *   3. 模块本身永不抛错（任何异常都包装成 ok:false），保证回退链路永远可达。
 *
 * 试听片段判定：
 *   片段直链路径形如 /jd-musicrep-ts/...（网易「音乐试听」片段转码产物），
 *   完整曲路径形如 /jdymusic/obj/...；以路径是否含 musicrep 作为 trial 判据。
 *   片段秒数公益接口不直接给，用 Range 读 1 字节拿到的 Content-Range 总大小估算：
 *   片段统一 128kbps 转码，seconds = round(bytes*8/128000)
 *   （实测 347230《晴天》721023 字节 → 45 秒，与 EAPI freeTrialInfo.end 完全一致）。
 *
 * 可配置：
 *   环境变量 NETEASE_PUBLIC_METING_API 可换成其他兼容 Meting-API 的实例
 *   （如 https://api.i-meto.com/meting/api，注意后者为 query 形态，默认实例关停时
 *   需配套调整本模块拼参方式——默认实例 URL 形态为 <base>/?server=netease&type=url&id=），
 *   不用改业务代码即可整体切换 / 关闭（置空字符串则跳过公益链路）。
 */

/**
 * 公益实例根地址。默认 injahow（腾讯云上海）；可用环境变量整体切换实例。
 * 显式置空字符串（NETEASE_PUBLIC_METING_API=）= 运维侧一键关闭公益链路。
 * 注意用 ?? 而非 ||：空字符串必须能表达「禁用」，不能落回默认值。
 */
export const PUBLIC_METING_BASE = (
  process.env.NETEASE_PUBLIC_METING_API ?? 'https://api.injahow.cn/meting/'
).trim().replace(/\/?$/, '/')

/** 取链请求超时：公益在国内、Netlify 在美国，跨海一跳给 8s */
const REQUEST_TIMEOUT_MS = 8000
/** 向网易 CDN 探测片段总大小的超时 */
const RANGE_TIMEOUT_MS = 6000
/** 片段统一转码码率（bps），用于由字节数估算秒数 */
const TRIAL_BITRATE_BPS = 128_000

const COMMON_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/**
 * 通过公益 Meting（中国大陆出口）换取网易云曲目直链
 * @param {string} id 网易云曲目 ID（调用方已做 ^\d{4,}$ 校验）
 * @returns {Promise<
 *   | { ok: true; url: string; trial: boolean; trialSeconds: number; bytes: number }
 *   | { ok: false; reason: string }
 * >}
 *   ok:true  —— url 为已校验的网易官方 https 直链；trial/trialSeconds 描述片段形态
 *   ok:false —— reason 仅供日志排查（timeout|upstream_error|empty|bad_location|
 *               untrusted_location|probe_only 等），调用方应静默回退本地 Meting
 */
export async function resolveNeteaseViaPublic(id) {
  // 显式置空 = 运维侧一键关闭公益链路
  if (!PUBLIC_METING_BASE) {
    return { ok: false, reason: 'disabled' }
  }
  const endpoint = `${PUBLIC_METING_BASE}?server=netease&type=url&id=${encodeURIComponent(id)}`

  // 第一步：向公益实例取 302（manual = 不跟随，音频字节一个都不经手）
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS)
  /** @type {Response} */
  let res
  try {
    res = await fetch(endpoint, {
      method: 'GET',
      redirect: 'manual',
      signal: ctrl.signal,
      headers: { 'User-Agent': COMMON_UA, Accept: '*/*' },
    })
  } catch (err) {
    return {
      ok: false,
      reason: err?.name === 'AbortError' ? 'timeout' : 'request_failed',
    }
  } finally {
    clearTimeout(timer)
  }

  // 实测：锁死曲公益实例返回 200 + 空 body；正常曲返回 302 + Location。
  // opaqueredirect（status=0）理论上取不到 Location，同样按失败回退处理。
  const location = res.headers.get('location') || ''
  if (!location) {
    return { ok: false, reason: res.status >= 500 ? `upstream_${res.status}` : 'empty' }
  }

  // 第二步：安全闸门——只放行网易官方音频 CDN 域名
  let u
  try {
    u = new URL(location)
  } catch {
    return { ok: false, reason: 'bad_location' }
  }
  if (u.protocol !== 'https:' || !/(^|\.)music\.126\.net$/.test(u.hostname)) {
    return { ok: false, reason: 'untrusted_location' }
  }

  // 第三步：片段形态判定 + 时长估算（估算失败不影响播放，仅标签秒数回退为 0）
  const isTrial = /musicrep/i.test(u.pathname)
  let bytes = 0
  if (isTrial) bytes = await probeContentLength(u.toString())
  const trialSeconds = isTrial && bytes > 0
    ? Math.max(1, Math.round((bytes * 8) / TRIAL_BITRATE_BPS))
    : 0

  return { ok: true, url: u.toString(), trial: isTrial, trialSeconds, bytes }
}

/**
 * Range 读 1 字节，从 Content-Range（bytes 0-0/<total>）取片段总字节数；
 * 任一步失败都安静返回 0，不拖垮主链路。
 * @param {string} url 已通过域名校验的网易官方 https 直链
 * @returns {Promise<number>}
 */
async function probeContentLength(url) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), RANGE_TIMEOUT_MS)
  try {
    const r = await fetch(url, {
      method: 'GET',
      signal: ctrl.signal,
      headers: { Range: 'bytes=0-0', 'User-Agent': COMMON_UA },
    })
    const cr = r.headers.get('content-range') || ''
    const m = cr.match(/\/(\d+)\s*$/)
    if (m) return Number(m[1]) || 0
    // 个别缓存节点不支持 Range 时退回 Content-Length（200 全量响应才有意义，忽略之以防误读）
    return 0
  } catch {
    return 0
  } finally {
    clearTimeout(timer)
  }
}
