import { defineStore } from 'pinia'
import type { MusicShare } from '@/lib/types'
import type { MusicTrack } from '@/lib/musicPlatforms'
import { api } from '@/lib/api'

/**
 * 歌曲分享全局浮动播放器状态（pinia）
 *
 * 挂载点：DefaultLayout（前台所有页面常驻），SPA 跳转不卸载，实现跨页保活；
 * /admin/** 使用独立 AdminLayout，不挂载播放器。
 *
 * 队列模型（2026-10 重构）：
 * - 队列元素 QueueItem = 分享行 + 专辑内曲目（单曲 track=null）；
 * - 单曲分享展开为 1 项；专辑分享按 tracks 快照展开为 N 项；
 * - 进站随机命中专辑时固定从第一首开始顺序播放（产品决策，不随机曲目）；
 * - YouTube 合辑 / SoundCloud sets 由其播放器内部连播，仅通过 syncAlbumTrack
 *   把队列下标同步到新曲目（不重建 adapter）；整张结束才 next() 到下一条分享；
 * - 网易云每首曲目是独立队列项，adapter 播完发 ended → next()。
 *
 * 三家平台全部有可靠播完事件，canAutoAdvance 恒为联播。
 */

/** localStorage 键：'off' 表示听众关闭了进站自动播放 */
const AUTOPLAY_KEY = 'lrcshare_music_autoplay'

/** 队列元素：一条分享行 + 专辑内具体曲目（单曲为 null） */
export interface QueueItem {
  share: MusicShare
  track: MusicTrack | null
}

/** 一条分享展开为队列项：单曲 1 项；专辑按快照 N 项（无快照兜底为 1 项） */
export function expandShare(share: MusicShare): QueueItem[] {
  if (share.media_type === 'album' && share.tracks && share.tracks.length) {
    return share.tracks.map(t => ({ share, track: t }))
  }
  return [{ share, track: null }]
}

/** 一批分享展开为扁平队列 */
function expandList(shares: MusicShare[]): QueueItem[] {
  return shares.flatMap(expandShare)
}

/**
 * 进行中的曲库加载 Promise（模块级、非响应式）：
 * 多个调用方（首页随机推荐区、卡片墙 SSG 水合、进站自动播放）可能几乎同时拉库；
 * 若第二个调用方只看到 libraryLoading=true 就「立即返回当前空库」，
 * 进站自动播放会误判曲库为空。共享同一个 Promise，所有调用方都等到真实结果。
 */
let libraryPromise: Promise<MusicShare[]> | null = null

function shuffleShareIndex(length: number, exclude = -1): number {
  if (length <= 0) return -1
  if (length === 1) return 0
  // 排除当前曲目所在分享，避免随机到同一张
  let i = Math.floor(Math.random() * length)
  while (i === exclude) i = Math.floor(Math.random() * length)
  return i
}

export const useMusicPlayerStore = defineStore('musicPlayer', {
  state: () => ({
    /** 已通过曲库（服务端已按 sort 置顶 + approved_at 倒序排好） */
    library: [] as MusicShare[],
    libraryLoading: false,
    libraryLoaded: false,
    /** 当前播放队列（单曲 1 项 / 专辑 N 项；可能是整个曲库，也可能是卡片墙筛选子集） */
    queue: [] as QueueItem[],
    /** 当前播放项在 queue 中的下标 */
    index: -1,
    /** Dock 是否显示（关闭后声音停止、播放器卸载） */
    visible: false,
    /** 本次会话听众是否已主动开过播放器（右下角推荐卡显隐用） */
    started: false,
    /** 本次整页访问是否已尝试过进站自动播放（只试一次） */
    autoTried: false,
    /**
     * 重播脉冲（单调递增）：外部入口（首页推荐卡等）点播的恰好是当前正在播的曲目时，
     * 队列/下标都不变、stageKey 不变，播放器不会有任何反应；
     * 此时递增该值，由 Dock watch 后 seek(0) 并确保播放，给听众明确的点击反馈。
     */
    replayNonce: 0,
  }),

  getters: {
    /** 当前播放项（无播放时 null） */
    current(state): QueueItem | null {
      return state.queue[state.index] || null
    },
    /** 当前是否还有可播内容 */
    hasTracks(state): boolean {
      return state.queue.length > 0
    },
    /** 当前曲目在所属专辑快照中的下标（单曲为 0） */
    currentAlbumIndex(): number {
      const item = this.current
      if (!item) return 0
      const tracks = item.share.tracks
      if (!tracks || !item.track) return 0
      const i = tracks.findIndex(t => t.id === item.track!.id)
      return i >= 0 ? i : 0
    },
  },

  actions: {
    /** 拉取已通过曲库；force=true 用于后台审核通过后刷新 */
    async loadLibrary(force = false): Promise<MusicShare[]> {
      if (this.libraryLoaded && !force) return this.library
      // 已有进行中的请求：复用同一 Promise（force 强刷除外），调用方一起等待真实结果
      if (libraryPromise && !force) return libraryPromise
      this.libraryLoading = true
      const p = (async (): Promise<MusicShare[]> => {
        try {
          this.library = await api.getMusicShares()
          this.libraryLoaded = true
          return this.library
        } finally {
          this.libraryLoading = false
        }
      })()
      libraryPromise = p
      try {
        return await p
      } finally {
        // 只清自己这一单（force 并发时避免后完成的旧单误清新单）
        if (libraryPromise === p) libraryPromise = null
      }
    },

    /**
     * 卡片墙 SSG 水合已有数据时直接灌入，省一次请求；
     * 仅在 store 尚未自行加载过时采用（先到者为准，避免覆盖新鲜数据）。
     */
    hydrate(rows: MusicShare[] | null | undefined) {
      if (!rows || this.libraryLoaded) return
      this.library = rows
      this.libraryLoaded = true
    },

    /**
     * 播放指定分享；queueShares 缺省时沿用当前队列的来源分享，再缺省用整个曲库。
     * 专辑一律定位到快照第一首（产品决策：顺序播放，不随机曲目）。
     */
    playShare(share: MusicShare, queueShares?: MusicShare[]) {
      const list =
        queueShares && queueShares.length
          ? queueShares
          : this.queue.length
            ? this.queue.map(i => i.share)
            : this.library
      if (!list.length) return
      const expanded = expandList(list)
      const i = expanded.findIndex(item => item.share.id === share.id)
      const targetIndex = i >= 0 ? i : 0
      const target = expanded[targetIndex]
      // 点播项与当前播放项是否同一曲目（单曲行 share.id 相同即同一；专辑曲目还要比 track.id）
      const cur = this.visible ? this.queue[this.index] : null
      const isSameTrack =
        !!cur &&
        !!target &&
        cur.share.id === target.share.id &&
        (cur.track?.id ?? 'solo') === (target.track?.id ?? 'solo')
      this.queue = expanded
      this.index = targetIndex
      this.visible = true
      this.started = true
      // 同曲重点：队列/舞台均不重建，靠脉冲通知 Dock 回到开头并确保播放
      if (isSameTrack) this.replayNonce++
    },

    /**
     * 随机播放：在传入队列（缺省曲库）里随机选一张分享；
     * 命中专辑固定从第一首开始（不再「优先单曲」）。
     */
    async playRandom(queueShares?: MusicShare[]): Promise<boolean> {
      let source = queueShares && queueShares.length ? queueShares : this.library
      if (!source.length && !this.libraryLoaded) {
        source = await this.loadLibrary()
      }
      if (!source.length) return false
      // 排除当前播放项所属的分享
      const curShareId = this.queue[this.index]?.share?.id
      const exclude = curShareId ? source.findIndex(s => s.id === curShareId) : -1
      const picked = shuffleShareIndex(source.length, exclude)
      const expanded = expandList(source)
      // 定位到被选中分享展开后的第一项（专辑=第一首）
      const pickedShareId = source[picked].id
      const start = expanded.findIndex(item => item.share.id === pickedShareId)
      this.queue = expanded
      this.index = start >= 0 ? start : 0
      this.visible = true
      this.started = true
      return true
    },

    /** 下一首：队列内循环。manual=false 为播完自动联播调用 */
    next() {
      if (this.queue.length <= 1) return
      this.index = (this.index + 1) % this.queue.length
    },

    /** 上一首 */
    prev() {
      if (this.queue.length <= 1) return
      this.index = (this.index - 1 + this.queue.length) % this.queue.length
    },

    /**
     * 播放队列面板里点击的任意一项（单曲行 / 专辑内曲目）：
     * - 跨分享或网易云跨曲目：index 变化 → stageKey 变化 → adapter 整体重建；
     * - YouTube 合辑 / SoundCloud sets 内部项：同分享 stageKey 不变，
     *   由 adapter watch trackIndex 调 playVideoAt/skip 内部定位（不重建）。
     * 点的就是当前项时不做处理（重播交给 Dock 的控制按钮）。
     */
    playQueueIndex(i: number) {
      if (i < 0 || i >= this.queue.length || i === this.index) return
      this.index = i
      this.visible = true
      this.started = true
    },

    /**
     * 合辑型 adapter（YouTube 播放列表 / SoundCloud sets）内部联播换曲时
     * 把队列下标同步过去：定位到「同一分享展开段 + 专辑内下标 albumIndex」。
     * 找不到对应项时忽略（快照与线上列表不一致等情况保持当前项）。
     */
    syncAlbumTrack(shareId: string, albumIndex: number) {
      const start = this.queue.findIndex(item => item.share.id === shareId)
      if (start < 0 || albumIndex < 0) return
      const target = start + albumIndex
      const item = this.queue[target]
      if (item && item.share.id === shareId) this.index = target
    },

    /** adapter 上报整张结束：三家平台全部可靠联播 */
    onAdapterEnded() {
      this.next()
    },

    /** 关闭 Dock：卸载播放器、停止发声（听众可再点推荐卡/卡片重新打开） */
    close() {
      this.visible = false
    },

    /** 进站自动播放偏好（localStorage；默认开启，客户端调用） */
    isAutoplayEnabled(): boolean {
      try {
        return localStorage.getItem(AUTOPLAY_KEY) !== 'off'
      } catch {
        return true
      }
    },

    setAutoplayEnabled(on: boolean) {
      try {
        localStorage.setItem(AUTOPLAY_KEY, on ? 'on' : 'off')
      } catch {
        /* 隐私模式等场景忽略写入失败 */
      }
    },
  },
})
