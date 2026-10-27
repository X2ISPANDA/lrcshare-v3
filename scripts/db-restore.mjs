// @ts-check
/**
 * 数据库灾备恢复
 *   → 读 JSON dump → 按外键 Phase 顺序 → INSERT 到目标数据库
 *
 * 用法：
 *   node scripts/db-restore.mjs --source ./backup/latest.json.gz --target mysql
 *   node scripts/db-restore.mjs --source ./backup/latest.json.gz --target supabase
 *   node scripts/db-restore.mjs --source ./backup/latest.json.gz --target mysql --dry-run     # 只打印 SQL 不执行
 *   node scripts/db-restore.mjs --source ./backup/latest.json.gz --target mysql --truncate     # 清空后再恢复
 *
 * MySQL 环境变量：
 *   MYSQL_HOST     默认 127.0.0.1
 *   MYSQL_PORT     默认 3307
 *   MYSQL_USER     默认 root
 *   MYSQL_PASSWORD 默认 LrcShare@2026
 *   MYSQL_DATABASE 默认 lrcshare
 *
 * Supabase 环境变量：
 *   VITE_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 */
import 'dotenv/config'
import fs from 'node:fs'
import path from 'node:path'
import { gunzipSync } from 'fflate'

// 加载 .env.backup.local
const dotenv = (await import('dotenv')).default
const backupEnv = path.resolve('.env.backup.local')
if (fs.existsSync(backupEnv)) {
  dotenv.config({ path: backupEnv, override: false })
}

// ── Phase 顺序（跟 dump 里一致，restore 必须严格按这个顺序） ──
const PHASE_ORDER = [
  'settings', 'contributors', 'artists', 'albums', 'sponsors',
  'articles', 'friend_categories', 'mail_logs',
  'album_contributors', 'songs', 'song_secrets',
  'song_contributors', 'lyric_versions', 'song_lyric_doubts',
  'song_lyric_lines',
  'submissions', 'music_shares', 'friends',
]

function parseArgs() {
  const args = process.argv.slice(2)
  // 同时支持 --flag=value 和 --flag value 两种形式
  const opts = { source: null, target: null, dryRun: false, truncate: false, backup: false, schema: false }
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--dry-run') { opts.dryRun = true }
    else if (a === '--truncate') { opts.truncate = true }
    else if (a === '--backup') { opts.backup = true }
    else if (a === '--schema') { opts.schema = true }
    else if (a.startsWith('--source=')) { opts.source = a.slice(9) }
    else if (a.startsWith('--target=')) { opts.target = a.slice(9) }
    else if (a === '--source') { opts.source = args[++i] }
    else if (a === '--target') { opts.target = args[++i] }
  }
  return opts
}

function loadDump(sourcePath) {
  let buf = fs.readFileSync(sourcePath)
  if (sourcePath.endsWith('.gz')) buf = gunzipSync(buf)
  const text = Buffer.from(buf).toString('utf8')
  return JSON.parse(text)
}

// ═══════════════════════════════════════════════════════════════
// MySQL 推断 + 恢复
// ═══════════════════════════════════════════════════════════════

/**
 * 从数据样本推断 MySQL 列类型（见注释里的规则表）。
 * 规则：主键 → CHAR(36)，id 外键 → CHAR(36)，时间列 → DATETIME，
 *        布尔列 → TINYINT(1)，数值 → INT/DECIMAL，对象/数组 → JSON，
 *        长文本 → MEDIUMTEXT/TEXT，短字符串 → VARCHAR。
 */
function inferMysqlType(columnName, samples) {
  const nonNull = samples.filter(v => v !== null && v !== undefined)

  // 全 null：给默认类型
  if (nonNull.length === 0) return 'VARCHAR(255)'

  // 主键 / 外键列（以 _id 结尾就是）
  if (columnName === 'id' || columnName.endsWith('_id')) return 'CHAR(36)'

  // 先检测 boolean（不限列名——任何列只要全是 boolean 值就用 TINYINT(1)）
  if (nonNull.length > 0 && nonNull.every(v => typeof v === 'boolean')) return 'TINYINT(1)'

  // 时间列（ISO 时间字符串）
  if (columnName.includes('_at') || columnName.includes('_time')) {
    return 'DATETIME'
  }

  // 所有值都是对象/数组 → LONGTEXT（存 JSON 文本，避开 MySQL JSON 列的格式校验坑）
  if (nonNull.every(v => typeof v === 'object')) return 'LONGTEXT'

  // 数值
  if (nonNull.every(v => typeof v === 'number')) {
    if (columnName.includes('duration')) return 'DECIMAL(10,3)'
    if (columnName === 'track' || columnName === 'disc') return 'INT'
    if (columnName === 'sort') return 'INT'
    return 'BIGINT'
  }

  // 字符串：看最大长度决定文本类型
  if (nonNull.every(v => typeof v === 'string')) {
    const maxLen = Math.max(...nonNull.map(v => v.length))
    if (maxLen > 5000) return 'MEDIUMTEXT'
    if (maxLen > 1000) return 'TEXT'
    if (maxLen > 255) return 'VARCHAR(1024)'
    return 'VARCHAR(255)'
  }

  // 混合类型：宽松处理成 LONGTEXT（原样存 JSON.stringify 结果）
  return 'LONGTEXT'
}

/** 把 JS 值转成 MySQL 字面量。
 * 类型感知：
 * - null/undefined → SQL NULL（不带引号）
 * - boolean → 1 / 0（裸值，TINYINT(1) 列能接受）
 * - number → 裸数字（INT/DECIMAL 列直接接受）
 * - object → JSON.stringify 后 mysql.escape（带引号的 JSON 文本，LONGTEXT 列接受）
 * - string → mysql.escape（带引号，TEXT/LONGTEXT/VARCHAR 列接受）
 */
function mysqlEscape(val, mysql) {
  if (val === null || val === undefined) return 'NULL'
  if (typeof val === 'boolean') return val ? '1' : '0'
  if (typeof val === 'number') return String(val)
  if (typeof val === 'object') return mysql.escape(JSON.stringify(val))
  return mysql.escape(val)
}

/** 生成单表 CREATE TABLE DDL */
function buildMysqlDDL(tableName, rows) {
  if (!rows.length) {
    // 空表：无法推断类型，给个最小结构
    return `CREATE TABLE \`${tableName}\` (\`id\` CHAR(36) PRIMARY KEY) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
  }

  const columns = Object.keys(rows[0])
  const lines = []
  for (const col of columns) {
    // 扫全表采样（不限 50 行），避免后面的行里有超长值被漏掉
    const samples = rows.map(r => r[col])
    const mysqlType = inferMysqlType(col, samples)
    const isNullable = rows.some(r => r[col] === null || r[col] === undefined)

    // MySQL 8.0 不允许 BLOB/TEXT/JSON 列有 DEFAULT 值，跳过这些类型的 DEFAULT
    const needsDefault = !/(BLOB|TEXT|JSON)$/i.test(mysqlType)
    const nullConstrain = isNullable ? 'NULL' : 'NOT NULL'
    let def = ''
    if (needsDefault) {
      if (isNullable) {
        def = 'DEFAULT NULL'
      } else if (/INT|DECIMAL|TINYINT/.test(mysqlType)) {
        def = 'DEFAULT 0'
      } else if (mysqlType === 'DATETIME') {
        def = "DEFAULT '1970-01-01 00:00:00'"
      } else {
        def = "DEFAULT ''"
      }
    }
    lines.push(`  \`${col}\` ${mysqlType} ${nullConstrain} ${def}`.trim())
  }

  // 主键推断
  if (columns.includes('id')) {
    lines.push('  PRIMARY KEY (`id`)')
  } else if (columns.includes('key')) {
    lines.push('  PRIMARY KEY (`key`)')
  }

  return `CREATE TABLE IF NOT EXISTS \`${tableName}\` (\n${lines.join(',\n')}\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;`
}

async function restoreToMySQL(dump, opts) {
  const mysql = (await import('mysql2/promise')).default
  const config = {
    host: process.env.MYSQL_HOST || '127.0.0.1',
    port: parseInt(process.env.MYSQL_PORT || '3307', 10),
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || 'LrcShare@2026',
    database: process.env.MYSQL_DATABASE || 'lrcshare',
    multipleStatements: true,
  }

  console.log(`🔌 连接 MySQL → ${config.host}:${config.port}/${config.database}`)
  let conn
  try {
    conn = await mysql.createConnection(config)
    console.log('   ✅ 连接成功')
  } catch (err) {
    console.error(`   ❌ 连接失败：${err.message}`)
    process.exit(1)
  }

  const { tables } = dump

  // 按 Phase 顺序恢复
  let totalRows = 0
  for (const table of PHASE_ORDER) {
    if (!tables[table]) continue
    const rows = tables[table]

    process.stdout.write(`\n📋 ${table} (${rows.length} 行) ... `)

    if (opts.dryRun) {
      console.log('\n   [dry-run] CREATE TABLE:')
      console.log(buildMysqlDDL(table, rows).split('\n').map(l => '   ' + l).join('\n'))
      if (rows.length > 0) {
        // 只打印前 3 行的 INSERT 示例
        const cols = Object.keys(rows[0])
        const sampleVals = rows.slice(0, 3).map(row => {
          return cols.map(c => mysqlEscape(row[c], mysql)).join(', ')
        })
        console.log(`   INSERT INTO ${table} (${cols.join(', ')}) VALUES`)
        console.log(sampleVals.map(v => `     (${v})`).join(',\n'))
        if (rows.length > 3) console.log(`     ... 还有 ${rows.length - 3} 行`)
      }
      totalRows += rows.length
      continue
    }

    // CREATE TABLE（--truncate 模式下先 DROP 保证表结构一致）
    if (opts.truncate) {
      await conn.query(`DROP TABLE IF EXISTS \`${table}\``)
    }
    const ddl = buildMysqlDDL(table, rows)
    await conn.query(ddl)

    // INSERT：分批，每批 200 行（MySQL 单条 INSERT 不宜太长）
    if (rows.length === 0) {
      console.log('空表 ✅')
      continue
    }
    const cols = Object.keys(rows[0])
    let inserted = 0
    for (let from = 0; from < rows.length; from += 200) {
      const batch = rows.slice(from, from + 200)
      const valuesSql = batch.map(row =>
        '(' + cols.map(c => mysqlEscape(row[c], mysql)).join(', ') + ')'
      ).join(', ')
      const sql = `INSERT INTO \`${table}\` (\`${cols.join('`, `')}\`) VALUES ${valuesSql}`
      await conn.query(sql)
      inserted += batch.length
    }
    totalRows += inserted
    console.log(`${inserted}/${rows.length} 行 ✅`)
  }

  await conn.end()
  console.log(`\n🎉 MySQL 恢复完成！共 ${totalRows} 行`)
}

// ═══════════════════════════════════════════════════════════════
// Supabase 恢复（纯 REST API INSERT，不需要知道目标 Supabase 表结构）
// ═══════════════════════════════════════════════════════════════

async function restoreToSupabase(dump, opts) {
  const { createClient } = await import('@supabase/supabase-js')

  // --backup：用第二组 Supabase（原生 Supabase 热备库）
  const url = opts.backup
    ? process.env.BACKUP_SUPABASE_URL
    : process.env.VITE_SUPABASE_URL
  const key = opts.backup
    ? process.env.BACKUP_SUPABASE_SERVICE_ROLE_KEY
    : process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error(`❌ 缺少 ${opts.backup ? 'BACKUP_SUPABASE_URL / BACKUP_SUPABASE_SERVICE_ROLE_KEY' : 'VITE_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY'}`)
    process.exit(1)
  }
  const supabase = createClient(url, key)

  // --schema：用 pg 直连重建 public schema（DROP + 执行 dump.schema）
  if (opts.schema) {
    if (!dump.schema) {
      console.error('❌ dump 里没有 schema 字段，无法重建')
      process.exit(1)
    }
    const pgHost = process.env.BACKUP_SUPABASE_HOST
    const pgPort = parseInt(process.env.BACKUP_SUPABASE_PORT || '5432', 10)
    const pgUser = process.env.BACKUP_SUPABASE_USER || 'postgres'
    const pgDb = process.env.BACKUP_SUPABASE_DATABASE || 'postgres'
    const pgPass = process.env.BACKUP_SUPABASE_PASSWORD
    if (!pgHost || !pgPass) {
      console.error('❌ 缺少 BACKUP_SUPABASE_HOST / BACKUP_SUPABASE_PASSWORD（--schema 需要直连 PostgreSQL）')
      process.exit(1)
    }

    console.log(`\n🏗️  重建 schema（DROP SCHEMA public + 执行 schema.sql）...`)
    const { Client } = await import('pg')
    // 用连接字符串，密码需 URL 编码（含 @ 等特殊字符）
    const connStr = `postgresql://${encodeURIComponent(pgUser)}:${encodeURIComponent(pgPass)}@${pgHost}:${pgPort}/${pgDb}`
    const client = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } })
    await client.connect()

    // 1. DROP SCHEMA public CASCADE + CREATE SCHEMA
    await client.query('DROP SCHEMA IF EXISTS public CASCADE')
    await client.query('CREATE SCHEMA public')

    // 2. 执行 dump.schema（pg 支持单 query 里多条语句，用分号分隔）
    await client.query(dump.schema)
    await client.end()
    console.log('   ✅ schema 重建完成')
  }

  // 查询所有生成列 + 列类型，INSERT 时正确序列化
  const generatedCols = new Set()
  const colTypes = {} // { "table.col": "text[]" | "jsonb" | ... }
  const pgHost = process.env.BACKUP_SUPABASE_HOST
  const pgPass = process.env.BACKUP_SUPABASE_PASSWORD
  let pgClient = null
  if (pgHost && pgPass) {
    const { Client } = await import('pg')
    const pgPort = parseInt(process.env.BACKUP_SUPABASE_PORT || '5432', 10)
    const pgUser = process.env.BACKUP_SUPABASE_USER || 'postgres'
    const pgDb = process.env.BACKUP_SUPABASE_DATABASE || 'postgres'
    const connStr = `postgresql://${encodeURIComponent(pgUser)}:${encodeURIComponent(pgPass)}@${pgHost}:${pgPort}/${pgDb}`
    pgClient = new Client({ connectionString: connStr, ssl: { rejectUnauthorized: false } })
    await pgClient.connect()
    const { rows } = await pgClient.query(`
      SELECT c.relname AS table_name, a.attname AS column_name,
             a.attgenerated AS generated,
             format_type(a.atttypid, a.atttypmod) AS data_type
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND a.attnum > 0 AND NOT a.attisdropped
    `)
    for (const r of rows) {
      colTypes[`${r.table_name}.${r.column_name}`] = r.data_type
      if (r.generated === 's') generatedCols.add(`${r.table_name}.${r.column_name}`)
    }
    if (generatedCols.size) console.log(`   ℹ️  检测到 ${generatedCols.size} 个生成列，INSERT 时将跳过`)
  }

  const { tables } = dump
  let totalRows = 0

  for (const table of PHASE_ORDER) {
    if (!tables[table]) continue
    const rows = tables[table]

    process.stdout.write(`\n📋 ${table} (${rows.length} 行) ... `)

    if (rows.length === 0) {
      console.log('空表 ✅')
      continue
    }

    if (opts.dryRun) {
      console.log(`\n   [dry-run] 调 supabase.from('${table}').insert([...${rows.length} rows])`)
      totalRows += rows.length
      continue
    }

    // ── --backup 模式：用 pg 直连（TRUNCATE + INSERT），不走 REST API ──
    if (opts.backup && pgClient) {
      if (opts.truncate) {
        await pgClient.query(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`)
      }
      const cols = Object.keys(rows[0]).filter(c => !generatedCols.has(`${table}.${c}`))
      const colList = cols.map(c => `"${c}"`).join(', ')
      let inserted = 0
      for (let from = 0; from < rows.length; from += 100) {
        const batch = rows.slice(from, from + 100)
        const placeholders = []
        const values = []
        batch.forEach(row => {
          const rowPh = cols.map((_, i) => `$${values.length + i + 1}`)
          placeholders.push(`(${rowPh.join(', ')})`)
          cols.forEach(c => {
            let v = row[c]
            if (v !== null && typeof v === 'object') {
              const dt = colTypes[`${table}.${c}`] || ''
              if (dt === 'json' || dt === 'jsonb') {
                v = JSON.stringify(v)
              } else if (dt.includes('[]')) {
                // PostgreSQL 数组格式：{elem1,elem2}
                v = '{' + v.map(item => {
                  if (item === null) return 'NULL'
                  if (typeof item === 'string') return '"' + item.replace(/"/g, '\\"').replace(/\\/g, '\\\\') + '"'
                  return String(item)
                }).join(',') + '}'
              } else {
                v = JSON.stringify(v)
              }
            }
            values.push(v)
          })
        })
        const sql = `INSERT INTO "${table}" (${colList}) VALUES ${placeholders.join(', ')}`
        await pgClient.query(sql, values)
        inserted += batch.length
      }
      totalRows += inserted
      console.log(`${inserted}/${rows.length} 行 ✅`)
      continue
    }

    // ── 非 --backup 模式（恢复到阿里云）：用 REST API ──
    if (opts.truncate) {
      const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000')
      if (error && !error.message.includes('permission')) {
        console.warn(`   ⚠️ 清空失败（可忽略）：${error.message}`)
      }
    }

    let inserted = 0
    for (let from = 0; from < rows.length; from += 100) {
      const batch = rows.slice(from, from + 100).map(row => {
        if (generatedCols.size === 0) return row
        const filtered = { ...row }
        for (const col of Object.keys(filtered)) {
          if (generatedCols.has(`${table}.${col}`)) delete filtered[col]
        }
        return filtered
      })
      const { error } = await supabase.from(table).insert(batch, { upsert: true, onConflict: 'id' })
      if (error) {
        console.error(`\n   ❌ INSERT 失败：${error.message}`)
        throw error
      }
      inserted += batch.length
    }
    totalRows += inserted
    console.log(`${inserted}/${rows.length} 行 ✅`)
  }

  if (pgClient) await pgClient.end()
  console.log(`\n🎉 Supabase 恢复完成！共 ${totalRows} 行`)
}

// ═══════════════════════════════════════════════════════════════
// 入口
// ═══════════════════════════════════════════════════════════════

async function main() {
  const opts = parseArgs()
  if (!opts.source) {
    console.error('用法：node scripts/db-restore.mjs --source ./backup/latest.json.gz --target mysql|supabase [--dry-run] [--truncate]')
    process.exit(1)
  }
  if (!fs.existsSync(opts.source)) {
    console.error(`❌ 找不到文件：${opts.source}`)
    process.exit(1)
  }

  console.log('🔄 LrcShare 灾备恢复')
  console.log(`   源文件：${opts.source}`)
  console.log(`   目标：${opts.target}${opts.backup ? '（backup 库）' : ''}`)
  if (opts.dryRun) console.log('   [dry-run] 只打印，不执行')
  if (opts.truncate) console.log('   [--truncate] 目标表清空后再插入')
  if (opts.schema) console.log('   [--schema] 重建 public schema（DROP + 执行 schema.sql）')

  const dump = loadDump(opts.source)
  console.log(`\n📦 dump 元信息：导出于 ${dump.exported_at}，schema_version=${dump.schema_version}`)
  const totalRows = Object.values(dump.tables).reduce((s, t) => s + t.length, 0)
  console.log(`   共 ${Object.keys(dump.tables).length} 张表，${totalRows} 行数据`)

  if (opts.target === 'mysql') {
    await restoreToMySQL(dump, opts)
  } else if (opts.target === 'supabase') {
    await restoreToSupabase(dump, opts)
  } else {
    console.error(`❌ 不支持的 target：${opts.target}（只支持 mysql / supabase）`)
    process.exit(1)
  }
}

main().catch(err => {
  console.error('❌ 恢复异常：', err)
  process.exit(1)
})
