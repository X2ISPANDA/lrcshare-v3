<template>
  <main class="max-w-5xl mx-auto px-4 py-8">
    <div v-if="loading" class="w-full text-center py-16 text-gray-400">加载中...</div>

    <!-- 隐藏歌词占位（未解锁） -->
    <div v-else-if="isHidden" class="flex flex-col items-center justify-center py-20">
      <img :src="HIDDEN_PLACEHOLDER_IMG" alt="此歌词已被隐藏" class="max-w-md w-full rounded-2xl shadow-lg mb-8" />
      <p class="text-gray-400 text-lg text-center mb-6">此歌词已被隐藏</p>
      <button class="px-6 py-3 bg-pink-500 text-white rounded-xl hover:bg-pink-600 transition shadow-md" @click="unlock">
        🔑 输入口令解锁
      </button>
    </div>

    <template v-else-if="song">
      <!-- Header Card -->
      <div class="gradient-header rounded-3xl p-8 text-white shadow-2xl mb-6">
        <div class="flex items-center gap-6 flex-col md:flex-row">
          <div class="w-32 h-32 md:w-40 md:h-40 rounded-2xl bg-white/20 backdrop-blur flex items-center justify-center shadow-xl flex-shrink-0 overflow-hidden">
            <img
              v-if="cover"
              :src="cover"
              alt="封面"
              class="w-full h-full rounded-2xl cursor-zoom-in"
              :class="cover === LOGO_URL ? 'object-contain p-2' : 'object-cover'"
              @click="ui.openPreview([cover], 0)"
            />
            <span v-else class="text-5xl">💿</span>
          </div>
          <div class="flex-1 text-center md:text-left">
            <h1 class="text-3xl md:text-4xl font-bold mb-2">{{ song.title }}</h1>
            <div class="text-lg opacity-90">
              <template v-if="song.artists.length">
                <template v-for="(a, i) in song.artists" :key="a.id">
                  <span v-if="i > 0"> / </span>
                  <RouterLink :to="`/artist/${a.id}`" class="hover:underline">{{ a.name }}</RouterLink>
                </template>
              </template>
              <span v-else>未知</span>
              ·
              <RouterLink v-if="song.album_id" :to="`/album/${song.album_id}`" class="hover:underline">{{ song.album_name || '未知' }}</RouterLink>
              <span v-else>未知</span>
              <span v-if="song.album_year"> · {{ song.album_year }}</span>
              <span v-if="song.disc && song.disc > 1" class="text-sm bg-white/20 px-2 py-0.5 rounded ml-1">Disc {{ song.disc }}</span>
              <span v-if="song.track && song.track > 0" class="text-sm bg-white/20 px-2 py-0.5 rounded ml-1">曲目 {{ song.track }}</span>
            </div>
            <div v-if="song.genres?.length" class="flex flex-wrap gap-2 mt-3 justify-center md:justify-start">
              <span v-for="g in song.genres" :key="g" class="text-xs bg-white/20 px-2.5 py-1 rounded-full">{{ g }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Info Bar -->
      <div class="bg-white rounded-2xl shadow-sm p-4 mb-6">
        <div class="grid grid-cols-2 gap-4 text-center" :class="contributor ? 'md:grid-cols-5' : 'md:grid-cols-4'">
          <div>
            <div class="text-xs text-gray-400 mb-1">作词</div>
            <div class="font-medium text-gray-700"><CreditLinks :list="resolveField(song.lyricist)" /></div>
          </div>
          <div>
            <div class="text-xs text-gray-400 mb-1">作曲</div>
            <div class="font-medium text-gray-700"><CreditLinks :list="resolveField(song.composer)" /></div>
          </div>
          <div>
            <div class="text-xs text-gray-400 mb-1">编曲</div>
            <div class="font-medium text-gray-700"><CreditLinks :list="resolveField(song.arranger)" /></div>
          </div>
          <div>
            <div class="text-xs text-gray-400 mb-1">时长</div>
            <div class="font-medium text-gray-700 tabular-nums">{{ formatDuration(song.duration) }}</div>
          </div>
          <div v-if="contributor">
            <div class="text-xs text-gray-400 mb-1">歌词贡献</div>
            <div class="font-medium text-gray-700">
              <RouterLink :to="`/contributor/${contributor.id}`" class="text-pink-600 hover:underline">{{ contributor.name }}</RouterLink>
            </div>
          </div>
        </div>
      </div>

      <!-- 歌曲简介（毛玻璃渐变卡：粉色微渐变底 + blur + 顶部渐变高光条，标志性现代卡片） -->
      <div v-if="song.description" class="mb-6">
        <div class="relative overflow-hidden rounded-2xl border border-pink-200/60
                    bg-gradient-to-br from-pink-50/90 via-white to-purple-50/70
                    backdrop-blur-sm shadow-[0_2px_12px_-4px_rgba(236,72,153,0.15)]">
          <div class="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-pink-400 via-pink-300 to-purple-300"></div>
          <div class="flex items-start gap-3 px-5 pt-5 pb-5 md:px-6">
            <span class="w-9 h-9 rounded-xl bg-gradient-to-br from-pink-400 to-pink-500 text-white flex items-center justify-center shadow-sm flex-shrink-0">
              <svg class="w-4.5 h-4.5" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z" />
                <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" />
              </svg>
            </span>
            <div class="text-sm text-gray-600 leading-relaxed article-content min-w-0" v-html="descriptionHtml"></div>
          </div>
        </div>
      </div>

      <!-- 视频播放器 -->
      <div v-if="video" class="bg-white rounded-2xl shadow-sm p-6 mb-6">
        <h3 class="text-lg font-bold text-gray-800 mb-3">▶️ 视频播放</h3>
        <div class="flex justify-center">
          <iframe
            v-if="video.type === 'iframe'"
            :src="video.src"
            scrolling="no"
            frameborder="no"
            allowfullscreen
            class="w-full max-w-[640px] h-[360px] rounded-xl"
          ></iframe>
          <a v-else :href="video.src" target="_blank" class="text-pink-600 hover:underline break-all">{{ video.src }}</a>
        </div>
      </div>

      <!-- Lyrics Section（tab 行吸顶：滚动歌词时 tab 常驻导航栏下方） -->
      <!-- 版权声明：歌词卡片上方、tab 栏之前，两 tab 共用一处（两侧渐变线 + © 徽标；
           小屏收起装饰线，徽标居中置顶 + 文字居中换行，避免行内折行错位） -->
      <div class="flex flex-col sm:flex-row items-center gap-2 sm:gap-4 mb-4 sm:mb-3 px-1 md:px-2">
        <span class="hidden sm:block h-px flex-1 bg-gradient-to-r from-transparent to-amber-300/70"></span>
        <p class="flex flex-col sm:flex-row items-center gap-1.5 sm:gap-2 text-amber-700/90 text-xs sm:text-sm tracking-wide text-center max-w-xs sm:max-w-none">
          <span class="w-5 h-5 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 text-white text-[10px] flex items-center justify-center flex-shrink-0 shadow-sm">&copy;</span>
          <span>本页面中所使用的歌词，其著作权属于原著作权人，仅以交流学习为目的引用。</span>
        </p>
        <span class="hidden sm:block h-px flex-1 bg-gradient-to-l from-transparent to-amber-300/70"></span>
      </div>
      <div ref="lyricsCardRef" class="bg-white rounded-2xl shadow-sm mb-6">
        <div class="flex items-stretch sticky top-14 z-10 bg-white/95 backdrop-blur border-b rounded-t-2xl">
          <button class="flex-1 py-4 font-medium tab-btn" :class="activeTab === 'text' ? 'tab-active' : 'tab-inactive'" @click="switchLyricsTab('text')">📖 文本歌词</button>
          <button class="flex-1 py-4 font-medium tab-btn" :class="activeTab === 'lrc' ? 'tab-active' : 'tab-inactive'" @click="switchLyricsTab('lrc')">⏱️ LRC 歌词</button>
        </div>
        <div class="p-6 md:p-8">
          <!-- 译文语种按钮由 RichContentView 按内容自动生成 -->
          <RichContentView
            v-show="activeTab === 'text'"
            :html="textLyricsHtml"
            content-class="rich-lyrics text-center leading-loose text-gray-700 text-lg"
          />
          <div v-show="activeTab === 'lrc'" class="text-left leading-relaxed text-lg">
            <div v-for="(line, i) in lrcLines" :key="i" class="lyric-line py-1" :class="{ 'pl-2': !line.time }">
              <span v-if="line.time" class="lrc-time mr-2">{{ line.time }}</span>
              <span class="lrc-text">{{ line.text }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- Actions -->
      <div class="flex gap-3 justify-center mb-6 flex-wrap">
        <button class="px-6 py-3 bg-gray-600 text-white rounded-xl hover:bg-gray-700 transition shadow-md" @click="shareSong">🔗 分享链接</button>
        <button class="px-6 py-3 bg-gradient-to-r from-yellow-400 to-orange-500 text-white rounded-xl hover:from-yellow-500 hover:to-orange-600 transition shadow-md" @click="showReward = true">⚡ 请我喝杯奶茶</button>
      </div>

      <!-- Related Songs -->
      <div v-if="related.length" class="bg-white rounded-2xl shadow-sm p-6 mb-6">
        <h3 class="text-xl font-bold mb-4">🎤 同歌手其他歌曲</h3>
        <div v-for="group in related" :key="group.album" class="mb-4">
          <div class="text-sm font-medium text-gray-500 mb-2">📀 {{ group.album }}</div>
          <div class="flex flex-wrap gap-2">
            <RouterLink
              v-for="s in group.songs"
              :key="s.id"
              :to="`/song/${s.id}`"
              class="song-card inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 hover:bg-pink-50 rounded-full text-sm text-gray-700 hover:text-pink-600 transition"
            >
              <span>🎵</span>
              <span>{{ s.title }}</span>
              <span class="text-gray-400 text-xs tabular-nums">{{ formatDuration(s.duration) }}</span>
            </RouterLink>
          </div>
        </div>
      </div>

      <!-- 评论（Twikoo，仅客户端初始化） -->
      <div class="bg-white rounded-2xl shadow-sm p-6">
        <h3 class="text-xl font-bold mb-4">💬 评论</h3>
        <TwikooComment :path="`/song/${songId}`" />
      </div>
    </template>
  </main>

  <RewardModal v-model="showReward" />

  <!-- 复制 LRC 浮动胶囊：歌词区可见且滚过页头时出现 -->
  <Transition
    enter-active-class="transition duration-200 ease-out"
    enter-from-class="opacity-0 translate-y-2"
    enter-to-class="opacity-100 translate-y-0"
    leave-active-class="transition duration-150 ease-in"
    leave-from-class="opacity-100 translate-y-0"
    leave-to-class="opacity-0 translate-y-2"
  >
    <button
      v-if="showCopyFab"
      class="fixed bottom-5 left-1/2 -translate-x-1/2 z-40 px-5 py-2.5 rounded-full bg-white/90 backdrop-blur shadow-lg border border-gray-100 text-sm font-medium text-gray-600 hover:text-pink-600 hover:border-pink-200 transition-colors"
      @click="copyLrc"
    >📋 复制 LRC</button>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useHead } from '@unhead/vue'
import { ElMessage } from 'element-plus'
// 显式导入 ElMessage 不会附带样式（自动导入才有），需手动补 message 样式，否则提示框无定位不可见
import 'element-plus/es/components/message/style/css'
import { useElementVisibility, useWindowScroll } from '@vueuse/core'
import { api, formatDuration } from '@/lib/api'
import { mdToHtml } from '@/lib/markdown'
import { useSSGData } from '@/composables/useSSGData'
import { useUiStore } from '@/stores/ui'
import { LOGO_URL } from '@/lib/constants'
import RewardModal from '@/components/common/RewardModal.vue'
import RichContentView from '@/components/common/RichContentView.vue'
import CreditLinks from '@/components/song/CreditLinks.vue'
import type { Artist, Contributor, Song, SongWithNames } from '@/lib/types'

const route = useRoute()
const router = useRouter()
const songId = route.params.id as string
const ui = useUiStore()

const HIDDEN_PLACEHOLDER_IMG = 'https://i0.hdslb.com/bfs/article/c07c33a93366f960bdef02ff5411c99837977624.png'

/** 页面组合数据（一次 SSG 预取全部，避免多 key 时序问题） */
interface SongPageData {
  song: SongWithNames & { artists: Artist[]; credit_artists: Artist[] }
  contributor: Contributor | null
  /** 同歌手其他歌曲（按专辑分组） */
  related: { album: string; songs: Song[] }[]
}

const { data: page, loading } = useSSGData<SongPageData>(`song:${songId}`, async () => {
  const song = await api.getSong(songId)

  // 隐藏歌曲：SSG 阶段不落盘歌词（initialState 会序列化进 HTML 源码，防泄露），解锁后客户端重拉
  if (song.is_hidden) song.lrc_text = null

  const [contributor, relatedRaw] = await Promise.all([
    song.contributor_id
      ? api.getContributor(song.contributor_id).catch(() => null)
      : Promise.resolve<Contributor | null>(null),
    api.getRelatedSongs(song.artist_ids || [], song.id).catch(() => [] as Song[]),
  ])

  const grouped = new Map<string, Song[]>()
  for (const s of relatedRaw) {
    const albumName = s.albums?.name || '其他'
    if (!grouped.has(albumName)) grouped.set(albumName, [])
    grouped.get(albumName)!.push(s)
  }

  return { song, contributor, related: [...grouped.entries()].map(([album, songs]) => ({ album, songs })) }
})

const song = computed(() => page.value?.song)
const contributor = computed(() => page.value?.contributor)
const related = computed(() => page.value?.related || [])

useHead({
  title: computed(() => (song.value ? `${song.value.title} - ${song.value.artist_name} - LrcShare` : '歌曲详情 - LrcShare')),
  meta: [
    { name: 'description', content: computed(() => (song.value ? `${song.value.title} - ${song.value.artist_name} 的滚动歌词，来自 LrcShare` : '歌曲详情')) },
  ],
})

// ============ 隐藏歌词解锁 ============
const unlocked = ref(false)
// onMounted 后再读 sessionStorage，保证水合结果与 SSG HTML 一致（SSG 恒为占位页）
onMounted(() => {
  unlocked.value = sessionStorage.getItem('unlock_hidden') === 'true'
})
const isHidden = computed(() => !!song.value?.is_hidden && !unlocked.value)

async function unlock() {
  const input = window.prompt('请输入解锁口令：')
  if (!input) return
  try {
    const { data: setting } = await api.supabase
      .from('settings')
      .select('value')
      .eq('key', 'hidden_unlock_code')
      .single()
    const globalCode = (setting as { value?: string } | null)?.value || ''
    const songCode = song.value?.unlock_code || ''
    if (input === globalCode || (songCode && input === songCode)) {
      sessionStorage.setItem('unlock_hidden', 'true')
      unlocked.value = true
      // 重新拉取完整歌词（SSG 数据里已清空）
      const full = await api.getSong(songId)
      if (page.value) page.value = { ...page.value, song: full }
      ElMessage.success('解锁成功！')
    } else {
      ElMessage.error('口令错误')
    }
  } catch {
    ElMessage.error('解锁失败，请稍后重试')
  }
}

// ============ 展示 computed ============
const cover = computed(() => song.value?.album_cover || song.value?.artists[0]?.avatar || LOGO_URL)

/** 作词/作曲/编曲：逗号分隔的艺术家 id → 链接数组（查找范围含 credit 字段专属艺术家，如编曲人不在 artist_ids 中） */
function resolveField(ids: string | null | undefined): { id: string; name: string }[] {
  if (!ids) return []
  const pool = [...(song.value?.artists || []), ...(song.value?.credit_artists || [])]
  return ids
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
    .map(aid => {
      const found = pool.find(a => a.id === aid)
      return found ? { id: found.id, name: found.name } : { id: '', name: aid }
    })
}

const TIP_ICONS: Record<string, string> = {
  bell: '🔔', info: 'ℹ️', success: '✅', warning: '⚠️',
  danger: '❌', tip: '💡', note: '📝', important: '❗',
}

/** 简介：Markdown + Hexo {% tip %} 标签（迁移自 v2 preprocessMarkdown） */
const descriptionHtml = computed(() => {
  const md = song.value?.description
  if (!md) return ''
  const withTips = md.replace(
    /\{%\s*tip\s+(\w+)\s*%\}([\s\S]*?)\{%\s*endtip\s*%\}/g,
    (_m, type: string, content: string) => {
      const icon = TIP_ICONS[type] || '💡'
      return `<div class="tip-box tip-${type}"><span class="tip-icon">${icon}</span><div class="tip-content">${mdToHtml(content.trim())}</div></div>`
    },
  )
  // tip 块替换后整体走 Markdown（行内 HTML 块 marked 会原样保留）
  return mdToHtml(withTips)
})

/** 视频播放器：B站 / YouTube / 外链 */
const video = computed<{ type: 'iframe' | 'link'; src: string } | null>(() => {
  const url = song.value?.video_url
  if (!url) return null
  const bv = url.match(/BV\w+/i)
  if (bv || url.includes('bilibili.com')) {
    return { type: 'iframe', src: `https://player.bilibili.com/player.html?bvid=${bv ? bv[0] : ''}&high_quality=1&autoplay=0` }
  }
  if (url.includes('youtube.com') || url.includes('youtu.be')) {
    const watch = url.match(/[?&]v=([^&]+)/)
    const short = url.match(/youtu\.be\/([^?&]+)/)
    const vid = watch ? watch[1] : short ? short[1] : ''
    if (vid) return { type: 'iframe', src: `https://www.youtube.com/embed/${vid}` }
  }
  return { type: 'link', src: url }
})

// ============ 歌词 ============
// 歌词视图 tab 写入路由 query（?tab=lrc），从歌手/专辑页返回时保持所在视图
const activeTab = ref<'text' | 'lrc'>(route.query.tab === 'lrc' ? 'lrc' : 'text')

function switchLyricsTab(key: 'text' | 'lrc') {
  activeTab.value = key
  router.replace({ query: key === 'lrc' ? { ...route.query, tab: 'lrc' } : { ...route.query, tab: undefined } })
}

/** 文本歌词：lyrics_text（Markdown + 内嵌 HTML）优先，否则从 LRC 提取纯文本。
 *  lyrics_text 走 marked 解析（支持 md 语法 + 工具栏生成的内嵌 HTML 标注）；
 *  marked 默认不换行，歌词逐行内容用 breaks 选项把 \n 渲染成 <br> */
const textLyricsHtml = computed(() => {
  const s = song.value
  if (!s) return ''
  if (s.lyrics_text) return mdToHtml(s.lyrics_text)
  const text = (s.lrc_text || '')
    .replace(/\[.*?\]/g, '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line)
    .join('\n')
  return text.split('\n').map(line => line || '&nbsp;').join('<br>')
})

/** LRC 行（多时间标签行拆分为多行，过滤元数据行） */
const lrcLines = computed<{ time: string; text: string }[]>(() => {
  const lrc = song.value?.lrc_text || ''
  const timeRegex = /\[(\d{2}):(\d{2})\.(\d{2})\]/g
  const lines: { time: string; text: string }[] = []
  for (const line of lrc.split('\n')) {
    const matches = [...line.matchAll(timeRegex)]
    const text = line.replace(timeRegex, '').trim()
    if (!text) continue
    if (matches.length > 0) {
      for (const m of matches) lines.push({ time: `[${m[1]}:${m[2]}.${m[3]}]`, text })
    } else if (!/^\[(ti|ar|al|by)\]/.test(line.trim())) {
      lines.push({ time: '', text })
    }
  }
  return lines
})

// ============ 操作 ============
const showReward = ref(false)

// 复制 LRC 浮动胶囊：歌词卡片可见且已滚过页头时出现（SSG 安全：回调内才读 window）
const lyricsCardRef = ref<HTMLElement | null>(null)
const lyricsVisible = useElementVisibility(lyricsCardRef)
const { y: scrollY } = useWindowScroll()
const showCopyFab = computed(() => lyricsVisible.value && scrollY.value > 300)

async function copyText(text: string) {
  if (navigator.clipboard && window.isSecureContext) {
    await navigator.clipboard.writeText(text)
  } else {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.style.position = 'fixed'
    ta.style.left = '-9999px'
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
  }
}

function copyLrc() {
  if (!song.value?.lrc_text) return
  copyText(song.value.lrc_text).then(() => ElMessage.success('LRC 歌词已复制到剪贴板！'))
}

function shareSong() {
  copyText(window.location.href).then(() => ElMessage.success('链接已复制到剪贴板！'))
}
</script>

<style scoped>
.gradient-header {
  background: linear-gradient(135deg, #1e1b4b 0%, #7c3aed 50%, #ec4899 100%);
}
.lyric-line { transition: all 0.2s; padding: 4px 0; }
.lyric-line:hover { color: inherit; transform: none; }
.lrc-time { color: inherit; font-weight: normal; }
.lrc-text { color: #374151; }
.tab-btn { transition: all 0.2s; }
.tab-active { color: #ec4899; border-bottom: 2px solid #ec4899; }
.tab-inactive { color: #9ca3af; border-bottom: 2px solid transparent; }
.song-card { transition: all 0.2s; }
.song-card:hover {
  background: linear-gradient(90deg, #fdf2f8 0%, #faf5ff 100%);
}

/* Hexo Tip Box（歌曲简介，迁移自 v2） */
.tip-box {
  border-radius: 8px;
  padding: 14px 18px;
  margin: 16px 0;
  border: 1px solid transparent;
  display: flex;
  gap: 12px;
  line-height: 1.7;
  font-size: 0.95rem;
}
.tip-box .tip-icon { font-size: 20px; flex-shrink: 0; }
.tip-box .tip-content { flex: 1; }
.tip-box.tip-bell { background: #fff7ed; border-color: #fed7aa; color: #9a3412; }
.tip-box.tip-info { background: #eff6ff; border-color: #bfdbfe; color: #1e40af; }
.tip-box.tip-success { background: #f0fdf4; border-color: #bbf7d0; color: #166534; }
.tip-box.tip-warning { background: #fefce8; border-color: #fde68a; color: #854d0e; }
.tip-box.tip-danger { background: #fef2f2; border-color: #fecaca; color: #991b1b; }
.tip-box.tip-tip { background: #f0f9ff; border-color: #bae6fd; color: #075985; }
.tip-box.tip-note { background: #faf5ff; border-color: #e9d5ff; color: #6b21a8; }
.tip-box.tip-important { background: #fdf4ff; border-color: #f5d0fe; color: #86198f; }
.tip-box p { margin: 0; }
</style>
