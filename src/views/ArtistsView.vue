<template>
  <main class="max-w-6xl mx-auto px-4 py-8">
    <div class="mb-8">
      <h1 class="text-3xl font-bold text-gray-800">🎨 艺术家库</h1>
      <p class="text-gray-500 mt-2">汇聚歌手、作词人、作曲人、编曲人的音乐作品集</p>
    </div>

    <!-- Tabs -->
    <div class="flex gap-2 mb-4 flex-wrap">
      <button
        v-for="t in tabs"
        :key="t.key"
        class="px-5 py-2.5 rounded-full font-medium transition"
        :class="currentType === t.key ? 'tab-active' : 'tab-inactive'"
        @click="currentType = t.key"
      >{{ t.label }}</button>
    </div>

    <!-- Search -->
    <div class="relative mb-6">
      <input
        v-model="keyword"
        type="text"
        placeholder="搜索艺术家名称或别名…"
        class="w-full bg-white rounded-full border border-gray-200 shadow-sm pl-11 pr-10 py-2.5 text-gray-700 placeholder-gray-400 focus:outline-none focus:border-pink-300 focus:ring-2 focus:ring-pink-100 transition"
      />
      <span class="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
      <button
        v-if="keyword"
        class="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600 text-xs leading-none transition"
        @click="keyword = ''"
      >✕</button>
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
        <p class="text-gray-400 text-lg">{{ searching ? '没有找到匹配的艺术家' : `暂无${currentType ? ARTIST_TYPE_LABELS[currentType] : '艺术家'}` }}</p>
      </div>
    </div>
    <template v-else>
      <p v-if="searching" class="text-sm text-gray-400 mb-4">找到 {{ filtered.length }} 位艺术家</p>

      <!-- 分组列表：置顶 ★ 组 + A-Z 拼音组；搜索时平铺单组 -->
      <section
        v-for="g in displayGroups"
        :id="groupId(g.letter)"
        :key="g.letter"
        class="scroll-mt-16 mb-6"
      >
        <div v-if="!searching" class="group-title sticky top-14 z-10 -mx-1 px-1 py-1.5 mb-2">
          <span class="inline-block text-xl font-bold text-pink-500">{{ g.letter === PINNED ? '⭐ 置顶' : g.letter }}</span>
        </div>
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          <RouterLink
            v-for="artist in g.items"
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
      </section>
    </template>

    <!-- A-Z 索引条（搜索时隐藏） -->
    <nav
      v-if="!loading && !searching && displayGroups.length"
      class="fixed right-1 top-1/2 -translate-y-1/2 z-40 flex flex-col gap-0.5 items-center bg-white/90 backdrop-blur rounded-full shadow-md py-1.5 px-1"
      aria-label="首字母索引"
    >
      <button
        v-for="g in displayGroups"
        :key="g.letter"
        class="w-6 h-6 rounded-full text-xs font-bold text-gray-500 hover:bg-pink-100 hover:text-pink-500 flex items-center justify-center transition"
        :title="g.letter === PINNED ? '置顶' : g.letter"
        @click="scrollToGroup(g.letter)"
      >{{ g.letter === PINNED ? '⭐' : g.letter }}</button>
    </nav>
  </main>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useHead } from '@unhead/vue'
import { api } from '@/lib/api'
import { useSSGData } from '@/composables/useSSGData'
import { LOGO_URL, ARTIST_TYPE_ICONS, ARTIST_TYPE_LABELS, ARTIST_TYPE_GRADIENTS } from '@/lib/constants'
import { groupByInitial, type AlphaGroup } from '@/lib/pinyinGroup'
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

const PINNED = '★'
const currentType = ref('singer')
const keyword = ref('')

const { data: artists, loading } = useSSGData<Artist[]>('artists', () => api.getArtists())

const searching = computed(() => keyword.value.trim().length > 0)

const filtered = computed(() => {
  const list = artists.value || []
  const base = currentType.value ? list.filter(a => (a.types || ['singer']).includes(currentType.value)) : list
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return base
  return base.filter(a =>
    a.name.toLowerCase().includes(kw) ||
    (a.aliases || []).some(al => al.toLowerCase().includes(kw)) ||
    (a.disambiguation || '').toLowerCase().includes(kw)
  )
})

/** 置顶组（sort > 0，按 sort 降序），仅在非搜索时展示 */
const pinned = computed(() => {
  if (searching.value) return []
  return [...filtered.value]
    .filter(a => (a.sort || 0) > 0)
    .sort((x, y) => (y.sort || 0) - (x.sort || 0) || x.name.localeCompare(y.name, 'zh'))
})

/** 字母分组（排除置顶，避免重复出现）；搜索时平铺为单组按拼音排序 */
const groups = computed<AlphaGroup<Artist>[]>(() => {
  if (searching.value) {
    return [{
      letter: '',
      items: [...filtered.value].sort((x, y) => x.name.localeCompare(y.name, 'zh')),
    }]
  }
  return groupByInitial(
    filtered.value.filter(a => (a.sort || 0) <= 0),
    a => a.name,
    a => a.initial
  )
})

const displayGroups = computed<AlphaGroup<Artist>[]>(() => {
  const gs: AlphaGroup<Artist>[] = []
  if (pinned.value.length) gs.push({ letter: PINNED, items: pinned.value })
  gs.push(...groups.value)
  return gs
})

function groupId(letter: string) {
  if (letter === PINNED) return 'group-top'
  if (letter === '#') return 'group-hash'
  return 'group-' + letter
}

function scrollToGroup(letter: string) {
  document.getElementById(groupId(letter))?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

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
.group-title {
  background: linear-gradient(to bottom, #fff 80%, transparent);
}
</style>
