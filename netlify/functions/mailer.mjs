// @ts-check
/**
 * LrcShare 邮件服务（Netlify Function，单端点）
 *
 * POST /api/mailer  （经 netlify.toml redirect 到 /.netlify/functions/mailer）
 * body: { action: 'test' | 'approve' | 'reject' | 'notify' | 'batch', to?, user_name?, song_title?, reject_reason?, ... }
 * notify：投稿页提交成功后通知站长（收件人固定为 settings 的 admin_email，忽略 to 参数）
 * batch：按批次合并的审核结果通知（一次批量投稿一封邮件，覆盖全部通过/全部拒绝/部分通过三种情况）
 *   body 额外字段：items: [{ title, result: 'approve' | 'reject', reason? }]
 *
 * SMTP 配置由服务端直接从 Supabase settings 表读取（键：smtp_host/smtp_port/smtp_user/smtp_pass/admin_email，
 * 在管理后台「系统设置」页维护），浏览器不传输 SMTP 凭据。
 *
 * 所需 Netlify 环境变量：
 *   SUPABASE_URL               Supabase 项目 URL
 *   SUPABASE_SERVICE_ROLE_KEY  service_role key（settings 表 RLS 对 anon 隐藏敏感行，必须用它读）
 */
import nodemailer from 'nodemailer'

const SITE_URL = 'https://lrcshare.com'
const HERO_BG = 'https://i0.hdslb.com/bfs/article/a009cfa6551237d38e6f64ce46fd739037977624.jpg'
const LOGO_URL = 'https://i0.hdslb.com/bfs/article/a2323ad6e33924c39061b35ae29f9fd937977624.png'

/**
 * 从 Supabase settings 表读 SMTP 配置。
 * 注意：settings 表的 RLS 对 anon 隐藏敏感行（smtp_pass 等），必须用 service_role key 读取。
 * 所需 Netlify 环境变量：
 *   SUPABASE_URL              Supabase 项目 URL
 *   SUPABASE_SERVICE_ROLE_KEY service_role key（Studio → Settings → API；本地调试可临时用 anon）
 */
async function loadSmtp() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env')
  const res = await fetch(`${url}/rest/v1/settings?select=key,value`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  })
  if (!res.ok) throw new Error(`读取 settings 失败: HTTP ${res.status}`)
  const rows = await res.json()
  const map = Object.fromEntries(rows.map(r => [r.key, r.value]))
  if (!map.smtp_host || !map.smtp_user || !map.smtp_pass) return null
  return {
    host: map.smtp_host,
    port: parseInt(map.smtp_port) || 465,
    user: map.smtp_user,
    pass: map.smtp_pass,
    admin_email: (map.admin_email || '').trim(),
  }
}

/**
 * 管理端会话校验：Authorization 必须携带 Supabase Auth 有效 JWT（调 /auth/v1/user 验证）。
 * 公开注册已关闭，能通过校验的仅管理员账号。notify 不走此校验。
 */
async function assertAdmin(req) {
  const token = String(req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim()
  if (!token) return false
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return false
  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: key, Authorization: `Bearer ${token}` },
    })
    return res.ok
  } catch {
    return false
  }
}

/** to 必须为单个合法邮箱：nodemailer 的 to 支持逗号/分号分隔群发，必须锁死单地址 */
const isSingleEmail = v => /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(String(v || '').trim())

/** 邮件 HTML 模板（迁移自 v2 server/index.js，保留品牌视觉） */
function generateEmailHTML({ type, user_name, song_title, reject_reason, admin_email }) {
  const now = new Date()
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`
  const link = `<a href="${SITE_URL}" style="color:#ec4899;text-decoration:underline;">LrcShare</a>`
  const badge = `<a href="${SITE_URL}" style="display:inline-block;padding:4px 16px;background:linear-gradient(135deg,#ec4899 0%,#a855f7 100%);color:#fff;font-weight:900;text-decoration:none;border-radius:8px;letter-spacing:2px;font-size:18px;box-shadow:0 2px 8px rgba(236,72,153,0.3);">LrcShare</a>`

  // 用户可控字段（投稿者昵称/歌名/拒绝原因）统一转义，防 HTML 注入
  const safeName = escapeHtml(user_name || '匿名用户')
  const safeTitle = escapeHtml(song_title || '')
  const safeReason = escapeHtml(reject_reason || '')

  const config = type === 'approve'
    ? { color: '#10b981', bgColor: '#d1fae5', title: '审核通过', emoji: '🎉', mainText: '恭喜！您的投稿已通过审核', detail: safeTitle ? `歌曲《${safeTitle}》已通过审核` : `您的歌词作品已通过审核` }
    : type === 'notify'
    ? { color: '#3b82f6', bgColor: '#dbeafe', title: '新投稿提醒', emoji: '📩', mainText: `收到来自 ${safeName}的新投稿`, detail: safeTitle ? `歌曲《${safeTitle}》已提交，等待管理员前往后台审核` : '新投稿已提交，等待管理员前往后台审核' }
    : { color: '#ef4444', bgColor: '#fee2e2', title: '审核未通过', emoji: '😢', mainText: safeTitle ? `很遗憾，您投稿的歌曲《${safeTitle}》未通过审核` : '很遗憾，您的投稿未通过审核', detail: safeReason ? `拒绝原因：${safeReason}` : '请参考拒绝原因修改后重新提交' }

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:'Microsoft YaHei',Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);">
  <div style="position:relative;padding:40px 30px;text-align:center;background-image:url('${HERO_BG}');background-size:cover;background-position:center;">
    <div style="position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);"></div>
    <div style="position:relative;z-index:1;">
      <img src="${LOGO_URL}" alt="LrcShare Logo" referrerpolicy="no-referrer" style="width:80px;height:80px;margin:0 auto 12px;display:block;" />
      <h1 style="margin:0;color:#fff;font-size:36px;font-weight:900;letter-spacing:4px;text-shadow:1px 1px 0 #1a0a2e,2px 2px 0 #1a0a2e,3px 3px 0 #1a0a2e,4px 4px 0 #1a0a2e,5px 5px 0 #1a0a2e,6px 6px 0 #1a0a2e,7px 7px 10px rgba(0,0,0,0.6),0 0 20px rgba(139,92,246,0.5);">LrcShare</h1>
      <p style="margin:12px 0 0;color:rgba(255,255,255,0.95);font-size:16px;text-shadow:1px 1px 3px rgba(0,0,0,0.5);">全球最小滚动歌词分享网站</p>
    </div>
  </div>
  <div style="padding:40px 30px;">
    <div style="text-align:center;margin-bottom:30px;">
      <div style="width:80px;height:80px;margin:0 auto 15px;background:${config.bgColor};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:40px;">${config.emoji}</div>
      <h2 style="margin:0;color:${config.color};font-size:24px;font-weight:bold;">${config.title}</h2>
    </div>
    <div style="margin-bottom:30px;">
      <p style="margin:0 0 15px;font-size:16px;color:#374151;">亲爱的 <span style="font-weight:bold;color:#1f2937;">${type === 'notify' ? '管理员' : safeName}</span>：</p>
      <p style="margin:0 0 15px;font-size:16px;color:#374151;line-height:1.8;">${config.mainText}。</p>
      <div style="background:${config.bgColor};border-left:4px solid ${config.color};padding:15px 20px;border-radius:0 8px 8px 0;margin:20px 0;">
        <p style="margin:0;font-size:14px;color:${config.color};line-height:1.6;">${config.detail}</p>
      </div>
    </div>
    <div style="background:#f9fafb;border-radius:8px;padding:20px;margin-bottom:30px;">
      <p style="margin:0 0 10px;font-size:14px;color:#6b7280;line-height:1.6;">${type === 'approve' ? `感谢您为 ${link} 做出的贡献！您的歌词作品将陪伴更多音乐爱好者。` : type === 'notify' ? `请前往 ${link} 管理后台及时审核处理。` : `感谢您对 ${link} 的关注与支持！期待您的下次投稿。`}</p>
      ${type === 'approve' ? `<p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;">备注：审核通过后 API 即时生效；网站页面不即时更新，将随网站自动部署一起上线，敬请留意。</p>` : ''}
    </div>
    <div style="text-align:center;padding-top:20px;border-top:1px solid #e5e7eb;">
      <p style="margin:0 0 8px;">${badge}</p>
      <p style="margin:0 0 8px;font-size:12px;color:#6b7280;">${dateStr}</p>
      ${admin_email ? `<p style="margin:0;font-size:12px;color:#9ca3af;">如有疑问，请联系：${admin_email}</p>` : ''}
    </div>
  </div>
  <div style="background:#f9fafb;padding:20px 30px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#9ca3af;">此邮件由 ${link} 官方系统自动发送，如有问题请直接回复</p>
  </div>
</div>
</body></html>`
}

/** 批次审核结果邮件 HTML：一封邮件呈现整批结果（全部通过 / 全部拒绝 / 部分通过列表） */
function generateBatchEmailHTML({ user_name, items, admin_email }) {
  const now = new Date()
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`
  const link = `<a href="${SITE_URL}" style="color:#ec4899;text-decoration:underline;">LrcShare</a>`
  const badge = `<a href="${SITE_URL}" style="display:inline-block;padding:4px 16px;background:linear-gradient(135deg,#ec4899 0%,#a855f7 100%);color:#fff;font-weight:900;text-decoration:none;border-radius:8px;letter-spacing:2px;font-size:18px;box-shadow:0 2px 8px rgba(236,72,153,0.3);">LrcShare</a>`

  const total = items.length
  const approved = items.filter(i => i.result === 'approve')
  const rejected = items.filter(i => i.result === 'reject')
  const allApproved = rejected.length === 0
  const allRejected = approved.length === 0

  const config = allApproved
    ? { color: '#10b981', bgColor: '#d1fae5', title: '审核通过', emoji: '🎉', mainText: `恭喜！您本次投稿的 ${total} 首歌曲已全部通过审核` }
    : allRejected
    ? { color: '#ef4444', bgColor: '#fee2e2', title: '审核未通过', emoji: '😢', mainText: `很遗憾，您本次投稿的 ${total} 首歌曲均未通过审核` }
    : { color: '#f59e0b', bgColor: '#fef3c7', title: '审核结果通知', emoji: '📮', mainText: `您本次投稿的 ${total} 首歌曲中，${approved.length} 首通过审核，${rejected.length} 首未通过` }

  // 逐首结果行
  const itemRows = items.map(i => {
    const ok = i.result === 'approve'
    const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${ok ? '#10b981' : '#ef4444'};margin-right:8px;vertical-align:middle;"></span>`
    const reason = !ok && i.reason ? `<span style="color:#ef4444;"> — 原因：${escapeHtml(i.reason)}</span>` : ''
    return `<li style="margin:0 0 8px;font-size:14px;color:#374151;line-height:1.7;">${dot}<strong>${escapeHtml(i.title)}</strong> ${ok ? '<span style="color:#10b981;">通过</span>' : '<span style="color:#ef4444;">未通过</span>'}${reason}</li>`
  }).join('')

  const summary = allApproved
    ? `您本次投稿的 ${total} 首歌曲已全部通过审核`
    : allRejected
    ? (rejected[0]?.reason ? `拒绝原因：${escapeHtml(rejected[0].reason)}` : '请参考拒绝原因修改后重新提交')
    : `以下为逐首审核结果（未通过的请参考原因修改后重新提交）`

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;background-color:#f3f4f6;font-family:'Microsoft YaHei',Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.1);">
  <div style="position:relative;padding:40px 30px;text-align:center;background-image:url('${HERO_BG}');background-size:cover;background-position:center;">
    <div style="position:absolute;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);"></div>
    <div style="position:relative;z-index:1;">
      <img src="${LOGO_URL}" alt="LrcShare Logo" referrerpolicy="no-referrer" style="width:80px;height:80px;margin:0 auto 12px;display:block;" />
      <h1 style="margin:0;color:#fff;font-size:36px;font-weight:900;letter-spacing:4px;text-shadow:1px 1px 0 #1a0a2e,2px 2px 0 #1a0a2e,3px 3px 0 #1a0a2e,4px 4px 0 #1a0a2e,5px 5px 0 #1a0a2e,6px 6px 0 #1a0a2e,7px 7px 10px rgba(0,0,0,0.6),0 0 20px rgba(139,92,246,0.5);">LrcShare</h1>
      <p style="margin:12px 0 0;color:rgba(255,255,255,0.95);font-size:16px;text-shadow:1px 1px 3px rgba(0,0,0,0.5);">全球最小滚动歌词分享网站</p>
    </div>
  </div>
  <div style="padding:40px 30px;">
    <div style="text-align:center;margin-bottom:30px;">
      <div style="width:80px;height:80px;margin:0 auto 15px;background:${config.bgColor};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:40px;">${config.emoji}</div>
      <h2 style="margin:0;color:${config.color};font-size:24px;font-weight:bold;">${config.title}</h2>
    </div>
    <div style="margin-bottom:30px;">
      <p style="margin:0 0 15px;font-size:16px;color:#374151;">亲爱的 <span style="font-weight:bold;color:#1f2937;">${escapeHtml(user_name)}</span>：</p>
      <p style="margin:0 0 15px;font-size:16px;color:#374151;line-height:1.8;">${config.mainText}。</p>
      <div style="background:${config.bgColor};border-left:4px solid ${config.color};padding:15px 20px;border-radius:0 8px 8px 0;margin:20px 0;">
        <p style="margin:0;font-size:14px;color:${config.color};line-height:1.6;">${summary}</p>
      </div>
      <ul style="margin:10px 0 0;padding-left:24px;">${itemRows}</ul>
    </div>
    <div style="background:#f9fafb;border-radius:8px;padding:20px;margin-bottom:30px;">
      <p style="margin:0 0 10px;font-size:14px;color:#6b7280;line-height:1.6;">感谢您对 ${link} 的关注与支持！期待您的下次投稿。</p>
      ${approved.length ? `<p style="margin:0;font-size:13px;color:#9ca3af;line-height:1.6;">备注：审核通过后 API 即时生效；网站页面不即时更新，将随网站自动部署一起上线，敬请留意。</p>` : ''}
    </div>
    <div style="text-align:center;padding-top:20px;border-top:1px solid #e5e7eb;">
      <p style="margin:0 0 8px;">${badge}</p>
      <p style="margin:0 0 8px;font-size:12px;color:#6b7280;">${dateStr}</p>
      ${admin_email ? `<p style="margin:0;font-size:12px;color:#9ca3af;">如有疑问，请联系：${admin_email}</p>` : ''}
    </div>
  </div>
  <div style="background:#f9fafb;padding:20px 30px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#9ca3af;">此邮件由 ${link} 官方系统自动发送，如有问题请直接回复</p>
  </div>
</div>
</body></html>`
}

function escapeHtml(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * 常见 SMTP 发信失败翻译成中文结论（只收高频项，未命中保持原文），管理端一眼定位原因。
 * 中文结论后保留原始错误——未覆盖的错误码仍可拿原文搜索排查，不吞信息不误导。
 */
function humanizeMailError(err) {
  const raw = String(err?.message || err || '')
  const rules = [
    [/non-?existent|user not found|no such user|recipient.*not exist|unknown user|mailbox unavailable/i, '收件地址不存在（邮箱可能写错或已注销）'],
    [/authentication|535|invalid login|auth fail|username and password/i, 'SMTP 认证失败（授权码错误或未开启 SMTP 服务）'],
    [/554|spam|rejected|blocked|blacklist/i, '被对方拒收（内容疑似垃圾邮件或发信 IP 信誉差）'],
    [/552|over quota|quota exceeded|insufficient system storage/i, '收件箱已满'],
    [/553|relay.*denied|sender.*not verif/i, '发件人身份未验证或禁止外发'],
    [/etimedout|timeout|esocket/i, 'SMTP 连接超时（端口不通或网络异常）'],
    [/enotfound|eai_again|dns/i, 'SMTP 服务器域名解析失败（host 配置错误）'],
    [/econnrefused|econnreset/i, 'SMTP 连接被拒绝/重置（host 或端口配置错误）'],
    [/\b45[12]\b|try (again )?later|temporar/i, '对方服务临时故障，稍后重试即可'],
  ]
  const hit = rules.find(([re]) => re.test(raw))
  return hit ? `${hit[1]}｜原始错误: ${raw}` : raw
}

// CORS：仅放行本站及子域（反射式回显，正则锚定防 lrcshare.com.evil.com / evil-lrcshare.com 仿冒域）。
// 预检需放行 Authorization（管理端会话令牌）。
// 注意：CORS 只约束浏览器，非浏览器工具本就无视——真正的防线是管理端 action 的会话校验（assertAdmin）。
const ALLOWED_ORIGIN = /^https:\/\/([a-z0-9-]+\.)*lrcshare\.com$/
// ============ 发信日志（mail_logs 表） ============
// 所有写操作 try-catch 包裹，**日志失败绝不阻塞发信**——日志是诊断，不能让日志挂了邮件也发不出去。
// 使用 service_role key，不走浏览器 anon key（mail_logs RLS 对 anon 拒绝）。

/** 向 mail_logs 表插入一条 pending 记录，返回日志 id（写失败返回 null） */
async function _insertMailLog(partial) {
  try {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) return null
    const res = await fetch(`${url}/rest/v1/mail_logs`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify({ status: 'pending', ...partial }),
    })
    if (!res.ok) return null
    const rows = await res.json()
    return rows?.[0]?.id ?? null
  } catch { return null }
}

/** 更新 mail_logs 状态（写失败静默忽略） */
async function _updateMailLog(id, status, error) {
  if (!id) return
  try {
    const url = process.env.SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) return
    const body = { status }
    if (error !== undefined) body.error = error
    await fetch(`${url}/rest/v1/mail_logs?id=eq.${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(body),
    })
  } catch { /* 静默 */ }
}

/** 记录 skipped 状态（早期 return 点用：SMTP 未配置 / 未留邮箱等） */
async function _logSkipped(action, toEmail, songTitle, reason) {
  const id = await _insertMailLog({ action, to_email: toEmail || '', song_title: songTitle || '', status: 'skipped', error: reason })
  return id // 可以忽略
}

function corsHeaders(req) {
  const origin = req.headers.get('Origin') || ''
  const h = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  }
  if (ALLOWED_ORIGIN.test(origin)) h['Access-Control-Allow-Origin'] = origin
  return h
}
const json = (req, status, body) => new Response(JSON.stringify(body), { status, headers: corsHeaders(req) })

export default async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, 405, { success: false, error: 'Method not allowed' })
  // action 提至 try 外记录：catch 里据此区分匿名 notify 与已鉴权管理端 action 的错误返回粒度
  let action = ''
  let logId = null
  try {
    const body = await req.json()
    action = body.action
    const { to, user_name, song_title, reject_reason, items } = body
    // 管理端 action（test/approve/reject/batch）必须携带有效登录会话；
    // notify（公开投稿通知，收件人固定 admin_email）免鉴权放行
    if (action !== 'notify' && !(await assertAdmin(req))) {
      return json(req, 401, { success: false, error: '未授权：请登录管理后台后使用' })
    }
    // 邮件主题同样拼用户可控字段，换行符可拆信头——统一剥离控制字符
    const cleanSubjectText = s => String(s || '').replace(/[\r\n\t]/g, ' ')
    const subjTitle = cleanSubjectText(song_title)

    const smtp = await loadSmtp()
    if (!smtp) { await _logSkipped(action, to, song_title, 'SMTP 未配置'); return json(req, 200, { success: true, skipped: true, reason: 'SMTP 未配置' }) }

    // 端口决定 TLS 模式：465 隐式 TLS（secure）；587 STARTTLS（requireTLS 强制升级）；其余端口不加密直连
    const port = Number(smtp.port) || 465
    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port,
      secure: port === 465,
      requireTLS: port === 587,
      auth: { user: smtp.user, pass: smtp.pass },
    })

    let mail
    if (action === 'test') {
      // 已有会话校验兜底，test 与其他管理端 action 同规则：管理员指定单个收件人
      if (!to) return json(req, 400, { success: false, error: '缺少收件人地址' })
      if (!isSingleEmail(to)) return json(req, 400, { success: false, error: 'to 必须为单个合法邮箱地址' })
      mail = { to, subject: '【LrcShare】测试邮件', html: generateEmailHTML({ type: 'approve', user_name: '管理员', song_title: '测试歌曲', admin_email: smtp.admin_email }) }
    } else if (action === 'notify') {
      // 新投稿通知：收件人固定为 settings 的 admin_email（防滥用：不接受外部 to 参数）
      if (!smtp.admin_email) { await _logSkipped(action, '', song_title, '未配置 admin_email'); return json(req, 200, { success: true, skipped: true, reason: '未配置 admin_email' }) }
      mail = { to: smtp.admin_email, subject: subjTitle ? `【LrcShare】新投稿：《${subjTitle}》待审核` : '【LrcShare】收到新投稿', html: generateEmailHTML({ type: 'notify', user_name, song_title, admin_email: smtp.admin_email }) }
    } else if (action === 'approve') {
      if (!to) { await _logSkipped(action, to, song_title, '投稿未留邮箱'); return json(req, 200, { success: true, skipped: true, reason: '投稿未留邮箱' }) }
      if (!isSingleEmail(to)) return json(req, 400, { success: false, error: 'to 必须为单个合法邮箱地址' })
      mail = { to, subject: subjTitle ? `【LrcShare】恭喜！《${subjTitle}》审核通过` : '【LrcShare】恭喜！歌词审核通过', html: generateEmailHTML({ type: 'approve', user_name, song_title, admin_email: smtp.admin_email }) }
    } else if (action === 'reject') {
      if (!to) { await _logSkipped(action, to, song_title, '投稿未留邮箱'); return json(req, 200, { success: true, skipped: true, reason: '投稿未留邮箱' }) }
      if (!isSingleEmail(to)) return json(req, 400, { success: false, error: 'to 必须为单个合法邮箱地址' })
      mail = { to, subject: subjTitle ? `【LrcShare】很遗憾，《${subjTitle}》审核未通过` : '【LrcShare】歌词提交审核结果通知', html: generateEmailHTML({ type: 'reject', user_name, song_title, reject_reason, admin_email: smtp.admin_email }) }
    } else if (action === 'batch') {
      // 批次合并通知：一次批量投稿的逐首结果合成一封邮件（items: [{ title, result, reason? }]）
      if (!to) { await _logSkipped(action, to, song_title, '投稿未留邮箱'); return json(req, 200, { success: true, skipped: true, reason: '投稿未留邮箱' }) }
      if (!isSingleEmail(to)) return json(req, 400, { success: false, error: 'to 必须为单个合法邮箱地址' })
      if (!Array.isArray(items) || !items.length) return json(req, 400, { success: false, error: '缺少 items' })
      const total = items.length
      const okCount = items.filter(i => i.result === 'approve').length
      const subject = okCount === total
        ? `【LrcShare】恭喜！您本次投稿的 ${total} 首歌曲全部通过`
        : okCount === 0
        ? `【LrcShare】很遗憾，您本次投稿的 ${total} 首歌曲未通过`
        : `【LrcShare】审核结果：${okCount}/${total} 首通过`
      mail = { to, subject, html: generateBatchEmailHTML({ user_name, items, admin_email: smtp.admin_email }) }
    } else {
      return json(req, 400, { success: false, error: '未知 action: ' + action })
    }

    // 主流程：sendMail 前先插 pending 日志，成功改 sent、失败改 failed
    logId = await _insertMailLog({
      action,
      to_email: mail.to || '',
      subject: mail.subject || '',
      song_title: song_title || '',
      user_name: user_name || '',
    })

    await transporter.sendMail({ from: smtp.user, ...mail })
    await _updateMailLog(logId, 'sent')
    return json(req, 200, { success: true })
  } catch (err) {
    console.error('mailer error:', err)
    // sendMail 失败时更新 pending 那条为 failed；insert 也失败了（logId=null）则忽略
    await _updateMailLog(logId, 'failed', humanizeMailError(err))
    // notify 是匿名公开接口（投稿通知站长），不回传 SMTP 主机名/greeting/认证细节；
    // 管理端 action（test/approve/reject/batch）已过会话校验，返回中文结论+原始错误便于排查
    if (action === 'notify') return json(req, 500, { success: false, error: '邮件发送失败，请稍后重试' })
    return json(req, 500, { success: false, error: humanizeMailError(err) })
  }
}
