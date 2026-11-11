<script setup lang="ts">
import LrcReviewPreview from './LrcReviewPreview.vue'
import TtmlReviewPreview from './TtmlReviewPreview.vue'

/** 审核歌词预览路由：格式由版本 format 字段决定（不猜格式），选择对应预览组件 */
const props = defineProps<{
  format: 'ttml' | 'enhanced' | 'lrc'
  /** TTML 原文（format='ttml' 时使用） */
  ttmlText?: string
  /** LRC 文本（format='enhanced' | 'lrc' 时使用） */
  lrcText?: string
}>()
</script>

<template>
  <TtmlReviewPreview v-if="props.format === 'ttml'" :text="props.ttmlText || ''" />
  <LrcReviewPreview v-else :text="props.lrcText || ''" :word-level="props.format === 'enhanced'" />
</template>
