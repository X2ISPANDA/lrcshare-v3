import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('缺少 Supabase 环境变量，请检查 .env 文件（参考 .env.example）')
}

/**
 * 前台共享 Supabase 客户端（anon key，公开只读+投稿权限，RLS 保护）
 */
export const supabase = createClient(supabaseUrl, supabaseAnonKey)
