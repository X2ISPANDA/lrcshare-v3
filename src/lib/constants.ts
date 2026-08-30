/** 站点静态资源与展示常量 */

/** ttml-hub 静态站点根地址（含尾斜杠）——与 cloudflare/ttml-sync/wrangler.toml 的 TTML_HUB_BASE 保持一致 */
export const TTML_HUB_BASE = 'https://2755337087.github.io/ttml-hub/'

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

/**
 * 联系方式 / 平台键名体系（2026-08-25 起统一英文键）：
 * 数据库与代码一律存英文键（contributors.contact_* / artists.urls），
 * 中文仅作为展示层标签（下拉选项、弹窗标题、表格列），见下方两个 LABELS。
 */

/** 贡献者联系方式英文键 → 中文标签 */
export const CONTACT_LABELS: Record<string, string> = {
  qq: 'QQ',
  wechat: '微信',
  email: '邮箱',
  bilibili: 'B站',
  github: 'GitHub',
  blog: '博客',
  douyin: '抖音',
  weibo: '微博',
  twitter: 'Twitter',
  xiaohongshu: '小红书',
  netease: '网易音乐人',
  homepage: '个人主页',
  phone: '电话',
  mobile: '手机',
}

/** 艺术家社交平台英文键 → 中文标签 */
export const PLATFORM_LABELS: Record<string, string> = {
  netease: '网易音乐人',
  qqmusic: 'QQ音乐',
  weibo: '微博',
  bilibili: 'B站',
  instagram: 'Instagram',
  spotify: 'Spotify',
  youtube: 'YouTube',
  x: 'X',
  facebook: 'Facebook',
  douyin: '抖音',
  xiaohongshu: '小红书',
  beatstars: 'BeatStars',
  official: '官网',
}

/** 键名 → 展示标签（联系方式/平台通用，未收录的键原样显示） */
export function contactLabel(key: string): string {
  return CONTACT_LABELS[key] || PLATFORM_LABELS[key] || key
}

export function artistTypeIcons(types: string[] | null | undefined): string {
  return (types || ['singer']).map(t => ARTIST_TYPE_ICONS[t] || '').join(' ')
}

/** 风格选项（后台歌曲表单与投稿审核共用） */
export const GENRE_OPTIONS = ['Hip-Hop', 'Chinese Rap', 'Rock', 'Mandopop', 'Contopop', 'K-Pop', 'J-Pop', '抽象', 'Soundtrack', 'Vocaloid']

/** Hexo {% tip %} 标签类型 → 图标（前台渲染与后台编辑工具栏共用） */
export const TIP_ICONS: Record<string, string> = {
  bell: '🔔', info: 'ℹ️', success: '✅', warning: '⚠️',
  danger: '❌', tip: '💡', note: '📝', important: '❗',
}

/** 投稿校验中止哨兵：用户信息区校验失败时抛出，批量提交据此整批中止（SubmitView ↔ BatchSubmitPanel 共享） */
export const VALIDATION_ABORT = '__VALIDATION_ABORT__'

/** 译文语种预设配色（前台渲染与后台工具栏共用，保证同一语种前后台颜色一致） */
export const PRESET_LANG_COLORS: Record<string, string> = {
  '粤语': '#1bcdfc', '英语': '#3b82f6', '日语': '#ec4899', '韩语': '#a855f7',
}

/** 自定义语种配色板：按语种名 hash 稳定取色 */
export const LANG_PALETTE = ['#f59e0b', '#10b981', '#06b6d4', '#8b5cf6', '#ef4444', '#84cc16', '#f97316', '#14b8a6', '#e11d48', '#6366f1']

/** 语种 → 颜色：预设优先，自定义语种按名字 hash 从配色板稳定取色 */
export function langColor(name: string): string {
  if (PRESET_LANG_COLORS[name]) return PRESET_LANG_COLORS[name]
  let sum = 0
  for (const ch of name) sum += ch.codePointAt(0) ?? 0
  return LANG_PALETTE[sum % LANG_PALETTE.length]
}
