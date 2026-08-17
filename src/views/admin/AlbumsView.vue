<template>
  <div class="space-y-4">
    <!-- 工具条 -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-wrap items-center gap-3 px-5 py-3">
      <el-input v-model="keyword" placeholder="搜索专辑名 / 专辑艺术家" clearable class="!w-64" :prefix-icon="Search" />
      <div class="flex-1"></div>
      <el-button type="primary" @click="openNew" style="--el-button-bg-color: #ec4899; --el-button-border-color: #ec4899; --el-button-hover-bg-color: #db2777; --el-button-hover-border-color: #db2777">+ 新增专辑</el-button>
    </div>

    <div class="bg-white rounded-xl border border-gray-100 shadow-sm">
      <el-table :data="pagedList" stripe v-loading="loading" row-key="id" @selection-change="selected = $event">
        <el-table-column type="selection" width="45" />
        <el-table-column label="专辑" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="flex items-center gap-2">
              <img v-if="row.cover" :src="row.cover" referrerpolicy="no-referrer" class="w-9 h-9 rounded object-cover flex-shrink-0" />
              <div v-else class="w-9 h-9 rounded bg-gray-100 flex items-center justify-center flex-shrink-0 text-gray-300 text-sm">♪</div>
              <span class="font-medium text-gray-800">{{ row.name }}</span>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="专辑艺术家" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ namesOf(row.artist_ids) || '—' }}</template>
        </el-table-column>
        <el-table-column label="年份" width="80" align="center">
          <template #default="{ row }">{{ row.year || '—' }}</template>
        </el-table-column>
        <el-table-column label="歌曲数" width="75" align="center">
          <template #default="{ row }">{{ songCount(row.id) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="130" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="removeOne(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="flex justify-between items-center px-5 py-4 border-t border-gray-100">
        <div class="flex gap-2">
          <el-button size="small" :disabled="!selected.length" plain @click="clearSelection">取消选择</el-button>
          <el-button size="small" type="danger" :disabled="!selected.length" @click="batchRemove">批量删除</el-button>
        </div>
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50]"
          :total="filteredList.length"
          layout="total, sizes, prev, pager, next"
          background
        />
      </div>
    </div>

    <!-- 新增 / 编辑弹窗 -->
    <el-dialog v-model="showDialog" :title="editing ? '编辑专辑' : '新增专辑'" width="560px" :close-on-click-modal="false">
      <el-form :model="form" label-width="96px">
        <el-form-item label="专辑名" required>
          <el-input v-model="form.name" placeholder="专辑名称" />
        </el-form-item>
        <el-form-item label="专辑艺术家">
          <div class="w-full">
            <ArtistTagInput v-model="form.artists" :artists="artists" tone="gray" />
            <div class="text-xs text-gray-400 mt-1">支持多选；可直接输入新名称（如唱片公司、音乐平台等非创作者实体）</div>
          </div>
        </el-form-item>
        <el-form-item v-if="newArtistNames.length" label="新实体展示">
          <div class="w-full space-y-2">
            <div v-for="n in newArtistNames" :key="n" class="flex items-center gap-3">
              <span class="text-sm text-gray-700 min-w-24">{{ n }}</span>
              <el-switch v-model="newArtistShow[n]" active-text="前台展示" inactive-text="不展示" />
            </div>
          </div>
        </el-form-item>
        <el-form-item label="年份">
          <el-input v-model="form.year" placeholder="2024" maxlength="4" class="!w-40" />
        </el-form-item>
        <el-form-item label="首字母">
          <div class="w-full">
            <el-input v-model="form.initial" placeholder="留空自动按拼音" maxlength="1" class="!w-40" style="text-transform: uppercase" />
            <div class="text-xs text-gray-400 mt-1">专辑名多音字分错组时手动指定</div>
          </div>
        </el-form-item>
        <el-form-item label="封面 URL">
          <el-input v-model="form.cover" placeholder="留空使用默认封面" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { adminApi } from '@/lib/adminApi'
import ArtistTagInput from '@/components/submit/ArtistTagInput.vue'
import type { Album, Artist } from '@/lib/types'

/** 专辑管理：列表（封面/艺术家/年份/歌曲数）+ 新增/编辑（专辑艺术家支持新建非创作者实体） */

const albums = ref<Album[]>([])
const artists = ref<Artist[]>([])
const songAlbums = ref<string[]>([])
const loading = ref(false)
const keyword = ref('')
const page = ref(1)
const pageSize = ref(20)
const selected = ref<Album[]>([])
const tableRef = ref()

const artistMap = computed(() => new Map(artists.value.map(a => [a.id, a])))
const countMap = computed(() => {
  const m = new Map<string, number>()
  for (const id of songAlbums.value) m.set(id, (m.get(id) || 0) + 1)
  return m
})
const songCount = (id: string) => countMap.value.get(id) || 0

function namesOf(ids: string[] | null): string {
  return (ids || []).map(id => artistMap.value.get(id)?.name || id).join(', ')
}

const filteredList = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return albums.value
  return albums.value.filter(a => {
    if (a.name?.toLowerCase().includes(kw)) return true
    return (a.artist_ids || []).some(id => artistMap.value.get(id)?.name?.toLowerCase().includes(kw))
  })
})
const pagedList = computed(() => filteredList.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

async function load() {
  loading.value = true
  try {
    const [al, a, songs] = await Promise.all([
      adminApi.getAll<Album>('albums', { order: 'name' }),
      adminApi.getAll<Artist>('artists', { order: 'name' }),
      adminApi.getAll<any>('songs', { select: 'album_id' }),
    ])
    albums.value = al
    artists.value = a
    songAlbums.value = songs.map(s => s.album_id).filter(Boolean)
  } catch (e: any) {
    ElMessage.error('加载失败：' + e.message)
  } finally {
    loading.value = false
  }
}
onMounted(load)

function clearSelection() {
  tableRef.value?.clearSelection()
  selected.value = []
}

// ============ 编辑弹窗 ============
const showDialog = ref(false)
const editing = ref<Album | null>(null)
const saving = ref(false)

const form = reactive({
  name: '',
  artists: [] as { id: string | null; name: string }[],
  year: '',
  cover: '',
  initial: '',
})
/** 新建实体（无 id tag）的前台展示开关，默认不展示（多为唱片公司/平台） */
const newArtistShow = reactive<Record<string, boolean>>({})

const newArtistNames = computed(() => form.artists.filter(t => !t.id).map(t => t.name))

function openNew() {
  editing.value = null
  Object.assign(form, { name: '', artists: [], year: '', cover: '', initial: '' })
  Object.keys(newArtistShow).forEach(k => delete newArtistShow[k])
  showDialog.value = true
}

function openEdit(row: Album) {
  editing.value = row
  Object.assign(form, {
    name: row.name || '',
    artists: (row.artist_ids || []).map(id => ({ id, name: artistMap.value.get(id)?.name || id })),
    year: row.year ? String(row.year) : '',
    cover: row.cover || '',
    initial: row.initial || '',
  })
  Object.keys(newArtistShow).forEach(k => delete newArtistShow[k])
  showDialog.value = true
}

async function save() {
  if (!form.name.trim()) {
    ElMessage.warning('请输入专辑名')
    return
  }
  saving.value = true
  try {
    // 1. 解析专辑艺术家：已有直接用，新名创建（types 空，is_show 按开关，默认不展示）
    const ids: string[] = []
    for (const t of form.artists) {
      if (t.id) {
        ids.push(t.id)
      } else {
        const created = await adminApi.insert<Artist>('artists', {
          id: 'a' + Date.now() + Math.floor(Math.random() * 1000),
          name: t.name,
          types: [],
          is_show: newArtistShow[t.name] === true,
          sort: 0,
        })
        artists.value.push(created as Artist)
        ids.push(created!.id)
      }
    }
    // 2. 保存专辑
    const payload = {
      name: form.name.trim(),
      artist_ids: ids,
      year: form.year.trim() ? parseInt(form.year.trim()) : null,
      cover: form.cover.trim() || '',
      initial: form.initial.trim().toUpperCase() || null,
    }
    if (editing.value) {
      await adminApi.update('albums', editing.value.id, payload)
      ElMessage.success('保存成功')
    } else {
      await adminApi.insert('albums', { id: 'al' + Date.now(), ...payload })
      ElMessage.success('新增专辑成功')
    }
    showDialog.value = false
    await load()
  } catch (e: any) {
    ElMessage.error('保存失败：' + (e?.message || e))
  } finally {
    saving.value = false
  }
}

async function removeOne(row: Album) {
  try {
    await ElMessageBox.confirm(`确定删除专辑「${row.name}」？专辑下的歌曲不会被删除，但会解除关联。`, '危险操作', { type: 'warning' })
    await adminApi.remove('albums', row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error('删除失败：' + e.message)
  }
}

async function batchRemove() {
  if (!selected.value.length) return
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selected.value.length} 张专辑？专辑下的歌曲会解除关联但不删除。`, '批量删除', { type: 'warning' })
    await adminApi.removeBatch('albums', selected.value.map(a => a.id))
    ElMessage.success('批量删除完成')
    clearSelection()
    await load()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error('删除失败：' + e.message)
  }
}

watch(keyword, () => (page.value = 1))
watch(pageSize, () => (page.value = 1))
</script>
