<template>
  <main class="max-w-6xl mx-auto px-4 py-8">
    <div class="mb-6">
      <h1 class="text-3xl font-bold text-gray-800">🎵 歌词库</h1>
      <p class="text-gray-500 mt-2">浏览所有收录的歌词</p>
    </div>

    <!-- 搜索 -->
    <div class="relative mb-6">
      <input
        v-model="keyword"
        type="text"
        placeholder="搜索歌曲名 / 歌手 / 专辑…"
        class="w-full bg-white rounded-full border border-gray-200 shadow-sm pl-11 pr-10 py-2.5 text-gray-700 placeholder-gray-400 focus:outline-none focus:border-pink-300 focus:ring-2 focus:ring-pink-100 transition"
      />
      <span class="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400">🔍</span>
      <button
        v-if="keyword"
        class="absolute right-3 top-1/2 -translate-y-1/2 w-6 h-6 rounded-full bg-gray-100 text-gray-400 hover:bg-gray-200 hover:text-gray-600 text-xs leading-none transition"
        @click="keyword = ''"
      >✕</button>
    </div>

    <!-- 结果计数（搜索态） -->
    <p v-if="!loading && keyword" class="text-sm text-gray-400 mb-4">找到 {{ total }} 首匹配的歌曲</p>

    <!-- 卡片网格 -->
    <div v-if="loading" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
      <div v-for="i in 15" :key="i" class="aspect-square rounded-2xl bg-white shadow-sm animate-pulse"></div>
    </div>
    <div v-else-if="!items.length" class="bg-white rounded-2xl shadow-sm p-12 text-center">
      <div class="text-6xl mb-4">🎵</div>
      <p class="text-gray-400 text-lg">{{ keyword ? '没有找到匹配的歌曲' : '暂无歌词' }}</p>
    </div>
    <template v-else>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        <SongNfcCard v-for="song in items" :key="song.id" :song="song" />
      </div>

      <!-- 分页 -->
      <nav v-if="totalPages > 1" class="mt-8 flex items-center justify-center gap-2 flex-wrap">
        <button class="page-btn" :disabled="page <= 1" @click="goPage(page - 1)">上一页</button>
        <template v-for="(p, i) in pageList" :key="i">
          <span v-if="p === '…'" class="page-ellipsis">…</span>
          <button v-else class="page-btn" :class="{ 'page-btn-active': p === page }" @click="goPage(p)">{{ p }}</button>
        </template>
        <button class="page-btn" :disabled="page >= totalPages" @click="goPage(page + 1)">下一页</button>
      </nav>
    </template>
  </main>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useHead } from '@unhead/vue'
import { api } from '@/lib/api'
import { useSSGData } from '@/composables/useSSGData'
import SongNfcCard from '@/components/common/SongNfcCard.vue'
import type { SongWithNames } from '@/lib/types'

useHead({
  title: '歌词库 - LrcShare',
  meta: [{ name: 'description', content: '浏览所有收录歌词的歌曲，支持按歌曲名 / 歌手 / 专辑搜索 - LrcShare' }],
})

const PAGE_SIZE = 30
const route = useRoute()
const router = useRouter()

const initialKeyword = (route.query.q as string) || ''
const initialPage = Math.max(1, parseInt((route.query.page as string) || '1', 10) || 1)

const keyword = ref(initialKeyword)
const page = ref(initialPage)

// SSG 预渲染第一页（无关键词），模板直接派生，服务端即可输出真实卡片
const { data: firstPage } = useSSGData('songs:library', () =>
  api.getSongLibraryPage({ page: 1, pageSize: PAGE_SIZE }),
)

// 客户端翻页/搜索结果（首屏第一页直接用 SSG 水合数据）
const clientItems = ref<SongWithNames[] | null>(null)
const clientTotal = ref(0)
const clientLoading = ref(!!(initialKeyword || initialPage > 1))

/** 是否处于首屏第一页（无搜索词）：是 → SSG 数据；否 → 客户端拉取 */
const isFirstScreen = computed(() => !keyword.value.trim() && page.value === 1)

const items = computed<SongWithNames[]>(() =>
  isFirstScreen.value ? (firstPage.value?.items ?? []) : (clientItems.value ?? []),
)
const total = computed(() => (isFirstScreen.value ? (firstPage.value?.total ?? 0) : clientTotal.value))
const loading = computed(() => (isFirstScreen.value ? !firstPage.value : clientLoading.value))

let debounceTimer: ReturnType<typeof setTimeout> | undefined

const totalPages = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)))

/** 页码序列：首尾 + 当前页前后各 2 页，超出用 … 间隔 */
const pageList = computed<(number | '…')[]>(() => {
  const tp = totalPages.value
  const cur = page.value
  const nums: number[] = []
  for (let p = 1; p <= tp; p++) {
    if (p === 1 || p === tp || (p >= cur - 2 && p <= cur + 2)) nums.push(p)
  }
  const out: (number | '…')[] = []
  nums.forEach((p, i) => {
    if (i > 0 && p - nums[i - 1] > 1) out.push('…')
    out.push(p)
  })
  return out
})

async function fetchPage() {
  clientLoading.value = true
  try {
    const res = await api.getSongLibraryPage({ page: page.value, pageSize: PAGE_SIZE, q: keyword.value })
    clientItems.value = res.items
    clientTotal.value = res.total
  } finally {
    clientLoading.value = false
  }
  window.scrollTo({ top: 0 })
}

/** 状态写回 URL（可分享、浏览器前进后退正常） */
function syncRoute() {
  const query: Record<string, string> = {}
  if (keyword.value.trim()) query.q = keyword.value.trim()
  if (page.value > 1) query.page = String(page.value)
  router.replace({ query })
}

function goPage(p: number) {
  page.value = Math.max(1, Math.min(totalPages.value, p))
  syncRoute()
}

// 搜索输入防抖 → 回第一页并同步 URL；输入中立即显示骨架，避免防抖间隙闪旧结果
watch(keyword, () => {
  clearTimeout(debounceTimer)
  if (keyword.value.trim()) {
    clientItems.value = null
    clientLoading.value = true
  }
  debounceTimer = setTimeout(() => {
    page.value = 1
    syncRoute()
  }, 300)
})

// 路由 query 变化（输入/翻页/前进后退）→ 非首屏第一页时客户端拉数据
watch(
  () => [route.query.q, route.query.page],
  ([q, p]) => {
    if (import.meta.env.SSR) return
    keyword.value = (q as string) || ''
    page.value = Math.max(1, parseInt((p as string) || '1', 10) || 1)
    if (!isFirstScreen.value) fetchPage()
  },
  { immediate: true },
)
</script>

<style scoped>
.page-btn {
  min-width: 36px;
  height: 36px;
  padding: 0 12px;
  border-radius: 9999px;
  background: #fff;
  border: 1px solid #e5e7eb;
  color: #4b5563;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.15s;
}
.page-btn:hover:not(:disabled) {
  border-color: #f9a8d4;
  color: #ec4899;
}
.page-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}
.page-btn-active {
  background: #ec4899;
  border-color: #ec4899;
  color: #fff;
}
.page-btn-active:hover {
  color: #fff;
  border-color: #ec4899;
}
.page-ellipsis {
  color: #9ca3af;
  padding: 0 2px;
}
</style>
