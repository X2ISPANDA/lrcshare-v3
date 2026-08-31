<template>
  <div class="space-y-4">
    <!-- 分类管理 -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4">
      <div class="flex items-center justify-between mb-3">
        <span class="font-medium text-gray-700 text-sm">友链分类</span>
        <el-button size="small" plain @click="openNewCategory">+ 新增分类</el-button>
      </div>
      <div class="flex flex-wrap gap-2">
        <div
          v-for="cat in categories"
          :key="cat.id"
          class="group flex items-center gap-2 px-3 py-1.5 rounded-full border text-sm cursor-pointer transition-colors"
          :style="{ borderColor: cat.color || '#e5e7eb', color: cat.color || '#4b5563' }"
          :class="{ 'bg-gray-50': catFilter !== cat.id, 'bg-gray-100 font-medium': catFilter === cat.id }"
          @click="catFilter = catFilter === cat.id ? '' : cat.id"
        >
          <span>{{ cat.icon || '📁' }}</span>
          <span>{{ cat.name }}</span>
          <span class="text-xs opacity-60">{{ friendCount(cat.id) }}</span>
          <span class="hidden group-hover:inline-flex gap-1 ml-1" @click.stop>
            <button class="opacity-50 hover:opacity-100" title="编辑" @click="openEditCategory(cat)">✏️</button>
            <button class="opacity-50 hover:opacity-100" title="删除" @click="removeCategory(cat)">🗑️</button>
          </span>
        </div>
      </div>
    </div>

    <!-- 工具条 -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-wrap items-center gap-3 px-5 py-3">
      <el-input v-model="keyword" placeholder="搜索名称 / 描述" clearable class="w-full sm:!w-64" :prefix-icon="Search" />
      <div class="flex-1"></div>
      <el-button type="primary" @click="openNew" style="--el-button-bg-color: #ec4899; --el-button-border-color: #ec4899; --el-button-hover-bg-color: #db2777; --el-button-hover-border-color: #db2777">+ 新增友链</el-button>
    </div>

    <div class="bg-white rounded-xl border border-gray-100 shadow-sm">
      <AdminTable :data="pagedList" :loading="loading" row-key="id" @selection-change="selected = $event">
        <el-table-column type="selection" width="45" />
        <el-table-column label="站点" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="flex items-center gap-2">
              <img v-if="row.avatar" :src="row.avatar" class="w-8 h-8 rounded-full object-cover flex-shrink-0" />
              <div v-else class="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 text-gray-300 text-sm">{{ row.name?.charAt(0) }}</div>
              <div class="min-w-0">
                <a :href="row.url" target="_blank" rel="noopener" class="font-medium text-gray-800 hover:text-pink-500">{{ row.name }}</a>
                <div class="text-xs text-gray-400 truncate">{{ row.url }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="描述" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.descr || '—' }}</template>
        </el-table-column>
        <el-table-column label="分类" width="130" align="center">
          <template #default="{ row }">
            <el-tag v-if="catMap.get(row.category_id)" size="small" :color="catMap.get(row.category_id)!.color || undefined" :style="catMap.get(row.category_id)!.color ? 'color:#fff;border:none' : ''">
              {{ catMap.get(row.category_id)!.icon }} {{ catMap.get(row.category_id)!.name }}
            </el-tag>
            <span v-else class="text-gray-300 text-xs">未分类</span>
          </template>
        </el-table-column>
        <el-table-column label="排序" width="65" align="center">
          <template #default="{ row }">{{ row.sort ?? 0 }}</template>
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
            <div v-else class="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center shrink-0 text-gray-300">{{ row.name?.charAt(0) }}</div>
            <div class="min-w-0 flex-1">
              <a :href="row.url" target="_blank" rel="noopener" class="font-medium text-gray-800 hover:text-pink-500 truncate block">{{ row.name }}</a>
              <div class="text-xs text-gray-400 truncate mt-0.5">{{ row.url }}</div>
              <div v-if="row.descr" class="text-xs text-gray-400 truncate mt-0.5">{{ row.descr }}</div>
              <div class="mt-1">
                <el-tag v-if="catMap.get(row.category_id)" size="small" :color="catMap.get(row.category_id)!.color || undefined" :style="catMap.get(row.category_id)!.color ? 'color:#fff;border:none' : ''">
                  {{ catMap.get(row.category_id)!.icon }} {{ catMap.get(row.category_id)!.name }}
                </el-tag>
                <span v-else class="text-gray-300 text-xs">未分类</span>
              </div>
            </div>
          </div>
          <div class="mt-2 pt-2 border-t border-gray-50 flex gap-1">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
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
          :total="filteredList.length"
          layout="total, sizes, prev, pager, next"
          :pager-count="5"
          background
        />
      </div>
    </div>

    <!-- 友链弹窗 -->
    <el-dialog v-model="showDialog" :title="editing ? '编辑友链' : '新增友链'" width="500px" :close-on-click-modal="false">
      <el-form :model="form" label-width="84px">
        <el-form-item label="名称" required><el-input v-model="form.name" placeholder="站点名称" /></el-form-item>
        <el-form-item label="链接" required><el-input v-model="form.url" placeholder="https://..." /></el-form-item>
        <el-form-item label="头像 URL"><el-input v-model="form.avatar" placeholder="留空显示首字符" /></el-form-item>
        <el-form-item label="描述"><el-input v-model="form.descr" type="textarea" :rows="2" placeholder="站点描述" /></el-form-item>
        <el-form-item label="附加链接">
          <div class="w-full space-y-2">
            <div v-for="(row, idx) in form.extraLinks" :key="idx" class="flex items-center gap-2">
              <el-select v-model="row.label" filterable size="small" class="!w-36 flex-shrink-0" placeholder="类型">
                <el-option v-for="t in FRIEND_LINK_TYPES" :key="t" :label="contactLabel(t)" :value="t" />
              </el-select>
              <el-input v-model="row.url" placeholder="https://..." size="small" />
              <el-button size="small" type="danger" text @click="form.extraLinks.splice(idx, 1)">删</el-button>
            </div>
            <el-button size="small" @click="form.extraLinks.push({ label: 'github', url: '' })">+ 添加链接</el-button>
          </div>
        </el-form-item>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="分类">
              <el-select v-model="form.category_id" clearable placeholder="选择分类" class="w-full">
                <el-option v-for="c in categories" :key="c.id" :label="(c.icon || '') + ' ' + c.name" :value="c.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="排序">
              <el-input-number v-model="form.sort" :min="0" :step="1" class="!w-full" />
            </el-form-item>
          </el-col>
        </el-row>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>

    <!-- 分类弹窗 -->
    <el-dialog v-model="showCatDialog" :title="editingCat ? '编辑分类' : '新增分类'" width="420px" :close-on-click-modal="false">
      <el-form :model="catForm" label-width="84px">
        <el-form-item label="名称" required><el-input v-model="catForm.name" placeholder="分类名称" /></el-form-item>
        <el-form-item label="图标">
          <div class="flex items-center gap-3">
            <el-input v-model="catForm.icon" placeholder="📁" class="!w-20 text-center" />
            <span class="text-xs text-gray-400">emoji 图标</span>
          </div>
        </el-form-item>
        <el-form-item label="颜色">
          <div class="flex items-center gap-3">
            <el-color-picker v-model="catForm.color" />
            <span class="text-xs text-gray-400">标签展示颜色</span>
          </div>
        </el-form-item>
        <el-form-item label="排序">
          <el-input-number v-model="catForm.sort" :min="0" :step="1" class="!w-full" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCatDialog = false">取消</el-button>
        <el-button type="primary" :loading="catSaving" @click="saveCategory">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { adminApi } from '@/lib/adminApi'
import { contactLabel } from '@/lib/constants'
import AdminTable from '@/components/admin/AdminTable.vue'
import type { Friend, FriendCategory } from '@/lib/types'

/** 友链管理：分类（emoji+颜色，可点筛选）+ 友链 CRUD */

/** 附加链接类型预设（与 AppIcon ICON_MAP 键名对齐，取适合做站点链接的平台） */
const FRIEND_LINK_TYPES = ['github', 'bilibili', 'blog', 'twitter', 'weibo', 'homepage', 'instagram', 'spotify', 'netease', 'youtube', 'douyin', 'xiaohongshu']

const friends = ref<Friend[]>([])
const categories = ref<FriendCategory[]>([])
const loading = ref(false)
const keyword = ref('')
const catFilter = ref('')
const page = ref(1)
const pageSize = ref(20)
const selected = ref<Friend[]>([])
const tableRef = ref()

const catMap = computed(() => new Map(categories.value.map(c => [c.id, c])))
const friendCount = (catId: string) => friends.value.filter(f => f.category_id === catId).length

const filteredList = computed(() => {
  let list = friends.value
  const kw = keyword.value.trim().toLowerCase()
  if (kw) list = list.filter(f => f.name?.toLowerCase().includes(kw) || f.descr?.toLowerCase().includes(kw) || f.url?.toLowerCase().includes(kw))
  if (catFilter.value) {
    list = catFilter.value === '__none__'
      ? list.filter(f => !f.category_id || !catMap.value.has(f.category_id))
      : list.filter(f => f.category_id === catFilter.value)
  }
  return list
})
const pagedList = computed(() => filteredList.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

async function load() {
  loading.value = true
  try {
    const [f, c] = await Promise.all([
      adminApi.getAll<Friend>('friends', { order: 'sort' }),
      adminApi.getAll<FriendCategory>('friend_categories', { order: 'sort' }),
    ])
    friends.value = f
    categories.value = c
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

// ============ 友链弹窗 ============
const showDialog = ref(false)
const editing = ref<Friend | null>(null)
const saving = ref(false)

const form = reactive({
  name: '',
  url: '',
  avatar: '',
  descr: '',
  category_id: null as string | null,
  sort: 0,
  extraLinks: [] as { label: string; url: string }[],
})

function openNew() {
  editing.value = null
  Object.assign(form, { name: '', url: '', avatar: '', descr: '', category_id: catFilter.value && catFilter.value !== '__none__' ? catFilter.value : null, sort: friends.value.length, extraLinks: [] })
  showDialog.value = true
}

function openEdit(row: Friend) {
  editing.value = row
  Object.assign(form, {
    name: row.name || '',
    url: row.url || '',
    avatar: row.avatar || '',
    descr: row.descr || '',
    category_id: row.category_id || null,
    sort: row.sort ?? 0,
    extraLinks: (row.extra_links || []).map(l => ({ label: l.label, url: l.url })),
  })
  showDialog.value = true
}

async function save() {
  if (!form.name.trim() || !form.url.trim()) {
    ElMessage.warning('请填写名称和链接')
    return
  }
  saving.value = true
  try {
    const payload = {
      name: form.name.trim(),
      url: form.url.trim(),
      avatar: form.avatar.trim() || null,
      descr: form.descr.trim() || null,
      category_id: form.category_id,
      sort: form.sort || 0,
      // 过滤空 url 行，空则存 null（与 descr 等可空字段一致）
      extra_links: form.extraLinks.filter(l => l.url.trim()).length
        ? form.extraLinks
            .filter(l => l.url.trim())
            .map(l => ({ label: l.label, url: l.url.trim() }))
        : null,
    }
    if (editing.value) {
      await adminApi.update('friends', editing.value.id, payload)
      ElMessage.success('保存成功')
    } else {
      await adminApi.insert('friends', { id: 'fl_' + Date.now(), ...payload })
      ElMessage.success('新增友链成功')
    }
    showDialog.value = false
    await load()
  } catch (e: any) {
    ElMessage.error('保存失败：' + (e?.message || e))
  } finally {
    saving.value = false
  }
}

async function removeOne(row: Friend) {
  try {
    await ElMessageBox.confirm(`确定删除友链「${row.name}」？`, '确认删除', { type: 'warning' })
    await adminApi.remove('friends', row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error('删除失败：' + e.message)
  }
}

async function batchRemove() {
  if (!selected.value.length) return
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selected.value.length} 个友链？`, '批量删除', { type: 'warning' })
    await adminApi.removeBatch('friends', selected.value.map(f => f.id))
    ElMessage.success('批量删除完成')
    clearSelection()
    await load()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error('删除失败：' + e.message)
  }
}

// ============ 分类弹窗 ============
const showCatDialog = ref(false)
const editingCat = ref<FriendCategory | null>(null)
const catSaving = ref(false)

const catForm = reactive({
  name: '',
  icon: '📁',
  color: '#6b7280',
  sort: 0,
})

function openNewCategory() {
  editingCat.value = null
  Object.assign(catForm, { name: '', icon: '📁', color: '#6b7280', sort: categories.value.length })
  showCatDialog.value = true
}

function openEditCategory(cat: FriendCategory) {
  editingCat.value = cat
  Object.assign(catForm, { name: cat.name || '', icon: cat.icon || '📁', color: cat.color || '#6b7280', sort: cat.sort ?? 0 })
  showCatDialog.value = true
}

async function saveCategory() {
  if (!catForm.name.trim()) {
    ElMessage.warning('请输入分类名称')
    return
  }
  catSaving.value = true
  try {
    const payload = { name: catForm.name.trim(), icon: catForm.icon || '📁', color: catForm.color || '#6b7280', sort: catForm.sort || 0 }
    if (editingCat.value) {
      await adminApi.update('friend_categories', editingCat.value.id, payload)
      ElMessage.success('保存成功')
    } else {
      await adminApi.insert('friend_categories', { id: 'cat_' + Date.now(), ...payload })
      ElMessage.success('新增分类成功')
    }
    showCatDialog.value = false
    await load()
  } catch (e: any) {
    ElMessage.error('保存失败：' + (e?.message || e))
  } finally {
    catSaving.value = false
  }
}

async function removeCategory(cat: FriendCategory) {
  try {
    await ElMessageBox.confirm(`确定删除分类「${cat.name}」？该分类下的友链将变为未分类。`, '确认删除', { type: 'warning' })
    await adminApi.remove('friend_categories', cat.id)
    if (catFilter.value === cat.id) catFilter.value = ''
    ElMessage.success('已删除')
    await load()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error('删除失败：' + e.message)
  }
}

watch([keyword, catFilter], () => (page.value = 1))
watch(pageSize, () => (page.value = 1))
</script>
