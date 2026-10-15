/** 站点静态资源与展示常量 */

/** ttml-hub 静态站点根地址（含尾斜杠）——与 cloudflare/ttml-sync/wrangler.toml 的 TTML_HUB_BASE 保持一致 */
export const TTML_HUB_BASE = 'https://2755337087.github.io/ttml-hub/'

export const LOGO_URL =
  'https://i0.hdslb.com/bfs/article/a2323ad6e33924c39061b35ae29f9fd937977624.png'

/** Logo 的 OSS 灾备地址（image_source=aliyun 时前台经 imageSource 助手取用；后台始终用原地址） */
export const LOGO_URL_BACKUP =
  'https://lrcshare.oss-cn-shanghai.aliyuncs.com/backup/05/05a15b493b65178749efb27ac066fd29de3c1ba39a620e5e809e1643d48057bb.png'

export const HERO_BG_URL =
  'https://i0.hdslb.com/bfs/article/a009cfa6551237d38e6f64ce46fd739037977624.jpg'

/** 首页 / 实体页头大图背景的 OSS 灾备地址 */
export const HERO_BG_URL_BACKUP =
  'https://lrcshare.oss-cn-shanghai.aliyuncs.com/backup/db/db611e025e751fde68203c9975c803398e10c0d52eba291293ffaaae8756671b.jpg'

/** 赞赏二维码（微信 / 支付宝），SupportView 与 RewardModal 共用 */
export const QR_CODES = [
  'https://i0.hdslb.com/bfs/openplatform/954a7ef000973598f054011146df90b5c3f2a71f.jpg',
  'https://i0.hdslb.com/bfs/openplatform/a5de338082f11e2f2876bc7059cde436af978568.jpg',
]

/** 赞赏二维码 OSS 灾备地址（顺序与 QR_CODES 一一对应） */
export const QR_CODES_BACKUP = [
  'https://lrcshare.oss-cn-shanghai.aliyuncs.com/backup/c2/c208ec97f7f86a1fd50769d2aa11eb44fd9a9e631aaa0c15f164e62ea26815ea.jpg',
  'https://lrcshare.oss-cn-shanghai.aliyuncs.com/backup/80/806b9542697c71fca0970cca0a09e0db8071143ec1bd44ed1c1d30ed20c8bca1.jpg',
]

/** 隐藏歌词占位图（歌曲被隐藏 / 口令锁定时的提示图） */
export const HIDDEN_PLACEHOLDER_IMG =
  'https://i0.hdslb.com/bfs/openplatform/6e065deeee2d046c05347d3f76592b6fb39c66a8.png'

/** 隐藏歌词占位图的 OSS 灾备地址 */
export const HIDDEN_PLACEHOLDER_IMG_BACKUP =
  'https://lrcshare.oss-cn-shanghai.aliyuncs.com/backup/dc/dc90e5cd590cf004d1d3c36ecae82410a8ab9b3149885620cc00303bd2d9be31.png'

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

/**
 * 投稿身份区「联系方式」动态行可选键（歌词投稿 / 歌曲分享投稿共用）。
 * 注意不含 email：邮箱在投稿面板里有独立一栏（同属资料，提交时并入 contact_value）。
 */
export const CONTACT_TYPES = [
  'qq', 'wechat', 'bilibili', 'github', 'blog', 'douyin', 'weibo',
  'twitter', 'xiaohongshu', 'netease', 'homepage', 'phone', 'mobile',
]

/** 键名 → 展示标签（联系方式/平台通用，未收录的键原样显示） */
export function contactLabel(key: string): string {
  return CONTACT_LABELS[key] || PLATFORM_LABELS[key] || key
}

/**
 * 联系方式填写规范（2026-10 起）：
 * 下列「平台主页」类键必须填完整 http(s) 链接，展示端点图标才能一键跳转
 * （例：网易云主页 https://music.163.com/#/user/home?id=你的ID）；
 * qq/wechat/email/phone/mobile 属号码或文本，不做链接校验，展示端点图标弹复制框。
 * 只约束新填写/新保存，不洗历史数据。
 */
export const CONTACT_URL_TYPES = [
  'github', 'blog', 'bilibili', 'douyin', 'weibo', 'twitter',
  'xiaohongshu', 'netease', 'homepage',
]

/** 该联系方式类型是否要求填完整链接 */
export function isContactUrlType(key: string): boolean {
  return CONTACT_URL_TYPES.includes(key)
}

/** 校验单条联系方式：合法返回 null，非法返回中文错误文案（号码/文本类恒合法） */
export function contactValueError(key: string, value: string): string | null {
  if (!isContactUrlType(key)) return null
  let ok = false
  try {
    const u = new URL(value)
    ok = u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    ok = false
  }
  return ok ? null : `${CONTACT_LABELS[key] || key}请填写完整链接（https:// 开头），例如网易云主页 https://music.163.com/#/user/home?id=你的ID`
}

/** 联系方式输入框占位提示（仅链接类返回文案，号码类返回空串） */
export function contactPlaceholder(key: string): string {
  if (!isContactUrlType(key)) return ''
  switch (key) {
    case 'netease': return 'https://music.163.com/#/user/home?id=你的ID'
    case 'bilibili': return 'https://space.bilibili.com/你的ID'
    case 'github': return 'https://github.com/用户名'
    case 'weibo': return 'https://weibo.com/u/你的ID'
    case 'twitter': return 'https://x.com/用户名'
    case 'homepage': return 'https://你的主页地址'
    default: return '请输入完整主页链接（https://…）'
  }
}

export function artistTypeIcons(types: string[] | null | undefined): string {
  return (types || ['singer']).map(t => ARTIST_TYPE_ICONS[t] || '').join(' ')
}

/** 风格选项（后台歌曲表单与投稿审核共用） */
export const GENRE_OPTIONS = ['Hip-Hop', 'Chinese Rap', 'Rock', 'Mandopop', 'Cantopop', 'K-Pop', 'J-Pop', '抽象', 'Soundtrack', 'Vocaloid']

/** 站长贡献者固定 id（contributors 表 is_owner=true 的 X2ISPANDA；新增歌曲默认贡献者） */
export const OWNER_CONTRIBUTOR_ID = 'ct_owner'

/** 艺术家社交链接平台顺序（新增链接行默认 netease 网易云；ArtistsView 弹窗与 ArtistInlineForm 内联表单共用） */
export const ARTIST_URL_PLATFORMS = ['netease', 'qqmusic', 'weibo', 'bilibili', 'instagram', 'spotify', 'youtube', 'x', 'facebook', 'douyin', 'xiaohongshu', 'beatstars', 'official']

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
