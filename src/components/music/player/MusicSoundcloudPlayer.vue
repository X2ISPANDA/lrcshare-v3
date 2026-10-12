<script setup lang="ts">
/**
 * SoundCloud adapter（官方 HTML5 Widget API）
 *
 * 能力：play/pause/seek 可控、PLAY_PROGRESS 进度、FINISH 播完事件 → 可自动联播。
 *
 * 专辑（/sets/ 合辑）模式：
 *   Widget 直接加载整个 sets，READY 后 skip(trackIndex) 定位首曲；
 *   Widget 内部自动顺序联播，每次 PLAY 经 getCurrentIndex 把新下标 trackchange
 *   同步给 store（不重建组件）；整张合辑 FINISH 才发 ended，Dock 切下一条分享。
 *   手动切歌 controls.next/prev = widget.next()/prev()（仅专辑提供）。
 *
 * 无手势被浏览器拦截时 READY 后 isPlaying=false，延迟二次确认后发 blocked。
 * 注意：Widget API 的时间单位是毫秒，这里统一换算成秒上抛。
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { loadSoundCloudApi } from '@/lib/musicPlayerApi'
import { getMusicPlatform } from '@/lib/musicPlatforms'
import type { MusicShare } from '@/lib/types'
import type { PlayerAdapterEmits, PlayerControls } from './types'

defineOptions({ name: 'MusicSoundcloudPlayer' })

const props = defineProps<{
  share: MusicShare
  /** 专辑内当前曲目；单曲为 null */
  track?: import('@/lib/musicPlatforms').MusicTrack | null
  /** 专辑内当前曲目下标（0 基），单曲为 0 */
  trackIndex?: number
  autoplay: boolean
}>()
const emit = defineEmits<PlayerAdapterEmits>()

const cfg = getMusicPlatform('soundcloud')!
const frameEl = ref<HTMLIFrameElement | null>(null)
let widget: any = null
let playing = false
let destroyed = false
let controlsSent = false
let endedSent = false
/** 最近一次上报的曲目下标，避免重复 trackchange */
let lastIndex = -1

const isAlbum = () => props.share.media_type === 'album'

function buildSrc() {
  // soundcloud 注册表必然提供 buildEmbed
  return cfg.buildEmbed!(
    {
      media_type: props.share.media_type,
      platform_id: props.share.platform_id,
      source_url: props.share.source_url,
    },
    { autoplay: props.autoplay },
  )
}
/**
 * src 在挂载时定格：sets 内部联播靠 widget.skip() 定位，绝不重新加载 iframe
 * （重载会让 Widget API 会话重建、状态事件中断）。
 */
const initialSrc = buildSrc()

/** 上报当前曲目：实时曲名/艺人 + 专辑内下标变化 */
function reportCurrentSound() {
  try {
    widget?.getCurrentSound?.((s: any) => {
      if (destroyed || !s) return
      emit('meta', { title: s.title || '', artist: s.user?.username || '' })
    })
    if (isAlbum()) {
      // 注意 Widget API 的方法名是 getCurrentSoundIndex（没有 getCurrentIndex）
      widget?.getCurrentSoundIndex?.((idx: number) => {
        if (destroyed || !Number.isFinite(idx) || idx === lastIndex) return
        // 单曲快照里 id 是曲目永久链接；这里下标足够 store 同步高亮
        lastIndex = idx
        emit('trackchange', { index: idx })
      })
    }
  } catch {
    /* 忽略竞态 */
  }
}

/**
 * 队列面板点击 sets 内其他曲目 → widget.skip 定位（不重建 iframe）。
 * 与 YT 同理：内部联播回流的 trackIndex 与当前下标相同，必须跳过避免重播。
 */
watch(
  () => props.trackIndex,
  (ni) => {
    if (!widget || !isAlbum() || ni == null) return
    try {
      widget.getCurrentSoundIndex?.((cur: number) => {
        if (destroyed || cur === ni) return
        widget.skip(ni)
      })
    } catch {
      /* 忽略竞态 */
    }
  },
)

onMounted(() => {
  loadSoundCloudApi()
    .then((SC) => {
      if (destroyed || !frameEl.value) return
      widget = SC.Widget(frameEl.value)
      const W = SC.Widget.Events

      widget.bind(W.READY, () => {
        emit('ready')
        const controls: PlayerControls = {
          isPlaying: () => playing,
          play: () => widget?.play(),
          pause: () => widget?.pause(),
          toggle: () => {
            if (playing) widget?.pause()
            else widget?.play()
          },
          seek: (seconds: number) => {
            widget?.seekTo(Math.max(0, seconds * 1000))
            endedSent = false
          },
          // SoundCloud Widget 无音量接口，音量控制交给其自带 UI
          ...(isAlbum()
            ? {
                // 合辑内部切歌；单曲缺省 next/prev，Dock 回退队列切换
                next: () => {
                  try {
                    widget?.next?.()
                  } catch {
                    /* 忽略竞态 */
                  }
                },
                prev: () => {
                  try {
                    widget?.prev?.()
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

        // 专辑定位到快照中的首曲（skip 在 READY 后调用；单曲无需定位）
        if (isAlbum() && props.trackIndex && props.trackIndex > 0) {
          try {
            widget.skip(props.trackIndex)
          } catch {
            /* 忽略竞态 */
          }
        }

        // 自动播放拦截判定：READY 后立刻查一次 + 1.5s 后复查（缓冲中可能误判）
        const checkPlaying = (label: string) => {
          widget?.isPlaying?.((v: boolean) => {
            if (destroyed) return
            if (!v && props.autoplay && label === 'retry') emit('blocked')
            if (v) playing = true
          })
        }
        if (props.autoplay) {
          setTimeout(() => checkPlaying('first'), 300)
          setTimeout(() => checkPlaying('retry'), 1500)
        }
      })

      widget.bind(W.PLAY, () => {
        playing = true
        endedSent = false
        reportCurrentSound()
      })
      widget.bind(W.PAUSE, () => {
        playing = false
      })
      // PLAY_PROGRESS 在播放中高频回调，节流由浏览器侧自行合并；这里直接取最新值
      widget.bind(W.PLAY_PROGRESS, (e: { currentPosition: number }) => {
        if (destroyed) return
        // duration 通过异步回调取，进度回调里用相对位置推算不划算，直接再调 getDuration
        widget.getDuration((ms: number) => {
          if (ms > 0) emit('progress', { position: e.currentPosition / 1000, duration: ms / 1000 })
        })
      })
      // 单曲=本曲结束；合辑=整张 sets 全部播完（内部联播的单曲结束不会触发 FINISH）
      widget.bind(W.FINISH, () => {
        playing = false
        if (!endedSent) {
          endedSent = true
          emit('ended')
        }
      })
      widget.bind?.(W.ERROR, () => {
        emit('error', '该 SoundCloud 曲目无法在站内播放（艺人可能关闭了站外嵌入）')
      })
    })
    .catch((err: Error) => emit('error', err.message))
})

onBeforeUnmount(() => {
  destroyed = true
  widget = null
})
</script>

<template>
  <iframe ref="frameEl" :src="initialSrc" allow="autoplay" class="mp-sc-frame" title="SoundCloud 音频播放器"></iframe>
</template>

<style scoped>
.mp-sc-frame {
  width: 100%;
  height: 100%;
  border: 0;
  border-radius: 12px;
  display: block;
}
</style>
