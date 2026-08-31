<template>
  <div ref="wrapEl" class="relative w-full">
    <div class="w-full min-h-[42px] px-2 py-1 border border-gray-200 rounded-lg flex flex-wrap gap-1 items-center focus-within:ring-2 focus-within:ring-pink-500">
      <span
        v-for="(t, i) in modelValue"
        :key="i"
        class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-sm"
        :class="tone === 'pink' ? 'bg-pink-100 text-pink-700' : 'bg-gray-100 text-gray-700'"
      >
        <!-- admin 模式：头像即补全入口（库内头像或新建默认占位），点击展开内联表单 -->
        <button
          v-if="admin"
          type="button"
          class="w-5 h-5 rounded-full overflow-hidden flex-shrink-0 flex items-center justify-center transition hover:ring-2 hover:ring-offset-1"
          :class="expandedTag === t ? 'ring-2 ring-offset-1 ring-pink-400' : 'ring-pink-300'"
          :title="t.id && !t._new ? '点击编辑该艺术家信息' : '点击补全新建艺术家信息'"
          @click.stop="toggleExpand(t)"
        >
          <img v-if="t.avatar" :src="t.avatar" class="w-full h-full object-cover" />
          <span v-else class="w-full h-full bg-pink-400 text-white text-[10px] leading-none flex items-center justify-center">{{ t.name?.charAt(0) }}</span>
        </button>
        {{ t.name }}<span v-if="!t.id || t._new" class="text-xs text-blue-600">新建</span>
        <button type="button" class="leading-none opacity-60 hover:opacity-100" @click="removeTag(i)">×</button>
      </span>
      <input
        type="text"
        v-model="input"
        placeholder="搜索或输入后回车"
        class="flex-1 min-w-[100px] outline-none text-sm py-1"
        @input="onInput"
        @focus="syncDropdownPos"
        @keydown.enter.prevent="addNewTag"
        @keydown.delete="onBackspace"
        @blur="onBlur"
      />
    </div>
    <!-- 信息补全弹窗（admin 模式，点击头像弹出；append-to-body 避免被弹窗裁剪） -->
    <ArtistInlineForm
      v-if="admin && expandedTag && modelValue.includes(expandedTag)"
      :tag="expandedTag"
      @close="expandedTag = null"
      @saved="onArtistSaved"
    />
    <!-- 搜索下拉：Teleport 到 body + fixed 定位，避免嵌套弹窗（批量审核→填充弹窗）内被裁剪 -->
    <Teleport to="body">
      <div
        v-if="dropdown.length || (input.trim() && !isExactMatch)"
        class="fixed z-[3000] bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto"
        :style="dropdownStyle"
      >
        <div
          v-for="item in dropdown"
          :key="item.id"
          class="px-4 py-2 hover:bg-pink-50 cursor-pointer border-b border-gray-100"
          @mousedown.prevent="selectTag(item)"
        >
          <div class="flex items-center">
            <span class="text-sm font-medium text-gray-800">{{ item.name }}</span>
            <span v-if="item.id.startsWith('__new_')" class="text-xs text-blue-500 ml-1">本次新建</span>
            <span v-if="item.disambiguation" class="text-xs text-purple-500 ml-1">({{ item.disambiguation }})</span>
            <span class="ml-2 text-xs">{{ typeIcons(item.types) }}</span>
            <span v-if="missingType(item)" class="text-xs text-amber-600 ml-1">（无{{ filterTypeLabel }}身份，选中将补上）</span>
          </div>
        </div>
        <div
          v-if="input.trim() && !isExactMatch"
          class="px-4 py-2 hover:bg-blue-50 cursor-pointer text-blue-600 text-sm border-t-2 border-blue-200"
          @mousedown.prevent="addNewTag"
        >
          ➕ 新增「{{ input.trim() }}」
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { ARTIST_TYPE_ICONS } from '@/lib/constants'
import ArtistInlineForm from '@/components/admin/ArtistInlineForm.vue'
import type { Artist, ArtistTag } from '@/lib/types'

/** 艺术家 tag 多选输入（歌手/专辑艺术家/作词/作曲共用）。
 *  admin 模式（后台审核/录歌）：tag 带头像，点击头像展开内联表单补全信息。 */
const props = defineProps<{
  modelValue: ArtistTag[]
  /** 全量艺术家（父组件一次性加载） */
  artists: Artist[]
  /** 类型过滤：singer/lyricist/composer；null 不过滤（专辑艺术家可为唱片公司等） */
  filterType?: string | null
  tone?: 'pink' | 'gray'
  /** 共享会话池（父组件持有）：本会话内任一字段新建过的艺术家名，跨字段联想复用 */
  sessionNames?: string[]
  /** 会话新建项名字 → 真实 id（已手填 ID 的会话新建，跨字段选中时保留该 id，而非重新标新建）；缺省时按 __new_ 处理 */
  sessionIdMap?: Record<string, string | null>
  /** 后台模式：tag 显示头像，点击头像可补全艺术家信息（老艺术家当场写库） */
  admin?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: ArtistTag[]): void
  (e: 'artist-saved', tag: ArtistTag): void
}>()

const input = ref('')
const dropdown = ref<Artist[]>([])
/** 当前展开内联表单的 tag（对象引用，删除 tag 后自动不渲染） */
const expandedTag = ref<ArtistTag | null>(null)

/** 输入框容器引用：下拉 Teleport 到 body 后据此计算 fixed 定位 */
const wrapEl = ref<HTMLElement | null>(null)
const dropdownPos = ref({ left: 0, top: 0, width: 0 })

function syncDropdownPos() {
  const el = wrapEl.value
  if (!el) return
  const r = el.getBoundingClientRect()
  dropdownPos.value = { left: r.left, top: r.bottom + 4, width: r.width }
}

const dropdownStyle = computed(() => ({
  left: dropdownPos.value.left + 'px',
  top: dropdownPos.value.top + 'px',
  width: dropdownPos.value.width + 'px',
}))

const dropdownOpen = computed(() => dropdown.value.length > 0 || (input.value.trim() !== '' && !isExactMatch.value))

/** 下拉展开期间监听滚动/缩放，实时重算 fixed 定位（弹窗内滚动区域滚动时跟随输入框） */
watch(dropdownOpen, open => {
  if (open) {
    syncDropdownPos()
    window.addEventListener('scroll', syncDropdownPos, true)
    window.addEventListener('resize', syncDropdownPos)
  } else {
    window.removeEventListener('scroll', syncDropdownPos, true)
    window.removeEventListener('resize', syncDropdownPos)
  }
})
onBeforeUnmount(() => {
  window.removeEventListener('scroll', syncDropdownPos, true)
  window.removeEventListener('resize', syncDropdownPos)
})

/**
 * 搜索池 = 数据库全量 + 共享会话池（按名去重）。
 * 会话内新建项 id 以 __new_ 开头、types 未知，不受 filterType 限制（同一人往往身兼歌手/作词/作曲）。
 * 已手填 ID 的会话新建（sessionIdMap 命中）保留真实 id，选中时不再回退为新建。
 */
const searchPool = computed<Artist[]>(() => {
  const extra = (props.sessionNames || [])
    .filter(n => n && !props.artists.some(a => a.name.toLowerCase() === n.toLowerCase()))
    .map(n => ({
      id: props.sessionIdMap?.[n] || '__new_' + n,
      name: n,
      types: [],
    }) as unknown as Artist)
  return [...props.artists, ...extra]
})

function typeIcons(types: string[] | null): string {
  return (types || ['singer']).map(t => ARTIST_TYPE_ICONS[t] || '').join('')
}

const TYPE_LABELS: Record<string, string> = { singer: '歌手', lyricist: '作词', composer: '作曲', arranger: '编曲' }
const filterTypeLabel = computed(() => (props.filterType ? TYPE_LABELS[props.filterType] || props.filterType : ''))

/** 库内已有艺术家但缺少当前字段类型（提示选中后补 type；不隐藏——隐藏会让审核时误判为需新建） */
function missingType(a: Artist): boolean {
  if (!props.filterType || (a.id || '').startsWith('__new_')) return false
  const types = a.types || ['singer']
  return !types.some(t => t === props.filterType)
}

function onInput() {
  const q = input.value.trim().toLowerCase()
  syncDropdownPos()
  if (!q) {
    dropdown.value = []
    return
  }
  // 不再按类型过滤：已有艺术家缺当前类型照样展示（选中即复用其 ID，发布时补 type）；
  // 仅会话内新建项（id 以 __new_ 开头）优先展示
  const items = searchPool.value.filter(a => a.name.toLowerCase().includes(q))
  // 精确匹配置顶
  items.sort((a, b) => {
    const ae = a.name.toLowerCase() === q ? 0 : 1
    const be = b.name.toLowerCase() === q ? 0 : 1
    return ae - be
  })
  dropdown.value = items.slice(0, 8)
}

/** 输入文本与某已有艺术家精确同名时隐藏"新增"项（避免重复新建） */
const isExactMatch = computed(() => {
  const q = input.value.trim().toLowerCase()
  if (!q) return true
  return searchPool.value.some(a => a.name.toLowerCase() === q)
})

function selectTag(item: Artist) {
  if (props.modelValue.some(t => t.name === item.name)) {
    input.value = ''
    dropdown.value = []
    return
  }
  emit('update:modelValue', [...props.modelValue, { id: (item.id || '').startsWith('__new_') ? null : item.id, name: item.name }])
  input.value = ''
  dropdown.value = []
}

function addNewTag() {
  const name = input.value.trim()
  if (!name) return
  // 大小写不敏感匹配：库内有「AA」时输入「aa」直接复用（tag 显示库内规范名）
  const exact = searchPool.value.find(a => a.name.toLowerCase() === name.toLowerCase())
  if (exact) {
    selectTag(exact)
    return
  }
  if (props.modelValue.some(t => t.name === name)) {
    input.value = ''
    dropdown.value = []
    return
  }
  emit('update:modelValue', [...props.modelValue, { id: null, name }])
  input.value = ''
  dropdown.value = []
}

function removeTag(idx: number) {
  const next = props.modelValue.slice()
  next.splice(idx, 1)
  emit('update:modelValue', next)
}

/** admin 模式：点击头像展开内联补全表单；首次展开时惰性合并池数据（不重复查库） */
function toggleExpand(t: ArtistTag) {
  if (expandedTag.value === t) {
    expandedTag.value = null
    return
  }
  // ??= 只补缺失字段：已补全过/编辑过的值不会被池数据覆盖。
  // _new 标记的是"已手填新 ID 的待创建艺术家"，走新建分支（不进库内池合并）
  if (t.id && !t._new) {
    const full = props.artists.find(a => a.id === t.id)
    if (full) {
      t.avatar ??= full.avatar || ''
      t.types ??= full.types ? [...full.types] : []
      t.disambiguation ??= full.disambiguation || ''
      t.aliases ??= full.aliases ? [...full.aliases] : []
      t.bio ??= full.bio || ''
      t.urls ??= full.urls ? { ...full.urls } : {}
    }
  } else {
    t.avatar ??= ''
    t.types ??= []
    t.disambiguation ??= ''
    t.aliases ??= []
    t.bio ??= ''
    t.urls ??= {}
  }
  expandedTag.value = t
}

/** 内联表单保存（老艺术家已写库）→ 透传给父组件更新本地艺术家池 */
function onArtistSaved(tag: ArtistTag) {
  emit('artist-saved', tag)
}

function onBackspace() {
  if (!input.value && props.modelValue.length > 0) {
    emit('update:modelValue', props.modelValue.slice(0, -1))
  }
}

function onBlur() {
  // 未提交的文字自动转为 tag，避免用户输入后忘记回车导致丢失
  if (input.value.trim()) addNewTag()
  setTimeout(() => {
    dropdown.value = []
  }, 200)
}
</script>
