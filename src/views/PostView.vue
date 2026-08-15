<template>
  <main class="max-w-3xl mx-auto px-4 py-8">
    <div class="bg-white rounded-2xl shadow-sm p-8">
      <div v-if="loading" class="w-full text-center py-16 text-gray-400">加载中...</div>

      <!-- 未找到 / 未发布 -->
      <div v-else-if="!article || article.status !== 'published'" class="text-center py-16">
        <div class="text-6xl mb-4">😢</div>
        <h2 class="text-2xl font-bold text-gray-800 mb-2">文章不存在或未发布</h2>
        <p class="text-gray-500 mb-6">这篇文章可能已被删除、草稿中，或者链接有误</p>
        <RouterLink to="/posts" class="inline-block px-6 py-2 bg-pink-500 text-white rounded-lg hover:bg-pink-600 transition">← 返回文章列表</RouterLink>
      </div>

      <template v-else>
        <RouterLink to="/posts" class="inline-flex items-center gap-1 text-sm text-pink-600 hover:text-pink-700 hover:underline mb-6">
          ← 返回文章列表
        </RouterLink>

        <div class="mb-6">
          <div class="flex items-center gap-2 mb-4">
            <span class="inline-block px-2.5 py-0.5 text-xs font-medium rounded-full" :class="typeInfo.class">{{ typeInfo.label }}</span>
          </div>
          <h1 class="text-3xl font-bold text-gray-800 mb-4">{{ article.title }}</h1>
          <div class="flex items-center gap-4 text-sm text-gray-500 flex-wrap">
            <span>
              👤 {{ displayName }}
              <span v-if="article.author === '站长'" class="text-[10px] bg-pink-100 text-pink-600 px-1.5 py-0.5 rounded ml-1">站长</span>
            </span>
            <span>📅 {{ formatDate(article.created_at) }}</span>
            <span>📂 {{ typeInfo.label }}</span>
            <span>👁 {{ article.views || 0 }} 浏览</span>
          </div>
        </div>

        <hr class="border-gray-100 mb-8" />

        <div class="article-content" v-html="renderedContent"></div>
      </template>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useHead } from '@unhead/vue'
import { api } from '@/lib/api'
import { mdToHtml } from '@/lib/markdown'
import { useSSGData } from '@/composables/useSSGData'
import type { Article, Contributor } from '@/lib/types'

const route = useRoute()
const slug = route.params.slug as string

const TYPE_LABEL: Record<string, { label: string; class: string }> = {
  news: { label: '喜报', class: 'bg-yellow-100 text-yellow-700' },
  tutorial: { label: '教程', class: 'bg-blue-100 text-blue-700' },
  notice: { label: '公告', class: 'bg-red-100 text-red-700' },
  post: { label: '文章', class: 'bg-green-100 text-green-700' },
}

const { data: article, loading } = useSSGData<Article>(`post:${slug}`, () =>
  api.getArticleBySlug(slug),
)
// 站长真实名称（author === '站长' 时替换显示）
const { data: contributors } = useSSGData<Contributor[]>('post:owner', () => api.getContributors())

useHead({
  title: computed(() => (article.value?.status === 'published' ? `${article.value.title} - LrcShare` : '文章详情 - LrcShare')),
  meta: [
    { name: 'description', content: computed(() => article.value?.summary || `${article.value?.title || ''} - LrcShare 站长文章`) },
  ],
})

const typeInfo = computed(() => TYPE_LABEL[article.value?.type || ''] || { label: '文章', class: 'bg-gray-100 text-gray-700' })

const displayName = computed(() => {
  if (article.value?.author !== '站长') return article.value?.author || '站长'
  const owner = (contributors.value || []).find(c => c.is_owner)
  return owner?.name || '站长'
})

const renderedContent = computed(() => mdToHtml(article.value?.content))

function formatDate(dateStr: string | null): string {
  return dateStr ? new Date(dateStr).toISOString().slice(0, 10) : ''
}

// 浏览量计数仅客户端执行（SSG 构建时不可自增）
onMounted(() => {
  if (article.value?.status === 'published') api.incrementArticleView(article.value.id)
})
</script>
