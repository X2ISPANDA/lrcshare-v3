import { marked } from 'marked'
import DOMPurify from 'isomorphic-dompurify'

// referrer 由 index.html 的 <meta name="referrer" content="no-referrer"> 全局控制，这里不用管
marked.use({
  gfm: true,
  breaks: true,
  renderer: {
    image(token) {
      const { href, title, text } = token
      const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
      const src = escape(href)
      const alt = escape(text || '')
      const t = title ? ` title="${escape(title)}"` : ''
      return `<img src="${src}" alt="${alt}"${t} loading="lazy" />`
    },
  },
})

/** HTML 白名单消毒（防存储型 XSS）：保留常见展示标签/属性（table/span/div/style/class/target 等），
 *  剥除 <script>、事件处理器（on*）、javascript:/data: 链接。同构：浏览器走原生 DOM，SSG 构建走 jsdom。
 *  用于直接渲染库内 HTML 的入口（如关于页内容——历史数据为 marked 转好后存库的 HTML） */
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return ''
  return DOMPurify.sanitize(html, {
    // 富文本外链新窗口（marked renderer 与历史 HTML 均可能带 target）
    ADD_ATTR: ['target'],
  })
}

/** Markdown 转 HTML（文章详情页/文本歌词渲染，支持 md 语法 + 内嵌 HTML 标注）；
 *  marked 对内嵌 HTML 直通，输出统一过白名单消毒 */
export function mdToHtml(md: string | null | undefined): string {
  if (!md) return ''
  // 移除每行 4 空格缩进，避免被 marked 解析为代码块
  const content = md.replace(/^ {4}/gm, '')
  try {
    return sanitizeHtml(marked.parse(content, { async: false }) as string)
  } catch {
    // marked 极端失败兜底：原文按纯文本转义，绝不过 v-html 裸渲染
    return content.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  }
}

/** Markdown 转纯文本摘要（SSG 安全：无 DOM 依赖，纯字符串处理） */
export function mdToText(md: string | null | undefined, maxLen = 80): string {
  if (!md) return ''
  let html = md
  try {
    html = marked.parse(md, { async: false }) as string
  } catch {
    // 解析失败保底用原文
  }
  const text = html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text
}
