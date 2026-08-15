<template>
  <footer class="bg-gray-800 text-white py-12 mt-12">
    <div class="max-w-6xl mx-auto px-4 text-center">
      <p class="mb-4">&copy; 2023-2026 LrcShare. 全球最小滚动歌词分享网站</p>
      <p class="mb-2 text-sm text-gray-400">
        <span v-show="pvReady">👁 总访问量 <span id="busuanzi_value_site_pv"></span> 次</span>
        <span class="mx-2">·</span>
        <span v-show="pvReady">👥 访客 <span id="busuanzi_value_site_uv"></span> 人</span>
        <span class="mx-2">·</span>
        <span v-show="pvReady">📄 本页 <span id="busuanzi_value_page_pv"></span> 次</span>
      </p>
      <div class="flex flex-wrap justify-center gap-x-6 gap-y-2 text-gray-400 text-sm">
        <RouterLink to="/posts" class="hover:text-white">逼逼</RouterLink>
        <RouterLink to="/about" class="hover:text-white">关于</RouterLink>
        <RouterLink to="/contributors" class="hover:text-white">贡献者</RouterLink>
        <RouterLink to="/links" class="hover:text-white">友链</RouterLink>
        <RouterLink to="/support" class="hover:text-white">赞助</RouterLink>
        <RouterLink to="/admin" class="hover:text-white">管理后台</RouterLink>
      </div>
    </div>
  </footer>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'

const pvReady = ref(false)

onMounted(() => {
  // 不蒜子统计：客户端动态加载（SSG 时不执行，避免水合不一致）
  const s = document.createElement('script')
  s.async = true
  s.src = '//busuanzi.ibruce.info/busuanzi/2.3/busuanzi.pure.mini.js'
  s.onload = () => {
    // 等 busuanzi 回填数值后再显示，避免闪烁 undefined
    setTimeout(() => (pvReady.value = true), 600)
  }
  document.body.appendChild(s)
})
</script>
