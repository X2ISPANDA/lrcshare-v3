<template>
  <div class="space-y-6">
    <!-- 统计卡（count 聚合查询，不拉全量数据） -->
    <div class="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <div v-for="card in cards" :key="card.label" class="bg-white rounded-xl border border-gray-100 shadow-sm p-6 text-center">
        <div class="text-4xl font-bold" :class="card.color">{{ card.value ?? '—' }}</div>
        <div class="text-sm text-gray-500 mt-2">{{ card.label }}</div>
      </div>
    </div>

    <!-- 快捷入口 -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm p-5 flex flex-wrap items-center justify-between gap-3">
      <div>
        <div class="font-semibold text-gray-800">⚡ 快速发布</div>
        <p class="text-sm text-gray-400 mt-1">管理员直接发布新歌，绕过投稿审核流程</p>
      </div>
      <RouterLink to="/admin/songs?new=1">
        <el-button type="primary" style="--el-button-bg-color: #ec4899; --el-button-border-color: #ec4899; --el-button-hover-bg-color: #db2777; --el-button-hover-border-color: #db2777">+ 直接发布新歌</el-button>
      </RouterLink>
    </div>

    <!-- 最近投稿 -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm">
      <div class="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <span class="font-semibold text-gray-800">📝 最近投稿</span>
        <RouterLink to="/admin/submissions">
          <el-button link type="primary">查看全部 →</el-button>
        </RouterLink>
      </div>
      <AdminTable :data="recent" :loading="loadingRecent" row-key="id">
        <el-table-column label="提交人" prop="user_name" width="120" />
        <el-table-column label="歌曲名" min-width="180">
          <template #default="{ row }">{{ row.song_data?.title || '—' }}</template>
        </el-table-column>
        <el-table-column label="歌手" width="140">
          <template #default="{ row }">{{ row.song_data?.artist || '—' }}</template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="提交时间" width="170">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>

        <!-- 移动端卡片 -->
        <template #card="{ row }">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="font-medium text-gray-800 truncate">{{ row.song_data?.title || '—' }}</div>
              <div class="text-xs text-gray-400 truncate mt-0.5">{{ row.user_name }}<template v-if="row.song_data?.artist"> · {{ row.song_data?.artist }}</template></div>
              <div class="text-xs text-gray-400 mt-0.5">{{ formatTime(row.created_at) }}</div>
            </div>
            <el-tag :type="statusTagType(row.status)" size="small" class="shrink-0">{{ statusText(row.status) }}</el-tag>
          </div>
        </template>
      </AdminTable>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { supabase } from '@/lib/supabase'
import AdminTable from '@/components/admin/AdminTable.vue'

/** 数据概览：统计用 count 聚合（head 请求不拉数据），最近投稿仅取 5 条 */
const cards = ref([
  { label: '已发布歌曲', color: 'text-pink-500', value: null as number | null },
  { label: '艺术家数', color: 'text-purple-500', value: null as number | null },
  { label: '专辑数', color: 'text-blue-500', value: null as number | null },
  { label: '待审核投稿', color: 'text-orange-500', value: null as number | null },
])

const recent = ref<any[]>([])
const loadingRecent = ref(false)

async function loadStats() {
  const count = async (table: string, eq?: [string, unknown]) => {
    let q = supabase.from(table).select('*', { count: 'exact', head: true })
    if (eq) q = q.eq(eq[0], eq[1])
    const { count: c } = await q
    return c ?? 0
  }
  const [songs, artists, albums, pending] = await Promise.all([
    count('songs', ['status', 'published']),
    count('artists'),
    count('albums'),
    count('submissions', ['status', 'pending']),
  ])
  cards.value[0].value = songs
  cards.value[1].value = artists
  cards.value[2].value = albums
  cards.value[3].value = pending
}

async function loadRecent() {
  loadingRecent.value = true
  try {
    const { data } = await supabase
      .from('submissions')
      .select('id, user_name, song_data, status, created_at')
      .order('created_at', { ascending: false })
      .limit(5)
    recent.value = data || []
  } finally {
    loadingRecent.value = false
  }
}

onMounted(() => {
  loadStats().catch(e => ElMessage.error('统计加载失败：' + e.message))
  loadRecent()
})

const statusTagType = (s: string): any => ({ pending: 'warning', approved: 'success', rejected: 'danger' }[s] || 'info')
const statusText = (s: string) => ({ pending: '待审核', approved: '已通过', rejected: '已拒绝' }[s] || s)
const formatTime = (t: string) => (t ? new Date(t).toLocaleString('zh-CN') : '')
</script>
