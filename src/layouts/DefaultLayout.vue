<template>
  <div class="min-h-screen flex flex-col bg-gray-50">
    <AppNavbar />
    <main class="flex-1">
      <router-view v-slot="{ Component }">
        <!-- key=route.path：同路由不同参数（如 /artist/A → /artist/B）强制重建组件，
             否则 Vue Router 复用实例、setup 不重跑，URL 变了页面不跳（搜索弹框踩坑）。
             用 path 而非 fullPath：query 变化（tab 状态持久化）不重建页面 -->
        <component :is="Component" :key="route.path" />
      </router-view>
    </main>
    <AppFooter />
    <SearchOverlay />
    <ImgPreview />
  </div>
</template>

<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { buildAttribution } from '@/lib/clipboard'
import AppNavbar from '@/components/layout/AppNavbar.vue'
import AppFooter from '@/components/layout/AppFooter.vue'
import SearchOverlay from '@/components/layout/SearchOverlay.vue'
import ImgPreview from '@/components/layout/ImgPreview.vue'

const route = useRoute()

/** 前台选中文本复制（Ctrl+C / 右键复制）统一追加来源署名；
 *  输入框 / 文本域 / 可编辑区内的复制跳过（避免污染密码、表单内容）；
 *  「全部复制」按钮走 copyText 的 programmatic writeText，不触发 copy 事件，不会重复追加 */
function onCopy(e: ClipboardEvent) {
  if (!e.clipboardData) return
  const sel = window.getSelection()
  const text = sel?.toString()
  if (!text) return
  const node = sel.anchorNode
  const el = node?.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement
  if (el && (el.closest('input, textarea') || el.isContentEditable)) return
  e.clipboardData.setData('text/plain', text + buildAttribution())
  e.preventDefault()
}

onMounted(() => document.addEventListener('copy', onCopy))
onBeforeUnmount(() => document.removeEventListener('copy', onCopy))
</script>
