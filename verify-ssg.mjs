import { readFileSync, writeFileSync } from 'node:fs'

const h = readFileSync('dist/index.html', 'utf8')
// 抽取歌曲列表渲染片段（前 3 个 song 链接及其后 200 字符）
const matches = [...h.matchAll(/href="\/song\/(s_[a-z0-9_]+)"/g)].slice(0, 3)
let out = ''
for (const m of matches) {
  const i = m.index
  out += h.substring(i - 120, i + 240).replace(/></g, '>\n<') + '\n----\n'
}
writeFileSync('dist-snippet.txt', out, 'utf8')
console.log('written', matches.length)
