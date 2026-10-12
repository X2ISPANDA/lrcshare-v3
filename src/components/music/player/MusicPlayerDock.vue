<script setup lang="ts">
/**
 * 全局浮动播放器 Dock（前台常驻，DefaultLayout 挂载；SPA 跨页不卸载 → 跨页保活）
 *
 * APlayer 风格皮肤（阶段 C）：
 * - 收起态：左下角圆形悬浮球（封面旋转），点击展开卡片；
 * - 展开态：粉白卡片，圆形旋转封面 + 曲名/艺人 + 进度条 + 上一首/播放/下一首 +
 *   音量条（仅原生 audio / YouTube 支持；SoundCloud Widget 无音量 API 则隐藏）+
 *   播放画面开关（YouTube/SoundCloud）+ 队列面板 + 收起/关闭；
 * - 队列面板：卡片向上弹出，单曲/专辑曲目扁平排列，当前曲目高亮，点击任意项切歌，
 *   合辑型平台（YT 列表 / SC sets）由 adapter watch trackIndex 内部定位不重建。
 *
 * 舞台（adapter 本体）：
 * - 收起画面时 1px 裁切但保持渲染（继续出声，不用 display:none，避免浏览器暂停媒体）；
 * - 网易云为纯音频，永远不需要显示舞台；YouTube/SoundCloud 由「播放画面」开关控制。
 *
 * 联播：
 * - 网易云：分曲队列项，adapter ended → 队列 next（专辑逐首重建音频条）；
 * - YouTube 合辑 / SoundCloud sets：播放器内部连播，trackchange 仅同步队列高亮，
 *   整张结束才 ended → next 到下一条分享。
 */
import { computed, nextTick, ref, watch } from 'vue'
import { getMusicPlatform } from '@/lib/musicPlatforms'
import { useMusicPlayerStore } from '@/stores/musicPlayer'
import { fetchMusicLyric, findActiveLineIndex } from '@/lib/musicLyric'
import type { MusicLyric } from '@/lib/musicLyric'
import type { PlayerControls, PlayerProgress, PlayerTrackMeta } from './types'
import MusicPlayerStage from './MusicPlayerStage.vue'
import AppIcon from '@/components/common/AppIcon.vue'
import { LOGO_URL } from '@/lib/constants'

defineOptions({ name: 'MusicPlayerDock' })

const player = useMusicPlayerStore()

/** 当前播放项（分享行 + 专辑内曲目） */
const item = computed(() => player.current)
const share = computed(() => item.value?.share || null)
const track = computed(() => item.value?.track || null)
const cfg = computed(() => (share.value ? getMusicPlatform(share.value.platform) : null))

/** 卡片是否展开（false=左下角悬浮球） */
const dockOpen = ref(false)
/** YouTube / SoundCloud 的播放画面是否在卡片内显示 */
const stageOpen = ref(false)
/** 队列面板是否从卡片上方展开 */
const listOpen = ref(false)
/**
 * 歌词浮动面板是否从卡片上方展开（与播放队列同形态、互斥：
 * 打开一个自动收起另一个；歌词仅网易云曲目可开）。
 */
const lyricsOpen = ref(false)

const controls = ref<PlayerControls | null>(null)
const isPlaying = ref(false)
const blocked = ref(false)
const errorMsg = ref('')
const progress = ref<PlayerProgress>({ position: 0, duration: 0 })
/** adapter 播放中上报的实时曲名（YouTube 合辑快照无曲名时覆盖展示） */
const liveMeta = ref<PlayerTrackMeta | null>(null)
/** 进度条拖拽中的内部值（null=未拖拽，跟随上报进度） */
const seeking = ref<number | null>(null)
const autoplayPref = ref(player.isAutoplayEnabled())

/* ---- 音量（持久化；SoundCloud Widget 无音量接口，其 adapter 不提供 setVolume） ---- */
const VOLUME_KEY = 'lrcshare_music_volume'
/** 音量 0~1，默认满格；静音时记录 0 但保留恢复值 */
const volume = ref(1)
const muted = ref(false)
try {
  const saved = Number(localStorage.getItem(VOLUME_KEY))
  if (Number.isFinite(saved) && saved >= 0 && saved <= 1) volume.value = saved
  muted.value = volume.value === 0
} catch {
  /* localStorage 不可用时保持默认 */
}
/** 当前 adapter 是否支持音量控制（SC 整个音量组隐藏） */
const hasVolume = computed(() => typeof controls.value?.setVolume === 'function')

/**
 * 舞台重建键：
 * - 网易云（meting-audio）：每首曲目换一次时效直链，按曲目重建；
 * - YouTube / SoundCloud：同一分享复用同一播放器，专辑内部连播不重建。
 */
const stageKey = computed(() => {
  const s = share.value
  if (!s) return 'none'
  if (cfg.value?.playerKind === 'meting-audio') return `${s.id}:${track.value?.id || 'solo'}`
  return s.id
})

/**
 * 展开态舞台尺寸（卡片内嵌，克制高度）：
 * YouTube 16:9；SoundCloud 紧凑条；网易云纯音频永不展示舞台。
 */
const stageStyle = computed((): Record<string, string> => {
  const s = share.value
  if (!s || !cfg.value) return {}
  if (s.platform === 'youtube') return { aspectRatio: '16 / 9' }
  if (s.platform === 'soundcloud') return { height: '166px' }
  return { height: '86px' } // netease（仅 1px 裁切挂载用，不会显示）
})
/** 哪些平台的 adapter 有可视化播放画面（网易云只有声音） */
const canShowStage = computed(() => share.value?.platform !== 'netease')

const coverUrl = computed(() => track.value?.cover_url || share.value?.cover_url || LOGO_URL)

/** 展示曲名：专辑曲目优先，其次 adapter 实时曲名，最后分享行标题 */
const displayTitle = computed(() => {
  if (track.value?.title) return track.value.title
  if (liveMeta.value?.title) return liveMeta.value.title
  return share.value?.title || ''
})
/** 展示艺人：曲目快照艺人 > 实时上报 > 分享行艺人 */
const displayArtist = computed(() => {
  return track.value?.artist || liveMeta.value?.artist || share.value?.artist || ''
})

/** 专辑内曲目位置 / 总数（单曲不显示） */
const albumPos = computed(() => {
  const tracks = share.value?.tracks
  if (!tracks?.length) return null
  return { index: player.currentAlbumIndex + 1, total: tracks.length }
})

/** 秒 → m:ss / h:mm:ss */
function fmt(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0
  const s = Math.floor(sec % 60)
  const m = Math.floor((sec / 60) % 60)
  const h = Math.floor(sec / 3600)
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** 切歌 / 切曲目：重置临时状态（合辑内部换曲同样调用） */
function resetPlaybackState() {
  controls.value = null
  isPlaying.value = false
  blocked.value = false
  errorMsg.value = ''
  progress.value = { position: 0, duration: 0 }
  seeking.value = null
  liveMeta.value = null
}

/**
 * stageKey 变化（跨分享 / 网易云跨曲目）：整体重建。
 * 收起播放画面（不同分享的视频不自动顶开卡片）；卡片与队列面板保持原状，
 * 避免听众看队列时切歌被打断。
 */
watch(
  stageKey,
  () => {
    resetPlaybackState()
    stageOpen.value = false
  },
  { immediate: true },
)

function onControls(c: PlayerControls) {
  controls.value = c
  // adapter（重新）挂载后立即同步当前音量，重建音频条也不丢音量设置
  c.setVolume?.(muted.value ? 0 : volume.value)
}
function onProgress(v: PlayerProgress) {
  progress.value = v
  if (v.position > 0) isPlaying.value = controls.value?.isPlaying() ?? true
}
function onBlocked() {
  blocked.value = true
  isPlaying.value = false
}
function onError(msg: string) {
  errorMsg.value = msg
}
function onEnded() {
  isPlaying.value = false
  progress.value = { ...progress.value, position: progress.value.duration }
  // 整张/本曲结束：队列切下一项（三家均支持联播）
  player.onAdapterEnded()
}
function onMeta(v: PlayerTrackMeta) {
  liveMeta.value = v
}
/**
 * YouTube 合辑 / SoundCloud sets 内部联播换曲：仅同步队列下标，
 * Stage 因 :key 仍是 share.id 不会重建；重置进度与临时状态。
 * 注意：不清空 liveMeta——adapter 在同一换曲瞬间还会（或已）上报新曲 meta，
 * 清空会让 Dock 曲名回退成专辑名（跨分享时由 stageKey 的 watch 统一重置）。
 */
function onTrackChange(v: { index: number }) {
  const s = share.value
  if (!s) return
  player.syncAlbumTrack(s.id, v.index)
  isPlaying.value = false
  blocked.value = false
  errorMsg.value = ''
  progress.value = { position: 0, duration: 0 }
  seeking.value = null
}

function togglePlay() {
  if (!controls.value) return
  blocked.value = false
  // 点击产生用户手势，被拦的自动播放此时可以解锁
  controls.value.toggle()
  setTimeout(() => {
    isPlaying.value = controls.value?.isPlaying() ?? false
  }, 200)
}

function onSeekInput(e: Event) {
  seeking.value = Number((e.target as HTMLInputElement).value)
}
function onSeekChange(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  controls.value?.seek(v)
  progress.value = { ...progress.value, position: v }
  seeking.value = null
}

/** 音量条拖动：实时下发并持久化（解除静音态） */
function onVolumeInput(e: Event) {
  const v = Number((e.target as HTMLInputElement).value)
  volume.value = v
  muted.value = v === 0
  controls.value?.setVolume?.(v)
  try {
    localStorage.setItem(VOLUME_KEY, String(v))
  } catch {
    /* 忽略持久化失败 */
  }
}
/** 喇叭图标：静音 / 恢复（恢复到上次非零音量，首次为满格） */
function toggleMute() {
  if (!controls.value?.setVolume) return
  if (muted.value || volume.value === 0) {
    const restore = volume.value > 0 ? volume.value : 1
    volume.value = restore
    muted.value = false
    controls.value.setVolume(restore)
    try {
      localStorage.setItem(VOLUME_KEY, String(restore))
    } catch {
      /* 忽略 */
    }
  } else {
    muted.value = true
    controls.value.setVolume(0)
  }
}

/** 下一首：合辑内部还能切时优先播放器内切换，否则走队列 */
function nextTrack() {
  if (controls.value?.next && albumPos.value && albumPos.value.index < albumPos.value.total) {
    controls.value.next()
    return
  }
  player.next()
}

/** 播放模式按钮文案（点击即三态轮换） */
const modeTitle = computed(() => {
  switch (player.mode) {
    case 'single':
      return '单曲循环：当前曲目播完后重播（点击切换为随机播放）'
    case 'shuffle':
      return '随机播放：播完随机切到另一首，手动切歌也随机（点击切换为列表循环）'
    default:
      return '列表循环：按队列顺序循环（点击切换为单曲循环）'
  }
})
/** 上一首：合辑内非首曲走播放器 prev，否则走队列 */
function prevTrack() {
  if (controls.value?.prev && albumPos.value && albumPos.value.index > 1) {
    controls.value.prev()
    return
  }
  player.prev()
}

const progressValue = computed(() => seeking.value ?? progress.value.position)

function openDock() {
  dockOpen.value = true
}
function collapseToFab() {
  dockOpen.value = false
  listOpen.value = false
  lyricsOpen.value = false
  stageOpen.value = false
}
function toggleStage() {
  if (!canShowStage.value) return
  stageOpen.value = !stageOpen.value
}
function toggleList() {
  listOpen.value = !listOpen.value
  // 队列与歌词面板互斥，避免两块浮层重叠
  if (listOpen.value) lyricsOpen.value = false
}
/** 打开歌词浮层（单行歌词行点击 / 控制行「词」按钮共用） */
function openLyrics() {
  listOpen.value = false
  lyricsOpen.value = true
}
function toggleLyrics() {
  lyricsOpen.value = !lyricsOpen.value
  if (lyricsOpen.value) listOpen.value = false
}

/** 队列面板条目展示文本：专辑曲目用快照曲名/实时名，单曲用分享行标题 */
function queueItemTitle(i: number): string {
  const qi = player.queue[i]
  if (!qi) return ''
  if (qi.track?.title) return qi.track.title
  // YouTube 合辑快照不预取曲名：播放中的当前项用 adapter 实时上报名，
  // 其余显示「曲目 N」占位，避免整张专辑的条目都重复成专辑名
  if (qi.track) {
    if (qi.share.id === share.value?.id && liveMeta.value?.title && player.index === i) {
      return liveMeta.value.title
    }
    const n = qi.share.tracks?.findIndex(t => t.id === qi.track!.id)
    return `曲目 ${typeof n === 'number' && n >= 0 ? n + 1 : ''}`.trim()
  }
  return qi.share.title
}
function queueItemArtist(i: number): string {
  const qi = player.queue[i]
  if (!qi) return ''
  return qi.track?.artist || qi.share.artist || ''
}
function queueItemCover(i: number): string {
  const qi = player.queue[i]
  return qi?.track?.cover_url || qi?.share.cover_url || LOGO_URL
}

/** 点击队列条目：切到别的项走 store；点当前项则回到本曲开头 */
function playAt(i: number) {
  if (i === player.index) {
    controls.value?.seek(0)
    controls.value?.play()
    blocked.value = false
    isPlaying.value = true
    return
  }
  player.playQueueIndex(i)
}

/** 队列面板打开 / 切歌时，把当前项滚动到可视区 */
const listEl = ref<HTMLElement | null>(null)
watch(
  [listOpen, () => player.index],
  async ([open]) => {
    if (!open) return
    await nextTick()
    listEl.value?.querySelector('.mpd-li--active')?.scrollIntoView({ block: 'nearest' })
  },
)

function toggleAutoplayPref() {
  const next = !autoplayPref.value
  autoplayPref.value = next
  player.setAutoplayEnabled(next)
}

/**
 * 副行状态：错误 / 自动播放拦截时整行纯文本提示（tone 决定颜色）；
 * 正常播放时返回 null，模板改由 statusPrefix + 可点署名链接拼装。
 */
const statusBanner = computed<{ text: string; tone: 'error' | 'warn' } | null>(() => {
  if (errorMsg.value) return { text: errorMsg.value, tone: 'error' }
  if (blocked.value) return { text: '浏览器拦截了自动播放，点播放键即可开始', tone: 'warn' }
  return null
})
/** 正常态署名前的前缀：专辑位置 / 艺人（均可能为空） */
const statusPrefix = computed(() => {
  const parts: string[] = []
  if (albumPos.value) parts.push(`专辑第 ${albumPos.value.index}/${albumPos.value.total} 首`)
  if (displayArtist.value) parts.push(displayArtist.value)
  return parts.join(' · ')
})

/**
 * 重播脉冲：外部入口（首页推荐卡等）重播当前曲目时回到开头并确保出声。
 * 此时 adapter 未重建（stageKey 不变），controls 已就绪，直接 seek + 补 play。
 */
watch(
  () => player.replayNonce,
  n => {
    if (!n) return
    const c = controls.value
    if (!c) return
    blocked.value = false
    c.seek(0)
    progress.value = { ...progress.value, position: 0 }
    if (!c.isPlaying()) {
      c.toggle()
      setTimeout(() => {
        isPlaying.value = controls.value?.isPlaying() ?? true
      }, 200)
    }
  },
)

/* ===================== 网易云歌词（Dock 单行 + 独立歌词页） ===================== */

/** 歌词加载状态：idle=非网易云不展示；其余为加载/就绪/纯音乐/无词 */
type LyricStatus = 'idle' | 'loading' | 'ready' | 'instrumental' | 'none'
const lyricStatus = ref<LyricStatus>('idle')
const lyricData = ref<MusicLyric | null>(null)

/**
 * 当前播放曲目的歌词请求键：
 * 只做网易云（YouTube/SoundCloud 无歌词链路）；专辑内曲目用曲目快照 ID，单曲用 platform_id。
 */
const lyricKey = computed(() => {
  const s = share.value
  if (!s || s.platform !== 'netease') return ''
  return track.value?.id || s.platform_id || ''
})

/** 自增请求序号：切歌时让上一个进行中的歌词请求结果作废（防竞态） */
let lyricReqSeq = 0
/** 浮层首次定位用瞬时跳转（避免打开瞬间从第一行平滑掠过），之后跟随播放平滑滚动；切歌重置 */
let lyricFirstScroll = false
watch(
  lyricKey,
  async key => {
    const seq = ++lyricReqSeq
    lyricData.value = null
    // 切歌后重置浮层滚动定位标志；非网易云曲目歌词面板自动收起
    lyricFirstScroll = false
    if (!key) {
      lyricStatus.value = 'idle'
      lyricsOpen.value = false
      return
    }
    lyricStatus.value = 'loading'
    try {
      const data = await fetchMusicLyric('netease', key)
      // 等待期间已切歌：丢弃本次结果，避免旧歌歌词闪到新歌上
      if (seq !== lyricReqSeq) return
      lyricData.value = data
      if (data.instrumental) lyricStatus.value = 'instrumental'
      else if (data.lines.length) lyricStatus.value = 'ready'
      else lyricStatus.value = 'none'
    } catch {
      if (seq !== lyricReqSeq) return
      // 上游失败/无词：单行展示「暂无歌词」，不影响播放
      lyricStatus.value = 'none'
    }
  },
  { immediate: true },
)

/** 当前应高亮的歌词行下标（-1=前奏 / 无歌词） */
const activeLyricIndex = computed(() => {
  if (lyricStatus.value !== 'ready' || !lyricData.value) return -1
  return findActiveLineIndex(lyricData.value.lines, progress.value.position)
})
/** 单行歌词文本（前奏期间为空，模板显示前奏提示） */
const activeLyricText = computed(() => {
  if (lyricStatus.value !== 'ready' || !lyricData.value) return ''
  const idx = activeLyricIndex.value
  return idx >= 0 ? lyricData.value.lines[idx].text : ''
})

/* ---- 歌词浮动面板：当前句自动居中 + 点击任意句跳转 ---- */

const lyricEl = ref<HTMLElement | null>(null)

watch(
  [lyricsOpen, activeLyricIndex, lyricStatus],
  async ([open]) => {
    if (!open || lyricStatus.value !== 'ready') return
    await nextTick()
    const root = lyricEl.value
    const idx = activeLyricIndex.value
    if (!root || idx < 0) return
    const el = root.querySelectorAll<HTMLElement>('.mpd-lrc-line')[idx]
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: lyricFirstScroll ? 'smooth' : 'auto' })
    lyricFirstScroll = true
  },
  { immediate: true },
)

/** 点击某句歌词：跳到该时间；乐观更新本地进度，高亮立即跟随 */
function seekLyricLine(seconds: number) {
  controls.value?.seek(seconds)
  progress.value = { ...progress.value, position: seconds }
}
</script>

<template>
  <!-- 必须同时判 visible：关闭后即使 queue/current 仍保留，播放器也要立即卸载（停声） -->
  <div v-if="player.visible && share" class="mpd-root" role="region" aria-label="歌曲分享播放器">
    <!-- 舞台始终挂载（mini 态 1px 裁切继续发声）；仅卡片展开且打开画面时可见 -->
    <div
      class="mpd-stage-holder"
      :class="dockOpen && stageOpen && canShowStage ? 'is-visible' : 'is-hidden'"
      :style="dockOpen && stageOpen ? stageStyle : undefined"
      :aria-hidden="!dockOpen || !stageOpen"
    >
      <MusicPlayerStage
        :key="stageKey"
        :share="share"
        :track="track"
        :track-index="player.currentAlbumIndex"
        :autoplay="true"
        @controls="onControls"
        @progress="onProgress"
        @blocked="onBlocked"
        @error="onError"
        @ended="onEnded"
        @meta="onMeta"
        @trackchange="onTrackChange"
      />
    </div>

    <!-- ============ 展开卡片 ============ -->
    <div v-if="dockOpen" class="mpd-card">
      <!-- 队列面板：从卡片上方弹出 -->
      <div v-if="listOpen" ref="listEl" class="mpd-list">
        <div class="mpd-list-head">
          <span>播放队列</span>
          <span class="mpd-list-count">{{ player.queue.length }} 首</span>
        </div>
        <ul class="mpd-list-ul">
          <li
            v-for="(qi, i) in player.queue"
            :key="qi.share.id + ':' + (qi.track?.id || 'solo')"
            class="mpd-li"
            :class="{ 'mpd-li--active': i === player.index }"
            :title="queueItemTitle(i)"
            @click="playAt(i)"
          >
            <img :src="queueItemCover(i)" alt="" class="mpd-li-cover" loading="lazy" />
            <span class="mpd-li-text">
              <span class="mpd-li-title">{{ queueItemTitle(i) }}</span>
              <span class="mpd-li-artist">{{ queueItemArtist(i) }}</span>
            </span>
            <svg
              v-if="i === player.index"
              class="mpd-li-eq"
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M3 10v4h3l5 4V6L6 10zm13.5 2a4.5 4.5 0 0 0-2.5-4.03v8.05A4.5 4.5 0 0 0 16.5 12z" />
            </svg>
          </li>
        </ul>
      </div>

      <!-- 歌词浮层：与播放队列同形态（从卡片上方弹出），二者互斥；仅网易云曲目。
           网易云舞台永不显示，无需像队列那样处理舞台抬升偏移。 -->
      <div v-if="lyricsOpen" class="mpd-lrc">
        <div class="mpd-lrc-head">
          <span class="mpd-lrc-head-title">
            <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor" aria-hidden="true">
              <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3z" />
            </svg>
            歌词
          </span>
          <span class="mpd-lrc-head-song" :title="displayTitle">{{ displayTitle }}</span>
          <button type="button" class="mpd-lrc-close" title="收起歌词" @click="lyricsOpen = false">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
              <path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" />
            </svg>
          </button>
        </div>

        <div ref="lyricEl" class="mpd-lrc-body">
          <!-- 加载 / 纯音乐 / 无词：居中弱提示 -->
          <div v-if="lyricStatus === 'loading'" class="mpd-lrc-state">歌词加载中…</div>
          <div v-else-if="lyricStatus === 'instrumental'" class="mpd-lrc-state">🎹 纯音乐，请欣赏</div>
          <div v-else-if="lyricStatus === 'none'" class="mpd-lrc-state">📭 暂无歌词</div>

          <!-- 逐句歌词：当前句放大渐变色高亮居中，点任意句跳转播放进度 -->
          <template v-else>
            <div class="mpd-lrc-pad" aria-hidden="true"></div>
            <button
              v-for="(line, i) in lyricData?.lines || []"
              :key="i"
              type="button"
              class="mpd-lrc-line"
              :class="{ 'mpd-lrc-line--active': i === activeLyricIndex }"
              @click="seekLyricLine(line.time)"
            >
              <span class="mpd-lrc-text">{{ line.text }}</span>
              <span v-if="line.trans" class="mpd-lrc-trans">{{ line.trans }}</span>
            </button>
            <div class="mpd-lrc-pad" aria-hidden="true"></div>
          </template>
        </div>
      </div>

      <!-- 顶栏：平台/原链 + 进站自动播放偏好（保留既有开关） -->
      <div v-if="cfg" class="mpd-head">
        <span class="mpd-head-title">
          <AppIcon :name="share.platform" class="mpd-platform-icon" />
          {{ cfg.label }}
          <span v-if="share.media_type === 'album'" class="mpd-album-tag">专辑</span>
          <a :href="share.source_url" target="_blank" rel="noopener noreferrer" class="mpd-origin-link">
            原平台 ↗
          </a>
        </span>
        <button
          type="button"
          class="mpd-pref"
          :class="{ 'mpd-pref--off': !autoplayPref }"
          :title="autoplayPref ? '进站自动播放已开启，点击关闭' : '进站自动播放已关闭，点击开启'"
          @click="toggleAutoplayPref"
        >
          进站自动播放 · {{ autoplayPref ? '开' : '关' }}
        </button>
      </div>

      <!-- 信息行：旋转封面 + 曲名/状态 + 进度 -->
      <div class="mpd-main">
        <div
          class="mpd-disc"
          :class="{ 'mpd-disc--playing': isPlaying }"
          :title="isPlaying ? '暂停' : '播放'"
          @click="togglePlay"
        >
          <img :src="coverUrl" :alt="displayTitle" class="mpd-disc-img" />
          <span v-if="!isPlaying" class="mpd-disc-play">
            <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          </span>
        </div>

        <div class="mpd-info">
          <div class="mpd-title-row">
            <span class="mpd-title" :title="displayTitle">{{ displayTitle }}</span>
            <span v-if="progress.duration > 0" class="mpd-time">
              {{ fmt(progressValue) }} / {{ fmt(progress.duration) }}
            </span>
          </div>
          <div
            class="mpd-status"
            :class="statusBanner ? `mpd-status--${statusBanner.tone}` : 'mpd-status--muted'"
          >
            <!-- 错误 / 自动播放拦截：整行纯文本提示 -->
            <template v-if="statusBanner">{{ statusBanner.text }}</template>
            <!-- 正常态：前缀（专辑位置/艺人）+ 推荐人（已绑定账号可点进主页，否则昵称快照纯文本） -->
            <template v-else>
              <span v-if="statusPrefix">{{ statusPrefix }} · </span>
              <RouterLink
                v-if="share.contributor"
                :to="`/contributor/${share.contributor.id}`"
                class="mpd-status-link"
              >{{ share.contributor.name }} 分享</RouterLink>
              <span v-else>{{ share.submitter_name }} 分享</span>
            </template>
          </div>
          <!-- 网易云歌词单行：当前播放句实时高亮，点击从卡片上方展开完整歌词浮层（仅网易云渲染） -->
          <button
            v-if="lyricStatus !== 'idle'"
            type="button"
            class="mpd-lyric-line"
            :class="`mpd-lyric-line--${lyricStatus}`"
            title="查看完整歌词"
            @click="openLyrics"
          >
            <svg viewBox="0 0 24 24" width="11" height="11" fill="currentColor" class="mpd-lyric-ico" aria-hidden="true">
              <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3z" />
            </svg>
            <span class="mpd-lyric-text">
              <template v-if="lyricStatus === 'loading'">歌词加载中…</template>
              <template v-else-if="lyricStatus === 'instrumental'">纯音乐，请欣赏</template>
              <template v-else-if="lyricStatus === 'none'">暂无歌词</template>
              <template v-else>{{ activeLyricText || '前奏中…' }}</template>
            </span>
          </button>
          <input
            v-if="controls && progress.duration > 0"
            type="range"
            class="mpd-seek"
            min="0"
            :max="progress.duration"
            step="0.5"
            :value="progressValue"
            aria-label="播放进度"
            @input="onSeekInput"
            @change="onSeekChange"
          />
        </div>
      </div>

      <!-- 控制行 -->
      <div class="mpd-controls">
        <button type="button" class="mpd-btn" :disabled="!player.hasTracks" title="上一首" @click="prevTrack">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 6h2v12H6zM9.5 12l8.5 6V6z" /></svg>
        </button>
        <button
          type="button"
          class="mpd-btn mpd-btn--main"
          :class="{ 'mpd-btn--pulse': blocked }"
          :title="isPlaying ? '暂停' : '播放'"
          @click="togglePlay"
        >
          <svg v-if="!isPlaying" viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          <svg v-else viewBox="0 0 24 24" width="22" height="22" fill="currentColor"><path d="M7 5h4v14H7zM13 5h4v14h-4z" /></svg>
        </button>
        <button type="button" class="mpd-btn" :disabled="!player.hasTracks" title="下一首" @click="nextTrack">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M16 6h2v12h-2zM6 18l8.5-6L6 6z" /></svg>
        </button>
        <!-- 播放模式三态：列表循环（默认）/ 单曲循环 / 随机播放，选择持久化在 localStorage -->
        <button
          type="button"
          class="mpd-btn mpd-btn--ghost mpd-btn--mini mpd-btn--mode"
          :class="{ 'mpd-btn--active': player.mode === 'single' || player.mode === 'shuffle' }"
          :title="modeTitle"
          :aria-label="modeTitle"
          @click="player.cycleMode()"
        >
          <!-- 列表循环 -->
          <svg v-if="player.mode === 'list-loop'" viewBox="0 0 24 24" width="17" height="17" fill="currentColor">
            <path d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z" />
          </svg>
          <!-- 单曲循环：循环箭头 + 右下角 1 角标 -->
          <span v-else-if="player.mode === 'single'" class="mpd-mode-single">
            <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor">
              <path d="M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z" />
            </svg>
            <i class="mpd-mode-single__num">1</i>
          </span>
          <!-- 随机播放 -->
          <svg v-else viewBox="0 0 24 24" width="17" height="17" fill="currentColor">
            <path d="M10.59 9.17 5.41 4 4 5.41l5.17 5.17 1.42-1.41zM14.5 4l2.04 2.04L4 18.59 5.41 20 17.96 7.46 20 9.5V4h-5.5zm.33 9.41-1.41 1.41 3.13 3.13L14.5 18H20v-5.5l-2.04 2.04-3.13-3.13z" />
          </svg>
        </button>

        <!-- 音量：SoundCloud Widget 无音量 API，整组不渲染 -->
        <span v-if="hasVolume" class="mpd-vol">
          <button
            type="button"
            class="mpd-btn mpd-btn--ghost mpd-btn--mini"
            :title="muted || volume === 0 ? '取消静音' : '静音'"
            @click="toggleMute"
          >
            <svg v-if="!muted && volume > 0" viewBox="0 0 24 24" width="17" height="17" fill="currentColor">
              <path d="M3 10v4h3l5 4V6L6 10zm13.5 2a4.5 4.5 0 0 0-2.5-4.03v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z" />
            </svg>
            <svg v-else viewBox="0 0 24 24" width="17" height="17" fill="currentColor">
              <path d="M3 10v4h3l5 4V6L6 10zm12.59 2 2.7-2.71-1.41-1.41L14.18 10.6 11.47 7.88l-1.41 1.42 2.7 2.7-2.7 2.71 1.41 1.41 2.71-2.7 2.7 2.7 1.41-1.41z" />
            </svg>
          </button>
          <input
            type="range"
            class="mpd-vol-range"
            min="0"
            max="1"
            step="0.01"
            :value="muted ? 0 : volume"
            aria-label="音量"
            @input="onVolumeInput"
          />
        </span>

        <span class="mpd-spacer" />

        <!-- YouTube / SoundCloud 播放画面开关；网易云纯音频不显示 -->
        <button
          v-if="canShowStage"
          type="button"
          class="mpd-btn mpd-btn--ghost mpd-btn--mini"
          :class="{ 'mpd-btn--active': stageOpen }"
          :title="stageOpen ? '收起播放画面' : '展开播放画面'"
          @click="toggleStage"
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor">
            <path d="M4 6h16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zm6 3v6l5-3z" />
          </svg>
        </button>
        <button
          type="button"
          class="mpd-btn mpd-btn--ghost mpd-btn--mini"
          :class="{ 'mpd-btn--active': listOpen }"
          :title="listOpen ? '收起播放队列' : '展开播放队列'"
          @click="toggleList"
        >
          <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor">
            <path d="M3 5h12v2H3zm0 4h12v2H3zm0 4h8v2H3zm14.5-1.5L21 15l-3.5 3.5V16H15v-2h2.5zM3 17h8v2H3z" />
          </svg>
        </button>
        <!-- 完整歌词浮层入口：仅网易云（唯一有歌词链路的平台），位于播放队列按钮右侧 -->
        <button
          v-if="lyricStatus !== 'idle'"
          type="button"
          class="mpd-btn mpd-btn--ghost mpd-btn--mini"
          :class="{ 'mpd-btn--active': lyricsOpen }"
          :title="lyricsOpen ? '收起歌词' : '展开歌词'"
          @click="toggleLyrics"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path d="M4 5h16v2H4zm0 4h16v2H4zm0 4h10v2H4zm0 4h7v2H4z" />
          </svg>
        </button>
        <button type="button" class="mpd-btn mpd-btn--ghost mpd-btn--mini" title="收起为悬浮球" @click="collapseToFab">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor">
            <path d="M7.41 15.41 12 10.83l4.59 4.58L18 14l-6-6-6-6z" />
          </svg>
        </button>
        <button type="button" class="mpd-btn mpd-btn--ghost mpd-btn--mini" title="关闭播放器" @click="player.close()">
          <svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor"><path d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
        </button>
      </div>
    </div>

    <!-- ============ 收起态：左下悬浮球 ============ -->
    <button
      v-else
      type="button"
      class="mpd-fab"
      :class="{ 'mpd-fab--pulse': blocked }"
      :title="`${displayTitle}${displayArtist ? ' · ' + displayArtist : ''}（展开播放器）`"
      @click="openDock"
    >
      <span class="mpd-fab-ring" :class="{ 'mpd-fab-ring--playing': isPlaying }">
        <img :src="coverUrl" alt="" class="mpd-fab-img" />
      </span>
    </button>
  </div>
</template>

<style scoped>
.mpd-root {
  position: fixed;
  left: 12px;
  bottom: 12px;
  z-index: 40;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  pointer-events: none;
}
.mpd-root > * {
  pointer-events: auto;
}

/* ============ 舞台（adapter） ============ */
.mpd-stage-holder {
  width: min(340px, calc(100vw - 24px));
  background: #000;
  border-radius: 14px 14px 0 0;
  overflow: hidden;
  margin-bottom: -1px;
}
.mpd-stage-holder.is-visible {
  position: relative;
  opacity: 1;
  pointer-events: auto;
  border: 1px solid rgba(236, 72, 153, 0.25);
  border-bottom: none;
  box-shadow: 0 -6px 24px rgba(190, 100, 180, 0.18);
}
/* 收起态：1px 裁切但保持渲染，媒体继续发声（不用 display:none） */
.mpd-stage-holder.is-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  opacity: 0;
  pointer-events: none;
  overflow: hidden;
}

/* ============ 卡片 ============ */
.mpd-card {
  position: relative;
  width: min(340px, calc(100vw - 24px));
  background: rgba(255, 255, 255, 0.98);
  border: 1px solid rgba(236, 72, 153, 0.25);
  border-radius: 16px;
  box-shadow: 0 12px 40px rgba(190, 100, 180, 0.28);
  overflow: visible;
}
/* 舞台打开时卡片顶部与舞台拼成一体 */
.mpd-stage-holder.is-visible + .mpd-card {
  border-radius: 0 0 16px 16px;
}

/* ---- 队列面板 ---- */
.mpd-list {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 8px);
  background: rgba(255, 255, 255, 0.99);
  border: 1px solid rgba(236, 72, 153, 0.25);
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(190, 100, 180, 0.25);
  overflow: hidden;
}
.mpd-list-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 700;
  color: #be185d;
  background: linear-gradient(90deg, #fdf2f8, #faf5ff);
  border-bottom: 1px solid #fce7f3;
}
.mpd-list-count {
  font-weight: 400;
  color: #9ca3af;
}
/* 播放画面同时打开时，队列面板升到舞台上方（YT 16:9≈191px / SC 166px，取 200 折中） */
.mpd-stage-holder.is-visible ~ .mpd-card .mpd-list {
  bottom: calc(100% + 208px);
}
.mpd-list-ul {
  list-style: none;
  margin: 0;
  padding: 4px;
  max-height: 260px;
  overflow-y: auto;
}
.mpd-li {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 10px;
  border-radius: 10px;
  cursor: pointer;
  transition: background 0.15s;
}
.mpd-li:hover {
  background: #fdf2f8;
}
.mpd-li--active {
  background: linear-gradient(90deg, rgba(236, 72, 153, 0.1), rgba(168, 85, 247, 0.1));
}
.mpd-li-cover {
  width: 34px;
  height: 34px;
  border-radius: 8px;
  object-fit: cover;
  flex-shrink: 0;
  background: #fce7f3;
}
.mpd-li-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
}
.mpd-li-title {
  font-size: 12.5px;
  font-weight: 600;
  color: #1f2937;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mpd-li-artist {
  font-size: 11px;
  color: #9ca3af;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mpd-li--active .mpd-li-title {
  color: #be185d;
}
.mpd-li-eq {
  flex-shrink: 0;
  color: #ec4899;
}

/* ---- 顶栏 ---- */
.mpd-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 7px 12px 0;
  font-size: 12px;
  color: #6b7280;
}
.mpd-head-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}
.mpd-platform-icon {
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.mpd-album-tag {
  padding: 0 6px;
  border-radius: 999px;
  background: #ede9fe;
  color: #7c3aed;
  font-size: 11px;
}
.mpd-origin-link {
  color: #ec4899;
  white-space: nowrap;
}
.mpd-origin-link:hover {
  text-decoration: underline;
}
.mpd-pref {
  flex-shrink: 0;
  border: 1px solid #f9a8d4;
  background: #fff;
  color: #db2777;
  border-radius: 999px;
  padding: 2px 10px;
  font-size: 11px;
  cursor: pointer;
}
.mpd-pref--off {
  border-color: #d1d5db;
  color: #9ca3af;
}

/* ---- 信息行 ---- */
.mpd-main {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px 4px;
}
.mpd-disc {
  position: relative;
  width: 52px;
  height: 52px;
  flex-shrink: 0;
  border-radius: 999px;
  padding: 2px;
  cursor: pointer;
  background: conic-gradient(from 0deg, #ec4899, #a855f7, #ec4899);
  box-shadow: 0 4px 12px rgba(236, 72, 153, 0.3);
}
.mpd-disc-img {
  width: 100%;
  height: 100%;
  border-radius: 999px;
  object-fit: cover;
  background: #fce7f3;
  animation: mpd-spin 8s linear infinite;
  animation-play-state: paused;
}
.mpd-disc--playing .mpd-disc-img {
  animation-play-state: running;
}
/* 暂停时中央显示播放三角 */
.mpd-disc-play {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: rgba(0, 0, 0, 0.28);
  border-radius: 999px;
}
.mpd-info {
  flex: 1;
  min-width: 0;
}
.mpd-title-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
}
.mpd-title {
  font-size: 13.5px;
  font-weight: 700;
  color: #1f2937;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mpd-time {
  margin-left: auto;
  flex-shrink: 0;
  font-size: 11px;
  color: #9ca3af;
  font-variant-numeric: tabular-nums;
}
.mpd-status {
  font-size: 11px;
  margin-top: 2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mpd-status--muted {
  color: #9ca3af;
}
.mpd-status--warn {
  color: #d97706;
  font-weight: 600;
}
.mpd-status--error {
  color: #dc2626;
}
/* 推荐人链接：与副行同号但用深粉色提示可点，hover 下划线 */
.mpd-status-link {
  color: #db2777;
  text-decoration: none;
  cursor: pointer;
}
.mpd-status-link:hover {
  text-decoration: underline;
}
.mpd-seek {
  width: 100%;
  height: 4px;
  margin-top: 6px;
  accent-color: #ec4899;
  cursor: pointer;
}

/* ---- 歌词单行（歌手/推荐人行下方；点击从卡片上方展开歌词浮层） ---- */
.mpd-lyric-line {
  /* button 重置，保证与上一行文本基线对齐 */
  width: 100%;
  display: flex;
  align-items: center;
  gap: 4px;
  margin-top: 3px;
  padding: 0;
  border: 0;
  background: transparent;
  font-size: 11px;
  line-height: 1.4;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
}
.mpd-lyric-ico {
  flex-shrink: 0;
}
.mpd-lyric-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
/* 就绪：当前句深粉色，提示这是一行可点的活内容 */
.mpd-lyric-line--ready {
  color: #db2777;
  font-weight: 600;
}
.mpd-lyric-line--ready:hover .mpd-lyric-text {
  text-decoration: underline;
}
/* 加载 / 无词 / 纯音乐：灰色弱展示，不抢推荐人行的视觉 */
.mpd-lyric-line--loading,
.mpd-lyric-line--none,
.mpd-lyric-line--instrumental {
  color: #9ca3af;
  cursor: default;
}

/* ---- 歌词浮动面板（与 .mpd-list 同形态：从卡片上方弹出） ---- */
.mpd-lrc {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% + 8px);
  background: rgba(255, 255, 255, 0.99);
  border: 1px solid rgba(236, 72, 153, 0.25);
  border-radius: 14px;
  box-shadow: 0 12px 40px rgba(190, 100, 180, 0.25);
  overflow: hidden;
}
.mpd-lrc-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: linear-gradient(90deg, #fdf2f8, #faf5ff);
  border-bottom: 1px solid #fce7f3;
}
.mpd-lrc-head-title {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 700;
  color: #be185d;
  flex-shrink: 0;
}
.mpd-lrc-head-song {
  flex: 1;
  min-width: 0;
  font-size: 11.5px;
  color: #9ca3af;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.mpd-lrc-close {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #9ca3af;
  cursor: pointer;
}
.mpd-lrc-close:hover {
  background: #fce7f3;
  color: #db2777;
}
.mpd-lrc-body {
  /* 高度跟随视口：大屏最多 440px，小屏留出顶部操作空间 */
  height: min(56vh, 440px);
  overflow-y: auto;
  scroll-behavior: smooth;
  mask-image: linear-gradient(to bottom, transparent 0, #000 2.5rem, #000 calc(100% - 2.5rem), transparent 100%);
  -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 2.5rem, #000 calc(100% - 2.5rem), transparent 100%);
}
/* 上下留白：让首句/末句也能滚动到视觉中部（约为面板半高） */
.mpd-lrc-pad {
  height: 180px;
}
.mpd-lrc-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 2rem 1rem;
  font-size: 13px;
  color: #9ca3af;
  text-align: center;
}
.mpd-lrc-line {
  display: block;
  width: 100%;
  padding: 0.45rem 0.6rem;
  border: 0;
  background: transparent;
  text-align: center;
  cursor: pointer;
}
.mpd-lrc-text {
  display: block;
  font-size: 13.5px;
  line-height: 1.6;
  color: #9ca3af;
  transition: color 0.2s, font-size 0.2s;
}
.mpd-lrc-trans {
  display: block;
  margin-top: 2px;
  font-size: 11.5px;
  line-height: 1.5;
  color: #c4b5d0;
}
.mpd-lrc-line:hover .mpd-lrc-text {
  color: #db2777;
}
/* 当前句：放大 + 粉紫渐变文字 */
.mpd-lrc-line--active .mpd-lrc-text {
  font-size: 16px;
  font-weight: 700;
  background: linear-gradient(135deg, #ec4899, #a855f7);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.mpd-lrc-line--active .mpd-lrc-trans {
  color: #c084a8;
}

/* ---- 控制行 ---- */
.mpd-controls {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 10px 10px;
}
.mpd-spacer {
  flex: 1;
}
.mpd-btn {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: #be185d;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.mpd-btn:hover {
  background: #fce7f3;
}
.mpd-btn:disabled {
  color: #d1d5db;
  cursor: not-allowed;
  background: transparent;
}
.mpd-btn--main {
  width: 40px;
  height: 40px;
  color: #fff;
  background: linear-gradient(135deg, #ec4899, #a855f7);
  box-shadow: 0 4px 12px rgba(236, 72, 153, 0.35);
}
.mpd-btn--main:hover {
  background: linear-gradient(135deg, #db2777, #9333ea);
}
.mpd-btn--ghost {
  width: 28px;
  height: 28px;
  color: #9ca3af;
}
.mpd-btn--mini {
  width: 26px;
  height: 26px;
}
.mpd-btn--active {
  color: #db2777;
  background: #fce7f3;
}
/* 单曲循环图标：循环箭头上的 1 角标 */
.mpd-mode-single {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.mpd-mode-single__num {
  position: absolute;
  right: -3px;
  bottom: -2px;
  min-width: 10px;
  height: 10px;
  padding: 0 2px;
  border-radius: 5px;
  background: #db2777;
  color: #fff;
  font-size: 8px;
  font-style: normal;
  font-weight: 700;
  line-height: 10px;
  text-align: center;
}
/* 拦截自动播放时呼吸提示 */
.mpd-btn--pulse {
  animation: mpd-pulse 1.2s ease-in-out infinite;
}
@keyframes mpd-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(236, 72, 153, 0.5);
  }
  50% {
    box-shadow: 0 0 0 8px rgba(236, 72, 153, 0);
  }
}
@keyframes mpd-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

/* ---- 音量 ---- */
.mpd-vol {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: 2px;
}
.mpd-vol-range {
  width: 64px;
  height: 4px;
  accent-color: #ec4899;
  cursor: pointer;
}

/* ============ 收起态悬浮球 ============ */
.mpd-fab {
  border: 0;
  padding: 0;
  background: transparent;
  cursor: pointer;
  filter: drop-shadow(0 6px 16px rgba(190, 100, 180, 0.35));
}
.mpd-fab-ring {
  display: block;
  width: 56px;
  height: 56px;
  border-radius: 999px;
  padding: 2px;
  background: conic-gradient(from 0deg, #ec4899, #a855f7, #ec4899);
  transition: transform 0.2s;
}
.mpd-fab:hover .mpd-fab-ring {
  transform: scale(1.06);
}
.mpd-fab-img {
  width: 100%;
  height: 100%;
  border-radius: 999px;
  object-fit: cover;
  background: #fce7f3;
  animation: mpd-spin 8s linear infinite;
  animation-play-state: paused;
}
.mpd-fab-ring--playing .mpd-fab-img {
  animation-play-state: running;
}
.mpd-fab--pulse {
  animation: mpd-pulse 1.2s ease-in-out infinite;
  border-radius: 999px;
}

/* 窄屏：队列面板与卡片贴边更紧，音量条收短 */
@media (max-width: 380px) {
  .mpd-vol-range {
    width: 48px;
  }
}
</style>
