import { marked } from 'marked'

/** Markdown 转 HTML（文章详情页渲染，逻辑迁移自 v2 post.html） */
export function mdToHtml(md: string | null | undefined): string {
  if (!md) return ''
  // 移除每行 4 空格缩进，避免被 marked 解析为代码块
  const content = md.replace(/^ {4}/gm, '')
  try {
    return marked.parse(content, { async: false }) as string
  } catch {
    return content
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
