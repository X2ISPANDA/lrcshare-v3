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
  /** 专辑艺术家（可含唱片公司等非创作者实体） */
  artist_ids: string[] | null
  /** 人工覆盖的拼音首字母（A-Z 或 #），空则前端自动计算（多音字兜底） */
  initial?: string | null
  created_at?: string
}

/** 歌曲 */
export interface Song {
  id: string
  title: string
  artist_ids: string[] | null
  album_id: string | null
  lyricist: string | null
  composer: string | null
  arranger: string | null
  duration: string | null
  track: number | null
  disc: number | null
  status: 'published' | 'draft' | 'pending'
  /** 隐藏歌曲（口令解锁） */
  is_hidden: boolean
  /** 隐藏歌曲专属解锁口令（另有全局口令存 settings 表） */
  unlock_code?: string | null
  /** 歌曲简介（Markdown，支持 Hexo tip 标签） */
  description?: string | null
  /** 流派 */
  genres?: string[] | null
  lrc_text?: string | null
  /** 纯文本/富文本歌词（优先于 LRC 提取展示） */
  lyrics_text?: string | null
  video_url?: string | null
  contributor_id?: string | null
  created_at: string
  /** 关联查询带出 */
  albums?: { name: string; year?: string; cover?: string | null } | null
}

/** 带作品数的艺术家（RPC get_top_artists 返回） */
export interface ArtistWithCount extends Artist {
  song_count?: number
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
  /** 使用的联系方式类型（email/weibo/qq/bilibili 等） */
  contact_types?: string[] | null
  /** 联系方式（key 为类型，value 为账号/地址） */
  contact_value?: Record<string, string> | null
  public_contact: boolean
  /** 身份标签 */
  tags: string[] | null
  /** 是否站长 */
  is_owner: boolean
  /** 口令哈希（SHA-256，评论区身份验证用） */
  verify_code_hash?: string | null
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
  /** 兼容旧格式的拼接字符串 */
  artist?: string
  album_artist?: string
  lyricist?: string
  composer?: string
  album?: string
  album_id?: string | null
  year?: string
  arranger?: string
  duration?: string
  lrc_text: string
  video_url?: string
}

/** 投稿记录 */
export interface Submission {
  id: string
  user_name: string
  song_data: SongSubmissionData
  status: 'pending' | 'approved' | 'rejected' | 'withdrawn'
  contact_types?: string[]
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
  /** 分类：news 喜报 / tutorial 教程 / notice 公告 / post 文章 */
  type?: string | null
  status: 'published' | 'draft'
  sort: number
  views: number
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

/** 评论（Twikoo 之前的自研评论表，Phase 3 确认是否仍有使用） */
export interface Comment {
  id: string
  song_id: string
  author: string
  email?: string
  content: string
  parent_id: string | null
  root_id: string | null
  is_deleted: boolean
  created_at: string
}

/** 站点设置（key-value） */
export interface Setting {
  key: string
  value: string
}
