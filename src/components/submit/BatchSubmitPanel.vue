<template>
  <div class="space-y-8">
    <!-- ===== 第一步：本批公共信息（默认值，特殊单曲在列表中可覆盖） ===== -->
    <div>
      <h3 class="text-base font-semibold text-gray-700 mb-1">① 本批公共信息</h3>
      <p class="text-xs text-gray-400 mb-4">这批大部分歌曲相同的字段：在这里预设，提交时应用到所有未单独覆盖的行；某首不同的，在列表 ▶ 展开里单独改</p>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">歌手 <span class="text-red-500">*</span></label>
          <ArtistTagInput v-model="common.artists" :artists="artists" :session-names="sessionNewNames" filter-type="singer" />
        </div>

        <div class="flex gap-3 items-start">
          <div class="relative flex-1">
            <label class="block text-sm font-medium text-gray-700 mb-1">专辑 <span class="text-red-500">*</span></label>
            <input
              v-model="albumName"
              type="text"
              class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
              placeholder="搜索已有专辑，或直接输入新专辑名"
              @input="onAlbumInput"
              @focus="albumName && onAlbumInput()"
              @blur="albumDropdownOpen = false"
            />
            <div
              v-if="albumDropdownOpen && albumDropdown.length"
              class="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto"
            >
              <div
                v-for="a in albumDropdown"
                :key="a.id"
                class="px-4 py-2 hover:bg-pink-50 cursor-pointer border-b border-gray-100"
                @mousedown.prevent="selectAlbum(a)"
              >
                <div class="text-sm font-medium text-gray-800">{{ a.name }}</div>
                <div v-if="a.year" class="text-xs text-gray-500">{{ a.year }}</div>
              </div>
            </div>
            <div v-if="albumId" class="text-xs text-green-600 mt-1">已关联数据库专辑（审核时沿用该专辑信息）</div>
          </div>
          <div class="w-28">
            <label class="block text-sm font-medium text-gray-700 mb-1">年份</label>
            <input
              v-model="albumYear"
              type="text"
              inputmode="numeric"
              maxlength="4"
              class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
              placeholder="如 2024"
            />
          </div>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">专辑艺术家 <span class="text-xs text-gray-400 font-normal">（选填）</span></label>
          <ArtistTagInput v-model="common.albumArtists" :artists="artists" :session-names="sessionNewNames" :filter-type="null" tone="gray" />
          <div class="text-xs text-gray-400 mt-1">如唱片公司、音乐平台等，不限于歌手</div>
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">作词 <span class="text-xs text-gray-400 font-normal">（选填）</span></label>
          <ArtistTagInput v-model="common.lyricists" :artists="artists" :session-names="sessionNewNames" filter-type="lyricist" />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">作曲 <span class="text-xs text-gray-400 font-normal">（选填）</span></label>
          <ArtistTagInput v-model="common.composers" :artists="artists" :session-names="sessionNewNames" filter-type="composer" />
        </div>

        <div>
          <label class="block text-sm font-medium text-gray-700 mb-1">编曲 <span class="text-xs text-gray-400 font-normal">（选填）</span></label>
          <ArtistTagInput v-model="common.arrangers" :artists="artists" :session-names="sessionNewNames" filter-type="arranger" />
        </div>
      </div>
    </div>

    <!-- ===== 第二步：上传 LRC 文件 ===== -->
    <div>
      <h3 class="text-base font-semibold text-gray-700 mb-1">② 上传 LRC 文件</h3>
      <p class="text-xs text-gray-400 mb-4">支持多选 .lrc 文件和 .zip 压缩包（可混合、可分次追加）。歌名自动取文件内 [ti:] 标签，没有则用文件名</p>
      <input ref="fileInputRef" type="file" multiple accept=".lrc,.zip" class="hidden" @change="onFilesChosen" />
      <button
        type="button"
        :disabled="parsing"
        class="px-5 py-2.5 border-2 border-dashed border-pink-300 text-pink-600 rounded-xl hover:bg-pink-50 transition disabled:opacity-50"
        @click="fileInputRef?.click()"
      >{{ parsing ? '解析中...' : '📂 选择 LRC 文件 / ZIP 压缩包' }}</button>
    </div>

    <!-- ===== 第三步：确认列表 ===== -->
    <div v-if="rows.length">
      <div class="flex items-center justify-between mb-2">
        <h3 class="text-base font-semibold text-gray-700">③ 确认列表（{{ rows.length }} 首）</h3>
        <el-button link type="danger" size="small" @click="clearAll">清空重来</el-button>
      </div>
      <div class="text-xs text-gray-400 mb-2">歌名/曲目号/时长逐行改；▶ 展开可改歌词及该首的歌手/专辑等（与①不同时以行为准）</div>
      <el-table :data="rows" size="small" border max-height="50vh" row-key="uid">
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="px-6 py-3 space-y-3">
              <div class="text-xs text-gray-400">来源文件：{{ row.fileName }} · 以下覆盖值仅对该首生效（留空/未改动则用①公共信息）</div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div>
                  <div class="text-xs text-gray-500 mb-1">歌手（覆盖）</div>
                  <ArtistTagInput v-model="row.overrides.artists" :artists="artists" :session-names="sessionNewNames" filter-type="singer" />
                </div>
                <div>
                  <div class="text-xs text-gray-500 mb-1">专辑（覆盖：搜索已有或输入新名）</div>
                  <input
                    v-model="row.overrides.albumName"
                    type="text"
                    class="w-full px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
                    :placeholder="albumName || '默认用①公共专辑'"
                  />
                </div>
                <div>
                  <div class="text-xs text-gray-500 mb-1">专辑艺术家（覆盖）</div>
                  <ArtistTagInput v-model="row.overrides.albumArtists" :artists="artists" :session-names="sessionNewNames" :filter-type="null" tone="gray" />
                </div>
                <div>
                  <div class="text-xs text-gray-500 mb-1">作词（覆盖）</div>
                  <ArtistTagInput v-model="row.overrides.lyricists" :artists="artists" :session-names="sessionNewNames" filter-type="lyricist" />
                </div>
                <div>
                  <div class="text-xs text-gray-500 mb-1">作曲（覆盖）</div>
                  <ArtistTagInput v-model="row.overrides.composers" :artists="artists" :session-names="sessionNewNames" filter-type="composer" />
                </div>
                <div>
                  <div class="text-xs text-gray-500 mb-1">编曲（覆盖）</div>
                  <ArtistTagInput v-model="row.overrides.arrangers" :artists="artists" :session-names="sessionNewNames" filter-type="arranger" />
                </div>
                <div>
                  <div class="text-xs text-gray-500 mb-1">视频链接（该首）</div>
                  <el-input v-model="row.overrides.videoUrl" size="small" placeholder="https://...（选填）" />
                </div>
              </div>
              <div>
                <div class="text-xs text-gray-500 mb-1">歌词（LRC 全文，可直接修改）</div>
                <el-input v-model="row.lrcText" type="textarea" :autosize="{ minRows: 8, maxRows: 24 }" class="font-mono" />
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="歌手" min-width="110">
          <template #default="{ row }">
            <span v-if="row.overrides.artists.length" class="text-xs text-amber-600">{{ row.overrides.artists.map((a: any) => a.name).join(' / ') }}</span>
            <span v-else class="text-xs text-gray-600">{{ common.artists.map(a => a.name).join(' / ') || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="专辑" min-width="110">
          <template #default="{ row }">
            <span v-if="row.overrides.albumName.trim()" class="text-xs text-amber-600">{{ row.overrides.albumName.trim() }}</span>
            <span v-else class="text-xs text-gray-600">{{ albumName || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="歌名" min-width="160">
          <template #default="{ row }"><el-input v-model="row.title" size="small" placeholder="必填" /></template>
        </el-table-column>
        <el-table-column label="曲目号" width="80">
          <template #default="{ row }"><el-input v-model="row.track" size="small" placeholder="选填" /></template>
        </el-table-column>
        <el-table-column label="时长" width="90">
          <template #default="{ row }"><el-input v-model="row.duration" size="small" placeholder="03:30" /></template>
        </el-table-column>
        <el-table-column label="文件名" width="90" show-overflow-tooltip>
          <template #default="{ row }">{{ row.fileName }}</template>
        </el-table-column>
        <el-table-column label="操作" width="65" align="center">
          <template #default="{ $index }">
            <el-button link type="danger" size="small" @click="rows.splice($index, 1)">移除</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <!-- 提交 -->
    <div class="flex items-center gap-4">
      <button
        :disabled="submitting"
        class="px-8 py-3 bg-pink-500 text-white font-medium rounded-xl hover:bg-pink-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
        @click="submitAll"
      >{{ submitting ? `提交中 ${progress.done}/${rows.length}...` : `提交审核（${rows.length} 首）` }}</button>
      <span v-if="submitting" class="text-sm text-gray-500">逐首提交中，请勿关闭页面</span>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 批量投稿面板（投稿页「批量」模式）。
 * 流程与单曲投稿共享提交人信息（昵称/邮箱等由父组件管理）：
 * ① 预设本批公共字段（大部分歌曲相同的默认值：歌手/专辑/年份/专辑艺术家/词曲编）——不做任何自动绑定 ID，
 *    库内艺术家由用户手选产生 ID，新建的留空由审核创建；
 * ② 上传 LRC/ZIP，仅解析 [ti:] 作歌名（无则文件名），其余标签一律不读；
 * ③ 列表逐行确认：歌名/曲目号/时长行内改；▶ 展开可改歌词 + 覆盖该首的歌手/专辑等（覆盖值非空才生效，
 *    与公共信息不同的单曲不用分批，就地覆盖即可）；
 * ④ 逐首调 onSubmit(songData)（父组件包装 submitSubmissionV2 + 用户信息），失败继续，结束汇总。
 */
import { computed, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { unzipSync } from 'fflate'
import ArtistTagInput from './ArtistTagInput.vue'
import type { Artist, AlbumWithArtists } from '@/lib/types'

const props = defineProps<{
  artists: Artist[]
  albums: AlbumWithArtists[]
  /** 单首提交（父组件负责用户信息校验 + submitSubmissionV2 + 站长通知）；校验失败 throw VALIDATION_ABORT 中止整批 */
  onSubmit: (songData: any, batchId: string, batchSize: number) => Promise<void>
}>()
const emit = defineEmits<{ done: [count: number, summary: { album: string; batchId: string }] }>()

/** 校验中止标记：父组件校验用户信息失败时 throw，面板识别后停止循环不再弹网络错误 */
const VALIDATION_ABORT = '__VALIDATION_ABORT__'

// ---------- 公共字段 ----------
const common = reactive({
  artists: [] as { id: string | null; name: string }[],
  albumArtists: [] as { id: string | null; name: string }[],
  lyricists: [] as { id: string | null; name: string }[],
  composers: [] as { id: string | null; name: string }[],
  arrangers: [] as { id: string | null; name: string }[],
})

// 会话内新建艺术家共享池（与单曲投稿同逻辑：id 为 null 即本次新建）
const sessionNewNames = computed(() => {
  const names: string[] = []
  for (const arr of [common.artists, common.albumArtists, common.lyricists, common.composers, common.arrangers]) {
    for (const t of arr) {
      if (t.id === null && t.name && !names.includes(t.name)) names.push(t.name)
    }
  }
  return names
})

// 专辑联想（与单曲投稿同款：输入联想 + 精确同名自动关联 + 选中带出专辑艺术家/年份）
const albumName = ref('')
const albumYear = ref('')
const albumId = ref<string | null>(null)
const albumDropdown = ref<AlbumWithArtists[]>([])
const albumDropdownOpen = ref(false)

function onAlbumInput() {
  const q = albumName.value.trim().toLowerCase()
  const exact = q ? props.albums.find(a => a.name.toLowerCase() === q) : undefined
  albumId.value = exact ? exact.id : null
  if (!q) {
    albumDropdown.value = []
    albumDropdownOpen.value = false
    return
  }
  albumDropdown.value = props.albums.filter(a => a.name.toLowerCase().includes(q)).slice(0, 8)
  albumDropdownOpen.value = true
}

function selectAlbum(a: AlbumWithArtists) {
  albumName.value = a.name
  albumId.value = a.id
  albumDropdownOpen.value = false
  albumYear.value = a.year ? String(a.year) : ''
  const artistObjs = (a.artist_ids || [])
    .map(id => props.artists.find(x => x.id === id))
    .filter((x): x is Artist => !!x)
    .map(x => ({ id: x.id, name: x.name }))
  if (artistObjs.length) common.albumArtists = artistObjs
}

// ---------- 文件解析 ----------
interface BatchOverrides {
  artists: { id: string | null; name: string }[]
  albumName: string
  albumArtists: { id: string | null; name: string }[]
  lyricists: { id: string | null; name: string }[]
  composers: { id: string | null; name: string }[]
  arrangers: { id: string | null; name: string }[]
  videoUrl: string
}

interface BatchRow {
  uid: number
  title: string
  track: string
  duration: string
  lrcText: string
  fileName: string
  /** 行级覆盖：留空/空数组 = 用①公共信息 */
  overrides: BatchOverrides
}

function emptyOverrides(): BatchOverrides {
  return {
    artists: [],
    albumName: '',
    albumArtists: [],
    lyricists: [],
    composers: [],
    arrangers: [],
    videoUrl: '',
  }
}
const rows = ref<BatchRow[]>([])
const parsing = ref(false)
const fileInputRef = ref<HTMLInputElement>()
let uidSeed = 0

/** LRC 文件解码：先严格 UTF-8，失败按 GBK（常见于 Windows 记事本保存的中文 LRC），再不行宽松 UTF-8 */
function decodeLrc(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    try {
      return new TextDecoder('gbk').decode(bytes)
    } catch {
      return new TextDecoder('utf-8').decode(bytes)
    }
  }
}

/** 歌名只取 [ti:] 标签；无则用文件名（去扩展名）。其余 al/ar 等标签一律不解析——公共字段以用户预设为准 */
function extractTitle(text: string, fileName: string): string {
  const m = text.match(/^\s*\[ti:(.+?)\]/m)
  return (m ? m[1] : fileName.replace(/\.lrc$/i, '')).trim()
}

function pushRow(lrcText: string, fileName: string) {
  const text = lrcText.replace(/^\uFEFF/, '') // 去 BOM
  if (!text.trim()) return false
  rows.value.push({
    uid: ++uidSeed,
    title: extractTitle(text, fileName),
    track: '',
    duration: '',
    lrcText: text,
    fileName,
    overrides: emptyOverrides(),
  })
  return true
}

async function onFilesChosen(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files || [])
  input.value = '' // 允许再次选择同一文件（追加）
  if (!files.length) return
  parsing.value = true
  let added = 0
  let skipped = 0
  try {
    for (const f of files) {
      const buf = await f.arrayBuffer()
      if (/\.zip$/i.test(f.name)) {
        // zip：解压取所有 .lrc（跳过 __MACOSX 等杂项目录）
        let entries: Record<string, Uint8Array>
        try {
          entries = unzipSync(new Uint8Array(buf))
        } catch {
          ElMessage.error(`压缩包「${f.name}」无法解压（可能已损坏）`)
          continue
        }
        for (const [name, data] of Object.entries(entries)) {
          if (!/\.lrc$/i.test(name) || name.includes('__MACOSX') || name.startsWith('.')) continue
          const shortName = name.split('/').pop() || name
          pushRow(decodeLrc(data), shortName) ? added++ : skipped++
        }
      } else if (/\.lrc$/i.test(f.name)) {
        pushRow(decodeLrc(new Uint8Array(buf)), f.name) ? added++ : skipped++
      } else {
        skipped++
      }
    }
    if (added) ElMessage.success(`已添加 ${added} 首${skipped ? `，跳过 ${skipped} 个（非 LRC / 内容为空）` : ''}`)
    else ElMessage.warning(`没有可用的 LRC 文件${skipped ? `（跳过 ${skipped} 个）` : ''}`)
  } finally {
    parsing.value = false
  }
}

// ---------- 提交 ----------
const submitting = ref(false)
const progress = reactive({ done: 0 })
/** 当前批次 ID：首次提交生成；失败重试（列表未清空）沿用同一 ID，清空重来换新 */
let currentBatchId: string | null = null

/** 组装单首 songData：公共信息 + 行级覆盖（覆盖值非空才生效）；字段结构与单曲投稿完全一致 */
function buildSongData(row: BatchRow) {
  const ov = row.overrides
  // 行级覆盖优先；覆盖专辑名与库内精确同名时自动关联 ID（与单曲投稿同款逻辑）
  const effAlbumName = ov.albumName.trim() || albumName.value.trim()
  const effAlbumId = ov.albumName.trim()
    ? (props.albums.find(a => a.name.toLowerCase() === ov.albumName.trim().toLowerCase())?.id ?? null)
    : albumId.value
  const artists = ov.artists.length ? ov.artists : common.artists
  const albumArtists = ov.albumArtists.length ? ov.albumArtists : common.albumArtists
  const lyricists = ov.lyricists.length ? ov.lyricists : common.lyricists
  const composers = ov.composers.length ? ov.composers : common.composers
  const arrangers = ov.arrangers.length ? ov.arrangers : common.arrangers
  return {
    type: 'song',
    title: row.title.trim(),
    artists: artists.slice(),
    album_artists: albumArtists.slice(),
    lyricist_arr: lyricists.slice(),
    composer_arr: composers.slice(),
    arranger_arr: arrangers.slice(),
    album: effAlbumName,
    album_id: effAlbumId,
    year: albumYear.value.trim() || undefined,
    duration: row.duration.trim(),
    track: row.track.trim() || undefined,
    lrc_text: row.lrcText.trim(),
    video_url: ov.videoUrl.trim(),
  }
}

/** 清空重来：列表与批次 ID 一并重置（下一次提交是新的一次投稿动作） */
function clearAll() {
  rows.value = []
  currentBatchId = null
}

async function submitAll() {
  // 校验：以每行生效值（覆盖优先，缺省用公共值）为准
  if (albumYear.value.trim() && !/^\d{4}$/.test(albumYear.value.trim())) {
    ElMessage.warning('专辑年份请填写 4 位数字（如 2024），或留空')
    return
  }
  if (!rows.value.length) {
    ElMessage.warning('请先上传 LRC 文件')
    return
  }
  const noArtist = rows.value.filter(r => !(r.overrides.artists.length || common.artists.length))
  if (noArtist.length) {
    ElMessage.warning(`有 ${noArtist.length} 首没有歌手（公共信息未填且行内未覆盖），请在①填公共歌手或在行内 ▶ 展开覆盖`)
    return
  }
  const noAlbum = rows.value.filter(r => !(r.overrides.albumName.trim() || albumName.value.trim()))
  if (noAlbum.length) {
    ElMessage.warning(`有 ${noAlbum.length} 首没有专辑（公共信息未填且行内未覆盖），请在①填公共专辑或在行内 ▶ 展开覆盖`)
    return
  }
  const badTitle = rows.value.filter(r => !r.title.trim())
  if (badTitle.length) {
    ElMessage.warning(`有 ${badTitle.length} 首歌名为空，请在列表中补填（或移除）`)
    return
  }
  const badTrack = rows.value.filter(r => r.track.trim() && !/^\d+$/.test(r.track.trim()))
  if (badTrack.length) {
    ElMessage.warning(`有 ${badTrack.length} 首曲目号不是正整数，请修改或清空`)
    return
  }

  submitting.value = true
  progress.done = 0
  const failed: string[] = []
  // 批次 ID：同一批（未清空重来）沿用，保证「一次投稿动作 = 一个批次」
  if (!currentBatchId) currentBatchId = (crypto.randomUUID ? crypto.randomUUID() : 'batch_' + Date.now() + '_' + Math.random().toString(36).slice(2))
  const batchId = currentBatchId
  const batchSize = rows.value.length
  try {
    for (const row of rows.value) {
      try {
        await props.onSubmit(buildSongData(row), batchId, batchSize)
      } catch (e: any) {
        if (e?.message === VALIDATION_ABORT) throw e // 用户信息校验失败 → 整批中止
        failed.push(`「${row.title}」`)
      }
      progress.done++
    }
    const ok = rows.value.length - failed.length
    if (failed.length) {
      await ElMessageBox.alert(`成功提交 ${ok} 首，失败 ${failed.length} 首：${failed.join('、')}。失败的请稍后单独重投`, '批量提交结果', { type: 'warning' })
    }
    if (ok > 0) emit('done', ok, { album: albumName.value.trim(), batchId })
    else currentBatchId = null // 全军覆没：批次作废，下次重新生成
  } catch (e: any) {
    if (e?.message !== VALIDATION_ABORT) ElMessage.error('提交失败：' + (e?.message || e))
    // 校验中止：不丢列表，用户补完信息再点提交
  } finally {
    submitting.value = false
  }
}
</script>
