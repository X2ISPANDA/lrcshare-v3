/**
 * 剪贴板复制：优先 Clipboard API（需安全上下文），
 * 降级隐藏 textarea + execCommand（http 环境 / 旧浏览器）。全站统一入口。
 */
export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch { /* API 失败走降级 */ }
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  document.body.removeChild(ta)
  return true
}
