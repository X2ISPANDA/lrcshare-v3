<script setup lang="ts">
/**
 * 网易云 adapter（统一原生 <audio> 内核）
 *
 * 链路：挂载后调用 Netlify 函数 music-stream 实时换取 mp3 直链（带时效，不入库），
 * 交给原生 <audio> 播放。能力与官方 JS API 两家完全一致：
 *   play/pause/seek/setVolume 全可控、timeupdate 进度、ended 播完事件 → 自动联播。
 *
 * 自动播放：audio.play() 返回 Promise，被浏览器拦截（无用户手势）时 reject，
 * 发 blocked 由 Dock 高亮播放键等待点击（不做静音绕过）。
 *
 * 取链失败（会员/版权曲、上游超时）发 error，Dock 展示中文原因。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { api } from '@/lib/api'
import type { MusicPlatformKey } from '@/lib/musicPlatforms'
import type { PlayerAdapterEmits, PlayerControls } from './types'

defineOptions({ name: 'MusicAudioPlayer' })

const props = defineProps<{
  share: import('@/lib/types').MusicShare
  track?: import('@/lib/musicPlatforms').MusicTrack | null
  autoplay: boolean
}>()
const emit = defineEmits<PlayerAdapterEmits>()

const audioEl = ref<HTMLAudioElement | null>(null)
const loading = ref(true)
const loadError = ref('')
let destroyed = false
let controlsSent = false
let endedSent = false
/** 当前直链对应的曲目 ID，防止切歌竞态里旧请求覆盖新曲目 */
let reqToken = 0

/** 实际要播放的平台曲目 ID：专辑内曲目取 track.id，单曲取 share.platform_id */
function targetTrackId(): string {
  return props.track?.id || props.share.platform_id
}

/** 组装并上抛控制句柄（三家 adapter 契约一致） */
function sendControls() {
  if (controlsSent || !audioEl.value) return
  controlsSent = true
  const audio = audioEl.value
  const controls: PlayerControls = {
    isPlaying: () => {
      try {
        return !audio.paused && !audio.ended
      } catch {
        return false
      }
    },
    play: () => {
      audio.play().catch(() => emit('blocked'))
    },
    pause: () => audio.pause(),
    toggle: () => {
      if (audio.paused) audio.play().catch(() => emit('blocked'))
      else audio.pause()
    },
    seek: (seconds: number) => {
      try {
        audio.currentTime = Math.max(0, seconds)
        endedSent = false
      } catch {
        /* 忽略竞态 */
      }
    },
    setVolume: (v: number) => {
      audio.volume = Math.min(1, Math.max(0, v))
    },
  }
  emit('controls', controls)
}

/** 换曲目（组件挂载与 track 变化时；Stage 用 :key 整体重建，这里属双保险） */
async function loadAndPlay() {
  const token = ++reqToken
  loading.value = true
  loadError.value = ''
  const platform: MusicPlatformKey = props.share.platform as MusicPlatformKey
  const id = targetTrackId()
  try {
    // trial=true 表示会员曲试听片段：按既定产品决策，听众端不出现「试听」字样，
    // 只正常播放该直链，片段结束后 <audio> ended 自动联播下一首
    const { url } = await api.getMusicStreamUrl(platform, id)
    if (destroyed || token !== reqToken || !audioEl.value) return
    audioEl.value.src = url
    audioEl.value.load()
    sendControls()
    emit('ready')
    loading.value = false
    if (props.autoplay) {
      try {
        await audioEl.value.play()
      } catch {
        // 无用户手势被拦截：等听众点 Dock 播放键
        emit('blocked')
      }
    }
  } catch (e) {
    if (destroyed || token !== reqToken) return
    loading.value = false
    loadError.value = e instanceof Error ? e.message : '播放地址获取失败'
    emit('error', loadError.value)
  }
}

function onTime() {
  const a = audioEl.value
  if (a && Number.isFinite(a.duration) && a.duration > 0) {
    emit('progress', { position: a.currentTime, duration: a.duration })
  }
}
function onPlay() {
  endedSent = false
}
function onEnded() {
  if (endedSent) return
  endedSent = true
  emit('ended')
}
function onAudioError() {
  // 直链过期 / 网络断流等（取链阶段的错误已在 loadAndPlay 处理）
  if (!loading.value) emit('error', '音频播放失败，可能是链接已过期，切下一首或稍后重试')
}

onMounted(loadAndPlay)
watch(
  () => props.track?.id,
  () => loadAndPlay(),
)

onBeforeUnmount(() => {
  destroyed = true
  reqToken++
  if (audioEl.value) {
    audioEl.value.removeAttribute('src')
    audioEl.value.load()
  }
})
</script>

<template>
  <div class="mpa-wrap">
    <!-- 原生音频条：Dock 展开时露出官方样式控件，收起时容器 1px 裁切仅出声 -->
    <!-- 不加 crossorigin：仅普通播放不需要 CORS，避免部分 CDN 未返回跨域头时反而取不到音频 -->
    <audio
      ref="audioEl"
      class="mpa-audio"
      controls
      preload="auto"
      @timeupdate="onTime"
      @loadedmetadata="onTime"
      @play="onPlay"
      @ended="onEnded"
      @error="onAudioError"
    ></audio>
    <div v-if="loading" class="mpa-hint">正在获取播放地址…</div>
    <div v-else-if="loadError" class="mpa-hint mpa-hint--error">{{ loadError }}</div>
  </div>
</template>

<style scoped>
.mpa-wrap {
  width: 100%;
  min-height: 54px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, #1f2937, #111827);
  border-radius: 12px;
  padding: 8px 12px;
}
.mpa-audio {
  width: 100%;
  height: 38px;
  /* 深色底配原生控件，与 Dock 粉紫主题协调 */
  filter: invert(0.92) hue-rotate(180deg) satur(0.7);
}
.mpa-hint {
  font-size: 12px;
  color: #d1d5db;
}
.mpa-hint--error {
  color: #fca5a5;
}
</style>
