import { supabase } from './supabase'

/**
 * 管理后台数据层（Supabase CRUD 封装）
 * 与前台 api.ts 的区别：面向管理端全字段读写，登录后借 auth session 通过 RLS。
 * 相比 v2 的改进：批量删除走 in() 单请求；不再提供全表 8 连拉，由各页面按需加载。
 */

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
    const { data, error } = await supabase.from(table).insert(record as any).select().single()
    if (error) throw error
    return data
  },

  async update<T = any>(table: string, id: string, record: Partial<T>): Promise<T | null> {
    const { data, error } = await supabase.from(table).update(record as any).eq('id', id).select().single()
    if (error) throw error
    return data
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
    const { error } = await supabase.from(table).insert(records as any)
    if (error) throw error
  },

  /** 通用 upsert（song_secrets 等按业务键冲突的表用） */
  async upsert<T = any>(table: string, record: Partial<T>, onConflict: string): Promise<void> {
    const { error } = await supabase.from(table).upsert(record as any, { onConflict })
    if (error) throw error
  },

  /** 批量 upsert：单请求（settings 等多行一次保存用） */
  async upsertBatch<T = any>(table: string, records: Partial<T>[], onConflict: string): Promise<void> {
    if (!records.length) return
    const { error } = await supabase.from(table).upsert(records as any, { onConflict })
    if (error) throw error
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
