import { ref } from 'vue'

/**
 * 不蒜子统计（全站单例）。
 * 原理：busuanzi 脚本按「加载时 URL」计数，回填到固定 ID 的 span；
 * SPA 路由切换后必须重新注入脚本才会刷新本页数据（官方推荐做法）。
 * 数值统一轮询进响应式状态，footer 与文章页共用一份，
 * 避免多处使用相同 ID 导致只回填第一个、其余永远为空。
 */
const sitePv = ref('')
const siteUv = ref('')
const pagePv = ref('')

const SCRIPT_ID = 'busuanzi-script'
let timer: ReturnType<typeof setInterval> | undefined

export function useBusuanzi() {
  /** 拉取/刷新不蒜子数据；路由切换后调用（按当前 URL 重新计数） */
  function refresh() {
    if (typeof document === 'undefined') return
    document.getElementById(SCRIPT_ID)?.remove()
    // 清空回填目标 span：残留上一页数值会让轮询第一次就读到旧 site_pv 而提前终止，
    // 并把上一页 page_pv 旧数字当新值写入响应式（本页浏览量定格为上一页）。
    // 清空后轮询等到新 JSONP 真正回填才读数；等待期响应式仍保留上一轮站点总量展示。
    for (const id of ['busuanzi_value_site_pv', 'busuanzi_value_site_uv', 'busuanzi_value_page_pv']) {
      const el = document.getElementById(id)
      if (el) el.textContent = ''
    }
    const s = document.createElement('script')
    s.id = SCRIPT_ID
    s.async = true
    s.src = `//busuanzi.ibruce.info/busuanzi/2.3/busuanzi.pure.mini.js?v=${Date.now()}`
    document.body.appendChild(s)

    // 旧页数值立即失效（本页 PV 换页后不准），站点总量保留展示
    pagePv.value = ''
    if (timer) clearInterval(timer)
    let tries = 0
    timer = setInterval(() => {
      tries++
      const pv = document.getElementById('busuanzi_value_site_pv')?.textContent?.trim() || ''
      if (pv || tries > 20) {
        if (timer) clearInterval(timer)
        timer = undefined
        if (pv) {
          sitePv.value = pv
          siteUv.value = document.getElementById('busuanzi_value_site_uv')?.textContent?.trim() || ''
          pagePv.value = document.getElementById('busuanzi_value_page_pv')?.textContent?.trim() || ''
        }
      }
    }, 200)
  }

  return { sitePv, siteUv, pagePv, refresh }
}
