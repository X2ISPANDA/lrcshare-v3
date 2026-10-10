// @ts-check
/**
 * 歌曲分享 · 平台链接解析函数（Netlify Function，单端点）
 *
 * POST /api/resolve-music  （netlify.toml redirect 到 /.netlify/functions/resolve-music）
 * body: { platform: string, urlOrEmbed: string }
 *   platform   平台 key（9 家之一，前端下拉选择，不信前端自报的类型/ID）
 *   urlOrEmbed 分享链接；Bandcamp 为官方「Share/Embed」弹窗复制出的嵌入代码
 *
 * 返回（全站统一 {code,data} 约定）：
 *   成功 { code: 0, data: {
 *            platform, media_type: 'song'|'album', platform_id, source_url,
 *            title, artist, cover_url, need_manual } }
 *   失败 { code: 非 0, error: '中文原因' }
 *
 * 原则：
 *   1. 只访问各平台官方端点（oEmbed / 公开 API / iTunes Lookup），不做任何非官方逆向；
 *   2. 只接受单曲/专辑，歌单/合集/播放列表一律拒绝；
 *   3. 短链（163cn.tv / b23.tv / spotify.link / on.soundcloud.com）跟随 3xx 后在最终 URL 上复核；
 *   4. A 档平台自动取元数据；B 档（网易云/B站/Bandcamp）need_manual=true，曲名歌手前端手填；
 *   5. 外呼 8s 超时，输入限长，按平台限定 host，不携带任何凭据。
 */

const FETCH_TIMEOUT_MS = 8000
const URL_MAX_LEN = 2048
const EMBED_MAX_LEN = 8000

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

/** iTunes 封面尺寸放大：.../100x100bb.jpg → .../600x600bb.jpg */
function upscaleArtwork(url) {
  return typeof url === 'string'
    ? url.replace(/\/\d+x\d+(?:bb)?\.(jpg|png|webp)\b/i, '/600x600bb.$1')
    : null
}

// ============================================================
// 各平台解析器：输入原始字符串，输出统一 data 或抛 Error（消息为中文可直接展示）
// ============================================================

const parsers = {
  // ---------- 网易云音乐（B 档：无官方 oEmbed/API，只校验 ID） ----------
  async netease(raw) {
    let work = raw.trim()
    // 短链 163cn.tv 跟随
    if (/^https?:\/\/163cn\.tv\//i.test(work)) work = await finalUrl(work)
    const p = parseSpaUrl(work)
    if (!p || !/(^|\.)music\.163\.com$/.test(p.host)) throw new Error('不是网易云音乐链接')
    const m = p.path.match(/^\/?(?:m\/)?(song|album)\/?$/i)
    if (!m) {
      if (/playlist/i.test(p.path)) throw new Error('歌单不能投稿，只接受单曲或专辑链接')
      throw new Error('请粘贴网易云单曲（歌曲页「生成外链」的歌曲链接）或专辑链接')
    }
    const mediaType = m[1].toLowerCase() === 'album' ? 'album' : 'song'
    const id = p.query.get('id')
    if (!/^\d{4,}$/.test(id || '')) throw new Error('链接中缺少有效的歌曲/专辑 ID')
    const typeNo = mediaType === 'album' ? 1 : 2
    return {
      platform: 'netease',
      media_type: mediaType,
      platform_id: id,
      source_url: `https://music.163.com/#/${mediaType === 'album' ? 'album' : 'song'}?id=${id}`,
      title: '',
      artist: '',
      cover_url: null,
      need_manual: true,
      // 供前端埋点/排障，不展示
      _note: `netease outchain type=${typeNo}`,
    }
  },

  // ---------- YouTube / YouTube Music（A 档：官方 oEmbed） ----------
  async youtube(raw) {
    let work = raw.trim()
    let u
    try {
      u = new URL(work)
    } catch {
      throw new Error('链接格式不正确')
    }
    // 常见短链/营销链
    if (/^https?:\/\/(?:www\.)?youtube\.com\/attribution_link\b/i.test(work)) {
      const u2 = u.searchParams.get('u')
      if (u2) {
        u = new URL(u2.startsWith('http') ? u2 : `https://www.youtube.com${u2}`)
      }
    }
    const host = u.hostname.toLowerCase()
    let id = ''
    if (host === 'youtu.be') {
      id = u.pathname.split('/').filter(Boolean)[0] || ''
    } else if (/(^|\.)youtube\.com$/.test(host) || host === 'youtube-nocookie.com') {
      if (u.pathname.startsWith('/watch')) {
        id = u.searchParams.get('v') || ''
      } else {
        const mm = u.pathname.match(/^\/(?:shorts|embed|v)\/([\w-]{6,})/)
        if (mm) id = mm[1]
      }
    }
    if (!/^[\w-]{11}$/.test(id)) {
      if (/[?&]list=/.test(work) || /\/playlist\b/.test(work)) {
        throw new Error('播放列表不能投稿，请粘贴其中单曲的链接')
      }
      throw new Error('无法从链接中识别 YouTube 视频 ID（应为 11 位字符）')
    }
    // 官方 oEmbed 取标题/频道/封面；失败不致命，降级手填
    let title = ''
    let artist = ''
    let cover = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`
    try {
      const oe = await fetchJson(
        `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${id}`)}`,
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
      platform_id: id,
      source_url: `https://www.youtube.com/watch?v=${id}`,
      title,
      artist, // 注意：这是频道名，未必是真实歌手，前端允许修改
      cover_url: cover,
      need_manual: !title,
    }
  },

  // ---------- B站（B 档：无官方 oEmbed，校验 BV/av；封面用播放器 poster） ----------
  async bilibili(raw) {
    let work = raw.trim()
    if (/^https?:\/\/b23\.tv\//i.test(work)) work = await finalUrl(work)
    let u
    try {
      u = new URL(work)
    } catch {
      throw new Error('链接格式不正确')
    }
    const host = u.hostname.toLowerCase()
    if (!/(^|\.)bilibili\.com$/.test(host)) throw new Error('不是 B站链接')
    const bv = u.pathname.match(/\/video\/(BV[0-9A-Za-z]{8,})/i)
    const av = u.pathname.match(/\/video\/av(\d+)/i)
    let platformId = ''
    let sourceUrl = ''
    if (bv) {
      platformId = bv[1]
      sourceUrl = `https://www.bilibili.com/video/${bv[1]}`
    } else if (av) {
      platformId = `av${av[1]}`
      sourceUrl = `https://www.bilibili.com/video/av${av[1]}`
    } else {
      if (/\/playlist|\/medialist|\/bangumi|\/opus|\/read\//.test(u.pathname)) {
        throw new Error('合集/列表/专栏/番剧不能投稿，只接受单个视频链接')
      }
      throw new Error('请粘贴 B站单个视频链接（BV 号或 av 号）')
    }
    return {
      platform: 'bilibili',
      media_type: 'song',
      platform_id: platformId,
      source_url: sourceUrl,
      title: '',
      artist: '',
      cover_url: null,
      need_manual: true,
    }
  },

  // ---------- Spotify（A 档：官方 oEmbed；未登录 30 秒预览） ----------
  async spotify(raw) {
    let work = raw.trim()
    if (/^https?:\/\/spotify\.link\//i.test(work)) work = await finalUrl(work)
    let u
    try {
      u = new URL(work)
    } catch {
      throw new Error('链接格式不正确')
    }
    if (u.hostname.toLowerCase() !== 'open.spotify.com') throw new Error('不是 Spotify 链接')
    // 允许 /intl-xx/ 等可选前缀段
    const m = u.pathname.match(/^\/(?:intl-[a-z-]+\/)?(track|album)\/([\w]+)/i)
    if (!m) {
      if (/\/(playlist|artist|episode|show)\//.test(u.pathname)) {
        throw new Error('歌单/艺人/播客不能投稿，只接受单曲或专辑链接')
      }
      throw new Error('请粘贴 Spotify 单曲（/track/）或专辑（/album/）链接')
    }
    const mediaType = m[1].toLowerCase() === 'album' ? 'album' : 'song'
    const id = m[2]
    const canonical = `https://open.spotify.com/${mediaType}/${id}`
    const oe = await fetchJson(
      `https://open.spotify.com/oembed?url=${encodeURIComponent(canonical)}`,
    )
    // oEmbed 标题随地区语言形态不一，尽力拆歌手，拆不出留空给用户改
    const parsed = parseSpotifyTitle(String(oe.title || ''))
    return {
      platform: 'spotify',
      media_type: mediaType,
      platform_id: id,
      source_url: canonical,
      title: parsed.title,
      artist: parsed.artist,
      cover_url: oe.thumbnail_url || null,
      need_manual: false,
    }
  },

  // ---------- Apple Music（A 档：官方 iTunes Lookup；未登录 30 秒预览） ----------
  async apple_music(raw) {
    let u
    try {
      u = new URL(raw.trim())
    } catch {
      throw new Error('链接格式不正确')
    }
    if (u.hostname.toLowerCase() !== 'music.apple.com') throw new Error('不是 Apple Music 链接')
    // /{cc}/album/{可选slug}/{albumId}，单曲链接带 ?i=songId
    const m = u.pathname.match(/^\/([a-z]{2})\/album\/(?:[^/]+\/)?(\d+)$/i)
    if (!m) {
      if (/\/(playlist|artist|music-video|station)\//.test(u.pathname)) {
        throw new Error('歌单/艺人/MV 不能投稿，只接受单曲或专辑链接')
      }
      throw new Error('请粘贴 Apple Music 专辑或专辑内单曲链接')
    }
    const cc = m[1].toLowerCase()
    const albumId = m[2]
    const songId = u.searchParams.get('i')
    const isSong = !!songId && /^\d+$/.test(songId)
    const lookupId = isSong ? songId : albumId
    const entity = isSong ? 'song' : 'album'
    const data = await fetchJson(
      `https://itunes.apple.com/lookup?id=${encodeURIComponent(lookupId)}&country=${encodeURIComponent(cc)}&entity=${entity}&limit=1`,
    )
    const r = data?.results?.[0]
    if (!r) throw new Error('Apple 官方接口查不到该内容，可能为地区限制或链接错误')
    return {
      platform: 'apple_music',
      media_type: isSong ? 'song' : 'album',
      platform_id: `${cc}/${albumId}/${isSong ? songId : '0'}`,
      source_url: `https://music.apple.com/${cc}/album/${albumId}${isSong ? `?i=${songId}` : ''}`,
      title: isSong ? r.trackName : r.collectionName,
      artist: r.artistName || '',
      cover_url: upscaleArtwork(r.artworkUrl100 || r.artworkUrl60),
      need_manual: false,
    }
  },

  // ---------- SoundCloud（A 档：官方 oEmbed；sets 禁投） ----------
  async soundcloud(raw) {
    let work = raw.trim()
    if (/^https?:\/\/on\.soundcloud\.com\//i.test(work)) work = await finalUrl(work)
    let u
    try {
      u = new URL(work)
    } catch {
      throw new Error('链接格式不正确')
    }
    if (!/(^|\.)soundcloud\.com$/.test(u.hostname.toLowerCase()) && u.hostname.toLowerCase() !== 'w.soundcloud.com') {
      throw new Error('不是 SoundCloud 链接')
    }
    if (/\/sets\//.test(u.pathname)) throw new Error('Sets（歌单/合集）不能投稿，只接受单曲链接')
    // 规范成去掉查询参数的 track 链接；discover/station 等拒绝
    const segs = u.pathname.split('/').filter(Boolean)
    if (u.hostname.toLowerCase() !== 'w.soundcloud.com' && segs.length < 2) {
      throw new Error('请粘贴具体的单曲（track）链接，而不是用户主页')
    }
    let canonical = work
    if (u.hostname.toLowerCase() !== 'w.soundcloud.com') {
      canonical = `https://soundcloud.com${u.pathname.replace(/\/+$/, '')}`
    } else {
      const inner = u.searchParams.get('url')
      if (inner) canonical = inner
    }
    const oe = await fetchJson(
      `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(canonical)}`,
    )
    // oEmbed 对用户主页也可能返回，复核 html/作者链接中不含 /sets/
    if (!oe || typeof oe.title !== 'string') throw new Error('SoundCloud 官方接口无法识别该单曲')
    if (/\/sets\//.test(String(oe.html || ''))) throw new Error('Sets（歌单/合集）不能投稿，只接受单曲链接')
    return {
      platform: 'soundcloud',
      media_type: 'song',
      platform_id: canonical, // SoundCloud 无公开数字 ID，规范化 URL 即稳定标识
      source_url: canonical,
      title: oe.title,
      artist: oe.author_name || segs[0] || '',
      cover_url: oe.thumbnail_url || null,
      need_manual: false,
    }
  },

  // ---------- Deezer（A 档：官方公开 API；未登录 30 秒预览） ----------
  async deezer(raw) {
    let u
    try {
      u = new URL(raw.trim())
    } catch {
      throw new Error('链接格式不正确')
    }
    if (!/(^|\.)deezer\.com$/.test(u.hostname.toLowerCase()) && u.hostname.toLowerCase() !== 'deezer.page.link') {
      throw new Error('不是 Deezer 链接')
    }
    let work = raw.trim()
    if (/^https?:\/\/deezer\.page\.link\//i.test(work)) {
      work = await finalUrl(work)
      u = new URL(work)
    }
    // 可选地区前缀 /us/、/page/ 等
    const m = u.pathname.match(/\/(track|album)\/(\d+)/i)
    if (!m) {
      if (/\/(playlist|artist|episode|show|radio)\//.test(u.pathname)) {
        throw new Error('歌单/艺人/播客不能投稿，只接受单曲或专辑链接')
      }
      throw new Error('请粘贴 Deezer 单曲（/track/）或专辑（/album/）链接')
    }
    const mediaType = m[1].toLowerCase() === 'album' ? 'album' : 'song'
    const id = m[2]
    const data = await fetchJson(`https://api.deezer.com/${mediaType}/${id}`)
    if (data?.error) throw new Error('Deezer 官方接口查不到该内容')
    return {
      platform: 'deezer',
      media_type: mediaType,
      platform_id: String(data.id || id),
      source_url: `https://www.deezer.com/${mediaType}/${id}`,
      title: data.title || '',
      artist: data.artist?.name || '',
      cover_url: data.cover_medium || data.cover_big || data.cover_xl || null,
      need_manual: false,
    }
  },

  // ---------- Tidal（实质 B 档：官方 oEmbed 只回嵌入壳，假 ID 也返回 200，
  //            既无标题封面也无法验证存在性，统一手填 + 试播自证；未登录 30 秒预览） ----------
  async tidal(raw) {
    let u
    try {
      u = new URL(raw.trim())
    } catch {
      throw new Error('链接格式不正确')
    }
    const host = u.hostname.toLowerCase()
    if (!/(^|\.)tidal\.com$/.test(host)) throw new Error('不是 Tidal 链接')
    const m = u.pathname.match(/^\/(?:browse\/)?(track|album)\/(\d+)/i)
    if (!m) {
      if (/\/(playlist|artist|video|mix|station)\//.test(u.pathname)) {
        throw new Error('歌单/艺人/MV 不能投稿，只接受单曲或专辑链接')
      }
      throw new Error('请粘贴 Tidal 单曲（/track/）或专辑（/album/）链接')
    }
    const mediaType = m[1].toLowerCase() === 'album' ? 'album' : 'song'
    const id = m[2]
    return {
      platform: 'tidal',
      media_type: mediaType,
      platform_id: id,
      source_url: `https://tidal.com/${mediaType}/${id}`,
      title: '',
      artist: '',
      cover_url: null,
      need_manual: true,
    }
  },

  // ---------- Bandcamp（B 档：粘贴官方嵌入代码，提取数字 ID 与回链） ----------
  async bandcamp(raw) {
    const code = raw.trim()
    if (code.length > EMBED_MAX_LEN) throw new Error('嵌入代码过长，请确认复制的是 Bandcamp 官方 Share/Embed 代码')
    const player = code.match(/https?:\/\/bandcamp\.com\/EmbeddedPlayer\/(track|album)=(\d+)/i)
    if (!player) {
      if (/bandcamp\.com/.test(code) && !/EmbeddedPlayer/.test(code)) {
        throw new Error('Bandcamp 请粘贴官方「Share/Embed」弹窗里的整段嵌入代码（不是浏览器地址栏链接）')
      }
      throw new Error('未找到 Bandcamp 官方嵌入播放器，请确认粘贴的是 Embed 代码')
    }
    const kind = player[1].toLowerCase()
    const numId = player[2]
    // 回链：嵌入代码内通常含 https://{artist}.bandcamp.com/(track|album)/{slug}
    const link = code.match(/https?:\/\/([a-z0-9-]+\.bandcamp\.com)\/(track|album)\/[^\s"'?#<>]+/i)
    const mediaType = kind === 'album' ? 'album' : 'song'
    let sourceUrl = ''
    if (link) sourceUrl = link[0]
    // 预填：曲名锚点（含 /track/ /album/ 的 a 标签文本）与艺人锚点（艺人子域根链接）
    const anchors = [...code.matchAll(/<a[^>]+href="(https?:\/\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)].map(
      m => ({ href: m[1], text: m[2].replace(/<[^>]+>/g, '').trim() }),
    )
    const titleAnchor = anchors.find(a => new RegExp(`/${mediaType}/`, 'i').test(a.href) && a.text)
    const artistAnchor = anchors.find(a => /^https?:\/\/[a-z0-9-]+\.bandcamp\.com\/?$/i.test(a.href) && a.text)
    return {
      platform: 'bandcamp',
      media_type: mediaType,
      platform_id: `${kind === 'album' ? 'a' : 't'}${numId}`,
      source_url: sourceUrl || `https://bandcamp.com/EmbeddedPlayer/${kind}=${numId}`,
      title: titleAnchor?.text || '',
      artist: artistAnchor?.text || '',
      cover_url: null,
      need_manual: true,
    }
  },
}

/** Spotify oEmbed 标题拆「歌名 / 歌手」：英文 "X By Y on Spotify"，其余形态尽力拆 */
function parseSpotifyTitle(raw) {
  let t = raw
    .replace(/\s*\|\s*Spotify\s*$/i, '')
    .replace(/\s+on\s+Spotify\s*$/i, '')
    .trim()
  const by = t.split(/\s+By\s+/)
  if (by.length === 2) return { title: by[0].trim(), artist: by[1].trim() }
  // 部分地区用 "歌手 · 歌名"，Spotify 日/中文区较常见
  const dot = t.split(/\s+[·•]\s+/)
  if (dot.length === 2) return { title: dot[1].trim(), artist: dot[0].trim() }
  return { title: t, artist: '' }
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
  const limit = platform === 'bandcamp' ? EMBED_MAX_LEN : URL_MAX_LEN
  if (urlOrEmbed.length > limit) {
    return json(400, { code: 40003, error: `输入超过长度上限（${limit} 字符）` }, origin)
  }

  try {
    const data = await parsers[platform](urlOrEmbed)
    // 清理仅供内部排障的字段
    delete data._note
    return json(200, { code: 0, data }, origin)
  } catch (err) {
    const msg = err?.name === 'AbortError'
      ? '平台接口响应超时，请稍后重试'
      : (err?.message || '解析失败，请检查链接后重试')
    return json(200, { code: 42201, error: msg }, origin)
  }
}
