<template>
  <div class="space-y-4">
    <!-- 工具条 -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-wrap items-center gap-3 px-5 py-3">
      <el-input v-model="keyword" placeholder="搜索名称 / 备注" clearable class="w-full sm:!w-64" :prefix-icon="Search" />
      <div class="flex-1"></div>
      <el-button type="primary" @click="openNew">+ 签发 API Key</el-button>
    </div>

    <!-- 列表 -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm">
      <AdminTable :data="filteredList" :loading="loading" row-key="id">
        <el-table-column label="名称" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="font-medium text-gray-800">{{ row.name }}</span>
          </template>
        </el-table-column>
        <el-table-column label="Key 前缀" width="140">
          <template #default="{ row }">
            <code class="text-xs bg-gray-50 px-2 py-1 rounded text-gray-600">{{ row.key_prefix }}...</code>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.status === 'active'" type="success" size="small">正常</el-tag>
            <el-tag v-else type="danger" size="small">已封禁</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="备注" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">{{ row.note || '—' }}</template>
        </el-table-column>
        <el-table-column label="创建时间" width="170" align="center">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="160" align="center">
          <template #default="{ row }">
            <el-button
              v-if="row.status === 'active'"
              link type="warning" size="small"
              @click="toggleStatus(row)"
            >封禁</el-button>
            <el-button
              v-else
              link type="success" size="small"
              @click="toggleStatus(row)"
            >启用</el-button>
            <el-button link type="danger" size="small" @click="removeOne(row)">删除</el-button>
          </template>
        </el-table-column>

        <!-- 移动端卡片 -->
        <template #card="{ row }">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2">
                <span class="font-medium text-gray-800 truncate">{{ row.name }}</span>
                <el-tag v-if="row.status === 'active'" type="success" size="small">正常</el-tag>
                <el-tag v-else type="danger" size="small">已封禁</el-tag>
              </div>
              <div class="text-xs text-gray-400 mt-1">
                <code class="bg-gray-50 px-1.5 py-0.5 rounded">{{ row.key_prefix }}...</code>
                <span class="ml-2">{{ formatTime(row.created_at) }}</span>
              </div>
              <div v-if="row.note" class="text-xs text-gray-400 mt-1 truncate">{{ row.note }}</div>
            </div>
          </div>
          <div class="mt-2 pt-2 border-t border-gray-50 flex gap-1">
            <el-button
              v-if="row.status === 'active'"
              link type="warning" size="small"
              @click="toggleStatus(row)"
            >封禁</el-button>
            <el-button
              v-else
              link type="success" size="small"
              @click="toggleStatus(row)"
            >启用</el-button>
            <el-button link type="danger" size="small" @click="removeOne(row)">删除</el-button>
          </div>
        </template>
      </AdminTable>

      <div v-if="!loading && !filteredList.length" class="text-center py-16 text-gray-400 text-sm">
        暂无 API Key
      </div>
    </div>

    <!-- 签发弹窗 -->
    <el-dialog v-model="showDialog" title="签发 API Key" width="480px" :close-on-click-modal="false">
      <el-form :model="form" label-width="80px">
        <el-form-item label="名称" required>
          <el-input v-model="form.name" placeholder="客户端名称，如「Lyrico 插件」" />
        </el-form-item>
        <el-form-item label="备注">
          <el-input v-model="form.note" type="textarea" :rows="2" placeholder="谁在用、联系方式等（可选）" />
        </el-form-item>
      </el-form>

      <!-- 生成结果（只显示一次） -->
      <div v-if="generatedKey" class="mt-4 p-4 bg-green-50 border border-green-200 rounded-lg">
        <div class="text-sm text-green-700 font-medium mb-2">Key 已生成（请立即复制，关闭后不再显示）</div>
        <div class="flex items-center gap-2">
          <code class="flex-1 bg-white px-3 py-2 rounded border border-green-200 text-sm break-all">{{ generatedKey }}</code>
          <el-button size="small" type="primary" @click="copyKey">复制</el-button>
        </div>
      </div>

      <template #footer>
        <el-button @click="closeDialog">关闭</el-button>
        <el-button v-if="!generatedKey" type="primary" :loading="saving" @click="save">生成 Key</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'
import { adminApi } from '@/lib/adminApi'
import AdminTable from '@/components/admin/AdminTable.vue'
import type { ApiKey } from '@/lib/types'

/** API Key 管理：签发（明文只显示一次）/ 封禁启用 / 删除 */

const list = ref<ApiKey[]>([])
const loading = ref(false)
const keyword = ref('')

const filteredList = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return list.value
  return list.value.filter(k =>
    k.name.toLowerCase().includes(kw) ||
    (k.note || '').toLowerCase().includes(kw)
  )
})

function formatTime(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function load() {
  loading.value = true
  try {
    list.value = await adminApi.getAll<ApiKey>('api_keys', { order: 'created_at', ascending: false })
  } catch (e: any) {
    ElMessage.error('加载失败：' + e.message)
  } finally {
    loading.value = false
  }
}
onMounted(load)

// ============ 签发 ============
const showDialog = ref(false)
const saving = ref(false)
const generatedKey = ref('')
const form = reactive({ name: '', note: '' })

function openNew() {
  form.name = ''
  form.note = ''
  generatedKey.value = ''
  showDialog.value = true
}

function closeDialog() {
  showDialog.value = false
}

async function save() {
  if (!form.name.trim()) {
    ElMessage.warning('请填写名称')
    return
  }
  saving.value = true
  try {
    // 1. 前端生成 key（明文只此一次）
    const { key, hash, prefix } = await adminApi.generateApiKey()
    // 2. 存库（只存 hash + prefix，不存明文）
    await adminApi.insert('api_keys', {
      id: crypto.randomUUID(),
      name: form.name.trim(),
      key_hash: hash,
      key_prefix: prefix,
      status: 'active',
      note: form.note.trim() || null,
    })
    // 3. 通知 Worker 清 KV 缓存（让新 Key 立即生效）
    await adminApi.refreshApiKeyCache().catch(() => {
      // 刷新缓存失败不阻断（兜底 5min 自动生效），提示一下
      ElMessage.warning('Key 已创建，但缓存刷新失败，最长 5 分钟后生效')
    })
    // 4. 显示明文 key（只此一次）
    generatedKey.value = key
    ElMessage.success('Key 已生成')
    await load()
  } catch (e: any) {
    ElMessage.error('生成失败：' + (e?.message || e))
  } finally {
    saving.value = false
  }
}

async function copyKey() {
  try {
    await navigator.clipboard.writeText(generatedKey.value)
    ElMessage.success('已复制')
  } catch {
    ElMessage.warning('复制失败，请手动选择复制')
  }
}

// ============ 封禁/启用 ============
async function toggleStatus(row: ApiKey) {
  const newStatus = row.status === 'active' ? 'banned' : 'active'
  const action = newStatus === 'banned' ? '封禁' : '启用'
  try {
    await ElMessageBox.confirm(`确定${action}「${row.name}」？`, '确认', { type: 'warning' })
    await adminApi.update('api_keys', row.id, { status: newStatus })
    // 通知 Worker 清缓存，使封禁/启用即时生效
    await adminApi.refreshApiKeyCache().catch(() => {
      ElMessage.warning(`${action}成功，但缓存刷新失败，最长 5 分钟后生效`)
    })
    ElMessage.success(`${action}成功`)
    await load()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error(`${action}失败：` + (e?.message || e))
  }
}

// ============ 删除 ============
async function removeOne(row: ApiKey) {
  try {
    await ElMessageBox.confirm(`确定删除「${row.name}」？删除后该 Key 立即失效。`, '确认删除', { type: 'warning' })
    await adminApi.remove('api_keys', row.id)
    await adminApi.refreshApiKeyCache().catch(() => {})
    ElMessage.success('已删除')
    await load()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error('删除失败：' + (e?.message || e))
  }
}
</script>
