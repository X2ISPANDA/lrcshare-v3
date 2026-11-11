<script setup lang="ts">
import { computed } from 'vue'
import { parseTtmlForEdit } from '@/lib/lyricLines'

/** TTML 审核预览：复用管理端编辑页同一解析（parseTtmlForEdit），逐行展示时间/正文/词数/翻译/音译 */
const props = defineProps<{ text: string }>()

const model = computed(() => parseTtmlForEdit(props.text))

/** 按行 key 归集翻译/音译文本（同 key 多语言合并展示） */
function trackByKey(tracks: { lines: { for: string; text: string }[] }[]) {
  const map = new Map<string, string[]>()
  for (const t of tracks) {
    for (const l of t.lines) {
      if (!l.text?.trim()) continue
      const arr = map.get(l.for) || []
      arr.push(l.text.trim())
      map.set(l.for, arr)
    }
  }
  return map
}

const translations = computed(() => trackByKey(model.value?.translations || []))
const transliterations = computed(() => trackByKey(model.value?.transliterations || []))
const hasTranslation = computed(() => translations.value.size > 0)
const hasTranslit = computed(() => transliterations.value.size > 0)
const lines = computed(() => model.value?.lines || [])
</script>

<template>
  <div class="border border-gray-200 rounded-lg overflow-hidden">
    <div class="px-3 py-2 bg-gray-50 text-xs text-gray-500">
      解析预览：{{ lines.length }} 行
      <span v-if="hasTranslation" class="ml-2">翻译 {{ model?.translations.length }} 种</span>
      <span v-if="hasTranslit" class="ml-2">音译 {{ model?.transliterations.length }} 种</span>
      <span v-if="!model" class="text-red-500 ml-2">TTML 解析失败</span>
    </div>
    <div v-if="lines.length" class="max-h-72 overflow-auto">
      <table class="w-full text-xs">
        <thead class="bg-gray-50 text-gray-500 sticky top-0">
          <tr>
            <th class="px-2 py-1 text-left w-32">时间</th>
            <th class="px-2 py-1 text-left">正文</th>
            <th class="px-2 py-1 text-right w-14">词数</th>
            <th v-if="hasTranslation" class="px-2 py-1 text-left">翻译</th>
            <th v-if="hasTranslit" class="px-2 py-1 text-left">音译</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="l in lines" :key="l.key" class="border-t border-gray-100 align-top">
            <td class="px-2 py-1 text-gray-400 font-mono whitespace-nowrap">{{ l.beginRaw || '—' }}</td>
            <td class="px-2 py-1 text-gray-800">{{ l.text || '（空行）' }}</td>
            <td class="px-2 py-1 text-right text-gray-400">{{ l.words.length }}</td>
            <td v-if="hasTranslation" class="px-2 py-1 text-gray-600">{{ (translations.get(l.key) || []).join(' / ') || '—' }}</td>
            <td v-if="hasTranslit" class="px-2 py-1 text-gray-600">{{ (transliterations.get(l.key) || []).join(' / ') || '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
