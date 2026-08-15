/** 搜索结果高亮与歌词摘要（首页搜索框 / 全局搜索弹窗共用） */

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/** 关键词高亮为 HTML（先转义防 XSS），供 v-html 使用 */
export function highlightHtml(text: string, keyword: string): string {
  if (!text) return ''
  const kw = keyword.trim()
  if (!kw) return escapeHtml(text)
  const escaped = escapeHtml(text)
  const kwEscaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return escaped.replace(new RegExp(`(${kwEscaped})`, 'gi'), '<span class="text-pink-500 font-bold">$1</span>')
}

/** 歌词命中片段：截取关键词前后 25 字符并去掉时间标签 */
export function lrcSnippet(lrcText: string | null | undefined, keyword: string): string {
  const text = lrcText || ''
  const kw = keyword.trim().toLowerCase()
  if (!kw) return ''
  const idx = text.toLowerCase().indexOf(kw)
  if (idx === -1) return ''
  const start = Math.max(0, idx - 25)
  const end = Math.min(text.length, idx + kw.length + 25)
  return text.substring(start, end).replace(/\[.*?\]/g, '')
}
