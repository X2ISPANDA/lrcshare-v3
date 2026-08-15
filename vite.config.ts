import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import tailwindcss from '@tailwindcss/vite'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'
import Icons from 'unplugin-icons/vite'
import { createClient } from '@supabase/supabase-js'

/**
 * SSG 动态路由收集：构建时从数据库拉取全部实体 id/slug，
 * 为每首歌/艺术家/专辑/贡献者/文章生成独立真实 HTML（Google 可收录）。
 * 数据库不可达时降级为仅静态页面，不阻塞构建。
 */
async function collectDynamicRoutes(env: Record<string, string>): Promise<string[]> {
  const url = env.VITE_SUPABASE_URL
  const key = env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) {
    console.warn('[SSG] 缺少 Supabase 环境变量，仅预渲染静态页面')
    return []
  }
  const supabase = createClient(url, key)
  const paths: string[] = []
  try {
    const [songs, artists, albums, contributors, articles] = await Promise.all([
      supabase.from('songs').select('id').eq('status', 'published'),
      supabase.from('artists').select('id').eq('is_show', true),
      supabase.from('albums').select('id'),
      supabase.from('contributors').select('id'),
      supabase.from('articles').select('slug').eq('status', 'published'),
    ])
    ;(songs.data || []).forEach(s => paths.push(`/song/${s.id}`))
    ;(artists.data || []).forEach(a => paths.push(`/artist/${a.id}`))
    ;(albums.data || []).forEach(a => paths.push(`/album/${a.id}`))
    ;(contributors.data || []).forEach(c => paths.push(`/contributor/${c.id}`))
    ;(articles.data || []).forEach(a => paths.push(`/post/${a.slug}`))
    console.log(
      `[SSG] 动态页面：${songs.data?.length || 0} 歌曲 / ${artists.data?.length || 0} 艺术家 / ${albums.data?.length || 0} 专辑 / ${contributors.data?.length || 0} 贡献者 / ${articles.data?.length || 0} 文章`,
    )
  } catch (e) {
    console.warn('[SSG] 数据库不可达，仅预渲染静态页面：', e)
  }
  return paths
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [
      vue(),
      tailwindcss(),
      // Element Plus 按需自动引入（组件 + ElMessage 等命令式 API）
      AutoImport({ resolvers: [ElementPlusResolver()] }),
      Components({ resolvers: [ElementPlusResolver()] }),
      // Iconify 图标构建期按需打包（~icons/ 前缀，零运行时请求，替代 v2 的 iconify CDN）
      Icons({ compiler: 'vue3' }),
    ],
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },
    // 固定端口（17321，冷门端口避免与其它项目冲突）；strictPort 保证端口被占时直接报错而不是悄悄换端口
    server: {
      port: 17321,
      strictPort: true,
    },
    preview: {
      port: 17321,
      strictPort: true,
    },
    // SSG 服务端渲染时打包 Element Plus（否则其 CSS 导入会被 Node 原样加载而报错）
    ssr: {
      noExternal: ['element-plus'],
    },
    // vite-ssg：动态路由实体清单（构建时执行）。
    // paths 含未解析的路由模式（如 song/:id）与空串，需过滤后与实体页合并；
    // /admin 为纯 SPA 管理后台，排除预渲染。
    ssgOptions: {
      includedRoutes: async paths => [
        ...paths.filter(p => p && !p.includes(':') && !p.startsWith('/admin')),
        ...(await collectDynamicRoutes(env)),
      ],
    },
  }
})
