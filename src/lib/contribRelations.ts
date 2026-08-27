import { adminApi } from './adminApi'

/**
 * 贡献关系中间表（song_contributors / album_contributors）同步。
 *
 * 阶段二批次 1：后台写入链双写——旧列（artist_ids/lyricist/composer/arranger）照常写
 * （前台与 Worker 读路径尚未切换），同时把关系写入中间表（RPC 已双源，两个来源并集生效）。
 * 批次 3 读路径全部切换 + B 段删旧列后，中间表成为唯一数据源。
 *
 * 同步语义：全量替换（先删该歌曲/专辑的全部关系行，再按入参插入）——幂等、
 * 与 recompute_artist_types 的覆盖式哲学一致。
 */

export type ContributorRole = 'singer' | 'lyricist' | 'composer' | 'arranger'

export interface SongRoles {
  singer?: string[]
  lyricist?: string[]
  composer?: string[]
  arranger?: string[]
}

const uniq = (ids: (string | undefined | null)[] | undefined) =>
  [...new Set((ids || []).map(x => x && String(x).trim()).filter(Boolean))] as string[]

/** 同步一首歌的全部贡献关系（全量替换该 song_id 的行）。须在歌曲行插入之后调用（FK）。 */
export async function syncSongContributors(songId: string, roles: SongRoles): Promise<void> {
  await adminApi.removeWhere('song_contributors', 'song_id', songId)
  const rows: { song_id: string; artist_id: string; role: ContributorRole }[] = []
  for (const role of ['singer', 'lyricist', 'composer', 'arranger'] as ContributorRole[]) {
    for (const artistId of uniq(roles[role])) {
      rows.push({ song_id: songId, artist_id: artistId, role })
    }
  }
  await adminApi.insertBatch('song_contributors', rows)
}

/** 同步专辑艺术家关系（全量替换该 album_id 的行）。须在专辑行插入/更新之后调用（FK）。 */
export async function syncAlbumContributors(albumId: string, artistIds: (string | undefined | null)[]): Promise<void> {
  await adminApi.removeWhere('album_contributors', 'album_id', albumId)
  const ids = uniq(artistIds)
  const rows = ids.map(artist_id => ({ album_id: albumId, artist_id }))
  await adminApi.insertBatch('album_contributors', rows)
}

/** 同步歌曲独立解锁口令到 song_secrets（phase3 拆表后的权威数据源）。
 *  口令非空 → upsert；清空 → 删行（回退全局口令）。songs.unlock_code 旧列过渡期由调用方双写兜底。 */
export async function syncSongSecrets(songId: string, unlockCode: string): Promise<void> {
  const code = (unlockCode || '').trim()
  if (code) {
    await adminApi.upsert('song_secrets', { song_id: songId, unlock_code: code }, 'song_id')
  } else {
    await adminApi.removeWhere('song_secrets', 'song_id', songId)
  }
}
