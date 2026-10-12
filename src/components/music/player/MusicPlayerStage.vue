<script setup lang="ts">
/**
 * 播放舞台：按当前播放项（QueueItem = 分享行 + 专辑内曲目）的 playerKind
 * 分发到对应 adapter。Dock 用 stageKey 包裹本组件：
 *   - 网易云按「曲目」重建（每首换直链）；
 *   - YouTube 合辑 / SoundCloud sets 按「分享行」复用同一个播放器内部连播。
 * 所有 adapter 事件原样透传给 Dock。
 */
import { computed } from 'vue'
import { getMusicPlatform, type MusicTrack } from '@/lib/musicPlatforms'
import type { MusicShare } from '@/lib/types'
import type { PlayerControls, PlayerProgress, PlayerTrackMeta } from './types'
import MusicAudioPlayer from './MusicAudioPlayer.vue'
import MusicYoutubePlayer from './MusicYoutubePlayer.vue'
import MusicSoundcloudPlayer from './MusicSoundcloudPlayer.vue'

defineOptions({ name: 'MusicPlayerStage' })

const props = withDefaults(
  defineProps<{
    share: MusicShare
    /** 专辑内当前曲目；单曲为 null */
    track?: MusicTrack | null
    /** 专辑内当前曲目下标（0 基），单曲为 0 */
    trackIndex?: number
    autoplay?: boolean
  }>(),
  {
    track: null,
    trackIndex: 0,
    autoplay: true,
  },
)
const emit = defineEmits<{
  (e: 'ready'): void
  (e: 'ended'): void
  (e: 'blocked'): void
  (e: 'error', message: string): void
  (e: 'progress', value: PlayerProgress): void
  (e: 'controls', controls: PlayerControls): void
  (e: 'meta', value: PlayerTrackMeta): void
  (e: 'trackchange', value: { index: number; trackId?: string }): void
}>()

/** playerKind → adapter 组件（三家全部完全可控） */
const adapterComp = computed(() => {
  const kind = getMusicPlatform(props.share.platform)?.playerKind
  switch (kind) {
    case 'meting-audio':
      return MusicAudioPlayer
    case 'youtube-api':
      return MusicYoutubePlayer
    case 'soundcloud-api':
      return MusicSoundcloudPlayer
    default:
      return MusicAudioPlayer
  }
})
</script>

<template>
  <component
    :is="adapterComp"
    :share="props.share"
    :track="props.track"
    :track-index="props.trackIndex"
    :autoplay="props.autoplay"
    @ready="emit('ready')"
    @ended="emit('ended')"
    @blocked="emit('blocked')"
    @error="(m: string) => emit('error', m)"
    @progress="(v: PlayerProgress) => emit('progress', v)"
    @controls="(c: PlayerControls) => emit('controls', c)"
    @meta="(v: PlayerTrackMeta) => emit('meta', v)"
    @trackchange="(v: { index: number; trackId?: string }) => emit('trackchange', v)"
  />
</template>
