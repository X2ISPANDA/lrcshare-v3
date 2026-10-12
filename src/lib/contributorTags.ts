/**
 * 贡献者标签工具
 *
 * 「歌曲分享」账号规则（方案定稿）：
 * - 歌曲分享投稿的新昵称，审核通过创建贡献者时只打这一个标签（不设音乐人标签）；
 * - 首页「优秀贡献者」与贡献者名单两个展示位，过滤掉 tags 恰好只有
 *   「歌曲分享」的账号（他们没有歌词类贡献，不进歌词站贡献榜）；
 * - ⚠️ 红线：所有用户名下拉框（歌词投稿 / 补版本 / 歌曲分享 / 评论区 / 文章作者）
 *   必须全量不过滤，本文件的过滤函数只允许用于纯展示位。
 */

/** 歌曲分享账号专属标签（必须与后台 PRESET_TAGS 中的文案逐字一致） */
export const MUSIC_ONLY_TAG = '歌曲分享'

/** tags 兼容数组 / 逗号分隔字符串的规范化（去空白、去空项） */
export function normalizeTags(tags: string[] | string | null | undefined): string[] {
  if (!tags) return []
  if (Array.isArray(tags)) return tags.map(t => String(t || '').trim()).filter(Boolean)
  return String(tags)
    .split(/[,，]/)
    .map(s => s.trim())
    .filter(Boolean)
}

/**
 * 是否「仅歌曲分享」账号：标签恰好只有「歌曲分享」一个。
 * 同时带有任何其他标签（如「歌词提交」）的账号不算，仍在贡献榜正常展示。
 */
export function isMusicOnlyContributor(
  c: { tags?: string[] | string | null } | null | undefined,
): boolean {
  const t = normalizeTags(c?.tags)
  return t.length === 1 && t[0] === MUSIC_ONLY_TAG
}
