import { supabase } from './supabase'

/**
 * 艺术家类型（types）派生重算：不由人工编辑，一律从歌曲/专辑关联计算——
 * 演唱（songs.artist_ids）或专辑艺术家（albums.artist_ids）→ singer；
 * songs.lyricist / composer / arranger（ID 逗号分隔）→ 对应类型。
 * 计算在 Postgres 端完成（sql/recompute-artist-types.md 的 recompute_artist_types RPC），
 * 前端一次调用，不再拉全表到浏览器。传空 = 全量重算。
 */
export async function recomputeArtistTypes(artistIds?: (string | null | undefined)[]) {
  const ids = artistIds && artistIds.length
    ? [...new Set(artistIds.filter(Boolean) as string[])]
    : null
  const { error } = await supabase.rpc('recompute_artist_types', ids ? { p_artist_ids: ids } : {})
  if (error) throw error
}
