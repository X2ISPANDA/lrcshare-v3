<template>
  <div class="flex flex-wrap gap-1 mb-2 items-center">
    <span class="text-xs text-gray-400 mr-1">韵脚标色:</span>
    <el-color-picker v-model="rhymeColor" size="small" :predefine="RHYME_PRESET" title="选色后给选中文字标色加粗" @change="onRhymePick" />
    <el-divider direction="vertical" />
    <el-button size="small" title="选中词语后点击，输入注释内容，前台 hover 橙色词弹出绿色气泡" @click="wrapBubble">💬 注释</el-button>
    <el-button size="small" title="选中译文后点击，选择或自定义语种（不同语种自动分配不同颜色，前台自动生成语种切换按钮）" @click="wrapTranslation">🈶 译文</el-button>
    <button
      v-for="lang in quickLangs"
      :key="lang"
      type="button"
      class="lang-quick"
      :title="`选中译文后点击，直接标注为「${lang}」（免弹窗）`"
      @click="quickApply(lang)"
    >
      <span class="inline-block w-2 h-2 rounded-full flex-shrink-0" :style="{ background: langColor(lang) }"></span>{{ lang }}
    </button>
    <el-button size="small" title="选中文字后输入读音，显示为文字上方小注音" @click="wrapRuby">📝 注音</el-button>
    <el-divider direction="vertical" />
    <el-button size="small" title="Markdown 加粗 **文字**" @click="wrapSelection('**', '**')"><b>B</b></el-button>
    <el-button size="small" title="Markdown 斜体 *文字*" @click="wrapSelection('*', '*')"><i>I</i></el-button>
    <el-button size="small" title="Markdown 删除线 ~~文字~~" @click="wrapSelection('~~', '~~')"><s>S</s></el-button>
    <el-button size="small" title="在光标处插入换行（Markdown 单行换行）" @click="insertBr">↵ 换行</el-button>
    <el-button size="small" @click="wrapLink">链接</el-button>
  </div>
</template>

<script setup lang="ts">
import { computed, defineComponent, h, nextTick, ref } from 'vue'
// 注意：模板组件（el-button/el-color-picker 等）不手动 import——
// 项目用 unplugin-vue-components 按需注入组件+样式，手动 import 会绕过样式注入导致渲染成裸 HTML
// ElRadio/ElRadioGroup/ElInput 在 h() 里渲染（非模板），必须手动 import 并补样式（css.mjs）
import { ElInput, ElMessage, ElMessageBox, ElRadio, ElRadioGroup } from 'element-plus'
import { langColor, PRESET_LANG_COLORS } from '@/lib/constants'
import 'element-plus/es/components/radio/style/css'
import 'element-plus/es/components/radio-group/style/css'
import 'element-plus/es/components/input/style/css'

/**
 * 富文本标注工具栏（歌曲文本歌词 / 文章正文共用）
 * 用法：<RichTextToolbar ref="toolbarRef" :text="form.lyrics_text" :textarea-ref="lyricsTextRef" @update:text="v => form.lyrics_text = v" />
 * textareaRef 传 el-input 组件实例（组件内部自己找 textarea 元素）
 */
const props = defineProps<{
  text: string
  textareaRef: unknown
}>()
const emit = defineEmits<{ (e: 'update:text', v: string): void }>()

/** 韵脚标色：色盘预设（老站 16 色对应的 hex），点选后给选中文字标色加粗 */
const RHYME_PRESET = [
  '#ff0000', '#ff6347', '#d2691e', '#ffc0cb',
  '#808080', '#d2b48c', '#cd853f', '#ff7f50',
  '#b22222', '#ffa500', '#008000', '#0000ff',
  '#800080', '#ee82ee', '#00ffff', '#ffd700',
]
/** 有默认色才能显示色块（空值时触发器是个丑陋的叉），选完保留当前色方便连续标色 */
const rhymeColor = ref('#ff0000')
function onRhymePick(val: string | null) {
  if (!val) return
  wrapSelection(`<span style="color:${val}"><b>`, '</b></span>')
}

function getTextarea(): HTMLTextAreaElement | null {
  const el = (props.textareaRef as any)?.$el
  return el?.querySelector?.('textarea') || (el instanceof HTMLTextAreaElement ? el : null)
}

function getSel() {
  const ta = getTextarea()
  if (!ta) return null
  const start = ta.selectionStart
  const end = ta.selectionEnd
  const text = props.text || ''
  const sel = text.substring(start, end)
  if (!sel) {
    ElMessage.warning('请先选中要标注的文字')
    return null
  }
  return { ta, start, end, text, sel }
}

function apply(start: number, end: number, prefix: string, sel: string, suffix: string) {
  emit('update:text', props.text.substring(0, start) + prefix + sel + suffix + props.text.substring(end))
  nextTick(() => {
    const ta = getTextarea()
    if (!ta) return
    ta.focus()
    ta.setSelectionRange(start + prefix.length, start + prefix.length + sel.length)
  })
}

function wrapSelection(prefix: string, suffix: string) {
  const s = getSel()
  if (!s) return
  apply(s.start, s.end, prefix, s.sel, suffix)
}

/** 译文语种预设（快捷选择；语种名任意自定义，如法语/俄语/西班牙语）。
 *  配色收敛在 lib/constants（与前台渲染同源，保证按钮色点=译文颜色） */
const PRESET_LANGS = Object.entries(PRESET_LANG_COLORS).map(([name, color]) => ({ name, color }))

// ============ 语种快速复用 ============
/** 最近用过的语种（localStorage 持久化，跨歌曲/文章、跨会话）：点工具栏胶囊直接标注，免弹窗 */
const RECENT_LANGS_KEY = 'rich_lang_recents'
function loadRecents(): string[] {
  try { return JSON.parse(localStorage.getItem(RECENT_LANGS_KEY) || '[]') } catch { return [] }
}
const recentLangs = ref<string[]>(loadRecents())
function pushRecent(name: string) {
  recentLangs.value = [name, ...recentLangs.value.filter(l => l !== name)].slice(0, 6)
  try { localStorage.setItem(RECENT_LANGS_KEY, JSON.stringify(recentLangs.value)) } catch { /* 隐私模式等存储失败忽略 */ }
}
/** 当前文本里已标注过的语种（编辑旧文时不必先去弹窗查色） */
const textLangs = computed(() => {
  const names: string[] = []
  for (const m of (props.text || '').matchAll(/data-lang=["']([^"']+)["']/g)) {
    if (!names.includes(m[1])) names.push(m[1])
  }
  return names
})
/** 快速胶囊 = 最近用过 + 文本已有（去重，最近优先）；空则一个不显示 */
const quickLangs = computed(() => [...recentLangs.value, ...textLangs.value.filter(l => !recentLangs.value.includes(l))])
/** 一键标注：选中译文点胶囊直接包标签（名称再过一遍净化，双保险） */
function quickApply(name: string) {
  const s = getSel()
  if (!s) return
  applyLangMark(s, name)
}
/** 统一出口：包译文标签 + 记入最近使用（quickApply / 弹窗确认共用） */
function applyLangMark(s: { start: number; end: number; sel: string }, rawName: string) {
  const name = rawName.replace(/["'<>/\\]/g, '').trim()
  if (!name) return
  apply(s.start, s.end, `<span class="p" data-lang="${name}" style="color:${langColor(name)}">`, s.sel, '</span>')
  pushRecent(name)
}

/** 译文：选中文字 → 弹窗选择/自定义语种 → 包 <span class="p" data-lang="语种" style="color:...">。
 *  前台 SongView 扫描 data-lang 自动生成语种切换按钮。
 *  坑位记录：
 *  1. ElRadio 不绑 v-model 时点击会 emit('change', undefined)，EP 的 emits 校验直接报
 *     "Invalid event arguments: event validation failed for event change"，必须走 radio-group v-model 正规用法
 *  2. ElMessageBox 的 message 传一次性 VNode 快照，内部状态变化不会刷新弹窗；
 *     包一层函数组件（render 里读 ref 收集依赖）才能响应式更新
 *  3. 自定义为空时不能让弹窗直接关闭——beforeClose 拦截 confirm，空名提示后留在弹窗内 */
async function wrapTranslation() {
  const s = getSel()
  if (!s) return
  // 默认选中最近用过的语种（连续标注同一语种时直接确定即可）
  const picked = ref<string>(recentLangs.value[0] || '粤语')
  const customName = ref('')
  const LangPicker = defineComponent({
    name: 'LangPicker',
    setup: () => () => h('div', { class: 'py-1' }, [
      h('div', { class: 'text-sm text-gray-500 mb-2' }, '选择或自定义译文语种（不同语种自动分配不同颜色）'),
      h(ElRadioGroup, {
        modelValue: picked.value,
        'onUpdate:modelValue': (v: string | number | boolean | undefined) => { picked.value = String(v) },
      }, () => [
        ...PRESET_LANGS.map(p => h(ElRadio, { key: p.name, value: p.name, class: 'mr-4! mb-1' }, () => [
          h('span', { class: 'inline-block w-2.5 h-2.5 rounded-full mr-1.5', style: `background:${p.color}` }),
          p.name,
        ])),
        h(ElRadio, { value: '__custom__', class: 'mr-4! mb-1' }, () => '✏️ 自定义'),
      ]),
      picked.value === '__custom__'
        ? h('div', { class: 'mt-2' }, [
            h(ElInput, {
              modelValue: customName.value,
              'onUpdate:modelValue': (v: string) => { customName.value = v },
              placeholder: '输入语种名称，如：法语、俄语、西班牙语',
            }, {
              prefix: () => h('span', {
                class: 'inline-block w-2.5 h-2.5 rounded-full',
                style: `background:${customName.value.trim() ? langColor(customName.value.trim()) : '#d1d5db'}`,
              }),
            }),
            h('div', { class: 'text-xs text-gray-400 mt-1.5' }, '色点为该语种将使用的颜色，输入时实时预览'),
          ])
        : null,
    ]),
  })
  try {
    await ElMessageBox({
      title: '译文语种',
      message: h(LangPicker),
      confirmButtonText: '确定',
      cancelButtonText: '取消',
      showCancelButton: true,
      beforeClose: (action, _instance, done) => {
        // 自定义模式空名拦截：不 done() 弹窗不关，提示后继续输入
        if (action === 'confirm' && picked.value === '__custom__' && !customName.value.trim()) {
          ElMessage.warning('请输入自定义语种名称')
          return
        }
        done()
      },
    })
    const rawName = picked.value === '__custom__' ? customName.value.trim() : picked.value
    if (!rawName) return
    applyLangMark(s, rawName)
  } catch { /* cancelled */ }
}

/** 在光标处插入 Markdown 换行（两空格+回车，marked breaks 模式下也可直接回车） */
function insertBr() {
  const ta = getTextarea()
  if (!ta) return
  const pos = ta.selectionStart
  emit('update:text', (props.text || '').slice(0, pos) + '  \n' + (props.text || '').slice(ta.selectionEnd))
  nextTick(() => {
    ta.focus()
    ta.setSelectionRange(pos + 3, pos + 3)
  })
}

async function wrapRuby() {
  const s = getSel()
  if (!s) return
  try {
    const { value } = await ElMessageBox.prompt('请输入读音（如：zhù yīn）', '注音', { confirmButtonText: '确定', cancelButtonText: '取消' })
    apply(s.start, s.end, `<ruby><rb>${s.sel}</rb><rt>${value}</rt></ruby>`, '', '')
  } catch { /* cancelled */ }
}

async function wrapBubble() {
  const s = getSel()
  if (!s) return
  try {
    const { value } = await ElMessageBox.prompt('请输入注释内容（前台鼠标悬停橙色词语时弹出气泡显示）', '词语注释', {
      confirmButtonText: '确定', cancelButtonText: '取消',
      inputPlaceholder: '如：籴(dí)，买入谷物。',
    })
    if (!value?.trim()) return
    apply(s.start, s.end,
      `<span class="bubble-content">${s.sel}</span><span class="bubble-notation"><span class="bubble-item" style="background-color:#1db675;">`,
      value,
      '</span></span>')
  } catch { /* cancelled */ }
}

async function wrapLink() {
  const s = getSel()
  if (!s) return
  try {
    const { value } = await ElMessageBox.prompt('请输入链接地址（如 www.hao123.com）', '链接', { confirmButtonText: '确定', cancelButtonText: '取消' })
    let url = (value || '').trim()
    if (!url) return
    // 协议白名单：显式带协议头时只放行 http(s)/mailto/tencent/weixin/tel（挡 javascript:/data: 等可执行协议）；
    // 无协议头（www.xxx.com）自动补 https://，否则浏览器按相对路径解析
    const proto = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)
    if (proto) {
      const scheme = proto[1].toLowerCase()
      if (!['http', 'https', 'mailto', 'tencent', 'weixin', 'tel'].includes(scheme)) {
        ElMessage.warning(`不支持的链接协议「${scheme}:」，仅允许 http(s)/mailto/tencent/weixin/tel`)
        return
      }
    } else {
      url = 'https://' + url
    }
    // href 属性转义引号/尖括号/&，防属性逃逸注入；新窗口补 rel=noopener
    const esc = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    apply(s.start, s.end, `<a href="${esc}" target="_blank" rel="noopener">`, s.sel, '</a>')
  } catch { /* cancelled */ }
}
</script>

<style scoped>
/* 语种快速复用胶囊：色点=语种色，点一下直接标注选中文字（免弹窗） */
.lang-quick {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 0 10px;
  height: 24px;
  border-radius: 999px;
  border: 1px solid #e5e7eb;
  background: #fff;
  font-size: 12px;
  color: #6b7280;
  line-height: 1;
  cursor: pointer;
  transition: all 0.2s;
}
.lang-quick:hover { border-color: #f9a8d4; color: #db2777; }
</style>
