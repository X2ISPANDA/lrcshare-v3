<template>
  <div class="space-y-4">
    <el-tabs v-model="tab" @tab-change="page = 1">
      <el-tab-pane v-for="t in tabs" :key="t.key" :name="t.key">
        <template #label>
          {{ t.label }}
          <el-badge v-if="t.key === 'pending' && counts.pending" :value="counts.pending" class="ml-1" />
        </template>
      </el-tab-pane>
    </el-tabs>

    <div class="bg-white rounded-xl border border-gray-100 shadow-sm">
      <div class="flex justify-between items-center px-5 py-3">
        <span class="text-sm text-gray-500">共 {{ listSource.length }} 条</span>
        <el-button v-if="selected.length" type="danger" plain size="small" @click="batchDelete">批量删除 ({{ selected.length }})</el-button>
      </div>

      <el-table :data="pagedList" stripe v-loading="loading" row-key="id" @selection-change="selected = $event">
        <el-table-column type="selection" width="45" />
        <el-table-column label="提交人" prop="user_name" width="110" show-overflow-tooltip />
        <el-table-column label="歌曲名" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ row.song_data?.title || '—' }}</template>
        </el-table-column>
        <el-table-column label="歌手" width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ row.song_data?.artist || '—' }}</template>
        </el-table-column>
        <el-table-column v-if="tab !== 'pending'" label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="tab === 'rejected'" label="拒绝原因" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.reject_reason || '—' }}</template>
        </el-table-column>
        <el-table-column label="提交时间" width="165">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="170" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openReview(row)">审核</el-button>
            <el-button v-if="row.status !== 'pending'" link type="warning" size="small" @click="withdraw(row)">撤回</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="flex justify-between items-center px-5 py-4 border-t border-gray-100">
        <div class="flex gap-2">
          <el-button size="small" :disabled="!selected.length" plain @click="clearSelection">取消选择</el-button>
          <el-button size="small" type="danger" :disabled="!selected.length" @click="batchDelete">批量删除</el-button>
        </div>
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50]"
          :total="listSource.length"
          layout="total, sizes, prev, pager, next"
          background
        />
      </div>
    </div>

    <!-- 审核弹窗 -->
    <el-dialog v-model="showReview" title="投稿审核" width="760px" :close-on-click-modal="false">
      <template v-if="review">
        <!-- 投稿人信息 -->
        <div class="bg-gray-50 rounded-lg p-3 mb-3 text-sm text-gray-600">
          <span class="font-medium text-gray-800">{{ review.user_name }}</span>
          <span class="mx-2 text-gray-300">|</span>
          <span>{{ formatTime(review.created_at) }}</span>
          <el-tag v-if="review.contributor_id" size="small" class="ml-2" type="info">已关联贡献者</el-tag>
          <el-tag v-if="review.submitter_request_update" size="small" class="ml-2" type="warning">请求更新资料</el-tag>
          <el-tag v-if="review.submitter_request_clear" size="small" class="ml-2" type="danger">请求清空资料</el-tag>
          <el-tag v-if="review.submitter_public_contact" size="small" class="ml-2" type="success">公开联系方式</el-tag>
        </div>

        <!-- 歌词预览 -->
        <div class="bg-gray-50 rounded-lg p-3 mb-3">
          <div class="text-sm font-medium text-gray-700 mb-2">📝 歌词预览（原文）</div>
          <pre class="text-[13px] text-gray-600 whitespace-pre-wrap max-h-40 overflow-y-auto m-0">{{ review.song_data?.lrc_text }}</pre>
        </div>

        <!-- 审核修改表单 -->
        <el-form :model="review.edited_data" label-width="80px">
          <el-row :gutter="12">
            <el-col :span="12"><el-form-item label="歌曲名"><el-input v-model="review.edited_data.title" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="专辑"><el-input v-model="review.edited_data.album" /></el-form-item></el-col>
          </el-row>
          <el-row :gutter="12">
            <el-col :span="12"><el-form-item label="时长"><el-input v-model="review.edited_data.duration" placeholder="03:30" /></el-form-item></el-col>
            <el-col :span="12"><el-form-item label="视频链接"><el-input v-model="review.edited_data.video_url" placeholder="B站/YouTube（选填）" /></el-form-item></el-col>
          </el-row>
          <el-row :gutter="12">
            <el-col :span="12">
              <el-form-item label="歌手">
                <ArtistTagInput v-model="review.edited_data.artists" :artists="artists" filter-type="singer" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="专辑艺术家">
                <ArtistTagInput v-model="review.edited_data.album_artists" :artists="artists" tone="gray" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="12">
            <el-col :span="12">
              <el-form-item label="作词">
                <ArtistTagInput v-model="review.edited_data.lyricist_arr" :artists="artists" filter-type="lyricist" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="作曲">
                <ArtistTagInput v-model="review.edited_data.composer_arr" :artists="artists" filter-type="composer" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-form-item label="歌词">
            <el-input v-model="review.edited_data.lrc_text" type="textarea" :rows="5" class="font-mono!" />
          </el-form-item>
        </el-form>

        <!-- 待创建艺术家 -->
        <div v-if="newArtistsList.length" class="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <div class="text-sm font-semibold text-amber-800 mb-1">🆕 待创建艺术家</div>
          <div class="text-xs text-amber-700 mb-3">发布时将插入 artists 表，需为每位新艺术家填写 ID（如 art_xxx）并选择是否前台展示</div>
          <div v-for="entry in newArtistsList" :key="entry.item.name" class="flex items-center gap-2 mb-2 bg-white p-2 rounded border border-amber-200">
            <el-tag size="small" type="warning">{{ entry.source }}</el-tag>
            <span class="text-sm font-medium text-gray-800 min-w-20">{{ entry.item.name }}</span>
            <span class="text-xs text-gray-500">{{ entry.types.map(t => TYPE_LABELS[t] || t).join('/') }}</span>
            <el-input v-model="entry.item.id" placeholder="art_xxx" size="small" class="!w-36" />
            <label class="flex items-center gap-1 text-xs text-gray-600 whitespace-nowrap cursor-pointer">
              <el-checkbox v-model="entry.item.is_show" size="small" />前台展示
            </label>
          </div>
        </div>
      </template>

      <template #footer>
        <el-button @click="showReview = false">取消</el-button>
        <el-button type="danger" plain @click="reject(review)">❌ 拒绝</el-button>
        <el-button type="success" @click="approve(review)">✅ 通过发布</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { adminApi } from '@/lib/adminApi'
import ArtistTagInput from '@/components/submit/ArtistTagInput.vue'
import type { Artist } from '@/lib/types'

/** 投稿审核：列表 + 审核弹窗（edited_data 可编辑、待创建艺术家填 ID、通过时事务链发布） */
const TYPE_LABELS: Record<string, string> = { singer: '歌手', lyricist: '作词', composer: '作曲', arranger: '编曲' }
const ARTIST_FIELDS = [
  { key: 'artists', label: '歌手', type: 'singer' },
  { key: 'album_artists', label: '专辑艺术家', type: 'singer' },
  { key: 'lyricist_arr', label: '作词', type: 'lyricist' },
  { key: 'composer_arr', label: '作曲', type: 'composer' },
] as const

interface ReviewItem {
  id: string
  user_name: string
  song_data: any
  edited_data: any
  status: string
  created_at: string
  reject_reason?: string | null
  contact_value?: Record<string, any>
  contributor_id?: string | null
  submitter_request_update?: boolean
  submitter_request_clear?: boolean
  submitter_public_contact?: boolean
  submitter_bio?: string | null
}

const tab = ref('pending')
const tabs = [
  { key: 'pending', label: '待审核' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '已拒绝' },
]

const submissions = ref<any[]>([])
const artists = ref<Artist[]>([])
const loading = ref(false)
const page = ref(1)
const pageSize = ref(10)
const selected = ref<any[]>([])
const tableRef = ref()

const counts = computed(() => ({
  pending: submissions.value.filter(s => s.status === 'pending').length,
}))
const listSource = computed(() => submissions.value.filter(s => s.status === tab.value))
const pagedList = computed(() => listSource.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

async function load() {
  loading.value = true
  try {
    const [subs, arts] = await Promise.all([
      adminApi.getAll('submissions', { order: 'created_at', ascending: false }),
      adminApi.getAll<Artist>('artists', { order: 'name' }),
    ])
    submissions.value = subs
    artists.value = arts
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

// ============ 审核弹窗 ============
const showReview = ref(false)
const review = ref<ReviewItem | null>(null)

function openReview(row: any) {
  const edited = JSON.parse(JSON.stringify(row.song_data || {}))
  // 兼容旧格式：补全新格式数组字段 + 初始化新艺术家的 is_show
  if (!Array.isArray(edited.artists)) edited.artists = []
  if (!Array.isArray(edited.album_artists)) edited.album_artists = []
  if (!Array.isArray(edited.lyricist_arr)) edited.lyricist_arr = []
  if (!Array.isArray(edited.composer_arr)) edited.composer_arr = []
  for (const f of ARTIST_FIELDS) {
    edited[f.key].forEach((item: any) => {
      if (item && !item.id && item.is_show === undefined) item.is_show = true
    })
  }
  review.value = { ...row, edited_data: edited }
  showReview.value = true
}

/** 收集投稿中所有无 ID 的新建艺术家（跨字段按名合并，types 取并集） */
const newArtistsList = computed(() => {
  if (!review.value) return []
  const map = new Map<string, { item: any; source: string[]; types: Set<string> }>()
  for (const f of ARTIST_FIELDS) {
    const arr = review.value.edited_data[f.key] || []
    for (const item of arr) {
      if (!item || item.id) continue
      if (!map.has(item.name)) map.set(item.name, { item, source: [f.label], types: new Set([f.type]) })
      else {
        map.get(item.name)!.source.push(f.label)
        map.get(item.name)!.types.add(f.type)
      }
    }
  }
  return [...map.entries()].map(([, v]) => ({ item: v.item, source: v.source.join(' / '), types: [...v.types] }))
})

/** 从 contact_value（JSONB）解析邮箱 */
function parseEmail(row: any): string {
  const cv = row.contact_value
  try {
    const obj = typeof cv === 'string' ? JSON.parse(cv || '{}') : (cv || {})
    return obj['邮箱'] || ''
  } catch {
    return ''
  }
}

// ============ 通过发布（事务链，迁移自 v2 并统一 lyricist/composer 存 ID） ============
async function approve(sub: ReviewItem | null) {
  if (!sub) return
  // 1. 校验新建艺术家必须填 ID
  const missing = newArtistsList.value.filter(e => !e.item.id || !String(e.item.id).trim())
  if (missing.length) {
    ElMessage.error(`有 ${missing.length} 位新建艺术家未填写 ID（${missing.map(e => e.item.name).join('、')}）`)
    return
  }

  try {
    const sd = sub.edited_data

    // 2. 更新投稿状态
    await adminApi.update('submissions', sub.id, { status: 'approved', approved_at: new Date().toISOString() })

    // 3. 邮件通知（SMTP 由服务端读取，失败不阻塞）
    adminApi.callMailServer('/api/mailer', {
      action: 'approve',
      to: parseEmail(sub),
      user_name: sub.user_name,
      song_title: sd.title,
    }).catch(e => console.warn('通过邮件跳过:', e?.message))

    // 4. 插入新建艺术家并回填 ID
    const nameToId: Record<string, string> = {}
    for (const e of newArtistsList.value) {
      const id = String(e.item.id).trim()
      nameToId[e.item.name] = id
      await adminApi.insert('artists', {
        id,
        name: e.item.name,
        types: e.types.length ? e.types : ['singer'],
        is_show: e.item.is_show !== false,
        sort: 0,
      })
    }
    for (const f of ARTIST_FIELDS) {
      sd[f.key].forEach((item: any) => {
        if (item && !item.id && nameToId[item.name]) item.id = nameToId[item.name]
      })
    }

    // 5. 贡献者四路逻辑（关联: none/update/clear；未关联: 新建）
    const contactValue = sub.contact_value || {}
    const bio = sub.submitter_bio != null ? String(sub.submitter_bio) : null
    let contributorId = sub.contributor_id || null
    let action = 'none'

    if (contributorId) {
      if (sub.submitter_request_clear) {
        await adminApi.update('contributors', contributorId, {
          avatar: null, bio: '', public_bio: true, contact_value: {}, public_contact: false, location: '', sort: 0,
        })
        action = 'clear'
      } else if (sub.submitter_request_update) {
        const patch: Record<string, unknown> = { contact_value: contactValue, public_contact: !!sub.submitter_public_contact }
        if (bio !== null) patch.bio = bio
        await adminApi.update('contributors', contributorId, patch)
        action = 'update'
      }
    } else {
      contributorId = 'ct' + Date.now()
      await adminApi.insert('contributors', {
        id: contributorId,
        name: sub.user_name || '匿名贡献者',
        bio: bio ?? '通过投稿自动创建的贡献者',
        contact_types: [],
        contact_value: contactValue,
        public_contact: !!sub.submitter_public_contact,
        public_bio: true,
        tags: ['歌词提交'],
        is_owner: false,
        sort: 0,
      })
      action = 'new'
    }

    // 6. 专辑：沿用已有 / 新建
    let albumId: string | null = sd.album_id || null
    if (!albumId && sd.album) {
      albumId = 'al' + Date.now()
      await adminApi.insert('albums', {
        id: albumId,
        name: sd.album,
        artist_ids: (sd.album_artists || []).map((a: any) => a.id).filter(Boolean),
        year: sd.year ? parseInt(sd.year) : null,
      })
    }

    // 7. 插入歌曲（lyricist/composer 统一存 ID 逗号分隔）
    const idsOf = (arr: any[]) => (arr || []).map(a => a.id).filter(Boolean).join(',')
    await adminApi.insert('songs', {
      id: 's' + Date.now(),
      title: sd.title,
      artist_ids: (sd.artists || []).map((a: any) => a.id).filter(Boolean),
      album_id: albumId,
      lyricist: idsOf(sd.lyricist_arr) || sd.lyricist || '',
      composer: idsOf(sd.composer_arr) || sd.composer || '',
      duration: sd.duration || '',
      lrc_text: sd.lrc_text,
      video_url: sd.video_url || null,
      status: 'published',
      contributor_id: contributorId,
    })

    const actionText = { none: '（已关联贡献者）', new: '（已自动创建贡献者）', update: '（已更新贡献者资料）', clear: '（已清空贡献者资料）' }[action]
    ElMessage.success('审核通过，已发布' + actionText)
    showReview.value = false
    await load()
  } catch (e: any) {
    ElMessage.error('操作失败：' + e.message)
  }
}

async function reject(sub: ReviewItem | null) {
  if (!sub) return
  try {
    const { value } = await ElMessageBox.prompt('请输入拒绝原因', '拒绝投稿', {
      confirmButtonText: '确认拒绝',
      cancelButtonText: '取消',
      inputPattern: /.+/,
      inputErrorMessage: '拒绝原因不能为空',
    })
    await adminApi.update('submissions', sub.id, {
      status: 'rejected',
      reject_reason: value,
      rejected_at: new Date().toISOString(),
    })
    adminApi.callMailServer('/api/mailer', {
      action: 'reject',
      to: parseEmail(sub),
      user_name: sub.user_name,
      song_title: sub.song_data?.title,
      reject_reason: value,
    }).catch(e => console.warn('拒绝邮件跳过:', e?.message))
    ElMessage.success('已拒绝')
    showReview.value = false
    await load()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error('操作失败：' + (e?.message || e))
  }
}

async function withdraw(row: any) {
  try {
    await ElMessageBox.confirm('确定将此投稿撤回为待审核状态？', '撤回投稿', { type: 'warning' })
    await adminApi.update('submissions', row.id, {
      status: 'pending', reject_reason: null, rejected_at: null, approved_at: null,
    })
    ElMessage.success('已撤回，现在为待审核')
    await load()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error('操作失败')
  }
}

async function batchDelete() {
  if (!selected.value.length) return
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selected.value.length} 条投稿记录？`, '批量删除', { type: 'warning' })
    await adminApi.removeBatch('submissions', selected.value.map(s => s.id))
    ElMessage.success('批量删除完成')
    clearSelection()
    await load()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error('删除失败：' + e.message)
  }
}

const statusTagType = (s: string): any => ({ pending: 'warning', approved: 'success', rejected: 'danger' }[s] || 'info')
const statusText = (s: string) => ({ pending: '待审核', approved: '已通过', rejected: '已拒绝' }[s] || s)
const formatTime = (t: string) => (t ? new Date(t).toLocaleString('zh-CN') : '')
</script>
