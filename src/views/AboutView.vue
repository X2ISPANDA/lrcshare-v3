<template>
  <main class="max-w-4xl mx-auto px-4 py-10">
    <div class="bg-white rounded-2xl shadow-sm p-8">
      <div class="text-sm text-pink-500 mb-2">了解更多</div>
      <h1 class="text-3xl font-bold text-gray-800 mb-6">关于 LrcShare</h1>
      <div v-if="loading" class="text-center py-8 text-gray-400">加载中...</div>
      <div v-else-if="article?.content" class="article-content" v-html="sanitizeHtml(article.content)"></div>
      <div v-else class="text-center py-8 text-gray-400">数据库未配置关于页内容，请执行 extras.sql</div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { api } from '@/lib/api'
import { sanitizeHtml } from '@/lib/markdown'
import { useSSGData } from '@/composables/useSSGData'
import type { Article } from '@/lib/types'

useHead({ title: '关于 LrcShare' })

const { data: article, loading } = useSSGData<Article>('about', () => api.getArticleBySlug('about'))
</script>
