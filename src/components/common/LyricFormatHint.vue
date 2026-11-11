<script setup lang="ts">
import { computed } from 'vue'
import { detectLyricInput } from '@/lib/lyricLines'

/** 投稿歌词格式提示（TTML / 逐字 LRC / 逐行 LRC）：判定与文案唯一来源，各投稿入口共用 */
const props = defineProps<{ text: string }>()

const fmt = computed(() => detectLyricInput(props.text))
const content = computed(() => {
  switch (fmt.value) {
    case 'empty': return '支持自动识别格式'
    case 'ttml': return '✓ 识别为 TTML（对唱/样式数据完整保留）'
    case 'enhanced': return '✓ 识别为逐字 LRC（词级时间轴完整保留）'
    default: return '✓ 识别为逐行 LRC'
  }
})
const colorClass = computed(() => {
  switch (fmt.value) {
    case 'empty': return 'text-gray-400'
    case 'ttml': return 'text-blue-500'
    case 'enhanced': return 'text-emerald-600'
    default: return 'text-green-600'
  }
})
</script>

<template>
  <div class="text-xs mt-1" :class="colorClass">{{ content }}</div>
</template>
