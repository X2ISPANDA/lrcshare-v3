<script setup lang="ts">
import { computed } from 'vue'
import { parseLrcToRows, formatLyricTime, stripWordTags } from '@/lib/lyricLines'

/** LRC 审核预览：逐行时间 + 文本；逐字格式多显示词数（数据来自行表同源解析） */
const props = defineProps<{ text: string; wordLevel?: boolean }>()

const rows = computed(() => parseLrcToRows(props.text).filter(r => r.time_ms != null))
const wordCount = (text: string) => (text.match(/<\d{1,6}>/g) || []).length
</script>

<template>
  <div class="border border-gray-200 rounded-lg overflow-hidden">
    <div class="px-3 py-2 bg-gray-50 text-xs text-gray-500">
      解析预览：{{ rows.length }} 行{{ wordLevel ? '（逐字）' : '（逐行）' }}
      <span v-if="!rows.length" class="text-red-500 ml-2">未解析出时间戳行</span>
    </div>
    <div v-if="rows.length" class="max-h-72 overflow-auto">
      <table class="w-full text-xs">
        <thead class="bg-gray-50 text-gray-500 sticky top-0">
          <tr>
            <th class="px-2 py-1 text-left w-24">时间</th>
            <th class="px-2 py-1 text-left">文本</th>
            <th v-if="wordLevel" class="px-2 py-1 text-right w-16">词数</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(r, i) in rows" :key="i" class="border-t border-gray-100">
            <td class="px-2 py-1 text-gray-400 font-mono whitespace-nowrap">{{ formatLyricTime(r.time_ms) }}</td>
            <td class="px-2 py-1 text-gray-800">{{ stripWordTags(r.text) }}</td>
            <td v-if="wordLevel" class="px-2 py-1 text-right text-gray-400">{{ wordCount(r.text) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
