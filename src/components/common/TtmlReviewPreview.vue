<script setup lang="ts">
import { computed } from 'vue'
import { parseTtmlStructure, groupTtmlLines, formatLyricTime } from '@/lib/lyricLines'

/** TTML 审核预览：与歌曲详情「文本歌词」页同一套解析（parseTtmlStructure + groupTtmlLines） */
const props = defineProps<{ text: string }>()

const structure = computed(() => {
  const st = parseTtmlStructure(props.text)
  return st.lines.length ? st : null
})
const groups = computed(() => (structure.value ? groupTtmlLines(structure.value) : []))
const agentCount = computed(() => new Set(groups.value.map(g => g.line.agent).filter(Boolean)).size)
const translationCount = computed(() => new Set(
  groups.value.flatMap(g => g.translations.filter(t => t.kind === 'translation').map(t => t.lang || 'und')),
).size)
const translitCount = computed(() => groups.value.filter(g => g.romanUnits || g.translations.some(t => t.kind === 'romanization')).length)
</script>

<template>
  <div class="border border-gray-200 rounded-lg overflow-hidden">
    <div class="px-3 py-2 bg-gray-50 text-xs text-gray-500">
      解析预览：{{ groups.length }} 行
      <span v-if="agentCount" class="ml-2">对唱声部 {{ agentCount }} 个</span>
      <span v-if="translationCount" class="ml-2">翻译 {{ translationCount }} 种</span>
      <span v-if="translitCount" class="ml-2">音译 {{ translitCount }} 行</span>
      <span v-if="!structure" class="text-red-500 ml-2">TTML 解析失败</span>
    </div>
    <div v-if="groups.length" class="max-h-72 overflow-auto">
      <table class="w-full text-xs">
        <thead class="bg-gray-50 text-gray-500 sticky top-0">
          <tr>
            <th class="px-2 py-1 text-left w-24">时间</th>
            <th v-if="agentCount" class="px-2 py-1 text-left w-20">声部</th>
            <th class="px-2 py-1 text-left">正文</th>
            <th class="px-2 py-1 text-left">翻译 / 音译</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(g, gi) in groups" :key="gi" class="border-t border-gray-100 align-top">
            <td class="px-2 py-1 text-gray-400 font-mono whitespace-nowrap">{{ formatLyricTime(g.line.begin) }}</td>
            <td v-if="agentCount" class="px-2 py-1 text-gray-500">{{ g.line.agent || '齐唱' }}</td>
            <td class="px-2 py-1 text-gray-800">
              {{ g.line.text || '（空行）' }}
              <div v-for="(b, bi) in g.line.bg" :key="bi" class="text-gray-400">（合）{{ b }}</div>
              <div v-if="g.romanUnits" class="text-gray-400">
                注音：{{ g.romanUnits.map(u => u.roman).join(' ') }}
              </div>
            </td>
            <td class="px-2 py-1 text-gray-600">
              <div v-for="(t, ti) in g.translations" :key="ti" :class="t.kind === 'romanization' ? 'text-gray-400' : ''">
                {{ t.text }}
              </div>
              <span v-if="!g.translations.length && !g.romanUnits">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
