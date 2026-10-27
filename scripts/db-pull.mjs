// @ts-check
/**
 * 本地灾备拉取
 *   → 列 OSS db-backup/ 前缀下最新对象 → 下载到 ./backup/
 *
 * 用法：
 *   node scripts/db-pull.mjs              # 拉最新一份
 *   node scripts/db-pull.mjs --all        # 拉全部历史备份
 *   node scripts/db-pull.mjs --list        # 只列不下载
 *   node scripts/db-pull.mjs --key XXX    # 指定 key 下载（覆盖"最新"逻辑）
 *
 * 环境变量（跟 dump 共用）：
 *   OSS_REGION / OSS_BUCKET / OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET
 *   OSS_DB_BACKUP_PREFIX  可选，默认 db-backup
 */
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { listObjects, getObject } from '../netlify/functions/_lib/oss.mjs'

// 加载 .env.backup.local
const dotenv = (await import('dotenv')).default
const backupEnv = path.resolve('.env.backup.local')
if (fs.existsSync(backupEnv)) {
  dotenv.config({ path: backupEnv, override: false })
}

const OSS_PREFIX = process.env.OSS_DB_BACKUP_PREFIX || 'db-backup'
const LOCAL_DIR = path.resolve('./backup')
const ALL = process.argv.includes('--all')
const LIST_ONLY = process.argv.includes('--list')
const SPECIFIC_KEY = process.argv.find(a => a.startsWith('--key='))?.slice(6)

function parseArgs() {
  return { ALL, LIST_ONLY, SPECIFIC_KEY }
}

async function main() {
  const args = parseArgs()
  console.log('📥 LrcShare 灾备拉取')
  console.log(`   OSS 前缀：${OSS_PREFIX}/`)

  fs.mkdirSync(LOCAL_DIR, { recursive: true })

  const objects = await listObjects(`${OSS_PREFIX}/`)
  if (!objects.length) {
    console.error('❌ OSS 上没有任何备份文件')
    process.exit(1)
  }

  console.log(`   找到 ${objects.length} 份备份`)

  if (args.LIST_ONLY) {
    console.log('\n   备份列表（按时间降序）：')
    for (const obj of objects) {
      const sizeKB = (obj.size / 1024).toFixed(1)
      const localExists = fs.existsSync(path.join(LOCAL_DIR, path.basename(obj.key)))
      console.log(`   ${obj.lastModified}  ${sizeKB.padStart(8)} KB  ${localExists ? '✅' : '⬜'}  ${path.basename(obj.key)}`)
    }
    return
  }

  let targets
  if (args.SPECIFIC_KEY) {
    const fullKey = args.SPECIFIC_KEY.startsWith(OSS_PREFIX) ? args.SPECIFIC_KEY : `${OSS_PREFIX}/${args.SPECIFIC_KEY}`
    targets = objects.filter(o => o.key === fullKey)
    if (!targets.length) {
      console.error(`❌ 找不到指定 key：${fullKey}`)
      process.exit(1)
    }
  } else if (args.ALL) {
    targets = objects
  } else {
    targets = [objects[0]] // 最新一份
  }

  console.log(`\n📦 需要下载 ${targets.length} 份：`)
  for (const obj of targets) {
    const localFile = path.join(LOCAL_DIR, path.basename(obj.key))
    const localExists = fs.existsSync(localFile)
    if (localExists && fs.statSync(localFile).size === obj.size) {
      console.log(`   ⏭️  ${path.basename(obj.key)} 已存在且大小一致，跳过`)
      continue
    }
    process.stdout.write(`   ⬇️  ${path.basename(obj.key)} (${(obj.size / 1024).toFixed(1)} KB) ... `)
    const buf = await getObject(obj.key)
    fs.writeFileSync(localFile, buf)
    console.log('✅')
  }

  // 更新 latest 软链接（Windows 用复制文件代替 symlink，兼容不好）
  if (!args.ALL && targets.length === 1) {
    const latestPath = path.join(LOCAL_DIR, 'latest.json.gz')
    fs.copyFileSync(path.join(LOCAL_DIR, path.basename(targets[0].key)), latestPath)
    console.log(`\n   💾 latest → ${path.basename(targets[0].key)}`)
  }

  console.log('\n🎉 拉取完成！')
}

main().catch(err => {
  console.error('❌ 拉取异常：', err)
  process.exit(1)
})
