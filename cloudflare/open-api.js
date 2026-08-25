/**
 * LrcShare 开放 API 网关（Cloudflare Worker）
 * 部署：CF Dashboard → Workers → 新建 → 粘贴本文件 → 绑定 api.lrcshare.com
 * 环境变量（Worker Settings → Variables）：
 *   SUPABASE_URL       形如 https://spb-xxx.supabase.opentrust.net（不带尾斜杠）
 *   SUPABASE_ANON_KEY  anon key（仅 anon，service_role 禁止配置）
 *
 * 设计要点：
 * - 回源只用 anon key：数据库层 RLS + 列级收权是第二道防线
 * - 只暴露定义好的端点与字段，内部表结构不出门
 * - 隐藏歌曲（is_hidden）不过滤：网站隐藏逻辑仅作用于前台，API 全量开放
 * - 署名链路：song.comment 与 LRC 末尾统一追加「本歌词来自于:贡献者名@lrcshare.com」
 * - 缓存：详情 1h / 列表搜索 10min（Cache API，GET 才缓存）
 */

// ============ 常量 ============

const SITE_DOMAIN = 'lrcshare.com'
const SONG_DETAIL_SELECT =
  'id,title,aliases,artist_ids,album_id,lyricist,composer,arranger,duration,track,disc,genres,video_url,cover,contributor_id,created_at,albums(name,year,cover)'
const SONG_LIST_SELECT = SONG_DETAIL_SELECT
const SONG_LYRIC_SELECT = 'id,title,lrc_text,lyrics_text,contributor_id'
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

/** 组装对外 song 对象 */
function mapSong(row, artistNames, contributorNames) {
  const contributor = contributorNames.get(row.contributor_id) || null
  const album = row.albums
    ? { id: row.album_id || null, name: row.albums.name || '', year: row.albums.year || null, cover: row.albums.cover || null }
    : null
  return {
    id: row.id,
    title: row.title,
    aliases: row.aliases || [],
    artists: (row.artist_ids || []).map(id => ({ id, name: artistNames.get(id) || '' })).filter(a => a.name),
    album,
    duration: row.duration || null,
    track: row.track ?? null,
    disc: row.disc ?? null,
    genres: row.genres || [],
    lyricist: idsToNames(row.lyricist, artistNames),
    composer: idsToNames(row.composer, artistNames),
    arranger: idsToNames(row.arranger, artistNames),
    cover: row.cover || album?.cover || null,
    contributor,
    comment: contributor ? `本歌词来自于:${contributor}@${SITE_DOMAIN}` : `本歌词来自于:${SITE_DOMAIN}`,
    video_url: row.video_url || null,
    created_at: row.created_at || null,
  }
}

/** 歌曲集合统一装配：批量查艺术家/贡献者名再映射 */
async function assembleSongs(env, rows) {
  if (!rows || rows.length === 0) return []
  const artistIds = []
  for (const r of rows) {
    artistIds.push(...(r.artist_ids || []))
    for (const k of ['lyricist', 'composer', 'arranger']) {
      if (r[k]) artistIds.push(...String(r[k]).split(',').map(s => s.trim()))
    }
  }
  const [artistNames, contributorNames] = await Promise.all([
    getArtistNameMap(env, artistIds),
    getContributorNameMap(env, rows.map(r => r.contributor_id).filter(Boolean)),
  ])
  return rows.map(r => mapSong(r, artistNames, contributorNames))
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
    homepage: `https://v3.${SITE_DOMAIN}`,
    docs: `https://doc.${SITE_DOMAIN}`,
    endpoints: {
      search: '/v1/search?keyword=&type=song|album|artist|lyric',
      songs: '/v1/songs?limit=&offset=',
      song: '/v1/song/:id',
      lyric: '/v1/song/:id/lyric',
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
    const qs = new URLSearchParams({ p_q: keyword, select: SONG_LIST_SELECT, limit: String(limit), offset: String(offset) })
    const res = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/search_songs?${qs}`, {
      headers: { apikey: env.SUPABASE_ANON_KEY, Authorization: `Bearer ${env.SUPABASE_ANON_KEY}` },
    })
    if (!res.ok) return jsonError(502, 'upstream error')
    const rows = await res.json()
    const songs = await assembleSongs(env, rows || [])
    return jsonOk({ keyword, type, total: null, items: songs }, TTL_LIST)
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
    { select: SONG_LIST_SELECT, status: 'eq.published', or, order: 'created_at.desc' },
    { limit, offset },
  )
  if (!result) return jsonError(502, 'upstream error')
  const songs = await assembleSongs(env, result.data)
  return jsonOk({ keyword, type, total: result.total, items: songs }, TTL_LIST)
}

// ---------- 歌曲 ----------

async function handleSongs(env, url) {
  const { limit, offset } = parsePage(url)
  const result = await pgList(env, 'songs', { select: SONG_LIST_SELECT, status: 'eq.published', order: 'created_at.desc' }, { limit, offset })
  if (!result) return jsonError(502, 'upstream error')
  const songs = await assembleSongs(env, result.data)
  return jsonOk({ total: result.total, limit, offset, items: songs }, TTL_LIST)
}

async function handleSong(env, id) {
  const row = await pgOne(env, 'songs', SONG_DETAIL_SELECT, { id: `eq.${id}`, status: 'eq.published' })
  if (!row) return jsonError(404, 'song not found')
  const [song] = await assembleSongs(env, [row])
  return jsonOk(song, TTL_DETAIL)
}

async function handleLyric(env, id) {
  const row = await pgOne(env, 'songs', SONG_LYRIC_SELECT, { id: `eq.${id}`, status: 'eq.published' })
  if (!row) return jsonError(404, 'song not found')
  let contributorName = null
  if (row.contributor_id) {
    const cmap = await getContributorNameMap(env, [row.contributor_id])
    contributorName = cmap.get(row.contributor_id) || null
  }
  const credit = contributorName ? `本歌词来自于:${contributorName}@${SITE_DOMAIN}` : `本歌词来自于:${SITE_DOMAIN}`
  const lrc = row.lrc_text ? `${row.lrc_text.replace(/\s+$/, '')}\n${credit}` : null
  return jsonOk({ id: row.id, title: row.title, lrc, text: row.lyrics_text || null, comment: credit }, TTL_DETAIL)
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
    { select: SONG_DETAIL_SELECT, album_id: `eq.${id}`, status: 'eq.published', order: 'disc.asc.nullslast,track.asc.nullslast' },
    { limit: 500, offset: 0 },
  )
  const trackRows = (songsRes && songsRes.data) || []
  const songArtistNames = await getArtistNameMap(env, trackRows.flatMap(r => r.artist_ids || []))
  const contributorNames = await getContributorNameMap(env, trackRows.map(r => r.contributor_id).filter(Boolean))
  return jsonOk(
    {
      ...mapAlbum(row, artistNames),
      songs: trackRows.map(r => mapSong(r, songArtistNames, contributorNames)),
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
    { select: SONG_LIST_SELECT, status: 'eq.published', or, order: 'created_at.desc' },
    { limit, offset },
  )
  if (!result) return jsonError(502, 'upstream error')
  const songs = await assembleSongs(env, result.data)
  // 每首标注该艺术家的实际角色
  const items = result.data.map((r, i) => {
    const roles = []
    if ((r.artist_ids || []).includes(id)) roles.push('singer')
    for (const [k, role] of [['lyricist', 'lyricist'], ['composer', 'composer'], ['arranger', 'arranger']]) {
      if (r[k] && String(r[k]).split(',').map(s => s.trim()).includes(id)) roles.push(role)
    }
    return { ...songs[i], roles }
  })
  return jsonOk({ total: result.total, limit, offset, items }, TTL_LIST)
}

// ============ 入口 ============

export default {
  async fetch(request, env, ctx) {
    // CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders() })
    }
    if (request.method !== 'GET') {
      return jsonError(405, 'method not allowed, GET only')
    }

    const url = new URL(request.url)
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
        const ml = path.match(/^\/v1\/song\/([^/]+)\/lyric$/)
        const ma = path.match(/^\/v1\/album\/([^/]+)$/)
        const mar = path.match(/^\/v1\/artist\/([^/]+)$/)
        const mars = path.match(/^\/v1\/artist\/([^/]+)\/songs$/)
        if (ml) res = await handleLyric(env, decodeURIComponent(ml[1]))
        else if (m) res = await handleSong(env, decodeURIComponent(m[1]))
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
