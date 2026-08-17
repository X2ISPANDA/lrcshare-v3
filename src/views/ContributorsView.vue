<template>
  <main class="max-w-6xl mx-auto px-4 py-8">
    <!-- 标题区 -->
    <div class="bg-white rounded-2xl shadow-sm p-8 mb-6">
      <div class="text-sm text-pink-500 mb-2">致谢</div>
      <h1 class="text-3xl font-bold text-gray-800 mb-2">贡献者名单</h1>
      <p class="text-gray-500">感谢每一位为 LrcShare做出贡献的朋友们 ❤️</p>
    </div>

    <!-- 贡献者列表 -->
    <div class="bg-white rounded-2xl shadow-sm p-6 mb-6">
      <h2 class="text-xl font-bold text-gray-800 mb-4">🏆 贡献者名单</h2>
      <div v-if="loading" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
        <div v-for="i in 6" :key="i" class="bg-gray-50 rounded-xl p-5 animate-pulse">
          <div class="flex items-center gap-3">
            <div class="w-14 h-14 rounded-full bg-gray-200"></div>
            <div class="flex-1"><div class="h-5 bg-gray-200 rounded w-2/3 mb-2"></div><div class="h-3 bg-gray-100 rounded w-1/2"></div></div>
          </div>
        </div>
      </div>
      <div v-else-if="!contributors?.length" class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
        <div class="col-span-full text-center py-8 text-gray-400">暂无贡献者</div>
      </div>
      <div v-else class="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5">
        <!-- 外层不能用 a（RouterLink）：内部还有联系方式 a，SSG 预渲染的嵌套 a 会被浏览器解析拆散导致闪现错位 -->
        <div
          v-for="c in contributors"
          :key="c.id"
          class="bg-gradient-to-br from-pink-50 to-purple-50 rounded-xl p-5 border border-pink-100 hover:shadow-md transition relative cursor-pointer"
          @click="router.push(`/contributor/${c.id}`)"
        >
          <RouterLink :to="`/contributor/${c.id}`" class="block">
            <div class="flex items-center gap-3">
              <img :src="c.avatar || LOGO_URL" :alt="c.name" class="w-14 h-14 rounded-full object-cover ring-2 ring-pink-200 flex-shrink-0 cursor-zoom-in" @click.prevent.stop="ui.openPreview([c.avatar || LOGO_URL])" />
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between gap-2">
                  <h3 class="font-bold text-gray-800 text-base truncate">{{ c.name }}</h3>
                  <span class="inline-flex items-center gap-1 px-2.5 py-1 bg-white text-pink-600 text-xs font-semibold rounded-full border border-pink-200 shadow-sm shrink-0">
                    🎵 {{ c.song_count || 0 }} 首
                  </span>
                </div>
                <div class="mt-2">
                  <span v-for="t in tagArray(c.tags)" :key="t" class="chip" :class="chipColor(t)">{{ t }}</span>
                </div>
              </div>
            </div>
          </RouterLink>
          <p v-if="c.public_bio !== false && c.bio" class="text-sm text-gray-600 mt-2">{{ c.bio }}</p>
          <!-- 联系方式（仅 URL 类型） -->
          <div v-if="urlContacts(c).length" class="flex items-center gap-1 mt-3 relative z-10">
            <a
              v-for="[key, url] in urlContacts(c)"
              :key="key"
              :href="url"
              target="_blank"
              rel="noopener noreferrer"
              :title="key"
              class="inline-flex items-center justify-center w-6 h-6 text-gray-500 hover:text-pink-600 transition"
              @click.stop
            ><AppIcon :name="key" class="w-5 h-5" /></a>
          </div>
        </div>
      </div>
    </div>

    <!-- 底部说明 -->
    <div class="bg-gradient-to-r from-pink-50 to-purple-50 rounded-2xl shadow-sm p-6 border border-pink-100">
      <p class="text-gray-600 text-center">
        想成为贡献者？<RouterLink to="/submit" class="text-pink-600 font-medium hover:underline">投稿歌词</RouterLink> 或 帮忙设计 LOGO / 文案 / 代码，通过邮件联系站长即可。
      </p>
    </div>
  </main>
</template>

<script setup lang="ts">
import { useHead } from '@unhead/vue'
import { useRouter } from 'vue-router'
import { api } from '@/lib/api'
import { useSSGData } from '@/composables/useSSGData'
import { useUiStore } from '@/stores/ui'
import { LOGO_URL } from '@/lib/constants'
import AppIcon from '@/components/common/AppIcon.vue'
import type { Contributor } from '@/lib/types'

useHead({
  title: '贡献者名单 - LrcShare',
  meta: [{ name: 'description', content: '感谢每一位为 LrcShare 做出贡献的朋友们 - LrcShare' }],
})

const router = useRouter()
const ui = useUiStore()

const { data: contributors, loading } = useSSGData<Contributor[]>('contributors', () =>
  api.getContributors(),
)

/** tags 兼容数组/逗号分隔字符串 */
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

/** 仅 URL 类型的公开联系方式 */
function urlContacts(c: Contributor): [string, string][] {
  if (!c.public_contact || !c.contact_value) return []
  let cv: Record<string, string> = {}
  try {
    cv = typeof c.contact_value === 'string' ? JSON.parse(c.contact_value || '{}') : c.contact_value
  } catch {
    return []
  }
  return Object.entries(cv || {}).filter(([, v]) => v && /^https?:\/\//i.test(v)) as [string, string][]
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
