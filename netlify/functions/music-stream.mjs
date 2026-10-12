// @ts-check
/**
 * 歌曲分享 · 播放直链实时换取函数（Netlify Function）
 *
 * GET /api/music-stream?platform=netease&id=<平台曲目 ID>
 *   （netlify.toml redirect 到 /.netlify/functions/music-stream）
 *
 * 为什么需要它：
 *   网易云等平台的音频直链带时效签名（几分钟到数小时失效），不能入库；
 *   且直链解析依赖 @meting/core 对平台非官方内部接口的调用（含加密参数），
 *   不能暴露在前端。统一由本函数在「点播放」时实时换取，前端 <audio> 拿到后直接播放。
 *
 * 返回：
 *   成功（完整） { code: 0, data: { url: 'https://...mp3', br: 320, trial: false } }
 *   成功（试听片段）{ code: 0, data: { url, br, trial: true, trial_start: 0, trial_end: 45 } }
 *     —— 网易云对部分会员曲目下发免费试听片段（freeTrialInfo，通常 30~45 秒）；
 *        产品决策：听众端不出现「试听」字样，片段播完由 <audio> ended 自然联播下一首。
 *   失败 { code: 非 0, error: '中文原因' }
 *     - 会员 / 版权曲目完全无直链（含海外节点拿不到试听权益）：code=42202，提示换曲；
 *     - 上游超时：code=50401。
 *
 * 取链链路（2026-10 起，netease）：
 *   ① 优先走公益 Meting 实例（中国大陆出口 IP，见 _lib/netease-public.mjs）：
 *      境外节点也能替会员曲拿到 30~45 秒试听片段；公益只 302 跳转、音频不经它的服务器。
 *   ② 公益不可用 / 超时 / 返回不可信时，自动回退本机 @meting/core 直连网易 EAPI
 *      （即 2026-10 之前的原链路，防护与三态判定一行不删），会员曲回退为 42202。
 *
 * 安全：仅允许白名单平台与严格 ID 形态（网易云为纯数字）；不带任何用户 cookie。
 */

import Meting from '@meting/core'
import { resolveNeteaseViaPublic } from './_lib/netease-public.mjs'

const ALLOWED_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*lrcshare\.com$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

function corsHeaders(origin) {
  const h = {
    'Content-Type': 'application/json',
    // <audio> 为简单 GET 请求，只需 Origin 放行；方法声明 GET/OPTIONS/HEAD
    'Access-Control-Allow-Methods': 'GET, OPTIONS, HEAD',
    'Vary': 'Origin',
    // 直链本身不缓存于 CDN（时效地址），浏览器短时缓存即可
    'Cache-Control': 'no-store',
  }
  if (ALLOWED_ORIGIN.test(origin || '')) h['Access-Control-Allow-Origin'] = origin
  return h
}

const json = (status, body, origin) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) })

/** 各平台 ID 白名单正则（新增平台时在此登记，杜绝任意外呼参数） */
const ID_PATTERNS = {
  netease: /^\d{4,}$/,
}

export default async (req) => {
  const origin = req.headers.get('Origin') || ''
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(405, { code: 40500, error: 'Method not allowed' }, origin)
  }

  let platform = ''
  let id = ''
  try {
    const u = new URL(req.url)
    platform = (u.searchParams.get('platform') || '').trim()
    id = (u.searchParams.get('id') || '').trim()
  } catch {
    return json(400, { code: 40000, error: '请求地址不正确' }, origin)
  }

  if (!Object.prototype.hasOwnProperty.call(ID_PATTERNS, platform)) {
    return json(400, { code: 40002, error: '不支持的播放平台' }, origin)
  }
  if (!ID_PATTERNS[platform].test(id)) {
    return json(400, { code: 40003, error: '曲目 ID 不合法' }, origin)
  }

  try {
    // ============ 链路①：公益 Meting（中国大陆出口 IP）============
    // 境外节点经它也能拿到会员曲试听片段；它只回 302 直跳网易官方 CDN，音频不经它。
    // 任何失败（超时 / 空响应 / 域名校验不过）都静默走链路②，听众侧无感。
    const pub = await resolveNeteaseViaPublic(id)
    if (pub.ok) {
      return json(
        200,
        {
          code: 0,
          data: {
            url: pub.url,
            // 公益 302 不携带码率字段，给 0（前端仅透传、不参与播放判定）
            br: 0,
            trial: pub.trial,
            // 片段起点恒为 0；秒数由片段字节数按 128kbps 估算（实测与 EAPI 一致）
            trial_start: 0,
            trial_end: pub.trial ? pub.trialSeconds : 0,
          },
        },
        origin,
      )
    }
    console.log('[music-stream] 公益取链不可用，回退本地 EAPI：', pub.reason)

    // ============ 链路②：本机 @meting/core 直连网易 EAPI（原逻辑完整保留）============
    // Meting 内部已含 20s 超时 + 3 次重试
    const meting = new Meting(platform)
    // 实测 @meting/core 的 url() 返回网易云 EAPI 原始结构 {"data":[{url,br,code,...}]}
    // （不是格式化后的 [{...}]），这里两种形态兼容，避免取错层级
    const parsed = JSON.parse(await meting.url(id))
    const item = Array.isArray(parsed) ? parsed[0] : parsed?.data?.[0]
    if (!item || !item.url) {
      // url 为 null（code=404）即完全无法播放（杰威尔等版权方锁死，或本节点地区无试听权益）
      return json(
        200,
        { code: 42202, error: '该曲目为会员 / 版权受限内容，站内暂时无法播放，换一首试试吧' },
        origin,
      )
    }
    // 会员曲目试听片段：EAPI 在 url 之外另带 freeTrialInfo { start, end }（秒）
    // 有 url + 有效 end 即片段；没有该字段（或 end<=0）即完整曲
    const ft = item.freeTrialInfo
    const trialEnd = ft && Number.isFinite(ft.end) ? Math.floor(ft.end) : 0
    const isTrial = !!(ft && trialEnd > 0)
    // 直链协议升级，避免 https 页面下的混合内容拦截
    const url = String(item.url).replace(/^http:\/\//i, 'https://')
    return json(
      200,
      {
        code: 0,
        data: {
          url,
          br: typeof item.br === 'number' ? item.br : 0,
          trial: isTrial,
          trial_start: isTrial ? (Number.isFinite(ft.start) ? Math.floor(ft.start) : 0) : 0,
          trial_end: isTrial ? trialEnd : 0,
        },
      },
      origin,
    )
  } catch (err) {
    const msg = err?.name === 'AbortError' || /timeout/i.test(String(err?.message || ''))
      ? '平台取链超时，请稍后重试'
      : '播放地址获取失败，请稍后重试'
    return json(200, { code: 50401, error: msg }, origin)
  }
}
