/**
 * 剪贴板复制：优先 Clipboard API（需安全上下文），
 * 降级隐藏 textarea + execCommand（http 环境 / 旧浏览器）。全站统一入口。
 */
export interface CopyOptions {
  /** 复制内容尾部追加来源署名（本内容来自LrcShare + 当前页链接）；前台歌词 / 联系方式复制用 */
  attribution?: boolean
}

/** 来源署名尾巴：链接取 origin + pathname（去掉 ?tab= 等参数，保持规范地址）。
 *  独立导出：前台布局的 copy 事件监听（选中文本复制）复用同一署名格式 */
export function buildAttribution(): string {
  return `\n\n本内容来自LrcShare\n链接:${window.location.origin}${window.location.pathname}`
}

export async function copyText(text: string, opts?: CopyOptions): Promise<boolean> {
  const content = opts?.attribution ? text + buildAttribution() : text
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(content)
      return true
    } catch { /* API 失败走降级 */ }
  }
  const ta = document.createElement('textarea')
  ta.value = content
  ta.style.position = 'fixed'
  ta.style.left = '-9999px'
  document.body.appendChild(ta)
  ta.select()
  document.execCommand('copy')
  document.body.removeChild(ta)
  return true
}
