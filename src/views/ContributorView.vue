<template>
  <main class="max-w-4xl mx-auto px-4 py-8">
    <!-- 返回链接 -->
    <div class="mb-4">
      <RouterLink to="/contributors" class="inline-flex items-center gap-2 text-gray-500 hover:text-pink-600 transition">
        <AppIcon name="link" class="w-5 h-5 rotate-180" />
        返回贡献者名单
      </RouterLink>
    </div>

    <div v-if="loading" class="text-center py-8 text-gray-400">加载中...</div>

    <template v-else-if="contributor">
      <!-- Hero 卡（与艺术家主页同款结构：默认背景图 + 白字 + 联系方式纯 logo 图标） -->
      <div class="contributor-hero rounded-2xl shadow-sm overflow-hidden relative">
        <img :src="HERO_BG_URL" alt="" class="hero-bg-img" />
        <div class="relative z-10 px-6 py-6">
          <div class="flex flex-col items-center md:flex-row md:items-start gap-4">
            <div class="flex flex-col items-center gap-1.5 flex-shrink-0">
              <img
                :src="contributor.avatar || LOGO_URL"
                :alt="contributor.name"
                class="w-[calc(var(--spacing)*35)] h-[calc(var(--spacing)*35)] rounded-full border-4 border-white shadow-lg bg-gray-200 object-cover cursor-zoom-in"
                @click="ui.openPreview([contributor.avatar || LOGO_URL])"
              />
              <span class="text-sm text-white/90 flex items-center gap-1">🎵 {{ contributor.song_count || 0 }} 件作品</span>
            </div>
            <div class="text-center md:text-left min-w-0">
              <div class="flex items-center gap-2 justify-center md:justify-start flex-wrap">
                <h1 class="text-3xl font-bold text-white drop-shadow">{{ contributor.name || '匿名贡献者' }}</h1>
                <span
                  v-for="t in tags"
                  :key="t"
                  class="text-sm bg-white/20 text-white px-3 py-1 rounded-full backdrop-blur-sm"
                >{{ t }}</span>
              </div>
              <!-- 联系方式：纯 logo 图标（URL/QQ号 可点击；微信/邮箱等弹出复制框） -->
              <div v-if="contactLinks.length" class="flex items-center gap-1 mt-2 justify-center md:justify-start flex-wrap">
                <a
                  v-for="link in contactLinks"
                  :key="link.key"
                  :href="link.href"
                  :target="link.href ? '_blank' : undefined"
                  :rel="link.href ? 'noopener noreferrer' : undefined"
                  :title="link.href ? link.key : `点击复制${link.key}`"
                  class="inline-flex items-center justify-center w-8 h-8 text-white hover:text-pink-200 transition cursor-pointer"
                  @click="!link.href && openCopy(link.key, link.value)"
                ><AppIcon :name="link.key" class="w-5.5 h-5.5" /></a>
              </div>
              <p v-if="showBio" class="mt-3 text-white/90 leading-relaxed">{{ contributor.bio }}</p>
            </div>
          </div>
        </div>
      </div>

      <!-- 作品列表 -->
      <div class="bg-white rounded-2xl shadow-sm p-6 mt-6">
        <h2 class="text-xl font-bold text-gray-800 mb-4">📚 作品列表</h2>
        <div v-if="!works.length" class="text-center py-12 text-gray-400">
          <div class="text-5xl mb-3">📄</div>
          <p>暂无公开作品记录（或为 LOGO、文案等非歌词贡献）</p>
        </div>
        <div
          v-for="w in works"
          :key="w.id"
          class="flex items-center justify-between gap-4 py-4 px-4 hover:bg-gray-50 rounded-xl transition border-b border-gray-100 last:border-b-0"
        >
          <div class="flex-1 min-w-0">
            <RouterLink :to="`/song/${w.id}`" class="font-semibold text-gray-800 hover:text-pink-600 hover:underline truncate block">{{ w.title || '（未知标题）' }}</RouterLink>
            <div v-if="w.artist" class="text-sm text-gray-500 mt-1 truncate">🎤 {{ w.artist }}</div>
          </div>
          <div v-if="w.created_at" class="text-sm text-gray-400 flex-shrink-0 whitespace-nowrap">{{ formatDate(w.created_at) }}</div>
        </div>
      </div>
    </template>

    <div v-else class="text-center py-8 text-red-400">贡献者不存在</div>
  </main>

  <!-- 联系方式复制弹窗（微信/邮箱等非链接值） -->
  <Teleport to="body">
    <Transition name="copy-fade">
      <div
        v-if="copyModal"
        class="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
        @click.self="copyModal = null"
      >
        <div class="bg-white rounded-2xl shadow-xl p-6 w-80 max-w-full">
          <div class="flex items-center gap-3">
            <span class="w-11 h-11 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
              <AppIcon :name="copyModal.key" class="w-7 h-7" />
            </span>
            <div class="min-w-0">
              <div class="font-semibold text-gray-800">{{ copyModal.key }}</div>
              <div class="text-xs text-gray-400">复制后前往对应平台添加</div>
            </div>
          </div>
          <div class="mt-4 px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl text-center text-gray-700 break-all select-all font-medium">{{ copyModal.value }}</div>
          <button
            class="mt-4 w-full py-2.5 rounded-xl text-white font-medium transition"
            :class="copied ? 'bg-green-500' : 'bg-pink-500 hover:bg-pink-600'"
            @click="doCopy"
          >{{ copied ? '已复制' : '复制' }}</button>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useHead } from '@unhead/vue'
import { api } from '@/lib/api'
import { useSSGData } from '@/composables/useSSGData'
import { useUiStore } from '@/stores/ui'
import { LOGO_URL, HERO_BG_URL } from '@/lib/constants'
import AppIcon from '@/components/common/AppIcon.vue'
import type { Contributor } from '@/lib/types'

const route = useRoute()
const ui = useUiStore()
const contributorId = route.params.id as string

interface ContributorPageData {
  contributor: Contributor
  works: { id: string; title: string; artist: string; type: string; created_at: string }[]
}

const { data: page, loading } = useSSGData<ContributorPageData>(`contributor:${contributorId}`, async () => {
  const contributor = await api.getContributor(contributorId)
  const works = await api.getContributorWorks(contributor.id)
  return { contributor, works }
})

const contributor = computed(() => page.value?.contributor)
const works = computed(() => page.value?.works || [])
const showBio = computed(() => contributor.value?.public_bio !== false && !!contributor.value?.bio)

useHead({
  title: computed(() => (contributor.value ? `${contributor.value.name} - 贡献者 - LrcShare` : '贡献者详情 - LrcShare')),
  meta: [
    { name: 'description', content: computed(() => (contributor.value ? `${contributor.value.name} 的贡献主页，共 ${contributor.value.song_count || 0} 件作品 - LrcShare` : '贡献者详情')) },
  ],
})

/** 公开联系方式 → 纯 logo 图标：URL 直接跳转；QQ 号转腾讯一键加好友；其余（微信/邮箱等）点击弹出复制框 */
const contactLinks = computed<{ key: string; value: string; href?: string }[]>(() => {
  const c = contributor.value
  if (!c?.public_contact || !c.contact_value) return []
  let cv: Record<string, string> = {}
  try {
    cv = typeof c.contact_value === 'string' ? JSON.parse(c.contact_value || '{}') : c.contact_value
  } catch {
    return []
  }
  return Object.entries(cv || {})
    .filter(([, v]) => v)
    .map(([k, v]) => {
      if (/^https?:\/\//i.test(v)) return { key: k, value: v, href: v }
      // QQ 号 → tencent:// 协议直接拉起加好友（无需登录网页临时会话）
      if (/^qq$/i.test(k) && /^\d{5,12}$/.test(v.trim())) {
        return { key: k, value: v, href: `tencent://AddContact/?fromId=45&fromSubId=1&sub=ai&uin=${v.trim()}` }
      }
      return { key: k, value: v }
    })
})

// ============ 复制弹窗（微信/邮箱等非链接联系方式） ============
const copyModal = ref<{ key: string; value: string } | null>(null)
const copied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | undefined

function openCopy(key: string, value: string) {
  copyModal.value = { key, value }
  copied.value = false
}

async function doCopy() {
  if (!copyModal.value) return
  try {
    await navigator.clipboard.writeText(copyModal.value.value)
  } catch {
    const ta = document.createElement('textarea')
    ta.value = copyModal.value.value
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
  copied.value = true
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    copied.value = false
    copyModal.value = null
  }, 900)
}

onUnmounted(() => clearTimeout(copyTimer))

const tags = computed<string[]>(() => {
  const t = contributor.value?.tags
  if (!t) return []
  if (Array.isArray(t)) return t
  return String(t).split(/[,，]/).map(s => s.trim()).filter(Boolean)
})

function formatDate(dateStr: string | null): string {
  if (!dateStr) return ''
  try {
    return new Date(dateStr).toISOString().slice(0, 10)
  } catch {
    return ''
  }
}
</script>

<style scoped>
.copy-fade-enter-active, .copy-fade-leave-active { transition: opacity 0.18s ease; }
.copy-fade-enter-from, .copy-fade-leave-to { opacity: 0; }
.contributor-hero {
  min-height: 200px;
}
.hero-bg-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 0;
}
.contributor-hero::after {
  content: '';
  position: absolute;
  inset: 0;
  background: linear-gradient(135deg, rgba(0, 0, 0, 0.35) 0%, rgba(0, 0, 0, 0.25) 100%);
  z-index: 1;
}
</style>
