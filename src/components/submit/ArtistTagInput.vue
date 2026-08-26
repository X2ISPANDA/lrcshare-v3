<template>
  <div class="relative">
    <div class="w-full min-h-[42px] px-2 py-1 border border-gray-200 rounded-lg flex flex-wrap gap-1 items-center focus-within:ring-2 focus-within:ring-pink-500">
      <span
        v-for="(t, i) in modelValue"
        :key="i"
        class="inline-flex items-center gap-1 px-2 py-0.5 rounded text-sm"
        :class="tone === 'pink' ? 'bg-pink-100 text-pink-700' : 'bg-gray-100 text-gray-700'"
      >
        {{ t.name }}<span v-if="!t.id" class="text-xs text-blue-600">新建</span>
        <button type="button" class="leading-none opacity-60 hover:opacity-100" @click="removeTag(i)">×</button>
      </span>
      <input
        type="text"
        v-model="input"
        placeholder="搜索或输入后回车"
        class="flex-1 min-w-[100px] outline-none text-sm py-1"
        @input="onInput"
        @keydown.enter.prevent="addNewTag"
        @keydown.delete="onBackspace"
        @blur="onBlur"
      />
    </div>
    <div
      v-if="dropdown.length || (input.trim() && !isExactMatch)"
      class="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto"
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
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { ARTIST_TYPE_ICONS } from '@/lib/constants'
import type { Artist } from '@/lib/types'

/** 艺术家 tag 多选输入（歌手/专辑艺术家/作词/作曲共用） */
const props = defineProps<{
  modelValue: { id: string | null; name: string }[]
  /** 全量艺术家（父组件一次性加载） */
  artists: Artist[]
  /** 类型过滤：singer/lyricist/composer；null 不过滤（专辑艺术家可为唱片公司等） */
  filterType?: string | null
  tone?: 'pink' | 'gray'
  /** 共享会话池（父组件持有）：本会话内任一字段新建过的艺术家名，跨字段联想复用 */
  sessionNames?: string[]
}>()

const emit = defineEmits<{ (e: 'update:modelValue', v: { id: string | null; name: string }[]): void }>()

const input = ref('')
const dropdown = ref<Artist[]>([])

/**
 * 搜索池 = 数据库全量 + 共享会话池（按名去重）。
 * 会话内新建项 id 以 __new_ 开头、types 未知，不受 filterType 限制（同一人往往身兼歌手/作词/作曲）。
 */
const searchPool = computed<Artist[]>(() => {
  const extra = (props.sessionNames || [])
    .filter(n => n && !props.artists.some(a => a.name.toLowerCase() === n.toLowerCase()))
    .map(n => ({ id: '__new_' + n, name: n, types: [] }) as unknown as Artist)
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
