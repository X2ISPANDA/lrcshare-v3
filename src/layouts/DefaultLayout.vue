<template>
  <div class="min-h-screen flex flex-col bg-gray-50">
    <AppNavbar />
    <main class="flex-1">
      <router-view v-slot="{ Component }">
        <!-- key=route.path：同路由不同参数（如 /artist/A → /artist/B）强制重建组件，
             否则 Vue Router 复用实例、setup 不重跑，URL 变了页面不跳（搜索弹框踩坑）。
             用 path 而非 fullPath：query 变化（tab 状态持久化）不重建页面 -->
        <component :is="Component" :key="route.path" />
      </router-view>
    </main>
    <AppFooter />
    <SearchOverlay />
    <ImgPreview />
  </div>
</template>

<script setup lang="ts">
import { useRoute } from 'vue-router'
import AppNavbar from '@/components/layout/AppNavbar.vue'
import AppFooter from '@/components/layout/AppFooter.vue'
import SearchOverlay from '@/components/layout/SearchOverlay.vue'
import ImgPreview from '@/components/layout/ImgPreview.vue'

const route = useRoute()
</script>
