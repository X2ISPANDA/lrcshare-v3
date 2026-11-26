/** cloudflare/shared/lang.mjs 的类型声明（前端 TS import .mjs 时自动解析本文件） */

/** TTML xml:lang（BCP47）→ 站内语言码核心规则；空值返回 null */
export declare function normalizeTtmlLang(
  raw: string,
): string | null

/** 站内语言码 → TTML 输出 BCP47（zh → zh-Hans，其余原样） */
export declare function lrcLangToTtml(lang: string): string

/** 单行文字系统语言判定；无法判定返回 null（前端包装为 'unknown'） */
export declare function detectLang(text: string): string | null
