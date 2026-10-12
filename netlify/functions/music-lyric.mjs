// @ts-check
/**
 * 歌曲分享 · 歌词获取函数（Netlify Function）
 *
 * GET /api/music-lyric?platform=netease&id=<平台曲目 ID>
 *   （netlify.toml redirect 到 /.netlify/functions/music-lyric）
 *
 * 为什么需要它：
 *   网易云歌词接口（/api/song/lyric）与播放直链一样属于非官方内部接口，
 *   不应在前端直连；统一由本函数在播放端需要时实时拉取（歌词不入库）。
 *
 * 返回（全站统一 {code,data} 约定）：
 *   成功 { code: 0, data: {
 *            lrc: string | null,      // 原文 LRC（带 [mm:ss.xxx] 时间轴），无词为 null
 *            tlyric: string | null,   // 译文 LRC（部分歌曲有，日文歌多见），无译为 null
 *            instrumental: boolean    // true=纯音乐（接口显式返回 nolyric）
 *          } }
 *   失败 { code: 非 0, error: '中文原因' }
 *
 * 安全：仅允许白名单平台与严格 ID 形态（网易云为纯数字）；不带任何用户 cookie。
 * 歌词为公开文本数据，允许 CDN/浏览器短缓存（lrc 版本号变更后 URL 不变，
 * 故仅给浏览器 60s 短缓存，避免改词后长时间不更新）。
 */

import Meting from '@meting/core'

const ALLOWED_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*lrcshare\.com$|^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/

function corsHeaders(origin) {
  const h = {
    'Content-Type': 'application/json',
    // 简单 GET 请求，只需 GET/OPTIONS/HEAD
    'Access-Control-Allow-Methods': 'GET, OPTIONS, HEAD',
    'Vary': 'Origin',
    // 短缓存：歌词可能被平台修订，只缓存 60s
    'Cache-Control': 'public, max-age=60',
  }
  if (ALLOWED_ORIGIN.test(origin || '')) h['Access-Control-Allow-Origin'] = origin
  return h
}

const json = (status, body, origin) =>
  new Response(JSON.stringify(body), { status, headers: corsHeaders(origin) })

/** 各平台 ID 白名单正则（新增平台时在此登记，杜绝任意外呼参数） */
const ID_PATTERNS = {
  netease: /^\d{4,}$/,
}

export default async (req) => {
  const origin = req.headers.get('Origin') || ''
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(origin) })
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return json(405, { code: 40500, error: 'Method not allowed' }, origin)
  }

  let platform = ''
  let id = ''
  try {
    const u = new URL(req.url)
    platform = (u.searchParams.get('platform') || '').trim()
    id = (u.searchParams.get('id') || '').trim()
  } catch {
    return json(400, { code: 40000, error: '请求地址不正确' }, origin)
  }

  if (!Object.prototype.hasOwnProperty.call(ID_PATTERNS, platform)) {
    return json(400, { code: 40002, error: '不支持的歌词平台' }, origin)
  }
  if (!ID_PATTERNS[platform].test(id)) {
    return json(400, { code: 40003, error: '曲目 ID 不合法' }, origin)
  }

  try {
    // Meting 内部已含超时 + 重试；返回结构：
    // { lrc: { version, lyric }, tlyric: { lyric }, klyric: { lyric }, code, nolyric?, uncollected? }
    const meting = new Meting(platform)
    const parsed = JSON.parse(await meting.lyric(id))

    // 纯音乐：接口显式 nolyric=true（部分曲目用 uncollected 表示暂无收集，两者都按纯音乐处理）
    const instrumental = !!(parsed?.nolyric || parsed?.uncollected)

    // 原文 / 译文：空字符串与纯空白统一归 null，减少前端判空分支
    const lrc = typeof parsed?.lrc?.lyric === 'string' && parsed.lrc.lyric.trim()
      ? parsed.lrc.lyric
      : null
    const tlyric = typeof parsed?.tlyric?.lyric === 'string' && parsed.tlyric.lyric.trim()
      ? parsed.tlyric.lyric
      : null

    // 既不是纯音乐、又拿不到任何原文：按上游失败处理（接口偶发抖动），交给前端提示
    if (!instrumental && !lrc) {
      return json(200, { code: 42203, error: '暂未获取到该曲目歌词' }, origin)
    }

    return json(200, { code: 0, data: { lrc, tlyric, instrumental } }, origin)
  } catch (err) {
    const msg = /timeout/i.test(String(err?.message || ''))
      ? '歌词服务响应超时，请稍后重试'
      : '歌词获取失败，请稍后重试'
    return json(200, { code: 50402, error: msg }, origin)
  }
}
