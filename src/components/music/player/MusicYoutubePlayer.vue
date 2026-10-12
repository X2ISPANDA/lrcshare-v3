<script setup lang="ts">
/**
 * YouTube adapter（Google 官方 IFrame Player API）
 *
 * 能力：播放/暂停/跳转/音量完全可控、进度可读；单曲播完发 ended → 自动联播。
 *
 * 专辑（播放列表）模式：
 *   iframe 直接以 videoseries?list= 加载整张列表，初始 index 由曲目快照定位；
 *   播放器内部自动连播，曲目切换时经 trackchange 把新下标同步给 store（不重建组件）；
 *   整张列表播完才发 ended，Dock 切到队列里的下一条分享。
 *   手动切歌走 nextVideo/previousVideo（controls.next/prev，仅专辑提供）。
 *
 * 153 播放受限修复：全站 index.html 为 B站图床防盗链设了 referrer no-referrer，
 * 导致 YouTube 返回 153。这里 iframe 显式 referrerpolicy="strict-origin-when-cross-origin"
 * 覆盖全站策略，同时使用 youtube-nocookie 域名。
 *
 * 自动播放：onReady 后立即 playVideo()，1.5s 后仍非播放/缓冲则发 blocked，
 * 由 Dock 高亮播放键等听众点击；不做静音自动播放绕过（产品决策）。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { loadYouTubeApi } from '@/lib/musicPlayerApi'
import type { MusicShare } from '@/lib/types'
import type { PlayerAdapterEmits, PlayerControls } from './types'

defineOptions({ name: 'MusicYoutubePlayer' })

const props = defineProps<{
  share: MusicShare
  /** 专辑内当前曲目；单曲为 null */
  track?: import('@/lib/musicPlatforms').MusicTrack | null
  /** 专辑内当前曲目下标（0 基），单曲为 0 */
  trackIndex?: number
  autoplay: boolean
}>()
const emit = defineEmits<PlayerAdapterEmits>()

/** 自建 iframe（带 referrerpolicy 修 153），再交给 YT API 接管 */
const iframeEl = ref<HTMLIFrameElement | null>(null)
let player: any = null
let progressTimer: ReturnType<typeof setInterval> | null = null
let destroyed = false
let controlsSent = false
let endedSent = false
/** 列表末尾视频播完后的「判定为整张结束」延迟句柄（内部联播会抢先进入下一曲而取消它） */
let endOfListTimer: ReturnType<typeof setTimeout> | null = null
/** 最近一次上报过的视频 ID，用于识别内部换曲 */
let lastVideoId = ''

const isAlbum = () => props.share.media_type === 'album'

/**
 * 初始 iframe src（一次性定格）：单曲 embed/<id>；专辑 videoseries?list=&index=（1 基）。
 * 必须是组件挂载时计算一次的常量并直接绑定——内部联播换曲只调 nextVideo()，
 * 若 src 随 trackIndex 重算，Vue 会 patch iframe 的 src 触发整框重载，
 * YT API 与播放会话随即失联（表现为换曲后状态事件全部中断）。
 */
function buildInitialSrc(): string {
  const autoplay = props.autoplay ? '&autoplay=1' : ''
  if (isAlbum()) {
    const index1 = Math.max(1, (props.trackIndex ?? 0) + 1)
    return (
      'https://www.youtube-nocookie.com/embed/videoseries' +
      `?enablejsapi=1&playsinline=1&rel=0&list=${encodeURIComponent(props.share.platform_id)}&index=${index1}${autoplay}`
    )
  }
  return (
    'https://www.youtube-nocookie.com/embed/' +
    `${encodeURIComponent(props.share.platform_id)}?enablejsapi=1&playsinline=1&rel=0${autoplay}`
  )
}
/** 挂载时定格，此后不再变化，避免 iframe 被重新加载 */
const initialSrc = buildInitialSrc()

function stopTimer() {
  if (progressTimer) {
    clearInterval(progressTimer)
    progressTimer = null
  }
}
function clearEndOfList() {
  if (endOfListTimer) {
    clearTimeout(endOfListTimer)
    endOfListTimer = null
  }
}

function pushProgress() {
  try {
    const duration = Number(player.getDuration?.() || 0)
    const position = Number(player.getCurrentTime?.() || 0)
    if (duration > 0) emit('progress', { position, duration })
  } catch {
    /* 组件卸载竞态时忽略 */
  }
}

/** 播放态：同步实时曲名；专辑模式识别内部换曲 → trackchange */
function syncPlayingTrack() {
  try {
    const data = player.getVideoData?.() || {}
    if (data.video_id && data.video_id !== lastVideoId) {
      lastVideoId = data.video_id
      emit('meta', { title: data.title || '', artist: data.author || '' })
      if (isAlbum()) {
        let idx = -1
        try {
          idx = Number(player.getPlaylistIndex?.())
        } catch {
          idx = -1
        }
        // 初始曲目也会进这里：下标与传入一致时仍同步一次也无妨，store 幂等处理
        if (Number.isFinite(idx) && idx >= 0) {
          emit('trackchange', { index: idx, trackId: data.video_id })
        }
      }
    }
  } catch {
    /* 忽略竞态 */
  }
}

/**
 * 队列面板点击专辑内其他曲目 → 播放器内定位（不重建 iframe）。
 * 必须对比当前播放下标：合辑内部联播时 trackchange 也会把 trackIndex 同步回来，
 * 下标相同就跳过，否则 playVideoAt 会把正在播的曲目重播一遍。
 */
watch(
  () => props.trackIndex,
  (ni) => {
    if (!player || !isAlbum() || ni == null) return
    try {
      const cur = Number(player.getPlaylistIndex?.())
      if (Number.isFinite(cur) && cur === ni) return
      player.playVideoAt?.(ni)
    } catch {
      /* 忽略竞态 */
    }
  },
)

onMounted(() => {
  loadYouTubeApi()
    .then((YT) => {
      if (destroyed || !iframeEl.value) return
      player = new YT.Player(iframeEl.value, {
        events: {
          onReady: () => {
            emit('ready')
            const controls: PlayerControls = {
              isPlaying: () => {
                try {
                  return player?.getPlayerState?.() === 1
                } catch {
                  return false
                }
              },
              play: () => {
                try {
                  player?.playVideo?.()
                } catch {
                  /* 忽略竞态 */
                }
              },
              pause: () => {
                try {
                  player?.pauseVideo?.()
                } catch {
                  /* 忽略竞态 */
                }
              },
              toggle: () => {
                try {
                  if (player.getPlayerState() === 1) player.pauseVideo()
                  else player.playVideo()
                } catch {
                  /* 忽略竞态 */
                }
              },
              seek: (seconds: number) => {
                try {
                  player?.seekTo?.(seconds, true)
                  endedSent = false
                  pushProgress()
                } catch {
                  /* 忽略竞态 */
                }
              },
              setVolume: (v: number) => {
                try {
                  player?.setVolume?.(Math.round(Math.min(1, Math.max(0, v)) * 100))
                } catch {
                  /* 忽略竞态 */
                }
              },
              // 仅专辑提供内部切歌；单曲的 next/prev 缺省，Dock 回退队列切换
              ...(isAlbum()
                ? {
                    next: () => {
                      try {
                        player?.nextVideo?.()
                      } catch {
                        /* 忽略竞态 */
                      }
                    },
                    prev: () => {
                      try {
                        player?.previousVideo?.()
                      } catch {
                        /* 忽略竞态 */
                      }
                    },
                  }
                : {}),
            }
            if (!controlsSent) {
              controlsSent = true
              emit('controls', controls)
            }
            if (props.autoplay) {
              try {
                // OLAK 官方专辑列表对 src 的 index 参数支持不稳定（实测会忽略并从第一首播），
                // 专辑非首曲必须在 ready 后用 playVideoAt 显式定位（该方法自带开播语义）
                const startIdx = props.trackIndex ?? 0
                if (isAlbum() && startIdx > 0) player.playVideoAt(startIdx)
                else player.playVideo()
              } catch {
                emit('blocked')
                return
              }
              // 无手势时 Chrome 不会真正开播也不抛错：延迟检查状态判定拦截
              setTimeout(() => {
                if (destroyed) return
                try {
                  const state = player.getPlayerState()
                  // 1=播放中 3=缓冲中 视为已成功起播
                  if (state !== 1 && state !== 3) emit('blocked')
                } catch {
                  /* 忽略竞态 */
                }
              }, 1500)
            }
          },
          onStateChange: (e: { data: number }) => {
            // 0=结束 1=播放 2=暂停 3=缓冲 5=已就位
            if (e.data === 0) {
              stopTimer()
              clearEndOfList()
              if (isAlbum()) {
                // 列表内一曲结束后播放器会自动接下一首（状态很快变 1）；
                // 延迟判定：若 800ms 内进入了新曲目则为内部联播，否则是整张列表结束
                endOfListTimer = setTimeout(() => {
                  if (destroyed) return
                  try {
                    const state = player.getPlayerState?.()
                    if (state === 0 || state === 2) {
                      if (!endedSent) {
                        endedSent = true
                        emit('ended')
                      }
                    }
                  } catch {
                    /* 忽略竞态 */
                  }
                }, 800)
              } else if (!endedSent) {
                endedSent = true
                emit('ended')
              }
            } else if (e.data === 1) {
              endedSent = false
              clearEndOfList()
              syncPlayingTrack()
              if (!progressTimer) {
                pushProgress()
                progressTimer = setInterval(pushProgress, 500)
              }
            } else if (e.data === 2) {
              stopTimer()
              pushProgress()
            }
          },
          onError: () => {
            // 100=视频不存在/私有；101/150=禁止嵌入；153=播放受限（已用 referrerpolicy 修复）
            emit('error', '该 YouTube 视频无法在站内播放（可能被限制嵌入或已下架），可点右上角在原平台打开')
          },
        },
      })
    })
    .catch((err: Error) => emit('error', err.message))
})

onBeforeUnmount(() => {
  destroyed = true
  stopTimer()
  clearEndOfList()
  try {
    player?.destroy?.()
  } catch {
    /* 忽略竞态 */
  }
  player = null
})
</script>

<template>
  <div class="mp-yt-wrap">
    <iframe
      ref="iframeEl"
      class="mp-yt-frame"
      title="YouTube 播放器"
      :src="initialSrc"
      referrerpolicy="strict-origin-when-cross-origin"
      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
      allowfullscreen
    ></iframe>
  </div>
</template>

<style scoped>
.mp-yt-wrap {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 12px;
  overflow: hidden;
  background: #000;
}
.mp-yt-frame {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}
</style>
