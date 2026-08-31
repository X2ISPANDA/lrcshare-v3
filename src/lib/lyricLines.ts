import { supabase } from './supabase'
import { TTMLParser, type TTMLResult, type Syllable } from '@applemusic-like-lyrics/ttml'

/**
 * 多语言歌词行表（song_lyric_lines）前端工具。
 *
 * 对齐 cloudflare/open-api.js 的合成语义与 sql/phase4-lyric-p1.md 的拆行规则：
 * - 行表 text 存「相对行首偏移」的词标签 `<偏移毫秒>`（纯数字），元数据行（[ti:] 等）time_ms=null 存完整原文。
 * - 单语言 LRC 文本 ↔ 行数组 互转（版本管理用）；多版本合成 LRC / TTML 供写回 lrc_text 用。
 */

export type LyricKind = 'original' | 'translation' | 'romanization'

export interface LyricRow {
  seq: number
  time_ms: number | null
  end_ms: number | null
  text: string
}

/** DB 行（song_lyric_lines 原始行，含 lang/kind） */
export interface LyricLineRow extends LyricRow {
  lang: string
  kind: LyricKind
}

export interface LyricVersion {
  lang: string
  kind: LyricKind
  rows: LyricRow[]
}

export const LYRIC_LANG_OPTIONS = [
  // 常用在前
  'zh', 'en', 'ja', 'yue', 'ko', 'zh-Hant',
  // 拉丁字母语言（自动检测统一判 en，需手动选）
  'fr', 'de', 'es', 'it', 'pt', 'vi', 'id', 'ms', 'tr', 'nl', 'pl',
  // 独立文字系统（可自动检测）
  'ru', 'th', 'ar', 'hi', 'he', 'el', 'bo', 'mn', 'my', 'km', 'lo',
  // 特殊
  'en-US',
]

/** 语言码 → 中文名（界面展示用，用户友好） */
export const LYRIC_LANG_LABELS: Record<string, string> = {
  zh: '中文',
  'zh-Hant': '繁体中文',
  ja: '日语',
  ko: '韩语',
  en: '英语',
  yue: '粤语',
  fr: '法语',
  de: '德语',
  es: '西班牙语',
  it: '意大利语',
  pt: '葡萄牙语',
  vi: '越南语',
  id: '印尼语',
  ms: '马来语',
  tr: '土耳其语',
  nl: '荷兰语',
  pl: '波兰语',
  ru: '俄语',
  th: '泰语',
  ar: '阿拉伯语',
  hi: '印地语',
  he: '希伯来语',
  el: '希腊语',
  bo: '藏语',
  mn: '蒙语',
  my: '缅甸语',
  km: '高棉语',
  lo: '老挝语',
  'en-US': '英语（美）',
}

/** 语言码 → 界面展示文本（有中文名则「中文（zh）」，否则原码） */
export function langLabel(code: string): string {
  return LYRIC_LANG_LABELS[code] ? `${LYRIC_LANG_LABELS[code]}（${code}）` : code
}

export const LYRIC_KIND_LABEL: Record<LyricKind, string> = {
  original: '原文',
  translation: '译文',
  romanization: '罗马音',
}

/** 毫秒 → mm:ss.xxx（三位毫秒不舍入，与 Worker 一致） */
export function formatLyricTime(ms: number | null): string {
  if (ms == null) return ''
  const mm = Math.floor(ms / 60000)
  const ss = Math.floor((ms % 60000) / 1000)
  const xxx = ms % 1000
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(xxx).padStart(3, '0')}`
}

/** 解析时间戳标签 [mm:ss.xx|xxx] → 毫秒 */
function parseTs(ts: string): number {
  const m = ts.match(/^(\d{1,3}):(\d{2})[.:](\d{2,3})$/)
  if (!m) return 0
  const mm = parseInt(m[1], 10)
  const ss = parseInt(m[2], 10)
  const frac = m[3]
  const msPart = frac.length === 2 ? parseInt(frac, 10) * 10 : parseInt(frac, 10)
  return mm * 60000 + ss * 1000 + msPart
}

/** 输入态词标签 <mm:ss.xx 绝对时间> → <偏移毫秒 相对行首>（无标签原样返回） */
function convertWordTagsToOffset(text: string, lineMs: number): string {
  if (!/<\d{1,3}:\d{2}[.:]\d{2,3}>/.test(text)) return text
  return text.replace(/<(\d{1,3}:\d{2}[.:]\d{2,3})>/g, (_m, abs: string) => {
    const off = parseTs(abs) - lineMs
    return `<${off}>`
  })
}

/** 剥词标签（<偏移毫秒> → 只留文本） */
export function stripWordTags(text: string): string {
  return String(text || '').replace(/<\d{1,6}>/g, '')
}

/** 元数据行 key（[ti:xxx] → ti；非元数据 → ''） */
function metaKeyOf(text: string): string {
  const m = String(text).match(/^\[([A-Za-z][A-Za-z0-9]*):/)
  return m ? m[1].toLowerCase() : ''
}

/**
 * 单语言 LRC 文本 → 行数组（元数据行 time_ms=null；时间戳行展开多时间戳、词标签转相对偏移）。
 * 仅做「单语言」解析，不做语言判定 / 同戳拆分（版本管理里 lang/kind 已由用户显式指定）。
 */
export function parseLrcToRows(lrc: string): LyricRow[] {
  const rawLines = String(lrc || '').split(/\r?\n/)
  const meta: LyricRow[] = []
  const timed: { time_ms: number; end_ms: number | null; text: string }[] = []

  for (const raw of rawLines) {
    const line = raw.trim()
    if (!line) continue

    // 元数据行 [key:value]
    if (/^\[[A-Za-z][A-Za-z0-9]*:.*\]$/.test(line)) {
      meta.push({ seq: 0, time_ms: null, end_ms: null, text: line })
      continue
    }

    // 时间戳行 [t]text 或 [t1][t2]text
    const tsMatch = line.match(/^((?:\[\d{1,3}:\d{2}[.:]\d{2,3}\])+)(.*)$/)
    if (tsMatch) {
      const tsText = tsMatch[1]
      const body = tsMatch[2]
      // verbatim（纯方括号逐字）：剥行首连续时间戳后 body 仍含 [mm:ss.xx] → N+1 时间戳的逐字格式。
      // 前 N 个 [t] = 词开始（第 1 个 = 行时间），最后 1 个 [t]（后无词）= 行尾 → end_ms。
      if (/\[\d{1,3}:\d{2}[.:]\d{2,3}\]/.test(body)) {
        const first = tsText.match(/\[(\d{1,3}:\d{2}[.:]\d{2,3})\]/)
        const firstTs = first ? parseTs(first[1]) : 0
        const parts = body.split(/\[(\d{1,3}:\d{2}[.:]\d{2,3})\]/)
        let text = ''
        let offset = 0
        let endMs: number | null = null
        for (let i = 0; i < parts.length; i++) {
          if (i % 2 === 0) {
            // 偶数索引 = 词文本
            if (parts[i]) text += offset === 0 ? parts[i] : `<${offset}>${parts[i]}`
          } else {
            // 奇数索引 = 时间戳；后面紧跟空串 = 行尾（存 end_ms），否则 = 下一词开始
            const isEnd = i + 1 < parts.length && parts[i + 1] === ''
            if (isEnd) endMs = parseTs(parts[i])
            else offset = parseTs(parts[i]) - firstTs
          }
        }
        timed.push({ time_ms: firstTs, end_ms: endMs, text })
      } else {
        for (const m of tsText.matchAll(/\[(\d{1,3}:\d{2}[.:]\d{2,3})\]/g)) {
          const timeMs = parseTs(m[1])
          timed.push({ time_ms: timeMs, end_ms: null, text: convertWordTagsToOffset(body, timeMs) })
        }
      }
    }
    // 裸行（无时间戳非元数据）：跳过（版本管理里用户应自己补时间戳；不静默入库）
  }

  // seq 分配：元数据行在前（key 序 ti/ar/al/by/其他），时间戳行按 time_ms 升序
  const keyRank = (k: string) => ({ ti: 0, ar: 1, al: 2, by: 3 } as Record<string, number>)[k] ?? 4
  meta.sort((a, b) => keyRank(metaKeyOf(a.text)) - keyRank(metaKeyOf(b.text)))
  timed.sort((a, b) => a.time_ms - b.time_ms)

  const rows: LyricRow[] = [
    ...meta.map((m, i) => ({ seq: i + 1, time_ms: null, end_ms: null, text: m.text })),
    ...timed.map((t, i) => ({ seq: meta.length + i + 1, time_ms: t.time_ms, end_ms: t.end_ms, text: t.text })),
  ]
  return rows
}

/** 行数组 → 单语言 LRC 文本（format=line 剥词标签 / enhanced / verbatim 还原绝对时间词标签） */
export function rowsToLrcText(rows: LyricRow[], format: 'line' | 'enhanced' | 'verbatim' = 'line'): string {
  const meta: string[] = []
  const timed: LyricRow[] = []
  for (const r of rows) {
    if (r.time_ms == null) meta.push(r.text)
    else timed.push(r)
  }
  timed.sort((a, b) => (a.time_ms! - b.time_ms!) || (a.seq - b.seq))
  const head = meta.join('\n')
  const body = timed.map(r => {
    if (format === 'verbatim') return composeVerbatimText(r.text, r.time_ms!, r.end_ms)
    const text = format === 'enhanced' ? composeEnhancedText(r.text, r.time_ms!, r.end_ms) : stripWordTags(r.text)
    return `[${formatLyricTime(r.time_ms)}]${text}`
  }).join('\n')
  return head ? `${head}\n${body}` : body
}

/** 词标签相对偏移 → 绝对时间（enhanced）：<偏移毫秒> → <mm:ss.xxx绝对>，首个词补行时间；endMs 非空补行尾 */
function composeEnhancedText(text: string, timeMs: number, endMs?: number | null): string {
  const s = String(text || '')
  if (!/<\d{1,6}>/.test(s)) return s
  const converted = s.replace(/<(\d{1,6})>/g, (_m, off: string) => `<${formatLyricTime(timeMs + Number(off))}>`)
  let out = `<${formatLyricTime(timeMs)}>${converted}`
  if (endMs != null) out += `<${formatLyricTime(endMs)}>`
  return out
}

/** 词标签相对偏移 → 绝对时间（verbatim）：每词前补 [mm:ss.xxx绝对]，无独立行首；endMs 非空补行尾 [end] */
function composeVerbatimText(text: string, timeMs: number, endMs?: number | null): string {
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

/** 行表 → versions（每个 (lang,kind) 一个版本，rows 按 seq 排） */
export function groupVersions(rows: LyricLineRow[]): LyricVersion[] {
  const map = new Map<string, LyricVersion>()
  for (const r of rows) {
    const key = `${r.lang}|${r.kind}`
    let v = map.get(key)
    if (!v) { v = { lang: r.lang, kind: r.kind, rows: [] }; map.set(key, v) }
    v.rows.push({ seq: r.seq, time_ms: r.time_ms, end_ms: r.end_ms, text: r.text })
  }
  for (const v of map.values()) v.rows.sort((a, b) => a.seq - b.seq)
  return [...map.values()]
}

/** 补齐公共行（对齐 Worker fillCommonRows）：非 original 版本补齐 original 中该版本没有对应
 *  time_ms 的行（语气词/间奏等公共行），译文版本完整可独立渲染。不修改入参。 */
export function fillCommonRows(versions: LyricVersion[]): LyricVersion[] {
  const original = versions.find(v => v.kind === 'original')
  if (!original) return versions
  return versions.map(v => {
    if (v.kind === 'original') return v
    const vTimeSet = new Set(v.rows.map(r => r.time_ms).filter(t => t != null))
    const fill = original.rows
      .filter(r => r.time_ms != null && !vTimeSet.has(r.time_ms))
      .map(r => ({ ...r }))
    if (!fill.length) return v
    const rows = [...v.rows, ...fill].sort((a, b) => {
      if (a.time_ms == null || b.time_ms == null) return a.time_ms == null ? -1 : b.time_ms == null ? 1 : 0
      return a.time_ms !== b.time_ms ? a.time_ms - b.time_ms : a.seq - b.seq
    })
    return { ...v, rows }
  })
}

/** 行表是否含词级时间（<偏移毫秒> 词标签）——无则 enhanced/verbatim 无从渲染 */
export function rowsHaveWordTags(rows: Pick<LyricRow, 'text'>[]): boolean {
  return rows.some(r => /<\d{1,6}>/.test(String(r.text || '')))
}

/** 多版本合成 LRC（元数据头部去重 + 全部版本歌词合并稳定排序 + 格式化），供写回 lrc_text */
export function composeMixedLrc(versions: LyricVersion[], format: 'line' | 'enhanced' | 'verbatim' = 'line'): string {
  const meta: string[] = []
  const timed: { time_ms: number; end_ms: number | null; kind: LyricKind; lang: string; text: string }[] = []
  for (const v of versions) {
    for (const r of v.rows) {
      if (r.time_ms == null) { meta.push(r.text); continue }
      timed.push({ time_ms: r.time_ms, end_ms: r.end_ms, kind: v.kind, lang: v.lang, text: r.text })
    }
  }
  timed.sort((a, b) => {
    if (a.time_ms !== b.time_ms) return a.time_ms - b.time_ms
    const rank = (k: LyricKind) => (k === 'original' ? 0 : k === 'translation' ? 1 : 2)
    return rank(a.kind) - rank(b.kind) || a.lang.localeCompare(b.lang)
  })
  const body = timed.map(l => {
    if (format === 'verbatim') return composeVerbatimText(l.text, l.time_ms, l.end_ms)
    const text = format === 'enhanced' ? composeEnhancedText(l.text, l.time_ms, l.end_ms) : stripWordTags(l.text)
    return `[${formatLyricTime(l.time_ms)}]${text}`
  }).join('\n')
  const head = dedupeMeta(meta).join('\n')
  return head ? `${head}\n${body}` : body
}

/** 元数据行去重 + key 序（ti/ar/al/by/其他） */
function dedupeMeta(metaLines: string[]): string[] {
  const keyRank: Record<string, number> = { ti: 0, ar: 1, al: 2, by: 3 }
  const seen = new Set<string>()
  return [...metaLines]
    .sort((a, b) => (keyRank[metaKeyOf(a)] ?? 4) - (keyRank[metaKeyOf(b)] ?? 4))
    .filter(line => {
      const key = metaKeyOf(line)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
}

// ---------- TTML（P2-3-3：解析 + 生成） ----------

function escapeXml(s: string): string {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] as string))
}

function formatTtmlTime(ms: number): string {
  const hh = Math.floor(ms / 3600000)
  const mm = Math.floor((ms % 3600000) / 60000)
  const ss = Math.floor((ms % 60000) / 1000)
  const xxx = ms % 1000
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}.${String(xxx).padStart(3, '0')}`
}

/** 多版本 → TTML（多语言轨道按 lang 分 div，词级 span） */
export function versionsToTtml(versions: LyricVersion[], credit?: string): string {
  const divs: string[] = []
  for (const v of versions) {
    const timed = v.rows.filter(r => r.time_ms != null).sort((a, b) => a.time_ms! - b.time_ms!)
    const ps: string[] = []
    for (let i = 0; i < timed.length; i++) {
      const line = timed[i]
      const pBegin = line.time_ms!
      const pEnd = line.end_ms != null
        ? line.end_ms
        : (i + 1 < timed.length ? timed[i + 1].time_ms! : pBegin + 3000)
      const words = parseWordTags(line.text)
      const spans = words.map((w, wi) => {
        const wBegin = pBegin + w.offset_ms
        const wEnd = wi + 1 < words.length ? pBegin + words[wi + 1].offset_ms : pEnd
        return `<span begin="${formatTtmlTime(wBegin)}" end="${formatTtmlTime(wEnd)}">${escapeXml(w.text)}</span>`
      }).join('')
      ps.push(`<p begin="${formatTtmlTime(pBegin)}" end="${formatTtmlTime(pEnd)}">${spans}</p>`)
    }
    divs.push(`<div xml:lang="${escapeXml(v.lang)}">${ps.join('')}</div>`)
  }
  const creditP = credit ? `<div><p begin="06:59:19.999" end="06:59:20.999">${escapeXml(credit)}</p></div>` : ''
  return `<tt xmlns="http://www.w3.org/ns/ttml"><body>${divs.join('')}${creditP}</body></tt>`
}

/** 解析 text 词标签 → [{text, offset_ms}]；无标签则整行一个词 */
function parseWordTags(text: string): { text: string; offset_ms: number }[] {
  const s = String(text || '')
  const tokens = s.split(/<(\d{1,6})>/)
  const words: { text: string; offset_ms: number }[] = []
  let offset = 0
  for (let i = 0; i < tokens.length; i++) {
    if (i % 2 === 0) {
      if (tokens[i]) words.push({ text: tokens[i], offset_ms: offset })
    } else {
      offset = Number(tokens[i])
    }
  }
  if (!words.length) words.push({ text: s, offset_ms: 0 })
  return words
}

/**
 * TTML XML → 单语言行数组（p → 行；span 词绝对时间 − p begin = 相对偏移）。
 * 只支持 clock-time HH:MM:SS.mmm，遇非 clock-time 返回空数组（由调用方提示）。
 */
export function parseTtmlToRows(xml: string): LyricRow[] {
  const result = parseTtmlWithAmll(xml)
  if (!result) return []
  const rows = result.lines
    .filter(l => l.text.trim())
    .map(l => ({
      seq: 0,
      time_ms: l.startTime,
      end_ms: l.endTime,
      text: l.words?.length ? syllablesToText(l.words, l.startTime) : l.text,
    }))
  return finalizeTtmlRows(rows)
}

/** 逐字音节 → text（词标签 <偏移毫秒>；endsWithSpace 补空格） */
function syllablesToText(words: Syllable[], lineStart: number): string {
  return words.map(w => {
    const wordText = w.endsWithSpace ? w.text + ' ' : w.text
    const off = w.startTime - lineStart
    return off === 0 ? wordText : `<${off}>${wordText}`
  }).join('')
}

/** 调 AMLL 官方库解析 TTML（浏览器环境；SSG/Node 无 DOMParser 返回 null） */
function parseTtmlWithAmll(xml: string): TTMLResult | null {
  if (typeof DOMParser === 'undefined') return null
  try {
    return TTMLParser.parse(String(xml || ''))
  } catch {
    return null
  }
}

/** 排序 + 分配 seq */
function finalizeTtmlRows(rows: LyricRow[]): LyricRow[] {
  rows.sort((a, b) => a.time_ms! - b.time_ms!)
  return rows.map((r, i) => ({ ...r, seq: i + 1 }))
}

/**
 * TTML → 多语言版本数组（每个 (lang, kind) 一个版本，与行表 LyricVersion 同构）。
 * 官方库解析：original = 主歌词行；translation/romanization = 行内翻译/音译（含 sidecar），按语言分组。
 */
export function parseTtmlVersions(xml: string): LyricVersion[] {
  const result = parseTtmlWithAmll(xml)
  if (!result) return []
  const rootLang = result.metadata.language || 'und'

  const versions: LyricVersion[] = []

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
  const transMap = new Map<string, LyricRow[]>()
  const romanMap = new Map<string, LyricRow[]>()
  for (const l of result.lines) {
    for (const t of l.translations || []) {
      const lang = t.language || rootLang
      const rows = transMap.get(lang) || []
      rows.push({ seq: 0, time_ms: l.startTime, end_ms: l.endTime, text: t.words?.length ? syllablesToText(t.words, l.startTime) : t.text })
      transMap.set(lang, rows)
    }
    for (const r of l.romanizations || []) {
      const lang = r.language || rootLang
      const rows = romanMap.get(lang) || []
      rows.push({ seq: 0, time_ms: l.startTime, end_ms: l.endTime, text: r.words?.length ? syllablesToText(r.words, l.startTime) : r.text })
      romanMap.set(lang, rows)
    }
  }
  for (const [lang, rows] of transMap) versions.push({ lang, kind: 'translation', rows: finalizeTtmlRows(rows) })
  for (const [lang, rows] of romanMap) versions.push({ lang, kind: 'romanization', rows: finalizeTtmlRows(rows) })

  return versions
}

// ---------- TTML 结构化渲染（phase5 阶段 F：对唱/和声/语言 渐进增强） ----------

/** TTML 单行渲染结构 */
export interface TtmlRenderLine {
  begin: number | null
  /** ttm:agent 声部 id（v1/v2…，无对唱为 null） */
  agent: string | null
  /** 主行文本（已剔除 x-bg 和声） */
  text: string
  /** x-bg 和声行（bg 歌词，可能多段） */
  bg: string[]
  /** 行语言（继承 div/p 的 xml:lang） */
  lang: string | null
  /** 行类型：original（正文）/ translation（<translation>）/ romanization（<transliteration>） */
  kind: LyricKind
}

/** TTML 结构化解析结果 */
export interface TtmlStructure {
  lines: TtmlRenderLine[]
  /** 声部定义（xml:id → type），来自 <ttm:agent> 元数据 */
  agentMeta: Record<string, string | null>
  /** 行是否带声部（决定左右分列渲染） */
  hasAgent: boolean
  /** 是否有词级时间 */
  hasWordTiming: boolean
  /** 是否有注音（ruby / ttm:role="x-ruby"） */
  hasRuby: boolean
}

/**
 * TTML → 结构化渲染模型（保留对唱/和声/语言；不要求 clock-time，
 * begin 解析失败仅置 null 不丢弃行——渲染场景容错优先）。
 * 与 parseTtmlToRows（严格拆行表）不同：本函数为展示服务，解析不出就降级纯文本行。
 */
export function parseTtmlStructure(xml: string): TtmlStructure {
  const empty: TtmlStructure = { lines: [], agentMeta: {}, hasAgent: false, hasWordTiming: false, hasRuby: false }
  // SSG 构建期（Node）无 DOMParser：返回空结构，内容由客户端水合后重新解析
  if (typeof DOMParser === 'undefined') return empty
  let result: TTMLResult
  try {
    result = TTMLParser.parse(String(xml || ''))
  } catch {
    return empty
  }

  const rootLang = result.metadata.language || null

  // 声部定义（xml:id → type）
  const agentMeta: Record<string, string | null> = {}
  for (const [id, agent] of Object.entries(result.metadata.agents || {})) {
    agentMeta[id] = agent.type || null
  }

  const lines: TtmlRenderLine[] = []
  let hasAgent = false
  let hasWordTiming = false
  let hasRuby = false

  for (const l of result.lines) {
    if (l.agentId) hasAgent = true
    if (l.words?.length) hasWordTiming = true
    if (l.words?.some(w => w.ruby?.length)) hasRuby = true

    // 和声（backgroundVocal）
    const bg: string[] = []
    if (l.backgroundVocal) {
      const bgText = (l.backgroundVocal.text || '').trim()
      if (bgText) bg.push(bgText)
    }

    // original 行
    lines.push({ begin: l.startTime, agent: l.agentId || null, text: l.text, bg, lang: rootLang, kind: 'original' })

    // 翻译 / 音译（作为随行）
    for (const t of l.translations || []) {
      lines.push({ begin: l.startTime, agent: null, text: t.text, bg: [], lang: t.language || null, kind: 'translation' })
    }
    for (const r of l.romanizations || []) {
      lines.push({ begin: l.startTime, agent: null, text: r.text, bg: [], lang: r.language || null, kind: 'romanization' })
    }
  }

  return { lines, agentMeta, hasAgent, hasWordTiming, hasRuby }
}

/** 从 TTML 原文提取语言集合（供入库 langs 摘要） */
export function detectTtmlLangs(xml: string): string[] {
  const { lines } = parseTtmlStructure(xml)
  const langs = new Set<string>()
  for (const l of lines) {
    const k = l.lang || detectLang(l.text)
    if (k && k !== 'unknown') langs.add(k)
  }
  return [...langs]
}

// ---------- 歌词版本元数据（lyric_versions 直读，前端渲染用） ----------

export interface LyricVersionMeta {
  id: string
  song_id: string
  format: 'lrc' | 'enhanced' | 'ttml'
  source: string
  source_credit: string | null
  is_primary: boolean
  langs: string[]
  ttml_text?: string | null
}

/** 格式展示排序权重：TTML > 逐字 > 行级（D2 tab 排序规则的一环） */
const FORMAT_RANK: Record<string, number> = { ttml: 0, enhanced: 1, lrc: 2 }

/** 读一首歌的已发布歌词版本（默认按 D2 规则排序：is_primary > 格式 > 创建时间） */
export async function loadLyricVersionMetas(songId: string, withTtml = false): Promise<LyricVersionMeta[]> {
  const cols = `id,song_id,format,source,source_credit,is_primary,langs${withTtml ? ',ttml_text' : ''}`
  const { data, error } = await supabase
    .from('lyric_versions')
    .select(cols)
    .eq('song_id', songId)
    .eq('status', 'published')
  if (error) throw error
  const rows = (data || []) as unknown as LyricVersionMeta[]
  return rows.sort((a, b) => {
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1
    const fr = (FORMAT_RANK[a.format] ?? 9) - (FORMAT_RANK[b.format] ?? 9)
    return fr
  })
}

/** 单行语言判定（独立文字系统逐一匹配，拉丁文字统一判 en 不细分 en/fr/罗马音，由用户手动改）：
 *  假名→ja / 谚文→ko / 泰文→th / 老挝文→lo / 藏文→bo / 蒙文→mn / 缅甸文→my / 高棉文→km /
 *  天城文→hi / 阿拉伯文→ar / 希伯来文→he / 希腊文→el / 西里尔→ru / 汉字→zh / 拉丁→en / 其他→unknown */
export function detectLang(text: string): string {
  const s = stripWordTags(text)
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
  if (/[一-龥]/.test(s)) return 'zh'
  if (/[A-Za-z]/.test(s)) return 'en'
  return 'unknown'
}

/**
 * 双语/多语言混排 LRC → 多语言版本（前端版 rebuild，对齐 sql/phase4-lyric-nlang.md 的拆行语义）：
 * - primary_lang = 时间戳行语言众数（unknown 不参与）
 * - 歌级结构判定：先剔除「非歌词行」（空行清屏点 / 纯符号行如 :-) / 词·曲·编等创作者信息行），
 *   再统计「同戳 ≥2 个真歌词行」的组占比，≥ 50% 即翻译歌。
 *   翻译歌歌词主体严格成对（原文+译文同戳）占比 →100%；注解堆叠只在歌头占比 →0%，
 *   单一阈值即可区分，且不依赖语言检测（粤→普、法→英 同文字系统靠「成对」识别）。
 *   - 翻译歌：组内真歌词行按行序拆，第 1 行 original，第 2~N 行 translation（同语言组也拆，
 *     如 Hello→Hello、粤→普，语言标注由用户手动修正）
 *   - 非翻译歌：多行组视为注解堆叠，全归 original
 * - 非歌词行（空/符号/创作者信息）不参与判定与拆分，恒为 original
 * - 单行（非同戳）→ original(primary)；元数据行归 primary 的 original
 */
export function splitLrcToVersions(lrc: string): LyricVersion[] {
  const rows = parseLrcToRows(lrc)
  const meta = rows.filter(r => r.time_ms == null)
  const timed = rows.filter(r => r.time_ms != null)

  if (!timed.length) {
    // 无时间戳行：全部归 original，lang 用元数据或 und
    return [{ lang: 'und', kind: 'original', rows }]
  }

  // primary_lang 众数
  const counts: Record<string, number> = {}
  for (const r of timed) {
    const l = detectLang(r.text)
    if (l === 'unknown') continue
    counts[l] = (counts[l] || 0) + 1
  }
  let primary = 'und'
  let best = -1
  for (const [l, c] of Object.entries(counts)) {
    if (c > best) { best = c; primary = l }
  }

  // 同戳分组（保留文件行序）
  const byTs = new Map<number, LyricRow[]>()
  for (const r of timed) {
    const e = byTs.get(r.time_ms!) || []
    e.push(r)
    byTs.set(r.time_ms!, e)
  }

  // 非歌词行识别：空行（清屏点）、纯符号行（间奏表情符）、创作者信息行（词/曲/编等前奏署名）
  // —— 三者都从「翻译歌判定」里剔除（避免污染成对占比）；但拆分时只有空行/符号恒归原文，
  //    创作者信息在翻译歌里按行序拆（译文的 Lyrics By 等跟着译文版本走）
  const isEmptyRow = (r: LyricRow) => !stripWordTags(r.text).trim()
  const isSymbolRow = (r: LyricRow) => {
    const s = stripWordTags(r.text).trim()
    return s !== '' && detectLang(s) === 'unknown' // 无任何文字系统的纯符号（:-) ? 等）
  }
  const CREDIT_PREFIX = /^(作词|作詞|词|詞|作曲|曲|编曲|編曲|演唱|歌手|混音|混声|制作人|製作人|制作|製作|监制|監製|和声|和聲|吉他|结他|鼓|贝斯|貝斯|贝司|键盘|鍵盤|录音|錄音|母带|母帶|后期|後期|字幕|翻译|翻譯|校对|校對|时间轴|時間軸|歌词|歌詞|LRC|Lyrics?|Composer|Composed|Music|Arranger|Arranged|Mixed|Mixing|Mastering|Mastered|Produced|Producer|Video|VSQ|Song|Art|feat\.?|by)\s*[:：]/i
  const isCreditRow = (r: LyricRow) => CREDIT_PREFIX.test(stripWordTags(r.text).trim())
  const isNonLyricRow = (r: LyricRow) => isEmptyRow(r) || isSymbolRow(r) || isCreditRow(r)

  // 歌级结构判定：剔除空行/纯符号/创作者信息后，统计「同戳 ≥2 个真歌词行」的组占比。
  // 翻译歌歌词主体严格成对（原文+译文同戳），占比 →100%；注解堆叠只出现在歌头，占比 →0%。
  // 单一阈值 50%，不依赖语言检测（粤/普、法/英 同文字系统靠「成对」识别）
  let totalGroups = 0
  let multiGroups = 0
  for (const g of byTs.values()) {
    const lyric = g.filter(r => !isNonLyricRow(r))
    if (lyric.length === 0) continue
    totalGroups++
    if (lyric.length >= 2) multiGroups++
  }
  const isTranslationSong = totalGroups > 0 && multiGroups / totalGroups >= 0.5

  // 逐行分配 lang/kind
  const assigned = timed.map(r => {
    const g = byTs.get(r.time_ms!)!
    // 空行/纯符号（清屏点/间奏表情符）：恒归原文，无翻译概念
    if (isEmptyRow(r) || isSymbolRow(r)) {
      return { lang: primary, kind: 'original' as LyricKind }
    }
    // 非翻译歌 → 归原文（含创作者信息、注解堆叠、角色标注）
    if (!isTranslationSong) {
      return { lang: primary, kind: 'original' as LyricKind }
    }
    // 翻译歌：组内非空非符号行按行序拆（第 1 行原文，其余译文）。
    // 创作者信息（作词/Lyrics By）也按行序走——译文的创作者信息跟着译文版本，不被归原文
    const parts = g.filter(x => !isEmptyRow(x) && !isSymbolRow(x))
    if (parts.length < 2) {
      return { lang: primary, kind: 'original' as LyricKind }
    }
    const pos = parts.findIndex(x => x.seq === r.seq) + 1
    const l = detectLang(r.text)
    const lang = l === 'unknown' ? primary : l
    return pos === 1
      ? { lang, kind: 'original' as LyricKind }
      : { lang, kind: 'translation' as LyricKind }
  })

  // 组装 versions（按 lang+kind 分组，元数据行归 primary original）
  const map = new Map<string, LyricVersion>()
  const ensure = (lang: string, kind: LyricKind) => {
    const key = `${lang}|${kind}`
    let v = map.get(key)
    if (!v) { v = { lang, kind, rows: [] }; map.set(key, v) }
    return v
  }
  for (const m of meta) ensure(primary, 'original').rows.push(m)
  assigned.forEach((a, i) => ensure(a.lang, a.kind).rows.push(timed[i]))

  const versions = [...map.values()]
  for (const v of versions) {
    // 版本内：元数据行在前，时间戳行按 time_ms 升序，重编 seq
    const vm = v.rows.filter(r => r.time_ms == null)
    const vt = v.rows.filter(r => r.time_ms != null).sort((a, b) => a.time_ms! - b.time_ms!)
    v.rows = [...vm, ...vt].map((r, i) => ({ ...r, seq: i + 1 }))
  }
  return versions
}

// ---------- 数据操作 ----------

/** 读一首歌的歌词行表 */
export async function loadLyricLines(songId: string): Promise<LyricLineRow[]> {
  const { data, error } = await supabase
    .from('song_lyric_lines')
    .select('lang,kind,seq,time_ms,end_ms,text')
    .eq('song_id', songId)
    .order('seq', { ascending: true })
  if (error) throw error
  return (data || []) as LyricLineRow[]
}

/** 解析一首歌的默认行版本（lyric_versions 的 lrc/enhanced 用户版本；发布/编辑场景由触发器或 rebuild 保证存在） */
export async function resolveDefaultLinesVersionId(songId: string): Promise<string> {
  const { data, error } = await supabase
    .from('lyric_versions')
    .select('id')
    .eq('song_id', songId)
    .in('format', ['lrc', 'enhanced'])
    .order('is_primary', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) throw error
  if (!data?.length) throw new Error(`歌曲 ${songId} 无 lrc/enhanced 歌词版本（lrc_text 为空？）`)
  return data[0].id
}

/** 全量替换一个歌词版本的行表（默认 = 该歌 lrc/enhanced 用户版本；先 DELETE 再 INSERT，幂等） */
export async function saveLyricLines(songId: string, versions: LyricVersion[], versionId?: string): Promise<void> {
  const vid = versionId || await resolveDefaultLinesVersionId(songId)
  await supabase.from('song_lyric_lines').delete().eq('version_id', vid)
  const rows: any[] = []
  for (const v of versions) {
    const timed = v.rows.filter(r => r.time_ms != null)
    const meta = v.rows.filter(r => r.time_ms == null)
    const all = [...meta, ...timed]
    all.forEach((r, i) => {
      rows.push({ version_id: vid, song_id: songId, lang: v.lang, kind: v.kind, seq: i + 1, time_ms: r.time_ms, end_ms: r.end_ms, text: r.text })
    })
  }
  if (rows.length) {
    const { error } = await supabase.from('song_lyric_lines').insert(rows)
    if (error) throw error
  }
  // langs 摘要维护：行表变化后同步刷新该版本的语言摘要
  const langs = [...new Set(versions.map(v => v.lang).filter(Boolean))]
  const { error: langsErr } = await supabase.from('lyric_versions').update({ langs }).eq('id', vid)
  if (langsErr) throw langsErr
}

/** 调用 SQL 拆行函数重拆一首歌（编辑 lrc_text 整体改动后用，SECURITY DEFINER 仅 authenticated） */
export async function rebuildLyricLines(songId: string): Promise<void> {
  const { error } = await supabase.rpc('rebuild_song_lyric_lines', { p_song_id: songId })
  if (error) throw error
}
