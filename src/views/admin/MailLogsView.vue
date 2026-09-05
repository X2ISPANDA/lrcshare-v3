<template>
  <div class="space-y-4">
    <!-- 工具条 -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-wrap items-center gap-3 px-5 py-3">
      <el-select v-model="filterStatus" placeholder="全部状态" clearable class="w-32">
        <el-option label="成功 sent" value="sent" />
        <el-option label="失败 failed" value="failed" />
        <el-option label="跳过 skipped" value="skipped" />
        <el-option label="进行中 pending" value="pending" />
      </el-select>
      <el-select v-model="filterAction" placeholder="全部类型" clearable class="w-32">
        <el-option label="notify 新投稿通知" value="notify" />
        <el-option label="approve 审核通过" value="approve" />
        <el-option label="reject 审核拒绝" value="reject" />
        <el-option label="batch 批量结果" value="batch" />
        <el-option label="test 测试" value="test" />
      </el-select>
      <el-input v-model="keyword" placeholder="搜收件人 / 歌名" clearable class="w-56" />
      <div class="flex-1" />
      <span class="text-sm text-gray-400">{{ filtered.length }} 条 / {{ allLogs.length }}</span>
      <el-button @click="load" :loading="loading">刷新</el-button>
    </div>

    <!-- 桌面端表格 -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm hidden md:block">
      <el-table :data="filtered" :loading="loading" row-key="id" stripe :default-sort="{ prop: 'created_at', order: 'descending' as const }">
        <el-table-column label="时间" prop="created_at" width="170" sortable="custom">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="类型" prop="action" width="130">
          <template #default="{ row }">
            <el-tag size="small" :type="actionTagType(row.action)">{{ actionLabel(row.action) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="statusTagType(row.status)">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="收件人" prop="to_email" min-width="180" show-overflow-tooltip />
        <el-table-column label="主题 / 歌名" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">{{ row.subject || row.song_title || '—' }}</template>
        </el-table-column>
        <el-table-column label="用户" prop="user_name" width="130" show-overflow-tooltip />
        <el-table-column label="错误" min-width="260" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.error" class="text-xs text-red-500">{{ row.error }}</span>
            <span v-else class="text-xs text-gray-300">—</span>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 移动端卡片 -->
    <div v-if="!loading && filtered.length" class="md:hidden space-y-3">
      <div v-for="row in filtered" :key="row.id" class="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3 text-sm">
        <div class="flex items-center justify-between gap-2 mb-1">
          <div class="flex items-center gap-2 shrink-0">
            <el-tag size="small" :type="actionTagType(row.action)">{{ actionLabel(row.action) }}</el-tag>
            <el-tag size="small" :type="statusTagType(row.status)">{{ statusLabel(row.status) }}</el-tag>
          </div>
          <span class="text-xs text-gray-400">{{ formatTime(row.created_at) }}</span>
        </div>
        <div class="text-gray-700 truncate">{{ row.subject || row.song_title || '—' }}</div>
        <div class="text-gray-500 text-xs truncate">→ {{ row.to_email || '—' }}</div>
        <div v-if="row.error" class="mt-1 text-xs text-red-500 truncate">{{ row.error }}</div>
      </div>
    </div>
    <div v-else-if="!loading" class="md:hidden py-10 text-center text-gray-400 text-sm">暂无日志</div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { adminApi } from '@/lib/adminApi'

const allLogs = ref<any[]>([])
const loading = ref(false)
const filterStatus = ref<string>('')
const filterAction = ref<string>('')
const keyword = ref('')

async function load() {
  loading.value = true
  try {
    allLogs.value = await adminApi.getMailLogs()
  } finally {
    loading.value = false
  }
}

const filtered = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  return allLogs.value.filter(r => {
    if (filterStatus.value && r.status !== filterStatus.value) return false
    if (filterAction.value && r.action !== filterAction.value) return false
    if (kw) {
      const hay = (r.to_email || '') + ' ' + (r.song_title || '') + ' ' + (r.subject || '')
      if (!hay.toLowerCase().includes(kw)) return false
    }
    return true
  })
})

function formatTime(t: string) {
  if (!t) return '—'
  const d = new Date(t)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

const actionMap: Record<string, string> = {
  notify: '新投稿通知',
  approve: '审核通过',
  reject: '审核拒绝',
  batch: '批量结果',
  test: '测试',
}
function actionLabel(a: string) { return actionMap[a] || a }
function actionTagType(a: string): 'primary' | 'success' | 'warning' | 'danger' | 'info' {
  return a === 'notify' ? 'primary' : a === 'approve' ? 'success' : a === 'reject' ? 'danger' : a === 'batch' ? 'warning' : 'info'
}

const statusMap: Record<string, string> = { sent: '成功', failed: '失败', skipped: '跳过', pending: '进行中' }
function statusLabel(s: string) { return statusMap[s] || s }
function statusTagType(s: string): 'success' | 'danger' | 'info' | 'warning' {
  return s === 'sent' ? 'success' : s === 'failed' ? 'danger' : s === 'skipped' ? 'info' : 'warning'
}

onMounted(load)
</script>
