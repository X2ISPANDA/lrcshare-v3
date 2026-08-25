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
        <el-table-column v-if="tab === 'pending'" label="操作" width="80" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openReview(row)">审核</el-button>
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
            <el-col :span="12">
              <el-form-item label="专辑">
                <el-select
                  v-model="albumSelect"
                  filterable
                  allow-create
                  default-first-option
                  placeholder="搜索库内专辑，或输入新专辑名"
                  class="w-full"
                >
                  <el-option v-for="al in albums" :key="al.id" :label="al.name + (al.year ? `（${al.year}）` : '')" :value="al.id" />
                </el-select>
                <div v-if="review.edited_data.album_id" class="text-xs text-green-600 mt-1 w-full">已关联库内专辑（沿用该专辑信息）</div>
                <div v-else-if="albumNameExists" class="text-xs text-red-500 mt-1 w-full">库内已有同名专辑！如需沿用请从下拉选择，否则将新建重复专辑</div>
                <div v-else-if="review.edited_data.album" class="text-xs text-amber-600 mt-1 w-full">新专辑（发布时创建）</div>
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="12">
            <el-col :span="8"><el-form-item label="时长"><el-input v-model="review.edited_data.duration" placeholder="03:30" /></el-form-item></el-col>
            <el-col :span="8">
              <el-form-item label="曲目号">
                <el-input v-model="review.edited_data.track" placeholder="专辑内序号（选填）" />
                <div v-if="albumTrackOccupied" class="text-xs text-red-500 mt-1 w-full">该曲目号已被专辑内其他歌占用：{{ albumTrackOccupied }}</div>
              </el-form-item>
            </el-col>
            <el-col :span="8"><el-form-item label="视频链接"><el-input v-model="review.edited_data.video_url" placeholder="B站/YouTube（选填）" /></el-form-item></el-col>
          </el-row>
          <el-row :gutter="12">
            <el-col :span="12">
              <el-form-item label="歌手">
                <ArtistTagInput v-model="review.edited_data.artists" :artists="artists" :session-names="sessionNewArtists" filter-type="singer" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="专辑艺术家">
                <ArtistTagInput v-model="review.edited_data.album_artists" :artists="artists" :session-names="sessionNewArtists" tone="gray" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="12">
            <el-col :span="12">
              <el-form-item label="作词">
                <ArtistTagInput v-model="review.edited_data.lyricist_arr" :artists="artists" :session-names="sessionNewArtists" filter-type="lyricist" />
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="作曲">
                <ArtistTagInput v-model="review.edited_data.composer_arr" :artists="artists" :session-names="sessionNewArtists" filter-type="composer" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-row :gutter="12">
            <el-col :span="12">
              <el-form-item label="风格">
                <el-select v-model="review.edited_data.genres" multiple filterable allow-create clearable default-first-option placeholder="选择或输入风格标签" class="w-full">
                  <el-option v-for="g in GENRE_OPTIONS" :key="g" :label="g" :value="g" />
                </el-select>
              </el-form-item>
            </el-col>
            <el-col :span="12">
              <el-form-item label="专辑封面">
                <el-input v-model="review.edited_data.album_cover" placeholder="图片 URL（选填）" />
                <img v-if="review.edited_data.album_cover" :src="review.edited_data.album_cover" class="mt-2 w-20 h-20 rounded object-cover" />
              </el-form-item>
            </el-col>
          </el-row>
          <el-form-item label="歌词">
            <el-input v-model="review.edited_data.lrc_text" type="textarea" :rows="5" class="font-mono!" />
          </el-form-item>
        </el-form>

        <!-- 同名歧义警示 -->
        <div v-if="ambiguousArtists.length" class="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
          <div class="text-sm font-semibold text-red-800 mb-1">⚠️ 同名歧义</div>
          <div class="text-xs text-red-700 mb-2">以下艺术家库内有多位同名，无法自动绑定。请删除其在各字段中的标签，从下拉中重新选择正确的一位（下拉带消歧标注）：</div>
          <div v-for="a in ambiguousArtists" :key="a.name" class="text-xs text-red-700 mb-1">
            · {{ a.name }} → 库内 {{ a.entries.length }} 位：{{ a.entries.join('、') }}
          </div>
        </div>

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
import { computed, onMounted, ref, watch } from 'vue'
import { adminApi } from '@/lib/adminApi'
import ArtistTagInput from '@/components/submit/ArtistTagInput.vue'
import type { Artist } from '@/lib/types'

/** 投稿审核：列表 + 审核弹窗（edited_data 可编辑、待创建艺术家填 ID、通过时事务链发布） */
const TYPE_LABELS: Record<string, string> = { singer: '歌手', lyricist: '作词', composer: '作曲', arranger: '编曲' }
const GENRE_OPTIONS = ['Hip-Hop', 'Chinese Rap', 'Rock', 'Mandopop', 'Contopop', 'K-Pop', 'J-Pop', '抽象', 'Soundtrack', 'Vocaloid']
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
const albums = ref<{ id: string; name: string; year?: number | null }[]>([])
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
    const [subs, arts, als] = await Promise.all([
      adminApi.getAll('submissions', { order: 'created_at', ascending: false }),
      adminApi.getAll<Artist>('artists', { order: 'name' }),
      adminApi.getAll<{ id: string; name: string; year?: number | null }>('albums', { order: 'name' }),
    ])
    submissions.value = subs
    artists.value = arts
    albums.value = als
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
  if (!Array.isArray(edited.genres)) edited.genres = []
  if (edited.album_cover === undefined) edited.album_cover = ''
  if (edited.track === undefined) edited.track = ''
  for (const f of ARTIST_FIELDS) {
    edited[f.key].forEach((item: any) => {
      if (!item) return
      // _new 标记投稿时无 ID 的待创建艺术家（输入 ID 后仍保留在待创建清单）
      if (!item.id) item._new = true
      if (item.is_show === undefined) item.is_show = true
    })
  }
  // 投稿未带 ID，但该艺术家已入库（如审核同批上一首时刚创建）→ 按名自动绑定，
  // 免去逐首删除 tag 再从下拉重选；types 缺口由发布时的补 type 逻辑兜底。
  // 仅在库内名字唯一时自动绑——同名多人（张三a/张三b）程序无法判断，保留待创建态并出歧义警示
  for (const f of ARTIST_FIELDS) {
    edited[f.key].forEach((item: any) => {
      if (!item || item.id) return
      const hits = artists.value.filter(a => a.name === item.name)
      if (hits.length === 1) {
        item.id = hits[0].id
        item._new = false
      }
    })
  }
  review.value = { ...row, edited_data: edited }
  showReview.value = true
}

/** 专辑下拉 v-model：选项值为专辑 ID（同名专辑按年份区分展示）。
 *  值之所以用 ID 而非名称——投稿带来的专辑名与选项名相同时，选同名项不产生 change
 *  事件（值未变），导致永远绑不上 ID（红色同名警示无法消除）。改为 ID 后选中必触发变化：
 *  选中库内专辑 → 绑定 ID + 同步名称（绿色提示）；输入新名 → 置空 ID（发布时新建） */
const albumSelect = computed<string>({
  get: () => review.value?.edited_data?.album_id || review.value?.edited_data?.album || '',
  set: (val: string) => {
    const ed = review.value?.edited_data
    if (!ed) return
    const hit = albums.value.find(a => a.id === val)
    if (hit) {
      ed.album_id = hit.id
      ed.album = hit.name
    } else {
      ed.album_id = null
      ed.album = val
    }
  },
})

/** 未关联 ID 时专辑名与库内重名（警示防建重复专辑） */
const albumNameExists = computed(() => {
  if (!review.value?.edited_data?.album || review.value.edited_data.album_id) return false
  return albums.value.some(a => a.name === review.value!.edited_data.album)
})

/** 曲目号占用检测：投稿关联了库内专辑时，拉取专辑内已有歌曲的 track 对照（撞号红字提示） */
const albumTracks = ref<{ track: number | null; title: string }[]>([])
const albumTrackOccupied = computed(() => {
  const ed = review.value?.edited_data
  if (!ed?.album_id || !ed.track || !/^\d+$/.test(String(ed.track).trim())) return ''
  const t = parseInt(String(ed.track).trim(), 10)
  const hit = albumTracks.value.find(s => s.track === t)
  return hit ? `${hit.title}（track ${t}）` : ''
})

watch(() => review.value?.edited_data?.album_id, async (albumId) => {
  albumTracks.value = []
  if (!albumId) return
  try {
    const songs = await adminApi.getAll<{ track: number | null; title: string }>('songs', { eq: { album_id: albumId } })
    albumTracks.value = songs.map(s => ({ track: s.track ?? null, title: s.title }))
  } catch { /* 拉取失败仅失去撞号提示，不影响审核 */ }
}, { immediate: true })

/** 同名歧义：投稿未带 ID 且库内同名人 ≥2 → 程序无法自动判断，人工从下拉（带消歧标注）选择 */
const ambiguousArtists = computed(() => {
  const res: { name: string; entries: string[] }[] = []
  if (!review.value) return res
  for (const f of ARTIST_FIELDS) {
    for (const item of review.value.edited_data[f.key] || []) {
      if (!item || item.id) continue
      const hits = artists.value.filter(a => a.name === item.name)
      if (hits.length >= 2 && !res.some(r => r.name === item.name)) {
        res.push({ name: item.name, entries: hits.map(h => (h.disambiguation ? `${h.name}（${h.disambiguation}）` : h.name)) })
      }
    }
  }
  return res
})

// 会话内新建艺术家共享池：从审核表单各字段当前值实时派生（无 ID 即待创建），删除/填 ID 后自动出池
const sessionNewArtists = computed(() => {
  const names: string[] = []
  if (!review.value) return names
  for (const f of ARTIST_FIELDS) {
    for (const item of review.value.edited_data[f.key] || []) {
      if (item && !item.id && item.name && !names.includes(item.name)) {
        names.push(item.name)
        // 实时补 _new 标记与 is_show，保证动态进入待创建清单
        item._new = true
        item.is_show ??= true
      }
    }
  }
  return names
})

/** 收集投稿中所有待创建艺术家（无 ID 或 _new 标记；跨字段按名合并，types 取并集） */
const newArtistsList = computed(() => {
  if (!review.value) return []
  const map = new Map<string, { item: any; source: string[]; types: Set<string> }>()
  for (const f of ARTIST_FIELDS) {
    const arr = review.value.edited_data[f.key] || []
    for (const item of arr) {
      if (!item || (!item._new && item.id)) continue
      if (!map.has(item.name)) {
        item.is_show ??= true
        map.set(item.name, { item, source: [f.label], types: new Set([f.type]) })
      } else {
        map.get(item.name)!.source.push(f.label)
        map.get(item.name)!.types.add(f.type)
      }
    }
  }
  return [...map.entries()].map(([, v]) => ({ item: v.item, source: v.source.join(' / '), types: [...v.types] }))
})

/** 从 contact_value（JSONB）解析邮箱（英文键 email；'邮箱' 为旧数据兼容） */
function parseEmail(row: any): string {
  const cv = row.contact_value
  try {
    const obj = typeof cv === 'string' ? JSON.parse(cv || '{}') : (cv || {})
    return obj['email'] || obj['邮箱'] || ''
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

    // 4. 插入新建艺术家并回填 ID；已有艺术家缺当前字段类型 → array_append 补上
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
    // 已有艺术家被用于新字段类型（如歌手兼作词）→ 补 type（幂等，已含则跳过）。
    // 同一艺术家跨字段出现时用本地缓存累计，避免后一次 update 覆盖前一次刚补的类型
    const typeCache = new Map<string, string[]>()
    for (const f of ARTIST_FIELDS) {
      for (const item of sd[f.key] || []) {
        if (!item?.id) continue
        let types = typeCache.get(item.id)
        if (!types) {
          // 只处理库内已有的（本会话新建的上面 insert 已带全类型并集）
          const exists = artists.value.find(a => a.id === item.id)
          if (!exists) continue
          types = [...(exists.types || ['singer'])]
          typeCache.set(item.id, types)
        }
        if (!types.includes(f.type)) {
          types.push(f.type)
          await adminApi.update('artists', item.id, { types })
        }
      }
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
        year: sd.year ? (parseInt(sd.year) || null) : null,
        cover: sd.album_cover || '',
      })
    } else if (albumId && sd.album_cover) {
      // 如果是已有专辑且填写了封面，更新专辑封面
      await adminApi.update('albums', albumId, { cover: sd.album_cover })
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
      track: sd.track ? (parseInt(String(sd.track), 10) || null) : null,
      lrc_text: sd.lrc_text,
      video_url: sd.video_url || null,
      status: 'published',
      contributor_id: contributorId,
      genres: sd.genres || [],
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
