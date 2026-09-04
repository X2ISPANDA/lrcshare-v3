<template>
  <div class="space-y-4">
    <!-- 工具条 -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-wrap items-center gap-3 px-5 py-3">
      <el-input v-model="keyword" placeholder="搜索名称 / 别名 / 区分信息" clearable class="w-full sm:!w-64" :prefix-icon="Search" />
      <el-select v-model="typeFilter" clearable placeholder="全部类型" class="!w-36">
        <el-option v-for="t in TYPE_OPTIONS" :key="t.value" :label="t.label" :value="t.value" />
        <el-option label="🏢 非创作者" value="__none__" />
      </el-select>
      <div class="flex-1"></div>
      <el-tooltip content="按全部歌曲/专辑关联重算每位艺术家的类型（singer/lyricist/composer/arranger），修正历史脏数据" placement="top">
        <el-button :loading="recomputing" @click="recomputeAllTypes">重算全部类型</el-button>
      </el-tooltip>
      <el-button type="primary" @click="openNew" style="--el-button-bg-color: #ec4899; --el-button-border-color: #ec4899; --el-button-hover-bg-color: #db2777; --el-button-hover-border-color: #db2777">+ 新增艺术家</el-button>
    </div>

    <div class="bg-white rounded-xl border border-gray-100 shadow-sm">
      <AdminTable :data="pagedList" :loading="loading" row-key="id" @selection-change="selected = $event">
        <el-table-column type="selection" width="45" />
        <el-table-column label="艺术家" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="flex items-center gap-2">
              <img v-if="row.avatar" :src="row.avatar" class="w-8 h-8 rounded-full object-cover flex-shrink-0" />
              <div v-else class="w-8 h-8 rounded-full bg-pink-100 text-pink-500 flex items-center justify-center flex-shrink-0 text-sm">{{ row.name?.charAt(0) }}</div>
              <div class="min-w-0">
                <div class="font-medium text-gray-800">{{ row.name }}</div>
                <div v-if="row.disambiguation" class="text-xs text-gray-400 truncate">{{ row.disambiguation }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="150">
          <template #default="{ row }">
            <el-tag v-for="t in row.types || []" :key="t" size="small" class="mr-1" :type="t === 'singer' ? 'danger' : 'info'">{{ typeLabel(t) }}</el-tag>
            <span v-if="!(row.types || []).length" class="text-gray-300 text-xs">非创作者</span>
          </template>
        </el-table-column>
        <el-table-column label="作品" width="70" align="center">
          <template #default="{ row }">{{ songCount(row.id) }}</template>
        </el-table-column>
        <el-table-column label="置顶" width="80" align="center">
          <template #default="{ row }">
            <span :class="row.sort > 0 ? 'text-pink-500 font-medium' : 'text-gray-300'">{{ row.sort || 0 }}</span>
          </template>
        </el-table-column>
        <el-table-column label="前台展示" width="95" align="center">
          <template #default="{ row }">
            <el-switch :model-value="row.is_show" @change="toggleShow(row)" />
          </template>
        </el-table-column>
        <el-table-column label="操作" width="130" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="removeOne(row)">删除</el-button>
          </template>
        </el-table-column>

        <!-- 移动端卡片 -->
        <template #card="{ row }">
          <div class="flex items-start gap-3">
            <img v-if="row.avatar" :src="row.avatar" class="w-10 h-10 rounded-full object-cover shrink-0" />
            <div v-else class="w-10 h-10 rounded-full bg-pink-100 text-pink-500 flex items-center justify-center shrink-0">{{ row.name?.charAt(0) }}</div>
            <div class="min-w-0 flex-1">
              <div class="font-medium text-gray-800 truncate">{{ row.name }}</div>
              <div v-if="row.disambiguation" class="text-xs text-gray-400 truncate">{{ row.disambiguation }}</div>
              <div class="text-xs text-gray-400 mt-0.5">{{ songCount(row.id) }} 首作品<template v-if="row.sort > 0"> · 置顶{{ row.sort }}</template></div>
              <div class="flex flex-wrap gap-1 mt-1">
                <el-tag v-for="t in row.types || []" :key="t" size="small" :type="t === 'singer' ? 'danger' : 'info'">{{ typeLabel(t) }}</el-tag>
                <span v-if="!(row.types || []).length" class="text-gray-300 text-xs self-center">非创作者</span>
              </div>
            </div>
          </div>
          <div class="mt-2 pt-2 border-t border-gray-50 flex items-center justify-between">
            <div class="flex gap-1">
              <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
              <el-button link type="danger" size="small" @click="removeOne(row)">删除</el-button>
            </div>
            <div class="flex items-center gap-2 text-xs text-gray-400">
              前台展示
              <el-switch :model-value="row.is_show" @change="toggleShow(row)" />
            </div>
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
          :total="filteredList.length"
          layout="total, sizes, prev, pager, next"
          :pager-count="5"
          background
        />
      </div>
    </div>

    <!-- 新增 / 编辑弹窗 -->
    <el-dialog v-model="showDialog" :title="editing ? '编辑艺术家' : '新增艺术家'" width="680px" :close-on-click-modal="false">
      <el-form :model="form" label-width="96px">
        <el-form-item label="艺术家名" required>
          <el-input v-model="form.name" placeholder="名称" />
        </el-form-item>
        <el-form-item label="区分信息">
          <el-input v-model="form.disambiguation" placeholder="用于区分同名艺术家，如：北京民谣歌手" />
        </el-form-item>
        <el-form-item label="头像 URL">
          <el-input v-model="form.avatar" placeholder="留空使用默认头像" />
        </el-form-item>
        <el-form-item label="背景图 URL">
          <el-input v-model="form.bg_image" placeholder="留空使用主页默认背景图" />
        </el-form-item>
        <el-form-item label="背景图位置">
          <div class="flex items-center gap-4 w-full">
            <el-slider v-model="form.bg_position_y" :min="0" :max="100" :step="1" show-input class="flex-1" />
            <span class="text-xs text-gray-400 whitespace-nowrap">0%=顶部 50%=居中 100%=底部</span>
          </div>
        </el-form-item>
        <el-form-item label="简介">
          <el-input v-model="form.bio" type="textarea" :rows="3" />
        </el-form-item>
        <el-form-item label="别名">
          <el-select v-model="form.aliases" multiple filterable allow-create default-first-option placeholder="输入别名后回车添加" class="w-full" />
        </el-form-item>
        <el-form-item label="社交链接">
          <div class="w-full space-y-2">
            <div v-for="(row, idx) in form.urlRows" :key="idx" class="flex items-center gap-2">
              <el-select v-model="row.k" filterable allow-create default-first-option size="small" class="!w-36 flex-shrink-0" placeholder="平台">
              <el-option v-for="p in ARTIST_URL_PLATFORMS" :key="p" :label="contactLabel(p)" :value="p" />
            </el-select>
            <el-input v-model="row.v" placeholder="https://..." size="small" />
            <el-button size="small" type="danger" text @click="form.urlRows.splice(idx, 1)">删</el-button>
          </div>
          <el-button size="small" @click="form.urlRows.push({ k: 'netease', v: '' })">+ 添加链接</el-button>
          </div>
        </el-form-item>
        <el-form-item label="首字母">
          <div class="w-full">
            <el-input v-model="form.initial" placeholder="留空自动按拼音" maxlength="1" class="!w-40" style="text-transform: uppercase" />
            <div class="text-xs text-gray-400 mt-1">多音字分错组时手动指定，如「盛宇」填 C（读 chéng）</div>
          </div>
        </el-form-item>
        <el-form-item label="置顶排序">
          <div class="w-full">
            <el-input-number v-model="form.sort" :min="0" :step="1" class="!w-full" />
            <div class="text-xs text-gray-400 mt-1">0=按作品数自动排序，1最置顶，2次之...</div>
          </div>
        </el-form-item>
        <el-form-item label="前台展示">
          <div class="flex items-center gap-3">
            <el-switch v-model="form.is_show" />
            <span class="text-xs text-gray-400">关闭后不出现在前台艺术家列表（适用于唱片公司、平台等非创作者）</span>
          </div>
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
import { recomputeArtistTypes } from '@/lib/artistTypes'
import AdminTable from '@/components/admin/AdminTable.vue'
import { contactLabel, ARTIST_URL_PLATFORMS } from '@/lib/constants'
import type { Artist } from '@/lib/types'

/** 艺术家管理：列表（类型筛选、行内 is_show 切换）+ 新增/编辑（社交链接、置顶、消歧义） */

const TYPE_OPTIONS = [
  { label: '🎤 歌手', value: 'singer' },
  { label: '📝 作词人', value: 'lyricist' },
  { label: '🎼 作曲人', value: 'composer' },
  { label: '🎹 编曲人', value: 'arranger' },
]

const artists = ref<Artist[]>([])
const songArtists = ref<string[]>([])
const loading = ref(false)
const keyword = ref('')
const typeFilter = ref('')
const page = ref(1)
const pageSize = ref(20)
const selected = ref<Artist[]>([])
const tableRef = ref()

/** 歌曲关联的艺术家 ID（含 singer/lyricist/composer/arranger），用于作品计数——直接读中间表 */
async function loadSongRefs() {
  const sc = await adminApi.getAll<any>('song_contributors')
  // 一首歌对一个艺术家只算 1 个作品：按 (song_id, artist_id) 去重
  const seen = new Set<string>()
  const ids: string[] = []
  for (const r of sc) {
    const key = `${r.song_id}:${r.artist_id}`
    if (seen.has(key)) continue
    seen.add(key)
    ids.push(r.artist_id)
  }
  songArtists.value = ids
}
const countMap = computed(() => {
  const m = new Map<string, number>()
  for (const id of songArtists.value) m.set(id, (m.get(id) || 0) + 1)
  return m
})
const songCount = (id: string) => countMap.value.get(id) || 0

const filteredList = computed(() => {
  let list = artists.value
  const kw = keyword.value.trim().toLowerCase()
  if (kw) {
    list = list.filter(a =>
      a.name?.toLowerCase().includes(kw) ||
      a.disambiguation?.toLowerCase().includes(kw) ||
      (a.aliases || []).some(al => al.toLowerCase().includes(kw)))
  }
  if (typeFilter.value) {
    if (typeFilter.value === '__none__') list = list.filter(a => !(a.types || []).length)
    else list = list.filter(a => (a.types || []).includes(typeFilter.value))
  }
  return list
})
const pagedList = computed(() => filteredList.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

function typeLabel(t: string) {
  return TYPE_OPTIONS.find(o => o.value === t)?.label.replace(/^\S+\s/, '') || t
}

async function load() {
  loading.value = true
  try {
    const [a] = await Promise.all([
      adminApi.getAll<Artist>('artists', { order: 'name' }),
      loadSongRefs(),
    ])
    artists.value = a
    // 置顶优先，其余按名称
    artists.value.sort((x, y) => (y.sort || 0) - (x.sort || 0) || x.name.localeCompare(y.name, 'zh'))
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

// ============ 行内切换前台展示 ============
async function toggleShow(row: Artist) {
  try {
    const val = !row.is_show
    await adminApi.update('artists', row.id, { is_show: val })
    row.is_show = val
    ElMessage.success(val ? '已开启前台展示' : '已隐藏（前台不再展示）')
  } catch (e: any) {
    ElMessage.error('操作失败：' + e.message)
  }
}

// ============ 编辑弹窗 ============
const showDialog = ref(false)
const editing = ref<Artist | null>(null)
const saving = ref(false)

const form = reactive({
  name: '',
  disambiguation: '',
  avatar: '',
  bg_image: '',
  bg_position_y: 50,
  bio: '',
  aliases: [] as string[],
  urls: {} as Record<string, string>,
  urlRows: [] as { k: string; v: string }[],
  sort: 0,
  initial: '',
  is_show: true,
})

function openNew() {
  editing.value = null
  Object.assign(form, {
    name: '', disambiguation: '', avatar: '', bg_image: '', bg_position_y: 50,
    bio: '', aliases: [], urls: {}, urlRows: [],
    sort: 0, initial: '', is_show: true,
  })
  showDialog.value = true
}

function openEdit(row: Artist) {
  editing.value = row
  const urls = row.urls || {}
  Object.assign(form, {
    name: row.name || '',
    disambiguation: row.disambiguation || '',
    avatar: row.avatar || '',
    bg_image: row.bg_image || '',
    bg_position_y: Number.isInteger(row.bg_position_y) ? row.bg_position_y : 50,
    bio: row.bio || '',
    aliases: [...(row.aliases || [])],
    urls,
    // 展开为动态行：保留库里全部键（迁移后为英文键，如 official/netease/x）
    urlRows: Object.entries(urls).map(([k, v]) => ({ k, v: v || '' })),
    sort: row.sort || 0,
    initial: row.initial || '',
    is_show: row.is_show !== false,
  })
  showDialog.value = true
}

async function save() {
  if (!form.name.trim()) {
    ElMessage.warning('请输入艺术家名')
    return
  }
  // 同名艺术家且无区分信息时提醒（大小写不敏感，不阻断）
  const name = form.name.trim().toLowerCase()
  const dup = artists.value.find(a => a.name.toLowerCase() === name && a.id !== editing.value?.id && !a.disambiguation && !form.disambiguation.trim())
  if (dup) {
    try {
      await ElMessageBox.confirm('已存在同名艺术家「' + form.name.trim() + '」，且双方均无区分信息，容易混淆。建议填写区分信息。是否继续保存？', '同名提醒', { type: 'warning', confirmButtonText: '仍然保存', cancelButtonText: '返回填写' })
    } catch { return }
  }
  saving.value = true
  try {
    const payload = {
      name: form.name.trim(),
      disambiguation: form.disambiguation.trim(),
      // types 不人工维护：新增为空，编辑保持库内值，由歌曲/专辑关联派生（发布补全、删除重算）
      types: editing.value ? (editing.value.types || []) : [],
      avatar: form.avatar.trim() || null,
      bg_image: form.bg_image.trim() || '',
      bg_position_y: form.bg_position_y,
      bio: form.bio || '',
      aliases: form.aliases,
      sort: form.sort || 0,
      initial: form.initial.trim().toUpperCase() || null,
      is_show: form.is_show !== false,
      // urls 从动态行组装（英文键体系，见 constants.ts PLATFORM_LABELS）
      urls: Object.fromEntries(form.urlRows.filter(r => r.k && r.v.trim()).map(r => [r.k, r.v.trim()])),
    }
    if (editing.value) {
      await adminApi.update('artists', editing.value.id, payload)
      ElMessage.success('保存成功')
    } else {
      await adminApi.insert('artists', { id: crypto.randomUUID(), ...payload })
      ElMessage.success('新增艺术家成功')
    }
    showDialog.value = false
    await load()
  } catch (e: any) {
    ElMessage.error('保存失败：' + (e?.message || e))
  } finally {
    saving.value = false
  }
}

/** 全量重算类型：按全部歌曲/专辑关联修正每位艺术家的 types（历史脏数据一键修复） */
const recomputing = ref(false)
async function recomputeAllTypes() {
  try {
    await ElMessageBox.confirm('将按全部歌曲/专辑关联重算所有艺术家的类型（覆盖现有值，人工曾标注的类型如有作品支撑会保留）。是否继续？', '重算全部类型', { type: 'warning' })
  } catch { return }
  recomputing.value = true
  try {
    await recomputeArtistTypes(artists.value.map(a => a.id))
    ElMessage.success('已按歌曲/专辑关联重算全部艺术家类型')
    await load()
  } catch (e: any) {
    ElMessage.error('重算失败：' + (e?.message || e))
  } finally {
    recomputing.value = false
  }
}

async function removeOne(row: Artist) {
  try {
    await ElMessageBox.confirm(`确定删除艺术家「${row.name}」？关联的专辑和歌曲不会被删除，但作品中的该艺术家将显示为「未知」。`, '危险操作', { type: 'warning' })
    await adminApi.remove('artists', row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error('删除失败：' + e.message)
  }
}

async function batchRemove() {
  if (!selected.value.length) return
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selected.value.length} 位艺术家？关联作品不会被删除，但其中的这些艺术家将显示为「未知」。`, '批量删除', { type: 'warning' })
    await adminApi.removeBatch('artists', selected.value.map(a => a.id))
    ElMessage.success('批量删除完成')
    clearSelection()
    await load()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error('删除失败：' + e.message)
  }
}

watch([keyword, typeFilter], () => (page.value = 1))
watch(pageSize, () => (page.value = 1))
</script>
