/**
 * 歌曲分享 · 平台注册表（前端单一真相源）
 *
 * 2026-10 重构后只保留三家，且全部走「统一可控播放器」（自研浮动 Dock，
 * 播完自动联播、进度/音量/队列体验一致）：
 *
 *   网易云音乐 netease —— 单曲 / 专辑
 *     非官方 Meting 链路：Netlify 函数实时换取 mp3 直链（不入数据库），
 *     前端 <audio> 播放。VIP / 无版权曲拿不到直链，会提示换曲。
 *   YouTube youtube —— 单曲（视频）/ 专辑（播放列表，投稿者声明 + 站长人工审核）
 *     官方 IFrame Player API 完整控制；画面在 Dock 收起时隐藏，仅出声。
 *   SoundCloud soundcloud —— 单曲 / sets 专辑合辑（同样声明 + 人工审核）
 *     官方 HTML5 Widget API 完整控制。
 *
 * 已下架（2026-10）：B站（官方播放器无对外接口，只能裁切伪装、不能联播）、
 * Bandcamp / Spotify / Apple Music / Deezer / Tidal（纯嵌入不可控或未登录仅 30 秒预览）。
 * QQ 音乐 / 酷狗 / 酷我：实测免登录取链全部失效（vkey 空 / 30020 / illegal），暂不引入。
 *
 * 与 Netlify 函数互为镜像：
 *   - resolve-music.mjs：链接最终复核、短链跟随、元数据与专辑曲目快照；
 *   - music-stream.mjs：网易云实时换播放直链；
 *   - 本文件 inputPattern 只做投稿页实时正则提示。
 */

/** 平台 key（与 DB CHECK 约束、Netlify 函数分支严格一致） */
export type MusicPlatformKey = 'netease' | 'youtube' | 'soundcloud'

/** 内容类型：单曲 / 专辑（YouTube/SoundCloud 的合辑由投稿者声明为专辑） */
export type MusicMediaType = 'song' | 'album'

/**
 * 播放器接入种类（adapter 选择依据，三家全部支持播完事件 → 均可自动联播）：
 * - meting-audio：函数换直链 + 原生 <audio>（网易云）
 * - youtube-api：YouTube IFrame Player API
 * - soundcloud-api：SoundCloud Widget API
 */
export type MusicPlayerKind = 'meting-audio' | 'youtube-api' | 'soundcloud-api'

/**
 * 专辑曲目快照：识别时写入 music_shares.tracks（jsonb），播放时据此展开队列。
 * - 网易云：后端 Meting 直接给出全量字段；
 * - SoundCloud：前端 Widget API getSounds() 补全（id 为单曲永久链接）；
 * - YouTube：前端 IFrame API getPlaylist() 仅能取视频 ID，标题播放时实时获取。
 */
export interface MusicTrack {
  /** 平台内曲目标识：网易云=数字 ID；YouTube=11 位视频 ID；SoundCloud=单曲永久链接 */
  id: string
  title: string
  artist?: string
  /** 秒；取不到为 0 */
  duration?: number
  cover_url?: string | null
}

/** resolve-music 函数返回的解析结果 */
export interface MusicResolveResult {
  platform: MusicPlatformKey
  media_type: MusicMediaType
  platform_id: string
  source_url: string
  title: string
  artist: string
  cover_url: string | null
  /** true = 需投稿人补全标题等（YouTube 合辑无 oEmbed） */
  need_manual: boolean
  /** 专辑曲目快照（单曲为空） */
  tracks?: MusicTrack[]
  /** netease 单曲：实时探测直链是否可拿到（false=完全无法播放；试听片段仍为 true） */
  playable?: boolean
  play_note?: string
  /** netease 单曲实时可播性三态：full=完整曲；trial=会员曲仅试听片段；blocked=完全锁死 */
  play_mode?: 'full' | 'trial' | 'blocked'
  /** trial 时的试听片段秒数（通常 30~45 秒） */
  trial_seconds?: number
  /** 合辑链接的人工审核提示（YouTube 列表前缀 / SoundCloud sets） */
  album_hint?: string
}

/** 构建官方嵌入地址时的选项（仅 YouTube / SoundCloud 需要嵌入 URL） */
export interface MusicEmbedOptions {
  autoplay?: boolean
}

export interface MusicPlatformConfig {
  key: MusicPlatformKey
  /** 下拉与徽标中文名 */
  label: string
  /** 接受的内容类型 */
  accepts: MusicMediaType[]
  /** 下拉选项内短标签 */
  chips: string[]
  placeholder: string
  /** 投稿页实时正则：未通过则「识别」按钮不可用并即时提示 */
  inputPattern: RegExp
  /** 实时校验失败时的提示 */
  invalidHint: string
  /**
   * 平台局限性说明（选中平台后提示框展示）：
   * 播放形态、网络要求、合辑声明制、会员曲等。
   */
  limitation: string
  /** 播放接入种类 */
  playerKind: MusicPlayerKind
  /** 三家均有可靠播完事件，全部可自动联播 */
  canAutoAdvance: boolean
  /** 品牌色（徽标底色 / 卡片强调色） */
  brandColor: string
  /** 构造官方嵌入 URL（YouTube / SoundCloud 试播与 adapter 使用；网易云无 iframe） */
  buildEmbed?: (
    item: Pick<MusicResolveResult, 'media_type' | 'platform_id' | 'source_url'>,
    opts?: MusicEmbedOptions,
  ) => string
  /** iframe allow 属性 */
  iframeAllow?: string
}

export const MUSIC_PLATFORMS: MusicPlatformConfig[] = [
  {
    key: 'netease',
    label: '网易云音乐',
    accepts: ['song', 'album'],
    chips: ['推荐 · 适配最好', '支持歌词', '支持专辑联播'],
    placeholder: 'https://music.163.com/#/song?id=歌曲ID（或 album?id=专辑ID / 163cn.tv 短链）',
    // /#/song?id=、/song?id=、/m/song?id=、专辑同理
    inputPattern:
      /^https?:\/\/(?:music\.163\.com\/(?:#\/)?(?:m\/)?(?:song|album)\/?(?:\?id=)\d+|163cn\.tv\/\S+)$/i,
    invalidHint: '应为网易云单曲（song?id=）或专辑（album?id=）链接；歌单 / 电台不能投稿',
    limitation:
      '【推荐平台，适配最好】站内服务器实时解析官方音频地址后以统一播放器播出，支持逐句歌词与整张专辑自动联播。' +
      '但会员 / 版权曲目可能无法在站内播放，或仅能播放 30~45 秒的试听片段，识别结果会明确标明，建议先试播确认。',
    playerKind: 'meting-audio',
    canAutoAdvance: true,
    brandColor: '#e60026',
    // 网易云无官方 iframe：试播与 Dock 均用原生 <audio>，不提供 buildEmbed
  },
  {
    key: 'youtube',
    label: 'YouTube',
    accepts: ['song', 'album'],
    chips: ['大陆需自备网络', '自动取信息', '合辑需声明专辑'],
    placeholder:
      'https://www.youtube.com/watch?v=视频ID，或专辑播放列表 playlist?list=列表ID',
    // 单曲：watch / youtu.be / shorts / embed；专辑：playlist?list= 或带 list= 的视频链接
    inputPattern:
      /^https?:\/\/(?:(?:www\.|music\.|m\.)?youtube\.com\/(?:watch\?(?:\S*&)?v=[\w-]{11}|playlist\?(?:\S*&)?list=[\w-]{12,}|shorts\/[\w-]{6,}|embed\/[\w-]{6,}|v\/[\w-]{6,})|youtu\.be\/[\w-]{11})\S*$/i,
    invalidHint: '应为 YouTube 单曲链接或专辑播放列表（playlist?list=）链接；RD 开头的自动电台不能投稿',
    limitation:
      '通过 Google 官方 IFrame API 在统一播放器内播出（收起时只出声），单曲与专辑列表均可自动联播。' +
      '播放列表只接受「专辑」：YouTube Music 官方专辑（OLAK5uy 开头）最稳妥，普通自建歌单 / 系统歌单审核会被拒绝。' +
      '合辑标题需手填，曲目清单识别时自动抓取。注意：YouTube 在中国大陆无法直接访问，听众需自备网络条件，可能影响收听体验。',
    playerKind: 'youtube-api',
    canAutoAdvance: true,
    brandColor: '#ff0000',
    buildEmbed: (item, opts) => {
      if (item.media_type === 'album') {
        // videoseries + list 播放专辑列表
        return `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(item.platform_id)}&rel=0${opts?.autoplay ? '&autoplay=1' : ''}`
      }
      return `https://www.youtube-nocookie.com/embed/${encodeURIComponent(item.platform_id)}?rel=0${opts?.autoplay ? '&autoplay=1' : ''}`
    },
    iframeAllow:
      'accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share',
  },
  {
    key: 'soundcloud',
    label: 'SoundCloud',
    accepts: ['song', 'album'],
    chips: ['大陆需自备网络', '自动取信息', 'sets 需声明专辑'],
    placeholder: 'https://soundcloud.com/歌手/单曲名，或 /sets/专辑名（支持 on.soundcloud.com 短链）',
    inputPattern:
      /^https?:\/\/(?:www\.|on\.)?soundcloud\.com\/[^/\s]+\/(?:sets\/[^/\s]+|[^/\s]+)\S*$/i,
    invalidHint: '应为 SoundCloud 单曲链接或专辑合辑（/sets/名称）链接；用户主页不能投稿',
    limitation:
      '官方 Widget API 在统一播放器内播出，单曲与 sets 专辑均可自动联播，以独立音乐人内容为主。' +
      '/sets/ 合辑只接受「专辑」，普通自建歌单审核会被拒绝；少数艺人关闭了站外嵌入，建议先试播确认。' +
      '注意：SoundCloud 在中国大陆无法直接访问，听众需自备网络条件，可能影响收听体验。',
    playerKind: 'soundcloud-api',
    canAutoAdvance: true,
    brandColor: '#ff5500',
    buildEmbed: (item, opts) =>
      `https://w.soundcloud.com/player/?url=${encodeURIComponent(item.source_url || item.platform_id)}&color=%23ec4899&auto_play=${opts?.autoplay ? 'true' : 'false'}&hide_related=true&show_comments=false&show_user=true&show_teaser=false`,
    iframeAllow: 'autoplay',
  },
]

/** key → 配置映射 */
export const MUSIC_PLATFORM_MAP = Object.fromEntries(
  MUSIC_PLATFORMS.map(p => [p.key, p]),
) as Record<MusicPlatformKey, MusicPlatformConfig>

export function getMusicPlatform(key: string): MusicPlatformConfig | undefined {
  return MUSIC_PLATFORM_MAP[key as MusicPlatformKey]
}

/** 平台中文名（后台表格 / 卡片等场景） */
export function musicPlatformLabel(key: string): string {
  return getMusicPlatform(key)?.label || key
}

/**
 * 试播容器尺寸（投稿页 / 后台审核）：
 * - YouTube 单曲 16:9，合辑列表也用 16:9；
 * - SoundCloud 单曲/合辑官方推荐高度；
 * - 网易云为自研 <audio> 音频条，由调用方自行给高度（不在此表）。
 */
export function musicEmbedFrameStyle(
  platform: MusicPlatformKey,
  mediaType: MusicMediaType,
): Record<string, string> {
  switch (platform) {
    case 'youtube':
      return { aspectRatio: '16 / 9' }
    case 'soundcloud':
      return { height: mediaType === 'album' ? '380px' : '200px' }
    default:
      return { height: '86px' }
  }
}

// ============================================================
// 规范化比对（与数据库生成列表达式严格一致：lower(btrim())）
// 注意：只 trim + 英文小写，不做繁简/括号/feat. 清洗，避免误杀现场版/remix
// ============================================================
export function normMusicText(s: string | null | undefined): string {
  return (s || '').trim().toLowerCase()
}
