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
            <h1 class="text-3xl md:text-4xl font-bold mb-2" :title="songTitleFull">{{ song.title }}<span v-if="song.aliases?.length" class="text-lg md:text-xl font-normal opacity-70 ml-2">{{ song.aliases.join(' / ') }}</span></h1>
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
            <div class="font-medium text-gray-700"><CreditLinks :list="resolveField('lyricist')" /></div>
          </div>
          <div>
            <div class="text-xs text-gray-400 mb-1">作曲</div>
            <div class="font-medium text-gray-700"><CreditLinks :list="resolveField('composer')" /></div>
          </div>
          <div>
            <div class="text-xs text-gray-400 mb-1">编曲</div>
            <div class="font-medium text-gray-700"><CreditLinks :list="resolveField('arranger')" /></div>
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

      <!-- 视频播放器（悬浮小窗：滚出视口时同一 iframe fixed 到右下角，播放不中断；YouTube/B站通用） -->
      <div v-if="video" ref="videoSlotRef" class="bg-white rounded-2xl shadow-sm p-6 mb-6">
        <h3 class="text-lg font-bold text-gray-800 mb-3">▶️ 视频播放</h3>
        <div class="flex justify-center">
          <template v-if="video.type === 'iframe'">
            <!-- 原位槽位：恒定 640×360 占位，悬浮时布局零跳动 -->
            <div class="relative w-full max-w-[640px] h-[360px]">
              <!-- 悬浮期间原位提示（可点击滚回视频） -->
              <div
                v-if="videoFloating"
                class="absolute inset-0 z-0 rounded-xl border border-dashed border-pink-200 bg-gradient-to-br from-pink-50/60 to-purple-50/40 flex flex-col items-center justify-center gap-1.5 cursor-pointer select-none"
                @click="backToVideo"
              >
                <span class="text-3xl">📺</span>
                <p class="text-sm text-gray-500">视频正在右下角小窗播放</p>
                <p class="text-xs text-pink-500">点击此处返回视频 ↑</p>
              </div>
              <!-- 播放器本体：悬浮时整个容器 fixed 到右下角；同一 iframe 不卸载、播放不中断 -->
              <div class="relative w-full h-full" :class="videoFloating ? 'video-mini' : ''">
                <iframe
                  ref="ytIframeRef"
                  :src="video.src"
                  scrolling="no"
                  frameborder="no"
                  :referrerpolicy="video.src.includes('youtube.com') ? 'strict-origin-when-cross-origin' : undefined"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowfullscreen
                  class="w-full h-full rounded-xl"
                  @load="armYtListener"
                ></iframe>
                <button
                  v-if="videoFloating"
                  class="absolute top-2 right-2 w-7 h-7 rounded-full bg-black/60 hover:bg-black/80 text-white text-sm leading-none flex items-center justify-center shadow transition-colors"
                  title="关闭小窗（暂停播放）"
                  @click="closeMini"
                >✕</button>
              </div>
            </div>
          </template>
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
      <div class="bg-white rounded-2xl shadow-sm mb-6">
        <div class="flex items-stretch sticky top-14 z-10 bg-white/95 backdrop-blur border-b rounded-t-2xl">
          <button class="flex-1 py-4 font-medium tab-btn" :class="activeTab === 'text' ? 'tab-active' : 'tab-inactive'" @click="switchLyricsTab('text')">📖 文本歌词</button>
          <button class="flex-1 py-4 font-medium tab-btn" :class="activeTab === 'lrc' ? 'tab-active' : 'tab-inactive'" @click="switchLyricsTab('lrc')">⏱️ LRC 歌词</button>
          <button v-if="ttmlVersions.length" class="flex-1 py-4 font-medium tab-btn" :class="activeTab === 'ttml' ? 'tab-active' : 'tab-inactive'" @click="switchLyricsTab('ttml')">🎼 TTML</button>
        </div>
        <div class="p-6 md:p-8">
          <!-- 译文语种按钮由 RichContentView 按内容自动生成 -->
          <RichContentView
            v-show="activeTab === 'text'"
            :html="textLyricsHtml"
            content-class="rich-lyrics text-center leading-loose text-gray-700 text-lg"
          />
          <div v-show="activeTab === 'lrc'" class="text-left">
            <!-- 工具行：版本下拉（多版本时出现）+ 格式下拉 -->
            <div class="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <select
                v-if="lyricVersions.length > 1"
                v-model="lrcVersionKey"
                class="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-gray-50 text-gray-600 focus:outline-none focus:border-pink-300 cursor-pointer"
              >
                <option value="all">全部版本（混合）</option>
                <option v-for="v in lyricVersions" :key="`${v.lang}|${v.kind}`" :value="`${v.lang}|${v.kind}`">
                  {{ LYRIC_KIND_LABEL[v.kind] }} · {{ langLabel(v.lang) }}
                </option>
              </select>
              <span v-else-if="lyricVersions.length === 1" class="text-xs text-gray-400">
                {{ LYRIC_KIND_LABEL[lyricVersions[0].kind] }} · {{ langLabel(lyricVersions[0].lang) }}
              </span>
              <span v-else></span>
              <select
                v-model="lrcFormat"
                class="format-select text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-gray-50 text-gray-600 focus:outline-none focus:border-pink-300 cursor-pointer"
              >
                <option value="line">LRC</option>
                <option value="enhanced" :disabled="!hasWordTiming">增强逐字 LRC（无词级数据）</option>
                <option value="verbatim" :disabled="!hasWordTiming">逐字 LRC（无词级数据）</option>
                <option value="ttml">TTML</option>
              </select>
            </div>
            <!-- 文本框 + Typora 式「全部复制」（悬浮出现） -->
            <div class="group relative">
              <button
                class="absolute top-2 right-2 z-10 px-2.5 py-1 text-xs rounded-md bg-white/90 border border-gray-200 text-gray-500 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:text-pink-600 hover:border-pink-200 cursor-pointer"
                @click="copyCurrentLrc"
              >全部复制</button>
              <pre class="lyric-code text-sm text-gray-600 whitespace-pre-wrap">{{ lrcText }}</pre>
            </div>
          </div>
          <!-- TTML 逐字/对唱视图：结构化渲染（声部分列 + 和声 + 翻译随行），渐进增强 -->
          <div v-show="activeTab === 'ttml'" class="text-left group relative">
            <!-- 悬浮「全部复制」：复制当前选中版本的 TTML 原文 -->
            <button
              class="absolute top-0 right-0 z-10 px-2.5 py-1 text-xs rounded-md bg-white/90 border border-gray-200 text-gray-500 shadow-sm opacity-0 group-hover:opacity-100 transition-opacity hover:text-pink-600 hover:border-pink-200 cursor-pointer"
              @click="copyCurrentTtml"
            >全部复制</button>
            <!-- 来源署名条（ttml-hub 导入版本）：LunaBeat logo + 双链接，尊重上游创作 -->
            <div v-if="selectedTtml?.source === 'ttml-hub'" class="mb-4 flex items-center justify-center gap-2.5 flex-wrap rounded-xl bg-gray-900 px-4 py-3 text-sm text-gray-300 shadow-md">
              <span class="w-7 h-7 rounded-full bg-white flex items-center justify-center flex-shrink-0">
                <svg viewBox="0 0 1024 1024" class="w-4 h-4" aria-hidden="true">
                  <g>
                    <path fill="#171717" fill-rule="evenodd" d="M798,667.5c0,153-80,248-202,248h-137c-130,0-233-98-233-228V159.5c0-25,15-51,48-51,24,0,41,23,41,51v527c0,85,60,147,147,147h132c76,0,122-59,122-162,0-109-57-171-141-171-73,0-118,37-118,90v106c0,24-19,43-43,43s-43-19-43-43v-234.97c14.17,16.82,28.33,33.65,42.5,50.47,14.5-17.12,29-34.23,43.5-51.35,3.35-3.76,8.41-8.96,15.21-14.32,36.33-28.64,79.6-27.83,103.79-27.83,128,0,222,87,222,249Z" />
                    <path fill="#171717" d="M371,295.11h86v138.92c-14.33,18.25-28.67,36.49-43,54.74-14.33-18.25-28.67-36.49-43-54.74v-138.92Z" />
                    <path fill="#171717" d="M371,284.93h86v-34.4c-.57-16.6-19.8-30.03-43-30.03s-42.43,13.43-43,30.03v34.4Z" />
                  </g>
                </svg>
              </span>
              <span>本歌词来自</span>
              <a href="https://github.com/2755337087/LunaBeat" target="_blank" rel="noopener noreferrer"
                class="font-semibold text-white underline decoration-gray-500/60 underline-offset-4 transition-colors hover:text-pink-400 hover:decoration-pink-400">LunaBeat</a>
              <span class="text-gray-600">·</span>
              <a href="https://2755337087.github.io/ttml-hub/" target="_blank" rel="noopener noreferrer"
                class="font-semibold text-white underline decoration-gray-500/60 underline-offset-4 transition-colors hover:text-pink-400 hover:decoration-pink-400">TTML 歌词站</a>
            </div>
            <!-- 版本切换（多个 TTML 版本时） -->
            <div v-if="ttmlVersions.length > 1" class="flex items-center justify-between gap-3 mb-3 flex-wrap">
              <select
                v-model="ttmlVersionId"
                class="text-sm border border-gray-200 rounded-lg px-2.5 py-1.5 bg-gray-50 text-gray-600 focus:outline-none focus:border-pink-300 cursor-pointer"
              >
                <option v-for="v in ttmlVersions" :key="v.id" :value="v.id">
                  {{ ttmlVersionLabel(v) }}
                </option>
              </select>
            </div>
            <div v-if="ttmlGroups.length" class="ttml-view flex flex-col gap-3 py-2">
              <div
                v-for="(g, gi) in ttmlGroups"
                :key="gi"
                class="flex flex-col"
                :class="ttmlGroupAlign(g)"
              >
                <p class="text-lg leading-relaxed text-gray-700 whitespace-pre-wrap">{{ g.line.text }}</p>
                <p v-for="(b, bi) in g.line.bg" :key="`bg${bi}`" class="text-sm text-gray-400 italic leading-snug">{{ b }}</p>
                <p v-for="(t, ti) in g.translations" :key="`tr${ti}`" class="text-sm text-gray-400 leading-snug">{{ t.text }}</p>
              </div>
            </div>
            <div v-else class="text-center text-gray-400 py-8 text-sm">TTML 内容解析失败</div>
            <p v-if="ttmlCredit" class="text-center text-xs text-gray-400 mt-4">{{ ttmlCredit }}</p>
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
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useHead } from '@unhead/vue'
import { ElMessage } from 'element-plus'
// 显式导入 ElMessage 不会附带样式（自动导入才有），需手动补 message 样式，否则提示框无定位不可见
import 'element-plus/es/components/message/style/css'
import { useElementVisibility } from '@vueuse/core'
import { api, formatDuration } from '@/lib/api'
import { mdToHtml } from '@/lib/markdown'
import { useSSGData } from '@/composables/useSSGData'
import { useUiStore } from '@/stores/ui'
import { LOGO_URL, TIP_ICONS } from '@/lib/constants'
import { copyText } from '@/lib/clipboard'
import {
  LYRIC_KIND_LABEL,
  groupVersions,
  loadLyricLines,
  loadLyricVersionMetas,
  parseTtmlStructure,
  composeMixedLrc,
  versionsToTtml,
  fillCommonRows,
  rowsHaveWordTags,
  langLabel,
  type LyricLineRow,
  type LyricVersion,
  type LyricVersionMeta,
  type TtmlRenderLine,
  type TtmlStructure,
} from '@/lib/lyricLines'
import RewardModal from '@/components/common/RewardModal.vue'
import RichContentView from '@/components/common/RichContentView.vue'
import CreditLinks from '@/components/song/CreditLinks.vue'
import type { Artist, Contributor, Song, SongWithNames } from '@/lib/types'

const route = useRoute()
const router = useRouter()
const songId = route.params.id as string
const ui = useUiStore()

const HIDDEN_PLACEHOLDER_IMG = 'https://i0.hdslb.com/bfs/openplatform/6e065deeee2d046c05347d3f76592b6fb39c66a8.png'

/** 页面组合数据（一次 SSG 预取全部，避免多 key 时序问题） */
interface SongPageData {
  song: SongWithNames & { artists: Artist[]; credit_artists: Artist[]; credits: { role: string; artist_ids: string[] }[] }
  contributor: Contributor | null
  /** 同歌手其他歌曲（按专辑分组） */
  related: { album: string; songs: Song[] }[]
}

const { data: page, loading } = useSSGData<SongPageData>(`song:${songId}`, async () => {
  const song = await api.getSong(songId)

  // 隐藏歌曲：SSG 阶段不落盘歌词（initialState 会序列化进 HTML 源码，防泄露），解锁后客户端重拉
  if (song.is_hidden) {
    song.lrc_text = null
    song.lyrics_text = null
  }

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
/** h1 悬浮完整标题：曲名 + 别名（长别名换行省略时悬浮可见） */
const songTitleFull = computed(() => {
  const s = song.value
  if (!s) return ''
  return s.aliases?.length ? `${s.title}（${s.aliases.join(' / ')}）` : s.title
})
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
// 通行证语义：全局口令验证一次 = 会话通行证，对「无独立口令」的隐藏歌处处生效；
// 设了独立口令的歌不认通行证，只能用自己的 key（逐首验）。
// verify RPC 返回 'global' | 'song' | ''（未命中）
const GLOBAL_PASS_KEY = 'unlock_hidden:__global__'
const unlockKey = `unlock_hidden:${songId}`
// onMounted 后再读 sessionStorage，保证水合结果与 SSG HTML 一致（SSG 恒为占位页）
onMounted(() => {
  if (sessionStorage.getItem(unlockKey)) unlocked.value = true
  evaluateGlobalPass()
})
/** 全局通行证：该歌没设独立口令才放行（独立口令歌必须逐首验）；数据异步到达后再评估一次 */
async function evaluateGlobalPass() {
  if (unlocked.value || !song.value?.is_hidden) return
  if (!sessionStorage.getItem(GLOBAL_PASS_KEY)) return
  try {
    const { data: ownCode } = await api.supabase.rpc('song_has_own_code', { p_song_id: songId })
    if (!ownCode) unlocked.value = true
  } catch { /* 探测失败按有独立口令处理，安全侧 */ }
}
watch(() => song.value?.is_hidden, () => evaluateGlobalPass())
const isHidden = computed(() => !!song.value?.is_hidden && !unlocked.value)

/** 会话内已解锁但歌词仍为空（SSG/SPA 数据已清空且非本次解锁触发）：重拉一次完整歌词 */
let hiddenRefetched = false
watch(
  () => !!song.value?.is_hidden && unlocked.value && !song.value.lrc_text && !song.value.lyrics_text,
  async need => {
    if (!need || hiddenRefetched) return
    hiddenRefetched = true
    const full = await api.getSong(songId).catch(() => null)
    if (full && page.value) page.value = { ...page.value, song: full }
  },
)

async function unlock() {
  const input = window.prompt('请输入解锁口令：')
  if (!input) return
  try {
    // 口令校验走数据库 RPC（security definer）：settings 受 RLS 保护，前端读不到 hidden_unlock_code；
    // 全局口令与歌曲独立口令均在库端比对，口令明文不下发客户端
    const { data: hit } = await api.supabase.rpc('verify_hidden_unlock_code', {
      p_song_id: songId,
      p_code: input,
    })
    if (hit === 'global') {
      // 全局口令：记通行证 + 本歌 key（无独立口令的隐藏歌此后会话内直开）
      sessionStorage.setItem(GLOBAL_PASS_KEY, 'true')
      sessionStorage.setItem(unlockKey, 'true')
      unlocked.value = true
      hiddenRefetched = true // 本函数自行重拉，避免触发上方 watch 重复请求
      // 重新拉取完整歌词（SSG 数据里已清空）
      const full = await api.getSong(songId)
      if (page.value) page.value = { ...page.value, song: full }
      ElMessage.success('解锁成功！')
    } else if (hit === 'song') {
      // 独立口令：只记本歌 key（不产生通行证）
      sessionStorage.setItem(unlockKey, 'true')
      unlocked.value = true
      hiddenRefetched = true
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
const cover = computed(() => song.value?.cover || song.value?.album_cover || song.value?.artists[0]?.avatar || LOGO_URL)

/** 作词/作曲/编曲：按角色从中间表 credits 取 id 列表 → 链接数组（查找范围含 credit 字段专属艺术家，如编曲人不在 artist_ids 中） */
const ROLE_FIELD: Record<string, string> = { lyricist: 'lyricist', composer: 'composer', arranger: 'arranger' }
function resolveField(field: string | null | undefined): { id: string; name: string }[] {
  if (!field) return []
  const role = ROLE_FIELD[field]
  if (!role) return []
  const pool = [...(song.value?.artists || []), ...(song.value?.credit_artists || [])]
  const ids = song.value?.credits?.find(c => c.role === role)?.artist_ids || []
  return ids
    .map(aid => {
      const found = pool.find(a => a.id === aid)
      return found ? { id: found.id, name: found.name } : { id: '', name: aid }
    })
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
    // enablejsapi=1：开启 postMessage 通道，用于检测播放状态（小窗仅在播放过后悬浮）
    if (vid) return { type: 'iframe', src: `https://www.youtube.com/embed/${vid}?enablejsapi=1` }
  }
  return { type: 'link', src: url }
})

// ============ 视频悬浮小窗（YouTube 官方式，B站同待遇） ============
/** 原位卡片 ref：始终留在文档流中做可见性检测（悬浮时槽位保留 360px，布局不跳动） */
const videoSlotRef = ref<HTMLElement | null>(null)
const videoSlotVisible = useElementVisibility(videoSlotRef)

const isYt = computed(() => !!video.value?.src.includes('youtube.com'))
const isBili = computed(() => !!video.value?.src.includes('bilibili.com'))
const ytIframeRef = ref<HTMLIFrameElement | null>(null)
/** 用户至少播放过一次（对齐官方：未播放的视频不弹小窗） */
const videoStarted = ref(false)
/** 手动关闭小窗后本次不再弹出；滚回视频区自动重新武装 */
const miniDismissed = ref(false)

/** 悬浮开关：可悬浮平台（YT/B站）+ 播放过 + 未手动关闭 + 原位卡片滚出视口 */
const videoFloating = computed(() =>
  (isYt.value || isBili.value) && videoStarted.value && !miniDismissed.value && !videoSlotVisible.value
)

/** B站播放器无 postMessage 状态推送：点击跨域 iframe 时父窗口失焦且
 *  document.activeElement 变为该 iframe，借此检测"用户播放过"（移动端由滚出视口时的兜底检查覆盖） */
function checkBiliStarted() {
  if (videoStarted.value || !isBili.value) return
  if (document.activeElement === ytIframeRef.value) videoStarted.value = true
}

// 滚回视频区 → 重新武装小窗；滚出视口 → B站兜底检测一次
watch(videoSlotVisible, visible => {
  if (visible) miniDismissed.value = false
  else checkBiliStarted()
})

/** YouTube 播放状态：iframe 启用 enablejsapi 后监听 postMessage（infoDelivery.playerState：1=播放中） */
function onYtMessage(e: MessageEvent) {
  if (e.origin !== 'https://www.youtube.com') return
  try {
    const data = typeof e.data === 'string' ? JSON.parse(e.data) : e.data
    if (data?.event === 'infoDelivery' && data.info?.playerState === 1) videoStarted.value = true
  } catch { /* 非 JSON 载荷忽略 */ }
}

/** 点击 B站 iframe → 父窗口失焦，此时 activeElement 已指向 iframe */
function onWinBlur() {
  checkBiliStarted()
}

/** iframe load 后向 YouTube 播放器发 listening 握手（播放器才会开始推送状态事件），延迟补发一次防竞态 */
function armYtListener() {
  if (!isYt.value) return
  const send = () =>
    ytIframeRef.value?.contentWindow?.postMessage(
      JSON.stringify({ event: 'listening', id: 1, channel: 'widget' }),
      '*',
    )
  send()
  setTimeout(send, 1500)
}

function closeMini() {
  miniDismissed.value = true
  // 顺手暂停，关窗后不再出声（B站 iframe 播放器 postMessage 控制，尽力而为）
  const win = ytIframeRef.value?.contentWindow
  if (isYt.value) {
    win?.postMessage(JSON.stringify({ event: 'command', func: 'pauseVideo', args: [] }), '*')
  } else if (isBili.value) {
    win?.postMessage({ type: 'pause' }, '*')
  }
}

/** 点击原位占位提示 → 平滑滚回视频 */
function backToVideo() {
  videoSlotRef.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

onMounted(() => {
  window.addEventListener('message', onYtMessage)
  window.addEventListener('blur', onWinBlur)
})
onBeforeUnmount(() => {
  window.removeEventListener('message', onYtMessage)
  window.removeEventListener('blur', onWinBlur)
})

// ============ 歌词 ============
// 歌词视图 tab 写入路由 query（?tab=lrc / ?tab=ttml），从歌手/专辑页返回时保持所在视图；
// 有 TTML 版本且无歌词正文时默认落在 TTML tab（D2：TTML 优先）
const routeHasTab = (t: string) => ['text', 'lrc', 'ttml'].includes(t)
const activeTab = ref<'text' | 'lrc' | 'ttml'>(routeHasTab(route.query.tab as string) ? (route.query.tab as any) : 'text')

function switchLyricsTab(key: 'text' | 'lrc' | 'ttml') {
  activeTab.value = key
  router.replace({ query: key === 'text' ? { ...route.query, tab: undefined } : { ...route.query, tab: key } })
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

// ============ 多语言歌词（LRC tab：行表 → 版本/格式切换） ============
const lyricLineRows = ref<LyricLineRow[]>([])
const lrcFormat = ref<'line' | 'enhanced' | 'verbatim' | 'ttml'>('line')
const lrcVersionKey = ref<string>('all')
// TTML 逐字/对唱 tab（声明在 watch 之前：immediate 回调首轮即会写入）
const ttmlVersions = ref<LyricVersionMeta[]>([])
const ttmlVersionId = ref('')

/** 行表加载：song 就绪且非隐藏（或已解锁）时拉取；解锁重拉（song 对象被整体替换） */
let linesLoadedFor = ''
watch(
  () => [song.value?.id, isHidden.value] as const,
  async ([id, hidden]) => {
    if (!id || hidden) {
      lyricLineRows.value = []
      linesLoadedFor = ''
      return
    }
    if (linesLoadedFor === id) return
    linesLoadedFor = id
    try {
      lyricLineRows.value = await loadLyricLines(id)
    } catch {
      lyricLineRows.value = [] // 行表读失败回退 lrc_text
    }
    // TTML 版本（对唱/逐字 tab）：与行表同生命周期（隐藏歌解锁后重拉）
    try {
      const metas = await loadLyricVersionMetas(id, true)
      ttmlVersions.value = metas.filter(v => v.format === 'ttml' && v.ttml_text)
      ttmlVersionId.value = ttmlVersions.value[0]?.id || ''
      // 白板歌（ttml-hub 导入）无文本歌词正文 → 默认展示 TTML tab
      if (ttmlVersions.value.length && !routeHasTab(route.query.tab as string) && !song.value?.lyrics_text && !song.value?.lrc_text) {
        activeTab.value = 'ttml'
      }
    } catch {
      ttmlVersions.value = []
    }
  },
  { immediate: true },
)

// ============ TTML 逐字/对唱视图 ============
const selectedTtml = computed(() => ttmlVersions.value.find(v => v.id === ttmlVersionId.value) || null)

/** 结构化解析（展示容错版：解析不出整体降级为提示，不丢数据） */
const ttmlStructure = computed<TtmlStructure | null>(() => {
  const text = selectedTtml.value?.ttml_text
  if (!text) return null
  const st = parseTtmlStructure(text)
  return st.lines.length ? st : null
})

/** 署名：版本自带署名 > 贡献者署名（ttml-hub 来源署名由 TTML 视图顶部 info 条承担，不重复显示） */
const ttmlCredit = computed(() => {
  const v = selectedTtml.value
  if (!v) return ''
  if (v.source_credit) return v.source_credit
  if (v.source === 'ttml-hub') return ''
  return songCredit.value
})

function ttmlVersionLabel(v: LyricVersionMeta): string {
  const src = v.source === 'ttml-hub' ? 'TTML Hub' : v.source === 'user' ? '投稿' : v.source
  const langs = (v.langs || []).map(langLabel).join('/')
  return langs ? `${src} · ${langs}` : src
}

/** 渲染分组：同 begin 的跨语言行合并为一组（第 1 行主歌词，其余作翻译随行） */
interface TtmlGroup { line: TtmlRenderLine; translations: TtmlRenderLine[] }
const ttmlGroups = computed<TtmlGroup[]>(() => {
  const st = ttmlStructure.value
  if (!st) return []
  const groups: TtmlGroup[] = []
  const beginIndex = new Map<number, number>()
  for (const l of st.lines) {
    const gi = l.begin != null ? beginIndex.get(l.begin) : undefined
    if (gi != null && groups[gi].line.lang !== l.lang && l.lang !== null) {
      groups[gi].translations.push(l)
    } else {
      if (l.begin != null && !beginIndex.has(l.begin)) beginIndex.set(l.begin, groups.length)
      groups.push({ line: l, translations: [] })
    }
  }
  return groups
})

/** 声部 → 左右分列（按首次出现顺序：第 1 声部居左、第 2 居右、其余/无声部居中） */
const ttmlAgentSides = computed(() => {
  const st = ttmlStructure.value
  const m = new Map<string, 'left' | 'right'>()
  if (!st?.hasAgent) return m
  for (const l of st.lines) {
    if (l.agent && !m.has(l.agent)) m.set(l.agent, m.size === 0 ? 'left' : 'right')
  }
  return m
})

function ttmlGroupAlign(g: TtmlGroup): string {
  const side = g.line.agent ? ttmlAgentSides.value.get(g.line.agent) : undefined
  if (side === 'left') return 'items-start text-left self-start w-4/5'
  if (side === 'right') return 'items-end text-right self-end w-4/5'
  return 'items-center text-center self-center w-full'
}

/** 行表 → 版本列表（每个 (lang,kind) 一个版本） */
const lyricVersions = computed<LyricVersion[]>(() => groupVersions(lyricLineRows.value))

/** 是否有词级时间（无则增强逐字/逐字格式无从渲染，禁用选项） */
const hasWordTiming = computed(() => rowsHaveWordTags(lyricLineRows.value))
watch(hasWordTiming, ok => {
  if (!ok && (lrcFormat.value === 'enhanced' || lrcFormat.value === 'verbatim')) lrcFormat.value = 'line'
})

/** 选中版本（下拉）：all = 全部混合；单选译文时补齐原文公共行（完整可独立渲染） */
const selectedVersions = computed<LyricVersion[]>(() => {
  const vs = lyricVersions.value
  if (lrcVersionKey.value === 'all') return vs
  const sel = vs.filter(v => `${v.lang}|${v.kind}` === lrcVersionKey.value)
  if (sel.length === 1 && sel[0].kind !== 'original') {
    const orig = vs.find(v => v.kind === 'original')
    if (orig) {
      const [, filled] = fillCommonRows([orig, sel[0]])
      return [filled]
    }
  }
  return sel
})

/** LRC tab 展示文本：行表优先，格式/版本可选；行表为空回退 lrc_text 原文 */
const lrcText = computed<string>(() => {
  const vs = selectedVersions.value
  if (!vs.length) return song.value?.lrc_text || ''
  if (lrcFormat.value === 'ttml') {
    return versionsToTtml(vs, songCredit.value)
  }
  return composeMixedLrc(vs, lrcFormat.value)
})

/** 署名（TTML 超界 <p> 用） */
const songCredit = computed(() =>
  contributor.value ? `本歌词来自于:${contributor.value.name}@lrcshare.com` : '本歌词来自于:lrcshare.com',
)

function copyCurrentLrc() {
  if (!lrcText.value) return
  copyText(lrcText.value).then(() => ElMessage.success('歌词已复制到剪贴板！'))
}

/** TTML 视图悬浮复制：当前选中版本的 TTML 原文 */
function copyCurrentTtml() {
  const t = selectedTtml.value?.ttml_text
  if (!t) return
  copyText(t).then(() => ElMessage.success('TTML 已复制到剪贴板！'))
}

// ============ 操作 ============
const showReward = ref(false)

function shareSong() {
  copyText(window.location.href).then(() => ElMessage.success('链接已复制到剪贴板！'))
}
</script>

<style scoped>
.gradient-header {
  background: linear-gradient(135deg, #1e1b4b 0%, #7c3aed 50%, #ec4899 100%);
}

/* YouTube 悬浮小窗：容器 fixed 到右下角（iframe 不卸载，播放不中断） */
.video-mini {
  position: fixed;
  right: 1.25rem;
  bottom: 1.25rem;
  width: min(20rem, calc(100vw - 2.5rem));
  height: auto;
  aspect-ratio: 16 / 9;
  z-index: 60;
  border-radius: 0.75rem;
  overflow: hidden;
  background: #000;
  box-shadow: 0 12px 40px -10px rgb(0 0 0 / 0.4);
  animation: mini-pop-in 0.25s ease-out;
}
@keyframes mini-pop-in {
  from { opacity: 0; transform: translateY(10px) scale(0.97); }
  to { opacity: 1; transform: none; }
}
/* LRC tab 代码框：等宽紧凑 + 最大高度内滚动 */
.lyric-code {
  max-height: 70vh;
  overflow-y: auto;
  background: #fafafa;
  border: 1px solid #f3f4f6;
  border-radius: 0.5rem;
  padding: 1rem;
  margin: 0;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  line-height: 1.7;
  tabular-nums: normal;
}
.lyric-code::-webkit-scrollbar { width: 6px; }
.lyric-code::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 3px; }
.tab-btn { transition: all 0.2s; }
.tab-active { color: #ec4899; border-bottom: 2px solid #ec4899; }
.tab-inactive { color: #9ca3af; border-bottom: 2px solid transparent; }
/* 格式下拉禁用项：原生 option:disabled 样式太弱，加明显灰态 + 删除线 */
.format-select option:disabled {
  color: #c0c4cc;
  background: #f5f5f5;
  text-decoration: line-through;
}
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
