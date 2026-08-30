/**
 * ttml-hub 同步 Node 入口（GitHub Actions 定时任务 / 本地手动运行）
 *
 * 环境变量：
 *   SUPABASE_URL               必填，例 https://xxxx.supabase.co
 *   SUPABASE_SERVICE_ROLE_KEY  必填，service role key（绕过 RLS，勿泄露）
 *   TTML_HUB_BASE              可选，ttml-hub 站点根地址（默认见 worker.js）
 *   DRY_RUN                    可选，"true" = 只出匹配队列不写库
 *   SYNC_BUDGET                可选，子请求预算（Node 运行无 Cloudflare 配额，可设大如 5000）
 *
 * 用法：node scripts/run-ttml-sync.mjs
 */
import { sync } from '../cloudflare/ttml-sync/worker.js'

const env = {
  SUPABASE_URL: process.env.SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
  TTML_HUB_BASE: process.env.TTML_HUB_BASE,
  DRY_RUN: process.env.DRY_RUN,
  SYNC_BUDGET: process.env.SYNC_BUDGET || '5000',
}

for (const k of ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY']) {
  if (!env[k]) {
    console.error(`缺少环境变量 ${k}`)
    process.exit(1)
  }
}

try {
  await sync(env)
} catch (e) {
  console.error('[sync] 失败:', e.stack || e.message)
  process.exit(1)
}
