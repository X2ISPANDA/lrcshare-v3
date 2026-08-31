/**
 * 数据库表类型定义（与 Supabase schema 对应）
 * 字段类型以 v2 查询实际使用的为准，Phase 2 迁移页面时逐页校准
 */

/** 艺术家 */
export interface Artist {
  id: string
  name: string
  avatar: string | null
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
  /** 头像 URL */
  avatar?: string | null
  created_at?: string
}

/** 站点设置（key-value） */
export interface Setting {
  key: string
  value: string
}
