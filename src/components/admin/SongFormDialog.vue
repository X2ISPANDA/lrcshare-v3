<template>
  <el-dialog v-model="visible" :title="editing ? '编辑歌曲' : title" width="880px" :close-on-click-modal="false">
    <el-form :model="form" label-width="84px">
      <!-- 投稿信息区块（审核模式）：提交人/时间/备注/同名警示/TTML 原文 -->
      <div v-if="mode === 'review' && submissionInfo" class="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-1.5 text-sm">
        <div class="flex flex-wrap gap-x-6 gap-y-1">
          <span v-if="submissionInfo.submitter"><span class="text-gray-500">提交人：</span>{{ submissionInfo.submitter }}</span>
          <span v-if="submissionInfo.contact"><span class="text-gray-500">联系方式：</span>{{ submissionInfo.contact }}</span>
          <span v-if="submissionInfo.time"><span class="text-gray-500">时间：</span>{{ submissionInfo.time }}</span>
        </div>
        <div v-if="submissionInfo.note" class="text-gray-600 break-all">{{ submissionInfo.note }}</div>
        <div v-if="submissionInfo.duplicateWarn" class="text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{{ submissionInfo.duplicateWarn }}</div>
        <details v-if="submissionInfo.ttmlText" class="text-xs">
          <summary class="cursor-pointer text-blue-600 select-none">查看 TTML 原文</summary>
          <pre class="mt-1 max-h-56 overflow-y-auto bg-white border border-gray-200 rounded p-2 whitespace-pre-wrap font-mono text-[11px]">{{ submissionInfo.ttmlText }}</pre>
        </details>
      </div>
      <el-row :gutter="16">
        <el-col :span="12"><el-form-item label="歌曲名" required><el-input v-model="form.title" placeholder="歌曲标题" /></el-form-item></el-col>
        <el-col :span="6"><el-form-item label="时长"><el-input v-model="form.duration" placeholder="03:30" /></el-form-item></el-col>
        <el-col :span="6"><el-form-item label="曲目号"><el-input-number v-model="form.track" :min="0" class="!w-full" /></el-form-item></el-col>
      </el-row>

      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="别名">
            <el-select v-model="form.aliases" multiple filterable allow-create default-first-option clearable placeholder="别名/译名（回车添加，参与搜索）" class="w-full">
              <el-option v-for="a in form.aliases" :key="a" :label="a" :value="a" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="歌手" required>
            <ArtistTagInput v-model="form.artists" :artists="artists" filter-type="singer" admin @artist-saved="onArtistSaved" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="专辑" :required="requireAlbum">
            <div class="relative w-full">
              <input
                v-model="form.albumName"
                class="w-full min-h-[42px] px-3 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-pink-500"
                :placeholder="requireAlbum ? '搜索已有专辑，或输入新专辑名' : '选填：搜索已有专辑，或输入新专辑名'"
                @input="onAlbumInput"
                @focus="form.albumName && onAlbumInput()"
                @blur="albumDropdownOpen = false"
              />
              <div v-if="albumDropdownOpen && albumDropdown.length" class="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
                <div
                  v-for="a in albumDropdown"
                  :key="a.id"
                  class="px-4 py-2 hover:bg-pink-50 cursor-pointer border-b border-gray-100 text-sm"
                  @mousedown.prevent="selectAlbum(a)"
                >
                  <span class="font-medium text-gray-800">{{ a.name }}</span>
                  <span v-if="a.year" class="text-xs text-gray-400 ml-2">{{ a.year }}</span>
                </div>
              </div>
            </div>
            <!-- 专辑信息卡片（与单曲审核同款）：点击打开 AlbumInfoDialog，保存即入库/写回 -->
            <button
              v-if="form.albumName.trim()"
              type="button"
              class="w-full mt-1.5 flex items-center gap-2 p-1.5 rounded-lg border border-gray-200 hover:border-pink-300 hover:bg-pink-50/50 transition text-left"
              @click="openAlbumInfo"
            >
              <img v-if="albumCoverOfForm" :src="albumCoverOfForm" class="w-8 h-8 rounded object-cover flex-shrink-0" />
              <span v-else class="w-8 h-8 rounded bg-gray-200 text-gray-500 flex items-center justify-center flex-shrink-0 text-sm">💿</span>
              <span class="min-w-0 flex-1">
                <span class="block text-xs text-gray-700 truncate">{{ form.albumName }}</span>
                <span class="block text-[11px] text-gray-400">点击{{ form.albumId ? '查看 / 更新专辑信息（保存即写回库）' : '补全专辑信息（保存即入库）' }}（封面 / 年份 / 简介）</span>
              </span>
              <el-tag v-if="form.albumId" size="small" type="success" class="shrink-0">已关联</el-tag>
              <el-tag v-else size="small" type="warning" class="shrink-0">新建</el-tag>
            </button>
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="16">
        <el-col :span="16">
          <el-form-item label="专辑艺术家">
            <div class="w-full">
              <ArtistTagInput v-model="form.albumArtists" :artists="artists" tone="gray" admin @artist-saved="onArtistSaved" />
              <div class="text-xs text-gray-400 mt-1">如唱片公司、音乐平台等；选择已有专辑时自动填充</div>
            </div>
          </el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="年份">
            <el-input v-model="form.year" placeholder="2024" maxlength="4" />
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="8">
        <el-col :span="8">
          <el-form-item label="作词"><ArtistTagInput v-model="form.lyricists" :artists="artists" filter-type="lyricist" admin @artist-saved="onArtistSaved" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="作曲"><ArtistTagInput v-model="form.composers" :artists="artists" filter-type="composer" admin @artist-saved="onArtistSaved" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="编曲"><ArtistTagInput v-model="form.arrangers" :artists="artists" filter-type="arranger" admin @artist-saved="onArtistSaved" /></el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="16">
        <el-col v-if="!hideContributor" :span="12">
          <el-form-item label="贡献者">
            <el-select v-model="form.contributor_id" filterable clearable placeholder="歌词提交者（选填）" class="w-full">
              <el-option v-for="c in contributors" :key="c.id" :label="c.name + '（' + (c.tags?.join(', ') || '歌词贡献') + '）'" :value="c.id" />
            </el-select>
          </el-form-item>
        </el-col>
        <el-col :span="hideContributor ? 24 : 12">
          <el-form-item label="风格">
            <el-select v-model="form.genres" multiple filterable allow-create clearable default-first-option placeholder="选择或输入风格标签" class="w-full">
              <el-option v-for="g in GENRE_OPTIONS" :key="g" :label="g" :value="g" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item label="视频链接">
        <el-input v-model="form.video_url" placeholder="B站 / YouTube 链接（选填）" />
      </el-form-item>

      <el-form-item label="歌曲简介">
        <div class="w-full">
          <div class="flex gap-1 mb-1.5 flex-wrap">
            <el-button v-for="(icon, type) in TIP_ICONS" :key="type" size="small" @click="insertTip(type)">{{ icon }}</el-button>
          </div>
          <el-input v-model="form.description" type="textarea" :rows="2" placeholder="Markdown 格式，选填。上方按钮插入提示框标签" />
        </div>
      </el-form-item>
      <div v-if="form.description" class="mx-0 mb-3 ml-[84px] p-3 border border-gray-200 rounded bg-gray-50 max-h-40 overflow-y-auto text-sm" v-html="descPreview"></div>

      <el-form-item v-if="requireLyrics" label="歌词" required>
        <el-tabs v-model="lyricsTab" type="card" class="w-full">
          <el-tab-pane label="LRC 歌词" name="lrc">
            <el-input v-model="form.lrc_text" type="textarea" :rows="8" placeholder="粘贴完整的 LRC 格式歌词..." class="font-mono!" />
            <div class="text-xs text-gray-400 mt-1">双语混排（同时间戳两行）粘贴后由系统自动拆分为多语言版本；编辑已有歌曲也可切到「多语言版本」精细管理。</div>
          </el-tab-pane>
          <el-tab-pane label="多语言版本" name="versions">
            <div class="space-y-3">
              <div v-if="!editing" class="text-xs text-amber-500 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                新增歌曲请先在「LRC 歌词」粘贴整体歌词（保存后自动拆分）；本 tab 用于编辑已有歌曲的多语言版本。
              </div>
              <LyricVersionsEditor v-model="versionForms" show-format :add-disabled="!editing" />
              <div class="text-xs text-gray-400">每个版本独立维护语言与类型；保存后自动合成回「LRC 歌词」。</div>
            </div>
          </el-tab-pane>
          <el-tab-pane label="文本歌词 (Markdown/HTML)" name="text">
            <RichTextToolbar :text="form.lyrics_text" :textarea-ref="lyricsTextRef" @update:text="v => form.lyrics_text = v" />
            <div class="flex gap-2">
              <el-input v-model="form.lyrics_text" ref="lyricsTextRef" type="textarea" :rows="10" placeholder="Markdown 或 HTML 格式文本歌词（支持混写：**加粗**、> 引用、工具栏按钮生成的 HTML 标注）" class="flex-1 font-mono! text-[13px]!" />
              <RichContentView :html="lyricsPreview" class="flex-1 border border-gray-200 rounded p-3 overflow-y-auto max-h-72 text-sm" content-class="rich-lyrics" />
            </div>
          </el-tab-pane>
        </el-tabs>
      </el-form-item>

      <el-form-item label="隐藏设置">
        <div class="flex flex-col gap-2 w-full">
          <div class="flex items-center gap-3">
            <el-switch v-model="form.is_hidden" active-text="隐藏" inactive-text="公开" />
            <span class="text-xs text-gray-400">开启后歌词上锁，需口令解锁查看；歌曲仍出现在各列表中</span>
          </div>
          <el-input v-model="form.unlock_code" placeholder="独立解锁口令（留空则使用全局口令）" />
          <div v-if="form.unlock_code.trim() && !form.is_hidden" class="text-xs text-amber-500">
            未开启隐藏开关，口令暂不生效（已保存，开启后直接使用）
          </div>
        </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button v-if="mode === 'review'" type="danger" plain :disabled="saving" @click="emit('reject')">❌ 拒绝</el-button>
      <el-button type="success" :loading="saving" @click="save">
        {{ mode === 'review' ? '✅ 通过发布' : '保存' }}
      </el-button>
    </template>

    <!-- 专辑信息共用弹窗（保存即入库/写回，与单曲审核同款） -->
    <AlbumInfoDialog
      v-model="showAlbumInfo"
      :artists="artists"
      :album-id="form.albumId || null"
      :album-name="form.albumName"
      :album-artists="form.albumArtists"
      :cover="albumCoverOfForm"
      :year="form.year"
      :description="albumDescOfForm"
      @artist-saved="onArtistSaved"
      @saved="onAlbumInfoSaved"
    />
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { marked } from 'marked'
import { mdToHtml } from '@/lib/markdown'
import { recomputeArtistTypes } from '@/lib/artistTypes'
import { syncSongContributors, syncSongSecrets } from '@/lib/contribRelations'
import { adminApi } from '@/lib/adminApi'
import ArtistTagInput from '@/components/submit/ArtistTagInput.vue'
import AlbumInfoDialog from '@/components/admin/AlbumInfoDialog.vue'
import RichTextToolbar from '@/components/admin/RichTextToolbar.vue'
import RichContentView from '@/components/common/RichContentView.vue'
import LyricVersionsEditor, { type LyricVersionForm } from '@/components/common/LyricVersionsEditor.vue'
import { GENRE_OPTIONS, TIP_ICONS } from '@/lib/constants'
import { loadLyricLines, groupVersions, rowsToLrcText, parseLrcToRows, parseTtmlToRows, composeMixedLrc, saveLyricLines, rebuildLyricLines, type LyricVersion } from '@/lib/lyricLines'
import type { Artist, ArtistTag, Contributor } from '@/lib/types'

/**
 * 通用歌曲表单弹窗（后台歌曲管理 / TTML Hub 新建展示 共用）。
 * 封装：歌曲字段 + 专辑联动（选已有/新建/手动编辑）+ 四类艺术家解析与自动补建
 * + 多语言版本管理 + 文本歌词预览 + 隐藏口令 + 保存事务链（建/改专辑 → 写行表 → 建/改歌 → syncContribution → recompute）。
 *
 * 差异开关（props）：
 *   requireLyrics 必需歌词——歌曲管理为 true（必填 LRC）；TTML Hub 导入为 false（TTML 由源方来，不需手填 LRC）
 *   requireAlbum   必需专辑——默认 true；TTML 导入置 false
 * 编辑对象通过 initial（歌曲对象或含 song_id 的初始数据）传入，配合 editMode 决定是否加载歌词版本/走编辑保存链。
 */

const props = withDefaults(defineProps<{
  modelValue: boolean
  artists: Artist[]
  albums: any[]
  contributors: Contributor[]
  /** 编辑时传完整歌曲对象；新建传 { title, artists, albumName, ... } 预填 */
  initial?: Partial<any> | null
  /** 编辑模式：加载该歌歌词版本、保存走 update 链 */
  editSongId?: string | null
  title?: string
  requireLyrics?: boolean
  requireAlbum?: boolean
  /** 隐藏贡献者下拉（TTML Hub 导入用：无站内贡献者概念） */
  hideContributor?: boolean
  /** save=保存写库（歌曲管理/TTML Hub）；review=只回填数据 emit 给父级走发布链路（投稿审核用） */
  mode?: 'save' | 'review'
  /** 投稿信息区块（review 模式用）：提交人/联系方式/时间/备注/同名警示，null 则不渲染 */
  submissionInfo?: {
    submitter?: string
    contact?: string
    time?: string
    note?: string
    duplicateWarn?: string
    ttmlText?: string
  } | null
}>(), {
  initial: null,
  editSongId: null,
  title: '新增歌曲',
  requireLyrics: true,
  requireAlbum: true,
  hideContributor: false,
  mode: 'save',
  submissionInfo: null,
})

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'saved', payload: any): void
  (e: 'reject'): void
  /** review 模式：通过发布前把表单数据回填给父级（结构同 edited_data），父级自行发布 */
  (e: 'review-data', data: any): void
}>()

const visible = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v),
})

const editing = computed(() => !!props.editSongId)
const saving = ref(false)
const lyricsTab = ref('lrc')
const lyricsTextRef = ref<any>(null)
const albumDropdownOpen = ref(false)

const artistMap = computed(() => new Map(props.artists.map(a => [a.id, a])))
const albumMap = computed(() => new Map(props.albums.map(a => [a.id, a])))

const form = reactive({
  title: '',
  aliases: [] as string[],
  duration: '',
  track: 0,
  artists: [] as ArtistTag[],
  albumId: '' as string | null,
  albumName: '',
  albumArtists: [] as ArtistTag[],
  year: '',
  lyricists: [] as ArtistTag[],
  composers: [] as ArtistTag[],
  arrangers: [] as ArtistTag[],
  contributor_id: '' as string | null,
  genres: [] as string[],
  video_url: '',
  description: '',
  lrc_text: '',
  lyrics_text: '',
  is_hidden: false,
  unlock_code: '',
})

// ===== 多语言版本管理 =====
const versionForms = ref<LyricVersionForm[]>([])
const versionsDirty = ref(false)
let suppressDirty = false
function setVersionForms(v: LyricVersionForm[]) {
  suppressDirty = true
  versionForms.value = v
  nextTick(() => {
    suppressDirty = false
    versionsDirty.value = false
  })
}
watch(versionForms, () => {
  if (!suppressDirty) versionsDirty.value = true
}, { deep: true })

async function loadVersions(songId: string) {
  try {
    const rows = await loadLyricLines(songId)
    const vers = groupVersions(rows)
    setVersionForms(vers.map(v => ({ lang: v.lang, kind: v.kind, format: 'lrc' as const, lrc: rowsToLrcText(v.rows) })))
  } catch (e: any) {
    setVersionForms([])
    console.warn('[歌词版本加载失败]', songId, e?.message)
  }
}

/** 逗号分隔的 ID 串 → {id, name}[]（找不到的 id 原样保留显示） */
function idsToTags(str: string | null | undefined): { id: string; name: string }[] {
  return (str || '').split(',').map(s => s.trim()).filter(Boolean).map(id => ({ id, name: artistMap.value.get(id)?.name || id }))
}

/** 打开时按 initial 初始化；编辑模式额外加载歌词版本 */
onMounted(() => watch(() => props.modelValue, (open) => {
  if (!open) return
  resetForm()
}))

function resetForm() {
  editingBasedInit()
  lyricsTab.value = 'lrc'
  setVersionForms([])
  if (props.editSongId) loadVersions(props.editSongId)
  // review 模式（投稿审核）：无库内 songId，投稿自带的多语言版本直接预填
  else if (props.mode === 'review' && Array.isArray((props.initial as any)?.versions)) {
    setVersionForms((props.initial as any).versions.map((v: any) => ({
      lang: v.lang, kind: v.kind, format: 'lrc' as const, lrc: v.lrc,
    })))
  }
}

/** 依据 props.initial 填充表单（编辑=整歌对象；新建=预填片段） */
function editingBasedInit() {
  const init = props.initial
  if (!init) {
    Object.assign(form, baseEmpty())
    return
  }
  const album = init.album_id ? albumMap.value.get(init.album_id) : null
  Object.assign(form, {
    title: init.title || '',
    aliases: [...(init.aliases || [])],
    duration: init.duration || '',
    track: init.track || 0,
    // 编辑：artist_ids 来自 songs 行；新建预填：initial.artists 直接是 tag 数组
    artists: init.artist_ids?.length
      ? init.artist_ids.map((id: string) => ({ id, name: artistMap.value.get(id)?.name || id }))
      : (init.artists || []).map((t: any) => (typeof t === 'string' ? { id: null, name: t } : t)),
    albumId: init.album_id || '',
    albumName: album?.name || init.albumName || '',
    albumArtists: album?.artist_ids?.length
      ? album.artist_ids.map((id: string) => ({ id, name: artistMap.value.get(id)?.name || id }))
      : (init.albumArtists || []),
    year: album?.year ? String(album.year) : (init.year || ''),
    lyricists: init.lyricists?.length ? init.lyricists : idsToTags(init.lyricist),
    composers: init.composers?.length ? init.composers : idsToTags(init.composer),
    arrangers: init.arrangers?.length ? init.arrangers : idsToTags(init.arranger),
    contributor_id: init.contributor_id || '',
    genres: [...(init.genres || [])],
    video_url: init.video_url || '',
    description: init.description || '',
    lrc_text: init.lrc_text || '',
    lyrics_text: init.lyrics_text || '',
    is_hidden: !!init.is_hidden,
    unlock_code: init.unlock_code || '',
  })
}

function baseEmpty() {
  return {
    title: '', aliases: [], duration: '', track: 0, artists: [], albumId: '', albumName: '', albumArtists: [], year: '',
    lyricists: [], composers: [], arrangers: [], contributor_id: '', genres: [], video_url: '', description: '',
    lrc_text: '', lyrics_text: '', is_hidden: false, unlock_code: '',
  }
}

const albumDropdown = ref<any[]>([])
function onAlbumInput() {
  // 手动改字 = 解绑当前专辑（改回原名/从下拉重选可恢复关联）
  if (form.albumId) {
    const cur = props.albums.find(a => a.id === form.albumId)
    if (cur && cur.name !== form.albumName) form.albumId = ''
  }
  const q = form.albumName.trim().toLowerCase()
  if (!q) {
    albumDropdown.value = []
    albumDropdownOpen.value = false
    return
  }
  albumDropdown.value = props.albums.filter(a => a.name?.toLowerCase().includes(q)).slice(0, 8)
  albumDropdownOpen.value = true
}

function selectAlbum(a: any) {
  form.albumId = a.id
  form.albumName = a.name
  form.year = a.year ? String(a.year) : ''
  form.albumArtists = (a.artist_ids || []).map((id: string) => ({ id, name: artistMap.value.get(id)?.name || id }))
  albumDropdownOpen.value = false
}

// ============ 专辑信息共用弹窗（保存即入库/写回，与单曲审核同款） ============
const showAlbumInfo = ref(false)
const albumCoverOfForm = computed(() => albumMap.value.get(form.albumId || '')?.cover || '')
const albumDescOfForm = computed(() => albumMap.value.get(form.albumId || '')?.description || '')
function openAlbumInfo() {
  if (!form.albumName.trim()) {
    ElMessage.warning('请先填写专辑名')
    return
  }
  showAlbumInfo.value = true
}
/** 保存成功 → 回填表单（关联 id/年份）+ 更新本地专辑池（搜索下拉即时刷新） */
function onAlbumInfoSaved(p: { albumId: string; name: string; year: number | null; cover: string; description: string | null; artistIds: string[] }) {
  form.albumId = p.albumId
  form.albumName = p.name
  form.year = p.year ? String(p.year) : ''
  const row = props.albums.find(a => a.id === p.albumId)
  if (row) {
    row.name = p.name
    row.year = p.year
    row.cover = p.cover
    row.description = p.description
    row.artist_ids = p.artistIds
  } else {
    props.albums.push({ id: p.albumId, name: p.name, year: p.year, cover: p.cover, description: p.description, artist_ids: p.artistIds } as any)
  }
}

// ============ 简介 tip 插入与预览 ============
const lyricsPreview = computed(() =>
  form.lyrics_text ? mdToHtml(form.lyrics_text) : '<span style="color:#c0c4cc">预览区</span>')

const descPreview = computed(() => {
  const text = form.description
  if (!text) return ''
  const processed = text.replace(/\{%\s*tip\s+(\w+)\s*%\}([\s\S]*?)\{%\s*endtip\s*%\}/g, (_m, type, content) => {
    const icon = TIP_ICONS[type] || '💡'
    return `<div style="border:1px solid #fed7aa;background:#fff7ed;border-radius:6px;padding:8px 12px;margin:8px 0;display:flex;gap:8px;color:#9a3412;font-size:13px;"><span style="font-size:16px;">${icon}</span><div>${marked.parse(content.trim(), { async: false })}</div></div>`
  })
  return marked.parse(processed, { async: false }) as string
})

function insertTip(type: string) {
  form.description += `\n{% tip ${type} %}在此输入提示内容{% endtip %}\n`
}

// ============ 保存 ============
async function resolveArtists(tags: ArtistTag[], type: string): Promise<string[]> {
  const ids: string[] = []
  for (const t of tags) {
    if (t.id && !t._new) {
      const exist = artistMap.value.get(t.id)
      if (exist && type !== 'album' && !(exist.types || []).includes(type) && type !== 'singer') {
        const types = [...(exist.types || []), type]
        await adminApi.update('artists', exist.id, { types })
        exist.types = types
      }
      ids.push(t.id)
    } else {
      const created = await adminApi.insert('artists', {
        id: t.id,
        name: t.name,
        types: t.types?.length ? t.types : (type === 'album' ? [] : [type]),
        is_show: t.is_show !== false,
        sort: 0,
        bio: t.bio || '',
        avatar: t.avatar || '',
        aliases: t.aliases || [],
        disambiguation: t.disambiguation || '',
        urls: t.urls || {},
      })
      ids.push(created?.id || String(t.id))
      t._new = false
    }
  }
  return ids
}

function missingNewIds(): string[] {
  const all = [...form.artists, ...form.albumArtists, ...form.lyricists, ...form.composers, ...form.arrangers]
  return all.filter(t => !t.id || t._new).filter(t => !t.id || !String(t.id).trim()).map(t => t.name)
}

/** 内联表单保存老艺术家 → 同步本地池（ArtistTagInput 内部调用） */
function onArtistSaved(tag: ArtistTag) {
  const a = props.artists.find(x => x.id === tag.id)
  if (a) {
    a.avatar = tag.avatar || null
    a.types = tag.types || []
    a.disambiguation = tag.disambiguation || null
    a.aliases = tag.aliases || []
    a.bio = tag.bio || ''
    a.urls = tag.urls || {}
  } else {
    // 新建艺术家保存即入库：加入本地艺术家池，供其它字段下拉立即可搜到/复用
    props.artists.push({
      id: tag.id!,
      name: tag.name,
      avatar: tag.avatar ?? null,
      types: tag.types ?? [],
      disambiguation: tag.disambiguation ?? null,
      aliases: tag.aliases ?? [],
      bio: tag.bio ?? '',
      urls: tag.urls ?? {},
      sort: 0,
    } as Artist)
  }
}

async function save() {
  if (!form.title.trim() || !form.artists.length) {
    ElMessage.warning('请填写必填字段：歌曲名、歌手')
    return
  }
  if (props.requireAlbum && !form.albumName.trim()) {
    ElMessage.warning('请填写必填字段：专辑（或关闭专辑必填后留空）')
    return
  }
  // 专辑保存即入库：填了专辑名但未入库（未点卡片保存/搜索未选）时兜底阻断，避免歌挂空专辑
  if (form.albumName.trim() && !form.albumId) {
    const hit = props.albums.find(a => a.name.toLowerCase() === form.albumName.trim().toLowerCase())
    if (hit) {
      form.albumId = hit.id
    } else {
      ElMessage.warning('专辑「' + form.albumName.trim() + '」尚未入库：请点击专辑信息卡片填写并保存，或从搜索下拉选择已有专辑')
      return
    }
  }
  if (props.requireLyrics && !form.lrc_text.trim()) {
    ElMessage.warning('请填写必填字段：LRC 歌词')
    return
  }
  const missing = missingNewIds()
  if (missing.length) {
    ElMessage.error(`有 ${missing.length} 位新建艺术家未填写 ID（${missing.join('、')}），请点击其头像补全`)
    return
  }

  // ===== review 模式：只回填表单数据（结构同投稿 edited_data），由父级走发布链路 =====
  if (props.mode === 'review') {
    emit('review-data', {
      title: form.title.trim(),
      aliases: form.aliases.map(a => a.trim()).filter(Boolean),
      artists: form.artists,
      album: form.albumName.trim(),
      album_id: form.albumId || null,
      album_artists: form.albumArtists,
      album_cover: albumMap.value.get(form.albumId || '')?.cover || '',
      year: form.year,
      album_desc: albumMap.value.get(form.albumId || '')?.description || '',
      duration: form.duration.trim(),
      track: form.track ? String(form.track) : '',
      lyricist_arr: form.lyricists,
      composer_arr: form.composers,
      arranger_arr: form.arrangers,
      genres: form.genres,
      video_url: form.video_url.trim(),
      description: form.description || null,
      lrc_text: form.lrc_text.trim(),
      lyrics_text: form.lyrics_text || null,
      versions: versionForms.value.map(v => ({ lang: v.lang, kind: v.kind, lrc: v.lrc })),
      is_hidden: !!form.is_hidden,
      unlock_code: form.unlock_code.trim(),
    })
    return
  }
  saving.value = true
  try {
    const [artistIds, lyricistIds, composerIds, arrangerIds, albumArtistIds] = await Promise.all([
      resolveArtists(form.artists, 'singer'),
      resolveArtists(form.lyricists, 'lyricist'),
      resolveArtists(form.composers, 'composer'),
      resolveArtists(form.arrangers, 'arranger'),
      resolveArtists(form.albumArtists, 'album'),
    ])

    // 专辑由 AlbumInfoDialog 保存即入库/写回；这里只取表单关联的 albumId 绑定到歌
    const albumId = form.albumId || null

    let finalLrcText = form.lrc_text.trim()
    if (versionsDirty.value && editing.value) {
      const versions: LyricVersion[] = versionForms.value
        .filter(v => v.lrc.trim())
        .map(v => ({
          lang: v.lang?.trim() || 'zh',
          kind: v.kind,
          rows: v.format === 'ttml' ? parseTtmlToRows(v.lrc) : parseLrcToRows(v.lrc),
        }))
      await saveLyricLines(props.editSongId!, versions)
      finalLrcText = composeMixedLrc(versions, 'line')
    }

    const payload: Record<string, unknown> = {
      title: form.title.trim(),
      aliases: form.aliases.map(a => a.trim()).filter(Boolean),
      album_id: albumId,
      duration: form.duration.trim(),
      track: form.track || 0,
      lrc_text: finalLrcText,
      lyrics_text: form.lyrics_text || null,
      video_url: form.video_url.trim() || null,
      description: form.description || null,
      genres: form.genres,
      contributor_id: form.contributor_id || null,
      is_hidden: !!form.is_hidden,
    }

    if (editing.value) {
      const id = props.editSongId!
      await adminApi.update('songs', id, payload)
      // 歌词行表：版本管理脏 → 上面已写行表；否则整体 lrc_text 改动后重拆（触发器仅 INSERT，不会自动重拆 UPDATE）
      if (!versionsDirty.value) await rebuildLyricLines(id)
      await syncSongSecrets(id, form.unlock_code.trim())
      await syncSongContributors(id, {
        singer: artistIds, lyricist: lyricistIds, composer: composerIds, arranger: arrangerIds,
      })
      // 编辑牵涉的艺术家（新旧值都算）→ 重算 types（角色变化/移除后清掉失去支撑的类型）
      const oldInit = props.initial
      const affected = new Set<string>()
      const oldIdsOf = (v: string | null) => String(v || '').split(',').map(x => x.trim()).filter(Boolean)
      ;(oldInit?.artist_ids || []).forEach((i: string) => affected.add(i))
      oldIdsOf(oldInit?.lyricist).forEach(i => affected.add(i))
      oldIdsOf(oldInit?.composer).forEach(i => affected.add(i))
      oldIdsOf(oldInit?.arranger).forEach(i => affected.add(i))
      ;(albumMap.value.get(oldInit?.album_id)?.artist_ids || []).forEach((i: string) => affected.add(i))
      ;(albumMap.value.get(albumId)?.artist_ids || []).forEach((i: string) => affected.add(i))
      ;[...artistIds, ...lyricistIds, ...composerIds, ...arrangerIds].forEach(i => affected.add(i))
      await recomputeArtistTypes([...affected])
      ElMessage.success('保存成功')
      emit('saved', { id, ...payload })
    } else {
      payload.id = 's' + Date.now()
      payload.status = 'published'
      await adminApi.insert('songs', payload)
      await syncSongSecrets(payload.id as string, form.unlock_code.trim())
      await syncSongContributors(payload.id as string, {
        singer: artistIds, lyricist: lyricistIds, composer: composerIds, arranger: arrangerIds,
      })
      // 新增只补类型不减（与发布链一致），走重算同样正确
      await recomputeArtistTypes([...artistIds, ...lyricistIds, ...composerIds, ...arrangerIds, ...albumArtistIds])
      ElMessage.success('新增歌曲成功')
      emit('saved', { id: payload.id, ...payload })
    }
    visible.value = false
  } catch (e: any) {
    ElMessage.error('保存失败：' + (e?.message || e))
  } finally {
    saving.value = false
  }
}
</script>