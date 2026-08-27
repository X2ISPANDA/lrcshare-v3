<template>
  <main class="max-w-5xl mx-auto px-4 py-8">
    <div class="bg-white rounded-2xl shadow-sm p-8 mb-6">
      <div class="text-sm text-pink-500 mb-2">My Rambles</div>
      <h1 class="text-3xl font-bold text-gray-800 mb-2">站长逼逼</h1>
      <p class="text-gray-500">🔊所有坏孩子音量都拉大！</p>
    </div>

    <div v-if="loading" class="w-full text-center py-16 text-gray-400">加载中...</div>
    <div v-else-if="!articles?.length" class="w-full text-center py-16 text-gray-400">暂无文章</div>
    <template v-else>
      <RouterLink
        v-for="article in visibleArticles"
        :key="article.id"
        :to="`/post/${article.slug}`"
        class="block bg-white rounded-xl shadow-sm p-6 mb-4 hover:shadow-md transition"
      >
        <div class="flex items-start justify-between gap-4">
          <div class="flex-1 min-w-0">
            <h3 class="text-xl font-bold text-gray-800 mb-2 hover:text-pink-600 transition truncate">{{ article.title }}</h3>
            <p class="text-sm text-gray-500 mb-4 line-clamp-2">{{ getSummary(article) }}</p>
            <div class="flex items-center gap-4 text-xs text-gray-400 flex-wrap">
              <span>
                👤 {{ displayName(article) }}
                <span v-if="article.author === '站长'" class="text-[10px] bg-pink-100 text-pink-600 px-1.5 py-0.5 rounded ml-1">站长</span>
              </span>
              <span>📅 {{ formatDate(article.created_at) }}</span>
              <span class="text-pink-500 font-medium ml-auto hover:underline">查看更多 →</span>
            </div>
          </div>
        </div>
      </RouterLink>

      <div v-if="visibleCount < articles.length" class="text-center mt-6">
        <button
          class="px-6 py-2 bg-white rounded-xl shadow-sm text-gray-600 hover:bg-pink-50 hover:text-pink-600 transition"
          @click="visibleCount += PAGE_SIZE"
        >查看更多</button>
      </div>
    </template>
  </main>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useHead } from '@unhead/vue'
import { api } from '@/lib/api'
import { mdToText } from '@/lib/markdown'
import { useSSGData } from '@/composables/useSSGData'
import type { Article, Contributor } from '@/lib/types'

useHead({ title: '站长逼逼 - LrcShare' })

const PAGE_SIZE = 10

const { data: articles, loading } = useSSGData<Article[]>('posts', () =>
  api.getArticles({ status: 'published' }),
)
const { data: contributors } = useSSGData<Contributor[]>('posts:owner', () => api.getContributors())

const visibleCount = ref(PAGE_SIZE)
const visibleArticles = computed(() => (articles.value || []).slice(0, visibleCount.value))

/** 站长显示真实名称（contributors 中 is_owner 者） */
function displayName(article: Article): string {
  if (article.author !== '站长') return article.author || '站长'
  const owner = (contributors.value || []).find(c => c.is_owner)
  return owner?.name || '站长'
}

function getSummary(article: Article): string {
  if (article.summary?.trim()) return article.summary
  return mdToText(article.content, 150)
}

function formatDate(dateStr: string | null): string {
  return dateStr ? new Date(dateStr).toISOString().slice(0, 10) : ''
}
</script>
