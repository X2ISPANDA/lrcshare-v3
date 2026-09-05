<template>
  <div>
    <!-- Hero 区：背景图 + 艺术字标题 + 搜索框 -->
    <section class="hero-bg text-white py-20">
      <img :src="HERO_BG_URL" alt="背景" class="hero-bg-img" />
      <div class="hero-content max-w-3xl mx-auto px-4 text-center">
        <img :src="LOGO_URL" alt="LrcShare Logo" class="w-24 h-24 mx-auto mb-4" />
        <h1 class="text-4xl md:text-5xl font-bold mb-4">
          <span
            v-for="(c, i) in HERO_CHARS"
            :key="i"
            class="art-title-char"
            :style="{ '--fly-x': c.x, '--fly-y': c.y, '--fly-rotate': c.r, animationDelay: `${i * 80 + 300}ms` }"
          >{{ c.ch }}</span>
        </h1>
        <p class="text-lg opacity-90 mb-8">全球最小滚动歌词分享网站</p>

        <!-- 搜索框（下拉建议，Enter 进入全局搜索弹窗） -->
        <div class="relative max-w-xl mx-auto" ref="searchWrapRef">
          <input
            v-model="keyword"
            type="text"
            placeholder="搜索歌曲、歌手或歌词..."
            class="w-full px-6 py-4 pl-14 rounded-full bg-white/95 backdrop-blur text-gray-800 text-lg placeholder-gray-400 shadow-lg focus:outline-none focus:ring-4 focus:ring-white/30"
            autocomplete="off"
            @input="onInput"
            @focus="keyword.trim() && doSearch()"
            @keyup.enter="keyword.trim() && ui.openSearch(keyword.trim())"
          />
          <svg class="absolute left-5 top-1/2 -translate-y-1/2 w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>

          <!-- 下拉建议 -->
          <div v-if="dropdownOpen" class="absolute w-full mt-2 bg-white rounded-2xl shadow-2xl overflow-hidden z-50 text-left">
            <div class="p-4 border-b bg-gray-50">
              <div class="flex gap-4 text-sm">
                <button
                  v-for="t in SEARCH_TABS"
                  :key="t.key"
                  :class="activeTab === t.key ? 'font-semibold text-pink-600 border-b-2 border-pink-600 pb-1' : 'text-gray-500 pb-1'"
                  @click="switchTab(t.key)"
                >{{ t.label }}</button>
              </div>
            </div>
            <div class="max-h-96 overflow-y-auto">
              <div v-if="searching" class="p-4 text-center text-gray-400">搜索中...</div>
              <template v-else>
                <!-- 歌手 -->
                <template v-if="showSection('artists') && results.artists.length">
                  <div class="px-4 py-2 text-xs font-semibold text-gray-400 uppercase">🎤 歌手</div>
                  <RouterLink
                    v-for="artist in results.artists.slice(0, 3)"
                    :key="artist.id"
                    :to="`/artist/${artist.id}`"
                    class="flex items-center gap-3 px-4 py-2 hover:bg-gray-50"
                  >
                    <img :src="artist.avatar || LOGO_URL" class="w-8 h-8 rounded-full bg-gray-200 object-cover" />
                    <div class="flex-1">
                      <div class="text-sm font-medium text-gray-800">
                        <span v-html="hl(artist.name)"></span>
                        <span v-if="artist.disambiguation" class="text-xs text-purple-500 ml-1">({{ artist.disambiguation }})</span>
                        <span class="text-xs text-gray-400 ml-1">{{ artistTypeIcons(artist.types) }}</span>
                      </div>
                    </div>
                  </RouterLink>
                </template>

                <!-- 专辑 -->
                <template v-if="showSection('albums') && results.albums.length">
                  <div class="px-4 py-2 text-xs font-semibold text-gray-400 uppercase border-t">💿 专辑</div>
                  <RouterLink
                    v-for="album in results.albums.slice(0, 3)"
                    :key="album.id"
                    :to="`/album/${album.id}`"
                    class="flex items-center gap-3 px-4 py-2 hover:bg-gray-50"
                  >
                    <div class="w-8 h-8 bg-gradient-to-br from-pink-500 to-purple-600 rounded flex items-center justify-center overflow-hidden">
                      <img v-if="album.cover" :src="album.cover" class="w-full h-full object-cover" />
                      <span v-else class="text-white text-xs">💿</span>
                    </div>
                    <div class="flex-1">
                      <div class="text-sm font-medium text-gray-800"><span v-html="hl(album.name)"></span></div>
                      <div class="text-xs text-gray-500">{{ album.year || '' }}</div>
                    </div>
                  </RouterLink>
                </template>

                <!-- 单曲 -->
                <template v-if="showSection('songs') && results.songs.length">
                  <div class="px-4 py-2 text-xs font-semibold text-gray-400 uppercase border-t">🎵 单曲</div>
                  <RouterLink
                    v-for="song in results.songs.slice(0, 5)"
                    :key="song.id"
                    :to="`/song/${song.id}`"
                    class="flex items-center gap-3 px-4 py-2 hover:bg-gray-50"
                  >
                    <div class="w-8 h-8 bg-pink-100 rounded-full flex items-center justify-center text-pink-600 text-xs shrink-0">🎵</div>
                    <div class="flex-1 min-w-0">
                      <div class="text-sm font-medium text-gray-800 truncate"><span v-html="hl(song.title)"></span></div>
                      <div class="text-xs text-gray-500 truncate">
                        <span v-html="hl(song.artist_name)"></span> · <span v-html="hl(song.album_name ?? '')"></span>
                      </div>
                    </div>
                    <span class="text-xs text-gray-400 shrink-0 tabular-nums">{{ formatDuration(song.duration) }}</span>
                  </RouterLink>
                </template>

                <!-- 歌词 -->
                <template v-if="showSection('lyrics') && results.lyrics.length">
                  <div class="px-4 py-2 text-xs font-semibold text-gray-400 uppercase border-t">📝 歌词</div>
                  <RouterLink
                    v-for="song in results.lyrics.slice(0, 5)"
                    :key="song.id"
                    :to="`/song/${song.id}`"
                    class="flex items-center gap-3 px-4 py-2 hover:bg-gray-50"
                  >
                    <div class="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center text-purple-600 text-xs shrink-0">📝</div>
                    <div class="flex-1 min-w-0">
                      <div class="text-sm font-medium text-gray-800 truncate"><span v-html="hl(song.title)"></span></div>
                      <div class="text-xs text-gray-500 truncate"><span v-html="hl(song.artist_name)"></span></div>
                      <div class="text-xs text-gray-400 mt-0.5 truncate">...<span v-html="hl(snippet(song))"></span>...</div>
                    </div>
                  </RouterLink>
                </template>

                <div v-if="totalCount === 0" class="p-8 text-center text-gray-400">没有找到相关结果</div>
              </template>

              <div v-if="totalCount > 0" class="border-t px-4 py-2 text-center">
                <button class="text-sm text-pink-600 hover:underline" @click="ui.openSearch(keyword.trim())">
                  查看全部 {{ totalCount }} 个结果 →
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 内容区 -->
    <main class="max-w-6xl mx-auto px-4 py-12">
      <!-- 艺术家 -->
      <section class="mb-12">
        <div class="flex items-center justify-between mb-6">
          <h2 class="text-2xl font-bold text-gray-800">艺术家</h2>
          <RouterLink to="/artists" class="text-pink-600 hover:underline">查看全部 →</RouterLink>
        </div>
        <div v-if="artistsLoading" class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div v-for="i in 6" :key="i" class="bg-white rounded-2xl p-4 shadow-sm animate-pulse">
            <div class="w-16 h-16 rounded-full bg-gray-100 mx-auto mb-2"></div>
            <div class="h-4 bg-gray-100 rounded mx-auto w-2/3"></div>
          </div>
        </div>
        <div v-else-if="!artists?.length" class="text-center py-8 text-gray-400">暂无艺术家</div>
        <div v-else class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <RouterLink
            v-for="artist in artists"
            :key="artist.id"
            :to="`/artist/${artist.id}`"
            class="bg-white rounded-2xl p-4 shadow-sm hover:shadow-lg transition text-center"
          >
            <img :src="artist.avatar || LOGO_URL" :alt="artist.name" class="w-16 h-16 rounded-full mx-auto mb-2 bg-gray-100 object-contain cursor-zoom-in" @click.prevent.stop="ui.openPreview([artist.avatar || LOGO_URL])" />
            <div class="font-semibold text-gray-800 truncate">{{ artist.name }}</div>
            <div v-if="artist.disambiguation" class="text-xs text-purple-500 truncate">{{ artist.disambiguation }}</div>
            <div class="mt-1 text-xs text-gray-400">{{ artistTypeIcons(artist.types) }}</div>
            <div class="text-xs text-gray-500 mt-1">{{ artist.song_count }} 首作品</div>
          </RouterLink>
        </div>
      </section>

      <!-- 最新歌词：NFC 歌曲卡（封面满印 + 底部渐变压字 + 投稿人） -->
      <section class="mb-12">
        <div class="flex items-center justify-between mb-6">
          <h2 class="text-2xl font-bold text-gray-800">🆕 最新歌词</h2>
          <RouterLink to="/songs" class="text-pink-600 hover:underline text-sm">查看全部 →</RouterLink>
        </div>
        <div v-if="songsLoading" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <div v-for="i in 10" :key="i" class="aspect-square rounded-2xl bg-white shadow-sm animate-pulse"></div>
        </div>
        <div v-else-if="!recentSongs?.length" class="bg-white rounded-2xl shadow-sm p-8 text-center text-gray-400">暂无歌词</div>
        <div v-else class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <SongNfcCard v-for="song in recentSongs" :key="song.id" :song="song" />
        </div>
      </section>

      <!-- 站长逼逼 + 优秀贡献者（并排等高） -->
      <section class="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <!-- 站长逼逼 -->
        <div class="bg-white rounded-2xl shadow-sm p-6 h-full">
          <div class="flex items-center justify-between mb-5">
            <h2 class="text-xl font-bold text-gray-800">📝 站长逼逼</h2>
            <RouterLink to="/posts" class="text-pink-600 hover:underline text-sm">查看全部 →</RouterLink>
          </div>
          <div v-if="articlesLoading" class="space-y-4">
            <div v-for="i in 3" :key="i" class="p-3"><div class="h-3 bg-gray-100 rounded w-1/4 mb-2"></div><div class="h-4 bg-gray-100 rounded w-3/4 mb-2"></div><div class="h-3 bg-gray-100 rounded"></div></div>
          </div>
          <div v-else-if="!articles?.length" class="text-sm text-gray-400 text-center py-4">
            暂无文章，<RouterLink to="/posts" class="text-pink-600 hover:underline">去看看 →</RouterLink>
          </div>
          <div v-else class="space-y-4">
            <RouterLink
              v-for="a in articles"
              :key="a.id"
              :to="`/post/${a.slug || a.id}`"
              class="block group p-3 rounded-lg hover:bg-pink-50/50 transition"
            >
              <div class="flex items-center gap-2 mb-1">
                <span class="text-xs text-gray-400">{{ formatDate(a.created_at) }}</span>
              </div>
              <div class="text-sm font-semibold text-gray-800 group-hover:text-pink-600 truncate mb-1">{{ a.title }}</div>
              <div class="text-xs text-gray-500 line-clamp-2">{{ a.summary?.trim() || mdToText(a.content) }}</div>
            </RouterLink>
          </div>
        </div>

        <!-- 优秀贡献者 -->
        <div class="bg-white rounded-2xl shadow-sm p-6 h-full">
          <div class="flex items-center justify-between mb-5">
            <h2 class="text-xl font-bold text-gray-800">🏆 优秀贡献者</h2>
            <RouterLink to="/contributors" class="text-pink-600 hover:underline text-sm">查看全部 →</RouterLink>
          </div>
          <div v-if="contributorsLoading" class="grid grid-cols-3 gap-3">
            <div v-for="i in 12" :key="i" class="flex flex-col items-center p-2"><div class="w-12 h-12 bg-gray-100 rounded-full mb-2"></div><div class="h-3 bg-gray-100 rounded w-full"></div></div>
          </div>
          <div v-else-if="!contributors?.length" class="text-sm text-gray-400 text-center py-4">
            暂无贡献者，<RouterLink to="/contributors" class="text-pink-600 hover:underline">全部名单 →</RouterLink>
          </div>
          <div v-else class="grid grid-cols-3 gap-3">
            <RouterLink
              v-for="c in contributors"
              :key="c.id"
              :to="`/contributor/${c.id}`"
              class="flex flex-col items-center p-2 rounded-lg hover:bg-pink-50/50 transition text-center"
            >
              <img :src="c.avatar || LOGO_URL" :alt="c.name" class="w-12 h-12 rounded-full bg-gray-100 object-cover ring-1 ring-pink-100 mb-2 cursor-zoom-in" @click.prevent.stop="ui.openPreview([c.avatar || LOGO_URL])" />
              <span class="font-medium text-sm text-gray-800 truncate w-full">{{ c.name }}</span>
            </RouterLink>
          </div>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDebounceFn, onClickOutside } from '@vueuse/core'
import { useHead } from '@unhead/vue'
import { api, formatDuration } from '@/lib/api'
import { highlightHtml, lrcSnippet } from '@/lib/highlight'
import { mdToText } from '@/lib/markdown'
import { HERO_BG_URL, LOGO_URL, artistTypeIcons } from '@/lib/constants'
import { useSSGData } from '@/composables/useSSGData'
import { useUiStore } from '@/stores/ui'
import type { Album, Article, Artist, ArtistWithCount, Contributor, SongWithNames } from '@/lib/types'

useHead({
  title: 'LrcShare - 全球最小滚动歌词分享网站',
  meta: [
    { name: 'description', content: '全球最小滚动歌词分享网站，搜索、分享、欣赏滚动歌词' },
  ],
})

const ui = useUiStore()

// ============ 数据（SSG 预取 → initialState 序列化进 HTML） ============
const { data: artists, loading: artistsLoading } = useSSGData<ArtistWithCount[]>('home:artists', () =>
  api.getArtists({ includeCount: true, limit: 6 }),
)
const { data: recentSongs, loading: songsLoading } = useSSGData<SongWithNames[]>('home:recent-songs', () =>
  api.getSongs(10),
)
const { data: articles, loading: articlesLoading } = useSSGData<Article[]>('home:articles', () =>
  api.getArticles({ status: 'published', limit: 4 }),
)
const { data: contributors, loading: contributorsLoading } = useSSGData<Contributor[]>('home:contributors', () =>
  api.getContributors({ limit: 12 }),
)

function formatDate(d: string | null | undefined): string {
  return d ? new Date(d).toLocaleDateString('zh-CN') : ''
}

// ============ Hero 艺术字（字符飞入动画参数迁移自 v2） ============
const HERO_CHARS = [
  { ch: 'L', x: '-60px', y: '-80px', r: '-180deg' },
  { ch: 'r', x: '50px', y: '-70px', r: '180deg' },
  { ch: 'c', x: '-45px', y: '50px', r: '-200deg' },
  { ch: 'S', x: '60px', y: '-50px', r: '220deg' },
  { ch: 'h', x: '-35px', y: '60px', r: '-240deg' },
  { ch: 'a', x: '45px', y: '-70px', r: '160deg' },
  { ch: 'r', x: '-55px', y: '45px', r: '-300deg' },
  { ch: 'e', x: '65px', y: '-80px', r: '200deg' },
]

// ============ 搜索下拉建议 ============
// 搜索状态（关键词 + 分类 tab）写入路由 query（?q=xxx&tab=xxx），点结果跳详情后返回时可恢复
const route = useRoute()
const router = useRouter()
const SEARCH_TABS = [
  { key: 'all', label: '全部' },
  { key: 'songs', label: '单曲' },
  { key: 'artists', label: '歌手' },
  { key: 'albums', label: '专辑' },
  { key: 'lyrics', label: '歌词' },
] as const
type TabKey = (typeof SEARCH_TABS)[number]['key']

const initialQ = typeof route.query.q === 'string' ? route.query.q : ''
const keyword = ref(initialQ)
const activeTab = ref<TabKey>(
  SEARCH_TABS.some(t => t.key === route.query.tab) ? (route.query.tab as TabKey) : 'all',
)
const dropdownOpen = ref(false)
const searching = ref(false)
const searchWrapRef = ref<HTMLElement>()
const results = ref<{ artists: Artist[]; albums: Album[]; songs: SongWithNames[]; lyrics: SongWithNames[] }>({
  artists: [],
  albums: [],
  songs: [],
  lyrics: [],
})

// 带 query 返回首页时自动恢复搜索结果（仅客户端）
onMounted(() => {
  if (keyword.value.trim()) doSearch()
})

/** 搜索状态同步到 query（replace 不产生多余历史记录；空值清除保持 URL 干净） */
function syncQuery() {
  const kw = keyword.value.trim()
  const tab = activeTab.value
  router.replace({
    query: {
      ...route.query,
      q: kw || undefined,
      tab: kw && tab !== 'all' ? tab : undefined,
    },
  })
}

function switchTab(key: TabKey) {
  activeTab.value = key
  if (keyword.value.trim()) doSearch()
}

const totalCount = computed(
  () => results.value.artists.length + results.value.albums.length + results.value.songs.length + results.value.lyrics.length,
)

function showSection(section: 'artists' | 'albums' | 'songs' | 'lyrics'): boolean {
  return activeTab.value === 'all' || activeTab.value === section
}

async function doSearch() {
  const kw = keyword.value.trim()
  if (!kw) return
  dropdownOpen.value = true
  searching.value = true
  syncQuery()
  try {
    results.value = await api.search(kw)
  } catch {
    results.value = { artists: [], albums: [], songs: [], lyrics: [] }
  } finally {
    searching.value = false
  }
}

const debouncedSearch = useDebounceFn(doSearch, 300)
function onInput() {
  if (!keyword.value.trim()) {
    dropdownOpen.value = false
    syncQuery()
    return
  }
  debouncedSearch()
}
onClickOutside(searchWrapRef, () => (dropdownOpen.value = false))

function hl(text: string): string {
  return highlightHtml(text, keyword.value)
}
function snippet(song: SongWithNames): string {
  return lrcSnippet(song.lrc_text, keyword.value) || lrcSnippet(song.lyrics_text, keyword.value)
}

</script>

<style scoped>
.hero-bg { position: relative; }
.hero-bg-img {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  object-fit: cover;
  object-position: center;
  z-index: 0;
  pointer-events: none;
}
.hero-bg::before {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 0;
}
.hero-content { position: relative; z-index: 1; }

/* 好莱坞风格艺术字：厚重阴影 + 飞入动画（keyframes 内读取每字符 CSS 变量） */
.art-title-char {
  display: inline-block;
  font-weight: 900;
  color: #fff;
  -webkit-text-fill-color: #fff;
  text-shadow:
    1px 1px 0 #1a0a2e, 2px 2px 0 #1a0a2e, 3px 3px 0 #1a0a2e, 4px 4px 0 #1a0a2e,
    5px 5px 0 #1a0a2e, 6px 6px 0 #1a0a2e, 7px 7px 10px rgba(0,0,0,0.6),
    0 0 20px rgba(139, 92, 246, 0.5);
  transform-style: preserve-3d;
  opacity: 0;
  will-change: transform, filter, opacity;
  animation: char-fly-in 1s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
@keyframes char-fly-in {
  0% {
    opacity: 0;
    transform: translate3d(var(--fly-x), var(--fly-y), 0) rotate(var(--fly-rotate)) scale(0.5);
    filter: blur(6px);
  }
  100% {
    opacity: 1;
    transform: translate3d(0, 0, 0) rotate(0deg) scale(1);
    filter: blur(0);
  }
}
</style>
