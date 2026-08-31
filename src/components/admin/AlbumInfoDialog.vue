<template>
  <!--
    专辑信息共用弹窗（保存即入库）：
    单曲审核 / 批量审核单行编辑 / 歌曲管理（SongFormDialog）/ TTML Hub 新建展示 四处复用。
    新专辑：当场 INSERT + 绑专辑艺术家 + 回填关联；已关联专辑：当场写回差异。
    使用方在 saved 回调里把结果写回本地 albums 池（⚡弹窗下拉等即时刷新）。
  -->
  <el-dialog
    :model-value="modelValue"
    :title="albumId ? '专辑信息（已关联，保存即写回库）' : '新专辑信息（保存即入库）'"
    width="560px"
    append-to-body
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="space-y-3">
      <div class="flex items-center gap-3">
        <img
          v-if="form.cover"
          :src="form.cover"
          class="w-12 h-12 rounded object-cover cursor-pointer border border-gray-200"
          @click="ui.openPreview([form.cover])"
        />
        <span v-else class="w-12 h-12 rounded bg-gray-100 text-gray-400 flex items-center justify-center text-xl">💿</span>
        <div class="min-w-0">
          <div class="font-medium text-gray-800 truncate">{{ albumName }}</div>
          <div class="text-xs text-gray-400">{{ albumId ? '已关联库内专辑' : '新专辑' }}</div>
        </div>
      </div>
      <div>
        <div class="text-xs text-gray-500 mb-1">专辑艺术家</div>
        <ArtistTagInput v-model="form.albumArtists" :artists="artists" tone="gray" admin @artist-saved="onArtistSaved" />
      </div>
      <el-input v-model="form.cover" placeholder="专辑封面 URL（选填）" />
      <el-input v-model="form.year" maxlength="4" placeholder="年份（选填，如 2024）" />
      <el-input v-model="form.description" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" placeholder="专辑简介（选填，Markdown）" />
    </div>
    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">
        {{ albumId ? '保存写回' : '保存并入库' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { adminApi } from '@/lib/adminApi'
import { syncAlbumContributors } from '@/lib/contribRelations'
import { useUiStore } from '@/stores/ui'
import ArtistTagInput from '@/components/submit/ArtistTagInput.vue'
import type { Artist, ArtistTag } from '@/lib/types'

const ui = useUiStore()

const props = defineProps<{
  modelValue: boolean
  artists: Artist[]
  /** 当前关联专辑 id；null = 新专辑 */
  albumId: string | null
  /** 专辑名（新建时用于建库） */
  albumName: string
  /** 初始值：专辑艺术家（ArtistTag 数组） */
  albumArtists?: ArtistTag[]
  cover?: string
  year?: string | number | null
  description?: string | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', val: boolean): void
  /** 保存成功：新专辑 albumId 为新生成 id；返回专辑最新字段，使用方据此更新本地池 */
  (e: 'saved', payload: { albumId: string; name: string; year: number | null; cover: string; description: string | null; artistIds: string[] }): void
  /** 内联表单保存艺术家（含新建即入库）→ 透传给使用方同步本地艺术家池 */
  (e: 'artist-saved', tag: ArtistTag): void
}>()

const saving = ref(false)
const form = reactive({
  albumArtists: [] as ArtistTag[],
  cover: '',
  year: '',
  description: '',
})

/** 打开时从 props 初始化表单（关闭后再开取最新值） */
watch(() => props.modelValue, (v) => {
  if (!v) return
  form.albumArtists = JSON.parse(JSON.stringify(props.albumArtists || []))
  form.cover = props.cover || ''
  form.year = String(props.year ?? '')
  form.description = props.description || ''
})

/** 保存即入库：新专辑当场建库（回填关联由使用方接 saved 处理）；已关联当场写回差异 */
async function save() {
  if (!props.albumId && !String(props.albumName || '').trim()) {
    ElMessage.warning('请先填写专辑名')
    return
  }
  saving.value = true
  try {
    const albumArtistIds = (form.albumArtists || []).map(a => a.id).filter(Boolean) as string[]
    const year = form.year ? (parseInt(String(form.year), 10) || null) : null
    if (props.albumId) {
      // 已关联：当场写回差异（与发布链路沿用分支同一套比较规则，由使用方传库内当前值）
      const patch: Record<string, any> = {}
      if (form.cover && form.cover !== (props.cover ?? '')) patch.cover = form.cover
      if (year && year !== (yearOf(props.year) ?? null)) patch.year = year
      if ((form.description || '') !== (props.description || '')) patch.description = form.description || null
      if (Object.keys(patch).length) await adminApi.update('albums', props.albumId, patch)
      await syncAlbumContributors(props.albumId, albumArtistIds)
      emit('saved', {
        albumId: props.albumId,
        name: String(props.albumName).trim(),
        year,
        cover: form.cover || '',
        description: form.description || null,
        artistIds: albumArtistIds,
      })
      ElMessage.success('专辑信息已写回数据库')
    } else {
      // 新专辑：当场建库；saved 回传新 id，使用方回填行/表单关联
      const albumId = 'al' + Date.now() + Math.floor(Math.random() * 1000)
      const name = String(props.albumName).trim()
      await adminApi.insert('albums', {
        id: albumId,
        name,
        year,
        cover: form.cover || '',
        description: form.description || null,
      })
      await syncAlbumContributors(albumId, albumArtistIds)
      emit('saved', {
        albumId,
        name,
        year,
        cover: form.cover || '',
        description: form.description || null,
        artistIds: albumArtistIds,
      })
      ElMessage.success('新专辑已创建并入库')
    }
    emit('update:modelValue', false)
  } catch (e: any) {
    ElMessage.error(e.message || '专辑保存失败')
  } finally {
    saving.value = false
  }
}

function yearOf(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = parseInt(String(v), 10)
  return Number.isFinite(n) ? n : null
}

/** 艺术家内联保存（老艺术家已写库 / 新建已入库）→ 透传使用方更新池 */
function onArtistSaved(tag: ArtistTag) {
  emit('artist-saved', tag)
}
</script>
