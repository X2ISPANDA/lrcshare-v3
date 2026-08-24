import { supabase } from './supabase'
import type {
  Album,
  AlbumWithArtists,
  Artist,
  Article,
  Comment,
  Contributor,
  Friend,
  FriendCategory,
  Setting,
  Song,
  SongSubmissionData,
  SongWithNames,
  Sponsor,
} from './types'

/** 歌手字段精简选择（列表场景，避免拉全量） */
const ARTIST_LIST_FIELDS = 'id, name, sort, avatar, types, disambiguation, is_show, aliases, bio, urls, initial'

/** 批量取艺术家 id→name 映射 */
async function getArtistNameMap(ids: Iterable<string>): Promise<Map<string, string>> {
  const unique = [...new Set(ids)]
  const map = new Map<string, string>()
  if (unique.length === 0) return map
  const { data } = await supabase.from('artists').select('id, name').in('id', unique)
  ;(data || []).forEach(a => map.set(a.id, a.name))
  return map
}

/** 批量取艺术家 id→完整记录映射 */
async function getArtistFullMap(ids: Iterable<string>): Promise<Map<string, Artist>> {
  const unique = [...new Set(ids)]
  const map = new Map<string, Artist>()
  if (unique.length === 0) return map
  const { data } = await supabase
    .from('artists')
    .select('id, name, is_show, sort, avatar, types, disambiguation, aliases, bio, urls')
    .in('id', unique)
  ;(data || []).forEach(a => map.set(a.id, a as Artist))
  return map
}

function joinNames(ids: string[] | null | undefined, map: Map<string, string>): string {
  return (ids || []).map(id => map.get(id) || '').filter(Boolean).join(' / ')
}

/** 时长格式化（mm:ss） */
export function formatDuration(d: string | null | undefined): string {
  if (!d || d === 'NULL' || d === 'null') return '--:--'
  const s = String(d).trim().split('.')[0]
  const parts = s.split(':')
  if (parts.length === 2) {
    return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`
  }
  return s
}

/** SHA-256 哈希（贡献者口令验证） */
export async function sha256(str: string): Promise<string> {
  const data = new TextEncoder().encode(str)
  const hashBuffer = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(hashBuffer))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

export const api = {
  supabase,

  // ============ 艺术家 ============

  /** 艺术家列表（includeCount+limit 时走数据库 RPC，避免全量拉取） */
  async getArtists(options: { includeCount?: boolean; limit?: number } = {}): Promise<Artist[]> {
    const { includeCount = false, limit } = options
    if (includeCount && limit) {
      const { data, error } = await supabase.rpc('get_top_artists', { limit_count: limit })
      if (error) throw error
      return (data || []) as Artist[]
    }
    let query = supabase.from('artists').select(ARTIST_LIST_FIELDS).eq('is_show', true).order('name')
    if (limit) query = query.limit(limit)
    const { data, error } = await query
    if (error) throw error
    return (data || []) as Artist[]
  },

  async getArtist(id: string): Promise<Artist> {
    const { data, error } = await supabase.from('artists').select('*').eq('id', id).single()
    if (error) throw error
    return data as Artist
  },

  async getArtistsByIds(ids: string[]): Promise<Artist[]> {
    if (!ids || ids.length === 0) return []
    const { data, error } = await supabase.from('artists').select(ARTIST_LIST_FIELDS).in('id', ids)
    if (error) throw error
    return (data || []) as Artist[]
  },

  /** 同歌手的其他歌曲 */
  async getRelatedSongs(artistIds: string[], excludeSongId: string): Promise<Song[]> {
    if (!artistIds || artistIds.length === 0) return []
    const queries = artistIds.map(id =>
      supabase
        .from('songs')
        .select('id, title, artist_ids, album_id, duration, is_hidden, created_at, albums(name)')
        .eq('status', 'published')
        .contains('artist_ids', [id])
        .neq('id', excludeSongId),
    )
    const results = await Promise.all(queries)
    const seen = new Set<string>()
    const songs: Song[] = []
    results.forEach(r => {
      ;(r.data || []).forEach(s => {
        if (!seen.has(s.id)) {
          seen.add(s.id)
          songs.push(s as unknown as Song)
        }
      })
    })
    return songs
  },

  /** 艺术家的歌曲（演唱 + 作词/作曲/编曲） */
  async getArtistSongs(artistId: string): Promise<SongWithNames[]> {
    const [singRes, workRes] = await Promise.all([
      supabase
        .from('songs')
        .select('*, albums(name, year)')
        .eq('status', 'published')
        .overlaps('artist_ids', [artistId])
        .order('created_at', { ascending: false }),
      supabase
        .from('songs')
        .select('*, albums(name, year)')
        .eq('status', 'published')
        .or(
          `lyricist.ilike.%${artistId}%,composer.ilike.%${artistId}%,arranger.ilike.%${artistId}%`,
        )
        .order('created_at', { ascending: false }),
    ])
    if (singRes.error) throw singRes.error
    if (workRes.error) throw workRes.error

    const songMap = new Map<string, Song>()
    ;[...(singRes.data || []), ...(workRes.data || [])].forEach(s => {
      if (!songMap.has(s.id)) songMap.set(s.id, s as Song)
    })

    const nameMap = await getArtistNameMap(
      Array.from(songMap.values()).flatMap(s => s.artist_ids || []),
    )

    return Array.from(songMap.values()).map(s => ({
      ...s,
      artist_name: joinNames(s.artist_ids, nameMap),
      album_name: s.albums?.name || '',
      album_year: s.albums?.year || '',
    }))
  },

  /** 艺术家的专辑 */
  async getArtistAlbums(artistId: string): Promise<AlbumWithArtists[]> {
    const { data, error } = await supabase
      .from('albums')
      .select('*')
      .overlaps('artist_ids', [artistId])
      .order('name')
    if (error) throw error
    const albums = (data || []) as Album[]

    const fullMap = await getArtistFullMap(albums.flatMap(a => a.artist_ids || []))
    return albums.map(a => {
      const ids = a.artist_ids || []
      return {
        ...a,
        artist_name: ids.map(id => fullMap.get(id)?.name || '').filter(Boolean).join(' / ') || '未知',
        artists: ids.map(id => fullMap.get(id)).filter((x): x is Artist => !!x),
      }
    })
  },

  // ============ 专辑 ============

  async getAlbums(includeCount = false): Promise<AlbumWithArtists[]> {
    const { data, error } = await supabase.from('albums').select('*').order('name')
    if (error) throw error
    const albums = (data || []) as Album[]

    const fullMap = await getArtistFullMap(albums.flatMap(a => a.artist_ids || []))

    // 批量查询所有专辑的歌曲数（1 次请求替代 N 次）
    const countMap = new Map<string, number>()
    if (includeCount && albums.length > 0) {
      const { data: countData } = await supabase
        .from('songs')
        .select('album_id')
        .in('album_id', albums.map(a => a.id))
        .eq('status', 'published')
      ;(countData || []).forEach(s => {
        if (s.album_id) countMap.set(s.album_id, (countMap.get(s.album_id) || 0) + 1)
      })
    }

    return albums.map(a => {
      const ids = a.artist_ids || []
      const result: AlbumWithArtists = {
        ...a,
        artist_name: ids.map(id => fullMap.get(id)?.name || '').filter(Boolean).join(' / ') || '未知',
        artists: ids.map(id => fullMap.get(id)).filter((x): x is Artist => !!x),
      }
      if (includeCount) result.song_count = countMap.get(a.id) || 0
      return result
    })
  },

  async getAlbum(id: string): Promise<AlbumWithArtists> {
    const { data, error } = await supabase.from('albums').select('*').eq('id', id).single()
    if (error) throw error
    const album = data as Album

    const ids = album.artist_ids || []
    const fullMap = await getArtistFullMap(ids)
    return {
      ...album,
      artist_name: ids.map(id => fullMap.get(id)?.name || '').filter(Boolean).join(' / ') || '未知',
      artists: ids.map(id => fullMap.get(id)).filter((x): x is Artist => !!x),
    }
  },

  async getAlbumSongs(albumId: string): Promise<SongWithNames[]> {
    const { data, error } = await supabase
      .from('songs')
      .select('*')
      .eq('album_id', albumId)
      .eq('status', 'published')
      .order('track')
    if (error) throw error

    const nameMap = await getArtistNameMap((data || []).flatMap(s => s.artist_ids || []))
    return (data || []).map(s => ({
      ...s,
      artist_name: joinNames(s.artist_ids, nameMap) || '未知',
    }))
  },

  // ============ 歌曲 ============

  /** 歌曲列表（不含 lrc_text） */
  async getSongs(limit?: number): Promise<SongWithNames[]> {
    let query = supabase
      .from('songs')
      .select(
        'id, title, artist_ids, album_id, lyricist, composer, arranger, duration, track, disc, status, is_hidden, cover, created_at, albums(name, cover)',
      )
      .eq('status', 'published')
      .order('created_at', { ascending: false })
    if (limit) query = query.limit(limit)
    const { data, error } = await query
    if (error) throw error

    const nameMap = await getArtistNameMap((data || []).flatMap(s => s.artist_ids || []))
    return (data || []).map(s => {
      const { albums, ...rest } = s
      return {
        ...rest,
        artist_name: joinNames(s.artist_ids, nameMap) || '未知',
        album_name: (albums as unknown as { name?: string })?.name || '',
        album_cover: (albums as unknown as { cover?: string | null })?.cover || null,
      } as SongWithNames
    })
  },

  async getSong(id: string): Promise<SongWithNames & { artists: Artist[]; credit_artists: Artist[] }> {
    const { data, error } = await supabase
      .from('songs')
      .select('*, albums(name, year, cover)')
      .eq('id', id)
      .single()
    if (error) throw error

    const ids = (data.artist_ids as string[]) || []
    // 作词/作曲/编曲字段的 id 也需解析为名称（可能含未出现在 artist_ids 中的编曲人等）
    const creditIds = [data.lyricist, data.composer, data.arranger]
      .filter(Boolean)
      .join(',')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
    const fullMap = await getArtistFullMap([...ids, ...creditIds])
    const album = data.albums as unknown as { name?: string; year?: string; cover?: string | null } | null
    return {
      ...data,
      artist_name: ids.map(id => fullMap.get(id)?.name || '').filter(Boolean).join(' / ') || '未知',
      artists: ids.map(id => fullMap.get(id)).filter((x): x is Artist => !!x),
      credit_artists: creditIds.map(id => fullMap.get(id)).filter((x): x is Artist => !!x),
      album_name: album?.name || '',
      album_year: album?.year || '',
      album_cover: album?.cover || null,
    }
  },

  // ============ 搜索（本地模糊搜索，四个维度独立匹配，供结果区 tab 切换） ============

  async search(keyword: string): Promise<{
    artists: Artist[]
    albums: Album[]
    songs: SongWithNames[]
    lyrics: SongWithNames[]
  }> {
    const kw = keyword.trim().toLowerCase()
    if (!kw) return { artists: [], albums: [], songs: [], lyrics: [] }

    const songSelect = '*, albums(name)'
    // or() 语法以逗号/括号分组，关键词中含这些字符会破坏查询语法，剔除之
    const kwOr = kw.replace(/[(),]/g, ' ').trim()
    const [artistRes, albumRes, songTitleRes, songLrcRes] = await Promise.all([
      // 歌手：仅匹配艺术家名
      supabase.from('artists').select('*').ilike('name', `%${kw}%`),
      // 专辑：仅匹配专辑名（不含专辑艺术家）
      supabase.from('albums').select('*').ilike('name', `%${kw}%`),
      // 单曲：匹配歌曲名或别名/译名（search_songs RPC，数组列 ilike 需在库端 unnest）
      supabase.rpc('search_songs', { p_q: kw }).select(songSelect),
      // 歌词：匹配 LRC 或纯文本歌词内容（同一首去重，纯逗号输入时跳过）
      kwOr
        ? supabase
            .from('songs')
            .select(songSelect)
            .eq('status', 'published')
            .or(`lrc_text.ilike.%${kwOr}%,lyrics_text.ilike.%${kwOr}%`)
        : Promise.resolve({ data: null as any[] | null }),
    ])

    const songMap = new Map<string, any>()
    ;((songTitleRes.data as any[]) || []).forEach((s: any) => songMap.set(s.id, s))
    const lrcMap = new Map<string, any>()
    ;(songLrcRes.data || []).forEach(s => lrcMap.set(s.id, s))

    const nameMap = await getArtistNameMap(
      Array.from([...songMap.values(), ...lrcMap.values()]).flatMap(s => s.artist_ids || []),
    )
    const decorate = (s: any): SongWithNames => ({
      ...s,
      artist_name: joinNames(s.artist_ids, nameMap) || '未知',
      album_name: s.albums?.name || '',
    })

    return {
      artists: (artistRes.data || []) as Artist[],
      albums: (albumRes.data || []) as Album[],
      songs: Array.from(songMap.values()).map(decorate),
      lyrics: Array.from(lrcMap.values()).map(decorate),
    }
  },

  // ============ 投稿 ============

  async submitSubmissionV2(payload: {
    submitter_name?: string
    contact_types?: string[]
    contact_value?: Record<string, string>
    submitter_public_contact?: boolean
    contributor_id?: string | null
    submitter_request_update?: boolean
    submitter_request_clear?: boolean
    submitter_bio?: string | null
    song_data: SongSubmissionData
  }): Promise<null> {
    const { error } = await supabase.from('submissions').insert([
      {
        id: 'sub' + Date.now(),
        user_name: payload.submitter_name || '匿名',
        contact_types: payload.contact_types || [],
        contact_value: payload.contact_value || {},
        submitter_public_contact: !!payload.submitter_public_contact,
        contributor_id: payload.contributor_id || null,
        submitter_request_update: !!payload.submitter_request_update,
        submitter_request_clear: !!payload.submitter_request_clear,
        submitter_bio: payload.submitter_bio,
        song_data: payload.song_data,
        status: 'pending',
        created_at: new Date().toISOString(),
      },
    ])
    if (error) throw error
    return null
  },

  // ============ 贡献者口令（Twikoo 评论身份徽章验证用） ============

  async verifyContributor(name: string, verifyCode: string): Promise<Contributor | null> {
    try {
      const hash = await sha256(verifyCode)
      const { data } = await supabase
        .from('contributors')
        .select('id, name, is_owner, avatar, tags')
        .ilike('name', name)
        .eq('verify_code_hash', hash)
      if (!data || data.length === 0) return null
      return data[0] as Contributor
    } catch {
      return null
    }
  },

  async changeVerifyCode(
    contributorId: string,
    oldCode: string,
    newCode: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const oldHash = await sha256(oldCode)
      const newHash = await sha256(newCode)
      const { data: verify } = await supabase
        .from('contributors')
        .select('id')
        .eq('id', contributorId)
        .eq('verify_code_hash', oldHash)
      if (!verify || verify.length === 0) {
        return { success: false, error: '旧口令不正确' }
      }
      const { error } = await supabase
        .from('contributors')
        .update({ verify_code_hash: newHash })
        .eq('id', contributorId)
      if (error) throw error
      return { success: true }
    } catch (e) {
      return { success: false, error: (e as Error).message }
    }
  },

  // ============ 赞助 ============

  async getSponsors(): Promise<Sponsor[]> {
    const { data, error } = await supabase
      .from('sponsors')
      .select('*')
      .order('amount', { ascending: false })
    if (error) throw error
    return (data || []) as Sponsor[]
  },

  // ============ 文章 ============

  async getArticles(
    options: { status?: string; limit?: number; includeDrafts?: boolean } = {},
  ): Promise<Article[]> {
    const { status = 'published', limit, includeDrafts = false } = options
    let query = supabase.from('articles').select('*')
    if (!includeDrafts) query = query.eq('status', status)
    query = query.order('sort', { ascending: true }).order('created_at', { ascending: false })
    if (limit) query = query.limit(limit)
    const { data, error } = await query
    if (error) throw error
    return (data || []) as Article[]
  },

  async getArticleBySlug(slug: string): Promise<Article> {
    const { data, error } = await supabase.from('articles').select('*').eq('slug', slug).single()
    if (error) throw error
    return data as Article
  },

  /** 浏览量 +1（仅客户端调用，SSG 构建时不可执行，否则每次构建都涨） */
  async incrementArticleView(id: string): Promise<void> {
    const { data } = await supabase.from('articles').select('views').eq('id', id).single()
    try {
      await supabase.from('articles').update({ views: (data?.views || 0) + 1 }).eq('id', id)
    } catch {
      /* 忽略 */
    }
  },

  // ============ 贡献者 ============

  async getContributors(options: { limit?: number } = {}): Promise<Contributor[]> {
    // 统一走 RPC：返回 song_count，并按置顶(sort>0)→歌曲数降序→加入时间排序；
    // limit_count 传 null 时 PG 的 LIMIT NULL 等于不加限制（返回全部）
    const { data, error } = await supabase.rpc('get_top_contributors', {
      limit_count: options.limit ?? null,
    })
    if (error) throw error
    return (data || []) as Contributor[]
  },

  async getContributor(id: string): Promise<Contributor> {
    const { data, error } = await supabase
      .from('contributors')
      .select(
        'id, name, avatar, bio, public_bio, contact_value, public_contact, tags, is_owner, created_at, sort',
      )
      .eq('id', id)
      .single()
    if (error) throw error
    const { count } = await supabase
      .from('songs')
      .select('id', { count: 'exact', head: true })
      .eq('contributor_id', id)
      .eq('status', 'published')
    return { ...(data as Contributor), song_count: count || 0 }
  },

  async getContributorWorks(
    contributorId: string,
  ): Promise<{ id: string; title: string; artist: string; type: string; created_at: string }[]> {
    const { data: songs } = await supabase
      .from('songs')
      .select('id, title, artist_ids, created_at')
      .eq('contributor_id', contributorId)
      .eq('status', 'published')
      .order('created_at', { ascending: false })

    if (songs && songs.length > 0) {
      const nameMap = await getArtistNameMap(songs.flatMap(s => s.artist_ids || []))
      return songs.map(s => ({
        id: s.id,
        title: s.title,
        artist: joinNames(s.artist_ids, nameMap),
        type: 'song',
        created_at: s.created_at,
      }))
    }

    // 回退：submissions 表按提交者名模糊匹配
    const contributor = await this.getContributor(contributorId)
    if (contributor?.name) {
      const { data: submissions } = await supabase
        .from('submissions')
        .select('id, created_at, song_data->title, song_data->artist, song_data->type')
        .eq('status', 'approved')
        .ilike('user_name', `%${contributor.name}%`)
        .order('created_at', { ascending: false })
      return (submissions || []).map((s: Record<string, any>) => ({
        id: s.id,
        title: s['song_data->title'] || '',
        artist: s['song_data->artist'] || '',
        type: s['song_data->type'] || 'song',
        created_at: s.created_at,
      }))
    }
    return []
  },

  // ============ 友链 ============

  async getFriendCategories(): Promise<FriendCategory[]> {
    const { data, error } = await supabase
      .from('friend_categories')
      .select('*')
      .order('sort', { ascending: true })
    if (error) throw error
    return (data || []) as FriendCategory[]
  },

  async getFriends(): Promise<(Friend & { category: FriendCategory | null })[]> {
    const categories = await this.getFriendCategories()
    const catMap = new Map(categories.map(c => [c.id, c]))

    const { data, error } = await supabase
      .from('friends')
      .select('*')
      .order('sort', { ascending: true })
      .order('created_at', { ascending: false })
    if (error) throw error
    return (data || []).map(f => ({
      ...f,
      category: f.category_id ? catMap.get(f.category_id) || null : null,
    }))
  },

  // ============ 设置（管理后台用） ============

  async getSettings(): Promise<Record<string, string>> {
    const { data, error } = await supabase.from('settings').select('key, value')
    if (error) throw error
    const map: Record<string, string> = {}
    ;(data || []).forEach((r: Setting) => {
      map[r.key] = r.value
    })
    return map
  },
}

/**
 * 旧版自研评论 API（comments 表）。
 * 评论已切换 Twikoo，仅当 Phase 3 确认仍有页面依赖时再启用。
 */
export const legacyCommentsApi = {
  async getComments(_songId: string): Promise<Comment[]> {
    return []
  },
}
