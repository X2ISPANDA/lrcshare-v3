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
              </div>
              <!-- 联系方式：纯 logo 图标（URL 可点击；微信/QQ/邮箱等弹出复制框），与贡献者名单共用组件 -->
              <ContactIcons :contributor="contributor" variant="white" class="mt-2 justify-center md:justify-start" />
              <!-- 贡献标签：与艺术家 types 同款彩色渐变胶囊，独立一行 -->
              <div v-if="tags.length" class="flex items-center gap-2 mt-2 flex-wrap justify-center md:justify-start">
                <span
                  v-for="t in tags"
                  :key="t"
                  class="text-sm bg-gradient-to-r text-white px-3 py-1 rounded-full"
                  :class="tagGradient(t)"
                >{{ tagIcon(t) }} {{ t }}</span>
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
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useHead } from '@unhead/vue'
import { api } from '@/lib/api'
import { useSSGData } from '@/composables/useSSGData'
import { useUiStore } from '@/stores/ui'
import { LOGO_URL, HERO_BG_URL } from '@/lib/constants'
import AppIcon from '@/components/common/AppIcon.vue'
import ContactIcons from '@/components/contributor/ContactIcons.vue'
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

const tags = computed<string[]>(() => {
  const t = contributor.value?.tags
  if (!t) return []
  if (Array.isArray(t)) return t
  return String(t).split(/[,，]/).map(s => s.trim()).filter(Boolean)
})

/** 贡献标签 → 渐变色（关键词规则与名单页 chipColor 一致，换成艺术家 types 同款渐变胶囊） */
function tagGradient(tag: string): string {
  const t = tag || ''
  if (t.includes('LOGO') || t.includes('设计')) return 'from-pink-500 to-rose-500'
  if (t.includes('歌词') || t.includes('贡献')) return 'from-purple-500 to-violet-500'
  if (t.includes('文案')) return 'from-blue-500 to-sky-500'
  if (t.includes('代码') || t.includes('开发') || t.includes('网站') || t.includes('搭建') || t.includes('建站')) return 'from-green-500 to-teal-500'
  if (t.includes('翻译')) return 'from-amber-500 to-yellow-500'
  if (t.includes('校对')) return 'from-orange-500 to-red-500'
  if (t.includes('美工') || t.includes('美术')) return 'from-cyan-500 to-blue-500'
  return 'from-gray-500 to-gray-600'
}

/** 贡献标签 → emoji 图标 */
function tagIcon(tag: string): string {
  const t = tag || ''
  if (t.includes('LOGO')) return '🎨'
  if (t.includes('设计')) return '✏️'
  if (t.includes('歌词')) return '📝'
  if (t.includes('文案')) return '✍️'
  if (t.includes('代码') || t.includes('开发') || t.includes('网站') || t.includes('搭建') || t.includes('建站')) return '💻'
  if (t.includes('翻译')) return '🌐'
  if (t.includes('校对')) return '🔍'
  if (t.includes('美工') || t.includes('美术')) return '🖌️'
  return '🎵'
}

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
