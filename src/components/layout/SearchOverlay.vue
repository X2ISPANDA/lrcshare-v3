<template>
  <Teleport to="body">
    <div v-if="ui.searchOpen" class="fixed inset-0 z-[9999]">
      <!-- 背景遮罩 -->
      <div class="absolute inset-0 bg-black/50 backdrop-blur-sm" @click="ui.closeSearch()"></div>

      <div class="relative min-h-screen flex items-start justify-center pt-[8vh] px-4">
        <div class="relative w-full max-w-2xl bg-white rounded-2xl shadow-2xl overflow-hidden animate-search-in">
          <!-- 输入区 -->
          <div class="flex items-center gap-3 p-4 border-b">
            <svg class="w-5 h-5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
            <input
              ref="inputRef"
              v-model="keyword"
              type="text"
              placeholder="搜索歌曲、歌手或歌词内容..."
              class="flex-1 py-2 text-lg text-gray-800 focus:outline-none bg-transparent"
              autocomplete="off"
              @keyup.enter="doSearch"
            />
            <span class="hidden sm:inline-block text-xs text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">Enter 搜索</span>
            <button class="p-1 hover:bg-gray-100 rounded transition" aria-label="关闭" @click="ui.closeSearch()">
              <svg class="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>

          <!-- 结果区 -->
          <div class="max-h-[70vh] overflow-y-auto">
            <!-- 初始态 -->
            <div v-if="status === 'idle'" class="p-8 text-center text-gray-400">
              <div class="text-4xl mb-3">🔍</div>
              <div>输入关键词开始搜索</div>
              <div class="text-xs mt-2 text-gray-300">支持按 歌手 / 专辑 / 单曲 / 歌词内容 搜索</div>
            </div>

            <!-- 加载态 -->
            <div v-else-if="status === 'loading'" class="p-8 text-center text-gray-400">搜索中...</div>

            <!-- 结果 -->
            <template v-else-if="status === 'done'">
              <!-- 空结果 -->
              <div v-if="isEmpty" class="p-10 text-center">
                <div class="text-5xl mb-3">😔</div>
                <div class="text-gray-400">没有找到与 "{{ keyword }}" 相关的结果</div>
              </div>

              <template v-else>
                <!-- 分类 tab（sticky，滚动时保持可见） -->
                <div class="flex items-center gap-1.5 px-4 py-2.5 border-b border-gray-100 sticky top-0 bg-white z-10 overflow-x-auto">
                  <button
                    v-for="t in tabsWithCount"
                    :key="t.key"
                    class="px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition"
                    :class="currentTab === t.key ? 'bg-pink-500 text-white' : 'text-gray-500 hover:bg-gray-100'"
                    @click="currentTab = t.key"
                  >
                    {{ t.label }}
                    <span class="ml-0.5 text-xs" :class="currentTab === t.key ? 'text-white/80' : 'text-gray-400'">{{ t.count }}</span>
                  </button>
                </div>

                <!-- 单曲：仅匹配歌曲名 -->
                <div v-if="currentTab === 'songs'" class="divide-y">
                  <RouterLink
                    v-for="song in results.songs"
                    :key="song.id"
                    :to="`/song/${song.id}`"
                    class="flex items-center gap-3 px-5 py-3 hover:bg-pink-50 transition"
                    @click="ui.closeSearch()"
                  >
                    <div class="w-8 h-8 bg-pink-100 rounded-full flex items-center justify-center text-pink-600 text-xs shrink-0">🎵</div>
                    <div class="flex-1 min-w-0">
                      <div class="text-sm font-medium text-gray-800 truncate">
                        <span v-html="highlight(song.title)"></span>
                      </div>
                      <!-- 命中别名时标题下展示别名（日文原名搜出但不认识时，靠别名确认是不是要找的歌） -->
                      <div v-if="song.aliases?.length" class="text-xs text-gray-400 truncate">
                        <span v-html="highlight(song.aliases.join(' / '))"></span>
                      </div>
                      <div class="text-xs text-gray-500 truncate">
                        <span v-html="highlight(song.artist_name)"></span> · <span v-html="highlight(song.album_name ?? '')"></span>
                      </div>
                    </div>
                    <span class="text-xs text-gray-400 shrink-0 tabular-nums">{{ formatDuration(song.duration) }}</span>
                  </RouterLink>
                </div>

                <!-- 专辑：仅匹配专辑名 -->
                <div v-else-if="currentTab === 'albums'" class="grid grid-cols-1 sm:grid-cols-2 gap-1 p-3">
                  <RouterLink
                    v-for="album in results.albums"
                    :key="album.id"
                    :to="`/album/${album.id}`"
                    class="flex items-center gap-2 px-3 py-2 hover:bg-pink-50 rounded-lg transition"
                    @click="ui.closeSearch()"
                  >
                    <div class="w-8 h-8 bg-gradient-to-br from-pink-500 to-purple-600 rounded flex items-center justify-center overflow-hidden shrink-0">
                      <img v-if="album.cover" :src="album.cover" class="w-full h-full object-cover" />
                      <span v-else class="text-white text-xs">💿</span>
                    </div>
                    <div class="text-sm font-medium text-gray-800 truncate">
                      <span v-html="highlight(album.name)"></span>
                    </div>
                  </RouterLink>
                </div>

                <!-- 歌手：仅匹配艺术家名 -->
                <div v-else-if="currentTab === 'artists'" class="grid grid-cols-1 sm:grid-cols-2 gap-1 p-3">
                  <RouterLink
                    v-for="artist in results.artists"
                    :key="artist.id"
                    :to="`/artist/${artist.id}`"
                    class="flex items-center gap-2 px-3 py-2 hover:bg-pink-50 rounded-lg transition"
                    @click="ui.closeSearch()"
                  >
                    <img :src="artist.avatar || DEFAULT_AVATAR" class="w-8 h-8 rounded-full bg-gray-100 object-cover" />
                    <div class="text-sm font-medium text-gray-800 truncate">
                      <span v-html="highlight(artist.name)"></span>
                      <span v-if="artist.disambiguation" class="text-xs text-purple-500"> ({{ artist.disambiguation }})</span>
                    </div>
                  </RouterLink>
                </div>

                <!-- 歌词：匹配 LRC / 纯文本歌词内容 -->
                <div v-else-if="currentTab === 'lyrics'" class="divide-y">
                  <RouterLink
                    v-for="song in results.lyrics"
                    :key="song.id"
                    :to="`/song/${song.id}`"
                    class="flex items-center gap-3 px-5 py-3 hover:bg-pink-50 transition"
                    @click="ui.closeSearch()"
                  >
                    <div class="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center text-purple-600 text-xs shrink-0">📝</div>
                    <div class="flex-1 min-w-0">
                      <div class="text-sm font-medium text-gray-800 truncate">
                        <span v-html="highlight(song.title)"></span>
                        <span v-if="song.aliases?.length" class="text-xs font-normal text-gray-400 ml-1 truncate"><span v-html="highlight(song.aliases.join(' / '))"></span></span>
                      </div>
                      <div class="text-xs text-gray-500 truncate">
                        <span v-html="highlight(song.artist_name)"></span>
                      </div>
                      <div class="text-xs text-gray-400 mt-0.5 truncate">
                        ...<span v-html="highlight(snippetOf(song))"></span>...
                      </div>
                    </div>
                  </RouterLink>
                </div>
              </template>
            </template>

            <!-- 失败 -->
            <div v-else-if="status === 'error'" class="p-8 text-center text-gray-400">搜索失败</div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import { api, formatDuration } from '@/lib/api'
import { highlightHtml, lrcSnippet } from '@/lib/highlight'
import { LOGO_URL as DEFAULT_AVATAR } from '@/lib/constants'
import { useUiStore } from '@/stores/ui'
import type { Album, Artist, SongWithNames } from '@/lib/types'

const ui = useUiStore()

const inputRef = ref<HTMLInputElement>()
const keyword = ref('')
const status = ref<'idle' | 'loading' | 'done' | 'error'>('idle')
const results = ref<{ artists: Artist[]; albums: Album[]; songs: SongWithNames[]; lyrics: SongWithNames[] }>({
  artists: [],
  albums: [],
  songs: [],
  lyrics: [],
})

// 分类 tab：只展示有结果的分类，搜索后自动选中第一个
type TabKey = 'songs' | 'albums' | 'artists' | 'lyrics'
const TAB_ORDER: { key: TabKey; label: string }[] = [
  { key: 'songs', label: '单曲' },
  { key: 'albums', label: '专辑' },
  { key: 'artists', label: '歌手' },
  { key: 'lyrics', label: '歌词' },
]
const currentTab = ref<TabKey>('songs')
const tabsWithCount = computed(() =>
  TAB_ORDER.map(t => ({ ...t, count: results.value[t.key].length })).filter(t => t.count > 0),
)

const isEmpty = computed(
  () => results.value.artists.length === 0 && results.value.albums.length === 0 && results.value.songs.length === 0 && results.value.lyrics.length === 0,
)

// 打开时聚焦 + 支持带关键词打开（openSearch(keyword)）
watch(
  () => ui.searchOpen,
  async open => {
    document.body.style.overflow = open ? 'hidden' : ''
    if (open) {
      await nextTick()
      inputRef.value?.focus()
      if (ui.searchKeyword && ui.searchKeyword !== keyword.value) {
        keyword.value = ui.searchKeyword
        doSearch()
      }
    }
  },
)

const debouncedSearch = useDebounceFn(() => doSearch(), 300)

// 全局快捷键：Ctrl/Cmd+K 打开，Esc 关闭（仅客户端）
function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && ui.searchOpen) {
    e.preventDefault()
    ui.closeSearch()
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault()
    ui.openSearch()
  }
}
onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))

watch(keyword, v => {
  if (!v.trim()) {
    status.value = 'idle'
    return
  }
  debouncedSearch()
})

async function doSearch() {
  const kw = keyword.value.trim()
  if (!kw) {
    status.value = 'idle'
    return
  }
  status.value = 'loading'
  try {
    results.value = await api.search(kw)
    const first = tabsWithCount.value[0]
    currentTab.value = first ? first.key : 'songs'
    status.value = 'done'
  } catch {
    status.value = 'error'
  }
}

/** 关键词高亮（共享实现，见 lib/highlight.ts） */
function highlight(text: string): string {
  return highlightHtml(text, keyword.value)
}

/** 歌词命中片段（共享实现，LRC 优先，其次纯文本歌词） */
function snippetOf(song: SongWithNames): string {
  return lrcSnippet(song.lrc_text, keyword.value) || lrcSnippet(song.lyrics_text, keyword.value)
}

</script>

<style scoped>
@keyframes searchIn {
  from { opacity: 0; transform: scale(0.95) translateY(-10px); }
  to { opacity: 1; transform: scale(1) translateY(0); }
}
.animate-search-in { animation: searchIn 0.2s ease-out; }
</style>
