// @ts-check
/**
 * 歌曲分享 · 平台链接解析函数（Netlify Function，单端点）
 *
 * POST /api/resolve-music  （netlify.toml redirect 到 /.netlify/functions/resolve-music）
 * body: { platform: string, urlOrEmbed: string }
 *   platform   平台 key（三家之一，前端下拉选择，不信前端自报的类型/ID）
 *   urlOrEmbed 分享链接
 *
 * 平台集合（2026-10 重构，详见方案文档）：
 *   - netease 网易云音乐：单曲 / 专辑。经非官方 Meting（@meting/core）走平台内部接口
 *     取元数据与曲目清单，播放直链由姊妹函数 music-stream 实时换取（不入数据库）；
 *   - youtube：单曲（视频）/ 专辑（播放列表，需投稿者声明是专辑，站长人工把关）；
 *   - soundcloud：单曲 / sets 专辑合辑（同上，声明 + 人工审核）。
 *
 * 重要风险说明（原「只访问官方端点」原则自本次起改变，知悉）：
 *   网易云链路使用非官方接口（含其 EAPI 加密的客户端模拟），平台随时可能改版导致失效，
 *   且未配置会员 cookie 时 VIP / 版权曲目拿不到直链——这类链接允许入库（元数据真实），
 *   但播放时 music-stream 会返回中文错误，由听众端提示换曲。
 *
 * 返回（全站统一 {code,data} 约定）：
 *   成功 { code: 0, data: {
 *            platform, media_type: 'song'|'album', platform_id, source_url,
 *            title, artist, cover_url, need_manual,
 *            tracks?: [{id,title,artist,duration,cover_url}],  // 专辑曲目快照
 *            playable?: boolean,    // netease 单曲实时探测是否可拿到直链
 *            album_hint?: string } }// youtube 列表 ID 前缀的人工审核提示
 *   失败 { code: 非 0, error: '中文原因' }
 *
 * 原则：
 *   1. 短链（163cn.tv / on.soundcloud.com）跟随 3xx 后在最终 URL 上复核；
 *   2. 只接受单曲 / 专辑（YouTube/SoundCloud 的合辑由投稿者声明、站长审核，不做技术硬拦）；
 *   3. 外呼 8s 超时（Meting 内部自带 20s/3 次重试的调用除外），输入限长，不携带任何用户凭据。
 */

import Meting from '@meting/core'
import { resolveNeteaseViaPublic } from './_lib/netease-public.mjs'

const FETCH_TIMEOUT_MS = 8000
const URL_MAX_LEN = 2048

/** 类浏览器 UA：部分官方接口对默认爬虫 UA 不友好（不影响数据公开性） */
const COMMON_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
  Accept: 'application/json, text/javascript, */*',
}

/** 可控超时 fetch（跟随 3xx 重定向，短链最终地址取 res.url） */
async function fetchTimeout(url, options = {}) {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, {
      redirect: 'follow',
      signal: ctrl.signal,
      headers: { ...COMMON_HEADERS, ...(options.headers || {}) },
    })
  } finally {
    clearTimeout(timer)
  }
}

/** JSON 外呼统一封装：非 2xx / 非法 JSON 抛错，错误信息走调用方翻译 */
async function fetchJson(url) {
  const res = await fetchTimeout(url)
  const text = await res.text()
  if (!res.ok) throw new Error(`上游 HTTP ${res.status}`)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error('上游返回非 JSON')
  }
}

/** 短链跟随后的最终 URL 字符串 */
async function finalUrl(url) {
  const res = await fetchTimeout(url, { method: 'GET' })
  return res.url || url
}

/** 把带 # 的 SPA 链接合并成可解析的 path 与 query（网易云链接形如 /#/song?id=123） */
function parseSpaUrl(raw) {
  let u
  try {
    u = new URL(raw)
  } catch {
    return null
  }
  // hash 形如 #/song?id=1 或 #/album/?id=2
  const hash = u.hash || ''
  const hashPath = hash.replace(/^#/, '')
  const combined = hash ? hashPath : u.pathname + u.search
  const [pathPart = '', queryPart = ''] = combined.split('?')
  return {
    host: u.hostname.toLowerCase(),
    path: pathPart.replace(/\/+$/, ''),
    query: new URLSearchParams(queryPart || (hash ? '' : u.search.slice(1))),
    origin: `${u.protocol}//${u.host}`,
  }
}

/** 协议升级：Meting 返回的封面/直链有部分是 http，页面 https 下会被混合内容拦截 */
function toHttps(url) {
  return typeof url === 'string' ? url.replace(/^http:\/\//i, 'https://') : url
}

/** 网易云封面补默认尺寸参数（picUrl 可能不带 param） */
function neteaseCover(url) {
  if (!url) return null
  const u = toHttps(url)
  return u.includes('?param=') ? u : `${u}?param=500y500`
}

// ============================================================
// 各平台解析器：输入原始字符串，输出统一 data 或抛 Error（消息为中文可直接展示）
// ============================================================

const parsers = {
  // ---------- 网易云音乐（Meting 非官方接口：单曲详情 / 专辑曲目 / 可播探测） ----------
  async netease(raw) {
    let work = raw.trim()
    // 短链 163cn.tv 跟随
    if (/^https?:\/\/163cn\.tv\//i.test(work)) work = await finalUrl(work)
    const p = parseSpaUrl(work)
    if (!p || !/(^|\.)music\.163\.com$/.test(p.host)) throw new Error('不是网易云音乐链接')
    // 只接受单曲 / 专辑；歌手页、歌单、电台、用户主页等一律拒绝
    const m = p.path.match(/^\/?(?:m\/)?(song|album)\/?$/i)
    if (!m) {
      if (/playlist|discover|radio|artist|user|dj/i.test(p.path)) {
        throw new Error('歌单 / 歌手页 / 电台不能投稿，只接受单曲（song?id=）或专辑（album?id=）链接')
      }
      throw new Error('请粘贴网易云单曲或专辑链接（song?id= / album?id=）')
    }
    const mediaType = m[1].toLowerCase() === 'album' ? 'album' : 'song'
    const id = p.query.get('id')
    if (!/^\d{4,}$/.test(id || '')) throw new Error('链接中缺少有效的歌曲 / 专辑 ID')

    const meting = new Meting('netease')
    if (mediaType === 'song') {
      // 未格式化详情：songs[0] 内含 al.picUrl / ar 歌手 / dt 时长，比 format() 信息更全
      const detail = JSON.parse(await meting.format(false).song(id))
      const s = detail?.songs?.[0]
      if (!s || !s.id) throw new Error('网易云官方接口查不到该曲目，可能已下架或为付费专辑曲目')
      const artistName = Array.isArray(s.ar) ? s.ar.map(a => a.name).filter(Boolean).join(' / ') : ''
      // 实时探测可播性，区分三态：
      //   full    —— 完整曲；
      //   trial   —— 会员曲但下发免费试听片段（30~45 秒），允许投稿；
      //   blocked —— 完全锁死（杰威尔等版权方 / 本节点地区无权益）。
      // 探测顺序（2026-10 起）：
      //   ① 公益 Meting 实例（中国大陆出口 IP，境外节点也能判出 trial/片段秒数，
      //      详见 _lib/netease-public.mjs 的域名白名单等安全闸门）；
      //   ② 公益不可用时回退本机 @meting/core 的 EAPI 探测（原逻辑完整保留）。
      // 探测失败不致命（接口偶发抖动），按完整曲放行，交给播放时 music-stream 再判。
      let playMode = 'full'
      let trialSeconds = 0
      try {
        const pub = await resolveNeteaseViaPublic(id)
        if (pub.ok) {
          // 公益链路：302 路径含片段转码标识 musicrep 即 trial，秒数按字节估算
          playMode = pub.trial ? 'trial' : 'full'
          trialSeconds = pub.trial ? pub.trialSeconds : 0
        } else {
          console.log('[resolve-music] 公益探测不可用，回退本地 EAPI：', pub.reason)
          // EAPI 原始结构 {"data":[...]}，两种形态兼容，避免取错层级
          const parsed = JSON.parse(await meting.url(id))
          const item = Array.isArray(parsed) ? parsed[0] : parsed?.data?.[0]
          if (!item || !item.url) {
            playMode = 'blocked'
          } else {
            const ft = item.freeTrialInfo
            const end = ft && Number.isFinite(ft.end) ? Math.floor(ft.end) : 0
            if (ft && end > 0) {
              playMode = 'trial'
              trialSeconds = end
            }
          }
        }
      } catch {
        /* 探测失败不影响识别，交给播放时 music-stream 再判 */
      }
      const playNote =
        playMode === 'blocked'
          ? '该曲目为会员 / 版权受限内容，站内完全无法播放，建议更换链接投稿'
          : playMode === 'trial'
            ? `该曲目为会员曲目，站内仅可播放约 ${trialSeconds} 秒试听片段（听众端同样只能听到片段）`
            : ''
      return {
        platform: 'netease',
        media_type: 'song',
        platform_id: String(s.id),
        source_url: `https://music.163.com/#/song?id=${s.id}`,
        title: s.name || '',
        artist: artistName,
        cover_url: neteaseCover(s.al?.picUrl),
        need_manual: !s.name,
        // trial（有片段）视为可播放，只有 blocked 才打无法播放标记
        playable: playMode !== 'blocked',
        play_mode: playMode,
        ...(trialSeconds ? { trial_seconds: trialSeconds } : {}),
        ...(playNote ? { play_note: playNote } : {}),
      }
    }

    // 专辑：未格式化响应的 album 节点带标题/封面/歌手，songs 节点为全量曲目
    const albumDetail = JSON.parse(await meting.format(false).album(id))
    const meta = albumDetail?.album
    const songs = Array.isArray(albumDetail?.songs) ? albumDetail.songs : []
    if (!meta || !songs.length) throw new Error('网易云官方接口查不到该专辑，可能已下架或链接错误')
    const tracks = songs.map(s => ({
      id: String(s.id),
      title: s.name || '',
      artist: Array.isArray(s.ar) ? s.ar.map(a => a.name).filter(Boolean).join(' / ') : '',
      duration: s.dt ? Math.round(s.dt / 1000) : 0,
      cover_url: neteaseCover(s.al?.picUrl || meta.picUrl),
    }))
    return {
      platform: 'netease',
      media_type: 'album',
      platform_id: String(meta.id || id),
      source_url: `https://music.163.com/#/album?id=${meta.id || id}`,
      title: meta.name || '',
      artist: meta.artist?.name || '',
      cover_url: neteaseCover(meta.picUrl),
      need_manual: !meta.name,
      tracks,
    }
  },

  // ---------- YouTube / YouTube Music（单曲走官方 oEmbed；合辑=播放列表，声明制） ----------
  async youtube(raw) {
    let work = raw.trim()
    let u
    try {
      u = new URL(work)
    } catch {
      throw new Error('链接格式不正确')
    }
    // 营销跳转链 attribution_link?u=
    if (/^https?:\/\/(?:www\.)?youtube\.com\/attribution_link\b/i.test(work)) {
      const u2 = u.searchParams.get('u')
      if (u2) u = new URL(u2.startsWith('http') ? u2 : `https://www.youtube.com${u2}`)
    }
    const host = u.hostname.toLowerCase()
    const onYtDomain =
      host === 'youtu.be' ||
      /(^|\.)youtube\.com$/.test(host) ||
      /(^|\.)youtube-nocookie\.com$/.test(host)
    if (!onYtDomain) throw new Error('不是 YouTube 链接')

    // 1) 合辑（播放列表）：playlist 页、watch 链接带 list=、embed 带 list=
    //    只接受「专辑」声明，人工审核把关；RD 开头为系统自动歌单，直接拒绝
    const listId = u.searchParams.get('list') || ''
    if (/^RD/i.test(listId)) {
      throw new Error('这是 YouTube 自动生成的混音 / 电台歌单，不能投稿；请粘贴专辑播放列表或单曲链接')
    }
    if (listId && /^[A-Za-z0-9_-]{12,}$/.test(listId) && (u.pathname.startsWith('/playlist') || u.searchParams.has('v') || u.pathname.startsWith('/embed'))) {
      // 列表 ID 前缀提示（不硬拦）：OLAK5uy=YouTube Music 官方专辑；PL/UU/FL/LL 多为自建歌单
      let albumHint = '请确认该播放列表确实是一张专辑；普通自建歌单审核会被拒绝'
      if (/^OLAK5uy/i.test(listId)) albumHint = '该列表看起来是 YouTube Music 官方专辑'
      return {
        platform: 'youtube',
        media_type: 'album',
        platform_id: listId,
        source_url: `https://www.youtube.com/playlist?list=${listId}`,
        // oEmbed 不支持播放列表：标题需手填，曲目/封面由前端经 IFrame API 补全
        title: '',
        artist: '',
        cover_url: null,
        need_manual: true,
        album_hint: albumHint,
      }
    }

    // 2) 单曲
    let videoId = ''
    if (host === 'youtu.be') {
      videoId = u.pathname.split('/').filter(Boolean)[0] || ''
    } else if (u.pathname.startsWith('/watch')) {
      videoId = u.searchParams.get('v') || ''
    } else {
      const mm = u.pathname.match(/^\/(?:shorts|embed|v)\/([\w-]{6,})/)
      if (mm) videoId = mm[1]
    }
    if (!/^[\w-]{11}$/.test(videoId)) {
      throw new Error('无法从链接中识别 YouTube 视频 ID（应为 11 位字符）或专辑播放列表 ID')
    }
    // 官方 oEmbed 取标题 / 频道 / 封面；失败不致命，降级手填
    let title = ''
    let artist = ''
    let cover = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`
    try {
      const oe = await fetchJson(
        `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`,
      )
      title = oe.title || ''
      artist = oe.author_name || ''
      cover = oe.thumbnail_url || cover
    } catch {
      /* oEmbed 不通时保留手填流程 */
    }
    return {
      platform: 'youtube',
      media_type: 'song',
      platform_id: videoId,
      source_url: `https://www.youtube.com/watch?v=${videoId}`,
      title,
      artist, // 注意：这是频道名，未必是真实歌手，前端允许修改
      cover_url: cover,
      need_manual: !title,
    }
  },

  // ---------- SoundCloud（官方 oEmbed；单曲 + /sets/ 专辑合辑，声明制） ----------
  async soundcloud(raw) {
    let work = raw.trim()
    if (/^https?:\/\/on\.soundcloud\.com\//i.test(work)) work = await finalUrl(work)
    let u
    try {
      u = new URL(work)
    } catch {
      throw new Error('链接格式不正确')
    }
    const host = u.hostname.toLowerCase()
    if (!/(^|\.)soundcloud\.com$/.test(host) && host !== 'w.soundcloud.com') {
      throw new Error('不是 SoundCloud 链接')
    }
    // 规范成去查询参数的 URL；discover/station/用户主页拒绝
    const isSets = /\/sets\//.test(u.pathname)
    const segs = u.pathname.split('/').filter(Boolean)
    let canonical = work
    if (host !== 'w.soundcloud.com') {
      if (segs.length < 2) throw new Error('请粘贴具体的单曲或专辑（/sets/）链接，而不是用户主页')
      canonical = `https://soundcloud.com${u.pathname.replace(/\/+$/, '')}`
    } else {
      const inner = u.searchParams.get('url')
      if (inner) canonical = inner
    }
    const oe = await fetchJson(
      `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(canonical)}`,
    )
    if (!oe || typeof oe.title !== 'string') throw new Error('SoundCloud 官方接口无法识别该内容')
    // oEmbed 的 html 中区分 track / playlists（防止短链跳转型别被篡改）
    const htmlIsSets = /\/playlists\//.test(String(oe.html || ''))
    const mediaType = isSets || htmlIsSets ? 'album' : 'song'
    if (mediaType === 'album') {
      canonical = String(oe.html || '').match(/url=([^"&]+)/)?.[1]
        ? decodeURIComponent(String(oe.html).match(/url=([^"&]+)/)[1])
        : canonical
      // 上一步取到的是 api.soundcloud.com/playlists/.. 嵌入 URL，稳定标识仍用用户态 sets 永久链接
      if (!/\/sets\//.test(canonical)) canonical = `https://soundcloud.com${u.pathname.replace(/\/+$/, '')}`
      return {
        platform: 'soundcloud',
        media_type: 'album',
        platform_id: canonical,
        source_url: canonical,
        title: oe.title,
        artist: oe.author_name || segs[0] || '',
        cover_url: oe.thumbnail_url || null,
        need_manual: false,
        album_hint: '请确认该合辑确实是一张专辑；普通自建歌单审核会被拒绝',
        // 曲目清单（含单曲永久链接）由前端经 Widget API getSounds() 补全后入库
      }
    }
    return {
      platform: 'soundcloud',
      media_type: 'song',
      platform_id: canonical,
      source_url: canonical,
      title: oe.title,
      artist: oe.author_name || segs[0] || '',
      cover_url: oe.thumbnail_url || null,
      need_manual: false,
    }
  },
}

// ============================================================
// CORS 与入口
// ============================================================

// 正式环境仅放行 lrcshare.com 及其子域；另放行本机开发域（本函数只取公开元数据、无凭据，风险可控）
const ALLOWED_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*lrcshare\.com$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

function corsHeaders(origin) {
  const h = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  }
  if (ALLOWED_ORIGIN.test(origin || '')) h['Access-Control-Allow-Origin'] = origin
  return h
}

const json = (status, body, origin) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) })

export default async (req) => {
  const origin = req.headers.get('Origin') || ''
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })
  if (req.method !== 'POST') return json(405, { code: 40500, error: 'Method not allowed' }, origin)

  let body
  try {
    body = await req.json()
  } catch {
    return json(400, { code: 40000, error: '请求体不是合法 JSON' }, origin)
  }
  const platform = String(body?.platform || '').trim()
  const urlOrEmbed = String(body?.urlOrEmbed || '').trim()

  if (!platform || !urlOrEmbed) {
    return json(400, { code: 40001, error: '缺少平台或链接参数' }, origin)
  }
  if (!Object.prototype.hasOwnProperty.call(parsers, platform)) {
    return json(400, { code: 40002, error: '不支持的平台' }, origin)
  }
  if (urlOrEmbed.length > URL_MAX_LEN) {
    return json(400, { code: 40003, error: `输入超过长度上限（${URL_MAX_LEN} 字符）` }, origin)
  }

  try {
    const data = await parsers[platform](urlOrEmbed)
    return json(200, { code: 0, data }, origin)
  } catch (err) {
    const msg = err?.name === 'AbortError'
      ? '平台接口响应超时，请稍后重试'
      : (err?.message || '解析失败，请检查链接后重试')
    return json(200, { code: 42201, error: msg }, origin)
  }
}
