import { ViteSSG } from 'vite-ssg'
import { createPinia } from 'pinia'
import { ID_INJECTION_KEY, ZINDEX_INJECTION_KEY } from 'element-plus'
import App from './App.vue'
import routes, { setupAdminGuard } from './router'
import './styles/main.css'

// vite-ssg 入口：导出 createApp（而非直接 mount），构建时预渲染前台页面。
// 动态路由（/song/:id 等）的实体清单由 vite.config.ts 的 ssgOptions.includedRoutes
// 在构建时从数据库拉取，每首歌生成真实 HTML（Google 可收录）。
export const createApp = ViteSSG(App, { routes }, ({ app, router, initialState }) => {
  app.use(createPinia())
  // SSG 数据预取状态：useSSGData 写入、vite-ssg 序列化进 HTML 并在客户端恢复
  app.provide('initialState', initialState)
  // Element Plus SSR/水合要求：提供稳定的服务端 ID 与 z-index 起点
  app.provide(ID_INJECTION_KEY, { prefix: 1024, current: 0 })
  app.provide(ZINDEX_INJECTION_KEY, { current: 0 })

  // 后台登录守卫（/admin/** 需 Supabase 会话，SSG 已排除后台页面）
  setupAdminGuard(router)

  // 客户端导航：回到顶部。文档标题由各页面 useHead 统一管理（SSG 构建时同样生效）
  // 同路径仅 query 变化（如歌词页切 tab ?tab=lrc）保持滚动位置，避免弹回页首
  router.options.scrollBehavior = (to, from, savedPosition) => {
    if (savedPosition) return savedPosition
    if (to.path === from.path) return false
    return { top: 0 }
  }

  // DevTools 欢迎横幅（仅浏览器控制台；SSG 构建端无 window 不输出）
  if (typeof window !== 'undefined') {
    const frame = '>>' + '='.repeat(70) + '<<'
    const banner = [
      '||                                                                      ||',
      '||   ██╗     ██████╗  ██████╗███████╗██╗  ██╗ █████╗ ██████╗ ███████╗   ||',
      '||   ██║     ██╔══██╗██╔════╝██╔════╝██║  ██║██╔══██╗██╔══██╗██╔════╝   ||',
      '||   ██║     ██████╔╝██║     ███████╗███████║███████║██████╔╝█████╗     ||',
      '||   ██║     ██╔══██╗██║     ╚════██║██╔══██║██╔══██║██╔══██╗██╔══╝     ||',
      '||   ███████╗██║  ██║╚██████╗███████║██║  ██║██║  ██║██║  ██║███████╗   ||',
      '||   ╚══════╝╚═╝  ╚═╝ ╚═════╝╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝╚══════╝   ||',
      '||                                                                      ||',
    ]
    // 品牌粉 → 紫 → 蓝纵向渐变（多 %c 跨行逐行上色）
    const grad = ['#f25d8e', '#e05a9a', '#c457b0', '#9d55c6', '#7b53d2', '#4f79d9', '#0078be', '#f25d8e']
    console.log(
      `%c${frame}\n%c${banner[0]}\n%c${banner[1]}\n%c${banner[2]}\n%c${banner[3]}\n%c${banner[4]}\n%c${banner[5]}\n%c${banner[6]}\n%c${banner[7]}\n%c${frame}`,
      'color:#888',
      ...grad.map(c => `color:${c};font-weight:bold`),
      'color:#888',
    )
    const panda = [
      '                           .*@@@@@@@@@@@%:',
      '                           *@@@@@@@@@@@@@@:.',
      '                        ...%@@@@@@@@@@@@@@=.',
      '                     .:-+=:....::+#%@@@@@%..',
      '                   .++:...............:=%*..',
      '                .:+-......................:+=...',
      '               .+-...........:=*#*=-.........-*-........',
      '             .:+............-+*+=::::...........*@@@@@@@',
      '            .=:..............:=--=##-.............+@@@@@',
      '          ..+:..........:==--:::---=:..............-@@@@',
      '          .*..........:+###*+-.......:::::..........#@@@',
      '       ...+:.........=##+-==-:-:......:-===-........*@@@',
      '    .+%@@@%.........=**-:+%*-:--:....:=-:::-::......*@@@',
      ' ..+@@@@@@@:........:--:+*=-:.::...:=**-::--::......#@@@',
      ' .+@@@@@@@@-.........::--::...::::=+=--:=+-:::.....-@@*.',
      ' .%@@@@@@@@%..................:-::..:-==-.:=*-.....*@#..',
      ' :%@@@@@@@@@=.................-+:..:=+-:.-*%#-....-@%.',
      ' .=@@@@@@@@@%:................-+=-=+-::-===-:....-@%:.',
      ' ..:#@@@@@@@@*.................:-----:..........+@%:.',
      '    .:*%@@@@@%+--:.................:::........:%@+.',
      '         ..=%@@@@@@%-........................=@@-.',
      '       ..-@@@@@@@@@@@*.....................:%@*.',
      '      ..#@@@@@@@@@@@@@-..................:#@#:..',
      '      .#@@@@@@@@@@@@@%:................-#@%:.',
      '    ..%@@@@@@@@@#@@@@=.............-#%@%+:..',
      '    .#@@@@@@@@@%-:=#@@*-:::::-+*%@@@@#:..',
      '   .+@@@@@@@@@@*:=*#@@@@@@@@@@@@@@@@*..',
      '   :%@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@:.',
      '   -@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@..',
      '   =@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@+.',
    ]
    console.log(
      '%c欢迎您浏览 LrcShare —— 全球最小的滚动歌词站\n%c站长正在注视着你\n%c' + panda.join('\n'),
      'color:#f25d8e;font-size:14px;font-weight:bold',
      'color:#888;font-style:italic',
      'color:#333',
    )

    // 徽标标签行（仿终端风）：彩色徽标 + 正文（正文加深加粗，避免控制台浅灰看不清）
    const tag = (label: string, text: string, color: string, textCss = 'color:#1f2937;font-weight:600') =>
      console.log(`%c ${label} %c ${text}`, `background:${color};color:#fff;font-weight:bold;padding:2px 8px;border-radius:4px`, textCss)
    tag('⚡ Powered by X2ISPANDA', 'LrcShare · Since 2023-03-01', '#f25d8e')
    tag('ℹ️ INFO', '你已打开控制台', '#6b7280')
    tag('👀 WATCHING', '你正处于监控中', '#e05a3a')
    tag('⚠️ WARNING', '本站禁止爬虫抓取与批量采集，数据受保护', '#c2452d')
    tag('⌚️ 北京时间', new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }), '#0078be')
    const upDays = Math.floor((Date.now() - new Date('2023-03-01T00:00:00+08:00').getTime()) / 86400000)
    tag('🚀 RUNTIME', `本站已运行 ${upDays} 天`, '#10b981')
  }
})
