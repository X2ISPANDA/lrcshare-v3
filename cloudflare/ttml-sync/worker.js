/**
 * lrcshare ttml-hub 同步 Worker（phase5 阶段 E · 完全剥离模式）
 *
 * 每小时 Cron：manifest 304 短路 → revision 变化才拉索引做全量 diff：
 *   - 已导入版本（external_id 命中）：sha256 未变 → unchanged；变了 → 更新原文（同步唯一的自动写库）
 *   - 其余一律入 ttml_hub_pending 待确认队列（平台ID/同名命中仅作候选提示），
 *     绝不自动合并、绝不自动建歌——主站只展示用户经后台确认引入的内容
 *     （后台「挂到歌」= 合并、「新建展示」= 建歌，均在 TtmlHubView 人工触发）
 *   - ttml-hub 删除 → 跟随删版本 / 删 ttml-hub 来源的白板歌（D4）
 *
 * 纪律：
 *   - service role 写库（bypass RLS）；anon 对 state/pending 两表零授权
 *   - dry-run 连版本更新也跳过，只观察队列与删除跟随
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

/** TTML xml:lang（BCP47）→ 站内语言码（与前端 ttmlLangToLrc 对齐） */
function normTtmlLang(raw) {
  const v = String(raw || '').replace(/^xml:/, '').trim()
  if (!v) return null
  const lower = v.toLowerCase()
  if (lower === 'zh-hans' || lower === 'zh-hans-cn') return 'zh'
  if (/^zh-hant/.test(lower)) return 'zh-Hant'
  if (lower === 'ja-latn') return 'en' // 日语音译轨，站内按拉丁系 en 归类
  const base = v.split('-')[0]
  return base || null
}

/** 从 TTML 提取语言集合（与前端 detectTtmlLangs 同规则，Worker 无 DOMParser 走正则）。
 *  整体判定：根 xml:lang 优先 → 翻译/音译轨标注 → 全无标注时正文行众数；
 *  零星外语 punchline / x-bg 和声不产生独立语言标签。 */
function detectLangsFromTtml(xml) {
  const text = String(xml || '')
  const langs = new Set()
  try {
    // 主体：<tt>/<body> 根 xml:lang（tt 在 body 前，取第一个匹配）
    const rootM = /<(?:tt|body)\b[^>]*?\bxml:lang\s*=\s*["']([^"']+)["']/i.exec(text)
    const rootLang = rootM ? normTtmlLang(rootM[1]) : null
    if (rootLang) langs.add(rootLang)
    // 译文/音译轨：站内侧车标签 + div 级 xml:lang（与主体不同者）
    const trRe = /<(?:translation|transliteration)\b[^>]*?\bxml:lang\s*=\s*["']([^"']+)["']/gi
    let tm
    while ((tm = trRe.exec(text))) { const k = normTtmlLang(tm[1]); if (k) langs.add(k) }
    const divRe = /<div\b[^>]*?\bxml:lang\s*=\s*["']([^"']+)["']/gi
    while ((tm = divRe.exec(text))) { const k = normTtmlLang(tm[1]); if (k && k !== rootLang) langs.add(k) }
    // 全无标注 → 正文行众数（x-bg 和声 span 先剔除）
    if (!langs.size) {
      const counts = new Map()
      const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi
      let m
      while ((m = pRe.exec(text))) {
        const plain = m[1]
          .replace(/<span\b[^>]*\bttm:role\s*=\s*["']x-bg["'][^>]*>[\s\S]*?<\/span>(?:\s*<\/span>)?/gi, '')
          .replace(/<[^>]+>/g, '')
        if (!plain.trim()) continue
        const l = detectLang(plain)
        if (l) counts.set(l, (counts.get(l) || 0) + 1)
      }
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
      if (top) langs.add(top[0])
    }
  } catch { /* 正则容错：提取不到就返回已收集到的 */ }
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

  // 4. 载入库（songs / 歌手关联 / 艺术家 / 已有 ttml-hub 版本 / 待处理队列）——只读，不写任何实体表
  const [ourSongs, singerRows, artistRows, existingVersions, openPendings] = await Promise.all([
    sbAll(env, 'songs', 'id,title,source_ids,origin'),
    sbAll(env, 'song_contributors', 'song_id,artist_id', '&role=eq.singer'),
    sbAll(env, 'artists', 'id,name'),
    sbAll(env, 'lyric_versions', 'id,song_id,external_id,content_hash', '&source=eq.ttml-hub'),
    sbAll(env, 'ttml_hub_pending', 'id,resolution'),
  ])
  const singersBySong = new Map()
  for (const r of singerRows) {
    if (!singersBySong.has(r.song_id)) singersBySong.set(r.song_id, new Set())
    singersBySong.get(r.song_id).add(r.artist_id)
  }
  // artist_id → 归一化名字（档2 比较：库侧歌手 ID 集合需转成名字再和 hub 歌手名比对）
  const artistNormsById = new Map(artistRows.map(a => [a.id, norm(a.name)]))
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
  let merged = 0, pended = 0, unchanged = 0, failed = 0
  const pendingRows = []
  const newSnapshot = {}
  for (const hub of index.songs || []) {
    newSnapshot[hub.id] = { p: hub.path, h: hub.sha256 }
    try {
      const action = await processSong(env, { dryRun, base, hub, ourSongs, singersBySong, artistNormsById, existingByHubId, resolvedHubIds, budget, BUDGET_STOP, pendingRows })
      if (action === 'merged') merged++
      else if (action === 'pending') pended++
      else unchanged++
    } catch (e) {
      if (e === BUDGET_STOP) {
        console.log(`[sync] 子请求预算用尽（剩余 ${index.songs.length - (unchanged + merged + pended + failed)} 首待下轮），revision 不落盘`)
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
  if (unchanged + merged + pended + failed === index.songs.length) {
    for (const [hubId] of Object.entries(state.snapshot)) {
      if (newSnapshot[hubId]) continue
      try {
        if (await followRemoval(env, dryRun, hubId)) removed++
      } catch (e) {
        console.error(`[sync] 删除跟随 ${hubId} 失败:`, e.message)
      }
    }
  }

  // 7. state 落盘（完整跑完且零失败才写 revision/etag/snapshot——failed 的歌若标记 revision
  //    会被后续 304 短路挡住永远补不上；dry-run 只更新 last_check）
  const now = new Date().toISOString()
  if (dryRun) {
    await sbMutate(env, 'ttml_hub_state', '?id=eq.singleton', 'PATCH', { last_check: now })
  } else if (unchanged + merged + pended + failed === index.songs.length && failed === 0) {
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

  console.log(`[sync] 完成 dryRun=${dryRun} merged=${merged} pending=${pended} unchanged=${unchanged} removed=${removed} failed=${failed} 待续=${index.songs.length - (unchanged + merged + pended + failed)}`)
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
 * 返回 'merged'（版本原文更新）| 'pending' | 'unchanged'
 * 需要昂贵操作（下载/写库）但预算不足时抛 BUDGET_STOP（由上层中断本轮）。
 * 注意：unchanged/文本匹配是纯 CPU，永远全量执行——保证断点续传的正确性。
 * 剥离原则：除「已导入版本的原文更新」外，任何情况都不写实体表，命中信息只作队列候选提示。
 */
async function processSong(env, { dryRun, base, hub, ourSongs, singersBySong, artistNormsById, existingByHubId, resolvedHubIds, budget, BUDGET_STOP, pendingRows }) {
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

  // ── 未导入 → 一律入待确认队列（人工「挂到歌」或「新建展示」）──
  // 平台 ID 命中（Live/Remaster 降档：命中也不作候选提示）
  const idHit = !LOW_QUALITY.test(hub.title || '')
    ? ourSongs.find(s => idIntersect(s.source_ids, hub.sourceIds))
    : null
  if (idHit) {
    collectPending(pendingRows, hub, resolvedHubIds, 'low_confidence', { hit_song_id: idHit.id, hit_method: 'platform_id' })
    return 'pending'
  }

  // 文本匹配：档2 标题+歌手归一全等 / 档3 同名多候选 / 无命中
  const tn = norm(hub.title)
  const hubArtists = new Set((hub.artists || []).map(norm))
  const sameTitle = ourSongs.filter(s => norm(s.title) === tn)
  const exact = !LOW_QUALITY.test(hub.title || '')
    ? sameTitle.find(s => {
        const ours = new Set([...(singersBySong.get(s.id) || [])].map(id => artistNormsById.get(id)).filter(Boolean))
        return setEq(ours, hubArtists)
      })
    : null

  if (exact) {
    collectPending(pendingRows, hub, resolvedHubIds, 'low_confidence', { hit_song_id: exact.id, hit_method: 'title_artists' })
    return 'pending'
  }
  if (sameTitle.length) {
    collectPending(pendingRows, hub, resolvedHubIds, 'multi_candidate', { candidate_song_ids: sameTitle.map(s => s.id) })
    return 'pending'
  }
  collectPending(pendingRows, hub, resolvedHubIds, 'low_confidence', { hit_method: 'none' })
  return 'pending'
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
