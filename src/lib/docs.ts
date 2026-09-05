/**
 * 站内开发文档数据源
 *
 * 文档本体即仓库 sql/01-09 演进文档（markdown），构建时通过 import.meta.glob 全量内联
 * （?raw 原始字符串），SSG 预渲染为真实 HTML——无数据库、无运行时请求、无额外部署；
 * 改 sql 目录的 md 后随主站下次发布自动更新。
 */

// eager：构建时一次性内联全部文档（9 篇，体积可控），运行时/SSG 直接读
const modules = import.meta.glob('../../sql/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

export interface DocItem {
  /** 路由 slug = 文件名（不含扩展名），如 01-contributors-evolution */
  slug: string
  /** 序号，如 "01" */
  num: string
  /** 去掉序号前缀的标题（侧边栏/卡片用） */
  title: string
  /** md 首行原始标题（含序号） */
  rawTitle: string
  /** 「一句话现状」摘要（列表页用） */
  summary: string
  /** markdown 原文 */
  content: string
}

export const docs: DocItem[] = Object.entries(modules)
  .map(([path, content]) => {
    const file = path.split('/').pop()!.replace(/\.md$/, '')
    const num = file.slice(0, 2)
    const rawTitle = content.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? file
    // 去掉「01 · 」/「01 - 」类序号前缀
    const title = rawTitle.replace(/^\d+\s*[·・\-—]\s*/, '')
    const summary = content.match(/##\s*一句话现状\s*\n+([^\n]+)/)?.[1]?.trim() ?? ''
    return { slug: file, num, title, rawTitle, summary, content }
  })
  .sort((a, b) => a.slug.localeCompare(b.slug))

export function getDoc(slug: string): DocItem | undefined {
  return docs.find(d => d.slug === slug)
}
