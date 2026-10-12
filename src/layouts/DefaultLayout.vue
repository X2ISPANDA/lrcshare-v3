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
    <!-- 歌曲分享：全局浮动播放器（SPA 跨路由常驻保活）；随机推荐卡已收敛到首页 -->
    <MusicPlayerDock />
  </div>
</template>

<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { buildAttribution } from '@/lib/clipboard'
import { useMusicPlayerStore } from '@/stores/musicPlayer'
import AppNavbar from '@/components/layout/AppNavbar.vue'
import AppFooter from '@/components/layout/AppFooter.vue'
import SearchOverlay from '@/components/layout/SearchOverlay.vue'
import ImgPreview from '@/components/layout/ImgPreview.vue'
import MusicPlayerDock from '@/components/music/player/MusicPlayerDock.vue'

const route = useRoute()
const musicPlayer = useMusicPlayerStore()

/** 前台选中文本复制（Ctrl+C / 右键复制）统一追加来源署名；
 *  输入框 / 文本域 / 可编辑区内的复制跳过（避免污染密码、表单内容）；
 *  「全部复制」按钮走 copyText 的 programmatic writeText，不触发 copy 事件，不会重复追加 */
function onCopy(e: ClipboardEvent) {
  if (!e.clipboardData) return
  const sel = window.getSelection()
  if (!sel) return
  const text = sel.toString()
  if (!text) return
  const node = sel.anchorNode
  const el = node?.nodeType === Node.ELEMENT_NODE ? (node as HTMLElement) : node?.parentElement
  if (el && (el.closest('input, textarea') || el.isContentEditable)) return
  e.clipboardData.setData('text/plain', text + buildAttribution())
  e.preventDefault()
}

onMounted(() => document.addEventListener('copy', onCopy))
onBeforeUnmount(() => {
  document.removeEventListener('copy', onCopy)
})

/**
 * 进站（整页加载/刷新）随机一首已通过歌曲自动播放：
 * - 每次整页访问只试一次（SPA 路由跳转不重复触发，layout 常驻）；
 * - 用户可在播放器面板关闭「进站自动播放」（localStorage 记忆）；
 * - 无用户手势时浏览器大概率拦截，adapter 会发 blocked，Dock 停在播放键等点击，
 *   不做静音绕过。
 * nextTick：先给卡片墙 SSG 水合数据 hydrate 进 store 的机会，避免重复拉库。
 */
onMounted(async () => {
  await nextTick()
  if (!musicPlayer.libraryLoaded) await musicPlayer.loadLibrary()
  if (musicPlayer.autoTried) return
  musicPlayer.autoTried = true
  if (musicPlayer.isAutoplayEnabled() && musicPlayer.library.length > 0) {
    await musicPlayer.playRandom()
  }
})
// 注：Dock 为左下角 fixed 悬浮球 / 卡片（APlayer 形态），不再是底部全宽长条，
// 不会整宽遮住 footer，因此不再给 body 加 padding-bottom（旧逻辑会在 footer 下方
// 露出一条全宽白地）。悬浮层遮挡 footer 左下角是浮层播放器的通用交互，可接受。
</script>
