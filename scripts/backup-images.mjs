// @ts-check
/**
 * 存量图片 OSS 备份回填脚本（一次性 / 可重复执行）
 *
 * 作用：把 7 张表 8 个图片列里已有的外链图片转存到阿里云 OSS，并把地址写回 *_backup 列。
 * 新增/变更的图片由后台保存链路（adminApi → /api/image-backup）自动转存，
 * 本脚本负责补齐：存量历史数据、或保存时转存失败的遗留行。
 *
 * 特性：
 *   - 内容寻址（SHA-256）：同一张图物理只存一份，函数库内已做 HEAD 去重；
 *   - 幂等可重跑：只处理"主列有值且备份列为空"的行，已回填的自动跳过；
 *   - DRY_RUN=1 只打印不写库、不上传；
 *   - 单行失败不中断，结尾汇总失败清单；
 *   - 走 Supabase HTTPS REST（service_role），无需 5432 端口直连。
 *
 * 运行（项目根目录，Node 18+）：
 *   # 推荐：在项目根目录建 .env.backup.local（文件名匹配 *.local，已被 git 忽略），填入：
 *   #   SUPABASE_URL=https://<ref>.supabase.co
 *   #   SUPABASE_SERVICE_ROLE_KEY=<service_role 密钥>
 *   #   OSS_REGION=cn-shanghai
 *   #   OSS_BUCKET=lrcshare
 *   #   OSS_ACCESS_KEY_ID=<RAM 子账号 AK>
 *   #   OSS_ACCESS_KEY_SECRET=<RAM 子账号 SK>
 *   # 先空跑预览，再正式执行：
 *   $env:DRY_RUN="1"; node scripts/backup-images.mjs
 *   Remove-Item Env:DRY_RUN; node scripts/backup-images.mjs
 *   # 可选：只处理某张表
 *   node scripts/backup-images.mjs --table=albums
 *   （也支持临时用 PowerShell $env: 注入同 6 个变量，进程环境变量优先级高于文件）
 */
import { backupImage, isAliyunOssUrl } from '../netlify/functions/_lib/oss.mjs'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

/**
 * 读取项目根目录 .env.backup.local（已在 .gitignore，密钥仅留本机）：
 * 文件内容为 KEY=VALUE，每行一个；已存在的进程环境变量优先级更高（PowerShell $env: 可覆盖）。
 * 这样只需在文件里填一次，后续正式跑/重跑都不用重复输入。
 */
function loadLocalEnv() {
  const envFile = join(dirname(dirname(fileURLToPath(import.meta.url))), '.env.backup.local')
  if (!existsSync(envFile)) return
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const s = line.trim()
    if (!s || s.startsWith('#')) continue
    const eq = s.indexOf('=')
    if (eq < 0) continue
    const k = s.slice(0, eq).trim()
    let v = s.slice(eq + 1).trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (k && !(k in process.env)) process.env[k] = v
  }
}
loadLocalEnv()

const SUPABASE_URL = process.env.SUPABASE_URL
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true'
const PAGE_SIZE = 100

/** 与 sql/19、adminApi 白名单保持一致：表 + 主列 + 备份列 */
const TARGETS = [
  { table: 'albums',       src: 'cover',     backup: 'cover_backup' },
  { table: 'artists',      src: 'avatar',    backup: 'avatar_backup' },
  { table: 'artists',      src: 'bg_image',  backup: 'bg_image_backup' },
  { table: 'songs',        src: 'cover',     backup: 'cover_backup' },
  { table: 'contributors', src: 'avatar',    backup: 'avatar_backup' },
  { table: 'articles',     src: 'cover',     backup: 'cover_backup' },
  { table: 'friends',      src: 'avatar',    backup: 'avatar_backup' },
  { table: 'music_shares', src: 'cover_url', backup: 'cover_url_backup' },
]

function rest(path, options = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
}

/** 分页拉取待回填行：主列非空 且 备份列为空，按 id 稳定翻页 */
async function fetchPending(target) {
  const { table, src, backup } = target
  const select = encodeURIComponent(`${src},${backup}`)
  const or = encodeURIComponent(`${backup}.is.null,${backup}.eq.`)
  const rows = []
  let from = 0
  for (;;) {
    const res = await rest(
      `${table}?select=id,${select}&${src}=not.is.null&${src}=neq.&or=(${or})&order=id.asc&limit=${PAGE_SIZE}&offset=${from}`,
    )
    if (!res.ok) throw new Error(`读取 ${table} 失败：HTTP ${res.status} ${await res.text()}`)
    const page = await res.json()
    rows.push(...page)
    if (page.length < PAGE_SIZE) break
    from += PAGE_SIZE
  }
  return rows
}

async function patchBackup(target, id, url) {
  const { table, backup } = target
  const res = await rest(`${table}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: JSON.stringify({ [backup]: url }),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status} ${await res.text()}`)
}

async function main() {
  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error('缺少环境变量 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY')
    process.exit(1)
  }
  const onlyTable = (process.argv.find(a => a.startsWith('--table=')) || '').split('=')[1]
  const targets = onlyTable ? TARGETS.filter(t => t.table === onlyTable) : TARGETS
  if (!targets.length) {
    console.error(`没有匹配的表：${onlyTable}（可选：${[...new Set(TARGETS.map(t => t.table))].join(', ')}）`)
    process.exit(1)
  }

  console.log(`模式：${DRY_RUN ? 'DRY_RUN（只预览，不写库/不上传）' : '正式执行'}`)
  const totals = { pending: 0, uploaded: 0, cached: 0, alreadyOss: 0, failed: 0 }
  const failed = []

  for (const target of targets) {
    const label = `${target.table}.${target.src} → ${target.backup}`
    let rows
    try {
      rows = await fetchPending(target)
    } catch (e) {
      console.error(`✗ ${label} 扫描失败：${e.message}（请先在 Supabase 执行 sql/19）`)
      totals.failed++
      continue
    }
    console.log(`\n== ${label}：待处理 ${rows.length} 行 ==`)
    totals.pending += rows.length

    for (const row of rows) {
      const srcUrl = String(row[target.src] || '').trim()
      if (!srcUrl) continue
      try {
        let backupUrl
        if (isAliyunOssUrl(srcUrl)) {
          // 主列本身就是 OSS 地址：备份列直接指向它，无需抓取上传
          backupUrl = srcUrl
          totals.alreadyOss++
        } else {
          if (DRY_RUN) {
            console.log(`  [DRY] ${row.id}  ${srcUrl.slice(0, 90)}`)
            continue
          }
          const r = await backupImage(srcUrl)
          backupUrl = r.url
          if (r.cached) totals.cached++
          else totals.uploaded++
        }
        if (!DRY_RUN) await patchBackup(target, row.id, backupUrl)
        console.log(`  ✓ ${row.id}  ${srcUrl.slice(0, 70)}`)
      } catch (e) {
        totals.failed++
        failed.push({ target: label, id: row.id, url: srcUrl, reason: e?.message || String(e) })
        console.log(`  ✗ ${row.id}  ${e?.message || e}`)
      }
    }
  }

  console.log('\n============ 汇总 ============')
  console.log(`待处理：${totals.pending}`)
  if (DRY_RUN) {
    console.log('DRY_RUN 未实际上传/写库；确认无误后去掉 DRY_RUN 再跑。')
  } else {
    console.log(`新上传：${totals.uploaded}　已存在复用：${totals.cached}　主列本就是OSS：${totals.alreadyOss}`)
    console.log(`失败：${totals.failed}`)
    if (failed.length) {
      console.log('\n失败清单（修复网络/图源后重跑本脚本即可，已成功的不会重复处理）：')
      for (const f of failed) console.log(`  - [${f.target}] ${f.id}  ${f.reason}\n    ${f.url}`)
    }
    console.log(failed.length ? '\n存在失败项，建议处理后重跑。' : '\n全部完成。')
  }
}

main().catch(e => {
  console.error('脚本异常中断：', e)
  process.exit(1)
})
