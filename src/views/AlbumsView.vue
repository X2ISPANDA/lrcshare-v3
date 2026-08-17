<template>
  <main class="max-w-6xl mx-auto px-4 py-8">
    <div class="mb-8">
      <h1 class="text-3xl font-bold text-gray-800">💿 专辑库</h1>
      <p class="text-gray-500 mt-2">浏览所有收录的音乐专辑</p>
    </div>

    <!-- Search -->
    <div class="relative mb-6">
      <input
        v-model="keyword"
        type="text"
        placeholder="搜索专辑名或专辑艺术家…"
        class="w-full bg-white rounded-full border border-gray-200 shadow-sm pl-11 pr-10 py-2.5 text-gray-700 placeholder-gray-400 focus:outline-none focus:border-pink-300 focus:ring-2 focus:ring-pink-100 transition"
      />
      <span class="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
      <button
        v-if="keyword"
        class="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600 text-xs leading-none transition"
        @click="keyword = ''"
      >✕</button>
    </div>

    <!-- Album Grid -->
    <div v-if="loading" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      <div v-for="i in 8" :key="i" class="bg-white rounded-2xl p-5 shadow-sm animate-pulse">
        <div class="w-24 h-24 rounded-xl mx-auto mb-3 bg-gray-200"></div>
        <div class="h-5 bg-gray-200 rounded mx-auto w-2/3 mb-2"></div>
        <div class="h-3 bg-gray-100 rounded mx-auto w-1/2"></div>
      </div>
    </div>
    <div v-else-if="!filtered.length" class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
      <div class="col-span-full text-center py-16">
        <div class="text-6xl mb-4">💿</div>
        <p class="text-gray-400 text-lg">{{ searching ? '没有找到匹配的专辑' : '暂无专辑' }}</p>
      </div>
    </div>
    <template v-else>
      <p v-if="searching" class="text-sm text-gray-400 mb-4">找到 {{ filtered.length }} 张专辑</p>

      <!-- 分组列表：A-Z 拼音组；搜索时平铺单组 -->
      <section
        v-for="g in groups"
        :id="groupId(g.letter)"
        :key="g.letter || 'all'"
        class="scroll-mt-16 mb-6"
      >
        <div v-if="!searching" class="group-title sticky top-14 z-10 -mx-1 px-1 py-1.5 mb-2">
          <span class="inline-block text-xl font-bold text-pink-500">{{ g.letter }}</span>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <RouterLink
            v-for="album in g.items"
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
      </section>
    </template>

    <!-- A-Z 索引条（搜索时隐藏） -->
    <nav
      v-if="!loading && !searching && groups.length"
      class="fixed right-1 top-1/2 -translate-y-1/2 z-40 flex flex-col gap-0.5 items-center bg-white/90 backdrop-blur rounded-full shadow-md py-1.5 px-1"
      aria-label="首字母索引"
    >
      <button
        v-for="g in groups"
        :key="g.letter"
        class="w-6 h-6 rounded-full text-xs font-bold text-gray-500 hover:bg-pink-100 hover:text-pink-500 flex items-center justify-center transition"
        :title="g.letter"
        @click="scrollToGroup(g.letter)"
      >{{ g.letter }}</button>
    </nav>
  </main>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useHead } from '@unhead/vue'
import { api } from '@/lib/api'
import { useSSGData } from '@/composables/useSSGData'
import { useUiStore } from '@/stores/ui'
import { LOGO_URL } from '@/lib/constants'
import { groupByInitial, type AlphaGroup } from '@/lib/pinyinGroup'
import type { AlbumWithArtists } from '@/lib/types'

useHead({
  title: '专辑库 - LrcShare',
  meta: [{ name: 'description', content: '浏览所有收录的音乐专辑 - LrcShare' }],
})

const ui = useUiStore()
const keyword = ref('')

const { data: albums, loading } = useSSGData<AlbumWithArtists[]>('albums', () => api.getAlbums())

const searching = computed(() => keyword.value.trim().length > 0)

const filtered = computed(() => {
  const list = albums.value || []
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return list
  return list.filter(a =>
    a.name.toLowerCase().includes(kw) ||
    (a.artist_name || '').toLowerCase().includes(kw)
  )
})

/** 字母分组；搜索时平铺为单组按拼音排序 */
const groups = computed<AlphaGroup<AlbumWithArtists>[]>(() => {
  if (searching.value) {
    return [{
      letter: '',
      items: [...filtered.value].sort((x, y) => x.name.localeCompare(y.name, 'zh')),
    }]
  }
  return groupByInitial(filtered.value, a => a.name, a => a.initial)
})

function groupId(letter: string) {
  if (letter === '#') return 'group-hash'
  return 'group-' + letter
}

function scrollToGroup(letter: string) {
  document.getElementById(groupId(letter))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}
</script>

<style scoped>
.group-title {
  background: linear-gradient(to bottom, #fff 80%, transparent);
}
</style>
