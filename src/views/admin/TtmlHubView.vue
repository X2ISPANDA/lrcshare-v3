<template>
  <div class="space-y-6">
    <el-alert type="info" :closable="false" show-icon
      title="TTML Hub 同步管理"
      description="ttml-hub 每次同步产生的待匹配条目在此人工确认：挂到库里已有歌、忽略，或对已导入版本挪歌/删除。自动建的白板歌可在「歌曲管理」中编辑补全信息。" />

    <!-- ===== 待确认队列 ===== -->
    <el-card shadow="never">
      <template #header>
        <div class="flex items-center justify-between">
          <span class="font-bold">待确认队列（{{ pendings.length }}）</span>
          <el-button size="small" :loading="loading" @click="load">刷新</el-button>
        </div>
      </template>
      <AdminTable :data="pagedPendings" :loading="loading" row-key="id">
        <el-table-column prop="title" label="标题" min-width="180" show-overflow-tooltip />
        <el-table-column label="歌手" min-width="140">
          <template #default="{ row }">{{ (row.artists || []).join(', ') || '—' }}</template>
        </el-table-column>
        <el-table-column prop="album" label="专辑" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.album || '—' }}</template>
        </el-table-column>
        <el-table-column label="命中情况" min-width="200">
          <template #default="{ row }">
            <el-tag size="small" :type="row.reason === 'multi_candidate' ? 'warning' : 'info'" class="mr-1">
              {{ reasonLabel(row) }}
            </el-tag>
            <span v-if="candidateSongTitles(row)" class="text-xs text-gray-500">{{ candidateSongTitles(row) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button size="small" type="primary" @click="openPicker(row)">挂到歌</el-button>
            <el-button size="small" @click="ignorePending(row)">忽略</el-button>
          </template>
        </el-table-column>
        <template #card="{ row }">
          <div class="space-y-1.5">
            <div class="font-medium text-sm break-all">{{ row.title }}</div>
            <div class="text-xs text-gray-500">{{ (row.artists || []).join(', ') || '—' }} · {{ row.album || '无专辑' }}</div>
            <div class="text-xs">
              <el-tag size="small" :type="row.reason === 'multi_candidate' ? 'warning' : 'info'">{{ reasonLabel(row) }}</el-tag>
              <span v-if="candidateSongTitles(row)" class="text-gray-500 ml-1">{{ candidateSongTitles(row) }}</span>
            </div>
            <div class="flex gap-2 pt-1">
              <el-button size="small" type="primary" @click="openPicker(row)">挂到歌</el-button>
              <el-button size="small" @click="ignorePending(row)">忽略</el-button>
            </div>
          </div>
        </template>
      </AdminTable>
      <el-pagination v-if="pendings.length > pageSize" class="mt-4 justify-center" layout="prev, pager, next"
        :total="pendings.length" :page-size="pageSize" v-model:current-page="page" />
    </el-card>

    <!-- ===== 已导入版本 ===== -->
    <el-card shadow="never">
      <template #header>
        <div class="flex items-center justify-between">
          <span class="font-bold">已导入版本（{{ imported.length }}）</span>
          <el-input v-model="importedKw" placeholder="搜索歌名 / Hub ID" clearable class="w-full sm:!w-64" :prefix-icon="Search" />
        </div>
      </template>
      <AdminTable :data="pagedImported" :loading="loading" row-key="id">
        <el-table-column label="所属歌" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ songTitle(row.song_id) }}</template>
        </el-table-column>
        <el-table-column prop="external_id" label="Hub 歌曲ID" min-width="140" />
        <el-table-column label="语言" min-width="100">
          <template #default="{ row }">{{ (row.langs || []).join(', ') || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button size="small" @click="openMoveDialog(row)">挪歌</el-button>
            <el-button size="small" type="danger" @click="removeVersion(row)">删除</el-button>
          </template>
        </el-table-column>
        <template #card="{ row }">
          <div class="space-y-1.5">
            <div class="font-medium text-sm">{{ songTitle(row.song_id) }}</div>
            <div class="text-xs text-gray-500">Hub ID: {{ row.external_id }} · 语言: {{ (row.langs || []).join(', ') || '—' }}</div>
            <div class="flex gap-2 pt-1">
              <el-button size="small" @click="openMoveDialog(row)">挪歌</el-button>
              <el-button size="small" type="danger" @click="removeVersion(row)">删除</el-button>
            </div>
          </div>
        </template>
      </AdminTable>
      <el-pagination v-if="filteredImported.length > pageSize" class="mt-4 justify-center" layout="prev, pager, next"
        :total="filteredImported.length" :page-size="pageSize" v-model:current-page="importedPage" />
    </el-card>

    <!-- ===== 选歌弹窗（挂到歌 / 挪歌共用） ===== -->
    <el-dialog v-model="pickerVisible" :title="pickerMode === 'confirm' ? '挂到指定歌' : '挪到其他歌'" width="560px">
      <div class="space-y-3">
        <p v-if="pickerMode === 'confirm'" class="text-sm text-gray-500 break-all">
          「{{ pickerPending?.title }}」→ 将下载其 TTML 原文挂为所选歌的歌词版本（来源标记 TTML Hub）
        </p>
        <p v-else class="text-sm text-gray-500">
          将把该 TTML 版本从「{{ songTitle(moveTarget?.song_id) }}」挪到所选歌（行数据一并改挂，不影响其他版本）
        </p>
        <el-input v-model="pickerKw" placeholder="搜索歌曲名" clearable :prefix-icon="Search" />
        <div class="max-h-72 overflow-y-auto border rounded-lg divide-y">
          <button v-for="s in pickerCandidates" :key="s.id" type="button"
            class="w-full text-left px-3 py-2 hover:bg-pink-50 transition-colors flex items-center justify-between gap-2"
            @click="pickSong(s)">
            <span class="text-sm break-all">{{ s.title }}</span>
            <span v-if="s.origin === 'ttml-hub'" class="text-xs text-gray-400 flex-shrink-0">白板</span>
          </button>
          <div v-if="!pickerCandidates.length" class="px-3 py-6 text-center text-sm text-gray-400">无匹配歌曲</div>
        </div>
      </div>
      <template #footer>
        <el-button @click="pickerVisible = false">取消</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Search } from '@element-plus/icons-vue'
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'
import AdminTable from '@/components/admin/AdminTable.vue'
import { adminApi } from '@/lib/adminApi'
import { detectTtmlLangs } from '@/lib/lyricLines'
import { TTML_HUB_BASE } from '@/lib/constants'

/**
 * TTML Hub 同步管理：待匹配人工确认（档2/档3 队列）+ 已导入版本挪歌/删除。
 * 挂歌 = 下载 TTML 原文（sha256 校验）→ upsert lyric_versions（确定性 id = lv_+hubId，与同步 Worker 幂等兼容）
 * → 队列条目标记 resolution='merged'；挪歌 = 改 lyric_versions.song_id（TTML 版本无行表数据，单字段即完整迁移）。
 */

interface PendingRow {
  id: string; title: string; artists: string[]; album: string | null
  path: string; sha256: string | null; reason: string; candidates: any
  resolution: string | null
}
interface VersionRow {
  id: string; song_id: string; external_id: string | null; langs: string[]
}
interface SongRow { id: string; title: string; origin: string | null }

const pendings = ref<PendingRow[]>([])
const imported = ref<VersionRow[]>([])
const songs = ref<SongRow[]>([])
const loading = ref(false)

const page = ref(1)
const importedPage = ref(1)
const importedKw = ref('')
const pageSize = 10

const filteredImported = computed(() => {
  const kw = importedKw.value.trim().toLowerCase()
  if (!kw) return imported.value
  return imported.value.filter(v =>
    songTitle(v.song_id).toLowerCase().includes(kw) || (v.external_id || '').toLowerCase().includes(kw))
})
const pagedPendings = computed(() => pendings.value.slice((page.value - 1) * pageSize, page.value * pageSize))
const pagedImported = computed(() => filteredImported.value.slice((importedPage.value - 1) * pageSize, importedPage.value * pageSize))

const songMap = computed(() => new Map(songs.value.map(s => [s.id, s])))
function songTitle(id?: string): string {
  return (id && songMap.value.get(id)?.title) || id || ''
}

function reasonLabel(row: any): string {
  if (row.reason === 'multi_candidate') return '多候选'
  const m = row.candidates?.hit_method
  if (m === 'platform_id') return '平台ID命中'
  if (m === 'title_artists') return '标题歌手全等'
  return '无同名候选'
}

function candidateSongTitles(row: any): string {
  const c = row.candidates || {}
  const ids: string[] = c.hit_song_id ? [c.hit_song_id] : (c.candidate_song_ids || [])
  if (!ids.length) return ''
  return ids.map(id => songTitle(id)).join(' / ')
}

async function load() {
  loading.value = true
  try {
    const [p, v, s] = await Promise.all([
      adminApi.getAll<PendingRow>('ttml_hub_pending', { order: 'created_at', ascending: false }),
      adminApi.getAll<VersionRow>('lyric_versions', { select: 'id,song_id,external_id,langs', eq: { source: 'ttml-hub' }, order: 'created_at', ascending: false }),
      adminApi.getAll<SongRow>('songs', { select: 'id,title,origin' }),
    ])
    pendings.value = p.filter(r => !r.resolution)
    imported.value = v
    songs.value = s
  } catch (e: any) {
    ElMessage.error('加载失败：' + (e.message || e))
  } finally {
    loading.value = false
  }
}

// ---------- 忽略 ----------
async function ignorePending(row: any) {
  await ElMessageBox.confirm(`忽略「${row.title}」后不再出现在待确认队列（ttml-hub 更新时才会重新出现）。`, '忽略确认')
  await adminApi.update('ttml_hub_pending', row.id, { resolution: 'ignored' } as any)
  ElMessage.success('已忽略')
  await load()
}

// ---------- 选歌弹窗 ----------
const pickerVisible = ref(false)
const pickerMode = ref<'confirm' | 'move'>('confirm')
const pickerPending = ref<PendingRow | null>(null)
const moveTarget = ref<VersionRow | null>(null)
const pickerKw = ref('')
const saving = ref(false)

const pickerCandidates = computed<SongRow[]>(() => {
  const kw = pickerKw.value.trim().toLowerCase()
  let list = songs.value
  if (kw) list = list.filter(s => s.title.toLowerCase().includes(kw))
  return list.slice(0, 50)
})

function openPicker(row: any) {
  pickerMode.value = 'confirm'
  pickerPending.value = row
  moveTarget.value = null
  // 预填命中候选歌名，方便直接搜到
  pickerKw.value = row.candidates?.hit_song_id ? songTitle(row.candidates.hit_song_id) : ''
  pickerVisible.value = true
}

function openMoveDialog(row: any) {
  pickerMode.value = 'move'
  pickerPending.value = null
  moveTarget.value = row
  pickerKw.value = ''
  pickerVisible.value = true
}

async function pickSong(s: SongRow) {
  if (pickerMode.value === 'confirm' && pickerPending.value) {
    await confirmAttach(pickerPending.value, s)
  } else if (moveTarget.value) {
    if (moveTarget.value.song_id === s.id) {
      ElMessage.warning('已经在这首歌上了')
      return
    }
    saving.value = true
    try {
      await adminApi.update('lyric_versions', moveTarget.value.id, { song_id: s.id } as any)
      ElMessage.success('已挪到「' + s.title + '」')
      pickerVisible.value = false
      await load()
    } catch (e: any) {
      ElMessage.error('挪歌失败：' + (e.message || e))
    } finally {
      saving.value = false
    }
  }
}

// ---------- 挂歌（下载 TTML + sha256 + upsert 版本 + 标记已确认） ----------
async function confirmAttach(row: PendingRow, song: SongRow) {
  saving.value = true
  try {
    const res = await fetch(new URL(row.path, TTML_HUB_BASE).href)
    if (!res.ok) throw new Error(`TTML 下载失败（${res.status}）`)
    const buf = await res.arrayBuffer()
    const text = new TextDecoder().decode(buf)
    const digest = await crypto.subtle.digest('SHA-256', buf)
    const hash = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
    if (row.sha256 && hash !== row.sha256) throw new Error('sha256 校验不符，源文件可能已更新，请刷新队列后重试')

    await adminApi.upsert('lyric_versions', {
      id: 'lv_' + row.id, // 与同步 Worker 相同的确定性 id，幂等兼容
      song_id: song.id,
      format: 'ttml',
      source: 'ttml-hub',
      external_id: row.id,
      content_hash: hash,
      ttml_text: text,
      langs: detectTtmlLangs(text),
      status: 'published',
      is_primary: false,
      contributor_id: null,
      source_credit: null,
    } as any, 'id')
    await adminApi.update('ttml_hub_pending', row.id, { resolution: 'merged' } as any)
    ElMessage.success('已挂到「' + song.title + '」')
    pickerVisible.value = false
    await load()
  } catch (e: any) {
    ElMessage.error(e.message || String(e))
  } finally {
    saving.value = false
  }
}

// ---------- 删除已导入版本 ----------
async function removeVersion(row: any) {
  await ElMessageBox.confirm(
    `删除「${songTitle(row.song_id)}」的这条 TTML 版本？歌本体和其他版本不受影响；ttml-hub 下一轮同步会把它当作未导入重新进入队列。`,
    '删除确认', { type: 'warning' },
  )
  await adminApi.remove('lyric_versions', row.id)
  ElMessage.success('已删除')
  await load()
}

onMounted(load)
</script>
