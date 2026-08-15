<template>
  <main class="max-w-6xl mx-auto px-4 py-8">
    <div class="mb-8">
      <h1 class="text-3xl font-bold text-gray-800">🎨 艺术家库</h1>
      <p class="text-gray-500 mt-2">汇聚歌手、作词人、作曲人、编曲人的音乐作品集</p>
    </div>

    <!-- Tabs -->
    <div class="flex gap-2 mb-6 flex-wrap">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="px-5 py-2.5 rounded-full font-medium transition"
        :class="currentType === t.key ? 'tab-active' : 'tab-inactive'"
        @click="currentType = t.key"
      >{{ t.label }}</button>
    </div>

    <!-- Artist Grid -->
    <div v-if="loading" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      <div v-for="i in 8" :key="i" class="bg-white rounded-2xl p-5 shadow-sm animate-pulse">
        <div class="w-20 h-20 rounded-full mx-auto mb-3 bg-gray-200"></div>
        <div class="h-5 bg-gray-200 rounded mx-auto w-2/3 mb-2"></div>
        <div class="h-3 bg-gray-100 rounded mx-auto w-1/2"></div>
      </div>
    </div>
    <div v-else-if="!filtered.length" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      <div class="col-span-full text-center py-16">
        <div class="text-6xl mb-4">🎵</div>
        <p class="text-gray-400 text-lg">暂无{{ currentType ? ARTIST_TYPE_LABELS[currentType] : '艺术家' }}</p>
      </div>
    </div>
    <div v-else class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      <RouterLink
        v-for="artist in filtered"
        :key="artist.id"
        :to="`/artist/${artist.id}`"
        class="bg-white rounded-2xl p-5 shadow-sm hover:shadow-lg transition text-center group relative overflow-hidden"
      >
        <!-- Type badges -->
        <div class="absolute top-2 right-2 flex gap-1 flex-wrap justify-end max-w-[60%]">
          <span
            v-for="t in artist.types || ['singer']"
            :key="t"
            class="bg-gradient-to-r text-white px-2 py-0.5 rounded-full text-xs whitespace-nowrap"
            :class="ARTIST_TYPE_GRADIENTS[t] || 'from-gray-500 to-gray-600'"
          >{{ ARTIST_TYPE_ICONS[t] || '🎨' }} {{ ARTIST_TYPE_LABELS[t] || t }}</span>
        </div>
        <img
          :src="artist.avatar || LOGO_URL"
          :alt="artist.name"
          referrerpolicy="no-referrer"
          class="w-20 h-20 rounded-full mx-auto mb-3 bg-gray-100 object-contain group-hover:scale-105 transition shadow-md"
        />
        <div class="font-bold text-gray-800 text-lg truncate">
          {{ artist.name }}
          <span v-if="artist.disambiguation" class="text-xs font-normal text-purple-500 ml-1">({{ artist.disambiguation }})</span>
        </div>
        <!-- 社交链接 -->
        <div v-if="socialEntries(artist).length" class="flex items-center justify-center gap-1 mt-1 relative z-10">
          <a
            v-for="[key, url] in socialEntries(artist)"
            :key="key"
            :href="url"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center justify-center w-8 h-8 text-gray-400 hover:text-pink-500 transition"
            @click.stop
          ><AppIcon :name="key" class="w-6 h-6" /></a>
        </div>
        <div v-if="artist.aliases?.length" class="text-xs text-gray-400 mt-0.5 truncate">{{ artist.aliases.join(' / ') }}</div>
        <div v-if="artist.bio" class="text-xs text-gray-400 mt-2 line-clamp-2" :title="artist.bio">{{ artist.bio }}</div>
      </RouterLink>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useHead } from '@unhead/vue'
import { api } from '@/lib/api'
import { useSSGData } from '@/composables/useSSGData'
import { LOGO_URL, ARTIST_TYPE_ICONS, ARTIST_TYPE_LABELS, ARTIST_TYPE_GRADIENTS } from '@/lib/constants'
import AppIcon from '@/components/common/AppIcon.vue'
import type { Artist } from '@/lib/types'

useHead({
  title: '艺术家库 - LrcShare',
  meta: [{ name: 'description', content: '汇聚歌手、作词人、作曲人、编曲人的音乐作品集 - LrcShare' }],
})

const tabs = [
  { key: 'singer', label: '🎤 歌手' },
  { key: 'lyricist', label: '📝 作词人' },
  { key: 'composer', label: '🎼 作曲人' },
  { key: 'arranger', label: '🎹 编曲人' },
  { key: '', label: '🌟 全部' },
]

const currentType = ref('singer')

const { data: artists, loading } = useSSGData<Artist[]>('artists', () => api.getArtists())

const filtered = computed(() => {
  const list = artists.value || []
  if (!currentType.value) return list
  return list.filter(a => (a.types || ['singer']).includes(currentType.value))
})

function socialEntries(artist: Artist): [string, string][] {
  return Object.entries(artist.urls || {}).filter(([, v]) => v && v.trim()) as [string, string][]
}
</script>

<style scoped>
.tab-active {
  background: linear-gradient(135deg, #ec4899, #8b5cf6);
  color: white;
}
.tab-inactive {
  background: white;
  color: #6b7280;
}
.tab-inactive:hover {
  background: #f3f4f6;
  color: #ec4899;
}
</style>
