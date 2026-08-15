<template>
  <main class="max-w-6xl mx-auto px-4 py-8">
    <div class="mb-8">
      <h1 class="text-3xl font-bold text-gray-800">💿 专辑库</h1>
      <p class="text-gray-500 mt-2">浏览所有收录的音乐专辑</p>
    </div>

    <!-- Album Grid -->
    <div v-if="loading" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      <div v-for="i in 8" :key="i" class="bg-white rounded-2xl p-5 shadow-sm animate-pulse">
        <div class="w-24 h-24 rounded-xl mx-auto mb-3 bg-gray-200"></div>
        <div class="h-5 bg-gray-200 rounded mx-auto w-2/3 mb-2"></div>
        <div class="h-3 bg-gray-100 rounded mx-auto w-1/2"></div>
      </div>
    </div>
    <div v-else-if="!albums?.length" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      <div class="col-span-full text-center py-16">
        <div class="text-6xl mb-4">💿</div>
        <p class="text-gray-400 text-lg">暂无专辑</p>
      </div>
    </div>
    <div v-else class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      <RouterLink
        v-for="album in albums"
        :key="album.id"
        :to="`/album/${album.id}`"
        class="bg-white rounded-2xl p-5 shadow-sm hover:shadow-lg transition text-center group"
      >
        <div class="relative mx-auto mb-3 w-24 h-24">
          <img
            :src="album.cover || LOGO_URL"
            :alt="album.name"
            referrerpolicy="no-referrer"
            class="w-24 h-24 rounded-xl mx-auto bg-gray-100 object-contain group-hover:scale-105 transition shadow-md cursor-zoom-in"
            @click.prevent.stop="ui.openPreview([album.cover || LOGO_URL], 0)"
          />
        </div>
        <div class="font-bold text-gray-800 truncate text-lg">{{ album.name }}</div>
        <div v-if="album.artist_name" class="text-sm text-gray-500 mt-0.5 truncate">{{ album.artist_name }}</div>
        <div class="flex items-center justify-center gap-3 mt-2 text-sm text-gray-500">
          <span v-if="album.year">📅 {{ album.year }}</span>
        </div>
      </RouterLink>
    </div>
  </main>
</template>

<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { api } from '@/lib/api'
import { useSSGData } from '@/composables/useSSGData'
import { useUiStore } from '@/stores/ui'
import { LOGO_URL } from '@/lib/constants'
import type { AlbumWithArtists } from '@/lib/types'

useHead({
  title: '专辑库 - LrcShare',
  meta: [{ name: 'description', content: '浏览所有收录的音乐专辑 - LrcShare' }],
})

const ui = useUiStore()

const { data: albums, loading } = useSSGData<AlbumWithArtists[]>('albums', () => api.getAlbums())
</script>
