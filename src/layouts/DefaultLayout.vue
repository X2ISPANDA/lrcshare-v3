<template>
  <div class="min-h-screen flex flex-col bg-gray-50">
    <AppNavbar />
    <main class="flex-1">
      <router-view v-slot="{ Component }">
        <component :is="Component" />
      </router-view>
    </main>
    <AppFooter />
    <SearchOverlay />
    <ImgPreview />
  </div>
</template>

<script setup lang="ts">
import AppNavbar from '@/components/layout/AppNavbar.vue'
import AppFooter from '@/components/layout/AppFooter.vue'
import SearchOverlay from '@/components/layout/SearchOverlay.vue'
import ImgPreview from '@/components/layout/ImgPreview.vue'
</script>
