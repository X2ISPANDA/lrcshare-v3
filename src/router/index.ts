import type { RouteRecordRaw, Router } from 'vue-router'
import DefaultLayout from '@/layouts/DefaultLayout.vue'

/**
 * 前台路由（SSG 预渲染）
 * 动态路由（/song/:id 等）的实体页由 vite.config.ts 的 ssgOptions.includedRoutes
 * 在构建时从数据库拉取全部 id 逐一生成真实 HTML。
 */
export default <RouteRecordRaw[]>[
  {
    path: '/',
    component: DefaultLayout,
    children: [
      { path: '', name: 'home', component: () => import('@/views/HomeView.vue') },
      { path: 'song/:id', name: 'song', component: () => import('@/views/SongView.vue') },
      { path: 'artists', name: 'artists', component: () => import('@/views/ArtistsView.vue') },
      { path: 'artist/:id', name: 'artist', component: () => import('@/views/ArtistView.vue') },
      { path: 'albums', name: 'albums', component: () => import('@/views/AlbumsView.vue') },
      { path: 'album/:id', name: 'album', component: () => import('@/views/AlbumView.vue') },
      { path: 'contributors', name: 'contributors', component: () => import('@/views/ContributorsView.vue') },
      { path: 'contributor/:id', name: 'contributor', component: () => import('@/views/ContributorView.vue') },
      { path: 'posts', name: 'posts', component: () => import('@/views/PostsView.vue') },
      { path: 'post/:slug', name: 'post', component: () => import('@/views/PostView.vue') },
      { path: 'links', name: 'links', component: () => import('@/views/LinksView.vue') },
      { path: 'about', name: 'about', component: () => import('@/views/AboutView.vue') },
      { path: 'support', name: 'support', component: () => import('@/views/SupportView.vue') },
      { path: 'submit', name: 'submit', component: () => import('@/views/SubmitView.vue') },
      // dev 专用：el-switch/dialog 回归验证页（不参与导航）
      { path: 'switch-test', name: 'switch-test', component: () => import('@/views/SwitchTest.vue') },
      // 404 兜底：/404 为静态路径（构建时预渲染出真实 404.html 供 GitHub Pages 使用），
      // catch-all 负责其它未知路径的客户端匹配
      { path: '404', name: 'not-found-page', component: () => import('@/views/NotFoundView.vue') },
      { path: ':pathMatch(.*)*', name: 'not-found', component: () => import('@/views/NotFoundView.vue') },
    ],
  },
  // ===== 管理后台（纯 SPA，不参与 SSG，构建时由 includedRoutes 排除） =====
  {
    path: '/admin/login',
    name: 'admin-login',
    component: () => import('@/views/admin/AdminLoginView.vue'),
  },
  {
    path: '/admin',
    component: () => import('@/layouts/AdminLayout.vue'),
    children: [
      { path: '', redirect: { name: 'admin-dashboard' } },
      { path: 'dashboard', name: 'admin-dashboard', component: () => import('@/views/admin/DashboardView.vue') },
      { path: 'submissions', name: 'admin-submissions', component: () => import('@/views/admin/SubmissionsView.vue') },
      { path: 'songs', name: 'admin-songs', component: () => import('@/views/admin/SongsView.vue') },
      { path: 'lyric-doubts', name: 'admin-lyric-doubts', component: () => import('@/views/admin/DoubtsView.vue') },
      { path: 'artists', name: 'admin-artists', component: () => import('@/views/admin/ArtistsView.vue') },
      { path: 'albums', name: 'admin-albums', component: () => import('@/views/admin/AlbumsView.vue') },
      { path: 'sponsors', name: 'admin-sponsors', component: () => import('@/views/admin/SponsorsView.vue') },
      { path: 'articles', name: 'admin-articles', component: () => import('@/views/admin/ArticlesView.vue') },
      { path: 'contributors', name: 'admin-contributors', component: () => import('@/views/admin/ContributorsView.vue') },
      { path: 'friends', name: 'admin-friends', component: () => import('@/views/admin/FriendsView.vue') },
      { path: 'settings', name: 'admin-settings', component: () => import('@/views/admin/SettingsView.vue') },
    ],
  },
]

/**
 * 后台登录守卫：/admin/**（除登录页）必须有 Supabase 会话。
 * SSG 构建时 /admin 已被排除渲染，此守卫只影响客户端导航。
 */
export function setupAdminGuard(router: Router) {
  router.beforeEach(async to => {
    if (!to.path.startsWith('/admin') || to.name === 'admin-login') return true
    const { supabase } = await import('@/lib/supabase')
    const { data } = await supabase.auth.getSession()
    if (data.session) return true
    return { name: 'admin-login', query: { redirect: to.fullPath } }
  })
}
