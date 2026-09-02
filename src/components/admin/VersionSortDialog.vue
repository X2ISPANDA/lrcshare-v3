<template>
  <el-dialog
    :model-value="modelValue"
    :title="`歌词版本排序 - ${song?.title || ''}`"
    width="560px"
    @update:model-value="v => emit('update:modelValue', v)"
    @open="onOpen"
    @closed="items = []"
  >
    <div v-loading="loading">
      <p class="text-xs text-gray-400 mb-3">
        顺序决定歌曲页「TTML 版本下拉」与「LRC 源下拉」的展示顺序，排在第一位的版本为默认展示版本。
        新投稿通过的版本默认排在最后。
      </p>
      <div v-if="!loading && !items.length" class="text-sm text-gray-400 text-center py-8">该歌曲暂无已发布歌词版本</div>
      <div class="space-y-2">
        <div
          v-for="(m, i) in items"
          :key="m.id"
          class="flex items-center gap-2.5 rounded-lg border px-3 py-2"
          :class="i === 0 ? 'border-pink-200 bg-pink-50/50' : 'border-gray-100 bg-white'"
        >
          <el-input-number
            :model-value="i + 1"
            :min="1"
            :max="items.length"
            :controls="false"
            size="small"
            class="!w-16 shrink-0"
            @change="(v: number | undefined) => moveTo(i, v)"
          />
          <el-button link type="primary" size="small" class="shrink-0" :disabled="i === 0" @click="moveTo(i, 1)">置顶</el-button>
          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5 flex-wrap">
              <el-tag size="small" :type="formatTagType(m.format)">{{ formatLabel(m.format) }}</el-tag>
              <el-tag v-if="m.source === 'ttml-hub'" size="small" type="info">Hub</el-tag>
              <span class="text-sm text-gray-700 truncate">{{ ownerLabel(m) }}</span>
            </div>
            <div v-if="langLabel(m.langs)" class="text-xs text-gray-400 mt-0.5 truncate">{{ langLabel(m.langs) }}</div>
          </div>
        </div>
      </div>
    </div>
    <template #footer>
      <el-button @click="emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存顺序</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { ElMessage } from 'element-plus'
import { adminApi } from '@/lib/adminApi'
import { loadLyricVersionMetas, LYRIC_LANG_LABELS, type LyricVersionMeta } from '@/lib/lyricLines'

const props = defineProps<{
  modelValue: boolean
  song: { id: string; title: string } | null
}>()
const emit = defineEmits<{
  'update:modelValue': [value: boolean]
  saved: []
}>()

const loading = ref(false)
const saving = ref(false)
const items = ref<LyricVersionMeta[]>([])

async function onOpen() {
  if (!props.song) return
  loading.value = true
  try {
    items.value = await loadLyricVersionMetas(props.song.id, false)
  } catch (e) {
    console.error(e)
    ElMessage.error('版本加载失败')
    items.value = []
  } finally {
    loading.value = false
  }
}

/** 把第 index 行移动到第 pos 位（1 起）；位次即列表顺序，保存时统一写回，无重号/跳号问题 */
function moveTo(index: number, pos: number | undefined) {
  const n = items.value.length
  const target = Math.trunc(Number(pos))
  if (!target || Number.isNaN(target)) return
  const t = Math.min(Math.max(target, 1), n)
  if (t === index + 1) return
  const arr = [...items.value]
  const [it] = arr.splice(index, 1)
  arr.splice(t - 1, 0, it)
  items.value = arr
}

async function save() {
  if (!props.song) return
  saving.value = true
  try {
    // 位次 1..n 写回为 10,20,30…（留间隔，未来可插队）
    await Promise.all(
      items.value.map((m, i) => adminApi.update('lyric_versions', m.id, { sort_order: (i + 1) * 10 })),
    )
    ElMessage.success('展示顺序已保存')
    emit('update:modelValue', false)
    emit('saved')
  } catch (e: any) {
    console.error(e)
    ElMessage.error('保存失败：' + (e?.message || e))
  } finally {
    saving.value = false
  }
}

function formatLabel(f: string) {
  return f === 'ttml' ? 'TTML' : f === 'enhanced' ? '逐字 LRC' : 'LRC'
}
function formatTagType(f: string): 'danger' | 'warning' | 'info' {
  return f === 'ttml' ? 'danger' : f === 'enhanced' ? 'warning' : 'info'
}
function ownerLabel(m: LyricVersionMeta) {
  return m.contributor_name || (m.source === 'ttml-hub' ? 'LunaBeat（TTML Hub）' : '官方')
}
function langLabel(langs: string[] | null) {
  return (langs || []).map(l => LYRIC_LANG_LABELS[l] || l).join(' / ')
}
</script>
