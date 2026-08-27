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
 * - 缓存：详情 1h / 列表搜索 10min（Cache API，GET 才缓存）；另有 zone 级 Cache Rule
 *   让 JSON 进 CDN 缓存（命中不进 Worker，不消耗请求额度）、WAF 速率限制拦单 IP 洪峰
 * - 目录快照 /v1/catalog：全库可搜索文本，供调用方本地负向预过滤（批量工具省无效请求）
 * - 子域治理：通配符 Route（*.lrcshare.com/*）接住任意子域。未知子域返回 HTML
 *   404 页；灰云（仅 DNS）子域不进 CF 网络，不受影响
 * - 文档站：https://api.lrcshare.com/docs/（VitePress base=/docs/，Worker 剥掉
 *   /docs 前缀反代 Pages 源站，源站内容仍在根路径）
 */

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
    // 复用库端 search_songs RPC（title + aliases 数组模糊匹配）
    const result = await pgRpc(env, 'search_songs', { p_q: keyword, select: SONG_SUMMARY_SELECT, limit: String(limit), offset: String(offset) })
    if (!result) return jsonError(502, 'upstream error')
    const items = await assembleSummaries(env, result.data || [])
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
  const params = { select: SONG_SUMMARY_SELECT, limit: String(limit), offset: String(offset) }
  if (title) params.p_title = title
  if (artist) params.p_artist = artist
  const result = await pgRpc(env, 'search_songs_structured', params)
  if (!result) return jsonError(502, 'upstream error')
  const items = await assembleSummaries(env, result.data || [])
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

async function handleSong(env, id) {
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
  const [artistNames, albumArtistNames, contributorNames] = await Promise.all([
    getArtistNameMap(env, artistIds),
    row.albums ? getArtistNameMap(env, albumArtistIdsOf(row.albums)) : Promise.resolve(new Map()),
    row.contributor_id ? getContributorNameMap(env, [row.contributor_id]) : Promise.resolve(new Map()),
  ])
  const idsToNames = ids => ids.map(x => artistNames.get(x)).filter(Boolean)
  return jsonOk(
    {
      ...mapSongDetailBase(row, artistNames, albumArtistNames, contributorNames.get(row.contributor_id) || null),
      lyricist: idsToNames(creditIds.lyricist),
      composer: idsToNames(creditIds.composer),
      arranger: idsToNames(creditIds.arranger),
    },
    TTL_DETAIL,
  )
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
    lrc: row.lrc_text ? `${row.lrc_text.replace(/\s+$/, '')}\n${credit}` : null,
  }
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
