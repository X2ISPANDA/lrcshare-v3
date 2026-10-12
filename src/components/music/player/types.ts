/**
 * 全局播放器各平台 adapter 的统一契约
 *
 * 重构后三家平台（网易云 <audio> / YouTube IFrame API / SoundCloud Widget API）
 * 全部是「完全可控」adapter：
 * - 挂载后上抛 PlayerControls 控制句柄（播放/暂停/跳转/音量）；
 * - 持续上抛 progress 进度；
 * - 曲目播完发 ended（三家均支持，Dock 自动联播）；
 * - 自动播放被浏览器拦截时发 blocked，由 Dock 高亮播放键等待听众手势。
 */
import type { MusicTrack } from '@/lib/musicPlatforms'

/** 时间单位统一为秒（SoundCloud 原生为毫秒，由其 adapter 换算） */
export interface PlayerProgress {
  position: number
  duration: number
}

/** 当前实际播放的曲目信息（专辑内曲目可能与快照不一致，如 YouTube 实时曲名） */
export interface PlayerTrackMeta {
  title?: string
  artist?: string
}

/** 上抛给 Dock 的播放控制句柄（三家全部提供） */
export interface PlayerControls {
  isPlaying: () => boolean
  play: () => void
  pause: () => void
  toggle: () => void
  /** 跳转（秒） */
  seek: (seconds: number) => void
  /** 音量 0~1（原生 <audio> 与 YouTube 支持；SoundCloud 无音量 API 时为空实现） */
  setVolume?: (v: number) => void
  /**
   * 专辑内下一首 / 上一首：仅合辑型 adapter（YouTube 播放列表 / SoundCloud sets）提供，
   * 由其内部播放器自行连播；单曲 / 网易云分曲 adapter 不提供，Dock 回退到队列切换。
   */
  next?: () => void
  prev?: () => void
}

/** adapter → Dock 的事件名（MusicPlayerStage 原样透传） */
export interface PlayerAdapterEmits {
  /** 官方组件已加载，可以尝试自动播放 / 注册控制句柄 */
  (e: 'ready'): void
  /** 曲目播完（三家都会触发，驱动专辑内/跨分享自动联播） */
  (e: 'ended'): void
  /** 自动播放被浏览器拦截，需要听众手动点播放键 */
  (e: 'blocked'): void
  (e: 'progress', value: PlayerProgress): void
  (e: 'controls', controls: PlayerControls): void
  /** 播放中拿到的实时曲名（YouTube 合辑快照无曲名时用于覆盖展示） */
  (e: 'meta', value: PlayerTrackMeta): void
  /**
   * 合辑内部自动换曲（YouTube 播放列表 / SoundCloud sets 自身联播）：
   * 上抛新曲目在专辑快照中的下标 / 实际平台曲目 ID，store 仅同步高亮，不重建 adapter。
   */
  (e: 'trackchange', value: { index: number; trackId?: string }): void
  (e: 'error', message: string): void
}

/** Stage 向各 adapter 传入的播放目标 */
export interface PlayerAdapterProps {
  /** 所属分享行（专辑标题/封面/原链取自行本身） */
  share: import('@/lib/types').MusicShare
  /** 专辑内当前曲目；单曲分享为 null（adapter 直接用 share.platform_id） */
  track?: MusicTrack | null
  /** 专辑内当前曲目下标（合辑型 adapter 初始定位用；单曲为 0） */
  trackIndex?: number
  autoplay: boolean
}
