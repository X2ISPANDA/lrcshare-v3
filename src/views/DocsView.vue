<template>
  <main class="max-w-5xl mx-auto px-4 py-8">
    <div class="bg-white rounded-2xl shadow-sm p-8 mb-6">
      <div class="text-sm text-pink-500 mb-2">Dev Docs</div>
      <h1 class="text-3xl font-bold text-gray-800 mb-2">开发文档</h1>
      <p class="text-gray-500">🗄️ 数据库架构演进记录——每个主题从出发点到最终形态的完整过程（SQL 变更已全部执行）</p>
    </div>

    <div class="grid md:grid-cols-2 gap-4">
      <RouterLink
        v-for="doc in docs"
        :key="doc.slug"
        :to="`/docs/${doc.slug}`"
        class="block bg-white rounded-xl shadow-sm p-6 hover:shadow-md hover:-translate-y-0.5 transition group"
      >
        <div class="flex items-start gap-3">
          <span class="flex-shrink-0 text-xs font-mono font-bold text-pink-500 bg-pink-50 rounded-lg px-2 py-1 group-hover:bg-pink-100 transition">{{ doc.num }}</span>
          <div class="flex-1 min-w-0">
            <h2 class="text-lg font-bold text-gray-800 mb-1.5 group-hover:text-pink-600 transition">{{ doc.title }}</h2>
            <p class="text-sm text-gray-500 leading-relaxed line-clamp-3">{{ doc.summary }}</p>
          </div>
        </div>
      </RouterLink>
    </div>

    <div class="mt-6 text-center text-sm text-gray-400">
      文档源文件位于仓库 <code class="bg-gray-100 rounded px-1.5 py-0.5 text-gray-500">sql/</code> 目录，随主站发布自动同步
    </div>
  </main>
</template>

<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { docs } from '@/lib/docs'

useHead({ title: '开发文档 - LrcShare' })
</script>
