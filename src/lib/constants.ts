/** 站点静态资源与展示常量 */

export const LOGO_URL =
  'https://i0.hdslb.com/bfs/article/a2323ad6e33924c39061b35ae29f9fd937977624.png'

export const HERO_BG_URL =
  'https://i0.hdslb.com/bfs/article/a009cfa6551237d38e6f64ce46fd739037977624.jpg'

/** 赞赏二维码（微信 / 支付宝），SupportView 与 RewardModal 共用 */
export const QR_CODES = [
  'https://i0.hdslb.com/bfs/openplatform/954a7ef000973598f054011146df90b5c3f2a71f.jpg',
  'https://i0.hdslb.com/bfs/openplatform/a5de338082f11e2f2876bc7059cde436af978568.jpg',
]

/** 艺术家身份类型 → 图标 */
export const ARTIST_TYPE_ICONS: Record<string, string> = {
  singer: '🎤',
  lyricist: '📝',
  composer: '🎼',
  arranger: '🎹',
}

/** 艺术家身份类型 → 中文标签 */
export const ARTIST_TYPE_LABELS: Record<string, string> = {
  singer: '歌手',
  lyricist: '作词人',
  composer: '作曲人',
  arranger: '编曲人',
}

/** 艺术家身份类型 → 徽章渐变色（Tailwind 类） */
export const ARTIST_TYPE_GRADIENTS: Record<string, string> = {
  singer: 'from-blue-500 to-indigo-500',
  lyricist: 'from-green-500 to-teal-500',
  composer: 'from-purple-500 to-pink-500',
  arranger: 'from-amber-500 to-orange-500',
}

export function artistTypeIcons(types: string[] | null | undefined): string {
  return (types || ['singer']).map(t => ARTIST_TYPE_ICONS[t] || '').join(' ')
}
