<template>
  <div class="space-y-4">
    <!-- 工具条 -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-wrap items-center gap-3 px-5 py-3">
      <el-input v-model="keyword" placeholder="搜索歌曲名 / 歌手 / 专辑" clearable class="w-full sm:!w-64" :prefix-icon="Search" />
      <div class="flex-1"></div>
      <el-button type="primary" @click="openNew" style="--el-button-bg-color: #ec4899; --el-button-border-color: #ec4899; --el-button-hover-bg-color: #db2777; --el-button-hover-border-color: #db2777">+ 新增歌曲</el-button>
    </div>

    <div class="bg-white rounded-xl border border-gray-100 shadow-sm">
      <AdminTable
        ref="tableRef"
        :data="songs"
        :loading="loading"
        row-key="id"
        :default-sort="{ prop: 'created_at', order: 'descending' }"
        @selection-change="selected = $event"
        @sort-change="onSortChange"
      >
        <el-table-column type="selection" width="45" />
        <el-table-column label="歌曲名" min-width="170" prop="title" sortable="custom" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="font-medium text-gray-800">{{ row.title }}</span>
            <span v-if="row.aliases?.length" class="text-xs text-gray-400 ml-1">{{ row.aliases.join(' / ') }}</span>
            <el-tag v-if="row.is_hidden" size="small" type="info" class="ml-1">隐藏</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="歌手" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ namesOf(row.artist_ids) || '未知' }}</template>
        </el-table-column>
        <el-table-column label="专辑" min-width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ albumMap.get(row.album_id)?.name || '—' }}</template>
        </el-table-column>
        <el-table-column label="时长" width="75">
          <template #default="{ row }">{{ row.duration || '—' }}</template>
        </el-table-column>
        <el-table-column label="创建时间" width="105" prop="created_at" sortable="custom">
          <template #default="{ row }">{{ fmtDate(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="贡献者" width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ contributorMap.get(row.contributor_id)?.name || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="175" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link type="warning" size="small" @click="openSort(row)">版本</el-button>
            <el-button link type="danger" size="small" @click="removeOne(row)">删除</el-button>
          </template>
        </el-table-column>

        <!-- 移动端卡片 -->
        <template #card="{ row }">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="font-medium text-gray-800 truncate">{{ row.title }}</div>
              <div class="text-xs text-gray-400 truncate mt-0.5">
                {{ namesOf(row.artist_ids) || '未知' }}<template v-if="albumMap.get(row.album_id)?.name"> · {{ albumMap.get(row.album_id)?.name }}</template><template v-if="row.duration"> · {{ row.duration }}</template><template v-if="row.created_at"> · {{ fmtDate(row.created_at) }}</template>
              </div>
              <div v-if="contributorMap.get(row.contributor_id)" class="text-xs text-gray-400 mt-0.5">贡献者：{{ contributorMap.get(row.contributor_id)?.name }}</div>
            </div>
            <el-tag v-if="row.is_hidden" size="small" type="info" class="shrink-0">隐藏</el-tag>
          </div>
          <div class="mt-2 pt-2 border-t border-gray-50 flex gap-1">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link type="warning" size="small" @click="openSort(row)">版本</el-button>
            <el-button link type="danger" size="small" @click="removeOne(row)">删除</el-button>
          </div>
        </template>
      </AdminTable>

      <div class="flex justify-between items-center px-5 py-4 border-t border-gray-100">
        <div class="flex gap-2">
          <el-button size="small" :disabled="!selected.length" plain @click="clearSelection">取消选择</el-button>
          <el-button size="small" type="danger" :disabled="!selected.length" @click="batchRemove">批量删除</el-button>
        </div>
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50]"
          :total="total"
          layout="total, sizes, prev, pager, next"
          :pager-count="5"
          background
        />
      </div>
    </div>

    <!-- 歌词版本排序弹窗 -->
    <VersionSortDialog v-model="showSort" :song="sortingSong" />

    <!-- 新增 / 编辑弹窗（共用组件） -->
    <SongFormDialog
      v-model="showDialog"
      :artists="artists"
      :albums="albums"
      :contributors="contributors"
      :initial="editing"
      :edit-song-id="editing ? editing.id : null"
      :title="editing ? '编辑歌曲' : '新增歌曲'"
      @saved="onFormSaved"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Search } from '@element-plus/icons-vue'
import { recomputeArtistTypes } from '@/lib/artistTypes'
import { adminApi } from '@/lib/adminApi'
import AdminTable from '@/components/admin/AdminTable.vue'
import SongFormDialog from '@/components/admin/SongFormDialog.vue'
import VersionSortDialog from '@/components/admin/VersionSortDialog.vue'
import type { Artist, Contributor } from '@/lib/types'

/** 歌曲管理：列表 + 新增/编辑（表单交由共用 SongFormDialog） */

const route = useRoute()
const songs = ref<any[]>([])
const artists = ref<Artist[]>([])
const albums = ref<any[]>([])
const contributors = ref<Contributor[]>([])
const loading = ref(false)
const keyword = ref('')
/** 防抖后实际生效的搜索词（输完停顿 300ms 才发请求） */
const searchKw = ref('')
const page = ref(1)
const pageSize = ref(10)
const total = ref(0)
/** 列头排序（duration 为 "3:45" 文本不参与排序；可排序：title / created_at） */
const sortField = ref<'title' | 'created_at'>('created_at')
const sortAsc = ref(false)
const selected = ref<any[]>([])
const tableRef = ref()

const artistMap = computed(() => new Map(artists.value.map(a => [a.id, a])))
const albumMap = computed(() => new Map(albums.value.map(a => [a.id, a])))
const contributorMap = computed(() => new Map(contributors.value.map(c => [c.id, c])))

function namesOf(ids: string[] | null): string {
  return (ids || []).map(id => artistMap.value.get(id)?.name || id).join(', ')
}

function fmtDate(v: string | null): string {
  return v ? String(v).slice(0, 10) : '—'
}

/** 小字典全量加载一次（艺术家/专辑/贡献者/专辑贡献者，百条级，翻页不重复拉） */
async function loadDicts() {
  const [a, al, c, ac] = await Promise.all([
    adminApi.getAll<Artist>('artists', { order: 'name' }),
    adminApi.getAll('albums', { order: 'name' }),
    adminApi.getAll<Contributor>('contributors', { order: 'sort' }),
    adminApi.getAll('album_contributors'),
  ])
  const acMap = new Map<string, string[]>()
  for (const r of ac as any[]) {
    const list = acMap.get(r.album_id) || []
    list.push(r.artist_id)
    acMap.set(r.album_id, list)
  }
  artists.value = a
  albums.value = (al as any[]).map(row => ({ ...row, artist_ids: acMap.get(row.id) || [] }))
  contributors.value = c
}

/** 歌曲页：无关键词走表分页，有关键词走库端 admin_search_songs（歌名/歌手/专辑全字段） */
async function loadSongs() {
  loading.value = true
  try {
    const kw = searchKw.value.trim()
    const pageOpts = { page: page.value, pageSize: pageSize.value, order: sortField.value, ascending: sortAsc.value }
    const res = kw
      ? await adminApi.rpcPage('admin_search_songs', { p_q: kw }, pageOpts)
      : await adminApi.getPage('songs', pageOpts)
    total.value = res.total
    const rows = res.data as any[]
    const ids = rows.map(r => r.id)
    // 中间表只拉当前页歌曲的关联行（随歌曲数增长的三张表不再全量拉）
    const [sc, sec] = await Promise.all([
      ids.length ? adminApi.getAll('song_contributors', { in: { song_id: ids } }) : Promise.resolve([] as any[]),
      ids.length ? adminApi.getAll('song_secrets', { in: { song_id: ids } }) : Promise.resolve([] as any[]),
    ])
    // 中间表 → 歌行装饰（artist_ids=歌手；lyricist/composer/arranger 由关系行拼回字符串，下游沿用旧字段名）
    const scMap = new Map<string, Record<string, string[]>>()
    for (const r of sc as any[]) {
      const e = scMap.get(r.song_id) || { singer: [], lyricist: [], composer: [], arranger: [] }
      if (e[r.role]) e[r.role].push(r.artist_id)
      scMap.set(r.song_id, e)
    }
    // 口令：song_secrets 为权威数据源（songs.unlock_code 过渡期兜底，phase3 步骤 3 删列）
    const secMap = new Map<string, string>()
    for (const r of sec as any[]) secMap.set(r.song_id, r.unlock_code || '')
    songs.value = rows.map(row => {
      const e = scMap.get(row.id)
      return {
        ...row,
        unlock_code: secMap.has(row.id) ? secMap.get(row.id)! : (row.unlock_code || ''),
        artist_ids: e?.singer || [],
        lyricist: (e?.lyricist || []).join(','),
        composer: (e?.composer || []).join(','),
        arranger: (e?.arranger || []).join(','),
      }
    })
    clearSelection()
  } catch (e: any) {
    ElMessage.error('加载失败：' + e.message)
  } finally {
    loading.value = false
  }
}

/** 增删改后刷新：字典可能新增艺术家/专辑，一并重拉（字典失败不阻塞歌曲列表） */
async function reloadAll() {
  try {
    await loadDicts()
  } catch (e: any) {
    ElMessage.error('字典加载失败：' + e.message)
  }
  await loadSongs()
}

/** 列头排序：再次点击同列切换升降序，取消排序回到默认（创建时间倒序） */
function onSortChange({ prop, order }: { prop: string | null; order: 'ascending' | 'descending' | null }) {
  if (prop === 'title' || prop === 'created_at') sortField.value = prop
  if (order) sortAsc.value = order === 'ascending'
  else {
    sortField.value = 'created_at'
    sortAsc.value = false
  }
  page.value = 1
}

let kwTimer: ReturnType<typeof setTimeout> | undefined
watch(keyword, v => {
  clearTimeout(kwTimer)
  kwTimer = setTimeout(() => {
    searchKw.value = v.trim()
    page.value = 1
  }, 300)
})
watch(pageSize, () => {
  page.value = 1
})
watch([page, pageSize, searchKw, sortField, sortAsc], () => {
  loadSongs()
})

onMounted(async () => {
  await reloadAll()
  // dashboard「直接发布新歌」入口
  if (route.query.new) openNew()
})

function clearSelection() {
  tableRef.value?.clearSelection()
  selected.value = []
}

// ============ 歌词版本排序 ============
const showSort = ref(false)
const sortingSong = ref<{ id: string; title: string } | null>(null)
function openSort(row: any) {
  sortingSong.value = { id: row.id, title: row.title }
  showSort.value = true
}

// ============ 新增 / 编辑弹窗（表单交由 SongFormDialog 共用组件） ============
const showDialog = ref(false)
const editing = ref<any>(null)

function openNew() {
  editing.value = null
  showDialog.value = true
}

function openEdit(row: any) {
  editing.value = row
  showDialog.value = true
}

/** 表单保存成功后（共用组件下发 payload）刷新列表 */
function onFormSaved() {
  reloadAll()
}

/** 删除的歌曲牵涉的艺术家（演唱/作词/作曲/编曲/专辑艺术家）→ 删后重算其 types（清掉失去作品支撑的类型） */
function affectedArtistIds(rows: any[]) {
  const ids = new Set<string>()
  const idsOf = (s: string | null) => String(s || '').split(',').map(x => x.trim()).filter(Boolean)
  for (const r of rows) {
    ;(r.artist_ids || []).forEach((id: string) => ids.add(id))
    idsOf(r.lyricist).forEach(id => ids.add(id))
    idsOf(r.composer).forEach(id => ids.add(id))
    idsOf(r.arranger).forEach(id => ids.add(id))
    ;(albumMap.value.get(r.album_id)?.artist_ids || []).forEach((id: string) => ids.add(id))
  }
  return [...ids]
}

async function removeOne(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除歌曲《${row.title}》？`, '确认删除', { type: 'warning' })
    const artistIds = affectedArtistIds([row])
    await adminApi.remove('songs', row.id)
    await recomputeArtistTypes(artistIds)
    ElMessage.success('已删除')
    await reloadAll()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error('删除失败：' + e.message)
  }
}

async function batchRemove() {
  if (!selected.value.length) return
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selected.value.length} 首歌曲？`, '批量删除', { type: 'warning' })
    const artistIds = affectedArtistIds(selected.value)
    await adminApi.removeBatch('songs', selected.value.map(s => s.id))
    await recomputeArtistTypes(artistIds)
    ElMessage.success('批量删除完成')
    clearSelection()
    await reloadAll()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error('删除失败：' + e.message)
  }
}
</script>
