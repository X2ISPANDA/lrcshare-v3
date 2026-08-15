<template>
  <div class="max-w-6xl mx-auto px-4 py-24 text-center">
    <div class="text-6xl mb-4">404</div>
    <h1 class="text-2xl font-bold text-gray-800">页面不存在</h1>
    <p class="mt-3 text-gray-400">你访问的页面去火星了</p>
    <RouterLink to="/" class="inline-block mt-6 px-6 py-2 bg-primary text-white rounded-lg hover:bg-primary-dark transition">
      返回首页
    </RouterLink>
  </div>
</template>

<script setup lang="ts">
import { useHead } from '@unhead/vue'

useHead({ title: '页面不存在 - LrcShare' })
</script>
