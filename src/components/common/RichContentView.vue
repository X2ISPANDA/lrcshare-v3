<template>
  <div>
    <!-- 译文语种图例：内容里标注过哪些语种就自动生成哪些按钮（语种名可自定义），点击只保留该语种，再点恢复 -->
    <div v-if="langs.length" class="flex flex-wrap gap-2 mb-4">
      <button
        v-for="lang in langs"
        :key="lang"
        class="lang-chip"
        :class="{ 'lang-chip-active': activeLang === lang }"
        :style="activeLang === lang ? { color: langColor(lang), borderColor: langColor(lang), background: `${langColor(lang)}14` } : undefined"
        @click="toggleLang(lang)"
      >
        <span class="inline-block w-2 h-2 rounded-full flex-shrink-0" :style="{ background: langColor(lang) }"></span>
        {{ lang }}
      </button>
    </div>
    <div ref="rootRef" :class="contentClass" v-html="html"></div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { langColor } from '@/lib/constants'
/**
 * 富文本内容渲染 + 译文语种自动切换（前台歌曲页、后台歌曲/文章编辑预览共用）
 * 扫描内容里的 data-lang（新格式）/ 旧类名（t-yue、cyan 等）自动生成语种切换按钮
 */
const props = defineProps<{
  /** 渲染后的 HTML（mdToHtml 产物；译文标注 span 会被原样保留） */
  html: string
  /** v-html 容器类名（如 rich-lyrics / content-preview + 排版类） */
  contentClass?: string
}>()

/** 旧类名数据（t-yue / cyan 等）到语种名的映射（老站迁移数据兼容） */
const OLD_CLASS_LANG: Record<string, string> = {
  't-yue': '粤语', 'cyan': '粤语', 't-en': '英语', 't-ja': '日语', 't-ko': '韩语', 't-misc': '其它',
}
/** 内容中实际标注过的语种（新 data-lang 格式 + 旧类名格式，去重保序）：有则自动生成切换按钮 */
const langs = computed(() => {
  const names: string[] = []
  for (const m of props.html.matchAll(/data-lang=["']([^"']+)["']/g)) {
    if (!names.includes(m[1])) names.push(m[1])
  }
  for (const [cls, name] of Object.entries(OLD_CLASS_LANG)) {
    if (new RegExp(`class=["'][^"']*\\b${cls}\\b`).test(props.html) && !names.includes(name)) names.push(name)
  }
  return names
})
const activeLang = ref<string | null>(null)
const rootRef = ref<HTMLElement | null>(null)
function toggleLang(lang: string) {
  activeLang.value = activeLang.value === lang ? null : lang
  nextTick(applyLangVisibility)
}
/** 单个译文 span 的语种：data-lang 优先（新格式），否则按旧类名映射 */
function spanLang(el: HTMLElement): string | null {
  if (el.dataset.lang) return el.dataset.lang
  for (const cls of Object.keys(OLD_CLASS_LANG)) {
    if (el.classList.contains(cls)) return OLD_CLASS_LANG[cls]
  }
  return null
}
/** v-html 内容绑不了事件/样式，切换时直接操作 DOM：隐藏非当前语种的译文 span（未标注语种的唱词不受影响） */
function applyLangVisibility() {
  const root = rootRef.value
  if (!root) return
  root.querySelectorAll<HTMLElement>('span.p').forEach(el => {
    const lang = spanLang(el)
    if (lang) el.style.display = activeLang.value && lang !== activeLang.value ? 'none' : ''
  })
}
// 内容变化会重建 v-html DOM，需重放显隐状态
watch(() => props.html, () => { if (activeLang.value) nextTick(applyLangVisibility) })
</script>

<style scoped>
/* 译文语种切换胶囊（色点=语种色；active 时边框/文字/浅底用语种色，内联 style 控制） */
.lang-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 14px;
  border-radius: 999px;
  border: 1px solid #e5e7eb;
  background: #fff;
  font-size: 0.85rem;
  color: #6b7280;
  line-height: 1;
  cursor: pointer;
  transition: all 0.2s;
}
.lang-chip:hover { border-color: #f9a8d4; color: #db2777; }
.lang-chip-active { font-weight: 600; }
</style>
