/**
 * 歌曲分享 · 平台注册表（前端单一真相源）
 *
 * 9 家官方支持嵌入播放的平台，顺序即投稿页下拉的推荐顺序：
 * 网易云 → YouTube → B站 → Spotify → Apple Music → SoundCloud → Deezer → Tidal → Bandcamp
 *
 * 与 Netlify 函数 netlify/functions/resolve-music.mjs 的规则互为镜像：
 *   - 本文件的 inputPattern 只负责「实时正则校验」（填错立刻提示）；
 *   - 服务端函数做最终复核、短链跟随与官方元数据获取；
 *   - 新增平台 = 在两处各加一条配置 + SQL CHECK 加枚举。
 *
 * 只接受单曲（song）与专辑（album），歌单/合集/播放列表在两处同时拒绝。
 */

/** 平台 key（与 DB CHECK 约束、Netlify 函数分支严格一致） */
export type MusicPlatformKey =
  | 'netease'
  | 'youtube'
  | 'bilibili'
  | 'spotify'
  | 'apple_music'
  | 'soundcloud'
  | 'deezer'
  | 'tidal'
  | 'bandcamp'

/** 内容类型：单曲 / 专辑（视频类平台的视频也按 song 对待） */
export type MusicMediaType = 'song' | 'album'

/** 元数据档位：A 档官方接口自动取信息；B 档需投稿人手填曲名/歌手 */
export type MusicMetaTier = 'A' | 'B'

/** resolve-music 函数返回的解析结果 */
export interface MusicResolveResult {
  platform: MusicPlatformKey
  media_type: MusicMediaType
  platform_id: string
  source_url: string
  title: string
  artist: string
  cover_url: string | null
  /** true = 官方无元数据接口（或本次未取到），曲名/歌手需手填 */
  need_manual: boolean
}

/** 构建嵌入地址时的选项 */
export interface MusicEmbedOptions {
  /** 是否带平台官方自动播放参数（投稿试播固定 false；全局播放器批次④传 true） */
  autoplay?: boolean
}

export interface MusicPlatformConfig {
  key: MusicPlatformKey
  /** 下拉与徽标中文名 */
  label: string
  /** 接受的内容类型（用于提示文案与二次复核） */
  accepts: MusicMediaType[]
  /** url = 粘贴地址栏链接；embed = Bandcamp 特例，粘贴官方嵌入代码 */
  inputMode: 'url' | 'embed'
  /** 输入框占位符 */
  placeholder: string
  /** 投稿页实时正则：未通过则「识别」按钮不可用并即时提示 */
  inputPattern: RegExp
  /** 实时校验失败时的提示 */
  invalidHint: string
  /** 元数据档位 */
  tier: MusicMetaTier
  /** 平台限制提示（如 30 秒预览、版权歌不可播），展示在平台选择项旁 */
  limitation?: string
  /** 品牌色（无 SVG 图标时的徽标底色，批次③补正式线性图标） */
  brandColor: string
  /** 构造官方嵌入 URL；只允许使用官方组件域名 */
  buildEmbed: (item: Pick<MusicResolveResult, 'media_type' | 'platform_id' | 'source_url'>, opts?: MusicEmbedOptions) => string
  /** iframe allow 属性（Spotify 等必须放行 encrypted-media） */
  iframeAllow?: string
}

export const MUSIC_PLATFORMS: MusicPlatformConfig[] = [
  {
    key: 'netease',
    label: '网易云音乐',
    accepts: ['song', 'album'],
    inputMode: 'url',
    placeholder: 'https://music.163.com/#/song?id=歌曲ID 或 163cn.tv 短链',
    // /#/song?id=、/song?id=、/m/song?id=、专辑同理
    inputPattern:
      /^https?:\/\/(?:music\.163\.com\/(?:#\/)?(?:m\/)?(?:song|album)\/?(?:\?id=)\d+|163cn\.tv\/\S+)$/i,
    invalidHint: '应为网易云单曲（song?id=）或专辑（album?id=）链接；歌单（playlist?id=）不能投稿',
    tier: 'B',
    limitation: '无官方元数据接口，曲名歌手需手填；部分版权歌曲官方组件本身不可播，可用下方试播提前确认',
    brandColor: '#e60026',
    buildEmbed: (item, opts) => {
      const typeNo = item.media_type === 'album' ? 1 : 2
      const height = item.media_type === 'album' ? 430 : 66
      return `https://music.163.com/outchain/player?type=${typeNo}&id=${encodeURIComponent(item.platform_id)}&auto=${opts?.autoplay ? 1 : 0}&height=${height}`
    },
  },
  {
    key: 'youtube',
    label: 'YouTube',
    accepts: ['song'],
    inputMode: 'url',
    placeholder: 'https://www.youtube.com/watch?v=11位视频ID（含 YouTube Music / youtu.be / Shorts）',
    inputPattern:
      /^https?:\/\/(?:(?:www\.|music\.|m\.)?youtube\.com\/(?:watch\?(?:\S*&)?v=[\w-]{11}|shorts\/[\w-]{6,}|embed\/[\w-]{6,}|v\/[\w-]{6,})|youtu\.be\/[\w-]{11})\S*$/i,
    invalidHint: '应为 YouTube 单个视频链接（watch / youtu.be / Shorts）；播放列表（list=）不能投稿',
    tier: 'A',
    limitation: '官方 oEmbed 自动取信息；注意自动带出的「歌手」是频道名，若与真实歌手不符可手动修改',
    brandColor: '#ff0000',
    buildEmbed: (item, opts) =>
      `https://www.youtube.com/embed/${encodeURIComponent(item.platform_id)}?rel=0&autoplay=${opts?.autoplay ? 1 : 0}`,
    iframeAllow:
      'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
  },
  {
    key: 'bilibili',
    label: 'B站',
    accepts: ['song'],
    inputMode: 'url',
    placeholder: 'https://www.bilibili.com/video/BV1xx... 或 b23.tv 短链',
    inputPattern:
      /^https?:\/\/(?:www\.)?bilibili\.com\/video\/(?:BV[0-9A-Za-z]{8,}|av\d+)(?:[?/]\S*)?$|^https?:\/\/b23\.tv\/\S+$/i,
    invalidHint: '应为 B站单个视频链接（BV 号 / av 号）；合集、专栏、直播、番剧不能投稿',
    tier: 'B',
    limitation: '无官方 oEmbed，曲名/UP 主需手填；播放器自带封面与弹幕开关',
    brandColor: '#00a1d6',
    buildEmbed: (item, opts) => {
      const id = item.platform_id
      const idParam = /^av/i.test(id) ? `aid=${id.replace(/^av/i, '')}` : `bvid=${id}`
      return `https://player.bilibili.com/player.html?${idParam}&page=1&danmaku=0&autoplay=${opts?.autoplay ? 1 : 0}&poster=1`
    },
    iframeAllow: 'fullscreen; autoplay; encrypted-media',
  },
  {
    key: 'spotify',
    label: 'Spotify',
    accepts: ['song', 'album'],
    inputMode: 'url',
    placeholder: 'https://open.spotify.com/track/单曲ID 或 /album/专辑ID（支持 spotify.link 短链）',
    inputPattern:
      /^https?:\/\/(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?(?:track|album)\/[\w]+|spotify\.link\/\S+)\S*$/i,
    invalidHint: '应为 Spotify 单曲（/track/）或专辑（/album/）链接；歌单、艺人、播客不能投稿',
    tier: 'A',
    limitation: '未登录访客通常只能听 30 秒预览，登录 Spotify 后可听完整曲',
    brandColor: '#1db954',
    buildEmbed: (item, opts) =>
      // Spotify 自动播放由批次④的 iFrame API 控制；这里预留 auto_play 参数（官方对未登录用户仍可能忽略）
      `https://open.spotify.com/embed/${item.media_type === 'album' ? 'album' : 'track'}/${encodeURIComponent(item.platform_id)}?utm_source=generator&theme=0${opts?.autoplay ? '&autoplay=true' : ''}`,
    iframeAllow: 'autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture',
  },
  {
    key: 'apple_music',
    label: 'Apple Music',
    accepts: ['song', 'album'],
    inputMode: 'url',
    placeholder: 'https://music.apple.com/cn/album/专辑名/专辑ID（专辑内单曲链接带 ?i=歌曲ID）',
    inputPattern:
      /^https?:\/\/music\.apple\.com\/[a-z]{2}\/album\/(?:[^/?#]+\/)?\d+(?:\?[^\s]*i=\d+)?\S*$/i,
    invalidHint: '应为 Apple Music 专辑或专辑内单曲（链接带 ?i=）链接；歌单、艺人、MV 不能投稿',
    tier: 'A',
    limitation: '未登录访客通常只能听 30 秒预览',
    brandColor: '#fa243c',
    buildEmbed: (item, opts) => {
      // platform_id 复合串：{cc}/{albumId}/{songId|0}
      const [cc = 'us', albumId = '', songId = '0'] = item.platform_id.split('/')
      const qs = new URLSearchParams()
      if (songId && songId !== '0') qs.set('i', songId)
      if (opts?.autoplay) qs.set('autoplay', 'true')
      const q = qs.toString()
      return `https://embed.music.apple.com/${cc}/album/${albumId}${q ? `?${q}` : ''}`
    },
    iframeAllow: 'autoplay; encrypted-media; fullscreen',
  },
  {
    key: 'soundcloud',
    label: 'SoundCloud',
    accepts: ['song'],
    inputMode: 'url',
    placeholder: 'https://soundcloud.com/歌手/单曲名（支持 on.soundcloud.com 短链；/sets/ 歌单禁投）',
    inputPattern:
      /^https?:\/\/(?:www\.|on\.)?soundcloud\.com\/(?!sets\/)[^/\s]+\/[^/\s]+\S*$/i,
    invalidHint: '应为 SoundCloud 单曲链接（soundcloud.com/歌手/歌名）；/sets/ 合集与用户主页不能投稿',
    tier: 'A',
    limitation: '官方 oEmbed 自动取信息；独立音乐人内容较多，部分艺人可关闭站外嵌入',
    brandColor: '#ff5500',
    buildEmbed: (item, opts) =>
      `https://w.soundcloud.com/player/?url=${encodeURIComponent(item.source_url || item.platform_id)}&color=%23ec4899&auto_play=${opts?.autoplay ? 'true' : 'false'}&hide_related=true&show_comments=false&show_user=true&show_teaser=false&visual=true`,
    iframeAllow: 'autoplay',
  },
  {
    key: 'deezer',
    label: 'Deezer',
    accepts: ['song', 'album'],
    inputMode: 'url',
    placeholder: 'https://www.deezer.com/track/单曲ID 或 /album/专辑ID（支持 deezer.page.link 短链）',
    inputPattern:
      /^https?:\/\/(?:www\.)?deezer\.com\/(?:[a-z]{2}\/)?(?:track|album)\/\d+\S*$|^https?:\/\/deezer\.page\.link\/\S+$/i,
    invalidHint: '应为 Deezer 单曲（/track/）或专辑（/album/）链接；歌单、艺人、播客不能投稿',
    tier: 'A',
    limitation: '未登录访客通常只能听 30 秒预览',
    brandColor: '#a238ff',
    buildEmbed: (item) =>
      `https://widget.deezer.com/widget/auto/${item.media_type === 'album' ? 'album' : 'track'}/${encodeURIComponent(item.platform_id)}`,
    iframeAllow: 'autoplay; encrypted-media; fullscreen',
  },
  {
    key: 'tidal',
    label: 'Tidal',
    accepts: ['song', 'album'],
    inputMode: 'url',
    placeholder: 'https://tidal.com/track/单曲ID 或 /album/专辑ID（/browse/track/ 旧链接亦可）',
    inputPattern:
      /^https?:\/\/(?:listen\.)?tidal\.com\/(?:browse\/)?(?:track|album)\/\d+\S*$/i,
    invalidHint: '应为 Tidal 单曲（/track/）或专辑（/album/）链接；歌单、艺人、MV 不能投稿',
    // 实测（2026-10）：Tidal oEmbed 对任意数字 ID（含不存在的）都只回嵌入壳，无标题/封面，无法校验存在性
    tier: 'B',
    limitation: '官方不提供元数据接口，曲名歌手需手填；未登录访客只能听 30 秒预览；请用下方试播确认内容存在',
    brandColor: '#000000',
    buildEmbed: (item) =>
      `https://embed.tidal.com/${item.media_type === 'album' ? 'albums' : 'tracks'}/${encodeURIComponent(item.platform_id)}?layout=gridify`,
    iframeAllow: 'encrypted-media; fullscreen',
  },
  {
    key: 'bandcamp',
    label: 'Bandcamp',
    accepts: ['song', 'album'],
    inputMode: 'embed',
    placeholder: '在 Bandcamp 歌曲/专辑页点「Share/Embed」，复制整段嵌入代码粘贴到这里',
    inputPattern: /bandcamp\.com\/EmbeddedPlayer\/(?:track|album)=\d+/i,
    invalidHint: '需要粘贴 Bandcamp 官方 Share/Embed 弹窗里的整段嵌入代码（地址栏链接里没有播放器数字 ID）',
    tier: 'B',
    limitation: '官方不提供按链接查 ID 的接口，也无 oEmbed；曲名歌手会尝试从嵌入代码预填，可手动修改。部分艺人会关闭嵌入',
    brandColor: '#629aa9',
    buildEmbed: (item) => {
      // platform_id：'t123'（单曲）/ 'a123'（专辑）
      const isTrack = item.platform_id.startsWith('t')
      const num = item.platform_id.slice(1)
      return `https://bandcamp.com/EmbeddedPlayer/${isTrack ? 'track' : 'album'}=${num}/size=large/tracklist=false/artwork=small/linkcol=e99708/transparent=true/`
    },
    iframeAllow: 'fullscreen',
  },
]

/** key → 配置映射 */
export const MUSIC_PLATFORM_MAP: Record<MusicPlatformKey, MusicPlatformConfig> = Object.fromEntries(
  MUSIC_PLATFORMS.map(p => [p.key, p]),
) as Record<MusicPlatformKey, MusicPlatformConfig>

export function getMusicPlatform(key: string): MusicPlatformConfig | undefined {
  return MUSIC_PLATFORM_MAP[key as MusicPlatformKey]
}

/** 平台中文名（后台表格/卡片等场景） */
export function musicPlatformLabel(key: string): string {
  return getMusicPlatform(key)?.label || key
}

// ============================================================
// 规范化比对（与数据库生成列表达式严格一致：lower(btrim())）
// 注意：只 trim + 英文小写，不做繁简/括号/feat. 清洗，避免误杀现场版/remix
// ============================================================
export function normMusicText(s: string | null | undefined): string {
  return (s || '').trim().toLowerCase()
}
