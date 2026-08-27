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
}

export const adminApi = {
  async getAll<T = any>(table: string, opts: GetAllOpts = {}): Promise<T[]> {
    let q = supabase.from(table).select(opts.select || '*')
    if (opts.order) q = q.order(opts.order, { ascending: opts.ascending !== false })
    if (opts.eq) for (const [k, v] of Object.entries(opts.eq)) q = q.eq(k, v)
    const { data, error } = await q
    if (error) throw error
    return (data || []) as T[]
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

  /** settings 表按 key upsert */
  async upsertSetting(key: string, value: string): Promise<void> {
    const { error } = await supabase.from('settings').upsert({ key, value }, { onConflict: 'key' })
    if (error) throw error
  },

  /** 通用 upsert（song_secrets 等按业务键冲突的表用） */
  async upsert<T = any>(table: string, record: Partial<T>, onConflict: string): Promise<void> {
    const { error } = await supabase.from(table).upsert(record as any, { onConflict })
    if (error) throw error
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
    const res = await fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || 'Mail server error')
    return data
  },
}
