<template>
  <div class="space-y-4">
    <!-- 工具条 -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-wrap items-center gap-3 px-5 py-3">
      <el-input v-model="keyword" placeholder="搜索歌曲名 / 歌手" clearable class="w-full sm:!w-64" :prefix-icon="Search" />
      <div class="flex-1"></div>
      <el-button type="primary" @click="openNew" style="--el-button-bg-color: #ec4899; --el-button-border-color: #ec4899; --el-button-hover-bg-color: #db2777; --el-button-hover-border-color: #db2777">+ 新增歌曲</el-button>
    </div>

    <div class="bg-white rounded-xl border border-gray-100 shadow-sm">
      <AdminTable :data="pagedList" :loading="loading" row-key="id" @selection-change="selected = $event">
        <el-table-column type="selection" width="45" />
        <el-table-column label="歌曲名" min-width="170" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="font-medium text-gray-800">{{ row.title }}</span>
            <span v-if="row.aliases?.length" class="text-xs text-gray-400 ml-1">{{ row.aliases.join(' / ') }}</span>
            <el-tag v-if="row.is_hidden" size="small" type="info" class="ml-1">隐藏</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="歌手" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ namesOf(row.artist_ids) || '未知' }}</template>
        </el-table-column>
        <el-table-column label="专辑" min-width="130" show-overflow-tooltip>
          <template #default="{ row }">{{ albumMap.get(row.album_id)?.name || '—' }}</template>
        </el-table-column>
        <el-table-column label="时长" width="75">
          <template #default="{ row }">{{ row.duration || '—' }}</template>
        </el-table-column>
        <el-table-column label="贡献者" width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ contributorMap.get(row.contributor_id)?.name || '—' }}</template>
        </el-table-column>
        <el-table-column label="操作" width="170" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link size="small" @click="viewLyrics(row)">歌词</el-button>
            <el-button link type="danger" size="small" @click="removeOne(row)">删除</el-button>
          </template>
        </el-table-column>

        <!-- 移动端卡片 -->
        <template #card="{ row }">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="font-medium text-gray-800 truncate">{{ row.title }}</div>
              <div class="text-xs text-gray-400 truncate mt-0.5">
                {{ namesOf(row.artist_ids) || '未知' }}<template v-if="albumMap.get(row.album_id)?.name"> · {{ albumMap.get(row.album_id)?.name }}</template><template v-if="row.duration"> · {{ row.duration }}</template>
              </div>
              <div v-if="contributorMap.get(row.contributor_id)" class="text-xs text-gray-400 mt-0.5">贡献者：{{ contributorMap.get(row.contributor_id)?.name }}</div>
            </div>
            <el-tag v-if="row.is_hidden" size="small" type="info" class="shrink-0">隐藏</el-tag>
          </div>
          <div class="mt-2 pt-2 border-t border-gray-50 flex gap-1">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link size="small" @click="viewLyrics(row)">歌词</el-button>
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

    <!-- 歌词预览 -->
    <el-dialog v-model="showLyrics" :title="viewing?.title + ' - 歌词'" width="640px">
      <pre class="text-[13px] text-gray-600 whitespace-pre-wrap max-h-96 overflow-y-auto m-0 font-mono">{{ viewing?.lrc_text || viewing?.lyrics_text || '（无歌词）' }}</pre>
    </el-dialog>

    <!-- 新增 / 编辑弹窗 -->
    <el-dialog v-model="showDialog" :title="editing ? '编辑歌曲' : '新增歌曲'" width="880px" :close-on-click-modal="false">
      <el-form :model="form" label-width="84px">
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
            <el-form-item label="专辑" required>
              <div class="relative w-full">
                <input
                  v-model="form.albumName"
                  class="w-full min-h-[42px] px-3 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-pink-500 disabled:bg-gray-100 disabled:text-gray-500"
                  :class="{ 'pr-20': !!form.albumId && !albumUnlocked }"
                  placeholder="搜索已有专辑，或输入新专辑名"
                  :disabled="!!form.albumId && !albumUnlocked"
                  @input="onAlbumInput"
                  @focus="form.albumName && onAlbumInput()"
                  @blur="albumDropdownOpen = false"
                />
                <button
                  v-if="form.albumId && !albumUnlocked"
                  type="button"
                  class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-blue-600 border border-blue-400 rounded px-2 py-0.5 hover:bg-blue-50"
                  @click="albumUnlocked = true"
                >手动编辑</button>
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
            </el-form-item>
          </el-col>
        </el-row>

        <el-row :gutter="16">
          <el-col :span="16">
            <el-form-item label="专辑艺术家">
              <div class="w-full">
                <ArtistTagInput v-model="form.albumArtists" :artists="artists" tone="gray" admin :disabled="!!form.albumId && !albumUnlocked" @artist-saved="onArtistSaved" />
                <div class="text-xs text-gray-400 mt-1">如唱片公司、音乐平台等；选择已有专辑时自动填充</div>
              </div>
            </el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="年份">
              <el-input v-model="form.year" placeholder="2024" maxlength="4" :disabled="!!form.albumId && !albumUnlocked" />
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
          <el-col :span="12">
            <el-form-item label="贡献者">
              <el-select v-model="form.contributor_id" filterable clearable placeholder="歌词提交者（选填）" class="w-full">
                <el-option v-for="c in contributors" :key="c.id" :label="c.name + '（' + (c.tags?.join(', ') || '歌词贡献') + '）'" :value="c.id" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="12">
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

        <el-form-item label="歌词" required>
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
        <el-button @click="showDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Search } from '@element-plus/icons-vue'
import { marked } from 'marked'
import { mdToHtml } from '@/lib/markdown'
import { recomputeArtistTypes } from '@/lib/artistTypes'
import { syncSongContributors, syncAlbumContributors, syncSongSecrets } from '@/lib/contribRelations'
import { adminApi } from '@/lib/adminApi'
import ArtistTagInput from '@/components/submit/ArtistTagInput.vue'
import AdminTable from '@/components/admin/AdminTable.vue'
import RichTextToolbar from '@/components/admin/RichTextToolbar.vue'
import RichContentView from '@/components/common/RichContentView.vue'
import LyricVersionsEditor, { type LyricVersionForm } from '@/components/common/LyricVersionsEditor.vue'
import { GENRE_OPTIONS, TIP_ICONS } from '@/lib/constants'
import { loadLyricLines, groupVersions, rowsToLrcText, parseLrcToRows, parseTtmlToRows, composeMixedLrc, saveLyricLines, rebuildLyricLines, type LyricVersion } from '@/lib/lyricLines'
import type { Artist, ArtistTag, Contributor } from '@/lib/types'

/** 歌曲管理：列表 + 新增/编辑（专辑锁定、艺术家自动补建、双歌词 tab、隐藏口令） */

const route = useRoute()
const songs = ref<any[]>([])
const artists = ref<Artist[]>([])
const albums = ref<any[]>([])
const contributors = ref<Contributor[]>([])
const loading = ref(false)
const keyword = ref('')
const page = ref(1)
const pageSize = ref(10)
const selected = ref<any[]>([])
const tableRef = ref()

const artistMap = computed(() => new Map(artists.value.map(a => [a.id, a])))
const albumMap = computed(() => new Map(albums.value.map(a => [a.id, a])))
const contributorMap = computed(() => new Map(contributors.value.map(c => [c.id, c])))

const filteredList = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return songs.value
  return songs.value.filter(s => {
    if (s.title?.toLowerCase().includes(kw)) return true
    if ((s.aliases || []).some((a: string) => a.toLowerCase().includes(kw))) return true
    return (s.artist_ids || []).some((id: string) => artistMap.value.get(id)?.name?.toLowerCase().includes(kw))
  })
})
const pagedList = computed(() => filteredList.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

function namesOf(ids: string[] | null): string {
  return (ids || []).map(id => artistMap.value.get(id)?.name || id).join(', ')
}

async function load() {
  loading.value = true
  try {
    const [s, a, al, c, sc, ac, sec] = await Promise.all([
      adminApi.getAll('songs', { order: 'created_at', ascending: false }),
      adminApi.getAll<Artist>('artists', { order: 'name' }),
      adminApi.getAll('albums', { order: 'name' }),
      adminApi.getAll<Contributor>('contributors', { order: 'sort' }),
      adminApi.getAll('song_contributors'),
      adminApi.getAll('album_contributors'),
      adminApi.getAll('song_secrets'),
    ])
    // 中间表 → 歌行装饰（artist_ids=歌手；lyricist/composer/arranger 由关系行拼回字符串，下游沿用旧字段名）
    const scMap = new Map<string, Record<string, string[]>>()
    for (const r of sc as any[]) {
      const e = scMap.get(r.song_id) || { singer: [], lyricist: [], composer: [], arranger: [] }
      if (e[r.role]) e[r.role].push(r.artist_id)
      scMap.set(r.song_id, e)
    }
    const acMap = new Map<string, string[]>()
    for (const r of ac as any[]) {
      const list = acMap.get(r.album_id) || []
      list.push(r.artist_id)
      acMap.set(r.album_id, list)
    }
    // 口令：song_secrets 为权威数据源（songs.unlock_code 过渡期兜底，phase3 步骤 3 删列）
    const secMap = new Map<string, string>()
    for (const r of sec as any[]) secMap.set(r.song_id, r.unlock_code || '')
    songs.value = (s as any[]).map(row => {
      const e = scMap.get(row.id)
      return {
        ...row,
        unlock_code: secMap.has(row.id) ? secMap.get(row.id)! : (row.unlock_code || ''),
        artist_ids: e?.singer || [],
        lyricist: (e?.lyricist || []).join(','),
        composer: (e?.composer || []).join(','),
        arranger: (e?.arranger || []).join(','),
      }
    })
    artists.value = a
    albums.value = (al as any[]).map(row => ({ ...row, artist_ids: acMap.get(row.id) || [] }))
    contributors.value = c
  } catch (e: any) {
    ElMessage.error('加载失败：' + e.message)
  } finally {
    loading.value = false
  }
}
onMounted(async () => {
  await load()
  // dashboard「直接发布新歌」入口
  if (route.query.new) openNew()
})

function clearSelection() {
  tableRef.value?.clearSelection()
  selected.value = []
}

// ============ 歌词预览 ============
const showLyrics = ref(false)
const viewing = ref<any>(null)
function viewLyrics(row: any) {
  viewing.value = row
  showLyrics.value = true
}

// ============ 编辑弹窗 ============
const showDialog = ref(false)
const editing = ref<any>(null)
const saving = ref(false)
const lyricsTab = ref('lrc')
const lyricsTextRef = ref<any>(null)
const albumDropdownOpen = ref(false)
const albumUnlocked = ref(false)

// ===== 多语言版本管理 =====
const versionForms = ref<LyricVersionForm[]>([])
const versionsDirty = ref(false)
const versionsLoading = ref(false)
/** 程序化赋值（加载/重置）期间抑制脏标记，nextTick 后恢复 */
let suppressDirty = false
function setVersionForms(v: LyricVersionForm[]) {
  suppressDirty = true
  versionForms.value = v
  nextTick(() => {
    suppressDirty = false
    versionsDirty.value = false
  })
}
/** 深度监听：语言/类型下拉、增删版本、文本编辑都是原地修改，不走 update:model-value */
watch(versionForms, () => {
  if (!suppressDirty) versionsDirty.value = true
}, { deep: true })
async function loadVersions(songId: string) {
  versionsLoading.value = true
  try {
    const rows = await loadLyricLines(songId)
    const vers = groupVersions(rows)
    setVersionForms(vers.map(v => ({ lang: v.lang, kind: v.kind, format: 'lrc' as const, lrc: rowsToLrcText(v.rows) })))
  } catch (e: any) {
    setVersionForms([])
    console.warn('[歌词版本加载失败]', songId, e?.message)
  } finally {
    versionsLoading.value = false
  }
}

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

/** 逗号分隔的 ID 串 → {id, name}[]（找不到的 id 原样保留显示） */
function idsToTags(str: string | null | undefined): { id: string; name: string }[] {
  return (str || '').split(',').map(s => s.trim()).filter(Boolean).map(id => ({ id, name: artistMap.value.get(id)?.name || id }))
}

function openNew() {
  editing.value = null
  Object.assign(form, {
    title: '', aliases: [], duration: '', track: 0, artists: [], albumId: '', albumName: '', albumArtists: [], year: '',
    lyricists: [], composers: [], arrangers: [], contributor_id: '', genres: [], video_url: '', description: '',
    lrc_text: '', lyrics_text: '', is_hidden: false, unlock_code: '',
  })
  albumUnlocked.value = false
  lyricsTab.value = 'lrc'
  setVersionForms([])
  showDialog.value = true
}

function openEdit(row: any) {
  editing.value = row
  const album = row.album_id ? albumMap.value.get(row.album_id) : null
  Object.assign(form, {
    title: row.title || '',
    aliases: [...(row.aliases || [])],
    duration: row.duration || '',
    track: row.track || 0,
    artists: (row.artist_ids || []).map((id: string) => ({ id, name: artistMap.value.get(id)?.name || id })),
    albumId: row.album_id || '',
    albumName: album?.name || '',
    albumArtists: (album?.artist_ids || []).map((id: string) => ({ id, name: artistMap.value.get(id)?.name || id })),
    year: album?.year ? String(album.year) : '',
    lyricists: idsToTags(row.lyricist),
    composers: idsToTags(row.composer),
    arrangers: idsToTags(row.arranger),
    contributor_id: row.contributor_id || '',
    genres: [...(row.genres || [])],
    video_url: row.video_url || '',
    description: row.description || '',
    lrc_text: row.lrc_text || '',
    lyrics_text: row.lyrics_text || '',
    is_hidden: !!row.is_hidden,
    unlock_code: row.unlock_code || '',
  })
  albumUnlocked.value = false
  lyricsTab.value = 'lrc'
  setVersionForms([])
  loadVersions(row.id)
  showDialog.value = true
}

const albumDropdown = ref<any[]>([])
function onAlbumInput() {
  // 手动改动且非解锁场景 → 视为离开已有专辑（改选/新建）
  const q = form.albumName.trim().toLowerCase()
  if (!q) {
    albumDropdown.value = []
    albumDropdownOpen.value = false
    return
  }
  albumDropdown.value = albums.value.filter(a => a.name?.toLowerCase().includes(q)).slice(0, 8)
  albumDropdownOpen.value = true
}

function selectAlbum(a: any) {
  form.albumId = a.id
  form.albumName = a.name
  form.year = a.year ? String(a.year) : ''
  form.albumArtists = (a.artist_ids || []).map((id: string) => ({ id, name: artistMap.value.get(id)?.name || id }))
  albumDropdownOpen.value = false
  albumUnlocked.value = false
}

// ============ 简介 tip 插入与预览 ============
/** 文本歌词预览：与前台 SongView 一致走 marked（md + 内嵌 HTML），breaks 开启单行换行 */
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
/** 解析 ArtistTag[]：_new/无 id 的为待创建（手填 ID，与投稿审核同体系），返回 ID 列表 */
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
        id: t.id, // 内联表单手填的 ID（保存前已校验非空）
        name: t.name,
        // 内联表单补全过的 types 优先；专辑艺术家（唱片公司等）默认无类型
        types: t.types?.length ? t.types : (type === 'album' ? [] : [type]),
        is_show: t.is_show !== false,
        sort: 0,
        bio: t.bio || '',
        avatar: t.avatar || '',
        aliases: t.aliases || [],
        disambiguation: t.disambiguation || '',
        urls: t.urls || {},
      })
      artists.value.push(created as Artist)
      // 手填 ID 在创建成功后生效（insert 返回为准，兜底用 t.id——校验已保证非空）
      ids.push(created?.id || String(t.id))
      t._new = false // 已创建，防止后续保存重复插入
    }
  }
  return ids
}

/** 待创建艺术家（_new 或无 id）未填 ID 的清单，save 前校验用 */
function missingNewIds(): string[] {
  const all = [...form.artists, ...form.albumArtists, ...form.lyricists, ...form.composers, ...form.arrangers]
  return all.filter(t => !t.id || t._new).filter(t => !t.id || !String(t.id).trim()).map(t => t.name)
}

/** 内联表单保存老艺术家（已写库）→ 同步本地艺术家池，避免下次展开/搜索仍显示旧数据 */
function onArtistSaved(tag: ArtistTag) {
  const a = artists.value.find(x => x.id === tag.id)
  if (a) {
    a.avatar = tag.avatar || null
    a.types = tag.types || []
    a.disambiguation = tag.disambiguation || null
    a.aliases = tag.aliases || []
    a.bio = tag.bio || ''
    a.urls = tag.urls || {}
  }
}

async function save() {
  if (!form.title.trim() || !form.artists.length || !form.albumName.trim() || !form.lrc_text.trim()) {
    ElMessage.warning('请填写必填字段：歌曲名、歌手、专辑、LRC 歌词')
    return
  }
  // 新建艺术家必须手填 ID（与投稿审核同约束），点击头像即可填写
  const missing = missingNewIds()
  if (missing.length) {
    ElMessage.error(`有 ${missing.length} 位新建艺术家未填写 ID（${missing.join('、')}），请点击其头像补全`)
    return
  }
  // 填了独立口令但没开隐藏：不拦截，保存后轻提示（口令留存 song_secrets，下次开开关直接生效）
  saving.value = true
  try {
    // 1. 解析四类艺术家（album 类新建的实体 types 为空）
    const [artistIds, lyricistIds, composerIds, arrangerIds, albumArtistIds] = await Promise.all([
      resolveArtists(form.artists, 'singer'),
      resolveArtists(form.lyricists, 'lyricist'),
      resolveArtists(form.composers, 'composer'),
      resolveArtists(form.arrangers, 'arranger'),
      resolveArtists(form.albumArtists, 'album'),
    ])

    // 2. 专辑：沿用（可解锁更新）/ 新建
    let albumId = form.albumId
    if (albumId) {
      const album = albumMap.value.get(albumId)
      const albumChanged =
        albumUnlocked.value &&
        (album?.name !== form.albumName.trim() ||
          (album?.artist_ids || []).join(',') !== albumArtistIds.join(',') ||
          String(album?.year || '') !== form.year.trim())
      if (albumChanged) {
        await adminApi.update('albums', albumId, {
          name: form.albumName.trim(),
          year: form.year.trim() ? parseInt(form.year.trim()) : null,
        })
        await syncAlbumContributors(albumId, albumArtistIds)
      }
    } else {
      const created = await adminApi.insert('albums', {
        id: 'al' + Date.now(),
        name: form.albumName.trim(),
        year: form.year.trim() ? parseInt(form.year.trim()) : null,
        cover: '',
      })
      albumId = created!.id
      albums.value.push({ ...created, artist_ids: albumArtistIds })
      await syncAlbumContributors(albumId, albumArtistIds)
    }

    // 歌词版本处理：版本管理脏（编辑已有歌曲）→ 写行表 + 合成 lrc_text；否则 lrc_text 权威
    // （新增走触发器自动拆行；编辑整体改动后手动 rebuild）
    let finalLrcText = form.lrc_text.trim()
    if (versionsDirty.value && editing.value) {
      const versions: LyricVersion[] = versionForms.value
        .filter(v => v.lrc.trim())
        .map(v => ({
          lang: v.lang?.trim() || 'zh',
          kind: v.kind,
          rows: v.format === 'ttml' ? parseTtmlToRows(v.lrc) : parseLrcToRows(v.lrc),
        }))
      await saveLyricLines(editing.value.id, versions)
      finalLrcText = composeMixedLrc(versions, 'line')
    }

    // 3. 歌曲记录（贡献关系只写 song_contributors 中间表，不再写旧列）
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
      // 独立口令不入 songs（phase3 已拆表 song_secrets，由下方 syncSongSecrets 单独同步）
    }

    if (editing.value) {
      await adminApi.update('songs', editing.value.id, payload)
      // 歌词行表：版本管理脏 → 上面已写行表；否则整体 lrc_text 改动后重拆（触发器仅 INSERT，不会自动重拆 UPDATE）
      if (!versionsDirty.value) {
        await rebuildLyricLines(editing.value.id)
      }
      await syncSongSecrets(editing.value.id, form.unlock_code.trim())
      // 双写中间表（全量替换，幂等）
      await syncSongContributors(editing.value.id, {
        singer: artistIds, lyricist: lyricistIds, composer: composerIds, arranger: arrangerIds,
      })
      // 编辑牵涉的艺术家（新旧值都算）→ 重算 types（角色变化/移除后清掉失去支撑的类型）
      const affected = new Set<string>()
      const oldIdsOf = (v: string | null) => String(v || '').split(',').map(x => x.trim()).filter(Boolean)
      ;(editing.value.artist_ids || []).forEach((id: string) => affected.add(id))
      oldIdsOf(editing.value.lyricist).forEach(id => affected.add(id))
      oldIdsOf(editing.value.composer).forEach(id => affected.add(id))
      oldIdsOf(editing.value.arranger).forEach(id => affected.add(id))
      ;(albumMap.value.get(editing.value.album_id)?.artist_ids || []).forEach((id: string) => affected.add(id))
      ;(albumMap.value.get(albumId)?.artist_ids || []).forEach((id: string) => affected.add(id))
      ;[...artistIds, ...lyricistIds, ...composerIds, ...arrangerIds].forEach(id => affected.add(id))
      await recomputeArtistTypes([...affected])
      ElMessage.success('保存成功')
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
    }
    showDialog.value = false
    await load()
  } catch (e: any) {
    ElMessage.error('保存失败：' + (e?.message || e))
  } finally {
    saving.value = false
  }
}

/** 删除的歌曲牵涉的艺术家（演唱/作词/作曲/编曲/专辑艺术家）→ 删后重算其 types（清掉失去作品支撑的类型） */
function affectedArtistIds(rows: any[]) {
  const ids = new Set<string>()
  const idsOf = (s: string | null) => String(s || '').split(',').map(x => x.trim()).filter(Boolean)
  for (const r of rows) {
    ;(r.artist_ids || []).forEach((id: string) => ids.add(id))
    idsOf(r.lyricist).forEach(id => ids.add(id))
    idsOf(r.composer).forEach(id => ids.add(id))
    idsOf(r.arranger).forEach(id => ids.add(id))
    ;(albumMap.value.get(r.album_id)?.artist_ids || []).forEach((id: string) => ids.add(id))
  }
  return [...ids]
}

async function removeOne(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除歌曲《${row.title}》？`, '确认删除', { type: 'warning' })
    const artistIds = affectedArtistIds([row])
    await adminApi.remove('songs', row.id)
    await recomputeArtistTypes(artistIds)
    ElMessage.success('已删除')
    await load()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error('删除失败：' + e.message)
  }
}

async function batchRemove() {
  if (!selected.value.length) return
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selected.value.length} 首歌曲？`, '批量删除', { type: 'warning' })
    const artistIds = affectedArtistIds(selected.value)
    await adminApi.removeBatch('songs', selected.value.map(s => s.id))
    await recomputeArtistTypes(artistIds)
    ElMessage.success('批量删除完成')
    clearSelection()
    await load()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error('删除失败：' + e.message)
  }
}

watch(pageSize, () => (page.value = 1))
</script>
