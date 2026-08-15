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
  router.options.scrollBehavior = (_to, _from, savedPosition) => savedPosition || { top: 0 }
})
