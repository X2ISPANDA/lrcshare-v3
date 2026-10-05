<template>
  <div class="space-y-4">
    <!-- 工具条 -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-wrap items-center gap-3 px-5 py-3">
      <el-input v-model="keyword" placeholder="搜索名称 / 标签" clearable class="w-full sm:!w-64" :prefix-icon="Search" />
      <div class="flex-1"></div>
      <el-button plain @click="openMerge">合并账号</el-button>
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

    <!-- 合并账号弹窗：左=保留，右=被合并并删除；选定后逐字段挑选保留账号最终资料 -->
    <el-dialog v-model="showMerge" title="合并贡献者账号" width="960px" :close-on-click-modal="false" top="6vh">
      <!-- 第一步：左右双列选账号 -->
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <!-- 左列：保留账号 -->
        <div class="border border-gray-200 rounded-lg flex flex-col min-h-0">
          <div class="px-3 py-2 border-b border-gray-100 bg-pink-50/60 rounded-t-lg">
            <div class="text-sm font-medium text-pink-600">① 保留的账号</div>
          </div>
          <div class="p-2 border-b border-gray-100">
            <el-input v-model="kwLeft" placeholder="搜索名称 / 标签" size="small" clearable />
          </div>
          <div class="max-h-64 overflow-y-auto p-1.5 space-y-1">
            <div
              v-for="c in leftList" :key="c.id"
              class="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer border text-sm"
              :class="mergeLeftId === c.id ? 'border-pink-400 bg-pink-50' : 'border-transparent hover:bg-gray-50'"
              @click="mergeLeftId = c.id"
            >
              <img v-if="c.avatar" :src="c.avatar" class="w-7 h-7 rounded-full object-cover shrink-0" />
              <div v-else class="w-7 h-7 rounded-full bg-pink-100 text-pink-500 flex items-center justify-center shrink-0 text-xs">{{ c.name?.charAt(0) }}</div>
              <div class="min-w-0 flex-1">
                <div class="truncate text-gray-800">{{ c.name }}<el-tag v-if="c.is_owner" size="small" type="danger" class="ml-1">站长</el-tag></div>
              </div>
              <span class="text-xs text-gray-400 shrink-0">{{ songCount(c.id) }} 首</span>
              <el-icon v-if="mergeLeftId === c.id" class="text-pink-500 shrink-0"><Check /></el-icon>
            </div>
            <div v-if="!leftList.length" class="text-center text-xs text-gray-300 py-6">无匹配账号</div>
          </div>
        </div>

        <!-- 右列：被合并账号 -->
        <div class="border border-gray-200 rounded-lg flex flex-col min-h-0">
          <div class="px-3 py-2 border-b border-gray-100 bg-red-50/60 rounded-t-lg">
            <div class="text-sm font-medium text-red-600">② 被合并的账号（合并后删除）</div>
          </div>
          <div class="p-2 border-b border-gray-100">
            <el-input v-model="kwRight" placeholder="搜索名称 / 标签" size="small" clearable />
          </div>
          <div class="max-h-64 overflow-y-auto p-1.5 space-y-1">
            <div
              v-for="c in rightList" :key="c.id"
              class="flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer border text-sm"
              :class="mergeRightId === c.id ? 'border-red-400 bg-red-50' : 'border-transparent hover:bg-gray-50'"
              @click="mergeRightId = c.id"
            >
              <img v-if="c.avatar" :src="c.avatar" class="w-7 h-7 rounded-full object-cover shrink-0" />
              <div v-else class="w-7 h-7 rounded-full bg-pink-100 text-pink-500 flex items-center justify-center shrink-0 text-xs">{{ c.name?.charAt(0) }}</div>
              <div class="min-w-0 flex-1">
                <div class="truncate text-gray-800">{{ c.name }}<el-tag v-if="c.is_owner" size="small" type="danger" class="ml-1">站长</el-tag></div>
              </div>
              <span class="text-xs text-gray-400 shrink-0">{{ songCount(c.id) }} 首</span>
              <el-icon v-if="mergeRightId === c.id" class="text-red-500 shrink-0"><Check /></el-icon>
            </div>
            <div v-if="!rightList.length" class="text-center text-xs text-gray-300 py-6">无匹配账号</div>
          </div>
        </div>
      </div>

      <!-- 第二步：逐字段挑选（两边都选中后出现） -->
      <template v-if="leftContributor && rightContributor">
        <el-divider content-position="left" class="!my-4">个人资料逐字段挑选（点击选用哪一边的值）</el-divider>
        <div class="space-y-2">
          <div class="grid grid-cols-[88px_1fr_1fr] gap-2 text-xs text-gray-400 px-1">
            <span></span>
            <span>① 保留账号</span>
            <span>② 被合并账号</span>
          </div>
          <div v-for="f in MERGE_FIELDS" :key="f.key">
            <!-- 联系方式特殊处理：按类型逐键挑选（两边都有的键二选一，仅一边有的可取消保留） -->
            <template v-if="f.key === 'contact_value'">
              <div class="grid grid-cols-[88px_1fr_1fr] gap-2 items-center pt-1">
                <span class="text-xs text-gray-500 px-1">联系方式</span>
                <span class="text-xs text-gray-400">点击保留；只在一边有的可再点一次取消</span>
                <span></span>
              </div>
              <div v-for="k in mergeContactKeys" :key="k" class="grid grid-cols-[88px_1fr_1fr] gap-2 items-center">
                <span class="text-xs text-gray-400 px-1 truncate">└ {{ contactLabel(k) }}</span>
                <div
                  v-if="contactVal(leftContributor, k)"
                  class="border rounded-md px-2.5 py-1.5 text-sm cursor-pointer min-h-[34px] flex items-center"
                  :class="contactChoice[k] === 'left' ? 'border-pink-400 bg-pink-50 text-gray-800' : 'border-gray-200 text-gray-400 hover:border-pink-200'"
                  @click="chooseContact(k, 'left')"
                >
                  <span class="truncate">{{ contactVal(leftContributor, k) }}</span>
                </div>
                <div v-else class="border border-gray-100 rounded-md px-2.5 py-1.5 text-sm min-h-[34px] flex items-center text-gray-300">—</div>
                <div
                  v-if="contactVal(rightContributor, k)"
                  class="border rounded-md px-2.5 py-1.5 text-sm cursor-pointer min-h-[34px] flex items-center"
                  :class="contactChoice[k] === 'right' ? 'border-red-400 bg-red-50 text-gray-800' : 'border-gray-200 text-gray-400 hover:border-red-200'"
                  @click="chooseContact(k, 'right')"
                >
                  <span class="truncate">{{ contactVal(rightContributor, k) }}</span>
                </div>
                <div v-else class="border border-gray-100 rounded-md px-2.5 py-1.5 text-sm min-h-[34px] flex items-center text-gray-300">—</div>
              </div>
            </template>
            <!-- 其余字段：整行左/右二选一 -->
            <div v-else class="grid grid-cols-[88px_1fr_1fr] gap-2 items-center">
              <span class="text-xs text-gray-500 px-1 truncate">{{ f.label }}</span>
              <div
                class="border rounded-md px-2.5 py-1.5 text-sm cursor-pointer min-h-[34px] flex items-center"
                :class="fieldChoice[f.key] === 'left' ? 'border-pink-400 bg-pink-50 text-gray-800' : 'border-gray-200 text-gray-600 hover:border-pink-200'"
                @click="fieldChoice[f.key] = 'left'"
              >
                <MergeFieldValue :c="leftContributor" :field="f.key" />
              </div>
              <div
                class="border rounded-md px-2.5 py-1.5 text-sm cursor-pointer min-h-[34px] flex items-center"
                :class="fieldChoice[f.key] === 'right' ? 'border-red-400 bg-red-50 text-gray-800' : 'border-gray-200 text-gray-600 hover:border-red-200'"
                @click="fieldChoice[f.key] = 'right'"
              >
                <MergeFieldValue :c="rightContributor" :field="f.key" />
              </div>
            </div>
          </div>
        </div>

        <!-- 合并影响预览 -->
        <div class="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-800 space-y-1">
          <div class="font-medium">合并后：</div>
          <div>删除「{{ rightContributor.name }}」，其 {{ usageOf(rightContributor.id).songs }} 首歌 / {{ usageOf(rightContributor.id).versions }} 个歌词版本 / {{ usageOf(rightContributor.id).submissions }} 条投稿全部转到「{{ leftContributor.name }}」名下</div>
          <div>保留账号最终名称：<b>{{ pickedProfile.name }}</b><span v-if="pickedProfile.name !== leftContributor.name" class="text-red-600">（将改名，原为「{{ leftContributor.name }}」）</span></div>
          <div class="text-amber-600">站长标识、注册时间保持保留账号原样；右边账号的个人资料删除后不可恢复。</div>
        </div>
      </template>

      <template #footer>
        <el-button @click="showMerge = false">取消</el-button>
        <el-button type="danger" :loading="merging" :disabled="!leftContributor || !rightContributor" @click="confirmMerge">确认合并</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, h, onMounted, reactive, ref, watch, type FunctionalComponent } from 'vue'
import { Search, Check } from '@element-plus/icons-vue'
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

// ============ 合并账号 ============
/** 参与逐字段挑选的资料字段（is_owner / created_at 不参与合并） */
type MergeProfileKey = 'name' | 'avatar' | 'bio' | 'public_bio' | 'contact_value' | 'public_contact' | 'tags' | 'sort'
const MERGE_FIELDS: { key: MergeProfileKey; label: string }[] = [
  { key: 'name', label: '名称' },
  { key: 'avatar', label: '头像' },
  { key: 'bio', label: '简介' },
  { key: 'public_bio', label: '简介公开' },
  { key: 'contact_value', label: '联系方式' },
  { key: 'public_contact', label: '联系方式公开' },
  { key: 'tags', label: '身份标签' },
  { key: 'sort', label: '置顶排序' },
]

/** 字段值展示（左右两列共用的函数式组件，避免模板重复两遍分支） */
const MergeFieldValue: FunctionalComponent<{ c: Contributor; field: MergeProfileKey }> = (props) => {
  const c = props.c
  const empty = () => h('span', { class: 'text-gray-300' }, '—')
  switch (props.field) {
    case 'name':
      return h('span', { class: 'truncate min-w-0' }, c.name)
    case 'avatar':
      return c.avatar
        ? h('div', { class: 'flex items-center gap-2 min-w-0' }, [
            h('img', { src: c.avatar, class: 'w-6 h-6 rounded-full object-cover shrink-0' }),
            h('span', { class: 'truncate min-w-0 text-xs text-gray-400' }, c.avatar),
          ])
        : empty()
    case 'bio':
      return c.bio ? h('span', { class: 'truncate min-w-0' }, c.bio) : empty()
    case 'public_bio':
    case 'public_contact':
      return h('span', { class: c[props.field] ? 'text-green-600' : 'text-gray-400' },
        c[props.field] ? '公开' : '隐藏')
    case 'tags':
      return c.tags?.length ? h('span', { class: 'truncate min-w-0' }, c.tags.join(' / ')) : empty()
    case 'sort':
      return h('span', null, String(c.sort ?? 0))
    default:
      return empty()
  }
}

const showMerge = ref(false)
const merging = ref(false)
const kwLeft = ref('')
const kwRight = ref('')
const mergeLeftId = ref<string | null>(null)   // 保留账号
const mergeRightId = ref<string | null>(null)  // 被合并并删除的账号
/** 每个字段选用哪一边的值，默认全部选左边（保留账号） */
const defaultChoice = () =>
  Object.fromEntries(MERGE_FIELDS.map(f => [f.key, 'left'])) as Record<MergeProfileKey, 'left' | 'right'>
const fieldChoice = reactive<Record<MergeProfileKey, 'left' | 'right'>>(defaultChoice())

/**
 * 联系方式逐键挑选（contact_value 不走整行二选一）：
 * 两边都有的键只能左/右二选一；仅一边有的键默认选有值侧，可再点一次取消（none=不保留）。
 */
type ContactSide = 'left' | 'right' | 'none'
const contactChoice = reactive<Record<string, ContactSide>>({})
/** 取某账号某联系方式类型的值（空串视为无） */
const contactVal = (c: Contributor | null, k: string) => c?.contact_value?.[k]?.trim() || ''
/** 双方联系方式类型并集；顺序跟随后台编辑弹窗的 CONTACT_TYPES，自定义类型排最后 */
const mergeContactKeys = computed<string[]>(() => {
  const l = leftContributor.value
  const r = rightContributor.value
  if (!l || !r) return []
  const all = new Set([
    ...Object.keys(l.contact_value || {}),
    ...Object.keys(r.contact_value || {}),
  ].filter(k => contactVal(l, k) || contactVal(r, k)))
  const known = CONTACT_TYPES.filter(k => all.has(k))
  const extra = [...all].filter(k => !CONTACT_TYPES.includes(k)).sort()
  return [...known, ...extra]
})
/** 联系方式默认选择：两边都有→左；仅一边有→有值侧 */
function resetContactChoice() {
  for (const k of Object.keys(contactChoice)) delete contactChoice[k]
  const l = leftContributor.value
  const r = rightContributor.value
  if (!l || !r) return
  for (const k of mergeContactKeys.value) {
    const hasL = !!contactVal(l, k)
    const hasR = !!contactVal(r, k)
    contactChoice[k] = hasL ? 'left' : hasR ? 'right' : 'none'
  }
}
/** 点击联系方式某一侧：两边都有→只在左右间切换；仅一边有→已选再点取消(none)，再点恢复 */
function chooseContact(k: string, side: 'left' | 'right') {
  const l = leftContributor.value
  const r = rightContributor.value
  if (!l || !r) return
  const hasL = !!contactVal(l, k)
  const hasR = !!contactVal(r, k)
  if (hasL && hasR) {
    contactChoice[k] = side
  } else {
    contactChoice[k] = contactChoice[k] === side ? 'none' : side
  }
}
/** 按逐键选择组装最终 contact_value（none 的键丢弃；两侧同键时取所选侧的值） */
function pickedContactValue(): Record<string, string> {
  const l = leftContributor.value
  const r = rightContributor.value
  const out: Record<string, string> = {}
  if (!l || !r) return out
  for (const k of mergeContactKeys.value) {
    const side = contactChoice[k]
    const v = side === 'left' ? contactVal(l, k) : side === 'right' ? contactVal(r, k) : ''
    if (v) out[k] = v
  }
  return out
}

/** 选中双方名下歌/版本/投稿计数（歌曲数直接用页面已加载的 countMap，版本/投稿按需查库） */
const usageMap = ref(new Map<string, { songs: number; versions: number; submissions: number }>())
const usageOf = (id: string) => usageMap.value.get(id) || { songs: 0, versions: 0, submissions: 0 }

const matchKw = (c: Contributor, kw: string) => {
  const k = kw.trim().toLowerCase()
  if (!k) return true
  return c.name?.toLowerCase().includes(k) || (c.tags || []).some(t => t.toLowerCase().includes(k))
}
// 左列排除右列已选账号，右列反之，防止选成同一个
const leftList = computed(() => contributors.value.filter(c => matchKw(c, kwLeft.value) && c.id !== mergeRightId.value))
const rightList = computed(() => contributors.value.filter(c => matchKw(c, kwRight.value) && c.id !== mergeLeftId.value))
const leftContributor = computed(() => contributors.value.find(c => c.id === mergeLeftId.value) || null)
const rightContributor = computed(() => contributors.value.find(c => c.id === mergeRightId.value) || null)

/** 按逐字段选择组装的保留账号最终资料（结构需与 RPC p_profile 契约一致，8 个键齐全） */
const pickedProfile = computed<Record<string, unknown>>(() => {
  const l = leftContributor.value
  const r = rightContributor.value
  if (!l || !r) return { name: '' }
  const pick = (k: MergeProfileKey) => (fieldChoice[k] === 'left' ? l[k] : r[k])
  return {
    name: pick('name'),
    avatar: (pick('avatar') as string) || null,
    bio: (pick('bio') as string) || null,
    public_bio: !!pick('public_bio'),
    contact_value: pickedContactValue(),
    public_contact: !!pick('public_contact'),
    tags: (pick('tags') as string[]) || [],
    sort: Number(pick('sort') || 0),
  }
})

function openMerge() {
  kwLeft.value = ''
  kwRight.value = ''
  mergeLeftId.value = null
  mergeRightId.value = null
  Object.assign(fieldChoice, defaultChoice())
  resetContactChoice()
  usageMap.value = new Map()
  showMerge.value = true
}

// 任一边换选：重置字段选择为全左、联系方式恢复默认，并在双方都选定后拉取版本/投稿计数
watch([mergeLeftId, mergeRightId], async () => {
  Object.assign(fieldChoice, defaultChoice())
  resetContactChoice()
  const ids = [mergeLeftId.value, mergeRightId.value].filter(Boolean) as string[]
  if (ids.length !== 2) {
    usageMap.value = new Map()
    return
  }
  try {
    const [versions, subs] = await Promise.all([
      adminApi.getAll<any>('lyric_versions', { select: 'contributor_id', in: { contributor_id: ids } }),
      adminApi.getAll<any>('submissions', { select: 'contributor_id', in: { contributor_id: ids } }),
    ])
    const m = new Map(ids.map(id => [id, { songs: songCount(id), versions: 0, submissions: 0 }]))
    versions.forEach((v: any) => { const o = m.get(v.contributor_id); if (o) o.versions++ })
    subs.forEach((v: any) => { const o = m.get(v.contributor_id); if (o) o.submissions++ })
    usageMap.value = m
  } catch (e: any) {
    ElMessage.error('读取账号引用数失败：' + (e?.message || e))
  }
})

async function confirmMerge() {
  const l = leftContributor.value
  const r = rightContributor.value
  if (!l || !r) return
  const u = usageOf(r.id)
  const renameTip = pickedProfile.value.name !== l.name
    ? `\n保留账号将改名为「${pickedProfile.value.name}」（原名「${l.name}」）。`
    : ''
  // 危险二次确认：文案写明右边账号永久删除及转移规模
  try {
    await ElMessageBox.confirm(
      `确定把「${r.name}」合并进「${l.name}」？\n` +
      `右边账号会被永久删除，其名下 ${u.songs} 首歌、${u.versions} 个歌词版本、${u.submissions} 条投稿将全部转到左边。${renameTip}`,
      '危险操作',
      { type: 'warning', confirmButtonText: '确认合并', cancelButtonText: '取消' },
    )
  } catch {
    return
  }
  merging.value = true
  try {
    // 单次 RPC = 库端单事务，失败整体回滚，不会半写
    const res = await adminApi.mergeContributors(r.id, l.id, pickedProfile.value)
    ElMessage.success(`已合并：${res.songs_moved} 首歌 / ${res.versions_moved} 个版本 / ${res.submissions_moved} 条投稿已转移`)
    showMerge.value = false
    await load()
  } catch (e: any) {
    ElMessage.error('合并失败（数据未改动）：' + (e?.message || e))
  } finally {
    merging.value = false
  }
}
</script>
