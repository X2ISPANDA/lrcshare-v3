/**
 * lrcshare ttml-hub 同步 Worker（phase5 阶段 E）
 *
 * 每小时 Cron：manifest 304 短路 → revision 变化才拉索引做全量 diff：
 *   档1 平台 ID 交集 → 自动合并（挂 TTML 版本）
 *   档2 标题+歌手归一全等 → ttml_hub_pending（人工确认，D3 决策）
 *   档3 多候选 / Live·Remaster 降档 / 无命中 → pending；完全无同名才自动建白板歌
 *   ttml-hub 删除 → 跟随删版本 / 删白板歌（D4：仅删 ttml-hub 来源创建且无用户版本）
 *
 * 纪律：
 *   - service role 写库（bypass RLS）；anon 对 state/pending 两表零授权
 *   - 不取文本搜索第一候选（对齐 ttml-hub 接入指南）；dry-run 首跑只出队列不写库
 *   - 单歌失败跳过记日志，下轮重试；现有版本按 external_id + sha256 判断 unchanged（幂等）
 */

const BASE_DEFAULT = 'https://2755337087.github.io/ttml-hub/'
const PAGE = 1000

/** NFKC + 小写 + 删空白与分隔符（对齐 ttml-hub 接入指南的归一化） */
function norm(s) {
  return String(s || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s·・._\-–—'"`~（）()\[\]【】<>《》!！?？,，.。;；:：/\\|@#\$%\^&\*+=]/g, '')
}

/** Live/Remaster/伴奏等标记 → 强制降档 3（不自动合并/建歌） */
const LOW_QUALITY = /live|remaster|instrumental|inst\.|karaoke|cover|sped\s*up|slowed|reverb|伴奏|翻唱|纯音乐|演奏/i

/** 独立文字系统语言判定（与前端 detectLang 同规则集，供 langs 摘要） */
function detectLang(text) {
  const s = String(text || '').replace(/<\d+>/g, '')
  if (/[ぁ-んァ-ヶー]/.test(s)) return 'ja'
  if (/[가-힣]/.test(s)) return 'ko'
  if (/[\u0E00-\u0E7F]/.test(s)) return 'th'
  if (/[\u0E80-\u0EFF]/.test(s)) return 'lo'
  if (/[\u0F00-\u0FFF]/.test(s)) return 'bo'
  if (/[\u1800-\u18AF]/.test(s)) return 'mn'
  if (/[\u1000-\u109F]/.test(s)) return 'my'
  if (/[\u1780-\u17FF]/.test(s)) return 'km'
  if (/[\u0900-\u097F]/.test(s)) return 'hi'
  if (/[\u0600-\u06FF]/.test(s)) return 'ar'
  if (/[\u0590-\u05FF]/.test(s)) return 'he'
  if (/[\u0370-\u03FF]/.test(s)) return 'el'
  if (/[\u0400-\u04FF]/.test(s)) return 'ru'
  if (/[\u4E00-\u9FFF\u3400-\u4DBF]/.test(s)) return 'zh'
  if (/[A-Za-z\u00C0-\u024F]/.test(s)) return 'en'
  return null
}

function detectLangsFromTtml(xml) {
  const texts = []
  try {
    const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi
    let m
    while ((m = re.exec(xml))) texts.push(m[1].replace(/<[^>]+>/g, ''))
  } catch { /* 正则容错：提取不到就算了 */ }
  const langs = new Set()
  for (const t of texts) { const l = detectLang(t); if (l) langs.add(l) }
  return [...langs]
}

// ---------- Supabase REST（service role） ----------

function sbHeaders(env) {
  return {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  }
}

async function sbAll(env, table, select, extraQuery = '') {
  const out = []
  for (let from = 0; ; from += PAGE) {
    const url = `${env.SUPABASE_URL}/rest/v1/${table}?select=${select}${extraQuery}&limit=${PAGE}&offset=${from}`
    const res = await fetch(url, { headers: sbHeaders(env) })
    if (!res.ok) throw new Error(`${table} 拉取失败 ${res.status}: ${await res.text()}`)
    const rows = await res.json()
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

async function sbMutate(env, table, path, method, body, prefer) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}${path || ''}`, {
    method,
    headers: { ...sbHeaders(env), Prefer: prefer || 'return=minimal' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (!res.ok && res.status !== 404) throw new Error(`${table} ${method} ${res.status}: ${await res.text()}`)
  return res
}

// ---------- ttml-hub 拉取 ----------

async function sha256Hex(buf) {
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** 下载 TTML 并校验 sha256（不符返回 null，调用方跳过下轮重试） */
async function downloadTtml(base, hub) {
  const res = await fetch(new URL(hub.path, base).href)
  if (!res.ok) throw new Error(`TTML 下载 ${res.status}: ${hub.path}`)
  const buf = await res.arrayBuffer()
  const hex = await sha256Hex(buf)
  if (hub.sha256 && hex !== hub.sha256) throw new Error(`sha256 不符: ${hub.path}`)
  return { text: new TextDecoder().decode(buf), hash: hex }
}

// ---------- 匹配工具 ----------

/** sourceIds 扁平化（兼容 v1 单字符串 / v2 数组 / null） */
function sourceIdValues(v) {
  if (Array.isArray(v)) return v.filter(x => typeof x === 'string' && x)
  return typeof v === 'string' && v ? [v] : []
}

function idIntersect(ourSourceIds, hubSourceIds) {
  if (!ourSourceIds || typeof ourSourceIds !== 'object') return false
  for (const key of Object.keys(hubSourceIds || {})) {
    const ours = new Set(sourceIdValues(ourSourceIds[key]))
    for (const id of sourceIdValues(hubSourceIds[key])) if (ours.has(id)) return true
  }
  return false
}

const setEq = (a, b) => a.size === b.size && [...a].every(x => b.has(x))

// ---------- 主流程 ----------

export default {
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(sync(env).catch(e => console.error('[sync] 整轮失败:', e.message)))
  },
  /** 手动触发调试：curl "https://<worker>/__sync?token=<SYNC_TOKEN>"（SYNC_TOKEN 未设置则拒绝） */
  async fetch(req, env) {
    const url = new URL(req.url)
    if (url.pathname === '/__sync') {
      if (!env.SYNC_TOKEN || url.searchParams.get('token') !== env.SYNC_TOKEN) {
        return new Response('forbidden', { status: 403 })
      }
      try {
        await sync(env)
        return new Response('ok', { status: 200 })
      } catch (e) {
        // 调试期把异常直接返回，浏览器可见；稳定后可移除
        return new Response('sync failed: ' + (e.stack || e.message), { status: 500 })
      }
    }
    return new Response('not found', { status: 404 })
  },
}

/** 主流程（同时供 CF Worker 调度和 Node 脚本 scripts/run-ttml-sync.mjs 调用） */
export async function sync(env) {
  const base = env.TTML_HUB_BASE || BASE_DEFAULT
  const dryRun = String(env.DRY_RUN || '') === 'true'
  console.log(`[sync] 开始 dryRun=${dryRun}`)

  // 1. state（单行）
  const stateRes = await fetch(`${env.SUPABASE_URL}/rest/v1/ttml_hub_state?id=eq.singleton`, { headers: sbHeaders(env) })
  if (!stateRes.ok) throw new Error(`state 读取 ${stateRes.status}`)
  const stateRow = (await stateRes.json())[0] || {}
  const state = {
    revision: stateRow.revision || null,
    etag: stateRow.etag || null,
    snapshot: stateRow.snapshot || {},
  }

  // 2. manifest（ETag 304 短路）
  const mRes = await fetch(`${base}api/v1/manifest.json`, {
    headers: state.etag ? { 'If-None-Match': state.etag } : {},
  })
  if (mRes.status === 304) {
    await touchState(env, state.revision, state.etag)
    console.log('[sync] manifest 304，结束')
    return
  }
  if (!mRes.ok) throw new Error(`manifest ${mRes.status}`)
  const manifest = await mRes.json()
  const etag = mRes.headers.get('etag')
  if (manifest.revision && manifest.revision === state.revision) {
    await touchState(env, state.revision, etag)
    console.log('[sync] revision 未变，结束')
    return
  }

  // 3. 索引（校验 revision 一致 + indexSha256）
  // manifest.index 相对 manifest 自身所在目录解析（实测 index="songs.json" 位于 api/v1/ 下）
  const mUrl = new URL('api/v1/manifest.json', base)
  const indexUrl = new URL(manifest.index || 'songs.json', mUrl).href
  const iRes = await fetch(indexUrl)
  if (!iRes.ok) throw new Error(`索引 ${iRes.status}`)
  const indexBuf = await iRes.arrayBuffer()
  if (manifest.indexSha256 && (await sha256Hex(indexBuf)) !== manifest.indexSha256) {
    throw new Error('indexSha256 校验失败')
  }
  const index = JSON.parse(new TextDecoder().decode(indexBuf))
  if (index.revision !== manifest.revision) throw new Error('索引 revision 与 manifest 不一致')
  console.log(`[sync] 索引 revision=${index.revision} 歌词数=${index.songs.length}`)

  // 4. 载入库（songs / 歌手关联 / 艺术家 / 专辑 / 已有 ttml-hub 版本 / 待处理队列）
  const [ourSongs, singerRows, artistRows, albumRows, existingVersions, openPendings] = await Promise.all([
    sbAll(env, 'songs', 'id,title,source_ids,origin'),
    sbAll(env, 'song_contributors', 'song_id,artist_id', '&role=eq.singer'),
    sbAll(env, 'artists', 'id,name'),
    sbAll(env, 'albums', 'id,name'),
    sbAll(env, 'lyric_versions', 'id,song_id,external_id,content_hash', '&source=eq.ttml-hub'),
    sbAll(env, 'ttml_hub_pending', 'id,resolution'),
  ])
  const singersBySong = new Map()
  for (const r of singerRows) {
    if (!singersBySong.has(r.song_id)) singersBySong.set(r.song_id, new Set())
    singersBySong.get(r.song_id).add(r.artist_id)
  }
  const artistByNorm = new Map()
  for (const a of artistRows) artistByNorm.set(norm(a.name), a.id)
  const albumByNorm = new Map()
  for (const al of albumRows) if (!albumByNorm.has(norm(al.name))) albumByNorm.set(norm(al.name), al.id)
  const existingByHubId = new Map()
  for (const v of existingVersions) if (v.external_id) existingByHubId.set(v.external_id, v)
  const resolvedHubIds = new Set(openPendings.filter(p => p.resolution).map(p => p.id))

  // 5. 逐歌处理
  // 设计：CPU 匹配全量跑；下载/写库等昂贵操作受 SYNC_BUDGET 预算约束（免费版单次调用 50 子请求，
  // 扣除拉库分页等固定开销后默认 30）。预算用尽 → 本轮停止、不写 revision（下轮重新便宜地跑匹配续传，
  // 已导入版本靠 external_id + content_hash 幂等跳过）。
  // pending 批量入队（每 500 行一次 POST），dry-run 不写 revision/etag/snapshot（避免污染游标 bug）。
  const budget = { left: parseInt(env.SYNC_BUDGET || '30', 10) }
  const BUDGET_STOP = new Error('__BUDGET_STOP__')
  let merged = 0, created = 0, pended = 0, unchanged = 0, failed = 0
  const pendingRows = []
  const newSnapshot = {}
  for (const hub of index.songs || []) {
    newSnapshot[hub.id] = { p: hub.path, h: hub.sha256 }
    try {
      const action = await processSong(env, { dryRun, base, hub, ourSongs, singersBySong, artistByNorm, albumByNorm, existingByHubId, resolvedHubIds, budget, BUDGET_STOP, pendingRows })
      if (action === 'merged') merged++
      else if (action === 'created') created++
      else if (action === 'pending') pended++
      else unchanged++
    } catch (e) {
      if (e === BUDGET_STOP) {
        console.log(`[sync] 子请求预算用尽（剩余 ${index.songs.length - (unchanged + merged + created + pended + failed)} 首待下轮），revision 不落盘`)
        break
      }
      failed++
      console.error(`[sync] ${hub.id} ${hub.title} 处理失败:`, e.message)
    }
  }

  // pending 批量落盘（dry-run / 常态都入队，人工队列始终观察最新匹配结果）
  for (let i = 0; i < pendingRows.length; i += 500) {
    await sbMutate(env, 'ttml_hub_pending', '?on_conflict=id', 'POST',
      pendingRows.slice(i, i + 500), 'return=minimal,resolution=merge-duplicates')
  }

  // 6. 删除跟随（快照 diff：旧有新无；仅完整跑完才做）
  let removed = 0
  if (unchanged + merged + created + pended + failed === index.songs.length) {
    for (const [hubId] of Object.entries(state.snapshot)) {
      if (newSnapshot[hubId]) continue
      try {
        if (await followRemoval(env, dryRun, hubId)) removed++
      } catch (e) {
        console.error(`[sync] 删除跟随 ${hubId} 失败:`, e.message)
      }
    }
  }

  // 7. state 落盘（完整跑完才写 revision/etag/snapshot；dry-run 只更新 last_check）
  const now = new Date().toISOString()
  if (dryRun) {
    await sbMutate(env, 'ttml_hub_state', '?id=eq.singleton', 'PATCH', { last_check: now })
  } else if (unchanged + merged + created + pended + failed === index.songs.length) {
    await sbMutate(env, 'ttml_hub_state', '?id=eq.singleton', 'PATCH', {
      revision: manifest.revision,
      etag,
      last_check: now,
      last_sync: now,
      snapshot: newSnapshot,
    })
  } else {
    await sbMutate(env, 'ttml_hub_state', '?id=eq.singleton', 'PATCH', { last_check: now })
  }

  console.log(`[sync] 完成 dryRun=${dryRun} merged=${merged} created=${created} pending=${pended} unchanged=${unchanged} removed=${removed} failed=${failed} 待续=${index.songs.length - (unchanged + merged + created + pended + failed)}`)
}

async function touchState(env, revision, etag) {
  await sbMutate(env, 'ttml_hub_state', '?id=eq.singleton', 'PATCH', {
    revision: revision || undefined,
    etag: etag || undefined,
    last_check: new Date().toISOString(),
  })
}

/**
 * 单歌处理。
 * 返回 'merged' | 'created' | 'pending' | 'unchanged'
 * 需要昂贵操作（下载/写库）但预算不足时抛 BUDGET_STOP（由上层中断本轮）。
 * 注意：unchanged/文本匹配是纯 CPU，永远全量执行——保证断点续传的正确性。
 */
async function processSong(env, { dryRun, base, hub, ourSongs, singersBySong, artistByNorm, albumByNorm, existingByHubId, resolvedHubIds, budget, BUDGET_STOP, pendingRows }) {
  // 已导入：sha256 未变 → unchanged；变了 → 更新原文
  const prev = existingByHubId.get(hub.id)
  if (prev) {
    if (prev.content_hash === hub.sha256) return 'unchanged'
    if (dryRun) {
      console.log(`[sync] dry-run 检测到版本待更新 ${hub.id} → song ${prev.song_id}（不写库）`)
      return 'merged'
    }
    if (budget.left < 2) throw BUDGET_STOP
    const { text, hash } = await downloadTtml(base, hub)
    budget.left -= 1
    await sbMutate(env, 'lyric_versions', `?id=eq.${prev.id}`, 'PATCH', {
      ttml_text: text, content_hash: hash, langs: detectLangsFromTtml(text),
    })
    budget.left -= 1
    console.log(`[sync] 版本更新 ${hub.id} → song ${prev.song_id}`)
    return 'merged'
  }

  // ── 档1：平台 ID 交集 → 自动合并（Live/Remaster 强制降档）──
  const idHit = !LOW_QUALITY.test(hub.title || '')
    ? ourSongs.find(s => idIntersect(s.source_ids, hub.sourceIds))
    : null
  if (idHit) {
    if (dryRun) {
      collectPending(pendingRows, hub, resolvedHubIds, 'low_confidence', { hit_song_id: idHit.id, hit_method: 'platform_id' })
      return 'pending'
    }
    if (budget.left < 2) throw BUDGET_STOP
    await attachVersion(env, base, hub, idHit.id)
    budget.left -= 2
    console.log(`[sync] 档1 平台ID合并 ${hub.id} → song ${idHit.id}`)
    return 'merged'
  }

  // ── 档2/档3：文本匹配 ──
  const tn = norm(hub.title)
  const hubArtists = new Set((hub.artists || []).map(norm))
  const sameTitle = ourSongs.filter(s => norm(s.title) === tn)
  const exact = !LOW_QUALITY.test(hub.title || '')
    ? sameTitle.find(s => setEq(singersBySong.get(s.id) || new Set(), hubArtists))
    : null

  if (exact) {
    // 档2：标题+歌手全等 → 人工确认（D3：不自动合并）
    collectPending(pendingRows, hub, resolvedHubIds, 'low_confidence', { hit_song_id: exact.id, hit_method: 'title_artists' })
    return 'pending'
  }
  if (sameTitle.length) {
    // 档3 多候选：同名歌存在但不全等 → 人工
    collectPending(pendingRows, hub, resolvedHubIds, 'multi_candidate', { candidate_song_ids: sameTitle.map(s => s.id) })
    return 'pending'
  }

  // ── 无任何同名候选：dry-run 出队观察；常态自动建白板歌 ──
  if (dryRun) {
    collectPending(pendingRows, hub, resolvedHubIds, 'low_confidence', { hit_method: 'none' })
    return 'pending'
  }
  if (budget.left < 8) throw BUDGET_STOP // 白板 ≈ 建歌1+歌手n+专辑1+关联2+下载1+版本1
  const songId = await createWhitelistSong(env, hub, artistByNorm, albumByNorm)
  await attachVersion(env, base, hub, songId)
  budget.left -= 8
  console.log(`[sync] 白板歌 ${hub.title} → song ${songId}`)
  return 'created'
}

/** 待匹配队列入队（收集到批量缓冲，轮末统一落盘；已人工处理过的 id 跳过） */
function collectPending(pendingRows, hub, resolvedHubIds, reason, candidates) {
  if (resolvedHubIds.has(hub.id)) return
  pendingRows.push({
    id: hub.id,
    title: hub.title,
    artists: hub.artists || [],
    album: hub.album || null,
    source_ids: hub.sourceIds || {},
    path: hub.path,
    sha256: hub.sha256 || null,
    reason,
    candidates: candidates || null,
  })
}

/** 挂 TTML 版本（确定性 id = lv_ + hubId，ignore-duplicates 幂等） */
async function attachVersion(env, base, hub, songId) {
  const { text, hash } = await downloadTtml(base, hub)
  await sbMutate(env, 'lyric_versions', '', 'POST', {
    id: 'lv_' + hub.id,
    song_id: songId,
    format: 'ttml',
    source: 'ttml-hub',
    external_id: hub.id,
    content_hash: hash,
    ttml_text: text,
    langs: detectLangsFromTtml(text),
    status: 'published',
    is_primary: false,
    contributor_id: null,
    source_credit: null,
  }, 'return=minimal,resolution=ignore-duplicates')
}

/** 白板歌：song + 歌手 artists/song_contributors + 专辑 albums/album_contributors */
async function createWhitelistSong(env, hub, artistByNorm, albumByNorm) {
  const genId = prefix => prefix + Date.now() + Math.floor(Math.random() * 1000)

  // 歌手：归一复用，无则建
  const artistIds = []
  for (const name of hub.artists || []) {
    const key = norm(name)
    let id = artistByNorm.get(key)
    if (!id) {
      id = 'art_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      await sbMutate(env, 'artists', '', 'POST', {
        id, name, types: ['singer'], is_show: true, sort: 0, avatar: '', bio: '', aliases: [], disambiguation: '',
      })
      artistByNorm.set(key, id)
    }
    artistIds.push(id)
  }

  // 专辑：归一复用，无则建（白板专辑，无年份封面）
  let albumId = hub.album ? albumByNorm.get(norm(hub.album)) : null
  if (!albumId && hub.album) {
    albumId = genId('al')
    await sbMutate(env, 'albums', '', 'POST', {
      id: albumId, name: hub.album, year: null, cover: '', description: null,
    })
    albumByNorm.set(norm(hub.album), albumId)
  }
  if (albumId && artistIds.length) {
    await sbMutate(env, 'album_contributors', '', 'POST',
      artistIds.map(artist_id => ({ album_id: albumId, artist_id })))
  }

  // 歌本体（白板：无封面无歌词，状态正常进搜索）
  const songId = genId('s')
  await sbMutate(env, 'songs', '', 'POST', {
    id: songId,
    title: hub.title,
    album_id: albumId || null,
    duration: '',
    track: null,
    lrc_text: null,
    cover: '',
    video_url: null,
    status: 'published',
    contributor_id: null,
    genres: [],
    source_ids: hub.sourceIds || {},
    origin: 'ttml-hub',
  })
  if (artistIds.length) {
    await sbMutate(env, 'song_contributors', '', 'POST',
      artistIds.map(artist_id => ({ song_id: songId, artist_id, role: 'singer' })))
  }
  return songId
}

/** 删除跟随（4.3）：他删我们跟。返回是否发生删除 */
async function followRemoval(env, dryRun, hubId) {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/lyric_versions?source=eq.ttml-hub&external_id=eq.${hubId}&select=id,song_id`, { headers: sbHeaders(env) })
  if (!res.ok) throw new Error(`版本查询 ${res.status}`)
  const versions = await res.json()
  if (!versions.length) return false

  if (dryRun) {
    console.log(`[sync] dry-run 删除跟随跳过 ${hubId}`)
    return false
  }
  for (const v of versions) {
    // 歌的其他版本（任何来源）
    const othersRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/lyric_versions?song_id=eq.${v.song_id}&id=neq.${v.id}&select=id&limit=1`,
      { headers: sbHeaders(env) })
    if (!othersRes.ok) throw new Error(`其他版本查询 ${othersRes.status}`)
    const others = await othersRes.json()
    if (others.length === 0) {
      // 无其他版本：仅当歌本体由 ttml-hub 创建才删歌（D4）
      const songRes = await fetch(`${env.SUPABASE_URL}/rest/v1/songs?id=eq.${v.song_id}&select=origin`, { headers: sbHeaders(env) })
      const song = (await songRes.json())[0]
      if (song && song.origin === 'ttml-hub') {
        await sbMutate(env, 'songs', `?id=eq.${v.song_id}`, 'DELETE')
        console.log(`[sync] 删除白板歌 ${v.song_id}（ttml-hub 已删 ${hubId}）`)
      } else {
        await sbMutate(env, 'lyric_versions', `?id=eq.${v.id}`, 'DELETE')
        console.log(`[sync] 删除版本 ${v.id}`)
      }
    } else {
      await sbMutate(env, 'lyric_versions', `?id=eq.${v.id}`, 'DELETE')
      console.log(`[sync] 删除版本 ${v.id}（歌有其他版本）`)
    }
  }
  return true
}
