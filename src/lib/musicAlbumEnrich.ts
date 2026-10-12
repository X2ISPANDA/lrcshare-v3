/**
 * 合辑专辑曲目快照 · 浏览器端抓取（投稿页 / 后台手动添加共用）
 *
 * 后端 resolve-music 只负责链接解析与元数据；YouTube 播放列表与 SoundCloud sets
 * 的曲目清单依赖各自的浏览器 JS API（且 YouTube 有 referrer 要求），统一在此抓取：
 *
 * - YouTube：IFrame API 加载 playlist 后 getPlaylist() 只能取视频 ID 数组，
 *   曲名无批量 API（播放时由 adapter 实时上报），封面取首曲 hqdefault；
 * - SoundCloud：Widget API getSounds() 给全量曲目（id 用单曲永久链接）。
 *
 * 抓取用的 iframe/播放器挂载在屏幕外临时容器中，结束（成功/失败/超时）后销毁。
 */
import { loadYouTubeApi, loadSoundCloudApi } from './musicPlayerApi'
import type { MusicResolveResult, MusicTrack } from './musicPlatforms'

const ENRICH_TIMEOUT_MS = 15000

/** 创建屏幕外临时宿主，返回宿主与清理函数 */
function createOffscreenHost(): { host: HTMLDivElement; cleanup: () => void } {
  const host = document.createElement('div')
  host.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;opacity:0;pointer-events:none;'
  document.body.appendChild(host)
  return {
    host,
    cleanup: () => {
      host.innerHTML = ''
      host.remove()
    },
  }
}

/** YouTube 播放列表 → 视频 ID 曲目快照（标题播放时实时获取） */
export function enrichYoutubePlaylist(data: MusicResolveResult): Promise<MusicTrack[]> {
  return new Promise((resolvePromise, reject) => {
    loadYouTubeApi()
      .then((YT) => {
        const { host, cleanup } = createOffscreenHost()
        const inner = document.createElement('div')
        host.appendChild(inner)
        let settled = false
        let timer: ReturnType<typeof setTimeout> | null = null
        let player: any = null
        const finish = (tracks: MusicTrack[] | null, err?: Error) => {
          if (settled) return
          settled = true
          if (timer) clearTimeout(timer)
          try {
            player?.destroy?.()
          } catch {
            /* 忽略 */
          }
          cleanup()
          if (tracks) resolvePromise(tracks)
          else reject(err || new Error('播放列表曲目读取失败'))
        }
        player = new YT.Player(inner, {
          width: '1',
          height: '1',
          playerVars: { listType: 'playlist', list: data.platform_id, controls: 0, disablekb: 1 },
          events: {
            onReady: () => {
              // 列表信息需在播放器就绪后稍延迟才稳定可取
              setTimeout(() => {
                try {
                  const ids: string[] = player?.getPlaylist?.() || []
                  if (!ids.length) return finish(null, new Error('未读取到播放列表曲目，可能不是公开专辑列表'))
                  const tracks: MusicTrack[] = ids.map(id => ({
                    id,
                    title: '',
                    artist: '',
                    duration: 0,
                    cover_url: null,
                  }))
                  // 封面取首曲
                  if (!data.cover_url) data.cover_url = `https://i.ytimg.com/vi/${ids[0]}/hqdefault.jpg`
                  finish(tracks)
                } catch (e) {
                  finish(null, e instanceof Error ? e : new Error('播放列表曲目读取失败'))
                }
              }, 1200)
            },
            onError: () => finish(null, new Error('播放列表无法加载（可能为私享 / 已删除，或当前网络无法访问 YouTube）')),
          },
        })
        timer = setTimeout(() => finish(null, new Error('播放列表读取超时，请重试')), ENRICH_TIMEOUT_MS)
      })
      .catch(reject)
  })
}

/** SoundCloud /sets/ 合辑 → 全量曲目快照（getSounds） */
export function enrichSoundcloudSet(data: MusicResolveResult): Promise<MusicTrack[]> {
  return new Promise((resolvePromise, reject) => {
    loadSoundCloudApi()
      .then((SC) => {
        const { host, cleanup } = createOffscreenHost()
        const iframe = document.createElement('iframe')
        iframe.width = '1'
        iframe.height = '1'
        iframe.style.border = '0'
        iframe.src = `https://w.soundcloud.com/player/?url=${encodeURIComponent(data.source_url)}`
        let settled = false
        let timer: ReturnType<typeof setTimeout> | null = null
        let widget: any = null
        const finish = (tracks: MusicTrack[] | null, err?: Error) => {
          if (settled) return
          settled = true
          if (timer) clearTimeout(timer)
          cleanup()
          widget = null
          if (tracks) resolvePromise(tracks)
          else reject(err || new Error('合辑曲目读取失败'))
        }
        host.appendChild(iframe)
        widget = SC.Widget(iframe)
        widget.bind(SC.Widget.Events.READY, () => {
          widget.getSounds((sounds: any[]) => {
            if (!Array.isArray(sounds) || !sounds.length) {
              return finish(null, new Error('未读取到合辑曲目，可能链接不是公开的 /sets/ 专辑'))
            }
            const tracks: MusicTrack[] = sounds.map(s => ({
              id: s.permalink_url || String(s.id || ''),
              title: s.title || '',
              artist: s.user?.username || data.artist || '',
              duration: s.duration ? Math.round(s.duration / 1000) : 0,
              cover_url: s.artwork_url ? s.artwork_url.replace('-large', '-t500x500') : null,
            }))
            if (!data.cover_url && sounds[0]?.artwork_url) {
              data.cover_url = sounds[0].artwork_url.replace('-large', '-t500x500')
            }
            finish(tracks)
          })
        })
        widget.bind?.(SC.Widget.Events.ERROR, () =>
          finish(null, new Error('合辑无法加载（艺人可能关闭了站外嵌入）')),
        )
        timer = setTimeout(() => finish(null, new Error('合辑曲目读取超时，请重试')), ENRICH_TIMEOUT_MS)
      })
      .catch(reject)
  })
}

/**
 * 按平台抓取合辑曲目快照（网易云后端已直接给，无需前端抓）。
 * 成功返回曲目数组（同时可能补写 data.cover_url）；失败抛中文错误。
 */
export async function enrichAlbumTracks(data: MusicResolveResult): Promise<MusicTrack[]> {
  if (data.platform === 'youtube') return enrichYoutubePlaylist(data)
  if (data.platform === 'soundcloud') return enrichSoundcloudSet(data)
  return data.tracks || []
}
