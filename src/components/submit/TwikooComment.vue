<template>
  <div class="twikoo-wrap">
    <div ref="containerRef" class="tk-container min-h-[60px]"></div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { api } from '@/lib/api'
import type { Contributor } from '@/lib/types'

/**
 * Twikoo 评论（仅客户端初始化，SSG 渲染空容器）
 * 迁移自 v2 song.html：CDN 按需加载 + 站长/贡献者昵称徽章
 */
const props = defineProps<{
  /** 评论区分隔路径，如 /song/s_xx（不同页面互不串评论） */
  path: string
}>()

const TWIKOO_ENV_ID = 'https://lrcshare.netlify.app/.netlify/functions/twikoo'
const TWIKOO_CDN = 'https://cdn.jsdelivr.net/npm/twikoo@1.7.9/dist/twikoo.all.min.js'

const containerRef = ref<HTMLElement>()
let observer: MutationObserver | null = null
let lazyObserver: IntersectionObserver | null = null
let contributors: Contributor[] = []

declare global {
  interface Window {
    twikoo?: {
      init: (opts: {
        envId: string
        el: string | HTMLElement
        path: string
        lang: string
        onComment?: () => void
      }) => void
    }
  }
}

/** 为贡献者和站长的评论昵称追加徽章（Twikoo 动态渲染后调用） */
function addContributorBadges() {
  if (!contributors.length || !containerRef.value) return
  const ownerNames = contributors.filter(c => c.is_owner).map(c => c.name)
  const contributorNames = contributors.filter(c => !c.is_owner).map(c => c.name)

  containerRef.value.querySelectorAll<HTMLElement>('.tk-content .tk-head .tk-user-info .tk-nick').forEach(nick => {
    if (nick.dataset.badgeAdded) return
    const name = nick.textContent?.trim() || ''
    let badge = ''
    if (ownerNames.includes(name)) badge = '<span class="tk-badge tk-badge-owner">站长</span>'
    else if (contributorNames.includes(name)) badge = '<span class="tk-badge tk-badge-contributor">贡献者</span>'
    if (badge) {
      nick.insertAdjacentHTML('afterend', badge)
      nick.dataset.badgeAdded = 'true'
    }
  })
}

function loadTwikooScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (window.twikoo) return resolve()
    const script = document.createElement('script')
    script.src = TWIKOO_CDN
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('twikoo script load failed'))
    document.head.appendChild(script)
  })
}

/** 加载 Twikoo 脚本并初始化评论区（含贡献者徽章逻辑） */
async function initTwikoo() {
  try {
    await Promise.all([loadTwikooScript(), api.getContributors().then(list => (contributors = list || []))])
  } catch (e) {
    console.warn('[Twikoo] 初始化失败：', e)
    return
  }
  if (!window.twikoo || !containerRef.value) return
  window.twikoo.init({
    envId: TWIKOO_ENV_ID,
    el: containerRef.value,
    path: props.path,
    lang: 'zh-CN',
    onComment: addContributorBadges,
  })
  // 监听 Twikoo 动态渲染（加载更多/发布评论等场景）补挂徽章
  observer = new MutationObserver(addContributorBadges)
  observer.observe(containerRef.value, { childList: true, subtree: true })
}

/**
 * 懒加载：评论区进入视口（下方 300px 内）才初始化。
 * 大幅减少 Netlify Functions 调用——爬虫与未滚动到评论区的访问不再触发 Twikoo 后端请求。
 */
onMounted(() => {
  const el = containerRef.value
  if (!el) return
  if (!('IntersectionObserver' in window)) {
    initTwikoo() // 老浏览器直接初始化
    return
  }
  lazyObserver = new IntersectionObserver(
    (entries) => {
      if (entries.some(e => e.isIntersecting)) {
        lazyObserver?.disconnect()
        lazyObserver = null
        initTwikoo()
      }
    },
    { rootMargin: '300px 0px' },
  )
  lazyObserver.observe(el)
})

onUnmounted(() => {
  observer?.disconnect()
  lazyObserver?.disconnect()
})
</script>

<style>
/* Twikoo 评论区与站点风格对齐（全局：Twikoo 内部 DOM 无法 scoped） */
.tk-container .tk-comments-container {
  font-family: inherit;
}
.tk-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 8px;
  font-size: 11px;
  font-weight: 600;
  border-radius: 10px;
  line-height: 16px;
  vertical-align: middle;
}
.tk-badge-owner {
  background: linear-gradient(135deg, #ec4899 0%, #a855f7 100%);
  color: #fff;
}
.tk-badge-contributor {
  background: #dbeafe;
  color: #1d4ed8;
}
</style>
