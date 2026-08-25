/**
 * LrcShare 开放 API 网关（Cloudflare Worker）
 * 部署：CF Dashboard → Workers → 新建 → 粘贴本文件 → 绑定 api.lrcshare.com
 * 环境变量（Worker Settings → Variables）：
 *   SUPABASE_URL       形如 https://spb-xxx.supabase.opentrust.net（不带尾斜杠、不带反引号）
 *   SUPABASE_ANON_KEY  anon key（仅 anon，service_role 禁止配置）
 *
 * 设计要点：
 * - 两段式流程：搜索/列表只返回轻量歌曲摘要（id/歌名/歌手/专辑名+年份/风格/封面），
 *   调用方确认目标后再经 /v1/song/:id 获取含歌词、词曲编、comment 在内的全部数据
 * - 回源只用 anon key：数据库层 RLS + 列级收权是第二道防线
 * - 只暴露定义好的端点与字段，内部表结构不出门
 * - 隐藏歌曲（is_hidden）不过滤：网站隐藏逻辑仅作用于前台，API 全量开放
 * - 署名链路：song.comment 与 LRC 末尾统一追加「本歌词来自于:贡献者名@lrcshare.com」
 * - 缓存：详情 1h / 列表搜索 10min（Cache API，GET 才缓存）
 * - 子域治理：通配符 Route（*.lrcshare.com/*）接住任意子域。已占用子域（doc 等）在
 *   Worker 内反向代理回真实源站（Workers 路由优先级高于 Pages 自定义域，必须代理），
 *   未知子域返回 HTML 404 页；灰云（仅 DNS）子域不进 CF 网络，不受影响
 */

// ============ 常量 ============

const SITE_DOMAIN = 'lrcshare.com'

/** 被通配符 Route 截胡的已占用子域 → 反向代理目标源站 */
const HOST_UPSTREAMS = {
  [`doc.${SITE_DOMAIN}`]: 'https://lrcshare-v3.pages.dev',
}

/** 歌曲摘要（列表/搜索返回）：id/歌名/歌手/专辑/风格/封面 */
const SONG_SUMMARY_SELECT = 'id,title,artist_ids,album_id,genres,cover,albums(name,year,cover)'
/** 歌曲详情（确认目标后获取全部数据，含歌词） */
const SONG_DETAIL_SELECT =
  'id,title,aliases,artist_ids,album_id,lyricist,composer,arranger,track,disc,genres,video_url,cover,contributor_id,created_at,lrc_text,albums(name,year,cover)'
/** 艺术家作品：摘要 + 词曲编列（仅用于计算 roles，不进输出） */
const SONG_ROLES_SELECT = 'id,title,artist_ids,album_id,genres,cover,lyricist,composer,arranger,albums(name,year,cover)'
/** 专辑曲目：摘要 + 曲目号/碟号 */
const ALBUM_TRACK_SELECT = 'id,title,artist_ids,album_id,genres,cover,track,disc'
const ALBUM_SELECT = 'id,name,cover,year,artist_ids,description,created_at'
const ARTIST_SELECT = 'id,name,aliases,types,avatar,bio,disambiguation'
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const TTL_DETAIL = 3600 // 详情缓存 1h
const TTL_LIST = 600 // 列表/搜索缓存 10min

// ============ 工具 ============

function corsHeaders(extra = {}) {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': '*',
    ...extra,
  }
}

function jsonOk(data, cacheTtl) {
  const headers = corsHeaders({ 'Content-Type': 'application/json; charset=utf-8' })
  if (cacheTtl) headers['Cache-Control'] = `public, max-age=${cacheTtl}`
  return new Response(JSON.stringify({ code: 200, data }), { status: 200, headers })
}

function jsonError(status, message) {
  return new Response(JSON.stringify({ code: status, message }), {
    status,
    headers: corsHeaders({ 'Content-Type': 'application/json; charset=utf-8' }),
  })
}

/** 未知子域（经 *.lrcshare.com 通配符路由进来的请求）返回的 HTML 404 页 */
function html404(host) {
  const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>404 - 子站不存在 | LrcShare</title>
<style>
  body{margin:0;font-family:system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;background:#f9fafb;color:#374151;display:flex;min-height:100vh;align-items:center;justify-content:center}
  .card{text-align:center;padding:48px 32px}
  .code{font-size:72px;font-weight:700;color:#ec4899;line-height:1}
  h1{font-size:20px;margin:16px 0 8px;color:#111827}
  p{margin:4px 0;color:#9ca3af;font-size:14px;word-break:break-all}
  a{display:inline-block;margin-top:24px;padding:8px 24px;background:#ec4899;color:#fff;text-decoration:none;border-radius:8px;font-size:14px}
  a:hover{background:#db2777}
</style>
</head>
<body>
  <div class="card">
    <div class="code">404</div>
    <h1>子站不存在</h1>
    <p>${host} 不是 LrcShare 的有效地址</p>
    <a href="https://${SITE_DOMAIN}/">返回主站</a>
  </div>
</body>
</html>`
  return new Response(html, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

/** 解析分页参数 */
function parsePage(url) {
  const q = url.searchParams
  let limit = parseInt(q.get('limit') || '', 10)
  let offset = parseInt(q.get('offset') || '', 10)
  if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT
  if (limit > MAX_LIMIT) limit = MAX_LIMIT
  if (!Number.isFinite(offset) || offset < 0) offset = 0
  return { limit, offset }
}

/** PostgREST 查询（列表，带 total 统计） */
async function pgList(env, table, params, { limit, offset }) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) qs.set(k, v)
  qs.set('limit', String(limit))
  qs.set('offset', String(offset))
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${qs}`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      Prefer: 'count=exact',
    },
  })
  if (!res.ok) return null
  const data = await res.json()
  const range = res.headers.get('content-range') // "0-19/532" 或 "0-19/*"
  const total = range && !range.endsWith('/*') ? Number(range.split('/')[1]) : null
  return { data, total }
}

/** PostgREST 查询单条 */
async function pgOne(env, table, select, filter) {
  const qs = new URLSearchParams({ select, ...filter })
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${qs}&limit=1`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
    },
  })
  if (!res.ok) return null
  const data = await res.json()
  return Array.isArray(data) && data.length > 0 ? data[0] : null
}

/** 批量取艺术家 id → name 映射 */
async function getArtistNameMap(env, ids) {
  const unique = [...new Set(ids)].filter(Boolean)
  if (unique.length === 0) return new Map()
  const qs = new URLSearchParams({ select: 'id,name', id: `in.(${unique.join(',')})` })
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/artists?${qs}`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
    },
  })
  if (!res.ok) return new Map()
  const data = await res.json()
  return new Map((data || []).map(a => [a.id, a.name]))
}

/** 批量取贡献者 id → name 映射 */
async function getContributorNameMap(env, ids) {
  const unique = [...new Set(ids)].filter(Boolean)
  if (unique.length === 0) return new Map()
  const qs = new URLSearchParams({ select: 'id,name', id: `in.(${unique.join(',')})` })
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/contributors?${qs}`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
    },
  })
  if (!res.ok) return new Map()
  const data = await res.json()
  return new Map((data || []).map(c => [c.id, c.name]))
}

/** 逗号分隔的艺术家 id 串 → 名字数组（去空） */
function idsToNames(csv, nameMap) {
  if (!csv) return []
  return String(csv)
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(id => nameMap.get(id) || '')
    .filter(Boolean)
}

/** 组装对外 song 摘要（列表/搜索用，轻量） */
function mapSongSummary(row, artistNames, albumFallback) {
  const album = row.albums
    ? { id: row.album_id || null, name: row.albums.name || '', year: row.albums.year || null, cover: row.albums.cover || null }
    : albumFallback || null
  return {
    id: row.id,
    title: row.title,
    artists: (row.artist_ids || []).map(id => ({ id, name: artistNames.get(id) || '' })).filter(a => a.name),
    album,
    genres: row.genres || [],
    cover: row.cover || (album && album.cover) || null,
  }
}

/** 摘要集合统一装配：批量查歌手名 */
async function assembleSummaries(env, rows, albumFallback) {
  if (!rows || rows.length === 0) return []
  const artistIds = []
  for (const r of rows) artistIds.push(...(r.artist_ids || []))
  const artistNames = await getArtistNameMap(env, artistIds)
  return rows.map(r => mapSongSummary(r, artistNames, albumFallback))
}

/** 组装对外 song 详情（含歌词与全部署名） */
function mapSongDetail(row, artistNames, contributorName) {
  const credit = contributorName ? `本歌词来自于:${contributorName}@${SITE_DOMAIN}` : `本歌词来自于:${SITE_DOMAIN}`
  const album = row.albums
    ? { id: row.album_id || null, name: row.albums.name || '', year: row.albums.year || null, cover: row.albums.cover || null }
    : null
  return {
    id: row.id,
    title: row.title,
    aliases: row.aliases || [],
    artists: (row.artist_ids || []).map(id => ({ id, name: artistNames.get(id) || '' })).filter(a => a.name),
    album,
    track: row.track ?? null,
    disc: row.disc ?? null,
    genres: row.genres || [],
    lyricist: idsToNames(row.lyricist, artistNames),
    composer: idsToNames(row.composer, artistNames),
    arranger: idsToNames(row.arranger, artistNames),
    cover: row.cover || (album && album.cover) || null,
    contributor: contributorName || null,
    comment: credit,
    video_url: row.video_url || null,
    created_at: row.created_at || null,
    lrc: row.lrc_text ? `${row.lrc_text.replace(/\s+$/, '')}\n${credit}` : null,
  }
}

/** 组装对外 album 对象 */
function mapAlbum(row, artistNames) {
  return {
    id: row.id,
    name: row.name,
    year: row.year || null,
    cover: row.cover || null,
    artists: (row.artist_ids || []).map(id => ({ id, name: artistNames.get(id) || '' })).filter(a => a.name),
    description: row.description || null,
    created_at: row.created_at || null,
  }
}

// ============ 端点处理 ============

function apiIndex() {
  return jsonOk({
    name: 'LrcShare API',
    version: 'v1',
    homepage: `https://${SITE_DOMAIN}`,
    docs: `https://doc.${SITE_DOMAIN}`,
    endpoints: {
      search: '/v1/search?keyword=&type=song|album|artist|lyric',
      songs: '/v1/songs?limit=&offset=',
      song: '/v1/song/:id',
      albums: '/v1/albums?limit=&offset=',
      album: '/v1/album/:id',
      artists: '/v1/artists?limit=&offset=',
      artist: '/v1/artist/:id',
      artistSongs: '/v1/artist/:id/songs',
    },
  })
}

// ---------- 搜索 ----------

async function handleSearch(env, url) {
  const keyword = (url.searchParams.get('keyword') || '').trim()
  const type = url.searchParams.get('type') || 'song'
  const { limit, offset } = parsePage(url)
  if (!keyword) return jsonError(400, 'missing required parameter: keyword')
  if (!['song', 'album', 'artist', 'lyric'].includes(type)) {
    return jsonError(400, 'invalid type, must be one of: song, album, artist, lyric')
  }

  if (type === 'song') {
    // 复用库端 search_songs RPC（title + aliases 数组模糊匹配）
    const qs = new URLSearchParams({ p_q: keyword, select: SONG_SUMMARY_SELECT, limit: String(limit), offset: String(offset) })
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/search_songs?${qs}`, {
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` },
    })
    if (!res.ok) return jsonError(502, 'upstream error')
    const rows = await res.json()
    const items = await assembleSummaries(env, rows || [])
    return jsonOk({ keyword, type, total: null, items }, TTL_LIST)
  }

  if (type === 'album') {
    const result = await pgList(env, 'albums', { select: ALBUM_SELECT, name: `ilike.*${keyword}*`, order: 'name.asc' }, { limit, offset })
    if (!result) return jsonError(502, 'upstream error')
    const artistNames = await getArtistNameMap(env, result.data.flatMap(a => a.artist_ids || []))
    const items = result.data.map(a => mapAlbum(a, artistNames))
    return jsonOk({ keyword, type, total: result.total, items }, TTL_LIST)
  }

  if (type === 'artist') {
    const result = await pgList(env, 'artists', { select: ARTIST_SELECT, is_show: 'eq.true', name: `ilike.*${keyword}*`, order: 'name.asc' }, { limit, offset })
    if (!result) return jsonError(502, 'upstream error')
    const items = result.data.map(a => ({
      id: a.id,
      name: a.name,
      aliases: a.aliases || [],
      types: a.types || [],
      avatar: a.avatar || null,
      bio: a.bio || null,
      disambiguation: a.disambiguation || null,
    }))
    return jsonOk({ keyword, type, total: result.total, items }, TTL_LIST)
  }

  // type === 'lyric'：歌词内容模糊匹配（关键词中的逗号/括号会破坏 PostgREST or 语法，剔除）
  const kw = keyword.replace(/[(),]/g, ' ').trim()
  if (!kw) return jsonOk({ keyword, type, total: null, items: [] }, TTL_LIST)
  const or = `(lrc_text.ilike.*${kw}*,lyrics_text.ilike.*${kw}*)`
  const result = await pgList(
    env,
    'songs',
    { select: SONG_SUMMARY_SELECT, status: 'eq.published', or, order: 'created_at.desc' },
    { limit, offset },
  )
  if (!result) return jsonError(502, 'upstream error')
  const items = await assembleSummaries(env, result.data)
  return jsonOk({ keyword, type, total: result.total, items }, TTL_LIST)
}

// ---------- 歌曲 ----------

async function handleSongs(env, url) {
  const { limit, offset } = parsePage(url)
  const result = await pgList(env, 'songs', { select: SONG_SUMMARY_SELECT, status: 'eq.published', order: 'created_at.desc' }, { limit, offset })
  if (!result) return jsonError(502, 'upstream error')
  const items = await assembleSummaries(env, result.data)
  return jsonOk({ total: result.total, limit, offset, items }, TTL_LIST)
}

async function handleSong(env, id) {
  const row = await pgOne(env, 'songs', SONG_DETAIL_SELECT, { id: `eq.${id}`, status: 'eq.published' })
  if (!row) return jsonError(404, 'song not found')
  const artistIds = [...(row.artist_ids || [])]
  for (const k of ['lyricist', 'composer', 'arranger']) {
    if (row[k]) artistIds.push(...String(row[k]).split(',').map(s => s.trim()))
  }
  const [artistNames, contributorNames] = await Promise.all([
    getArtistNameMap(env, artistIds),
    row.contributor_id ? getContributorNameMap(env, [row.contributor_id]) : Promise.resolve(new Map()),
  ])
  return jsonOk(mapSongDetail(row, artistNames, contributorNames.get(row.contributor_id) || null), TTL_DETAIL)
}

// ---------- 专辑 ----------

async function handleAlbums(env, url) {
  const { limit, offset } = parsePage(url)
  const result = await pgList(env, 'albums', { select: ALBUM_SELECT, order: 'name.asc' }, { limit, offset })
  if (!result) return jsonError(502, 'upstream error')
  const artistNames = await getArtistNameMap(env, result.data.flatMap(a => a.artist_ids || []))
  const items = result.data.map(a => mapAlbum(a, artistNames))
  return jsonOk({ total: result.total, limit, offset, items }, TTL_LIST)
}

async function handleAlbum(env, id) {
  const row = await pgOne(env, 'albums', ALBUM_SELECT, { id: `eq.${id}` })
  if (!row) return jsonError(404, 'album not found')
  const artistNames = await getArtistNameMap(env, row.artist_ids || [])
  // 曲目表：含隐藏歌曲（API 全量开放），按碟号/曲目号排序
  const songsRes = await pgList(
    env,
    'songs',
    { select: ALBUM_TRACK_SELECT, album_id: `eq.${id}`, status: 'eq.published', order: 'disc.asc.nullslast,track.asc.nullslast' },
    { limit: 500, offset: 0 },
  )
  const trackRows = (songsRes && songsRes.data) || []
  const trackArtistNames = await getArtistNameMap(env, trackRows.flatMap(r => r.artist_ids || []))
  const albumFallback = { id: row.id, name: row.name, year: row.year, cover: row.cover }
  return jsonOk(
    {
      ...mapAlbum(row, artistNames),
      songs: trackRows.map(r => ({
        ...mapSongSummary(r, trackArtistNames, albumFallback),
        track: r.track ?? null,
        disc: r.disc ?? null,
      })),
    },
    TTL_DETAIL,
  )
}

// ---------- 艺术家 ----------

async function handleArtists(env, url) {
  const { limit, offset } = parsePage(url)
  const result = await pgList(env, 'artists', { select: ARTIST_SELECT, is_show: 'eq.true', order: 'name.asc' }, { limit, offset })
  if (!result) return jsonError(502, 'upstream error')
  const items = result.data.map(a => ({
    id: a.id,
    name: a.name,
    aliases: a.aliases || [],
    types: a.types || [],
    avatar: a.avatar || null,
    bio: a.bio || null,
    disambiguation: a.disambiguation || null,
  }))
  return jsonOk({ total: result.total, limit, offset, items }, TTL_LIST)
}

async function handleArtist(env, id) {
  const row = await pgOne(env, 'artists', ARTIST_SELECT, { id: `eq.${id}` })
  if (!row) return jsonError(404, 'artist not found')
  return jsonOk(
    {
      id: row.id,
      name: row.name,
      aliases: row.aliases || [],
      types: row.types || [],
      avatar: row.avatar || null,
      bio: row.bio || null,
      disambiguation: row.disambiguation || null,
    },
    TTL_DETAIL,
  )
}

async function handleArtistSongs(env, id, url) {
  const { limit, offset } = parsePage(url)
  // 演唱（数组 overlaps）+ 词曲编（逗号串 ilike，与主站 getArtistSongs 同口径）
  const or = `(artist_ids.ov.${id},lyricist.ilike.*${id}*,composer.ilike.*${id}*,arranger.ilike.*${id}*)`
  const result = await pgList(
    env,
    'songs',
    { select: SONG_ROLES_SELECT, status: 'eq.published', or, order: 'created_at.desc' },
    { limit, offset },
  )
  if (!result) return jsonError(502, 'upstream error')
  const summaries = await assembleSummaries(env, result.data)
  // 每首标注该艺术家的实际角色
  const items = result.data.map((r, i) => {
    const roles = []
    if ((r.artist_ids || []).includes(id)) roles.push('singer')
    for (const k of ['lyricist', 'composer', 'arranger']) {
      if (r[k] && String(r[k]).split(',').map(s => s.trim()).includes(id)) roles.push(k)
    }
    return { ...summaries[i], roles }
  })
  return jsonOk({ total: result.total, limit, offset, items }, TTL_LIST)
}

// ============ 入口 ============

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const reqHost = url.hostname

    // 已占用子域（如 doc 的 Pages 站）被通配符 Route 截胡 → 反向代理回源站。
    // fetch 默认跟随重定向（follow），Pages 内部跳转不会把浏览器带去 pages.dev
    const upstream = HOST_UPSTREAMS[reqHost]
    if (upstream) {
      return fetch(upstream + url.pathname + url.search, {
        method: request.method,
        headers: request.headers,
      })
    }

    // 未知子域兜底：返回 HTML 404 页；api 域名与 workers.dev 默认域名正常放行
    if (reqHost !== `api.${SITE_DOMAIN}` && !reqHost.endsWith('.workers.dev')) {
      return html404(reqHost)
    }

    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }
    if (request.method !== 'GET') {
      return jsonError(405, 'method not allowed, GET only')
    }

    const path = url.pathname.replace(/\/+$/, '') // 去尾斜杠
    if (path !== '/v1' && !path.startsWith('/v1/')) {
      return jsonError(404, 'not found, see /v1/ for available endpoints')
    }

    // 缓存命中直接返回（仅 GET，天然满足）
    const cache = caches.default
    const cacheKey = new Request(url.toString(), { method: 'GET' })
    const cached = await cache.match(cacheKey)
    if (cached) {
      const headers = corsHeaders({ 'Content-Type': cached.headers.get('Content-Type') || 'application/json' })
      const cc = cached.headers.get('Cache-Control')
      if (cc) headers['Cache-Control'] = cc
      return new Response(cached.body, { status: cached.status, headers })
    }

    // 路由
    let res
    try {
      if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY) {
        return jsonError(500, 'worker not configured: missing SUPABASE_URL / SUPABASE_ANON_KEY')
      }
      if (path === '/v1' || path === '/v1/') {
        res = apiIndex()
      } else if (path === '/v1/search') {
        res = await handleSearch(env, url)
      } else if (path === '/v1/songs') {
        res = await handleSongs(env, url)
      } else if (path === '/v1/albums') {
        res = await handleAlbums(env, url)
      } else if (path === '/v1/artists') {
        res = await handleArtists(env, url)
      } else {
        const m = path.match(/^\/v1\/song\/([^/]+)$/)
        const ma = path.match(/^\/v1\/album\/([^/]+)$/)
        const mar = path.match(/^\/v1\/artist\/([^/]+)$/)
        const mars = path.match(/^\/v1\/artist\/([^/]+)\/songs$/)
        if (m) res = await handleSong(env, decodeURIComponent(m[1]))
        else if (ma) res = await handleAlbum(env, decodeURIComponent(ma[1]))
        else if (mars) res = await handleArtistSongs(env, decodeURIComponent(mars[1]), url)
        else if (mar) res = await handleArtist(env, decodeURIComponent(mar[1]))
        else res = jsonError(404, 'not found, see /v1/ for available endpoints')
      }
    } catch (e) {
      res = jsonError(500, 'internal error')
    }

    // 写入缓存（只缓存成功的 GET 响应）
    if (res.status === 200 && res.headers.get('Cache-Control')) {
      ctx.waitUntil(cache.put(cacheKey, res.clone()))
    }
    return res
  },
}
