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
      <!-- Hero 区 -->
      <div class="bg-gradient-to-br from-pink-50 via-white to-purple-50 rounded-2xl shadow-sm p-8 mb-6 border border-pink-100">
        <div class="flex flex-col md:flex-row items-center md:items-start gap-8">
          <div class="flex-shrink-0">
            <img :src="contributor.avatar || LOGO_URL" :alt="contributor.name" referrerpolicy="no-referrer" class="w-28 h-28 rounded-full object-cover ring-4 ring-pink-200 shadow-md cursor-zoom-in" @click="ui.openPreview([contributor.avatar || LOGO_URL])" />
          </div>
          <div class="flex-1 text-center md:text-left min-w-0">
            <h1 class="text-3xl font-bold text-gray-800">{{ contributor.name || '匿名贡献者' }}</h1>
            <p v-if="showBio" class="text-gray-500 mt-3 leading-relaxed">{{ contributor.bio }}</p>
            <div v-if="contactLinks.length" class="mt-4 flex flex-wrap items-center justify-center md:justify-start gap-3">
              <a
                v-for="link in contactLinks"
                :key="link.key"
                :href="link.isUrl ? link.value : undefined"
                target="_blank"
                rel="noopener noreferrer"
                :title="link.key"
                class="inline-flex items-center gap-2 px-4 py-2 bg-white rounded-lg border transition"
                :class="link.isUrl ? 'border-gray-200 text-gray-600 hover:border-purple-300 hover:bg-purple-50 hover:text-purple-700' : 'border-gray-200 text-gray-600 cursor-default'"
              >
                <AppIcon :name="link.key" class="w-5 h-5" />
                <span>{{ link.display }}</span>
              </a>
            </div>
          </div>
        </div>
      </div>

      <!-- 统计数据 -->
      <div class="grid grid-cols-2 gap-4 mb-6">
        <div class="bg-white rounded-2xl shadow-sm p-6 text-center">
          <div class="text-3xl font-bold text-pink-500">{{ contributor.song_count || 0 }}</div>
          <div class="text-gray-500 mt-1">作品数</div>
        </div>
        <div class="bg-white rounded-2xl shadow-sm p-6">
          <div class="text-sm text-gray-500 mb-2 text-center">标签</div>
          <div class="flex flex-wrap justify-center">
            <span v-for="t in tagArray(contributor.tags)" :key="t" class="chip" :class="chipColor(t)">{{ t }}</span>
            <span v-if="!tagArray(contributor.tags).length" class="text-gray-400 text-sm">暂无标签</span>
          </div>
        </div>
      </div>

      <!-- 作品列表 -->
      <div class="bg-white rounded-2xl shadow-sm p-6">
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
import { LOGO_URL } from '@/lib/constants'
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

/** 公开联系方式 → 链接（URL 类型显示友好名，迁移自 v2 getContactDisplayName） */
const contactLinks = computed<{ key: string; value: string; display: string; isUrl: boolean }[]>(() => {
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
      const isUrl = /^https?:\/\//i.test(v)
      return { key: k, value: v, display: isUrl ? contactDisplayName(k, v) : v, isUrl }
    })
})

function contactDisplayName(type: string, value: string): string {
  try {
    const url = new URL(value)
    const path = url.pathname.replace(/\/+$/, '')
    const parts = path.split('/').filter(Boolean)
    if (parts.length > 0) {
      // GitHub 取路径第一段（用户名），其余取最后一段
      return type === 'GitHub' ? parts[0] : parts[parts.length - 1]
    }
  } catch { /* 非法 URL */ }
  return type
}

function tagArray(tags: string[] | string | null | undefined): string[] {
  if (!tags) return []
  if (Array.isArray(tags)) return tags
  return String(tags).split(/[,，]/).map(s => s.trim()).filter(Boolean)
}

function chipColor(tag: string): string {
  const t = tag || ''
  if (t.includes('LOGO') || t.includes('设计')) return 'chip-pink'
  if (t.includes('歌词') || t.includes('贡献')) return 'chip-purple'
  if (t.includes('文案')) return 'chip-blue'
  if (t.includes('代码') || t.includes('开发')) return 'chip-green'
  if (t.includes('翻译')) return 'chip-yellow'
  if (t.includes('校对')) return 'chip-orange'
  if (t.includes('美工') || t.includes('美术')) return 'chip-cyan'
  return 'chip-red'
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
/* Tag Chip 颜色（迁移自 v2） */
.chip {
  display: inline-flex;
  align-items: center;
  padding: 2px 10px;
  border-radius: 9999px;
  font-size: 12px;
  font-weight: 500;
  line-height: 1.6;
  margin-right: 4px;
  margin-bottom: 4px;
}
.chip-pink { background-color: #fce7f3; color: #be185d; }
.chip-purple { background-color: #f3e8ff; color: #7c3aed; }
.chip-blue { background-color: #dbeafe; color: #1d4ed8; }
.chip-green { background-color: #dcfce7; color: #15803d; }
.chip-yellow { background-color: #fef3c7; color: #a16207; }
.chip-orange { background-color: #ffedd5; color: #c2410c; }
.chip-cyan { background-color: #cffafe; color: #0e7490; }
.chip-red { background-color: #fee2e2; color: #b91c1c; }
</style>
