/**
 * 更新日志同步脚本
 *
 * 数据源：src/data/changelog.ts（结构化，主站 /changelog 页与本脚本共同消费）
 *
 * 用法：
 *   node scripts/sync-readme-changelog.mjs                 默认：changelog.ts → README.md「更新日志」章节
 *   node scripts/sync-readme-changelog.mjs --from-readme   反向：README.md「更新日志」章节 → 生成 changelog.ts（一次性迁移用）
 *
 * 规则：
 * - changelog.ts 的数据段为严格 JSON 兼容字面量（export const changelog: ChangelogDate[] = [ ... ]），
 *   本脚本截取首个 '[' 到末个 ']' 之间 JSON.parse，故手工编辑时勿在数据段使用注释/尾逗号/单引号
 * - README 的「更新日志」章节位于 `## 更新日志` 与下一个 `## `（联系）之间，整段替换
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const README = join(root, 'README.md')
const CHANGELOG_TS = join(root, 'src/data/changelog.ts')

/** 读取 changelog.ts 的数据段（JSON 兼容） */
function readChangelog() {
  const ts = readFileSync(CHANGELOG_TS, 'utf8')
  // 从 export 语句之后找数据段（注释里的 ChangelogDate[] 不能算）
  const anchor = ts.indexOf('export const changelog')
  const eq = ts.indexOf('=', anchor)
  const start = ts.indexOf('[', eq)
  const end = ts.lastIndexOf(']')
  if (anchor < 0 || start < 0 || end < 0) throw new Error('changelog.ts 数据段未找到')
  return JSON.parse(ts.slice(start, end + 1))
}

/** changelog 数据 → README「更新日志」章节文本 */
function renderReadmeSection(data) {
  const lines = ['## 更新日志', '', '> 主站浏览版（按日期归档、可折叠展开）：[lrcshare.com/changelog](https://lrcshare.com/changelog)', '']
  for (const day of data) {
    lines.push(`### ${day.date}`, '')
    for (const e of day.entries) {
      if (e.body && e.body.trim()) lines.push(`- **${e.title}**：${e.body.trim()}`)
      else lines.push(`- **${e.title}**`)
    }
    lines.push('')
  }
  return lines.join('\n')
}

/** README「更新日志」章节 → changelog 数据（迁移/兜底解析） */
function parseReadmeChangelog() {
  const md = readFileSync(README, 'utf8')
  const start = md.indexOf('## 更新日志')
  const next = md.indexOf('\n## ', start + 5)
  const section = md.slice(start, next < 0 ? md.length : next)

  const days = []
  let cur = null
  for (const raw of section.split('\n')) {
    const dateM = raw.match(/^###\s+(\d{4}-\d{2}-\d{2})\s*$/)
    if (dateM) {
      cur = { date: dateM[1], entries: [] }
      days.push(cur)
      continue
    }
    const itemM = raw.match(/^-\s+(.+?)\s*$/)
    if (!itemM || !cur) continue
    const text = itemM[1]
    // 跳过引用/说明行（> 开头已被过滤，这里双保险）
    if (text.startsWith('>')) continue
    const bold = text.match(/^\*\*(.+?)\*\*(?:[：:]\s*([\s\S]*))?$/)
    if (bold) {
      cur.entries.push(bold[2] && bold[2].trim() ? { title: bold[1].trim(), body: bold[2].trim() } : { title: bold[1].trim() })
    } else {
      // 无粗体标题的旧条目：取首个冒号/句号前（≤40 字）为标题，全文为正文
      const head = text.match(/^([^：:。！？!?]{4,40})[：:。！？!?]/)
      const title = head ? head[1].trim() : text.slice(0, 40)
      cur.entries.push({ title, body: text })
    }
  }
  return days
}

function writeReadme(data) {
  const md = readFileSync(README, 'utf8')
  const start = md.indexOf('## 更新日志')
  const next = md.indexOf('\n## ', start + 5)
  if (start < 0) throw new Error('README 未找到「## 更新日志」章节')
  const section = renderReadmeSection(data)
  const nextMd = next < 0 ? md.slice(0, start) + section : md.slice(0, start) + section + md.slice(next + 1)
  writeFileSync(README, nextMd, 'utf8')
}

function writeChangelogTs(data) {
  const banner = `/**
 * 更新日志数据（单一数据源）
 *
 * - 主站 /changelog 页消费本文件（按日期归档、标题折叠展开正文）
 * - README.md 的「更新日志」章节由 scripts/sync-readme-changelog.mjs 从本文件生成，勿手改 README 那一段
 * - 维护方式：在最新日期下追加条目（或新增日期组），然后运行 npm run changelog:sync
 * - 数据段为严格 JSON 兼容字面量：双引号、无注释、无尾逗号（脚本按 JSON 解析）
 */
export interface ChangelogEntry {
  /** 条目标题（一句话说清主要改了什么，折叠态可见） */
  title: string
  /** 正文（markdown，折叠展开后显示；纯标题条目可省略） */
  body?: string
}

export interface ChangelogDate {
  /** 日期 YYYY-MM-DD（最新在最前） */
  date: string
  entries: ChangelogEntry[]
}

export const changelog: ChangelogDate[] = `
  mkdirSync(dirname(CHANGELOG_TS), { recursive: true })
  writeFileSync(CHANGELOG_TS, banner + JSON.stringify(data, null, 2) + '\n', 'utf8')
}

const fromReadme = process.argv.includes('--from-readme')
if (fromReadme) {
  const data = parseReadmeChangelog()
  writeChangelogTs(data)
  const n = data.reduce((s, d) => s + d.entries.length, 0)
  console.log(`[changelog] README → src/data/changelog.ts：${data.length} 个日期 / ${n} 条`)
} else {
  const data = readChangelog()
  writeReadme(data)
  const n = data.reduce((s, d) => s + d.entries.length, 0)
  console.log(`[changelog] src/data/changelog.ts → README.md：${data.length} 个日期 / ${n} 条`)
}
