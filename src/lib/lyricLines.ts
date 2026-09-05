import { supabase } from './supabase'
import { TTMLParser, type TTMLResult, type Syllable } from '@applemusic-like-lyrics/ttml'
// 语言码规则与两个 Worker 共用单一来源（规则变更只改 shared/lang.mjs）
import { normalizeTtmlLang, detectLang as detectLangCore, lrcLangToTtml as lrcLangToTtmlCore } from '../../cloudflare/shared/lang.mjs'

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
  /** 所属版本容器（lyric_versions.id）；老数据/直查场景可能为空 */
  version_id?: string | null
}

export interface LyricVersion {
  lang: string
  kind: LyricKind
  rows: LyricRow[]
}

export const LYRIC_LANG_OPTIONS = [
  // 常用在前
  'zh', 'en', 'ja', 'ko', 'zh-Hant',
  // 拉丁字母语言（自动检测统一判 en，需手动选）
  'fr', 'de', 'es', 'it', 'pt', 'vi', 'id', 'ms', 'tr', 'nl', 'pl',
  // 独立文字系统（可自动检测）
  'ru', 'th', 'ar', 'hi', 'he', 'el', 'bo', 'mn', 'my', 'km', 'lo',
  // 特殊
  'en-US',
]
// 注：粤语(yue)/繁中港台(zh-Hant-HK/TW)已统一并入 zh-Hant（下游播放器按 Apple 标准粗标签精确匹配，
// 细分标签会 miss；yue 正文在 Apple 生态即标 zh-Hant，粤语身份由 Cantopop 曲风与粤拼音译轨承载）。
// 旧码标签保留在 LYRIC_LANG_LABELS 仅作存量数据友好显示，不再出现在下拉。

/** 音译轨专用语言选项（BCP47 拉丁化方案，跟随 Apple Music TTML 标注；自然语言码不出现在此列） */
export const TRANSLIT_LANG_OPTIONS = ['zh-Latn-pinyin', 'zh-Latn-jyutping', 'ja-Latn', 'ko-Latn']

/** 语言码 → 中文名（界面展示用，用户友好） */
export const LYRIC_LANG_LABELS: Record<string, string> = {
  zh: '简体中文',
  'zh-Hant': '繁体中文',
  'zh-Hant-HK': '繁体中文（香港）',
  'zh-Hant-TW': '繁体中文（台湾）',
  ja: '日语',
  ko: '韩语',
  en: '英语',
  yue: '粤语',
  // 音译轨 BCP47 拉丁化标签（romanization 版本 lang 原样使用，不折叠站内码）
  'zh-Latn-pinyin': '拼音（普通话罗马音）',
  'zh-Latn-jyutping': '粤拼（粤语罗马音）',
  'ja-Latn': '日语罗马音',
  'ko-Latn': '韩语罗马音',
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

/** 语言码 → 界面展示文本（有中文名则「简体中文（zh）」，否则原码） */
export function langLabel(code: string): string {
  return LYRIC_LANG_LABELS[code] ? `${LYRIC_LANG_LABELS[code]}（${code}）` : code
}

/** 音译轨 lang 纠错：上游 TTML 把自然语言码错标在 <transliteration> 上时（如 yue/ja/ko），
 *  映射到 BCP47 拉丁化标准标签；已是 *-Latn-* 标准方案或未知自定义值（如 ru-Latn）原样保留。
 *  zh-Hant 不自动纠（粤拼/拼音有歧义），留给用户在编辑器手选。 */
const TRANSLIT_LANG_FIX: Record<string, string> = {
  yue: 'zh-Latn-jyutping',
  zh: 'zh-Latn-pinyin', 'zh-hans': 'zh-Latn-pinyin', 'zh-cn': 'zh-Latn-pinyin', 'zh-sg': 'zh-Latn-pinyin',
  ja: 'ja-Latn', ko: 'ko-Latn',
}
export function fixTranslitLang(lang: string | null | undefined): string {
  if (!lang) return 'und'
  if (/Latn/i.test(lang)) return lang
  return TRANSLIT_LANG_FIX[lang.toLowerCase()] || lang
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
          let text = convertWordTagsToOffset(body, timeMs)
          // 归一化存量脏数据：行首连续 <0>（旧 bug 写入的重复行时间）收缩为 1 个
          text = text.replace(/^(<0>)+/, '<0>')
          // A2 规范：行尾无正文的词标签 = 行结束时间 → 还原 end_ms 并剥离（往返无损，避免双 end 标签）
          let endMs: number | null = null
          const trail = text.match(/<(\d{1,6})>$/)
          if (trail) {
            endMs = timeMs + Number(trail[1])
            text = text.slice(0, -trail[0].length)
          }
          timed.push({ time_ms: timeMs, end_ms: endMs, text })
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

/** 正则字面量转义（时间标签字符串进 RegExp 用） */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 词标签相对偏移 → 绝对时间（enhanced）：<偏移毫秒> → <mm:ss.xxx绝对>，首个词补行时间；endMs 非空补行尾 */
function composeEnhancedText(text: string, timeMs: number, endMs?: number | null): string {
  const s = String(text || '')
  if (!/<\d{1,6}>/.test(s)) return s
  const converted = s.replace(/<(\d{1,6})>/g, (_m, off: string) => `<${formatLyricTime(timeMs + Number(off))}>`)
  // 首词绝对时间=行首时不重复前置行时间标签（往返幂等，避免 [t]<t><t>… 叠加）
  const firstTag = converted.match(/^<(\d{1,3}:\d{2}[.:]\d{2,3})>/)
  const noDupHead = firstTag && parseTs(firstTag[1]) === timeMs
  // 尾随标签已是行结束时间时不重复追加（往返幂等，避免 …<end><end> 叠加）
  const endTag = endMs != null ? `<${formatLyricTime(endMs)}>` : ''
  const appendEnd = !!endTag && !converted.endsWith(endTag)
  const headTag = `<${formatLyricTime(timeMs)}>`
  let out = noDupHead ? converted : `${headTag}${converted}`
  if (appendEnd) out += endTag
  // 收缩存量重复（旧数据自愈）：行首连续相同的行时间标签、行尾连续相同的 end 标签各只留 1 个
  out = out.replace(new RegExp(`^(?:${escapeRe(headTag)})+`), headTag)
  if (endTag) out = out.replace(new RegExp(`(?:${escapeRe(endTag)})+$`), endTag)
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

// ---------- 复制投稿查重（前 3 句行开始时间戳毫秒级比对） ----------

/** 取版本组前 n 个【不同】的行开始时间（time_ms 升序）；不足 n 行返回 null（宁漏勿冤）。
 *  歌词正文跨来源天然相同，但毫秒级时间戳不可能手打撞车——前 3 句全同即照抄时间轴。 */
export function headStartTimes(version: LyricVersion, n = 3): number[] | null {
  const times = [...new Set(
    version.rows.filter(r => r.time_ms != null).map(r => r.time_ms as number),
  )].sort((a, b) => a - b)
  return times.length >= n ? times.slice(0, n) : null
}

/** 查重用的已有版本单元：展示标签 + 该版本的全部（语言,类型）组 */
export interface ExistingLyricVersion {
  label: string
  groups: LyricVersion[]
}

/** 查重命中结果 */
export interface DuplicateHit {
  /** 命中的已有版本展示标签 */
  label: string
  /** true=投稿带了与命中版本不同/新增的译文（「更好的翻译」场景，放行）；false=确认照抄，拦截 */
  hasTranslationDelta: boolean
}

/** 语言码归一化（去地区后缀：zh-Hans/zh-CN → zh，en-US → en），供译文增量比对 */
function normLyricLang(lang: string): string {
  return String(lang || 'und').split('-')[0] || 'und'
}

/** 译文/罗马音组指纹：key=`kind:语言` → 前 3 句去词标签文本（按时间升序、同戳去重） */
function translationFingerprints(groups: LyricVersion[]): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const g of groups) {
    if (g.kind === 'original') continue
    const texts = [...new Map(
      g.rows
        .filter(r => r.time_ms != null && stripWordTags(r.text).trim())
        .map(r => [r.time_ms as number, stripWordTags(r.text).trim()] as const),
    ).entries()]
      .sort((a, b) => a[0] - b[0])
      .slice(0, 3)
      .map(([, t]) => t)
    if (texts.length) map.set(`${g.kind}:${normLyricLang(g.lang)}`, texts)
  }
  return map
}

/** 投稿译文相对命中版本是否有增量：新增译文语言/类型，或同语言前 3 句译文完全不同（更好的翻译） */
function hasTranslationDelta(subGroups: LyricVersion[], hitGroups: LyricVersion[]): boolean {
  const sub = translationFingerprints(subGroups)
  if (!sub.size) return false
  const hit = translationFingerprints(hitGroups)
  for (const [key, texts] of sub) {
    const old = hit.get(key)
    if (!old) return true // 命中版本没有该译文语言/类型 → 新翻译
    if (texts.every(t => !old.includes(t))) return true // 同语言但前几句全无相同句 → 新翻译
  }
  return false
}

/**
 * 复制投稿查重：投稿任一原文组前 3 个行开始时间戳，与某已有版本原文组前 3 个毫秒级全等 → 命中。
 * 译文/罗马音组不参与时间戳比对（译文时间戳天然对齐原文，比了纯属多余）；命中后若投稿带了
 * 新增/完全不同的译文（「我的翻译更好」场景）则视为有增量放行。不足 3 行的组跳过；
 * 投稿人拆行导致序列错位会自然漏过（接受：起码自己打了一行时间戳）。
 */
export function detectTimestampDuplicate(
  submittedGroups: LyricVersion[],
  existing: ExistingLyricVersion[],
): DuplicateHit | null {
  const subHeads = submittedGroups
    .filter(g => g.kind === 'original')
    .map(g => headStartTimes(g))
    .filter((t): t is number[] => !!t)
  if (!subHeads.length) return null
  for (const ex of existing) {
    const exHeads = ex.groups
      .filter(g => g.kind === 'original')
      .map(g => headStartTimes(g))
      .filter((t): t is number[] => !!t)
    const matched = subHeads.some(sh =>
      exHeads.some(eh => eh.length === sh.length && eh.every((t, i) => t === sh[i])),
    )
    if (!matched) continue
    return { label: ex.label, hasTranslationDelta: hasTranslationDelta(submittedGroups, ex.groups) }
  }
  return null
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
 * TTML XML → 多语言版本数组（每个 (lang, kind) 一个版本），与 Worker parseTtmlVersionsWorker 同规则：
 * original = 主歌词行；translation/romanization = 行内翻译/音译（AMLL 解析已含 head sidecar 配对）。
 * SSG/Node 无 DOMParser 返回空数组。
 */
export function parseTtmlToVersions(xml: string): LyricVersion[] {
  const result = parseTtmlWithAmll(xml)
  if (!result || !Array.isArray(result.lines)) return []

  // AMLL 只读 <tt> 根标签 xml:lang；历史数据语言可能标在 <body>（后台编辑器旧写法，AMLL 读不到）→ 正则兜底（与 Worker 一致）
  const rootLang = (result.metadata?.language ? ttmlLangToLrc(result.metadata.language) : '')
    || (() => {
      const m = /<body\b[^>]*?\bxml:lang\s*=\s*["']([^"']+)["']/i.exec(xml)
      return m ? ttmlLangToLrc(m[1]) : ''
    })()
    || 'und'

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

  // translation / romanization：按语言分组（译文行时间戳取所在正文行；空语言码回退正文语言，与 Worker 一致）
  const transMap = new Map<string, LyricRow[]>()
  const romanMap = new Map<string, LyricRow[]>()
  for (const l of result.lines) {
    for (const t of l.translations || []) {
      const lang = (t.language ? ttmlLangToLrc(t.language) : '') || rootLang
      const rows = transMap.get(lang) || []
      rows.push({ seq: 0, time_ms: l.startTime, end_ms: l.endTime, text: t.words?.length ? syllablesToText(t.words, l.startTime) : t.text })
      transMap.set(lang, rows)
    }
    for (const r of l.romanizations || []) {
      const lang = (r.language ? ttmlLangToLrc(r.language) : '') || rootLang
      const rows = romanMap.get(lang) || []
      rows.push({ seq: 0, time_ms: l.startTime, end_ms: l.endTime, text: r.words?.length ? syllablesToText(r.words, l.startTime) : r.text })
      romanMap.set(lang, rows)
    }
  }
  for (const [lang, rows] of transMap) versions.push({ lang, kind: 'translation', rows: finalizeTtmlRows(rows) })
  for (const [lang, rows] of romanMap) versions.push({ lang, kind: 'romanization', rows: finalizeTtmlRows(rows) })

  return versions
}

// ---------- TTML 编辑模型（翻译/音译表格化：方言 A/B 统一为 Head Sidecar） ----------

const TTM_NS = 'http://www.w3.org/ns/ttml#metadata'
const TTS_NS = 'http://www.w3.org/ns/ttml#styling'
const ITUNES_NS = 'http://music.apple.com/lyric-ttml-internal'
const XML_NS = 'http://www.w3.org/XML/1998/namespace'

/** TTML 正文行的一个词（span）：保留原始 begin/end 属性串供合成回写 */
export interface TtmlLineWord {
  text: string
  beginRaw: string | null
  endRaw: string | null
}

/** TTML 正文行（body 内 p）：key = itunes:key（缺失时分配合成 key），words 供音译词级对齐 */
export interface TtmlEditLine {
  key: string
  /** 行 begin 原始属性串 */
  beginRaw: string | null
  /** 行文本预览（主歌词 + 和声括号） */
  text: string
  /** 行纯文本（仅主歌词，不含和声括号后缀；纯文本编辑框用） */
  plain: string
  words: TtmlLineWord[]
}

/** 翻译轨（一个语言一份；按 itunes:key 对齐行） */
export interface TtmlTranslationTrack {
  /** TTML 原文里的 xml:lang 原值（用户未改语言时导出原样写回，不影响下游解码） */
  ttmlLang: string
  /** 站内语言码（表格下拉值） */
  lrcLang: string
  /** 导入时的语言码快照（判断用户是否改过语言） */
  origTtmlLang: string
  origLrcLang: string
  /** translation 的 type 属性（如 subtitle） */
  type: string
  /** 每行一条：text 主文本，bg 和声（导出为 x-bg span） */
  lines: { for: string; text: string; bg: string[] }[]
}

/** 音译轨：词级行文本用内部约定语法（空格分词、{LSU,词 组} 多字并位、{LSJ,原词,N} 跳词）；
 *  行级行（lineLevel=true，Line 级 timing / 纯文本 sidecar）整行文本即该行音译，for= 锚定行对应，不做逐字配对 */
export interface TtmlTranslitTrack {
  ttmlLang: string
  lrcLang: string
  origTtmlLang: string
  origLrcLang: string
  lines: {
    for: string
    text: string
    /** 行级音译：正文行无词位（Line 级 timing/整行单 span）或音译无词级 span（纯文本 sidecar/行内 x-roman）。
     *  整行对应正文行，预览整行一个箭头、写回纯文本 <text>，不参与 LSU/LSJ 逐词对齐 */
    lineLevel?: boolean
    /** 和声音译（x-bg 包装 span；保留自己的词级时间与字面括号，compose 原样写回） */
    bg: { text: string; beginRaw: string | null; endRaw: string | null }[]
  }[]
}

/** TTML 编辑模型：bodyRaw = 剥离翻译/音译后的完整原文；保存时 composeTtml 合成回完整 TTML */
export interface TtmlEditModel {
  bodyRaw: string
  /** 正文语言（站内码；UI 标注，写回 body xml:lang） */
  bodyLang: string
  /** 导入时正文语言（站内码；空=原文无标注） */
  origBodyLang: string
  /** 导入时正文 xml:lang 原值（BCP47；空=原文无标注，导出时原样保留） */
  origBodyTtmlLang: string
  lines: TtmlEditLine[]
  translations: TtmlTranslationTrack[]
  transliterations: TtmlTranslitTrack[]
}

/** 空模型（bodyRaw 空 → 保存时走 TTML 版本删除链路） */
export function emptyTtmlEditModel(): TtmlEditModel {
  return { bodyRaw: '', bodyLang: '', origBodyLang: '', origBodyTtmlLang: '', lines: [], translations: [], transliterations: [] }
}

/** TTML 时间属性 → 毫秒（clock-time H?:MM:SS(.fff)? / MM:SS.mmm / 秒值；解析失败 null） */
function ttmlTimeToMs(raw: string | null): number | null {
  if (!raw) return null
  const m = raw.match(/^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})(?:[.:](\d{1,3}))?$/)
  if (m) {
    const h = parseInt(m[1] || '0', 10)
    const mm = parseInt(m[2], 10)
    const ss = parseInt(m[3], 10)
    const frac = m[4] ? parseInt(m[4].padEnd(3, '0'), 10) : 0
    return ((h * 60 + mm) * 60 + ss) * 1000 + frac
  }
  const s = raw.match(/^([\d.]+)s?$/)
  if (s) return Math.round(parseFloat(s[1]) * 1000)
  return null
}

/** ttm:role 属性（命名空间优先，前缀名兜底） */
function roleOf(el: Element): string {
  return el.getAttributeNS(TTM_NS, 'role') || el.getAttribute('ttm:role') || ''
}

/** xml:lang 属性 */
function xmlLangOf(el: Element): string {
  return (el.getAttributeNS(XML_NS, 'lang') || el.getAttribute('xml:lang') || '').trim()
}

/** itunes:key 属性 */
function itunesKeyOf(el: Element): string {
  return el.getAttributeNS(ITUNES_NS, 'key') || el.getAttribute('itunes:key') || ''
}

/** 清洗怪语言码（如 xml:ja → ja） */
function cleanTtmlLang(lang: string): string {
  return String(lang || '').replace(/^xml:/, '').trim()
}

/** TTML xml:lang（BCP47）→ 站内语言码。仅用于正文/译文轨；音译轨直接用原标签（见 parseTtmlForEdit）。
 *  核心规则在 shared/lang.mjs（大小写不敏感、zh 简繁组归一）；本端再经站内码表校验，
 *  合法站内码/主子标签直接采用，其余原样透传（保持「未知标签不丢信息」）。 */
export function ttmlLangToLrc(ttmlLang: string): string {
  const v = normalizeTtmlLang(ttmlLang)
  if (!v) return 'und'
  if (LYRIC_LANG_LABELS[v]) return v
  const base = v.split('-')[0]
  if (LYRIC_LANG_LABELS[base]) return base
  return v
}

/** body 内所有 p（按文档序） */
function ttmlBodyPs(doc: Document): Element[] {
  const body = Array.from(doc.getElementsByTagNameNS('*', 'body'))[0]
  if (!body) return []
  return Array.from(body.getElementsByTagNameNS('*', 'p'))
}

/** ruby 容器（tts:ruby="container"）取 base span 文本，非容器返回 null */
function rubyBaseText(el: Element): string | null {
  const rubyOf = (c: Element) => c.getAttributeNS(TTS_NS, 'ruby') || c.getAttribute('tts:ruby') || ''
  if (rubyOf(el) !== 'container') return null
  const base = Array.from(el.children).find(c => rubyOf(c) === 'base')
  return base ? base.textContent || '' : null
}

/** 从文档提取行模型（itunes:key 缺失的行分配合成 key；keyMap 供 DOM 模式写回真实属性） */
function extractTtmlLines(doc: Document, keyMap?: Map<Element, string>): TtmlEditLine[] {
  const ps = ttmlBodyPs(doc)
  const used = new Set<string>()
  for (const p of ps) { const k = itunesKeyOf(p); if (k) used.add(k) }
  const lines: TtmlEditLine[] = []
  let synth = 0
  for (const p of ps) {
    let key = itunesKeyOf(p)
    if (!key) {
      do { synth++; key = `LX${synth}` } while (used.has(key))
      used.add(key)
    }
    keyMap?.set(p, key)
    const words: TtmlLineWord[] = []
    const bgTexts: string[] = []
    let preview = ''
    for (const node of Array.from(p.childNodes)) {
      // 纯空白文本节点 = 格式化换行/缩进（XML 默认空白处理），丢弃避免纯文本区每字一行
      if (node.nodeType === 3) { const t = node.nodeValue || ''; if (t.trim()) preview += t; continue }
      if (node.nodeType !== 1) continue
      const el = node as Element
      const role = roleOf(el)
      if (role === 'x-bg') { const t = (el.textContent || '').trim(); if (t) bgTexts.push(t); continue }
      if (role) continue // x-translation / x-roman 行内方言（导入时另行提取）
      if (el.localName !== 'span') { preview += el.textContent || ''; continue }
      const wt = rubyBaseText(el) ?? (el.textContent || '')
      words.push({ text: wt, beginRaw: el.getAttribute('begin'), endRaw: el.getAttribute('end') })
      preview += wt
    }
    const bgSuffix = bgTexts.length ? ` ${bgTexts.map(t => `(${t})`).join(' ')}` : ''
    lines.push({ key, beginRaw: p.getAttribute('begin') || null, text: preview.trim() + bgSuffix, plain: preview.trim(), words })
  }
  return lines
}

/**
 * TTML 原文 → 编辑模型（翻译/音译表格化）：
 * - 方言 A（Head Sidecar）/ 方言 B（行内 x-translation/x-roman）统一提取为表格，导出统一写方言 A；
 * - bodyRaw = 剥离翻译/音译后的完整原文（方言 A 纯字符串摘除两块，正文零改动；方言 B DOM 剥离后序列化）；
 * - 行缺 itunes:key 时补合成 key（DOM 模式写回真实属性，供 sidecar for= 引用）。
 */
export function parseTtmlForEdit(xml: string): TtmlEditModel | null {
  if (typeof DOMParser === 'undefined') return null
  const raw = String(xml || '')
  if (!raw.trim()) return null
  const doc = new DOMParser().parseFromString(raw, 'text/xml')
  if (doc.querySelector('parsererror') || doc.getElementsByTagName('parsererror').length) return null
  if (!doc.documentElement || doc.documentElement.localName !== 'tt') return null

  const keyMap = new Map<Element, string>()
  const lines = extractTtmlLines(doc, keyMap)

  // ---- sidecar（方言 A）提取：translations/transliterations → 按 xml:lang 聚合 ----
  interface TransAgg { ttmlLang: string; type: string; entries: Map<string, { text: string; bg: string[] }> }
  interface RomanAgg { ttmlLang: string; entries: Map<string, { plain: string; wordSpans: { beginRaw: string; endRaw: string; text: string }[]; bg: { text: string; beginRaw: string | null; endRaw: string | null }[]; extras: string[] }> }
  const transAggs: TransAgg[] = []
  for (const tr of Array.from(doc.getElementsByTagNameNS('*', 'translation'))) {
    const lang = cleanTtmlLang(xmlLangOf(tr))
    let agg = transAggs.find(a => a.ttmlLang === lang)
    if (!agg) { agg = { ttmlLang: lang, type: tr.getAttribute('type') || '', entries: new Map() }; transAggs.push(agg) }
    for (const textEl of Array.from(tr.children)) {
      if (textEl.localName !== 'text') continue
      const forKey = textEl.getAttribute('for') || ''
      if (!forKey) continue
      let main = ''
      const bg: string[] = []
      for (const node of Array.from(textEl.childNodes)) {
        // 纯空白文本节点 = 格式化换行/缩进，丢弃（同正文提取逻辑）
        if (node.nodeType === 3) { const t = node.nodeValue || ''; if (t.trim()) main += t; continue }
        if (node.nodeType !== 1) continue
        const el = node as Element
        if (roleOf(el) === 'x-bg') { const t = (el.textContent || '').trim(); if (t) bg.push(t) }
        else main += el.textContent || ''
      }
      agg.entries.set(forKey, { text: main.trim(), bg })
    }
  }
  const romanAggs: RomanAgg[] = []
  for (const tr of Array.from(doc.getElementsByTagNameNS('*', 'transliteration'))) {
    const lang = cleanTtmlLang(xmlLangOf(tr))
    let agg = romanAggs.find(a => a.ttmlLang === lang)
    if (!agg) { agg = { ttmlLang: lang, entries: new Map() }; romanAggs.push(agg) }
    for (const textEl of Array.from(tr.children)) {
      if (textEl.localName !== 'text') continue
      const forKey = textEl.getAttribute('for') || ''
      if (!forKey) continue
      const wordSpans: { beginRaw: string; endRaw: string; text: string }[] = []
      const bg: { text: string; beginRaw: string | null; endRaw: string | null }[] = []
      const extras: string[] = []
      let plain = ''
      // 遍历 childNodes（不能只看 children）：Apple Music Line 级 sidecar 音译为整行纯文本
      // （<text for="L1">zoi cung...</text> 内无词级 span），纯文本节点不在 children 中
      for (const node of Array.from(textEl.childNodes)) {
        // 纯空白文本节点 = 格式化换行/缩进，丢弃（同正文/翻译提取逻辑）
        if (node.nodeType === 3) { const t = node.nodeValue || ''; if (t.trim()) plain += t; continue }
        if (node.nodeType !== 1) continue
        const el = node as Element
        if (roleOf(el) === 'x-bg') {
          // 和声音译：x-bg 包装 span，内层 span 带自己的词级时间（文本含字面括号等原样保留）
          for (const inner of Array.from(el.children)) {
            const t = (inner.textContent || '').trim()
            if (!t) continue
            const ib = inner.getAttribute('begin')
            const ie = inner.getAttribute('end')
            if (inner.localName === 'span' && !roleOf(inner)) bg.push({ text: t, beginRaw: ib, endRaw: ie })
            else bg.push({ text: t, beginRaw: null, endRaw: null })
          }
          continue
        }
        const t = (el.textContent || '').trim()
        if (!t) continue
        const b = el.getAttribute('begin')
        const e = el.getAttribute('end')
        if (el.localName === 'span' && !roleOf(el) && b && e) wordSpans.push({ beginRaw: b, endRaw: e, text: t })
        else extras.push(t)
      }
      agg.entries.set(forKey, { plain: plain.trim(), wordSpans, bg, extras })
    }
  }

  // ---- 行内 role（方言 B）提取：合并进聚合（同语言 sidecar 未覆盖的行才补，避免重复） ----
  const inlineEls: Element[] = []
  const inlineTrans: { lang: string; key: string; text: string }[] = []
  const inlineRoman: { lang: string; key: string; text: string }[] = []
  for (const el of Array.from(doc.getElementsByTagNameNS('*', 'span'))) {
    const role = roleOf(el)
    if (role !== 'x-translation' && role !== 'x-roman') continue
    let p: Element | null = el.parentElement
    while (p && p.localName !== 'p') p = p.parentElement
    const key = p ? keyMap.get(p) || '' : ''
    if (!key) continue
    inlineEls.push(el)
    const rec = { lang: cleanTtmlLang(xmlLangOf(el)), key, text: (el.textContent || '').trim() }
    if (role === 'x-translation') inlineTrans.push(rec)
    else inlineRoman.push(rec)
  }
  for (const r of inlineTrans) {
    let agg = transAggs.find(a => a.ttmlLang === r.lang)
    if (!agg) { agg = { ttmlLang: r.lang, type: '', entries: new Map() }; transAggs.push(agg) }
    if (!agg.entries.has(r.key)) agg.entries.set(r.key, { text: r.text, bg: [] })
  }
  for (const r of inlineRoman) {
    let agg = romanAggs.find(a => a.ttmlLang === r.lang)
    if (!agg) { agg = { ttmlLang: r.lang, entries: new Map() }; romanAggs.push(agg) }
    if (!agg.entries.has(r.key)) agg.entries.set(r.key, { plain: '', wordSpans: [], bg: [], extras: [r.text] })
  }

  // ---- 翻译表格（每行一条，缺行=空文本） ----
  const translations: TtmlTranslationTrack[] = transAggs.map(agg => ({
    ttmlLang: agg.ttmlLang,
    lrcLang: ttmlLangToLrc(agg.ttmlLang),
    origTtmlLang: agg.ttmlLang,
    origLrcLang: ttmlLangToLrc(agg.ttmlLang),
    type: agg.type,
    lines: lines.map(l => {
      const e = agg.entries.get(l.key)
      return { for: l.key, text: e?.text || '', bg: e?.bg || [] }
    }),
  }))

  // ---- 音译表格：音译 span 与原词按 begin 时间戳配对；跳词自动生成 {LSJ,原词,N} 锚点，带空格多字生成 {LSU,...} 并位 ----
  const transliterations: TtmlTranslitTrack[] = romanAggs.map(agg => {
    // 音译轨 lang 纠错（如上游错标 yue → zh-Latn-jyutping）：lrcLang 用修正值，origLrcLang 保留原码，
    // 用户不动下拉保存即输出修正标签；ttmlLang 保留原值用于灰字「xml:lang=yue」提示
    const fixedLang = fixTranslitLang(agg.ttmlLang)
    return {
    ttmlLang: agg.ttmlLang,
    lrcLang: fixedLang,
    origTtmlLang: agg.ttmlLang,
    origLrcLang: agg.ttmlLang || 'und',
    lines: lines.map(l => {
      const entry = agg.entries.get(l.key)
      if (!entry || (!entry.wordSpans.length && !entry.extras.length && !entry.bg.length && !entry.plain)) return { for: l.key, text: '', bg: [], lineLevel: false }
      // 行级音译：正文行无词位（Line 级 timing / 整行单 span），或音译本身无词级 span（纯文本 sidecar / 行内 x-roman）。
      // 行对应已由 for= 锚定，整行文本即该行音译——不做逐字配对、不包 LSU 壳（词数本来就对不上，逐词对齐无意义）
      const lineLevel = l.words.length <= 1 || entry.wordSpans.length === 0
      if (lineLevel) {
        // 单 span 整行取 span 文本，纯文本 sidecar 取 plain，行内 x-roman 取 extras
        const text = [entry.plain, ...entry.wordSpans.map(w => w.text), ...entry.extras].filter(Boolean).join(' ').trim()
        return { for: l.key, text, bg: entry.bg || [], lineLevel: true }
      }
      const parts: string[] = []
      const extras: string[] = [...entry.extras]
      if (entry.plain) extras.push(entry.plain) // 混合形态（词级 span + 游离纯文本）：整行文本兜底附后，不丢弃
      const matched: { idx: number; text: string }[] = []
      for (const ws of entry.wordSpans) {
        const ms = ttmlTimeToMs(ws.beginRaw)
        let idx = -1
        if (ms != null) {
          for (let i = 0; i < l.words.length; i++) {
            if (ttmlTimeToMs(l.words[i].beginRaw) === ms) { idx = i; break }
          }
        }
        if (idx >= 0) matched.push({ idx, text: ws.text })
        else if (ws.text) extras.push(ws.text)
      }
      matched.sort((a, b) => a.idx - b.idx)
      let cursor = 0
      for (const m of matched) {
        if (m.idx < cursor) { if (m.text) extras.push(m.text); continue }
        if (m.idx > cursor) {
          const word = l.words[m.idx].text
          const n = l.words.slice(cursor, m.idx + 1).filter(w => w.text === word).length
          parts.push(`{LSJ,${word},${n}}`)
        }
        parts.push(/\s/.test(m.text) ? `{LSU,${m.text.trim()}}` : m.text)
        cursor = m.idx + 1
      }
      for (const e of extras) if (e) parts.push(/\s/.test(e) ? `{LSU,${e.trim()}}` : e)
      return { for: l.key, text: parts.join(' '), bg: entry.bg || [], lineLevel: false }
    }),
    }
  })

  // ---- bodyRaw：剥离翻译/音译 ----
  // 有行内 role 或缺 key → DOM 模式（剥离 span / 补 key / 删 sidecar 后整体序列化）；
  // 否则纯字符串摘除 sidecar 两块，正文（含对唱/和声/样式）零改动。
  const needDom = inlineEls.length > 0 || ttmlBodyPs(doc).some(p => !itunesKeyOf(p))
  let bodyRaw: string
  if (needDom) {
    for (const el of inlineEls) el.parentNode?.removeChild(el)
    for (const [p, key] of keyMap) if (!itunesKeyOf(p)) p.setAttributeNS(ITUNES_NS, 'itunes:key', key)
    for (const el of Array.from(doc.getElementsByTagNameNS('*', 'translations'))) el.parentNode?.removeChild(el)
    for (const el of Array.from(doc.getElementsByTagNameNS('*', 'transliterations'))) el.parentNode?.removeChild(el)
    bodyRaw = prettifyTtml(new XMLSerializer().serializeToString(doc))
    if (/^\s*<\?xml/.test(raw)) bodyRaw = `<?xml version='1.0' encoding='utf-8'?>\n${bodyRaw}`
  } else {
    bodyRaw = raw
      .replace(/<translations\b[\s\S]*?<\/translations\s*>/g, '')
      .replace(/<transliterations\b[\s\S]*?<\/transliterations\s*>/g, '')
  }

  // ---- 正文语言：优先 <tt> 根 xml:lang（AMLL/Apple 标准位置，旧数据可能只标在 <body> 兜底读取） ----
  const rootEl = doc.getElementsByTagNameNS('*', 'tt')[0] || doc.documentElement || null
  const bodyEl = doc.getElementsByTagNameNS('*', 'body')[0] || null
  const origBodyTtmlLang = (rootEl ? cleanTtmlLang(xmlLangOf(rootEl)) : '') || (bodyEl ? cleanTtmlLang(xmlLangOf(bodyEl)) : '')
  const origBodyLang = origBodyTtmlLang ? ttmlLangToLrc(origBodyTtmlLang) : ''

  return { bodyRaw, bodyLang: origBodyLang, origBodyLang, origBodyTtmlLang, lines, translations, transliterations }
}

/**
 * 音译行内部约定语法解析：空格分词 / {LSU,词 组} 多字并位（UNION：多个字共享一个词级时间位）/
 * {LSJ,原词,N} 跳词（JUMP：游标跳到从当前位置起第 N 个「原词」，N 可省略默认 1）。
 * 圆括号等其余字符均为字面内容（原文自带 (し) 不会被解析）。
 */
export type TranslitToken =
  | { kind: 'word'; text: string }
  | { kind: 'union'; text: string }
  | { kind: 'anchor'; word: string; n: number }

export function parseTranslitTokens(text: string): TranslitToken[] {
  const s = String(text || '')
  const tokens: TranslitToken[] = []
  let i = 0
  while (i < s.length) {
    const c = s[i]
    if (/\s/.test(c)) { i++; continue }
    if (c === '{') {
      const rest = s.slice(i)
      const mu = /^\{LSU,([^}]*)\}/.exec(rest)
      if (mu) { const inner = mu[1].trim(); if (inner) tokens.push({ kind: 'union', text: inner }); i += mu[0].length; continue }
      const mj = /^\{LSJ,([^,}]+?)(?:,(\d+))?\}/.exec(rest)
      if (mj) { tokens.push({ kind: 'anchor', word: mj[1].trim(), n: mj[2] ? parseInt(mj[2], 10) : 1 }); i += mj[0].length; continue }
    }
    // 普通词：到下一空白 / { 为止
    let j = i
    while (j < s.length && !/\s/.test(s[j]) && s[j] !== '{') j++
    const w = s.slice(i, j)
    if (w) tokens.push({ kind: 'word', text: w })
    i = j
  }
  return tokens
}

/** 音译 token 对齐原词：锚点把游标跳到「从当前位置起第 N 个原词」，词/并位 token 顺序占用游标位；多余落 extra */
export function alignTranslitTokens(tokens: TranslitToken[], words: TtmlLineWord[]): { matched: { wordIdx: number; text: string }[]; extra: string[]; badAnchors: number } {
  const matched: { wordIdx: number; text: string }[] = []
  const extra: string[] = []
  let cursor = 0
  let badAnchors = 0
  for (const tk of tokens) {
    if (tk.kind === 'anchor') {
      let idx = -1
      let seen = 0
      for (let k = cursor; k < words.length; k++) {
        if (words[k].text === tk.word) { seen++; if (seen === tk.n) { idx = k; break } }
      }
      if (idx >= 0) cursor = idx
      else badAnchors++
    } else {
      // word 与 union 同样顺序占用一个原词位（union = 多字共享一个词级时间）
      if (cursor < words.length) { matched.push({ wordIdx: cursor, text: tk.text }); cursor++ }
      else extra.push(tk.text)
    }
  }
  return { matched, extra, badAnchors }
}

/** 站内语言码 → TTML 输出 BCP47（简体补文字码 zh→zh-Hans；其余站内码已是合法 BCP47 原样；规则在 shared/lang.mjs） */
export function lrcLangToTtml(lang: string): string {
  return lrcLangToTtmlCore(lang)
}

/** 轨道导出语言：用户未改语言 → 原样写回导入时的 BCP47 值；改过/无原码 → 写站内码的 BCP47 形式 */
function trackOutLang(t: { ttmlLang: string; lrcLang: string; origTtmlLang: string; origLrcLang: string }): string {
  return t.lrcLang === t.origLrcLang ? (t.origTtmlLang || lrcLangToTtml(t.lrcLang)) : lrcLangToTtml(t.lrcLang)
}

/** body 标签写入 xml:lang（已有则替换值，无则追加属性） */
function applyBodyLang(xml: string, lang: string): string {
  const m = xml.match(/<body\b[^>]*>/)
  if (!m) return xml
  const tag = m[0]
  if (/\sxml:lang\s*=\s*("[^"]*"|'[^']*')/.test(tag)) {
    return xml.replace(tag, tag.replace(/\sxml:lang\s*=\s*("[^"]*"|'[^']*')/, ` xml:lang="${escapeXml(lang)}"`))
  }
  return xml.replace(tag, tag.replace(/<body\b/, `<body xml:lang="${escapeXml(lang)}"`))
}

/** <tt> 根标签写入 xml:lang（AMLL/Apple 标准读取位置；已有则替换，无则追加） */
function applyRootLang(xml: string, lang: string): string {
  const m = xml.match(/<tt\b[^>]*>/)
  if (!m) return xml
  const tag = m[0]
  if (/\sxml:lang\s*=\s*("[^"]*"|'[^']*')/.test(tag)) {
    return xml.replace(tag, tag.replace(/\sxml:lang\s*=\s*("[^"]*"|'[^']*')/, ` xml:lang="${escapeXml(lang)}"`))
  }
  return xml.replace(tag, tag.replace(/<tt\b/, `<tt xml:lang="${escapeXml(lang)}"`))
}

/**
 * 编辑模型 → 完整 TTML 原文：bodyRaw 原样 + 翻译/音译合成 Head Sidecar 写回 iTunesMetadata。
 * 音译词按原词继承 begin/end（[ls] 锚点对齐；对不上的词退化为无词级时间的纯文本）。
 * 正文语言写回 body xml:lang（未改语言 → 原码原样）。
 */
export function composeTtml(model: TtmlEditModel): string {
  let bodyRaw = String(model.bodyRaw || '')
  if (!bodyRaw.trim()) return ''

  // 正文语言写回 xml:lang：未改语言 → 原码原样（如 zh-Hans 不降级为 zh）；改过/原文无标注 → 写站内码的 BCP47 形式。
  // <tt> 根标签为 AMLL/Apple 标准读取位置（必写）；<body> 同步同值（历史标注位置，更新而非残留，避免两处不一致）
  const bodyOutLang = model.bodyLang
    ? (model.bodyLang === model.origBodyLang ? (model.origBodyTtmlLang || lrcLangToTtml(model.bodyLang)) : lrcLangToTtml(model.bodyLang))
    : ''
  if (bodyOutLang) bodyRaw = applyRootLang(applyBodyLang(bodyRaw, bodyOutLang), bodyOutLang)

  // 正文重新解析拿行词表（用户可能改过 bodyRaw；key 均已在 parse 时写回正文）
  let bodyLines: TtmlEditLine[] = []
  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(bodyRaw, 'text/xml')
      if (!doc.querySelector('parsererror') && doc.documentElement?.localName === 'tt') bodyLines = extractTtmlLines(doc)
    } catch { /* 正文非法 XML：按无行处理（翻译仍按 key 写回） */ }
  }

  const transParts: string[] = []
  for (const t of model.translations) {
    const texts: string[] = []
    for (const ln of t.lines) {
      const main = ln.text.trim()
      const bg = ln.bg.filter(b => b.trim())
      if (!main && !bg.length) continue
      const bgSpans = bg.map(b => `<span xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="${TTM_NS}" ttm:role="x-bg">${escapeXml(b)}</span>`).join('')
      texts.push(`<text for="${escapeXml(ln.for)}">${escapeXml(main)}${bgSpans}</text>`)
    }
    if (texts.length) {
      const typeAttr = t.type ? ` type="${escapeXml(t.type)}"` : ''
      transParts.push(`<translation${typeAttr} xml:lang="${escapeXml(trackOutLang(t))}">${texts.join('\n')}</translation>`)
    }
  }

  const romanParts: string[] = []
  for (const tr of model.transliterations) {
    const texts: string[] = []
    for (const ln of tr.lines) {
      if (!ln.text.trim() && !ln.bg.length) continue
      const bgSpans = ln.bg
        .filter(b => b.text.trim())
        .map(b => {
          const inner = b.beginRaw && b.endRaw
            ? `<span xmlns="http://www.w3.org/ns/ttml" begin="${escapeXml(b.beginRaw)}" end="${escapeXml(b.endRaw)}">${escapeXml(b.text)}</span>`
            : escapeXml(b.text)
          return `<span xmlns="http://www.w3.org/ns/ttml" xmlns:ttm="${TTM_NS}" ttm:role="x-bg">${inner}</span>`
        })
      const line = bodyLines.find(l => l.key === ln.for)
      const words = line?.words || []
      // 行级音译（Line 级 timing / 纯文本 sidecar）：整行写纯文本 <text>，行时间由 for= 锚定的正文行承载，
      // 不生成词级 span（Line 级正文无词位时间可挂）
      if (ln.lineLevel) {
        if (ln.text.trim() || bgSpans.length) texts.push(`<text for="${escapeXml(ln.for)}">${escapeXml(ln.text.trim())}${bgSpans.join('')}</text>`)
        continue
      }
      const { matched, extra } = alignTranslitTokens(parseTranslitTokens(ln.text), words)
      // 兜底：词级正文但音译一个词都没配上（异常手输），按纯文本写回，保留词间空格
      if (!matched.length) {
        if (ln.text.trim() || bgSpans.length) texts.push(`<text for="${escapeXml(ln.for)}">${escapeXml(ln.text.trim())}${bgSpans.join('')}</text>`)
        continue
      }
      const spans: string[] = []
      for (const m of matched) {
        const w = words[m.wordIdx]
        if (w && w.beginRaw && w.endRaw) {
          spans.push(`<span xmlns="http://www.w3.org/ns/ttml" begin="${escapeXml(w.beginRaw)}" end="${escapeXml(w.endRaw)}">${escapeXml(m.text)}</span>`)
        } else {
          spans.push(escapeXml(m.text))
        }
      }
      for (const e of extra) spans.push(escapeXml(e))
      spans.push(...bgSpans)
      if (spans.length) texts.push(`<text for="${escapeXml(ln.for)}">${spans.join('')}</text>`)
    }
    if (texts.length) romanParts.push(`<transliteration xml:lang="${escapeXml(trackOutLang(tr))}">${texts.join('\n')}</transliteration>`)
  }

  const blocks: string[] = []
  if (transParts.length) blocks.push(`<translations>\n${transParts.join('\n')}\n</translations>`)
  if (romanParts.length) blocks.push(`<transliterations>\n${romanParts.join('\n')}\n</transliterations>`)
  if (!blocks.length) return bodyRaw

  const insert = blocks.join('\n')
  let out = bodyRaw
  if (out.includes('</iTunesMetadata>')) {
    out = out.replace('</iTunesMetadata>', `${insert}</iTunesMetadata>`)
  } else if (out.includes('</metadata>')) {
    out = out.replace('</metadata>', `<iTunesMetadata xmlns="${ITUNES_NS}">${insert}</iTunesMetadata></metadata>`)
  } else if (out.includes('</head>')) {
    out = out.replace('</head>', `<metadata><iTunesMetadata xmlns="${ITUNES_NS}">${insert}</iTunesMetadata></metadata></head>`)
  } else {
    const m = out.match(/<tt\b[^>]*>/)
    if (!m) return bodyRaw
    out = out.replace(m[0], `${m[0]}<head><metadata><iTunesMetadata xmlns="${ITUNES_NS}">${insert}</iTunesMetadata></metadata></head>`)
  }
  return out
}

/** 收集 p 内普通词 span（跳过和声 x-bg 包装及其内容） */
function collectPlainSpans(p: Element, out: Element[]) {
  for (const node of Array.from(p.childNodes)) {
    if (node.nodeType !== 1) continue
    const el = node as Element
    if (roleOf(el) === 'x-bg') continue
    if (el.localName === 'span') out.push(el)
  }
}

/** XMLDocument → 字符串（text/xml 序列化） */
function serializeXmlDoc(doc: Document): string {
  return new XMLSerializer().serializeToString(doc)
}

/** TTML 结构标签换行格式化（p/div/body/head/tt/metadata 各占一行，span 保持行内；DOM 序列化与旧数据展示用） */
export function prettifyTtml(xml: string): string {
  return String(xml || '')
    .replace(/\s*(<(?:p|div|body|head|tt|metadata)\b[^>]*>|<\/(?:p|div|body|head|tt|metadata)>)\s*/g, '\n$1\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/**
 * 纯文本 → 变体 TTML 编辑模型：以 base 为模板替换正文文字（行结构/词级时间/对唱 agent 照抄），
 * 翻译/音译轨道整体复制（变体间共用，如简↔繁共用同一份英语翻译）。
 *
 * 对齐规则（严格）：行数必须 = 模板行数；每行拆词（含空格按空格、无空格按单字）词数必须 = 该行 span 数。
 * @param errors 出参：不匹配详情（行 key / 期望词数 / 实际词数）
 */
export function generateTtmlVariant(
  base: TtmlEditModel,
  plainText: string,
  errors: { line: string; expect: number; got: number }[] = [],
): TtmlEditModel | null {
  if (!base.lines.length) return null
  if (typeof DOMParser === 'undefined') return null
  const inputLines = String(plainText || '')
    .replace(/\r\n?/g, '\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')
    .split('\n')
  if (inputLines.length !== base.lines.length) {
    errors.push({ line: '', expect: base.lines.length, got: inputLines.length })
    return null
  }

  // 每行拆词（含空白 → 空格分词；纯 CJK 无空白 → 单字拆）
  const wordsPerLine = inputLines.map(l => {
    const raw = l.trim()
    return /\s/.test(raw) ? raw.split(/\s+/).filter(Boolean) : Array.from(raw)
  })
  for (let i = 0; i < base.lines.length; i++) {
    if (wordsPerLine[i].length !== base.lines[i].words.length) {
      errors.push({ line: base.lines[i].key, expect: base.lines[i].words.length, got: wordsPerLine[i].length })
    }
  }
  if (errors.length) return null

  // 正文 span 逐个替换文字（结构/属性/和声零改动）
  try {
    const doc = new DOMParser().parseFromString(base.bodyRaw, 'text/xml')
    if (doc.querySelector('parsererror')) return null
    const bodyEl = Array.from(doc.getElementsByTagNameNS('*', 'body'))[0]
    if (!bodyEl) return null
    const spans: Element[] = []
    for (const p of Array.from(bodyEl.getElementsByTagNameNS('*', 'p'))) collectPlainSpans(p, spans)
    const flat = wordsPerLine.flat()
    if (spans.length !== flat.length) return null
    spans.forEach((sp, i) => { sp.textContent = flat[i] })
    return {
      bodyRaw: prettifyTtml(serializeXmlDoc(doc)),
      // 变体是新内容：无导入原码（origBodyTtmlLang 置空，导出时按用户标注写 body xml:lang）
      bodyLang: base.bodyLang,
      origBodyLang: '',
      origBodyTtmlLang: '',
      lines: base.lines.map((l, i) => ({ ...l, text: inputLines[i].trim(), plain: inputLines[i].trim(), words: l.words.map((w, j) => ({ ...w, text: wordsPerLine[i][j] })) })),
      translations: base.translations.map(t => ({ ...t, lines: t.lines.map(ln => ({ ...ln })) })),
      transliterations: base.transliterations.map(t => ({ ...t, lines: t.lines.map(ln => ({ ...ln, bg: ln.bg.map(b => ({ ...b })) })) })),
    }
  } catch {
    return null
  }
}

/**
 * 纯文本 → LRC 变体：以原文版本 LRC 为模板替换文字（行时间戳/词级偏移/行结构照抄）。
 * 对齐规则（严格，同 TTML 变体）：
 * - 行数必须 = 模板时间戳行数（元数据行 [ti:] 等不参与、不保留）
 * - 模板行含词标签 <偏移>：该行拆词（含空格按空格、无空格按单字）词数必须 = 词标签词数
 * - 模板行无词标签：整行文字直接替换（行数一致即可）
 * @returns 成功 = 变体 LRC 文本（enhanced 中性格式：词级用相对偏移标签，与 versionForms 存储一致）；失败 = null（errors 填充）
 */
export function generateLrcVariant(originalLrc: string, plainText: string, errors: { line: string; expect: number; got: number }[] = []): string | null {
  const rows = parseLrcToRows(originalLrc).filter(r => r.time_ms != null)
  if (!rows.length) return null
  const inputLines = String(plainText || '')
    .replace(/\r\n?/g, '\n')
    .replace(/^\n+/, '')
    .replace(/\n+$/, '')
    .split('\n')
  if (inputLines.length !== rows.length) {
    errors.push({ line: '', expect: rows.length, got: inputLines.length })
    return null
  }

  // 逐行校验词数（有词标签的行才要求）
  for (let i = 0; i < rows.length; i++) {
    const words = parseWordTags(rows[i].text)
    if (words.length <= 1) continue // 无词标签（整行一词）：整行替换
    const raw = inputLines[i].trim()
    const parts = /\s/.test(raw) ? raw.split(/\s+/).filter(Boolean) : Array.from(raw)
    if (parts.length !== words.length) errors.push({ line: `第 ${i + 1} 行`, expect: words.length, got: parts.length })
  }
  if (errors.length) return null

  // 组装变体行（词级结构照抄：第 j 个词的文字替换、偏移保留）
  const outRows: LyricRow[] = rows.map((r, i) => {
    const raw = inputLines[i].trim()
    const words = parseWordTags(r.text)
    let text: string
    if (words.length <= 1) {
      text = raw
    } else {
      const parts = /\s/.test(raw) ? raw.split(/\s+/).filter(Boolean) : Array.from(raw)
      text = words.map((w, j) => w.offset_ms ? `<${w.offset_ms}>${parts[j]}` : parts[j]).join('')
    }
    return { ...r, text }
  })
  return rowsToLrcText(outRows, 'enhanced')
}

/**
 * 音译语法展开：罗马音版本 LRC 里的 {LSU,词 组}/{LSJ,原词,N} 语法 → 对齐原文版本词级时间，
 * 生成带词标签的音译行。无语法或无对应原文行时原样返回该行。
 * 行对应规则：音译版本行按序对齐原文版本的时间戳行（预览/保存前统一调用）。
 */
export function expandRomanSyntax(romanLrc: string, originalLrc: string): string {
  const s = String(romanLrc || '')
  if (!/\{LS[UJ]/.test(s)) return s // 无内部语法：零处理直通
  const origRows = parseLrcToRows(originalLrc).filter(r => r.time_ms != null)
  if (!origRows.length) return s
  const lines = s.replace(/\r\n?/g, '\n').split('\n')
  const out = lines.map((line, i) => {
    const ts = line.match(/^\[(\d{1,2}:\d{2}(?:[.:]\d{1,3})?)\]/)
    const body = ts ? line.slice(ts[0].length) : line
    if (!/\{LS[UJ]/.test(body)) return line
    // 音译行须与原文时间戳行同序对齐：有行时间戳 → 找原文同行时间；无 → 按行序
    let idx = -1
    if (ts) {
      const ms = parseTs(ts[1])
      idx = origRows.findIndex(r => r.time_ms === ms)
    }
    if (idx < 0) idx = i // 无时间戳行（手写音译常无时间戳）：按行序对齐
    const orig = origRows[idx]
    if (!orig) return line
    const words = parseWordTags(orig.text)
    const { matched, extra } = alignTranslitTokens(parseTranslitTokens(body), words.map(w => ({ text: w.text, beginRaw: null, endRaw: null })))
    if (!matched.length) return line
    // 对齐结果 → 词标签（偏移沿用原词位）
    const parts = matched.map(m => {
      const w = words[m.wordIdx]
      return w && w.offset_ms ? `<${w.offset_ms}>${m.text}` : m.text
    })
    let text = parts.join('')
    for (const e of extra) text += e
    return ts ? `${ts[0]}${text}` : text
  })
  return out.join('\n')
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

/** 从 TTML 原文提取语言集合（供入库 langs 摘要）。
 *  规则（与 LRC 侧「整体判定」对齐，零星外语 punchline/和声不产生独立语言标签）：
 *  1. 主体语言优先取根 xml:lang（BCP47 经 ttmlLangToLrc 归一为站内码，zh-Hans→zh）；
 *  2. 根无标注时，正文行整体众数（汉字判定优先于拉丁，混排自然归中文歌）；
 *  3. 译文/音译只认结构化翻译轨（侧车 <translation>/<transliteration> 或 AMLL translations），
 *     x-bg 和声、正文里夹带的外语句不算独立语言；
 *  4. Node（SSG 无 DOMParser）走正则兜底：xml:lang 标注 → 侧车翻译标注 → 正文众数。 */
export function detectTtmlLangs(xml: string): string[] {
  const text = String(xml || '')
  const norm = (raw: string | null | undefined): string | null => {
    if (!raw) return null
    const k = ttmlLangToLrc(raw)
    return k && k !== 'und' ? k : null
  }
  const langs = new Set<string>()
  const majorityOf = (texts: string[]): string | null => {
    const counts = new Map<string, number>()
    for (const t of texts) {
      const d = detectLang(t)
      if (d && d !== 'unknown') counts.set(d, (counts.get(d) || 0) + 1)
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
    return top ? top[0] : null
  }

  // ---- 结构化路径（浏览器） ----
  if (typeof DOMParser !== 'undefined') {
    const struct = parseTtmlStructure(text)
    if (struct.lines.length) {
      const orig = struct.lines.filter(l => l.kind === 'original')
      // 主体：根标注优先；无标注 → 正文整体众数
      const rootLang = norm(orig[0]?.lang || null)
      if (rootLang) langs.add(rootLang)
      else {
        const top = majorityOf(orig.map(l => l.text))
        if (top) langs.add(top)
      }
      // 译文/音译轨：整轨同一语言，标注优先、无标注按文本检测
      for (const l of struct.lines) {
        if (l.kind === 'original') continue
        const byText = () => {
          const d = detectLang(l.text)
          return d && d !== 'unknown' ? d : null
        }
        let k: string | null
        if (l.kind === 'romanization') {
          // 音译轨：BCP47 拉丁化标签原值保留（zh-Latn-jyutping / ja-Latn / ko-Latn），不折叠站内码
          const raw = cleanTtmlLang(l.lang || '')
          k = (raw && raw !== 'und') ? raw : byText()
        } else {
          k = norm(l.lang) || byText()
        }
        if (k) langs.add(k)
      }
      return [...langs]
    }
  }

  // ---- 正则兜底（SSG / 结构化解析为空） ----
  // 主体：<tt>/<body> 根 xml:lang（tt 在 body 前，取第一个匹配）
  const rootM = /<(?:tt|body)\b[^>]*?\bxml:lang\s*=\s*["']([^"']+)["']/i.exec(text)
  const rootLang = norm(rootM ? rootM[1] : null)
  if (rootLang) langs.add(rootLang)
  // 侧车标签（站内 composeTtml 格式）：音译轨 <transliteration> 取 BCP47 拉丁化标签原值；译文轨 <translation> 归一站内码
  for (const m of text.matchAll(/<transliteration\b[^>]*?\bxml:lang\s*=\s*["']([^"']+)["']/gi)) {
    const raw = cleanTtmlLang(m[1])
    if (raw && raw !== 'und') langs.add(raw)
  }
  for (const m of text.matchAll(/<translation\b[^>]*?\bxml:lang\s*=\s*["']([^"']+)["']/gi)) {
    const k = norm(m[1])
    if (k) langs.add(k)
  }
  for (const m of text.matchAll(/<div\b[^>]*?\bxml:lang\s*=\s*["']([^"']+)["']/gi)) {
    const k = norm(m[1])
    if (k && k !== rootLang) langs.add(k)
  }
  // 全无标注 → 正文行众数（x-bg 和声 span 先剔除，避免纯和声行干扰）
  if (!langs.size) {
    const plainRows: string[] = []
    const pRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi
    let pm: RegExpExecArray | null
    while ((pm = pRe.exec(text))) {
      const inner = pm[1]
        .replace(/<span\b[^>]*\bttm:role\s*=\s*["']x-bg["'][^>]*>[\s\S]*?<\/span>(?:\s*<\/span>)?/gi, '')
        .replace(/<[^>]+>/g, '')
      if (inner.trim()) plainRows.push(inner)
    }
    const top = majorityOf(plainRows)
    if (top) langs.add(top)
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
  contributor_id: string | null
  /** 贡献者名（loadLyricVersionMetas 二次查询映射，非 DB 列） */
  contributor_name?: string | null
  ttml_text?: string | null
  /** 手动展示排序（管理端维护）；NULL 排最后，同值按 is_primary/格式兜底 */
  sort_order?: number | null
}

/** 格式展示排序权重：TTML > 逐字 > 行级（D2 tab 排序规则的一环） */
const FORMAT_RANK: Record<string, number> = { ttml: 0, enhanced: 1, lrc: 2 }

/** 读一首歌的已发布歌词版本（排序：手动 sort_order 升序且 NULL 排最后 → is_primary > 格式 兜底）；
 *  contributor_name 由 contributors 表二次查询映射（不依赖外键嵌套，容错无 FK 场景） */
export async function loadLyricVersionMetas(songId: string, withTtml = false): Promise<LyricVersionMeta[]> {
  const cols = `id,song_id,format,source,source_credit,is_primary,langs,contributor_id,sort_order${withTtml ? ',ttml_text' : ''}`
  const { data, error } = await supabase
    .from('lyric_versions')
    .select(cols)
    .eq('song_id', songId)
    .eq('status', 'published')
  if (error) throw error
  const rows = (data || []) as unknown as LyricVersionMeta[]
  const contribIds = [...new Set(rows.map(r => r.contributor_id).filter(Boolean))] as string[]
  if (contribIds.length) {
    const { data: contribs } = await supabase.from('contributors').select('id,name').in('id', contribIds)
    const nameMap = new Map((contribs || []).map((c: { id: string; name: string }) => [c.id, c.name]))
    for (const r of rows) r.contributor_name = r.contributor_id ? (nameMap.get(r.contributor_id) || null) : null
  }
  return rows.sort((a, b) => {
    // 手动排序优先：NULL 视为最大值排最后；同值（含都为 NULL）再按老规则兜底
    const sa = a.sort_order == null ? Number.MAX_SAFE_INTEGER : a.sort_order
    const sb = b.sort_order == null ? Number.MAX_SAFE_INTEGER : b.sort_order
    if (sa !== sb) return sa - sb
    if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1
    return (FORMAT_RANK[a.format] ?? 9) - (FORMAT_RANK[b.format] ?? 9)
  })
}

/** 单行语言判定（独立文字系统逐一匹配，拉丁文字统一判 en 不细分 en/fr/罗马音，由用户手动改）：
 *  规则在 shared/lang.mjs（与两个 Worker 同源；含 CJK 扩展A、重音拉丁），本端把 null 包装为 'unknown' */
export function detectLang(text: string): string {
  return detectLangCore(text) || 'unknown'
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

  // 翻译歌原文语言 = 多行组「第一行」语言的众数（第一行即原文；公共行/元数据随原文走，
  // 显示与 API 由 fillCommonRows 给各译文补齐公共行，底层只存一份）。
  // 全行众数不可用：译文行数 ≥ 原文时会把译文语言误判为原文（如三语歌 zh/ja 行数超过 en）
  let origLang = primary
  if (isTranslationSong) {
    const firstCounts: Record<string, number> = {}
    for (const g of byTs.values()) {
      const lyric = g.filter(r => !isNonLyricRow(r))
      if (lyric.length < 2) continue
      const l = detectLang(lyric[0].text)
      if (l !== 'unknown') firstCounts[l] = (firstCounts[l] || 0) + 1
    }
    let best = -1
    for (const [l, c] of Object.entries(firstCounts)) {
      if (c > best) { best = c; origLang = l }
    }
  }

  // 逐行分配 lang/kind
  const assigned = timed.map(r => {
    const g = byTs.get(r.time_ms!)!
    // 空行/纯符号（清屏点/间奏表情符）：恒归原文，无翻译概念
    if (isEmptyRow(r) || isSymbolRow(r)) {
      return { lang: origLang, kind: 'original' as LyricKind }
    }
    // 非翻译歌 → 归原文（含创作者信息、注解堆叠、角色标注）
    if (!isTranslationSong) {
      return { lang: primary, kind: 'original' as LyricKind }
    }
    // 翻译歌：组内非空非符号行按行序拆（第 1 行原文，其余译文）。
    // 创作者信息（作词/Lyrics By）也按行序走——译文的创作者信息跟着译文版本，不被归原文
    const parts = g.filter(x => !isEmptyRow(x) && !isSymbolRow(x))
    if (parts.length < 2) {
      // 单行组 = 公共行（No nonono 等），归原文（显示/API 由 fillCommonRows 补进各译文）
      return { lang: origLang, kind: 'original' as LyricKind }
    }
    const pos = parts.findIndex(x => x.seq === r.seq) + 1
    const l = detectLang(r.text)
    const lang = l === 'unknown' ? origLang : l
    return pos === 1
      ? { lang, kind: 'original' as LyricKind }
      : { lang, kind: 'translation' as LyricKind }
  })

  // 组装 versions（按 lang+kind 分组，元数据行归原文版本）
  const map = new Map<string, LyricVersion>()
  const ensure = (lang: string, kind: LyricKind) => {
    const key = `${lang}|${kind}`
    let v = map.get(key)
    if (!v) { v = { lang, kind, rows: [] }; map.set(key, v) }
    return v
  }
  for (const m of meta) ensure(origLang, 'original').rows.push(m)
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
    .select('version_id,lang,kind,seq,time_ms,end_ms,text')
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

/** 全量替换一个歌词版本的行表（默认 = 该歌 lrc/enhanced 用户版本）。
 *  写库走 save_lyric_lines RPC：删旧→插新→刷 langs 单事务，中途失败整体回滚（B1 修复） */
export async function saveLyricLines(songId: string, versions: LyricVersion[], versionId?: string): Promise<void> {
  const vid = versionId || await resolveDefaultLinesVersionId(songId)
  const rows: any[] = []
  for (const v of versions) {
    const timed = v.rows.filter(r => r.time_ms != null)
    const meta = v.rows.filter(r => r.time_ms == null)
    const all = [...meta, ...timed]
    all.forEach((r, i) => {
      rows.push({ lang: v.lang, kind: v.kind, seq: i + 1, time_ms: r.time_ms, end_ms: r.end_ms, text: r.text })
    })
  }
  // langs 摘要维护：行表变化后同步刷新该版本的语言摘要
  const langs = [...new Set(versions.map(v => v.lang).filter(Boolean))]
  const { error } = await supabase.rpc('save_lyric_lines', {
    p_song_id: songId,
    p_version_id: vid,
    p_rows: rows,
    p_langs: langs,
  })
  if (error) throw error
}

/** 调用 SQL 拆行函数重拆一首歌（编辑 lrc_text 整体改动后用，SECURITY DEFINER 仅 authenticated） */
export async function rebuildLyricLines(songId: string): Promise<void> {
  const { error } = await supabase.rpc('rebuild_song_lyric_lines', { p_song_id: songId })
  if (error) throw error
}
