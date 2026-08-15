// @ts-check
/**
 * LrcShare 邮件服务（Netlify Function，单端点）
 *
 * POST /api/mailer  （经 netlify.toml redirect 到 /.netlify/functions/mailer）
 * body: { action: 'test' | 'approve' | 'reject', to?, user_name?, song_title?, reject_reason? }
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
    admin_email: map.admin_email || '',
  }
}

/** 邮件 HTML 模板（迁移自 v2 server/index.js，保留品牌视觉） */
function generateEmailHTML({ type, user_name, song_title, reject_reason, admin_email }) {
  const now = new Date()
  const dateStr = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`
  const link = `<a href="${SITE_URL}" style="color:#ec4899;text-decoration:underline;">LrcShare</a>`
  const badge = `<a href="${SITE_URL}" style="display:inline-block;padding:4px 16px;background:linear-gradient(135deg,#ec4899 0%,#a855f7 100%);color:#fff;font-weight:900;text-decoration:none;border-radius:8px;letter-spacing:2px;font-size:18px;box-shadow:0 2px 8px rgba(236,72,153,0.3);">LrcShare</a>`

  const config = type === 'approve'
    ? { color: '#10b981', bgColor: '#d1fae5', title: '审核通过', emoji: '🎉', mainText: '恭喜！您的投稿已通过审核', detail: `歌曲《${song_title}》已正式发布到 ${link} 网站` }
    : { color: '#ef4444', bgColor: '#fee2e2', title: '审核未通过', emoji: '😢', mainText: '很遗憾，您的投稿未通过审核', detail: reject_reason ? `拒绝原因：${reject_reason}` : '请参考拒绝原因修改后重新提交' }

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
      <p style="margin:0 0 15px;font-size:16px;color:#374151;">亲爱的 <span style="font-weight:bold;color:#1f2937;">${user_name}</span>：</p>
      <p style="margin:0 0 15px;font-size:16px;color:#374151;line-height:1.8;">${config.mainText}。</p>
      <div style="background:${config.bgColor};border-left:4px solid ${config.color};padding:15px 20px;border-radius:0 8px 8px 0;margin:20px 0;">
        <p style="margin:0;font-size:14px;color:${config.color};line-height:1.6;">${config.detail}</p>
      </div>
    </div>
    <div style="background:#f9fafb;border-radius:8px;padding:20px;margin-bottom:30px;">
      <p style="margin:0 0 10px;font-size:14px;color:#6b7280;line-height:1.6;">${type === 'approve' ? `感谢您为 ${link} 做出的贡献！您的歌词作品将陪伴更多音乐爱好者。` : `感谢您对 ${link} 的关注与支持！期待您的下次投稿。`}</p>
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

/** 测试邮件模板 */
function testEmailHtml(admin_email) {
  return `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f3f4f6;font-family:'Microsoft YaHei',Arial,sans-serif;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:40px 30px;text-align:center;">
  <h2 style="margin:0 0 12px;color:#ec4899;">📮 LrcShare 邮件服务测试</h2>
  <p style="margin:0 0 8px;font-size:15px;color:#374151;">恭喜！SMTP 邮件服务配置成功。</p>
  <p style="margin:0;font-size:12px;color:#9ca3af;">${new Date().toISOString()}${admin_email ? ` · 管理员：${admin_email}` : ''}</p>
</div>
</body></html>`
}

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export default async (req) => {
  if (req.method !== 'POST') return json(405, { success: false, error: 'Method not allowed' })
  try {
    const { action, to, user_name, song_title, reject_reason } = await req.json()

    const smtp = await loadSmtp()
    if (!smtp) return json(200, { success: true, skipped: true, reason: 'SMTP 未配置' })

    const transporter = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: true,
      auth: { user: smtp.user, pass: smtp.pass },
    })

    let mail
    if (action === 'test') {
      if (!to) return json(400, { success: false, error: '缺少收件人地址' })
      mail = { to, subject: '【LrcShare】测试邮件', html: testEmailHtml(smtp.admin_email) }
    } else if (action === 'approve') {
      if (!to) return json(200, { success: true, skipped: true, reason: '投稿未留邮箱' })
      mail = { to, subject: '【LrcShare】恭喜！歌词审核通过', html: generateEmailHTML({ type: 'approve', user_name, song_title, admin_email: smtp.admin_email }) }
    } else if (action === 'reject') {
      if (!to) return json(200, { success: true, skipped: true, reason: '投稿未留邮箱' })
      mail = { to, subject: '【LrcShare】歌词提交审核结果通知', html: generateEmailHTML({ type: 'reject', user_name, song_title, reject_reason, admin_email: smtp.admin_email }) }
    } else {
      return json(400, { success: false, error: '未知 action: ' + action })
    }

    await transporter.sendMail({ from: smtp.user, ...mail })
    return json(200, { success: true })
  } catch (err) {
    console.error('mailer error:', err)
    return json(500, { success: false, error: err.message || String(err) })
  }
}
