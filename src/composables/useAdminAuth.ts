import { ref } from 'vue'
import { supabase } from '@/lib/supabase'

/**
 * 管理后台登录态（模块级单例）
 * Supabase Auth 邮箱密码登录，session 由 supabase-js 持久化（localStorage）。
 */

const user = ref<{ email?: string | null } | null>(null)
const ready = ref(false)
let inited = false

export function useAdminAuth() {
  /** 恢复已有会话 + 监听登出事件（守卫与 Layout 各自调用，仅首个执行） */
  async function init() {
    if (inited) return
    inited = true
    const { data } = await supabase.auth.getSession()
    user.value = data.session?.user ?? null
    ready.value = true
    supabase.auth.onAuthStateChange((_event, session) => {
      user.value = session?.user ?? null
    })
  }

  async function login(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) throw error
    const { data } = await supabase.auth.getSession()
    user.value = data.session?.user ?? null
  }

  async function logout() {
    await supabase.auth.signOut()
    user.value = null
  }

  return { user, ready, init, login, logout }
}
