<template>
  <main class="max-w-5xl mx-auto px-4 py-8 space-y-6">
    <div v-if="loading" class="w-full text-center py-16 text-gray-400">加载中...</div>

    <template v-else-if="artist">
      <!-- Header Card（实体页统一头部：背景图可上下滚动/拖拽调整视觉位置；右侧简介面板带「歌手简介」标题） -->
      <EntityHeader
        :cover="avatar"
        cover-shape="circle"
        :cover-contain="avatar === LOGO_URL"
        :bg-image="artist.bg_image || HERO_BG_URL"
        bg-adjustable
        :bg-position="artist.bg_position_y ?? 50"
        intro-title="歌手简介"
        :intro-html="artist.bio ?? undefined"
        :preview-images="[avatar, artist.bg_image || HERO_BG_URL]"
      >
        <div class="flex items-center gap-3 justify-center md:justify-start flex-wrap">
          <!-- 桌面端整行不换行：名字+消歧义+别名超出容器宽度时统一省略号截断 -->
          <h1 class="text-3xl font-bold text-white drop-shadow truncate max-w-full" :title="h1Title">
            {{ artist.name }}
            <span v-if="artist.disambiguation" class="text-base font-normal text-white/80 ml-1">({{ artist.disambiguation }})</span>
            <span v-if="artist.aliases?.length" class="hidden md:inline text-lg font-normal text-white/70 ml-2">{{ artist.aliases.join(' / ') }}</span>
          </h1>
        </div>
        <!-- 移动端别名另起一行：单行截断 + 悬浮提示完整内容 -->
        <div
          v-if="artist.aliases?.length"
          class="md:hidden text-base font-normal text-white/70 truncate max-w-full mt-0.5"
          :title="artist.aliases.join(' / ')"
        >{{ artist.aliases.join(' / ') }}</div>
        <div v-if="socialEntries.length" class="flex items-center gap-1 mt-2 justify-center md:justify-start">
          <!-- 白底毛玻璃框：品牌彩色 logo 本就按白底设计（GitHub 灰褐等在白底最标准），深色 hero 上醒目清晰 -->
          <a
            v-for="[key, url] in socialEntries"
            :key="key"
            :href="url"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center justify-center w-9 h-9 rounded-lg bg-white/90 backdrop-blur-sm shadow-sm hover:bg-white hover:scale-105 transition"
          ><AppIcon :name="key" class="w-5.5 h-5.5" /></a>
        </div>
        <div class="flex items-center gap-2 mt-2 flex-wrap justify-center md:justify-start">
          <span
            v-for="t in artist.types || ['singer']"
            :key="t"
            class="text-sm bg-gradient-to-r text-white px-3 py-1 rounded-full"
            :class="ARTIST_TYPE_GRADIENTS[t] || 'from-gray-500 to-gray-600'"
          >{{ ARTIST_TYPE_ICONS[t] || '🎨' }} {{ ARTIST_TYPE_LABELS[t] || t }}</span>
        </div>
        <div class="flex gap-5 mt-2.5 text-sm text-white/80 justify-center md:justify-start">
          <span class="flex items-center gap-1">🎵 {{ songs.length }} 首作品</span>
          <span v-if="albums.length" class="flex items-center gap-1">📀 {{ albums.length }} 张专辑</span>
        </div>
      </EntityHeader>

      <!-- Tabs -->
      <div class="bg-white rounded-2xl shadow-sm">
        <div class="flex border-b border-gray-100 px-6 overflow-x-auto">
          <button
            v-for="tab in tabs"
            :key="tab.key"
            class="px-4 py-3 font-medium whitespace-nowrap transition"
            :class="activeTab === tab.key ? 'tab-active' : 'tab-inactive'"
            @click="switchTab(tab.key)"
          >{{ tab.label }} <span class="text-xs text-gray-400 ml-1">({{ tab.count }})</span></button>
        </div>
        <div class="p-6">
          <!-- 专辑 -->
          <template v-if="activeTab === 'albums'">
            <div v-if="!albums.length" class="text-center py-12 text-gray-400">
              <div class="text-4xl mb-3">📀</div>
              <p>暂无专辑</p>
            </div>
            <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <RouterLink
                v-for="album in albums"
                :key="album.id"
                :to="`/album/${album.id}`"
                class="album-card flex items-center gap-4 p-3 rounded-xl bg-gray-50 hover:bg-gray-100 transition"
              >
                <div class="w-14 h-14 bg-gradient-to-br from-pink-400 to-purple-500 rounded-lg flex items-center justify-center text-white text-xl flex-shrink-0 overflow-hidden">
                  <img
                    v-if="album.cover"
                    :src="album.cover"
                    alt="专辑封面"
                    class="w-full h-full rounded-lg object-cover cursor-zoom-in"
                    @click.prevent.stop="ui.openPreview([album.cover!], 0)"
                  />
                  <img v-else :src="LOGO_URL" alt="" class="w-full h-full rounded-lg object-contain p-1" />
                </div>
                <div class="min-w-0 flex-1">
                  <div class="font-medium text-gray-800 truncate">{{ album.name }}</div>
                  <div class="text-sm text-gray-500">{{ album.year || '' }} · {{ album.song_count || 0 }} 首歌曲</div>
                </div>
              </RouterLink>
            </div>
          </template>

          <!-- 歌曲列表 -->
          <template v-else>
            <div v-if="!tabSongs.length" class="text-center py-12 text-gray-400">
              <div class="text-4xl mb-3">🎵</div>
              <p>暂无{{ TAB_LABELS[currentTab] || '' }}的歌曲</p>
            </div>
            <template v-else>
              <!-- 桌面表格 -->
              <div class="hidden md:block space-y-1">
                <div class="grid grid-cols-[30px_1fr_120px_80px] gap-4 px-4 py-2 text-xs text-gray-400 border-b border-gray-100">
                  <span>#</span><span>歌曲</span><span>专辑</span><span class="text-right">时长</span>
                </div>
                <RouterLink
                  v-for="(song, i) in tabSongs"
                  :key="song.id"
                  :to="`/song/${song.id}`"
                  class="song-row grid grid-cols-[30px_1fr_120px_80px] gap-4 px-4 py-3 rounded-lg items-center transition group"
                >
                  <span class="text-gray-400 text-sm">{{ String(i + 1).padStart(2, '0') }}</span>
                  <div class="min-w-0">
                    <div class="font-medium text-gray-800 truncate group-hover:text-pink-600">{{ song.title }}</div>
                    <div v-if="song.contributions.length" class="mt-1">
                      <span v-for="c in song.contributions" :key="c" class="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 ml-1">{{ TAB_LABELS[c] || c }}</span>
                    </div>
                  </div>
                  <div class="text-sm text-gray-500 truncate">{{ song.album_name || '未知' }}</div>
                  <div class="text-sm text-gray-400 text-right tabular-nums">{{ formatDuration(song.duration) }}</div>
                </RouterLink>
              </div>
              <!-- 移动端列表 -->
              <div class="md:hidden flex flex-col px-1">
                <RouterLink
                  v-for="(song, i) in tabSongs"
                  :key="song.id"
                  :to="`/song/${song.id}`"
                  class="flex items-center gap-3 py-3 border-b border-gray-100 last:border-b-0"
                >
                  <span class="w-7 h-7 flex items-center justify-center text-[13px] font-semibold text-pink-500 bg-pink-50 rounded-lg shrink-0">{{ String(i + 1).padStart(2, '0') }}</span>
                  <div class="flex-1 min-w-0 flex flex-col gap-0.5">
                    <span class="text-[15px] font-semibold text-gray-800 truncate">{{ song.title }}</span>
                    <span class="text-xs text-gray-400 truncate">
                      <span v-for="c in song.contributions" :key="c" class="inline-block mr-1 px-1.5 py-px rounded bg-gray-100 text-[11px] text-gray-500">{{ TAB_LABELS[c] || c }}</span>
                      {{ song.album_name || '未知' }}
                    </span>
                  </div>
                  <span class="text-[13px] text-gray-400 tabular-nums shrink-0">{{ formatDuration(song.duration) }}</span>
                </RouterLink>
              </div>
            </template>
          </template>
        </div>
      </div>
    </template>
  </main>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useHead } from '@unhead/vue'
import { api, formatDuration } from '@/lib/api'
import { useSSGData } from '@/composables/useSSGData'
import { useUiStore } from '@/stores/ui'
import { LOGO_URL, HERO_BG_URL, ARTIST_TYPE_ICONS, ARTIST_TYPE_LABELS, ARTIST_TYPE_GRADIENTS } from '@/lib/constants'
import AppIcon from '@/components/common/AppIcon.vue'
import type { AlbumWithArtists, Artist, SongWithNames } from '@/lib/types'

const route = useRoute()
const router = useRouter()
const artistId = route.params.id as string
const ui = useUiStore()

/** tab key → 中文（歌曲贡献类型） */
const TAB_LABELS: Record<string, string> = { singer: '演唱', lyricist: '作词', composer: '作曲', arranger: '编曲' }

interface ArtistPageData {
  artist: Artist
  songs: (SongWithNames & { roles: string[]; contributions: string[] })[]
  albums: (AlbumWithArtists & { song_count: number })[]
}

const { data: page, loading } = useSSGData<ArtistPageData>(`artist:${artistId}`, async () => {
  const artist = await api.getArtist(artistId)
  const [songs, albums] = await Promise.all([
    api.getArtistSongs(artistId),
    api.getArtistAlbums(artistId),
  ])

  // 每首歌的贡献类型由 RPC roles 返回（双源：中间表 ∪ 旧列），前端不再 split 解析
  const withContrib = songs.map(s => {
    return { ...s, contributions: (s.roles || []).filter(r => TAB_LABELS[r]) }
  })

  // 从歌曲数据计算每个专辑的歌曲数
  const countMap: Record<string, number> = {}
  withContrib.forEach(s => {
    if (s.album_id) countMap[s.album_id] = (countMap[s.album_id] || 0) + 1
  })

  return {
    artist,
    songs: withContrib,
    albums: albums
      .map(a => ({ ...a, song_count: countMap[a.id] || 0 }))
      .sort((a, b) => {
        const ya = a.year ? Number(a.year) : 9999
        const yb = b.year ? Number(b.year) : 9999
        if (ya !== yb) return ya - yb
        return (a.name || '').localeCompare(b.name || '')
      }),
  }
})

const artist = computed(() => page.value?.artist)
const songs = computed(() => page.value?.songs || [])
const albums = computed(() => page.value?.albums || [])
const avatar = computed(() => artist.value?.avatar || LOGO_URL)

useHead({
  title: computed(() => (artist.value ? `${artist.value.name} - LrcShare` : '艺术家详情 - LrcShare')),
  meta: [
    { name: 'description', content: computed(() => (artist.value ? `${artist.value.name}的音乐作品集 - ${songs.value.length} 首作品 - LrcShare` : '艺术家详情')) },
  ],
})

const socialEntries = computed<[string, string][]>(() =>
  Object.entries(artist.value?.urls || {}).filter(([, v]) => v && v.trim()) as [string, string][],
)

/** h1 悬浮完整标题：截断后悬浮可见全名+别名 */
const h1Title = computed(() => {
  const a = artist.value
  if (!a) return ''
  const parts = [a.name]
  if (a.disambiguation) parts.push(`(${a.disambiguation})`)
  if (a.aliases?.length) parts.push(a.aliases.join(' / '))
  return parts.join(' ')
})

/** 按实际歌曲贡献生成标签页（不依赖 artist.types——types 漏标时（如 GAI 作曲）歌曲署名才是事实来源） */
const tabs = computed(() => {
  const result: { key: string; label: string; count: number }[] = []
  for (const t of ['singer', 'lyricist', 'composer', 'arranger'] as const) {
    const count = songs.value.filter(s => s.contributions.includes(t)).length
    if (count > 0) result.push({ key: t, label: `${ARTIST_TYPE_ICONS[t]} ${TAB_LABELS[t]}`, count })
  }
  if (albums.value.length) result.push({ key: 'albums', label: '📀 专辑', count: albums.value.length })
  if (result.length === 0) result.push({ key: 'songs', label: '🎵 歌曲', count: songs.value.length })
  return result
})

// tab 状态写入路由 query（?tab=xxx），进入专辑/歌曲详情后返回时可恢复所在 tab
const currentTab = ref(typeof route.query.tab === 'string' ? route.query.tab : '')

function switchTab(key: string) {
  currentTab.value = key
  // 第一个 tab 不带 query，保持 URL 干净；replace 不产生多余历史记录
  router.replace({ query: key === tabs.value[0]?.key ? { ...route.query, tab: undefined } : { ...route.query, tab: key } })
}

// 浏览器后退/前进同路由 query 变化时同步；非法 tab 值回退到第一个
watch(() => route.query.tab, (t) => {
  if (typeof t === 'string' && t !== currentTab.value) currentTab.value = t
})
watch(tabs, (list) => {
  if (currentTab.value && !list.some(t => t.key === currentTab.value)) currentTab.value = ''
})

// 实际生效的 tab：currentTab 为空表示第一个 tab（如 label 类艺术家首个 tab 可能是 albums）
const activeTab = computed(() => currentTab.value || tabs.value[0]?.key || '')

const tabSongs = computed(() => {
  if (!activeTab.value || activeTab.value === 'songs' || activeTab.value === 'albums') return songs.value
  return songs.value.filter(s => s.contributions.includes(activeTab.value))
})
</script>

<style scoped>
.tab-active { color: #ec4899; border-bottom: 3px solid #ec4899; }
.tab-inactive { color: #6b7280; border-bottom: 3px solid transparent; }
.tab-inactive:hover { color: #ec4899; }
.song-row:hover { background: linear-gradient(90deg, #fdf2f8 0%, #faf5ff 100%); }
.album-card:hover { transform: translateY(-2px); }
</style>
