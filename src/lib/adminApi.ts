import { ElMessage } from 'element-plus'
import { supabaseAdmin as supabase } from './supabase'

/**
 * 管理后台数据层（Supabase CRUD 封装）
 * 与前台 api.ts 的区别：面向管理端全字段读写，登录后借 auth session 通过 RLS。
 * 相比 v2 的改进：批量删除走 in() 单请求；不再提供全表 8 连拉，由各页面按需加载。
 *
 * 图片灾备（2026-10）：
 * 下方所有写方法统一经过 withImageBackups 拦截——载荷出现外链图片列时，
 * 自动调 Netlify /api/image-backup 转存 OSS 并补写对应 *_backup 列；
 * update 时先按主键核对旧值：图片 URL 未变且已有备份的列跳过转存（备份缺失则补转自愈）；
 * 图片被清空时备份列同步清空。转存失败不阻塞业务保存（备份置空，
 * 灾时回退原外链），界面弹出警告并提示运行 scripts/backup-images.mjs 批量回填补齐。
 * 注意：本文件使用 supabaseAdmin 原始客户端，后台永远读写原始外链，
 * 不受前台 image_source 一键切换影响。
 */

/** 图片灾备白名单：表 → { 主列: OSS 备份列 }，与 sql/19 新增列一一对应 */
const IMAGE_BACKUP_COLUMNS: Record<string, Record<string, string>> = {
  albums: { cover: 'cover_backup' },
  artists: { avatar: 'avatar_backup', bg_image: 'bg_image_backup' },
  songs: { cover: 'cover_backup' },
  contributors: { avatar: 'avatar_backup' },
  articles: { cover: 'cover_backup' },
  friends: { avatar: 'avatar_backup' },
  music_shares: { cover_url: 'cover_url_backup' },
}

function isHttpUrl(v: unknown): v is string {
  return typeof v === 'string' && /^https?:\/\//i.test(v.trim())
}

/** 判断是否已是阿里云 OSS 地址（已是 OSS 则无需再转存，直接互为备份值） */
function isAliyunOssUrl(v: string): boolean {
  try {
    const h = new URL(v).hostname
    return h === 'aliyuncs.com' || h.endsWith('.aliyuncs.com')
  } catch {
    return false
  }
}

/**
 * 调图片转存函数（阿里云 FC · 国内节点，避免 Netlify 美国节点抓 B站失败）。
 * 管理员 JWT 鉴权，与 callMailServer 同一套会话头。
 * 未配置 VITE_IMAGE_BACKUP_URL 时静默跳过、返回 null（本地开发）。
 */
async function backupImageUrl(url: string): Promise<string | null> {
  const fcUrl = import.meta.env.VITE_IMAGE_BACKUP_URL as string | undefined
  if (!fcUrl) return null
  const { data: { session } } = await supabase.auth.getSession()
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
  const res = await fetch(fcUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify({ url }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || json.code !== 0 || !json.data?.url) {
    throw new Error(json.error || '图片转存服务返回异常')
  }
  return String(json.data.url)
}

/** 单张图片转存失败记录（用于保存成功后汇总提示管理员） */
interface BackupFailure {
  /** 表名.图片列名，如 albums.cover */
  location: string
  /** 失败原因（转存服务返回的 error 文案） */
  reason: string
}

/** 归一化图片列值：null/undefined/空白串一律视为 null，其余 trim */
function normalizeImageValue(v: unknown): string | null {
  if (v === null || v === undefined) return null
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t || null
}

/**
 * 写库前补齐图片备份列（就地修改 record）：
 *   - 载荷未带该图片列 → 不动；
 *   - 调用方显式带了备份列 → 尊重调用方，不覆盖；
 *   - 提供 existing（更新前该行旧值）且图片 URL 未变化：
 *       · 已有备份列 → 整列跳过（不调函数、不重写备份，省掉无谓抓图）；
 *       · 备份列为空 → 照常转存（历史漏备在下次保存时自愈）；
 *   - 图片清空（null/空串）→ 备份同步置 null，避免灾时显示已删除的旧图；
 *   - 非 http(s) 值（data URI 等本站不使用的形态）→ 不动；
 *   - 已是 aliyuncs.com 地址 → 备份列直接指向它；
 *   - 其余外链 → 调转存服务；失败置 null 并告警，不中断保存。
 * @param existing 更新前该行的图片列/备份列旧值（仅 update 传入，insert 为 undefined）
 * @returns 本次载荷中转存失败的图片清单（空数组=全部成功或无需转存）
 */
async function withImageBackups(
  table: string,
  record: Record<string, any>,
  existing?: Record<string, any> | null,
): Promise<BackupFailure[]> {
  const failures: BackupFailure[] = []
  const colMap = IMAGE_BACKUP_COLUMNS[table]
  if (!colMap || !record || typeof record !== 'object') return failures
  for (const [srcCol, backupCol] of Object.entries(colMap)) {
    if (!(srcCol in record) || backupCol in record) continue
    const raw = record[srcCol]

    // 更新场景：URL 与库中旧值一致时无需重复转存
    if (existing && srcCol in existing) {
      const newUrl = normalizeImageValue(raw)
      const oldUrl = normalizeImageValue(existing[srcCol])
      if (newUrl === oldUrl) {
        // 已有备份 → 完全跳过（record 不带 backupCol，更新不会覆盖原备份）；
        // 备份缺失（历史失败/漏备）→ 落到下方逻辑补转，保存即自愈
        if (newUrl !== null && normalizeImageValue(existing[backupCol])) continue
      }
    }

    if (raw === null || raw === undefined || (typeof raw === 'string' && !raw.trim())) {
      record[backupCol] = null
      continue
    }
    if (!isHttpUrl(raw)) continue
    const url = raw.trim()
    if (isAliyunOssUrl(url)) {
      record[backupCol] = url
      continue
    }
    try {
      record[backupCol] = (await backupImageUrl(url)) ?? null
    } catch (e) {
      record[backupCol] = null
      const reason = e instanceof Error ? e.message : '转存服务异常'
      console.warn(`[image-backup] ${table}.${srcCol} 转存失败，本次保存不阻断，可用回填脚本补齐：`, e)
      failures.push({ location: `${table}.${srcCol}`, reason })
    }
  }
  return failures
}

/** 批量写前逐行补齐（各行不同图片互不影响，并发转存），返回全部失败项 */
async function withImageBackupsBatch(table: string, records: Record<string, any>[]): Promise<BackupFailure[]> {
  const results = await Promise.all(records.map(r => withImageBackups(table, r)))
  return results.flat()
}

/**
 * 业务保存已成功后，若有图片灾备失败，弹一条非阻断警告告知管理员补救方式。
 * 多张失败合并为一条提示，避免浮层刷屏；延长停留时间并可手动关闭，方便读清命令。
 */
function notifyBackupFailures(failures: BackupFailure[]): void {
  if (!failures.length) return
  const locations = Array.from(new Set(failures.map(f => f.location))).slice(0, 5).join('、')
  const more = failures.length > 5 ? ` 等 ${failures.length} 处` : ''
  const reason = failures[0]?.reason ? `（原因：${failures[0].reason}）` : ''
  ElMessage.warning({
    message: `内容已保存，但 ${failures.length} 张图片灾备失败${more}：${locations}${reason}。请在项目目录运行 node scripts/backup-images.mjs 补齐备份`,
    duration: 10000,
    showClose: true,
  })
}


export interface GetAllOpts {
  select?: string
  order?: string
  ascending?: boolean
  eq?: Record<string, unknown>
  /** 批量判定用：column → 取值列表（单请求替代循环逐个 eq 查询） */
  in?: Record<string, unknown[]>
}

export interface GetPageOpts extends GetAllOpts {
  /** 页码，1 起 */
  page?: number
  pageSize?: number
}

export const adminApi = {
  async getAll<T = any>(table: string, opts: GetAllOpts = {}): Promise<T[]> {
    let q = supabase.from(table).select(opts.select || '*')
    if (opts.order) q = q.order(opts.order, { ascending: opts.ascending !== false })
    if (opts.eq) for (const [k, v] of Object.entries(opts.eq)) q = q.eq(k, v)
    if (opts.in) for (const [k, v] of Object.entries(opts.in)) q = q.in(k, v)
    const { data, error } = await q
    if (error) throw error
    return (data || []) as T[]
  },

  /** 分页拉取（服务端 range + exact 总数），用于随业务量增长的大表列表 */
  async getPage<T = any>(table: string, opts: GetPageOpts = {}): Promise<{ data: T[]; total: number }> {
    const page = Math.max(1, opts.page ?? 1)
    const pageSize = opts.pageSize ?? 50
    let q = supabase.from(table).select(opts.select || '*', { count: 'exact' })
    if (opts.order) q = q.order(opts.order, { ascending: opts.ascending !== false })
    if (opts.eq) for (const [k, v] of Object.entries(opts.eq)) q = q.eq(k, v)
    if (opts.in) for (const [k, v] of Object.entries(opts.in)) q = q.in(k, v)
    const from = (page - 1) * pageSize
    q = q.range(from, from + pageSize - 1)
    const { data, count, error } = await q
    if (error) throw error
    return { data: (data || []) as T[], total: count ?? 0 }
  },

  /**
   * 库端函数分页（搜索类 RPC）：数据走 fn（SETOF 表类型），总数走 countFn
   * （返回 bigint，默认名为 `${fn}_count`）。排序/翻页由 PostgREST 在函数结果集
   * 外层下推（?order=/limit/offset），与 open-api Worker 调 search_songs 的方式一致。
   */
  async rpcPage<T = any>(
    fn: string,
    params: Record<string, unknown>,
    opts: { page?: number; pageSize?: number; order?: string; ascending?: boolean; countFn?: string } = {},
  ): Promise<{ data: T[]; total: number }> {
    const page = Math.max(1, opts.page ?? 1)
    const pageSize = opts.pageSize ?? 50
    const from = (page - 1) * pageSize
    let q = supabase.rpc(fn, params)
    if (opts.order) q = q.order(opts.order, { ascending: opts.ascending !== false })
    q = q.range(from, from + pageSize - 1)
    const [pageRes, countRes] = await Promise.all([q, supabase.rpc(opts.countFn || `${fn}_count`, params)])
    if (pageRes.error) throw pageRes.error
    if (countRes.error) throw countRes.error
    return { data: (pageRes.data || []) as T[], total: Number(countRes.data ?? 0) }
  },

  async insert<T = any>(table: string, record: Partial<T>): Promise<T | null> {
    const backupFailures = await withImageBackups(table, record as Record<string, any>)
    const { data, error } = await supabase.from(table).insert(record as any).select().single()
    if (error) throw error
    notifyBackupFailures(backupFailures)
    return data
  },

  /** 条件更新：opts.filters 附加等值条件（如 { status: 'pending' } 做状态门控）。
   *  条件命中 0 行时返回 null（不抛错），调用方可据此识别"已被处理过"的重复提交 */
  async update<T = any>(table: string, id: string, record: Partial<T>, opts?: { filters?: Record<string, unknown> }): Promise<T | null> {
    // 图片列旧值核对：载荷带了白名单图片列时，先按主键查该行旧值（单表主键查询），
    // URL 没变且已有备份的列直接跳过转存。查询失败则退回旧行为（照常转存），不阻断保存
    let existing: Record<string, any> | null = null
    const colMap = IMAGE_BACKUP_COLUMNS[table]
    if (colMap) {
      const touchedSrcCols = Object.keys(colMap).filter(c => c in record)
      if (touchedSrcCols.length) {
        const selectCols = Array.from(new Set(touchedSrcCols.flatMap(c => [c, colMap[c]]))).join(',')
        const { data, error } = await supabase
          .from(table)
          .select(selectCols)
          .eq('id', id)
          .maybeSingle()
        if (!error) existing = (data as Record<string, any>) ?? null
      }
    }
    const backupFailures = await withImageBackups(table, record as Record<string, any>, existing)
    let q = supabase.from(table).update(record as any).eq('id', id)
    if (opts?.filters) {
      for (const [k, v] of Object.entries(opts.filters)) q = q.eq(k, v as any)
    }
    const { data, error } = await q.select()
    if (error) throw error
    const row = (data?.[0] as T) ?? null
    // 条件未命中（保存实际未生效）时不提示，避免"未保存却提示补备份"的矛盾
    if (row) notifyBackupFailures(backupFailures)
    return row
  },

  async remove(table: string, id: string): Promise<void> {
    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) throw error
  },

  /** 批量删除：单请求 in()，替代 v2 的 for 循环逐条删 */
  async removeBatch(table: string, ids: string[]): Promise<void> {
    if (!ids.length) return
    const { error } = await supabase.from(table).delete().in('id', ids)
    if (error) throw error
  },

  /** 按列条件删除（中间表关系同步用） */
  async removeWhere(table: string, column: string, value: unknown): Promise<void> {
    const { error } = await supabase.from(table).delete().eq(column, value)
    if (error) throw error
  },

  /** 批量插入：单请求，替代逐行 insert */
  async insertBatch<T = any>(table: string, records: Partial<T>[]): Promise<void> {
    if (!records.length) return
    const backupFailures = await withImageBackupsBatch(table, records as Record<string, any>[])
    const { error } = await supabase.from(table).insert(records as any)
    if (error) throw error
    notifyBackupFailures(backupFailures)
  },

  /** 通用 upsert（song_secrets 等按业务键冲突的表用） */
  async upsert<T = any>(table: string, record: Partial<T>, onConflict: string): Promise<void> {
    const backupFailures = await withImageBackups(table, record as Record<string, any>)
    const { error } = await supabase.from(table).upsert(record as any, { onConflict })
    if (error) throw error
    notifyBackupFailures(backupFailures)
  },

  /** 批量 upsert：单请求（settings 等多行一次保存用） */
  async upsertBatch<T = any>(table: string, records: Partial<T>[], onConflict: string): Promise<void> {
    if (!records.length) return
    const backupFailures = await withImageBackupsBatch(table, records as Record<string, any>[])
    const { error } = await supabase.from(table).upsert(records as any, { onConflict })
    if (error) throw error
    notifyBackupFailures(backupFailures)
  },

  /**
   * 合并贡献者账号（原子操作，库端单事务）：
   * 把 source 的全部歌曲/歌词版本/投稿/歌曲分享引用转给 target，按 profile 写回保留账号资料，再删除 source。
   * 对应 RPC：public.admin_merge_contributors(text, text, jsonb)，仅 authenticated 可执行。
   * @param sourceId 被合并并删除的账号 id
   * @param targetId 保留账号 id
   * @param profile  逐字段挑选后的保留账号最终资料（8 个字段，结构需与 RPC 契约一致）
   * @returns 双方名称 + 四张表实际转移行数（含歌曲分享全部状态行）
   */
  async mergeContributors(
    sourceId: string,
    targetId: string,
    profile: Record<string, unknown>,
  ): Promise<{
    source_id: string
    source_name: string
    target_id: string
    target_name_old: string
    target_name: string
    songs_moved: number
    versions_moved: number
    submissions_moved: number
    music_shares_moved: number
  }> {
    const { data, error } = await supabase.rpc('admin_merge_contributors', {
      p_source: sourceId,
      p_target: targetId,
      p_profile: profile,
    })
    if (error) throw error
    return data
  },

  /** 读取 mail_logs 表（发信日志），按 created_at desc 排序；数据量小，全拉 + 前端筛选 */
  async getMailLogs(): Promise<any[]> {
    const { data, error } = await supabase
      .from('mail_logs')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error
    return data || []
  },

  /**
   * 调用邮件服务（Netlify Functions，netlify/functions/mailer.mjs）。
   * 端点统一为 /api/mailer，body: { action: 'test'|'approve'|'reject', ... }；
   * SMTP 由服务端从 settings 表读取。未配置 VITE_MAIL_BASE 时静默跳过
   * （与 v2 行为一致：邮件失败不阻塞审核）。
   */
  async callMailServer(path: string, body: Record<string, unknown>): Promise<Record<string, any>> {
    const base = import.meta.env.VITE_MAIL_BASE as string | undefined
    if (!base) return { success: true, skipped: true, reason: '未配置邮件服务' }
    // 管理端动作（test/approve/reject/batch）需携带登录会话供服务端校验；
    // notify 由服务端免鉴权放行。未登录时无 Authorization 头，服务端返回 401 由调用方提示。
    const { data: { session } } = await supabase.auth.getSession()
    const headers: Record<string, string> = { 'Content-Type': 'application/json' }
    if (session?.access_token) headers['Authorization'] = `Bearer ${session.access_token}`
    const res = await fetch(base + path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Mail server error')
    return data
  },
}
