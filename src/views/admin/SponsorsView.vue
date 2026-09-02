<template>
  <div class="space-y-4">
    <!-- 统计卡片 -->
    <div class="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <div class="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3">
        <div class="text-xs text-gray-400">赞助总人数</div>
        <div class="text-xl font-semibold text-gray-800 mt-1">{{ sponsors.length }}</div>
      </div>
      <div class="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3">
        <div class="text-xs text-gray-400">赞助总金额</div>
        <div class="text-xl font-semibold text-pink-500 mt-1">¥{{ totalAmount }}</div>
      </div>
    </div>

    <!-- 工具条 -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-wrap items-center gap-3 px-5 py-3">
      <el-input v-model="keyword" placeholder="搜索名称 / 描述" clearable class="w-full sm:!w-64" :prefix-icon="Search" />
      <div class="flex-1"></div>
      <el-button type="primary" @click="openNew" style="--el-button-bg-color: #ec4899; --el-button-border-color: #ec4899; --el-button-hover-bg-color: #db2777; --el-button-hover-border-color: #db2777">+ 新增赞助</el-button>
    </div>

    <div class="bg-white rounded-xl border border-gray-100 shadow-sm">
      <AdminTable :data="pagedList" :loading="loading" row-key="id" @selection-change="selected = $event">
        <el-table-column type="selection" width="45" />
        <el-table-column label="赞助者" min-width="140">
          <template #default="{ row }">
            <div class="flex items-center gap-2">
              <span class="font-medium text-gray-800">{{ row.name }}</span>
            </div>
            <div v-if="row.title" class="text-xs text-gray-400 mt-0.5 truncate max-w-52" :title="row.title">{{ row.title }}</div>
          </template>
        </el-table-column>
        <el-table-column label="金额" width="110" align="right">
          <template #default="{ row }">
            <span class="text-pink-500 font-medium">{{ row.amount }}{{ row.suffix || '元' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="日期" width="110" align="center">
          <template #default="{ row }">{{ row.datatime || '—' }}</template>
        </el-table-column>
        <el-table-column label="描述" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.descr || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="130" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="removeOne(row)">删除</el-button>
          </template>
        </el-table-column>

        <!-- 移动端卡片 -->
        <template #card="{ row }">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0 flex items-center gap-2">
              <div class="min-w-0">
                <div class="font-medium text-gray-800 truncate">{{ row.name }}</div>
                <div v-if="row.title" class="text-xs text-gray-400 truncate">{{ row.title }}</div>
              </div>
            </div>
            <span class="text-pink-500 font-medium shrink-0">{{ row.amount }}{{ row.suffix || '元' }}</span>
          </div>
          <div class="text-xs text-gray-400 mt-1"><template v-if="row.datatime">{{ row.datatime }}<template v-if="row.descr"> · </template></template><template v-if="row.descr">{{ row.descr }}</template></div>
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
    <el-dialog v-model="showDialog" :title="editing ? '编辑赞助' : '新增赞助'" width="520px" :close-on-click-modal="false">
      <el-form :model="form" label-width="84px">
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="名称" required><el-input v-model="form.name" placeholder="赞助者名称" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="日期"><el-date-picker v-model="form.datatime" type="date" value-format="YYYY-MM-DD" placeholder="选择日期" class="!w-full" /></el-form-item></el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="12">
            <el-form-item label="金额" required>
              <div class="flex gap-2 w-full">
                <el-input v-model="form.amount" placeholder="赞助金额，如 66.66" @input="onAmountInput" class="!w-full" />
                <el-input v-model="form.suffix" class="!w-16" placeholder="元" />
              </div>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="描述"><el-input v-model="form.descr" type="textarea" :rows="2" placeholder="赞助留言 / 描述（选填）" /></el-form-item>
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="广告标题"><el-input v-model="form.title" placeholder="超链接文字（选填）" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="广告链接"><el-input v-model="form.url" placeholder="https://... （选填）" /></el-form-item></el-col>
        </el-row>
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
import type { Sponsor } from '@/lib/types'

/** 赞助管理：统计 + 列表 + 新增/编辑（广告位字段） */

const sponsors = ref<Sponsor[]>([])
const loading = ref(false)
const keyword = ref('')
const page = ref(1)
const pageSize = ref(20)
const selected = ref<Sponsor[]>([])
const tableRef = ref()

const totalAmount = computed(() => sponsors.value.reduce((s, x) => s + parseFloat(x.amount || '0'), 0).toFixed(2))

const filteredList = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return sponsors.value
  return sponsors.value.filter(s => s.name?.toLowerCase().includes(kw) || s.descr?.toLowerCase().includes(kw))
})
const pagedList = computed(() => filteredList.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

async function load() {
  loading.value = true
  try {
    sponsors.value = await adminApi.getAll<Sponsor>('sponsors', { order: 'datatime', ascending: false })
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

const showDialog = ref(false)
const editing = ref<Sponsor | null>(null)
const saving = ref(false)

const form = reactive({
  name: '',
  amount: '',
  datatime: '',
  suffix: '元',
  descr: '',
  title: '',
  url: '',
})

/** 金额输入：只允许数字与一个小数点（赞助金额直接录入，无需步进按钮） */
function onAmountInput(v: string) {
  const clean = v.replace(/[^\d.]/g, '')
  const dot = clean.indexOf('.')
  form.amount = dot === -1 ? clean : clean.slice(0, dot + 1) + clean.slice(dot + 1).replace(/\./g, '')
}

function openNew() {
  editing.value = null
  Object.assign(form, { name: '', amount: '', datatime: new Date().toISOString().slice(0, 10), suffix: '元', descr: '', title: '', url: '' })
  showDialog.value = true
}

function openEdit(row: Sponsor) {
  editing.value = row
  Object.assign(form, {
    name: row.name || '',
    // numeric 列返回带尾零（如 1.00 / 66.60），回填时归一为自然写法（1 / 66.6）
    amount: row.amount ? String(parseFloat(row.amount)) : '',
    datatime: row.datatime || '',
    suffix: row.suffix || '元',
    descr: row.descr || '',
    title: row.title || '',
    url: row.url || '',
  })
  showDialog.value = true
}

async function save() {
  if (!form.name.trim()) {
    ElMessage.warning('请输入赞助者名称')
    return
  }
  const amountNum = parseFloat(form.amount)
  if (!form.amount.trim() || isNaN(amountNum) || amountNum <= 0) {
    ElMessage.warning('请输入正确的赞助金额')
    return
  }
  saving.value = true
  try {
    const payload = {
      name: form.name.trim(),
      amount: String(amountNum),
      datatime: form.datatime,
      suffix: form.suffix || '元',
      descr: form.descr || null,
      title: form.title.trim() || null,
      url: form.url.trim() || null,
    }
    if (editing.value) {
      await adminApi.update('sponsors', editing.value.id, payload)
      ElMessage.success('保存成功')
    } else {
      await adminApi.insert('sponsors', { id: 'sp' + Date.now(), ...payload })
      ElMessage.success('新增赞助成功')
    }
    showDialog.value = false
    await load()
  } catch (e: any) {
    ElMessage.error('保存失败：' + (e?.message || e))
  } finally {
    saving.value = false
  }
}

async function removeOne(row: Sponsor) {
  try {
    await ElMessageBox.confirm(`确定删除赞助记录「${row.name}」？`, '确认删除', { type: 'warning' })
    await adminApi.remove('sponsors', row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error('删除失败：' + e.message)
  }
}

async function batchRemove() {
  if (!selected.value.length) return
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selected.value.length} 条赞助记录？`, '批量删除', { type: 'warning' })
    await adminApi.removeBatch('sponsors', selected.value.map(s => s.id))
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
