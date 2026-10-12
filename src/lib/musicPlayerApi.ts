/**
 * 歌曲分享全局播放器 · 官方 JS API 的浏览器端动态加载器
 *
 * 仅在客户端 adapter 组件挂载时加载（SSG 构建服务端不会执行 onMounted，天然安全）。
 * 每家各维护一个单例 Promise，多个 adapter 实例 / 切歌重建时只注入一次 <script>。
 * SDK 均无官方 npm 类型声明，返回值统一为 any，类型约束收敛在各 adapter 内。
 *
 * - YouTube IFrame Player API：https://developers.google.com/youtube/iframe_api_reference
 * - SoundCloud Widget API：https://developers.soundcloud.com/docs/api/html5-widget
 *
 * 网易云不走官方 JS API：由 Netlify 函数实时换取音频直链，adapter 用原生 <audio> 播放。
 */

/* ============================== YouTube ============================== */

let ytPromise: Promise<any> | null = null

/** 加载 YouTube IFrame API，resolve window.YT */
export function loadYouTubeApi(): Promise<any> {
  if (ytPromise) return ytPromise
  ytPromise = new Promise((resolve, reject) => {
    const w = window as any
    // 官方约定：脚本加载完成后会调用 window.onYouTubeIframeAPIReady
    const prevReady = w.onYouTubeIframeAPIReady
    w.onYouTubeIframeAPIReady = () => {
      prevReady?.()
      resolve(w.YT)
    }
    const script = document.createElement('script')
    script.src = 'https://www.youtube.com/iframe_api'
    script.async = true
    script.onerror = () => {
      ytPromise = null
      reject(new Error('YouTube 播放器脚本加载失败（当前网络可能无法访问 YouTube）'))
    }
    document.head.appendChild(script)
  })
  return ytPromise
}

/* ============================= SoundCloud =========================== */

let scPromise: Promise<any> | null = null

/** 加载 SoundCloud Widget API，resolve window.SC（widget 工厂在 SC.Widget） */
export function loadSoundCloudApi(): Promise<any> {
  if (scPromise) return scPromise
  scPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://w.soundcloud.com/player/api.js'
    script.async = true
    script.onload = () => resolve((window as any).SC)
    script.onerror = () => {
      scPromise = null
      reject(new Error('SoundCloud 播放器脚本加载失败（当前网络可能无法访问 SoundCloud）'))
    }
    document.head.appendChild(script)
  })
  return scPromise
}
