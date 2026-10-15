/**
 * 数据库表类型定义（与 Supabase schema 对应）
 * 字段类型以 v2 查询实际使用的为准，Phase 2 迁移页面时逐页校准
 */

/** 艺术家 */
export interface Artist {
  id: string
  name: string
  avatar: string | null
  /** 头像 OSS 备份（灾备切换列；image_source=aliyun 时替代 avatar，空值回退） */
  avatar_backup?: string | null
  /** 身份类型：singer/lyricist/composer/arranger 等 */
  types: string[] | null
  /** 消歧义信息（同名艺术家区分） */
  disambiguation: string | null
  /** 别名 */
  aliases: string[] | null
  /** 简介 */
  bio?: string | null
  /** 社交链接（key: instagram/weibo/bilibili/netease/qq/github） */
  urls?: Record<string, string> | null
  /** 详情页背景图 */
  bg_image?: string | null
  /** 背景图 OSS 备份（灾备切换列；image_source=aliyun 时替代 bg_image，空值回退） */
  bg_image_backup?: string | null
  /** 背景图纵向位置（百分比） */
  bg_position_y?: number | null
  /** 手动置顶排序，越大越靠前 */
  sort: number
  /** 是否前台展示（false 仅用于唱片公司等非创作者实体） */
  is_show: boolean
  /** 人工覆盖的拼音首字母（A-Z 或 #），空则前端自动计算（多音字兜底） */
  initial?: string | null
  created_at?: string
}

/** 专辑 */
export interface Album {
  id: string
  name: string
  cover: string | null
  /** 封面 OSS 备份（灾备切换列；image_source=aliyun 时替代 cover，空值回退） */
  cover_backup?: string | null
  year: string | null
  /** 专辑艺术家（可含唱片公司等非创作者实体）——api 层由 album_contributors 中间表计算装饰 */
  artist_ids: string[] | null
  /** 关联查询带出（中间表嵌入） */
  album_contributors?: { artist_id: string }[] | null
  /** 人工覆盖的拼音首字母（A-Z 或 #），空则前端自动计算（多音字兜底） */
  initial?: string | null
  /** 专辑介绍（Markdown 富文本，前台专辑页展示） */
  description?: string | null
  created_at?: string
}

/** 歌曲 */
export interface Song {
  id: string
  title: string
  /** 别名/译名（同一首可并存中日英多名，参与单曲维度搜索） */
  aliases?: string[] | null
  /** 演唱者（= song_contributors 中 role=singer，api 层计算装饰） */
  artist_ids: string[] | null
  album_id: string | null
  /** 贡献关系（中间表嵌入；作词/作曲/编曲/歌手统一在此，不再有独立列） */
  song_contributors?: { role: string; artist_id: string }[] | null
  duration: string | null
  track: number | null
  disc: number | null
  status: 'published' | 'draft' | 'pending'
  /** 隐藏歌曲（口令解锁；口令存 song_secrets 独立表，经 verify RPC 校验，前端永不接触明文） */
  is_hidden: boolean
  /** 歌曲简介（Markdown，支持 Hexo tip 标签） */
  description?: string | null
  /** 流派 */
  genres?: string[] | null
  lrc_text?: string | null
  /** 纯文本/富文本歌词（优先于 LRC 提取展示） */
  lyrics_text?: string | null
  video_url?: string | null
  /** 单曲封面（预热单曲等场景；为空时回退专辑封面） */
  cover?: string | null
  /** 单曲封面 OSS 备份（灾备切换列；空值回退 cover / 专辑封面） */
  cover_backup?: string | null
  contributor_id?: string | null
  created_at: string
  /** 关联查询带出 */
  albums?: { name: string; year?: string; cover?: string | null } | null
}

/** 带作品数的艺术家（RPC get_top_artists 返回） */
export interface ArtistWithCount extends Artist {
  song_count?: number
}

/** 艺术家标签（ArtistTagInput 的 v-model 元素）：{id, name} 基础上可携带补全信息；
 *  id 为 null 表示待创建（信息随提交入库），有 id 时补全信息可当场写库 */
export interface ArtistTag {
  id: string | null
  name: string
  avatar?: string | null
  types?: string[] | null
  disambiguation?: string | null
  aliases?: string[] | null
  bio?: string | null
  urls?: Record<string, string> | null
  /** 待创建艺术家是否前台展示（审核/录歌新建链路使用） */
  is_show?: boolean
  /** 投稿待创建标记（审核链路使用） */
  _new?: boolean
}

/** 带艺术家名等展示字段的歌曲（API 层组装） */
export interface SongWithNames extends Song {
  artist_name: string
  album_name?: string
  album_year?: string
  album_cover?: string | null
  /** 投稿人（列表接口 embed 带出；官方/Hub 导入的歌可能为空） */
  contributor?: { id: string; name: string; avatar: string | null } | null
}

/** 带艺术家信息的专辑（API 层组装） */
export interface AlbumWithArtists extends Album {
  artist_name: string
  artists: Artist[]
  song_count?: number
}

/** 贡献者 */
export interface Contributor {
  id: string
  name: string
  avatar: string | null
  /** 头像 OSS 备份（灾备切换列；image_source=aliyun 时替代 avatar，空值回退） */
  avatar_backup?: string | null
  bio: string | null
  /** 公开简介（false 时前台不展示 bio） */
  public_bio: boolean
  /** 联系方式（key 为类型 email/weibo/qq/bilibili 等，value 为账号/地址） */
  contact_value?: Record<string, string> | null
  public_contact: boolean
  /** 身份标签 */
  tags: string[] | null
  /** 是否站长 */
  is_owner: boolean
  sort: number
  created_at: string
  song_count?: number
}

/** 投稿（song_data 的多艺术家结构） */
export interface SongSubmissionData {
  type: string
  title: string
  /** type='song_version'（为已有歌曲补充歌词版本）时：目标歌曲 id/标题（发布时跳过建歌，只写版本） */
  song_id?: string
  song_title?: string
  /** 多艺术家数组，id 为 null 表示用户新建 */
  artists: { id: string | null; name: string }[]
  album_artists: { id: string | null; name: string }[]
  lyricist_arr: { id: string | null; name: string }[]
  composer_arr: { id: string | null; name: string }[]
  arranger_arr?: { id: string | null; name: string }[]
  album?: string
  album_id?: string | null
  year?: string
  duration?: string
  lrc_text: string
  /** 多语言版本（审核端精确写行表；缺省发布时按 lrc_text 自动拆分） */
  versions?: { lang: string; kind: string; lrc: string }[]
  /** TTML 原文（含对唱/分屏/样式；发布时独立落盘 lyric_versions.ttml_text） */
  ttml_text?: string
  video_url?: string
}

/** 投稿记录 */
export interface Submission {
  id: string
  user_name: string
  song_data: SongSubmissionData
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn'
  contact_value?: Record<string, string>
  submitter_public_contact?: boolean
  contributor_id?: string | null
  submitter_request_update?: boolean
  submitter_request_clear?: boolean
  submitter_bio?: string | null
  user_email?: string | null
  reject_reason?: string | null
  created_at: string
}

/** 文章 */
export interface Article {
  id: string
  slug: string
  title: string
  content: string
  cover?: string | null
  /** 封面 OSS 备份（灾备切换列；image_source=aliyun 时替代 cover，空值回退） */
  cover_backup?: string | null
  summary?: string | null
  /** 作者（'站长' 时前台替换为站长真实名称） */
  author?: string | null
  status: 'published' | 'draft'
  sort: number
  created_at: string
  updated_at?: string
}

/** 友链分类 */
export interface FriendCategory {
  id: string
  name: string
  /** 分类颜色（十六进制，前端展示用） */
  color: string | null
  /** 分类图标（emoji） */
  icon: string | null
  sort: number
  created_at: string
}

/** 友链 */
export interface Friend {
  id: string
  name: string
  url: string
  avatar: string | null
  /** 头像 OSS 备份（灾备切换列；image_source=aliyun 时替代 avatar，空值回退） */
  avatar_backup?: string | null
  descr: string | null
  category_id: string | null
  /** 附加链接数组：label 为平台英文键（与 AppIcon ICON_MAP 对齐），url 为链接 */
  extra_links: { label: string; url: string }[] | null
  sort: number
  created_at: string
  category?: FriendCategory | null
}

/** 赞助者 */
export interface Sponsor {
  id: string
  name: string
  /** numeric(10,2)，API 返回字符串 */
  amount: string
  /** 赞助日期 YYYY-MM-DD */
  datatime: string
  /** 金额后缀（默认"元"） */
  suffix: string | null
  /** 描述 */
  descr: string | null
  /** 广告标题 */
  title: string | null
  /** 广告链接 */
  url: string | null
  created_at?: string
}

// ============ 歌曲分享（music_shares） ============

/** 歌曲分享审核状态 */
export type MusicShareStatus = 'pending' | 'approved' | 'rejected'

/** 歌曲分享记录（前台只可能收到 approved；后台三态全量） */
export interface MusicShare {
  id: string
  platform: import('./musicPlatforms').MusicPlatformKey
  /** song=单曲/视频，album=专辑 */
  media_type: import('./musicPlatforms').MusicMediaType
  platform_id: string
  source_url: string
  title: string
  artist: string | null
  cover_url: string | null
  /** 平台封面 OSS 备份（灾备切换列；image_source=aliyun 时替代 cover_url，空值回退） */
  cover_url_backup?: string | null
  /** 专辑曲目快照（单曲为 null）：识别时写入，播放时展开为队列，避免每次依赖平台接口拉取 */
  tracks?: import('./musicPlatforms').MusicTrack[] | null
  reason: string | null
  /** 投稿人自荐本人原创作品（仅本条使用创作者卡片样式，审核可改） */
  is_own_work: boolean
  /** 审核通过后绑定的贡献者账号 */
  contributor_id: string | null
  submitter_name: string
  submitter_contact: Record<string, string> | null
  /** 投稿人勾选的联系方式公开意愿（false=仅站长可见；通过并新建贡献者时据此写入 public_contact） */
  submitter_public_contact: boolean
  user_email: string | null
  /** 借歌曲投稿请求更新本人资料（审核通过时全量覆盖；仅 contributor_id 命中已有账号时有意义） */
  submitter_request_update: boolean
  /** 借歌曲投稿请求清空本人资料（与 update 互斥；通过时除 ID/昵称/标签外置空） */
  submitter_request_clear: boolean
  /** 投稿人简介快照（新建/更新贡献者时写入 contributors.bio；纯引用身份为 null） */
  submitter_bio: string | null
  /** >0 手动置顶（数字小在前），0 按通过时间倒序 */
  sort: number
  /**
   * 首页「新歌推荐」置顶截止时间（ISO 字符串）：
   * null 或已过期 = 未置顶（首页随机推荐位走随机）；未过期 = 置顶中，多条按 created_at 轮播。
   * 仅站长后台可写（anon 插入列白名单不含此列），到期只影响首页推荐位，分享本身不下线。
   */
  pinned_until?: string | null
  status: MusicShareStatus
  reject_reason: string | null
  reviewed_at: string | null
  approved_at: string | null
  created_at: string
  updated_at: string
  /** 关联贡献者（前台列表通过 PostgREST 嵌套带出；含公开联系方式供自荐卡展示图标） */
  contributor?: Pick<Contributor, 'id' | 'name' | 'avatar' | 'tags' | 'public_contact' | 'contact_value'> | null
}

/** 匿名投稿写入载荷（列必须与 SQL 的 anon INSERT 白名单一致） */
export interface MusicShareInsert {
  id?: string
  platform: import('./musicPlatforms').MusicPlatformKey
  media_type: import('./musicPlatforms').MusicMediaType
  platform_id: string
  source_url: string
  title: string
  artist?: string | null
  cover_url?: string | null
  /** 专辑曲目快照（单曲省略或 null） */
  tracks?: import('./musicPlatforms').MusicTrack[] | null
  reason?: string | null
  is_own_work?: boolean
  /** 昵名下拉命中已有贡献者时上送（FK 保证真实存在），未命中为 null */
  contributor_id?: string | null
  submitter_name: string
  submitter_contact?: Record<string, string>
  /** 投稿人公开联系方式意愿（省略按数据库默认 false）；须与 SQL anon INSERT 白名单一致 */
  submitter_public_contact?: boolean
  user_email?: string | null
  /** 借歌曲投稿更新/清空本人资料（须与 SQL anon INSERT 白名单一致，默认 false） */
  submitter_request_update?: boolean
  submitter_request_clear?: boolean
  /** 投稿人简介快照（新建/更新贡献者时落 contributors.bio；纯引用身份省略） */
  submitter_bio?: string | null
  created_at?: string
}

/** check_music_share_dup RPC 的返回结构 */
export interface MusicShareDupHints {
  /** 同平台同内容已有待审（任意人提交） */
  platform_pending: boolean
  /** 同平台同内容已通过的最小展示信息 */
  platform_approved: { id: string; title: string; contributor_name: string } | null
  /** 跨平台同名同歌手已有待审 */
  song_pending: boolean
  /** 跨平台同名同歌手已通过 */
  song_approved:
    | { id: string; title: string; artist: string | null; platform: string; contributor_name: string }
    | null
}

/** 站点设置（key-value） */
export interface Setting {
  key: string
  value: string
}
