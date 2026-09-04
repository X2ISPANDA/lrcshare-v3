<template>
  <div class="space-y-4">
    <!-- 工具条 -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-wrap items-center gap-3 px-5 py-3">
      <el-input v-model="keyword" placeholder="搜索名称 / 标签" clearable class="w-full sm:!w-64" :prefix-icon="Search" />
      <div class="flex-1"></div>
      <el-button type="primary" @click="openNew" style="--el-button-bg-color: #ec4899; --el-button-border-color: #ec4899; --el-button-hover-bg-color: #db2777; --el-button-hover-border-color: #db2777">+ 新增贡献者</el-button>
    </div>

    <div class="bg-white rounded-xl border border-gray-100 shadow-sm">
      <AdminTable :data="pagedList" :loading="loading" row-key="id" @selection-change="selected = $event">
        <el-table-column type="selection" width="45" />
        <el-table-column label="贡献者" min-width="150" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="flex items-center gap-2">
              <img v-if="row.avatar" :src="row.avatar" class="w-8 h-8 rounded-full object-cover flex-shrink-0" />
              <div v-else class="w-8 h-8 rounded-full bg-pink-100 text-pink-500 flex items-center justify-center flex-shrink-0 text-sm">{{ row.name?.charAt(0) }}</div>
              <div class="min-w-0">
                <div class="font-medium text-gray-800">
                  {{ row.name }}
                  <el-tag v-if="row.is_owner" size="small" type="danger" class="ml-1">站长</el-tag>
                </div>
                <div v-if="row.tags?.length" class="text-xs text-gray-400 truncate">{{ row.tags.join(' / ') }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="作品数" width="75" align="center">
          <template #default="{ row }">{{ songCount(row.id) }}</template>
        </el-table-column>
        <el-table-column label="联系方式" min-width="200" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="contactKeys(row).length">
              <template v-if="row.public_contact">{{ contactKeys(row).map(contactLabel).join('、') }}</template>
              <template v-else>🔒 {{ contactKeys(row).map(contactLabel).join('、') }}</template>
            </span>
            <span v-else class="text-gray-300">—</span>
          </template>
        </el-table-column>
        <el-table-column label="置顶" width="65" align="center">
          <template #default="{ row }">
            <span :class="row.sort > 0 ? 'text-pink-500 font-medium' : 'text-gray-300'">{{ row.sort || 0 }}</span>
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
              <div class="font-medium text-gray-800 flex items-center gap-1">
                <span class="truncate">{{ row.name }}</span>
                <el-tag v-if="row.is_owner" size="small" type="danger" class="shrink-0">站长</el-tag>
              </div>
              <div v-if="row.tags?.length" class="text-xs text-gray-400 truncate mt-0.5">{{ row.tags.join(' / ') }}</div>
              <div class="text-xs text-gray-400 mt-0.5">{{ songCount(row.id) }} 首作品<template v-if="contactKeys(row).length"> · {{ row.public_contact ? contactKeys(row).map(contactLabel).join('、') : '🔒 ' + contactKeys(row).map(contactLabel).join('、') }}</template></div>
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

    <!-- 新增 / 编辑弹窗 -->
    <el-dialog v-model="showDialog" :title="editing ? '编辑贡献者' : '新增贡献者'" width="680px" :close-on-click-modal="false">
      <el-form :model="form" label-width="96px">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="贡献者名称" />
        </el-form-item>
        <el-form-item label="头像 URL">
          <el-input v-model="form.avatar" placeholder="留空使用默认头像" />
        </el-form-item>
        <el-form-item label="身份标签">
          <el-select v-model="form.tags" multiple filterable allow-create default-first-option placeholder="选择预置标签，或直接输入回车添加" class="w-full">
            <el-option v-for="t in PRESET_TAGS" :key="t" :label="t" :value="t" />
          </el-select>
        </el-form-item>
        <el-form-item label="站长">
          <div class="flex items-center gap-3">
            <el-switch v-model="form.is_owner" active-text="是" inactive-text="否" />
            <span class="text-xs text-gray-400">开启后显示站长标识</span>
          </div>
        </el-form-item>
        <el-form-item label="联系方式">
          <div class="w-full space-y-2">
            <div v-for="(row, idx) in form.contactRows" :key="idx" class="flex items-center gap-2">
              <el-select v-model="row.k" filterable allow-create default-first-option size="small" class="!w-36 flex-shrink-0" placeholder="类型">
                <el-option v-for="ct in CONTACT_TYPES" :key="ct" :label="contactLabel(ct)" :value="ct" />
              </el-select>
              <el-input v-model="row.v" placeholder="号码 / 链接" size="small" />
              <el-button size="small" type="danger" text @click="form.contactRows.splice(idx, 1)">删</el-button>
            </div>
            <el-button size="small" @click="form.contactRows.push({ k: 'qq', v: '' })">+ 添加联系方式</el-button>
          </div>
        </el-form-item>
        <el-form-item label="联系方式公开">
          <div class="flex items-center gap-3">
            <el-switch v-model="form.public_contact" active-text="公开" inactive-text="隐藏" />
            <span class="text-xs text-gray-400">开启后联系方式在贡献者主页展示</span>
          </div>
        </el-form-item>
        <el-form-item label="简介">
          <el-input v-model="form.bio" type="textarea" :rows="3" placeholder="贡献说明" />
        </el-form-item>
        <el-form-item label="简介公开">
          <div class="flex items-center gap-3">
            <el-switch v-model="form.public_bio" active-text="公开" inactive-text="隐藏" />
            <span class="text-xs text-gray-400">关闭后前台不展示简介</span>
          </div>
        </el-form-item>
        <el-form-item label="排序">
          <div class="w-full">
            <el-input-number v-model="form.sort" :min="0" :step="1" class="!w-full" />
            <div class="text-xs text-gray-400 mt-1">0=默认排序，1最置顶，2次之...</div>
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
import AdminTable from '@/components/admin/AdminTable.vue'
import { contactLabel } from '@/lib/constants'
import type { Contributor } from '@/lib/types'

/** 贡献者管理：站长标识、动态联系方式、公开开关 */

const CONTACT_TYPES = ['qq', 'wechat', 'email', 'bilibili', 'github', 'blog', 'douyin', 'weibo', 'twitter', 'xiaohongshu', 'netease', 'homepage', 'phone', 'mobile']

const contributors = ref<Contributor[]>([])
const songContributors = ref<string[]>([])
const loading = ref(false)
const keyword = ref('')
const page = ref(1)
const pageSize = ref(20)
const selected = ref<Contributor[]>([])
const tableRef = ref()

const countMap = computed(() => {
  const m = new Map<string, number>()
  for (const id of songContributors.value) m.set(id, (m.get(id) || 0) + 1)
  return m
})
const songCount = (id: string) => countMap.value.get(id) || 0

/** 联系方式键列表（contact_value 的非空键，键即类型，列表与弹窗展示用） */
const contactKeys = (row: Contributor) => Object.entries(row.contact_value || {}).filter(([, v]) => !!v).map(([k]) => k)

const filteredList = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return contributors.value
  return contributors.value.filter(c => c.name?.toLowerCase().includes(kw) || (c.tags || []).some(t => t.toLowerCase().includes(kw)))
})
const pagedList = computed(() => filteredList.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

async function load() {
  loading.value = true
  try {
    const [c, songs] = await Promise.all([
      adminApi.getAll<Contributor>('contributors', { order: 'sort' }),
      adminApi.getAll<any>('songs', { select: 'contributor_id' }),
    ])
    contributors.value = c
    songContributors.value = songs.map(s => s.contributor_id).filter(Boolean)
    contributors.value.sort((x, y) => (y.sort || 0) - (x.sort || 0))
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
const PRESET_TAGS = ['歌词提交', 'Logo设计', '网站搭建', '资料核对']
const showDialog = ref(false)
const editing = ref<Contributor | null>(null)
const saving = ref(false)

const form = reactive({
  name: '',
  avatar: '',
  tags: [] as string[],
  is_owner: false,
  contactRows: [] as { k: string; v: string }[],
  public_contact: false,
  bio: '',
  public_bio: true,
  sort: 0,
})

function openNew() {
  editing.value = null
  Object.assign(form, {
    name: '', avatar: '', tags: [], is_owner: false, contactRows: [],
    public_contact: false, bio: '', public_bio: true, sort: 0,
  })
  showDialog.value = true
}

function openEdit(row: Contributor) {
  editing.value = row
  Object.assign(form, {
    name: row.name || '',
    avatar: row.avatar || '',
    tags: [...(row.tags || [])],
    is_owner: !!row.is_owner,
    // 联系方式从 contact_value 展开为动态行（键即类型，见 constants.ts CONTACT_LABELS）
    contactRows: Object.entries(row.contact_value || {}).map(([k, v]) => ({ k, v: v || '' })),
    public_contact: !!row.public_contact,
    bio: row.bio || '',
    public_bio: row.public_bio !== false,
    sort: row.sort || 0,
  })
  showDialog.value = true
}

async function save() {
  if (!form.name.trim()) {
    ElMessage.warning('请输入贡献者名称')
    return
  }
  if (form.is_owner && contributors.value.some(c => c.is_owner && c.id !== editing.value?.id)) {
    try {
      await ElMessageBox.confirm('已存在其他站长账号，是否仍要将此贡献者设为站长？（将出现多个站长标识）', '站长提醒', { type: 'warning', confirmButtonText: '仍然设置', cancelButtonText: '返回' })
    } catch { return }
  }
  saving.value = true
  try {
    const payload: Record<string, unknown> = {
      name: form.name.trim(),
      avatar: form.avatar.trim() || null,
      tags: form.tags,
      is_owner: !!form.is_owner,
      // contact_value 从动态行组装（键即类型，空值行丢弃）
      contact_value: Object.fromEntries(form.contactRows.filter(r => r.k && r.v.trim()).map(r => [r.k, r.v.trim()])),
      public_contact: !!form.public_contact,
      bio: form.bio || null,
      public_bio: form.public_bio !== false,
      sort: form.sort || 0,
    }
    if (editing.value) {
      await adminApi.update('contributors', editing.value.id, payload)
      ElMessage.success('保存成功')
    } else {
      payload.id = crypto.randomUUID()
      payload.created_at = new Date().toISOString()
      await adminApi.insert('contributors', payload)
      ElMessage.success('新增贡献者成功')
    }
    showDialog.value = false
    await load()
  } catch (e: any) {
    ElMessage.error('保存失败：' + (e?.message || e))
  } finally {
    saving.value = false
  }
}

async function removeOne(row: Contributor) {
  try {
    await ElMessageBox.confirm(`确定删除贡献者「${row.name}」？其投稿歌曲的 contributor 关联将显示为空。`, '危险操作', { type: 'warning' })
    await adminApi.remove('contributors', row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error('删除失败：' + e.message)
  }
}

async function batchRemove() {
  if (!selected.value.length) return
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selected.value.length} 位贡献者？`, '批量删除', { type: 'warning' })
    await adminApi.removeBatch('contributors', selected.value.map(c => c.id))
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
