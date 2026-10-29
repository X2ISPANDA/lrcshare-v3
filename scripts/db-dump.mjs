// @ts-check
/**
 * Supabase 全量灾备导出
 *   → 逐表 SELECT * → 按外键 Phase 顺序打包 → gzip 压缩 → 推 OSS db-backup/
 *
 * 用法：
 *   手动：node scripts/db-dump.mjs
 *   GitHub Actions：workflow 自动调，注入 secrets 里的环境变量
 *
 * 环境变量：
 *   VITE_SUPABASE_URL         Supabase 项目 URL
 *   SUPABASE_SERVICE_ROLE_KEY service_role 密钥（需要，因为要读 RLS 保护的表）
 *   OSS_REGION / OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET
 *   OSS_DB_BACKUP_PREFIX      可选，默认 db-backup
 *
 * 输出：
 *   OSS key: {prefix}/YYYYMMDD-HHMMSS.json.gz
 *   本地落盘：./backup/latest.json.gz（可选，方便手动验证）
 */
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import { gzipSync } from 'fflate'
import { putObject } from '../netlify/functions/_lib/oss.mjs'

// 优先加载 .env.backup.local（dump/pull/restore 专用的密钥文件，已在 .gitignore 里）
// 注：dotenv 不会覆盖已存在的 process.env（GitHub Actions 已注入的 secrets 不会被覆盖）
import fs from 'node:fs'
import path from 'node:path'
const dotenv = (await import('dotenv')).default
const backupEnv = path.resolve('.env.backup.local')
if (fs.existsSync(backupEnv)) {
  dotenv.config({ path: backupEnv, override: false })
}

// ── 外键依赖顺序（Phase）：restore 时必须按这个顺序 INSERT ──
// Phase 1 — 根表，无外键依赖
const PHASE_1 = [
  'settings',
  'contributors',
  'artists',
  'albums',
  'sponsors',
  'articles',
  'friend_categories',
  'mail_logs',
]
// Phase 2 — 依赖根表
const PHASE_2 = [
  'album_contributors',   // album_id→albums.id, contributor_id→contributors.id
  'songs',                 // album_id→albums.id, contributor_id→contributors.id
  'song_secrets',          // song_id→songs.id
]
// Phase 3 — 依赖 songs
const PHASE_3 = [
  'song_contributors',     // song_id→songs.id, artist_id→artists.id
  'lyric_versions',        // song_id→songs.id, contributor_id→contributors.id
  'song_lyric_doubts',     // song_id→songs.id
]
// Phase 4 — 依赖 lyric_versions
const PHASE_4 = [
  'song_lyric_lines',      // lyric_version_id→lyric_versions.id
]
// Phase 5 — 独立业务表（contributor_id 是外键但 ON DELETE SET NULL，不强依赖）
const PHASE_5 = [
  'submissions',           // contributor_id→contributors.id
  'music_shares',          // contributor_id→contributors.id
  'friends',               // category_id→friend_categories.id
]

const ALL_TABLES = [...PHASE_1, ...PHASE_2, ...PHASE_3, ...PHASE_4, ...PHASE_5]

const OSS_PREFIX = process.env.OSS_DB_BACKUP_PREFIX || 'db-backup'
const DRY_RUN = process.argv.includes('--dry-run')
const SAVE_LOCAL = !process.argv.includes('--no-local')
const NO_OSS = process.argv.includes('--no-oss')
// 支持 --output=PATH 和 --output PATH 两种写法
const OUTPUT_IDX = process.argv.findIndex(a => a === '--output' || a.startsWith('--output='))
let OUTPUT_PATH = null
if (OUTPUT_IDX !== -1) {
  const arg = process.argv[OUTPUT_IDX]
  OUTPUT_PATH = arg.startsWith('--output=')
    ? arg.slice(9)
    : process.argv[OUTPUT_IDX + 1]
  OUTPUT_PATH = OUTPUT_PATH ? path.resolve(OUTPUT_PATH) : null
}

function checkEnv() {
  const missing = []
  if (!process.env.VITE_SUPABASE_URL) missing.push('VITE_SUPABASE_URL')
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('SUPABASE_SERVICE_ROLE_KEY')
  if (missing.length) {
    console.error(`❌ 缺少环境变量：${missing.join(', ')}`)
    process.exit(1)
  }
}

async function dumpTable(supabase, table) {
  // 分页 select：Supabase REST 默认每页 1000，大表自动翻页
  const rows = []
  let from = 0
  const pageSize = 1000
  let hasMore = true
  while (hasMore) {
    const { data, error, count } = await supabase
      .from(table)
      .select('*', { count: 'exact' })
      .range(from, from + pageSize - 1)
    if (error) {
      console.error(`  ❌ ${table} 导出失败：${error.message}`)
      throw error
    }
    rows.push(...(data || []))
    hasMore = rows.length < count
    from += pageSize
  }
  return rows
}

async function main() {
  console.log('📦 LrcShare 数据库灾备导出')
  console.log(`   时间：${new Date().toISOString()}`)

  checkEnv()
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  )

  console.log(`\n📊 共 ${ALL_TABLES.length} 张表，按 Phase 顺序导出：`)
  const dumpData = {
    exported_at: new Date().toISOString(),
    schema_version: 1,
    tables: {},
    schema: null, // 由 export_schema() RPC 填充，作为 OSS 侧冗余
  }

  let totalRows = 0
  for (let i = 0; i < ALL_TABLES.length; i++) {
    const table = ALL_TABLES[i]
    process.stdout.write(`   [${i + 1}/${ALL_TABLES.length}] ${table} ... `)
    try {
      const rows = await dumpTable(supabase, table)
      dumpData.tables[table] = rows
      totalRows += rows.length
      console.log(`${rows.length} 行 ✅`)
    } catch {
      process.exit(1)
    }
  }

  // ── Schema 导出（DDL / RLS / RPC / 触发器）──────────────
  console.log(`\n📐 导出 schema（DDL / RLS / RPC / 触发器）...`)
  try {
    const { data: schemaSql, error: rpcError } = await supabase.rpc('export_schema')
    if (rpcError) {
      console.error(`  ❌ export_schema RPC 失败：${rpcError.message}`)
      console.error(`     请先在 Supabase SQL Editor 运行 db/export_schema.sql 建函数`)
      process.exit(1)
    }
    dumpData.schema = schemaSql || ''
    // 落盘到 db/schema.sql，git 跟踪，方便人工 review
    const schemaDir = path.resolve('./db')
    fs.mkdirSync(schemaDir, { recursive: true })
    const schemaPath = path.join(schemaDir, 'schema.sql')
    fs.writeFileSync(schemaPath, schemaSql || '', 'utf8')
    const schemaKB = (Buffer.byteLength(schemaSql || '', 'utf8') / 1024).toFixed(1)
    console.log(`   ✅ ${schemaPath}（${schemaKB} KB）`)
  } catch (err) {
    console.error(`  ❌ schema 导出异常：${err.message}`)
    process.exit(1)
  }

  const json = JSON.stringify(dumpData)
  const gzipped = gzipSync(Buffer.from(json, 'utf8'))
  const unzippedKB = (Buffer.byteLength(json) / 1024).toFixed(1)
  const gzippedKB = (gzipped.byteLength / 1024).toFixed(1)
  const ratio = ((1 - gzipped.byteLength / Buffer.byteLength(json)) * 100).toFixed(0)
  console.log(`\n📈 导出完成：共 ${totalRows} 行，JSON ${unzippedKB} KB → gzip ${gzippedKB} KB（压缩率 ${ratio}%）`)

  // --output：保存到指定路径（供 pipeline 串联，不自动传 OSS）
  if (OUTPUT_PATH) {
    fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })
    fs.writeFileSync(OUTPUT_PATH, gzipped)
    console.log(`   💾 输出到：${OUTPUT_PATH}`)
  }

  if (DRY_RUN) {
    console.log('   （--dry-run 模式，不上传 OSS）')
    if (SAVE_LOCAL && !OUTPUT_PATH) {
      await saveLocal(gzipped)
    }
    return
  }

  // 推 OSS（--no-oss 时跳过）
  if (!NO_OSS) {
    const dateTag = new Date().toISOString().slice(0, 19).replace(/[-T:]/g, '')
    const ossKey = `${OSS_PREFIX}/${dateTag}.json.gz`
    console.log(`\n☁️  上传 OSS → ${ossKey}`)
    try {
      const url = await putObject(ossKey, gzipped, 'application/gzip')
      console.log(`   ✅ ${url}`)
    } catch (err) {
      console.error(`   ❌ OSS 上传失败：${err.message}`)
      process.exit(1)
    }
  } else {
    console.log('   （--no-oss，跳过 OSS 上传）')
  }

  if (SAVE_LOCAL && !OUTPUT_PATH) {
    await saveLocal(gzipped)
  }

  console.log('\n🎉 灾备完成！')
}

async function saveLocal(buf) {
  const fs = await import('node:fs')
  const path = await import('node:path')
  const dir = path.resolve('./backup')
  fs.mkdirSync(dir, { recursive: true })
  const localPath = path.join(dir, 'latest.json.gz')
  fs.writeFileSync(localPath, buf)
  console.log(`   💾 本地副本：${localPath}`)
}

main().catch(err => {
  console.error('❌ 灾备导出异常：', err)
  process.exit(1)
})
