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
 * - 署名链路：song.comment 与 LRC 末尾统一追加「本歌词来自于:贡献者名@lrcshare.com」；
 *   phase5 起署名按歌词版本（lyric_versions）各自携带，顶层 comment = 默认版本署名
 * - 缓存：详情 1h / 列表搜索 10min（Cache API，GET 才缓存）；另有 zone 级 Cache Rule
 *   让 JSON 进 CDN 缓存（命中不进 Worker，不消耗请求额度）、WAF 速率限制拦单 IP 洪峰
 * - 目录快照 /v1/catalog：全库可搜索文本，供调用方本地负向预过滤（批量工具省无效请求）
 * - 子域治理：通配符 Route（*.lrcshare.com/*）接住任意子域。未知子域返回 HTML
 *   404 页；灰云（仅 DNS）子域不进 CF 网络，不受影响
 * - 文档站：https://api.lrcshare.com/docs/（VitePress base=/docs/，Worker 剥掉
 *   /docs 前缀反代 Pages 源站，源站内容仍在根路径）
 */

// TTML 解析采用 AMLL 官方库 @applemusic-like-lyrics/ttml（AGPL-3.0）。
// Worker 无 DOMParser，注入 @xmldom/xmldom 供其解析。
import { TTMLParser } from '@applemusic-like-lyrics/ttml'
import { DOMParser } from '@xmldom/xmldom'

// ============ 常量 ============

const SITE_DOMAIN = 'lrcshare.com'

/** 文档站 Pages 源站（内容在根路径；/docs 前缀由 VitePress base 产生，代理时剥离） */
const DOCS_UPSTREAM = 'https://lrcshare-v3.pages.dev'

/** 歌曲摘要（列表/搜索返回）：id/歌名/歌手/专辑/风格；封面只在 album.cover（专辑封面，全站唯一封面来源）；
 *  album.artists 为专辑艺术家（TPE2/ALBUMARTIST）。
 *  歌手/专辑艺术家分别经 song_contributors / album_contributors 中间表嵌入 */
const SONG_SUMMARY_SELECT = 'id,title,album_id,genres,song_contributors(role,artist_id),albums(name,year,cover,album_contributors(artist_id))'
/** 歌曲详情（确认目标后获取全部数据，含歌词）。
 *  字段严格对齐音频标签标准（ID3v2 / Vorbis Comment）：
 *  title=TIT2/TITLE, artists=TPE1/ARTIST, album=TALB/ALBUM, year=TDRC/DATE,
 *  track=TRCK/TRACKNUMBER, disc=TPOS/DISCNUMBER, genres=TCON/GENRE,
 *  lyricist=TEXT/LYRICIST, composer=TCOM/COMPOSER, album.cover=APIC,
 *  album.artists=TPE2/ALBUMARTIST, lrc=USLT/LYRICS, comment=COMM。
 *  网站内部字段（video_url/created_at/description）不对外输出；
 *  contributor_id 仅用于在库端拼 comment 署名，不作为独立字段暴露 */
const SONG_DETAIL_SELECT =
  'id,title,aliases,album_id,track,disc,genres,contributor_id,lrc_text,song_contributors(role,artist_id),albums(name,year,cover,album_contributors(artist_id))'
/** 专辑曲目：摘要 + 曲目号/碟号 */
const ALBUM_TRACK_SELECT = 'id,title,album_id,genres,track,disc,song_contributors(role,artist_id)'
/** 专辑对象：同样只输出标签可用字段（name=TALB, year=DATE, cover=APIC, artists=TPE2）；
 *  专辑介绍/收录时间为网站内部数据，不对外 */
const ALBUM_SELECT = 'id,name,cover,year,album_contributors(artist_id)'
const ARTIST_SELECT = 'id,name,aliases,types,avatar,bio,disambiguation'
const DEFAULT_LIMIT = 20
const MAX_LIMIT = 100
const TTL_DETAIL = 3600 // 详情缓存 1h
const TTL_LIST = 600 // 列表/搜索缓存 10min

/** 中间表嵌入行 → 各角色 id 列表 */
const singerIdsOf = row => ((row && row.song_contributors) || []).filter(r => r.role === 'singer').map(r => r.artist_id)
const albumArtistIdsOf = a => ((a && a.album_contributors) || []).map(r => r.artist_id)

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

/** HTML 转义（Host 等请求可控值进 HTML 前必须过这道） */
const escapeHtml = s => String(s).replace(/[&<>"']/g, c =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))

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
    <p>${escapeHtml(host)} 不是 LrcShare 的有效地址</p>
    <a href="https://${SITE_DOMAIN}/">返回主站</a>
  </div>
</body>
</html>`
  return new Response(html, {
    status: 404,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  })
}

/** 文档站代理：VitePress base=/docs/ 但 Pages 源站内容在根路径 → 剥掉 /docs 前缀回源。
 *  fetch 默认跟随重定向（follow），Pages 内部跳转不会把浏览器带去 pages.dev */
function proxyDocs(url, request) {
  let path = url.pathname
  if (path === '/docs' || path === '/docs/') path = '/'
  else if (path.startsWith('/docs/')) path = path.slice('/docs'.length)
  return fetch(DOCS_UPSTREAM + path + url.search, {
    method: request.method,
    headers: request.headers,
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

/** PostgREST 调 RPC（GET 方式，set-returning function）：带 Prefer: count=exact 拿精确总数 */
async function pgRpc(env, fn, params) {
  const qs = new URLSearchParams(params)
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${fn}?${qs}`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${env.SUPABASE_ANON_KEY}`,
      Prefer: 'count=exact',
    },
  })
  if (!res.ok) return null
  const data = await res.json()
  const range = res.headers.get('content-range') // "0-19/532" / "*/0" / "0-19/*"
  const total = range && !range.endsWith('/*') ? Number(range.split('/')[1]) : null
  return { data, total }
}

/** 分页拉全表（目录快照用）：PostgREST 单次响应有行数上限，截断会让调用方漏判，
 *  必须翻页取完（total 已知时按 total 收口，未知时按「页未取满」收口） */
async function pgListAll(env, table, params, pageSize = 1000) {
  const rows = []
  let offset = 0
  for (;;) {
    const r = await pgList(env, table, params, { limit: pageSize, offset })
    if (!r) return null
    rows.push(...r.data)
    if (r.data.length < pageSize) break
    if (r.total !== null && rows.length >= r.total) break
    offset += pageSize
    if (offset > 500000) break // 防御性上限，避免异常数据导致死循环
  }
  return rows
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

/** 歌曲内嵌的 album 对象装配（含专辑艺术家，TPE2/ALBUMARTIST） */
function buildAlbumObject(row, albumArtistNames) {
  const a = row.albums || {}
  return {
    id: row.album_id || null,
    name: a.name || '',
    year: a.year || null,
    cover: a.cover || null,
    artists: albumArtistIdsOf(a).map(id => ({ id, name: (albumArtistNames && albumArtistNames.get(id)) || '' })).filter(x => x.name),
  }
}

/** 组装对外 song 摘要（列表/搜索用，轻量） */
function mapSongSummary(row, artistNames, albumArtistNames, albumFallback) {
  const album = row.albums ? buildAlbumObject(row, albumArtistNames) : albumFallback || null
  return {
    id: row.id,
    title: row.title,
    artists: singerIdsOf(row).map(id => ({ id, name: artistNames.get(id) || '' })).filter(a => a.name),
    album,
    genres: row.genres || [],
  }
}

/** 摘要集合统一装配：批量查歌手名与专辑艺术家名 */
async function assembleSummaries(env, rows, albumFallback) {
  if (!rows || rows.length === 0) return []
  const artistIds = []
  const albumArtistIds = []
  for (const r of rows) {
    artistIds.push(...singerIdsOf(r))
    if (r.albums) albumArtistIds.push(...albumArtistIdsOf(r.albums))
  }
  const [artistNames, albumArtistNames] = await Promise.all([
    getArtistNameMap(env, artistIds),
    getArtistNameMap(env, albumArtistIds),
  ])
  return rows.map(r => mapSongSummary(r, artistNames, albumArtistNames, albumFallback))
}

/** 搜索结果装配：裸 RPC 查歌曲行（select 不带嵌套资源，函数内部排序保真），
 *  再批量补 song_contributors / albums 关联数据。
 *  背景：PostgREST 对 RPC 的 select 带嵌套资源 + limit 时会生成无 ORDER BY 的
 *  LEFT JOIN 外层查询，join 会打乱函数输出顺序（hash join 按 join 键聚簇，
 *  limit=10 时整页结果曾变为同一专辑的歌曲）。裸查 + 表级补查彻底规避
 *  （表级 select 嵌套是普通表查询，不受此影响）。 */
async function enrichSongRows(env, rows) {
  if (!rows || rows.length === 0) return []
  const songIds = [...new Set(rows.map(r => r.id).filter(Boolean))]
  const albumIds = [...new Set(rows.map(r => r.album_id).filter(Boolean))]
  const inList = ids => `in.(${ids.map(id => `"${id}"`).join(',')})`
  const [contribRes, albumRes] = await Promise.all([
    songIds.length
      ? pgList(env, 'song_contributors', { select: 'song_id,role,artist_id', song_id: inList(songIds) }, { limit: 1000, offset: 0 })
      : { data: [] },
    albumIds.length
      ? pgList(env, 'albums', { select: ALBUM_SELECT, id: inList(albumIds) }, { limit: 1000, offset: 0 })
      : { data: [] },
  ])
  if (!contribRes || !albumRes) return null
  const contribsBySong = new Map()
  for (const c of contribRes.data || []) {
    if (!contribsBySong.has(c.song_id)) contribsBySong.set(c.song_id, [])
    contribsBySong.get(c.song_id).push({ role: c.role, artist_id: c.artist_id })
  }
  const albumById = new Map((albumRes.data || []).map(a => [a.id, a]))
  for (const r of rows) {
    r.song_contributors = contribsBySong.get(r.id) || []
    r.albums = albumById.get(r.album_id) || null
  }
  return rows
}

/** 组装对外 album 对象 */
function mapAlbum(row, artistNames) {
  return {
    id: row.id,
    name: row.name,
    year: row.year || null,
    cover: row.cover || null,
    artists: albumArtistIdsOf(row).map(id => ({ id, name: artistNames.get(id) || '' })).filter(a => a.name),
  }
}

// ============ 端点处理 ============

function apiIndex() {
  return jsonOk({
    name: 'LrcShare API',
    version: 'v1',
    homepage: `https://${SITE_DOMAIN}`,
    docs: `https://api.${SITE_DOMAIN}/docs/`,
    endpoints: {
      search: '/v1/search?keyword=|title=&artist=&type=song|album|artist|lyric',
      catalog: '/v1/catalog',
      songs: '/v1/songs?limit=&offset=',
      song: '/v1/song/:id',
      lyric: '/v1/lyric/:id',
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
  const title = (url.searchParams.get('title') || '').trim()
  const artist = (url.searchParams.get('artist') || '').trim()
  const type = url.searchParams.get('type') || 'song'
  const { limit, offset } = parsePage(url)
  if (!['song', 'album', 'artist', 'lyric'].includes(type)) {
    return jsonError(400, 'invalid type, must be one of: song, album, artist, lyric')
  }

  // 结构化查询：title（歌名/专辑名）× artist（演唱者/专辑艺术家，均含别名），AND 语义。
  // 面向打标工具（关键词来自文件 tag 的 TIT2/TPE1、TALB/TPE2）；别名匹配在库端 RPC 完成
  if (title || artist) {
    if (keyword) return jsonError(400, 'keyword and title/artist are mutually exclusive')
    if (type !== 'song' && type !== 'album') {
      return jsonError(400, 'title/artist only supports type=song or type=album')
    }
    return type === 'song'
      ? handleSongSearchStructured(env, title, artist, limit, offset)
      : handleAlbumSearchStructured(env, title, artist, limit, offset)
  }

  if (!keyword) return jsonError(400, 'missing required parameter: keyword (or title/artist)')

  if (type === 'song') {
    // 复用库端 search_songs RPC（title + aliases 数组模糊匹配）。
    // select 必须裸列（无嵌套资源）：函数内部排序才不被 PostgREST 的
    // join 外层查询打乱；关联数据由 enrichSongRows 批量补齐
    const result = await pgRpc(env, 'search_songs', { p_q: keyword, select: 'id,title,album_id,genres', limit: String(limit), offset: String(offset) })
    if (!result) return jsonError(502, 'upstream error')
    const rows = await enrichSongRows(env, result.data || [])
    if (!rows) return jsonError(502, 'upstream error')
    const items = await assembleSummaries(env, rows)
    return jsonOk({ keyword, type, total: result.total, items }, TTL_LIST)
  }

  if (type === 'album') {
    const result = await pgList(env, 'albums', { select: ALBUM_SELECT, name: `ilike.*${keyword}*`, order: 'name.asc' }, { limit, offset })
    if (!result) return jsonError(502, 'upstream error')
    const artistNames = await getArtistNameMap(env, result.data.flatMap(a => albumArtistIdsOf(a)))
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

// ---------- 结构化搜索（title/artist → 库端 RPC） ----------

async function handleSongSearchStructured(env, title, artist, limit, offset) {
  // select 必须裸列（无嵌套资源）：同 keyword 搜索，保函数输出序，关联由 enrichSongRows 补齐
  const params = { select: 'id,title,album_id,genres', limit: String(limit), offset: String(offset) }
  if (title) params.p_title = title
  if (artist) params.p_artist = artist
  const result = await pgRpc(env, 'search_songs_structured', params)
  if (!result) return jsonError(502, 'upstream error')
  const rows = await enrichSongRows(env, result.data || [])
  if (!rows) return jsonError(502, 'upstream error')
  const items = await assembleSummaries(env, rows)
  return jsonOk({ title, artist, type: 'song', total: result.total, items }, TTL_LIST)
}

async function handleAlbumSearchStructured(env, title, artist, limit, offset) {
  const params = { select: ALBUM_SELECT, limit: String(limit), offset: String(offset) }
  if (title) params.p_name = title
  if (artist) params.p_artist = artist
  const result = await pgRpc(env, 'search_albums_structured', params)
  if (!result) return jsonError(502, 'upstream error')
  const artistNames = await getArtistNameMap(env, (result.data || []).flatMap(a => albumArtistIdsOf(a)))
  const items = (result.data || []).map(a => mapAlbum(a, artistNames))
  return jsonOk({ title, artist, type: 'album', total: result.total, items }, TTL_LIST)
}

// ---------- 目录快照（负向预过滤用） ----------

/** 全库可搜索文本快照：已发布歌曲的 title/aliases + 可见艺术家（is_show is not false，与
 *  search_songs v3 一致，覆盖演唱/词/曲/编四路关联）的 name/aliases + 专辑名。
 *  覆盖范围必须 ⊇ /v1/search 的全部匹配范围，才能保证调用方的负向过滤不漏判：
 *  「查询串（整串或任意 title/artist 切分）不在快照文本中 ⇒ 搜索必然 0 结果 ⇒ 可安全跳过请求」 */
async function handleCatalog(env) {
  const [songs, artists, albums] = await Promise.all([
    pgListAll(env, 'songs', { select: 'title,aliases', status: 'eq.published', order: 'id.asc' }),
    pgListAll(env, 'artists', { select: 'name,aliases', or: '(is_show.neq.false,is_show.is.null)', order: 'id.asc' }),
    pgListAll(env, 'albums', { select: 'name', order: 'id.asc' }),
  ])
  if (!songs || !artists || !albums) return jsonError(502, 'upstream error')

  const tokens = new Set()
  const add = v => {
    const s = String(v || '').trim().toLowerCase()
    if (s) tokens.add(s)
  }
  for (const s of songs) {
    add(s.title)
    for (const a of s.aliases || []) add(a)
  }
  for (const a of artists) {
    add(a.name)
    for (const al of a.aliases || []) add(al)
  }
  for (const a of albums) add(a.name)

  return jsonOk(
    {
      generated_at: new Date().toISOString(),
      songs: songs.length,
      artists: artists.length,
      albums: albums.length,
      text: [...tokens].join('\n'),
    },
    TTL_DETAIL,
  )
}

// ---------- 歌曲 ----------

async function handleSongs(env, url) {
  const { limit, offset } = parsePage(url)
  const result = await pgList(env, 'songs', { select: SONG_SUMMARY_SELECT, status: 'eq.published', order: 'created_at.desc' }, { limit, offset })
  if (!result) return jsonError(502, 'upstream error')
  const items = await assembleSummaries(env, result.data)
  return jsonOk({ total: result.total, limit, offset, items }, TTL_LIST)
}

// ---------- 歌词行表合成（phase4）+ 歌词版本（phase5） ----------

/** 读一首歌的歌词行表（所有版本，分页拉全；version_id 用于按版本归属分组） */
async function getLyricVersions(env, songId) {
  return pgListAll(env, 'song_lyric_lines', {
    song_id: `eq.${songId}`,
    select: 'version_id,lang,kind,seq,time_ms,end_ms,text',
    order: 'seq.asc',
  })
}

/** 读一首歌的歌词版本元数据（RLS 只放行 published） */
async function getSongLyricVersionMetas(env, songId) {
  return pgListAll(env, 'lyric_versions', {
    song_id: `eq.${songId}`,
    select: 'id,format,source,external_id,ttml_text,langs,status,is_primary,contributor_id,source_credit,created_at',
    order: 'created_at.asc',
  })
}

/** 版本排序（tab 优先级，D2 决策）：管理员置顶 > 格式 TTML > 逐字 > 行级 > 投稿时间 */
const VERSION_FORMAT_ORDER = { ttml: 0, enhanced: 1, lrc: 2 }
function sortLyricVersions(list) {
  return (list || []).slice().sort((a, b) => {
    const p = (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0)
    if (p) return p
    const f = (VERSION_FORMAT_ORDER[a.format] ?? 9) - (VERSION_FORMAT_ORDER[b.format] ?? 9)
    if (f) return f
    return String(a.created_at || '').localeCompare(String(b.created_at || ''))
  })
}

/** 版本署名：用户版 = 贡献者名（无则站名）；ttml-hub 版 = TTML metadata 贡献者（无则来源标注） */
function versionCreditOf(v, contributorNames) {
  if (v.source === 'ttml-hub') return v.source_credit || '本歌词来自于:LunaBeat TTML 歌词站@lrcshare.com'
  const name = v.contributor_id ? contributorNames.get(v.contributor_id) : null
  return name ? `本歌词来自于:${name}@${SITE_DOMAIN}` : `本歌词来自于:${SITE_DOMAIN}`
}

/** 行表按 version_id 分组 → Map<version_id, (lang,kind) versions[]> */
function groupLinesByVersion(rows) {
  const byId = new Map()
  for (const r of rows) {
    let list = byId.get(r.version_id)
    if (!list) { list = []; byId.set(r.version_id, list) }
    list.push(r)
  }
  const out = new Map()
  for (const [vid, list] of byId) out.set(vid, groupVersions(list))
  return out
}

/** 行表 → versions（每个 (lang,kind) 一个版本，rows 按 seq 排） */
function groupVersions(rows) {
  const map = new Map()
  for (const r of rows) {
    const key = `${r.lang}|${r.kind}`
    let v = map.get(key)
    if (!v) { v = { lang: r.lang, kind: r.kind, rows: [] }; map.set(key, v) }
    v.rows.push({ seq: r.seq, time_ms: r.time_ms, end_ms: r.end_ms, text: r.text })
  }
  return [...map.values()]
}

/** primary_lang = original 版本里行数最多的 lang */
function derivePrimaryLang(versions) {
  const counts = {}
  for (const v of versions) {
    if (v.kind !== 'original') continue
    counts[v.lang] = (counts[v.lang] || 0) + v.rows.length
  }
  let best = null
  for (const lang of Object.keys(counts)) {
    if (best === null || counts[lang] > counts[best]) best = lang
  }
  return best
}

/** 毫秒 → mm:ss.xxx（三位毫秒，不舍入，与歌词滚动姬一致） */
function formatLyricTime(ms) {
  if (ms == null) return null
  const mm = Math.floor(ms / 60000)
  const ss = Math.floor((ms % 60000) / 1000)
  const xxx = ms % 1000
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(xxx).padStart(3, '0')}`
}

/** 剥词标签（<偏移毫秒> → 只留文本），line 格式用 */
function stripWordTags(text) {
  return String(text || '').replace(/<\d{1,6}>/g, '')
}

/** 词标签相对偏移 → 绝对时间（enhanced 格式用）：<偏移毫秒> → <mm:ss.xxx绝对>；首个词补行时间标签 */
function composeEnhancedText(text, timeMs, endMs) {
  const s = String(text || '')
  if (!/<\d{1,6}>/.test(s)) return s // 无词标签 → 降级为 line（原样）
  const converted = s.replace(/<(\d{1,6})>/g, (_, off) => `<${formatLyricTime(timeMs + Number(off))}>`)
  // 首词绝对时间=行首时不重复前置行时间标签（与前端 lyricLines.ts 同逻辑，往返幂等）
  const firstTag = converted.match(/^<(\d{1,3}):(\d{2})[.:](\d{2,3})>/)
  let noDupHead = false
  if (firstTag) {
    const frac = firstTag[3]
    const msPart = frac.length === 2 ? parseInt(frac, 10) * 10 : parseInt(frac, 10)
    const firstMs = parseInt(firstTag[1], 10) * 60000 + parseInt(firstTag[2], 10) * 1000 + msPart
    noDupHead = firstMs === timeMs
  }
  // 尾随标签已是行结束时间时不重复追加（往返幂等，避免 …<end><end> 叠加）
  const endTag = endMs != null ? `<${formatLyricTime(endMs)}>` : ''
  const appendEnd = !!endTag && !converted.endsWith(endTag)
  const headTag = `<${formatLyricTime(timeMs)}>`
  let out = noDupHead ? converted : `${headTag}${converted}`
  if (appendEnd) out += endTag
  // 收缩存量重复（旧数据自愈，与前端 lyricLines.ts 同逻辑）：行首连续相同的行时间标签、行尾连续相同的 end 标签各只留 1 个
  const esc = t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  out = out.replace(new RegExp(`^(?:${esc(headTag)})+`), headTag)
  if (endTag) out = out.replace(new RegExp(`(?:${esc(endTag)})+$`), endTag)
  return out
}

/** 词标签相对偏移 → 绝对时间（verbatim 格式用）：每词前补 [mm:ss.xxx绝对]，无独立行首、无行尾（末词结束由播放器兜底） */
function composeVerbatimText(text, timeMs, endMs) {
  const s = String(text || '')
  if (!/<\d{1,6}>/.test(s)) {
    // 无词标签 → 降级为 line（单词 verbatim 与 line 同形）
    return `[${formatLyricTime(timeMs)}]${s}`
  }
  const words = parseWordTags(s)
  let out = words.map(w => `[${formatLyricTime(timeMs + w.offset_ms)}]${w.text}`).join('')
  if (endMs != null) out += `[${formatLyricTime(endMs)}]`
  return out
}

/** 选中版本：original(lyricLang) + 命中 translationLangs 的非 original 版本 */
function selectVersions(versions, lyricLang, translationLangs) {
  const selected = []
  const wantAll = translationLangs.includes('all')
  for (const v of versions) {
    if (v.kind === 'original') {
      if (v.lang === lyricLang) selected.push(v)
    } else if (wantAll || translationLangs.includes(v.lang)) {
      selected.push(v)
    }
  }
  return selected
}

/** 补齐公共行：非 original 版本补齐 original 中该版本没有对应 time_ms 的行（Hello/NONONO 等公共行，翻译版本也完整） */
function fillCommonRows(versions) {
  const original = versions.find(v => v.kind === 'original')
  if (!original) return versions
  for (const v of versions) {
    if (v.kind === 'original') continue
    const vTimeSet = new Set(v.rows.map(r => r.time_ms).filter(t => t != null))
    const fill = original.rows
      .filter(r => r.time_ms != null && !vTimeSet.has(r.time_ms))
      .map(r => ({ seq: r.seq, time_ms: r.time_ms, end_ms: r.end_ms, text: r.text }))
    if (fill.length) {
      v.rows = [...v.rows, ...fill].sort((a, b) => (a.time_ms !== b.time_ms ? a.time_ms - b.time_ms : a.seq - b.seq))
    }
  }
  return versions
}

/** 元数据行 key（[ti:xxx] → ti） */
function metaKeyOf(line) {
  const m = String(line).match(/^\[([A-Za-z]+):/)
  return m ? m[1].toLowerCase() : ''
}

/** 元数据行去重 + 按 key 序（ti/ar/al/by/其他） */
function dedupeMeta(metaLines) {
  const keyRank = { ti: 0, ar: 1, al: 2, by: 3 }
  const seen = new Set()
  return [...metaLines]
    .sort((a, b) => (keyRank[metaKeyOf(a)] ?? 4) - (keyRank[metaKeyOf(b)] ?? 4))
    .filter(line => {
      const key = metaKeyOf(line)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
}

/** 合成 LRC 文本（line/enhanced/verbatim）：元数据头部 + 选中版本歌词合并 + 稳定排序 + 格式化 */
function composeLrc(versions, format) {
  const lines = []
  const meta = []
  for (const v of versions) {
    for (const r of v.rows) {
      if (r.time_ms == null) {
        meta.push(r.text) // 元数据行（完整 [ti:xxx]）
        continue
      }
      lines.push({ time_ms: r.time_ms, end_ms: r.end_ms, kind: v.kind, lang: v.lang, text: r.text })
    }
  }
  lines.sort((a, b) => {
    if (a.time_ms !== b.time_ms) return a.time_ms - b.time_ms
    const rank = k => (k === 'original' ? 0 : k === 'translation' ? 1 : 2)
    return rank(a.kind) - rank(b.kind) || a.lang.localeCompare(b.lang)
  })
  const body = lines.map(l => {
    if (format === 'verbatim') return composeVerbatimText(l.text, l.time_ms, l.end_ms) // 无独立行首，词1时间=行时间
    const text = format === 'enhanced' ? composeEnhancedText(l.text, l.time_ms, l.end_ms) : stripWordTags(l.text)
    return `[${formatLyricTime(l.time_ms)}]${text}`
  }).join('\n')
  const head = dedupeMeta(meta).join('\n')
  return head ? `${head}\n${body}` : body
}

/** 毫秒 → TTML clock-time HH:MM:SS.mmm */
function formatTtmlTime(ms) {
  const hh = Math.floor(ms / 3600000)
  const mm = Math.floor((ms % 3600000) / 60000)
  const ss = Math.floor((ms % 60000) / 1000)
  const xxx = ms % 1000
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(xxx).padStart(3, '0')}`
}

/** XML 转义 */
function escapeXml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]))
}

/** 解析 text 词标签 → [{text, offset_ms}]；无标签则整行一个词 */
function parseWordTags(text) {
  const s = String(text || '')
  const tokens = s.split(/<(\d{1,6})>/)
  const words = []
  let offset = 0
  for (let i = 0; i < tokens.length; i++) {
    if (i % 2 === 0) {
      if (tokens[i]) words.push({ text: tokens[i], offset_ms: offset })
    } else {
      offset = Number(tokens[i])
    }
  }
  if (words.length === 0) words.push({ text: s, offset_ms: 0 })
  return words
}

/** 合成 TTML：行 → <p>，词 → <span>；end 派生（p=下一行 begin，span=下一词 begin，末位兜底 +3000ms）；署名走 <metadata> */
function composeTtml(versions, credit) {
  const lines = []
  const metaLines = []
  for (const v of versions) {
    for (const r of v.rows) {
      if (r.time_ms == null) {
        metaLines.push(r.text)
        continue
      }
      lines.push({ time_ms: r.time_ms, end_ms: r.end_ms, text: r.text })
    }
  }
  lines.sort((a, b) => a.time_ms - b.time_ms)
  const ps = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const pBeginMs = line.time_ms
    const pEndMs = line.end_ms != null
      ? line.end_ms
      : (i + 1 < lines.length ? lines[i + 1].time_ms : line.time_ms + 3000)
    const words = parseWordTags(line.text)
    const spans = words.map((w, wi) => {
      const wBeginMs = pBeginMs + w.offset_ms
      const wEndMs = wi + 1 < words.length ? pBeginMs + words[wi + 1].offset_ms : pEndMs
      return `<span begin="${formatTtmlTime(wBeginMs)}" end="${formatTtmlTime(wEndMs)}">${escapeXml(w.text)}</span>`
    }).join('')
    ps.push(`<p begin="${formatTtmlTime(pBeginMs)}" end="${formatTtmlTime(pEndMs)}">${spans}</p>`)
  }
  const meta = metaLines.length ? `<head><metadata>${dedupeMeta(metaLines).map(escapeXml).join('\n')}</metadata></head>` : ''
  // 署名走超界时间 <p>（06:59:19.999 对应 LRC [419:19.999]，播放器永不渲染，但工具按字幕行解析收录）
  const creditP = credit ? `<p begin="06:59:19.999" end="06:59:20.999">${escapeXml(credit)}</p>` : ''
  return `<tt xmlns="http://www.w3.org/ns/ttml">${meta}<body><div>${ps.join('')}${creditP}</div></body></tt>`
}

// ---------- TTML 原文 → 多语言版本（AMLL 官方库解析） ----------

/** 复用的 AMLL 解析器（Worker 无 DOMParser，注入 xmldom） */
const amllParser = new TTMLParser({ domParser: new DOMParser() })

/** 逐字音节 → text（词标签 <偏移毫秒>；endsWithSpace 补空格） */
function syllablesToText(words, lineStart) {
  return words.map(w => {
    const wordText = w.endsWithSpace ? w.text + ' ' : w.text
    const off = w.startTime - lineStart
    return off === 0 ? wordText : `<${off}>${wordText}`
  }).join('')
}

/** 排序 + 分配 seq */
function finalizeTtmlRows(rows) {
  rows.sort((a, b) => a.time_ms - b.time_ms)
  return rows.map((r, i) => ({ ...r, seq: i + 1 }))
}

/**
 * TTML 原文 → 多语言版本数组（每个 (lang, kind) 一个版本）。
 * AMLL 官方库解析：original = 主歌词行；translation/romanization = 行内翻译/音译（含 sidecar）。
 */
/** TTML xml:lang → 项目语言代码（zh-Hans→zh、zh-Hant→zh-Hant、ja-Latn→ja） */
function normalizeLang(code) {
  const c = String(code || '').trim()
  if (!c) return ''
  const low = c.toLowerCase()
  if (['zh-hans', 'zh-cn', 'zh-sg'].includes(low)) return 'zh'
  if (['zh-hant', 'zh-tw', 'zh-hk', 'zh-mo'].includes(low)) return 'zh-Hant'
  if (low.endsWith('-latn')) return low.split('-')[0]
  return c
}

function parseTtmlVersionsWorker(xml) {
  let result
  try {
    result = amllParser.parse(String(xml || ''))
  } catch {
    return []
  }
  const rootLang = normalizeLang(result.metadata.language) || 'und'

  const versions = []

  // original
  const originalRows = result.lines
    .filter(l => l.text.trim())
    .map(l => ({
      seq: 0,
      time_ms: l.startTime,
      end_ms: l.endTime,
      text: l.words?.length ? syllablesToText(l.words, l.startTime) : l.text,
    }))
  if (originalRows.length) versions.push({ lang: rootLang, kind: 'original', rows: finalizeTtmlRows(originalRows) })

  // translation / romanization：按语言分组
  const transMap = new Map()
  const romanMap = new Map()
  for (const l of result.lines) {
    for (const t of l.translations || []) {
      const lang = normalizeLang(t.language) || rootLang
      const rows = transMap.get(lang) || []
      rows.push({ seq: 0, time_ms: l.startTime, end_ms: l.endTime, text: t.words?.length ? syllablesToText(t.words, l.startTime) : t.text })
      transMap.set(lang, rows)
    }
    for (const r of l.romanizations || []) {
      const lang = normalizeLang(r.language) || rootLang
      const rows = romanMap.get(lang) || []
      rows.push({ seq: 0, time_ms: l.startTime, end_ms: l.endTime, text: r.words?.length ? syllablesToText(r.words, l.startTime) : r.text })
      romanMap.set(lang, rows)
    }
  }
  for (const [lang, rows] of transMap) versions.push({ lang, kind: 'translation', rows: finalizeTtmlRows(rows) })
  for (const [lang, rows] of romanMap) versions.push({ lang, kind: 'romanization', rows: finalizeTtmlRows(rows) })

  return versions
}

/** 计算歌词字段（lyric_versions/lrc/lyric_lines/lyrics），供 handleSong 与 handleLyric 复用。
 *  输入已查好的 versionMetas 与 contributorNames，避免重复查询。 */
async function buildLyricFields(env, id, url, versionMetas, contributorNames) {
  const q = url ? url.searchParams : new URLSearchParams()
  const lyricLang = (q.get('lyric_lang') || '').trim()
  const translationRaw = (q.get('lyric_translation_lang') || '').trim()
  const translationLangs = translationRaw ? translationRaw.split(',').map(s => s.trim()).filter(Boolean) : []
  const lyricFormatRaw = q.get('lyric_format')
  const lyricFormat = lyricFormatRaw || 'line'
  const wantLines = q.get('lyric_lines') === '1'
  // 显式指定格式 = 只要歌词，不带 lyric_versions
  const explicitFormat = lyricFormatRaw != null
  // 需要合成歌词文本（lrc/lyrics）
  const needCompose = explicitFormat || !!lyricLang || translationLangs.length > 0

  // 读行表 + TTML 拆行（无条件：全开时 lyric_versions 附完整内容、指定格式时合成 lrc 都需要）
  const linesByVersion = new Map()
  {
    const lineRows = await getLyricVersions(env, id)
    for (const [vid, vs] of groupLinesByVersion(lineRows || [])) linesByVersion.set(vid, vs)
    // TTML 版本拆行：参与 lang/kind 切片与格式合成（原 agent/样式仍在 ttml_text 保留）
    for (const v of versionMetas) {
      if (v.format === 'ttml' && v.ttml_text) {
        const vs = parseTtmlVersionsWorker(v.ttml_text)
        if (vs.length) linesByVersion.set(v.id, vs)
      }
    }
  }

  const versionCredits = new Map()
  for (const v of versionMetas) {
    versionCredits.set(v.id, versionCreditOf(v, contributorNames))
  }
  const defaultComment = versionMetas.length > 0 ? (versionCredits.get(versionMetas[0].id) || null) : null

  const fields = {}

  // lyric_versions：不带 lyric_format（全开）时返回，每版本给对应格式的文本（lrc 合并文本 / ttml 原文），
  // 并从 ttml 动态降级出 enhanced / verbatim；结构化行（lines）走 lyric_lines=1 开关，默认不附
  if (!explicitFormat) {
    fields.lyricVersions = []

    // 数据库版本：lrc/enhanced 给合并 LRC 文本，ttml 给原文
    for (const v of versionMetas) {
      const credit = versionCredits.get(v.id)
      const out = {
        id: v.id,
        format: v.format,
        source: v.source,
        langs: v.langs || [],
        is_primary: v.is_primary,
        comment: credit,
      }
      if (v.source === 'ttml-hub') out.external_id = v.external_id
      if (v.format === 'ttml') {
        out.ttml_text = v.ttml_text || null
      } else {
        const vs = linesByVersion.get(v.id) || []
        const composed = composeLrc(vs, v.format === 'enhanced' ? 'enhanced' : 'line')
        out.lrc = composed ? `${composed}\n[419:19.999]${credit}` : null
      }
      fields.lyricVersions.push(out)
    }

    // 从 ttml 动态降级 enhanced / verbatim（不落库，仅导出视图）
    for (const v of versionMetas) {
      if (v.format !== 'ttml' || !v.ttml_text) continue
      const ttmlVersions = parseTtmlVersionsWorker(v.ttml_text)
      const original = ttmlVersions.filter(x => x.kind === 'original')
      if (!original.length) continue
      const credit = versionCredits.get(v.id)
      const langs = [...new Set(original.map(x => x.lang))]
      for (const fmt of ['enhanced', 'verbatim']) {
        const composed = composeLrc(original, fmt)
        if (composed) {
          fields.lyricVersions.push({
            format: fmt,
            source: v.source,
            langs,
            is_primary: false,
            comment: credit,
            lrc: `${composed}\n[419:19.999]${credit}`,
          })
        }
      }
    }
  }

  // 合成歌词：指定格式 / 语言切片 / 结构化行
  if (needCompose || wantLines) {
    // 优先 lrc/enhanced 版本（保持既有行为）；纯 ttml 歌回退到 ttml 拆行
    const defaultLinesVid = (versionMetas.find(v => v.format !== 'ttml') || versionMetas[0] || {}).id
    const versions = defaultLinesVid ? (linesByVersion.get(defaultLinesVid) || []) : []
    if (versions.length > 0) {
      const primaryLang = derivePrimaryLang(versions)
      const effLyricLang = lyricLang || primaryLang || ''
      const selected = selectVersions(versions, effLyricLang, translationLangs)

      // lyric_lines 结构化行（指定了 lang 参数则只返回选中，否则返回全部版本；非 original 版本补齐公共行）
      if (wantLines) {
        const filled = fillCommonRows(versions)
        const outVersions = (lyricLang || translationLangs.length ? selectVersions(filled, effLyricLang, translationLangs) : filled)
          .map(v => ({ lang: v.lang, kind: v.kind, rows: v.rows }))
        fields.lyricLines = { primary_lang: primaryLang, versions: outVersions }
      }

      // 合成 lrc + lyrics 数组（显式指定格式或语言切片）
      if (needCompose) {
        if (selected.length === 0) {
          // 匹配不到任何版本 → 空 lrc（显式圈定语义，不 fallback 原始 lrc_text）
          fields.lrc = null
        } else if (lyricFormat === 'ttml') {
          // 资格规则：逐行数据（无词标签）没资格升 ttml → null；逐字/ttml 才合成
          const hasWord = selected.some(v => (v.rows || []).some(r => /<\d{1,6}>/.test(String(r.text))))
          fields.lrc = hasWord ? composeTtml(selected, defaultComment) : null
        } else {
          const composed = composeLrc(selected, lyricFormat)
          if (composed) {
            fields.lrc = `${composed}\n[419:19.999]${defaultComment}`
          }
        }
        // lyrics 数组：每个选中版本一份独立完整文本（补齐公共行；line/enhanced 带署名，ttml 纯 XML 不带）
        if (selected.length > 0) {
          const filled = fillCommonRows(selected)
          fields.lyrics = filled.map(v => {
            const text = lyricFormat === 'ttml' ? composeTtml([v], defaultComment) : composeLrc([v], lyricFormat)
            const lrc = lyricFormat === 'ttml' ? text : (text ? `${text}\n[419:19.999]${defaultComment}` : null)
            return { lang: v.lang, kind: v.kind, format: lyricFormat, lrc }
          })
        }
      }
    }
  }

  return { fields, versionCredits, defaultComment, linesByVersion }
}

async function handleSong(env, id, url) {
  // song_contributors 嵌套（FK song_id）：贡献关系唯一数据源（含歌手/词/曲/编）
  const select = SONG_DETAIL_SELECT
  const row = await pgOne(env, 'songs', select, { id: `eq.${id}`, status: 'eq.published' })
  if (!row) return jsonError(404, 'song not found')
  const byRole = { singer: [], lyricist: [], composer: [], arranger: [] }
  for (const r of row.song_contributors || []) {
    if (byRole[r.role]) byRole[r.role].push(r.artist_id)
  }
  const creditIds = {
    lyricist: byRole.lyricist,
    composer: byRole.composer,
    arranger: byRole.arranger,
  }
  const artistIds = [...byRole.singer, ...creditIds.lyricist, ...creditIds.composer, ...creditIds.arranger]

  // 歌词版本元数据（RLS 只放行 published）：顶层摘要 + 默认版本署名
  const versionMetas = sortLyricVersions(await getSongLyricVersionMetas(env, id))
  const contributorIds = [...new Set([
    row.contributor_id,
    ...versionMetas.map(v => v.contributor_id).filter(Boolean),
  ].filter(Boolean))]
  const [artistNames, albumArtistNames, contributorNames] = await Promise.all([
    getArtistNameMap(env, artistIds),
    row.albums ? getArtistNameMap(env, albumArtistIdsOf(row.albums)) : Promise.resolve(new Map()),
    contributorIds.length ? getContributorNameMap(env, contributorIds) : Promise.resolve(new Map()),
  ])
  const idsToNames = ids => ids.map(x => artistNames.get(x)).filter(Boolean)
  const base = {
    ...mapSongDetailBase(row, artistNames, albumArtistNames, contributorNames.get(row.contributor_id) || null),
    lyricist: idsToNames(creditIds.lyricist),
    composer: idsToNames(creditIds.composer),
    arranger: idsToNames(creditIds.arranger),
  }

  const { fields, versionCredits } = await buildLyricFields(env, id, url, versionMetas, contributorNames)

  // 顶层 comment（默认版本署名）
  if (versionMetas.length > 0) {
    base.comment = versionCredits.get(versionMetas[0].id) || base.comment
  }

  // lyric_versions（不带 lyric_format 时）
  if (fields.lyricVersions) base.lyric_versions = fields.lyricVersions

  // 纯 ttml 歌（无 lrc_text）：顶层 lrc 从 ttml 降级成 line LRC，
  // 保证老客户端 / Lyrico 插件能拿到歌词（否则 lrc 为 null）
  if (!base.lrc && versionMetas.length > 0) {
    const ttmlVer = versionMetas.find(v => v.format === 'ttml' && v.ttml_text)
    if (ttmlVer) {
      const ttmlVersions = parseTtmlVersionsWorker(ttmlVer.ttml_text)
      const original = ttmlVersions.filter(v => v.kind === 'original')
      if (original.length) {
        const composed = composeLrc(original, 'line')
        if (composed) base.lrc = `${composed}\n[419:19.999]${base.comment}`
      }
    }
  }

  // 合成结果覆盖（带参数时）
  if ('lrc' in fields) base.lrc = fields.lrc
  if (fields.lyricLines) base.lyric_lines = fields.lyricLines
  if (fields.lyrics) base.lyrics = fields.lyrics

  return jsonOk(base, TTL_DETAIL)
}

/** 纯歌词接口：只返回歌词（不带任何歌曲标签字段）。 */
async function handleLyric(env, id, url) {
  // 只确认歌曲存在（RLS 只放行 published），标签字段一律不返回
  const row = await pgOne(env, 'songs', 'id', { id: `eq.${id}`, status: 'eq.published' })
  if (!row) return jsonError(404, 'lyric not found')

  const versionMetas = sortLyricVersions(await getSongLyricVersionMetas(env, id))
  const contributorIds = [...new Set(versionMetas.map(v => v.contributor_id).filter(Boolean))]
  const contributorNames = contributorIds.length ? await getContributorNameMap(env, contributorIds) : new Map()

  const { fields } = await buildLyricFields(env, id, url, versionMetas, contributorNames)

  const data = {}
  if (fields.lyricVersions) data.lyric_versions = fields.lyricVersions
  if ('lrc' in fields) data.lrc = fields.lrc
  if (fields.lyricLines) data.lyric_lines = fields.lyricLines
  if (fields.lyrics) data.lyrics = fields.lyrics

  return jsonOk(data, TTL_DETAIL)
}

/** 详情装配的公共部分（lyricist/composer/arranger 由调用方按角色结果传入覆盖） */
function mapSongDetailBase(row, artistNames, albumArtistNames, contributorName) {
  const credit = contributorName ? `本歌词来自于:${contributorName}@${SITE_DOMAIN}` : `本歌词来自于:${SITE_DOMAIN}`
  const album = row.albums ? buildAlbumObject(row, albumArtistNames) : null
  return {
    id: row.id,
    title: row.title,
    aliases: row.aliases || [],
    artists: singerIdsOf(row).map(id => ({ id, name: artistNames.get(id) || '' })).filter(a => a.name),
    album,
    track: row.track ?? null,
    disc: row.disc ?? null,
    genres: row.genres || [],
    comment: credit,
    // 署名带 419:19.999 超界时间戳：LRC 规范外的时间点，播放器永不渲染滚动，
    // 但第三方工具（如 Lyrico 写 tag）解析时能把它当作普通 LRC 行收录
    lrc: row.lrc_text ? `${row.lrc_text.replace(/\s+$/, '')}\n[419:19.999]${credit}` : null,
  }
}

// ---------- 专辑 ----------

async function handleAlbums(env, url) {
  const { limit, offset } = parsePage(url)
  const result = await pgList(env, 'albums', { select: ALBUM_SELECT, order: 'name.asc' }, { limit, offset })
  if (!result) return jsonError(502, 'upstream error')
  const artistNames = await getArtistNameMap(env, result.data.flatMap(a => albumArtistIdsOf(a)))
  const items = result.data.map(a => mapAlbum(a, artistNames))
  return jsonOk({ total: result.total, limit, offset, items }, TTL_LIST)
}

async function handleAlbum(env, id) {
  const row = await pgOne(env, 'albums', ALBUM_SELECT, { id: `eq.${id}` })
  if (!row) return jsonError(404, 'album not found')
  const artistNames = await getArtistNameMap(env, albumArtistIdsOf(row))
  // 曲目表：含隐藏歌曲（API 全量开放），按碟号/曲目号排序
  const songsRes = await pgList(
    env,
    'songs',
    { select: ALBUM_TRACK_SELECT, album_id: `eq.${id}`, status: 'eq.published', order: 'disc.asc.nullslast,track.asc.nullslast' },
    { limit: 500, offset: 0 },
  )
  const trackRows = (songsRes && songsRes.data) || []
  const trackArtistNames = await getArtistNameMap(env, trackRows.flatMap(r => singerIdsOf(r)))
  const albumObj = mapAlbum(row, artistNames) // 曲目内嵌的 album 直接复用（含 artists）
  return jsonOk(
    {
      ...albumObj,
      songs: trackRows.map(r => ({
        ...mapSongSummary(r, trackArtistNames, artistNames, albumObj),
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
  // 库端 RPC（B 段起单源读中间表），出参：id/title/artist_ids/albums(jsonb 含 artist_ids)/roles。
  // 装配前适配成 embed 形状（song_contributors / album_contributors），复用统一摘要装配
  const result = await pgRpc(env, 'get_artist_songs', { p_artist_id: id })
  if (!result) return jsonError(502, 'upstream error')
  const all = (result.data || []).map(r => ({
    ...r,
    song_contributors: (r.artist_ids || []).map(x => ({ role: 'singer', artist_id: x })),
    albums: r.albums
      ? { ...r.albums, album_contributors: (r.albums.artist_ids || []).map(x => ({ artist_id: x })) }
      : undefined,
  }))
  const summaries = await assembleSummaries(env, all)
  const pageRows = all.slice(offset, offset + limit)
  const pageSummaries = summaries.slice(offset, offset + limit)
  const items = pageRows.map((r, i) => ({
    ...pageSummaries[i],
    roles: (r.roles || []).filter(x => ['singer', 'lyricist', 'composer', 'arranger'].includes(x)),
  }))
  return jsonOk({ total: all.length, limit, offset, items }, TTL_LIST)
}

// ============ 入口 ============

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    const reqHost = url.hostname

    // api 域名下的文档路径（https://api.lrcshare.com/docs/，文档站入口）
    if (reqHost === `api.${SITE_DOMAIN}` && (url.pathname === '/docs' || url.pathname.startsWith('/docs/'))) {
      return proxyDocs(url, request)
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
      } else if (path === '/v1/catalog') {
        res = await handleCatalog(env)
      } else if (path === '/v1/songs') {
        res = await handleSongs(env, url)
      } else if (path === '/v1/albums') {
        res = await handleAlbums(env, url)
      } else if (path === '/v1/artists') {
        res = await handleArtists(env, url)
      } else {
        const m = path.match(/^\/v1\/song\/([^/]+)$/)
        const ml = path.match(/^\/v1\/lyric\/([^/]+)$/)
        const ma = path.match(/^\/v1\/album\/([^/]+)$/)
        const mar = path.match(/^\/v1\/artist\/([^/]+)$/)
        const mars = path.match(/^\/v1\/artist\/([^/]+)\/songs$/)
        if (m) res = await handleSong(env, decodeURIComponent(m[1]), url)
        else if (ml) res = await handleLyric(env, decodeURIComponent(ml[1]), url)
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
