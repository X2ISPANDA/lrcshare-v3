/**
 * LrcShare 语言码规则共享模块（单一来源）
 *
 * 使用方：
 *   - cloudflare/open-api.js        （CF Worker，wrangler esbuild 打包）
 *   - cloudflare/ttml-sync/worker.js（CF Worker + Node/GHA 脚本共用）
 *   - src/lib/lyricLines.ts         （前端，类型经同名 lang.d.mts 提供）
 *
 * 规则变更只改本文件（历史上三端手抄已发生过漂移：detectLang 的汉字/拉丁
 * 字符区间两端不一致、zh 组匹配大小写容错不一致——v1.4.2 曾三处同改）。
 */

/**
 * TTML xml:lang（BCP47）→ 站内语言码核心规则（三端统一）：
 * - 剥 `xml:` 前缀（属性名误传容错）+ trim；空值返回 null（各端自行适配 '' / 'und'）；
 * - 大小写不敏感（BCP47 标签大小写无语义）；
 * - 简体组 → 'zh'；繁体组（zh-Hant/HK/MO/TW 及无 script 的 zh-HK/zh-MO/zh-TW）
 *   统一 → 'zh-Hant'（不再按地区细分：下游播放器按 Apple 标准粗标签精确匹配，细分会 miss）；
 *   粤语 'yue'/'zh-yue' 正文 → 'zh-Hant'（Apple 生态惯例，粤语身份由 Cantopop 曲风承载）；
 * - foldToBase=false（默认）：其余标签原样保留——含 zh-Latn-jyutping / ja-Latn 等
 *   BCP47 拉丁化音译标签（跟随国际标准，不折叠站内码），open-api 合成端用；
 * - foldToBase=true：未知标签折叠到主子标签（en-US → en），ttml-sync langs 摘要用
 *   （已知组先匹配再折叠，与折叠端原实现行为一致）。
 * @param {string} raw 原始语言标签（可含 xml: 前缀）
 * @param {{ foldToBase?: boolean }} [opts]
 * @returns {string | null}
 */
export function normalizeTtmlLang(raw, opts = {}) {
  const v = String(raw || '').replace(/^xml:/i, '').trim()
  if (!v) return null
  const low = v.toLowerCase()
  // 简体
  if (['zh-hans', 'zh-hans-cn', 'zh-cn', 'zh-sg'].includes(low)) return 'zh'
  // 繁体统一归 zh-Hant（港台/地区细分不再区分：下游播放器按 Apple 标准粗标签精确匹配，细分标签会 miss）
  if (['zh-hant', 'zh-hant-hk', 'zh-hk', 'zh-hant-mo', 'zh-mo', 'zh-hant-tw', 'zh-tw'].includes(low)) return 'zh-Hant'
  // 粤语正文统一归 zh-Hant（Apple 生态粤语 TTML 即标繁体中文；粤语身份由 Cantopop 曲风和粤拼音译轨承载）
  if (low === 'yue' || low === 'zh-yue') return 'zh-Hant'
  if (opts.foldToBase) {
    const base = v.split('-')[0]
    return base || null
  }
  return v
}

/**
 * 站内语言码 → TTML 输出 BCP47（简体补文字码 zh → zh-Hans；其余站内码已是合法 BCP47 原样）
 * @param {string} lang
 * @returns {string}
 */
export function lrcLangToTtml(lang) {
  return lang === 'zh' ? 'zh-Hans' : lang
}

/**
 * 单行文字系统语言判定（拉丁文字统一判 en，不细分 fr/de 等，由用户手动改）：
 * 假名→ja / 谚文→ko / 泰→th / 老挝→lo / 藏→bo / 蒙→mn / 缅→my / 高棉→km /
 * 天城文→hi / 阿拉伯→ar / 希伯来→he / 希腊→el / 西里尔→ru / 汉字→zh（含 CJK 扩展A）/
 * 拉丁（含扩展区 é ñ 等）→en / 其他 → null（前端包装为 'unknown'）
 * @param {string} text 行文本（可含 <偏移毫秒> 词标签，自动剥离）
 * @returns {string | null}
 */
export function detectLang(text) {
  const s = String(text || '').replace(/<\d{1,6}>/g, '')
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
