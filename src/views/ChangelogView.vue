<template>
  <main class="max-w-4xl mx-auto px-4 py-8">
    <div class="bg-white rounded-2xl shadow-sm p-8 mb-6">
      <div class="text-sm text-pink-500 mb-2">Changelog</div>
      <h1 class="text-3xl font-bold text-gray-800 mb-2">更新日志</h1>
      <p class="text-gray-500">📝 记录站点功能迭代与修复，点击条目标题展开详情</p>
    </div>

    <section v-for="day in changelog" :key="day.date" class="mb-8">
      <!-- 日期归档头 -->
      <div class="flex items-center gap-3 mb-3 px-1">
        <span class="text-lg font-bold text-gray-800 tabular-nums">{{ day.date }}</span>
        <span class="text-xs text-gray-400 bg-gray-100 rounded-full px-2.5 py-0.5">{{ day.entries.length }} 项更新</span>
        <span class="flex-1 h-px bg-gray-200"></span>
      </div>

      <!-- 条目：有正文用 details 折叠；纯标题条目静态展示 -->
      <template v-for="(entry, i) in day.entries" :key="i">
        <details v-if="displayBody(entry)" class="changelog-item group bg-white rounded-xl shadow-sm mb-2.5 overflow-hidden">
          <summary
            class="flex items-center gap-3 px-5 py-4 cursor-pointer select-none list-none hover:bg-pink-50/40 transition"
          >
            <span class="chevron text-gray-300 group-open:text-pink-500 transition-transform duration-200 group-open:rotate-90">▶</span>
            <span class="flex-1 text-gray-800 font-medium leading-relaxed">{{ entry.title }}</span>
          </summary>
          <div class="px-5 pb-5 pt-1">
            <div class="border-l-2 border-pink-100 pl-4 article-content changelog-body" v-html="renderBody(entry)"></div>
          </div>
        </details>
        <div v-else class="changelog-item bg-white rounded-xl shadow-sm mb-2.5 px-5 py-4 flex items-center gap-3">
          <span class="text-gray-300">·</span>
          <span class="flex-1 text-gray-800 font-medium leading-relaxed">{{ entry.title }}</span>
        </div>
      </template>
    </section>
  </main>
</template>

<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { mdToHtml } from '@/lib/markdown'
import { changelog, type ChangelogEntry } from '@/data/changelog'

useHead({ title: '更新日志 - LrcShare' })

/** 折叠态正文：旧数据迁移时 body 常以标题原文开头（如「XX：详情」），展示时去掉重复的标题前缀 */
function displayBody(entry: ChangelogEntry): string {
  const body = entry.body?.trim()
  if (!body) return ''
  if (body.startsWith(entry.title)) {
    return body.slice(entry.title.length).replace(/^[：:。！？!?\s]+/, '').trim()
  }
  return body
}

function renderBody(entry: ChangelogEntry): string {
  return mdToHtml(displayBody(entry))
}
</script>

<style scoped>
/* 隐藏 details 默认三角，用自定义 chevron */
summary::-webkit-details-marker { display: none; }
summary::marker { content: ''; }

.chevron { font-size: 10px; flex-shrink: 0; }

/* 折叠区内的 markdown 排版收紧（article-content 全局样式为长文设计，这里条目正文偏短） */
.changelog-body { font-size: 0.92rem; color: #4b5563; }
.changelog-body :deep(p) { margin: 0.4em 0; }
.changelog-body :deep(p:first-child) { margin-top: 0; }
.changelog-body :deep(ul), .changelog-body :deep(ol) { margin: 0.4em 0; }
.changelog-body :deep(h1), .changelog-body :deep(h2), .changelog-body :deep(h3) { font-size: 1em; margin: 0.6em 0 0.3em; }
.changelog-body :deep(pre) { font-size: 0.85em; }
</style>
