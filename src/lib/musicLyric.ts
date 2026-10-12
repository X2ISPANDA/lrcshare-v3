/**
 * 歌曲分享 · 歌词解析与拉取（只服务播放器：Dock 单行歌词 + 独立歌词页）
 *
 * 链路：Netlify 函数 music-lyric 实时拉网易云 LRC → 本文件解析为带秒级时间轴的行数组
 * （歌词不入库；模块级 Promise 缓存保证同一曲目全站只请求一次，并吞掉并发重复请求）。
 *
 * 与站内歌词库编辑器（lyricLines.ts，面向多版本/TTML 的重型工具）刻意区分：
 * 播放器只需要「时间戳 + 单行文本 + 可选译文」，不引入版本/语种轨道等概念。
 */
import { api } from '@/lib/api'
import type { MusicPlatformKey } from '@/lib/musicPlatforms'

/** 一行可播放歌词：时间（秒）+ 原文 + 可选译文（网易云 tlyric，多为外文歌中文翻译） */
export interface MusicLyricLine {
  time: number
  text: string
  trans: string | null
}

/** 解析后的歌词：纯音乐时 lines 为空、instrumental=true */
export interface MusicLyric {
  lines: MusicLyricLine[]
  instrumental: boolean
}

/**
 * LRC 时间标签：[mm:ss.xx] / [mm:ss.xxx]（兼容两位/三位毫秒与无毫秒写法）。
 * 一行可能挂多个时间戳（同词复唱），解析时全部展开。
 */
const TIME_TAG_RE = /\[\s*(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?\s*\]/g

/**
 * 词曲编署名 / 制作发行等元信息行：这些行带前奏时间戳但不是歌词，
 * 播到开头时把「作词 : XX」当歌词高亮会很奇怪，解析阶段直接剔除。
 * 仅匹配行首，正文以这些词开头的极端误杀概率可接受。
 */
const META_LINE_RE =
  /^\s*(?:作词|作曲|填词|词曲|英文词|英文曲|中文词|原词|原曲|编曲|改编|制作人?|制片人?|出品|发行(?:人|公司|时间)?|策划|企划|监制|总监|统筹|艺人|经纪(?:公司|人)?|宣传|封面|设计|排版|版权管理|和声(?:编写|监制)?|声乐指导|混音(?:师|室)?|母带(?:工程师?)?|录音(?:师|棚|室|工程师)?|吉他|贝斯|鼓手?|键盘(?:手)?|钢琴|弦乐(?:编写|监制)?|小提琴|大提琴|programming|vocal(?:ist)?|op|sp|isrc|lc|词|曲|编|监)\s*[:：/]/i

/** 把毫秒分数（"5" / "50" / "500"）补成毫秒整数 */
function fractionToMs(frac?: string): number {
  if (!frac) return 0
  if (frac.length === 1) return Number(frac) * 100
  if (frac.length === 2) return Number(frac) * 10
  return Number(frac.slice(0, 3))
}

/**
 * 解析单个 LRC 文本 → 时间戳到文本的映射（同戳多标签展开；剔除署名等元信息行）。
 * 返回数组按时间升序；无时间戳的纯文本行（ID 标签等）忽略。
 */
function parseOneLrc(lrc: string): { time: number; text: string }[] {
  const out: { time: number; text: string }[] = []
  for (const rawLine of lrc.split(/\r?\n/)) {
    TIME_TAG_RE.lastIndex = 0
    const tags: number[] = []
    let m: RegExpExecArray | null
    while ((m = TIME_TAG_RE.exec(rawLine))) {
      const min = Number(m[1])
      const sec = Number(m[2])
      const time = min * 60 + sec + fractionToMs(m[3]) / 1000
      if (Number.isFinite(time)) tags.push(time)
    }
    if (!tags.length) continue
    const text = rawLine.replace(TIME_TAG_RE, '').trim()
    if (!text) continue
    // 词曲编/制作发行等前奏署名行不当作歌词
    if (META_LINE_RE.test(text)) continue
    for (const time of tags) out.push({ time, text })
  }
  return out.sort((a, b) => a.time - b.time)
}

/** 解析原文 + 译文 LRC 为播放用行数组（译文按相同时间戳挂载，对不上的译文丢弃避免错位） */
export function parseLrcPair(lrc: string | null, tlyric: string | null): MusicLyricLine[] {
  if (!lrc) return []
  const main = parseOneLrc(lrc)
  if (!main.length) return []

  let transMap: Map<number, string> | null = null
  if (tlyric) {
    const trans = parseOneLrc(tlyric)
    if (trans.length) {
      transMap = new Map()
      for (const t of trans) transMap.set(Math.round(t.time * 1000), t.text)
    }
  }

  // 同时间戳原文去重（复唱标签已展开，正常不会重复；防御上游脏数据）
  const seen = new Set<number>()
  const lines: MusicLyricLine[] = []
  for (const item of main) {
    const key = Math.round(item.time * 1000)
    if (seen.has(key)) continue
    seen.add(key)
    lines.push({ time: item.time, text: item.text, trans: transMap?.get(key) ?? null })
  }
  return lines
}

/** 缓存键：平台 + 曲目 ID */
function cacheKey(platform: string, id: string): string {
  return `${platform}:${id}`
}

/**
 * 模块级缓存：值为进行中或已完成的 Promise。
 * - 并发同时拉同一首（Dock 单行 + 歌词页几乎同时挂载）共用同一请求；
 * - 失败不缓存（删掉键，允许下次重试）。
 */
const lyricCache = new Map<string, Promise<MusicLyric>>()

/**
 * 拉取并解析某平台曲目歌词（当前仅 netease 由后端函数支持）。
 * 纯音乐返回 { lines: [], instrumental: true }；上游「无歌词」按空歌词处理。
 */
export function fetchMusicLyric(platform: MusicPlatformKey, id: string): Promise<MusicLyric> {
  const key = cacheKey(platform, id)
  const hit = lyricCache.get(key)
  if (hit) return hit

  const p = (async (): Promise<MusicLyric> => {
    try {
      const data = await api.getMusicLyric(platform, id)
      if (data.instrumental) return { lines: [], instrumental: true }
      const lines = parseLrcPair(data.lrc, data.tlyric)
      // 兜底：接口未标 nolyric，但解析后没有任何有效歌词行（常见于网友给纯音乐
      // 上传的「伪歌词」：全文只有词曲编署名 + 一句「纯音乐，请欣赏」）。
      // 无有效行、或仅剩的有效行全部是纯音乐提示时，按纯音乐处理，避免浮层只剩孤零零一行。
      const allHint = lines.length > 0 && lines.every(l => /^[\s♪♫·…]*纯音乐|请欣赏[\s♪♫·…]*$|instrumental/i.test(l.text))
      if ((!lines.length || allHint) && data.lrc && /纯音乐|请欣赏|instrumental/i.test(data.lrc)) {
        return { lines: [], instrumental: true }
      }
      return { lines, instrumental: false }
    } catch (err) {
      // 失败不缓存：下次进入可重试
      lyricCache.delete(key)
      throw err
    }
  })()

  lyricCache.set(key, p)
  return p
}

/**
 * 按播放进度找当前歌词行下标（二分；lines 已按时间升序）。
 * - 前奏（position 早于第一行）返回 -1；
 * - 空行数组（纯音乐/无词）返回 -1。
 */
export function findActiveLineIndex(lines: MusicLyricLine[], position: number): number {
  if (!lines.length || position < lines[0].time) return -1
  let lo = 0
  let hi = lines.length - 1
  while (lo < hi) {
    // 上取整中点，保证 lo/hi 收敛
    const mid = (lo + hi + 1) >> 1
    if (lines[mid].time <= position) lo = mid
    else hi = mid - 1
  }
  return lo
}
