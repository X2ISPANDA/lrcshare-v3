<template>
  <div class="space-y-4">
    <!-- 工具条 -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-wrap items-center gap-3 px-5 py-3">
      <el-input v-model="keyword" placeholder="搜索歌曲名 / 歌手" clearable class="!w-64" :prefix-icon="Search" />
      <div class="flex-1"></div>
      <el-button type="primary" @click="openNew" style="--el-button-bg-color: #ec4899; --el-button-border-color: #ec4899; --el-button-hover-bg-color: #db2777; --el-button-hover-border-color: #db2777">+ 新增歌曲</el-button>
    </div>

    <div class="bg-white rounded-xl border border-gray-100 shadow-sm">
      <el-table :data="pagedList" stripe v-loading="loading" row-key="id" @selection-change="selected = $event">
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
      </el-table>

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
              <ArtistTagInput v-model="form.artists" :artists="artists" filter-type="singer" />
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
                <ArtistTagInput v-model="form.albumArtists" :artists="artists" tone="gray" :disabled="!!form.albumId && !albumUnlocked" />
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
            <el-form-item label="作词"><ArtistTagInput v-model="form.lyricists" :artists="artists" filter-type="lyricist" /></el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="作曲"><ArtistTagInput v-model="form.composers" :artists="artists" filter-type="composer" /></el-form-item>
          </el-col>
          <el-col :span="8">
            <el-form-item label="编曲"><ArtistTagInput v-model="form.arrangers" :artists="artists" filter-type="arranger" /></el-form-item>
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
              <span class="text-xs text-gray-400">开启后不出现在任何公开列表，仅可通过直链访问</span>
            </div>
            <el-input v-model="form.unlock_code" placeholder="独立解锁口令（留空则使用全局口令）" />
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
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import { Search } from '@element-plus/icons-vue'
import { marked } from 'marked'
import { mdToHtml } from '@/lib/markdown'
import { adminApi } from '@/lib/adminApi'
import ArtistTagInput from '@/components/submit/ArtistTagInput.vue'
import RichTextToolbar from '@/components/admin/RichTextToolbar.vue'
import RichContentView from '@/components/common/RichContentView.vue'
import type { Artist, Contributor } from '@/lib/types'

/** 歌曲管理：列表 + 新增/编辑（专辑锁定、艺术家自动补建、双歌词 tab、隐藏口令） */

const GENRE_OPTIONS = ['Hip-Hop', 'Chinese Rap', 'Rock', 'Mandopop', 'Contopop', 'K-Pop', 'J-Pop', '抽象', 'Soundtrack', 'Vocaloid']
const TIP_ICONS: Record<string, string> = { bell: '🔔', info: 'ℹ️', success: '✅', warning: '⚠️', danger: '❌', tip: '💡', note: '📝', important: '❗' }

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
    const [s, a, al, c] = await Promise.all([
      adminApi.getAll('songs', { order: 'created_at', ascending: false }),
      adminApi.getAll<Artist>('artists', { order: 'name' }),
      adminApi.getAll('albums', { order: 'name' }),
      adminApi.getAll<Contributor>('contributors', { order: 'sort' }),
    ])
    songs.value = s
    artists.value = a
    albums.value = al
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

const form = reactive({
  title: '',
  aliases: [] as string[],
  duration: '',
  track: 0,
  artists: [] as { id: string | null; name: string }[],
  albumId: '' as string | null,
  albumName: '',
  albumArtists: [] as { id: string | null; name: string }[],
  year: '',
  lyricists: [] as { id: string | null; name: string }[],
  composers: [] as { id: string | null; name: string }[],
  arrangers: [] as { id: string | null; name: string }[],
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
/** 解析 {id,name}[]：无 id 自动创建艺术家（types 补充），返回 ID 列表 */
async function resolveArtists(tags: { id: string | null; name: string }[], type: string): Promise<string[]> {
  const ids: string[] = []
  for (const t of tags) {
    if (t.id) {
      const exist = artistMap.value.get(t.id)
      if (exist && type !== 'album' && !(exist.types || []).includes(type) && type !== 'singer') {
        const types = [...(exist.types || []), type]
        await adminApi.update('artists', exist.id, { types })
        exist.types = types
      }
      ids.push(t.id)
    } else {
      const created = await adminApi.insert('artists', {
        id: 'a' + Date.now() + Math.floor(Math.random() * 1000),
        name: t.name,
        types: type === 'album' ? [] : [type],
        is_show: true,
        sort: 0,
        bio: '', avatar: '', aliases: [], disambiguation: '',
      })
      artists.value.push(created as Artist)
      ids.push(created!.id)
    }
  }
  return ids
}

async function save() {
  if (!form.title.trim() || !form.artists.length || !form.albumName.trim() || !form.lrc_text.trim()) {
    ElMessage.warning('请填写必填字段：歌曲名、歌手、专辑、LRC 歌词')
    return
  }
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
          artist_ids: albumArtistIds,
          year: form.year.trim() ? parseInt(form.year.trim()) : null,
        })
      }
    } else {
      const created = await adminApi.insert('albums', {
        id: 'al' + Date.now(),
        name: form.albumName.trim(),
        artist_ids: albumArtistIds,
        year: form.year.trim() ? parseInt(form.year.trim()) : null,
        cover: '',
      })
      albumId = created!.id
      albums.value.push(created)
    }

    // 3. 歌曲记录（lyricist/composer/arranger 统一存 ID 逗号分隔）
    const payload: Record<string, unknown> = {
      title: form.title.trim(),
      aliases: form.aliases.map(a => a.trim()).filter(Boolean),
      artist_ids: artistIds,
      album_id: albumId,
      lyricist: lyricistIds.join(','),
      composer: composerIds.join(','),
      arranger: arrangerIds.join(','),
      duration: form.duration.trim(),
      track: form.track || 0,
      lrc_text: form.lrc_text.trim(),
      lyrics_text: form.lyrics_text || null,
      video_url: form.video_url.trim() || null,
      description: form.description || null,
      genres: form.genres,
      contributor_id: form.contributor_id || null,
      is_hidden: !!form.is_hidden,
      unlock_code: form.unlock_code.trim(),
    }

    if (editing.value) {
      await adminApi.update('songs', editing.value.id, payload)
      ElMessage.success('保存成功')
    } else {
      payload.id = 's' + Date.now()
      payload.status = 'published'
      await adminApi.insert('songs', payload)
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

async function removeOne(row: any) {
  try {
    await ElMessageBox.confirm(`确定删除歌曲《${row.title}》？`, '确认删除', { type: 'warning' })
    await adminApi.remove('songs', row.id)
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
    await adminApi.removeBatch('songs', selected.value.map(s => s.id))
    ElMessage.success('批量删除完成')
    clearSelection()
    await load()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error('删除失败：' + e.message)
  }
}

watch(pageSize, () => (page.value = 1))
</script>
