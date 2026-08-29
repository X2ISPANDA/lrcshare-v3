<template>
  <footer class="bg-gray-800 text-white py-6 mt-12">
    <div class="max-w-6xl mx-auto px-4 text-center">
      <p class="mb-2">&copy; 2023-2026 LrcShare. 全球最小滚动歌词分享网站</p>
      <p class="mb-2 text-sm text-gray-300">本网站中所使用的歌词，其著作权属于原著作权人，仅以交流学习为目的引用。</p>
      <p class="mb-2 text-sm text-gray-400">
        <template v-if="sitePv">
          <span>👁 总访问量 {{ sitePv }} 次</span>
          <span class="mx-2">·</span>
          <span>👥 访客 {{ siteUv }} 人</span>
          <span class="mx-2">·</span>
          <span>📄 本页 {{ pagePv }} 次</span>
          <span class="mx-2">·</span>
        </template>
        <span>🚀 本站已运行 {{ days }} 天</span>
      </p>
      <div class="flex flex-wrap justify-center gap-x-6 gap-y-2 text-gray-400 text-sm">
        <RouterLink to="/posts" class="hover:text-white">逼逼</RouterLink>
        <RouterLink to="/about" class="hover:text-white">关于</RouterLink>
        <RouterLink to="/contributors" class="hover:text-white">贡献者</RouterLink>
        <RouterLink to="/links" class="hover:text-white">友链</RouterLink>
        <RouterLink to="/support" class="hover:text-white">赞助</RouterLink>
        <a href="https://api.lrcshare.com/docs/" target="_blank" rel="noopener" class="hover:text-white">API</a>
        <RouterLink to="/admin" class="hover:text-white">管理后台</RouterLink>
      </div>
      <!-- 技术徽标（shields.io，仿 Hexo 页脚）：致谢支撑本站的开源项目与服务 -->
      <div class="flex flex-wrap justify-center items-center gap-1.5 mt-3">
        <a href="https://vuejs.org/" target="_blank" rel="noopener" title="Vue 3.5"><img src="https://img.shields.io/badge/Frame-Vue_3.5-42b883?logo=vuedotjs&logoColor=white" alt="Vue 3.5" loading="lazy" /></a>
        <a href="https://element-plus.org/" target="_blank" rel="noopener" title="Element Plus 2.13"><img src="https://img.shields.io/badge/UI-Element_Plus_2.13-409eff?logo=element&logoColor=white" alt="Element Plus 2.13" loading="lazy" /></a>
        <a href="https://tailwindcss.com/" target="_blank" rel="noopener" title="Tailwind CSS 4"><img src="https://img.shields.io/badge/Style-TailwindCSS_4-06b6d4?logo=tailwindcss&logoColor=white" alt="Tailwind CSS 4" loading="lazy" /></a>
        <a href="https://supabase.com/" target="_blank" rel="noopener" title="Supabase 2"><img src="https://img.shields.io/badge/Data-Supabase_2-3fcf8e?logo=supabase&logoColor=white" alt="Supabase 2" loading="lazy" /></a>
        <a href="https://workers.cloudflare.com/" target="_blank" rel="noopener" title="Cloudflare Workers"><img src="https://img.shields.io/badge/API-Cloudflare_Workers-f38020?logo=cloudflare&logoColor=white" alt="Cloudflare Workers" loading="lazy" /></a>
        <a href="https://vitepress.dev/" target="_blank" rel="noopener" title="VitePress 1.6"><img src="https://img.shields.io/badge/Docs-VitePress_1.6-green?logo=vitepress&logoColor=white" alt="VitePress 1.6" loading="lazy" /></a>
        <a href="https://www.netlify.com/" target="_blank" rel="noopener" title="Netlify"><img src="https://img.shields.io/badge/CDN-Netlify-00c7b7?logo=netlify&logoColor=white" alt="Netlify" loading="lazy" /></a>
        <a href="https://github.com/X2ISPANDA/lrcshare-v3" target="_blank" rel="noopener" title="GitHub"><img src="https://img.shields.io/badge/Source-GitHub-181717?logo=github&logoColor=white" alt="GitHub" loading="lazy" /></a>
      </div>
    </div>
    <!-- 不蒜子回填目标（隐藏，全站唯一一处；数值经 useBusuanzi 轮询进响应式状态） -->
    <span class="hidden" id="busuanzi_value_site_pv"></span>
    <span class="hidden" id="busuanzi_value_site_uv"></span>
    <span class="hidden" id="busuanzi_value_page_pv"></span>
  </footer>
</template>

<script setup lang="ts">
import { computed, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import { useBusuanzi } from '@/composables/useBusuanzi'

const { sitePv, siteUv, pagePv, refresh } = useBusuanzi()

// 建站：2023-03-01 00:00 北京时间
const SITE_LAUNCH = Date.parse('2023-03-01T00:00:00+08:00')
const days = computed(() => Math.max(0, Math.floor((Date.now() - SITE_LAUNCH) / 86400000)))

const route = useRoute()
onMounted(() => refresh())
// SPA 路由切换重新拉取：不蒜子按加载时 URL 计数，须重注入脚本才刷新本页数据
watch(() => route.path, () => refresh())
</script>
