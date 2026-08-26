<template>
  <!-- SSG 壳阶段渲染中性加载态而非 404 文案：GitHub Pages 刷新 /admin/** 等纯 SPA 路径时
       必回退 404.html，壳里预渲染的「页面不存在」会在水合前闪现（刷新后台先见 404 再出画面的根因）。
       水合后由 router 决定真实内容：未知路径才显示 404，SPA 路径正常渲染 -->
  <div v-if="hydrated" class="max-w-6xl mx-auto px-4 py-24 text-center">
    <div class="text-6xl mb-4">404</div>
    <h1 class="text-2xl font-bold text-gray-800">页面不存在</h1>
    <p class="mt-3 text-gray-400">你访问的页面去火星了</p>
    <RouterLink to="/" class="inline-block mt-6 px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition">
      返回首页
    </RouterLink>
  </div>
  <div v-else class="max-w-6xl mx-auto px-4 py-24 text-center text-gray-400">加载中...</div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useHead } from '@unhead/vue'

useHead({ title: '页面不存在 - LrcShare' })

const hydrated = ref(false)
onMounted(() => { hydrated.value = true })
</script>
