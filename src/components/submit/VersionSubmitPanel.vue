<template>
  <div class="space-y-5">
    <!-- 目标歌曲（固定时只读展示，否则搜索选择） -->
    <div v-if="!fixedSong">
      <label class="block text-sm font-medium text-gray-700 mb-1.5">
        目标歌曲<span class="text-red-500">*</span>
      </label>
      <el-select
        v-model="pickedSongKey"
        filterable
        remote
        :remote-method="searchSongs"
        :loading="songLoading"
        placeholder="搜索歌曲名 / 别名，选择要补充歌词的歌曲"
        class="w-full"
        @change="onSongPick"
      >
        <el-option
          v-for="s in songOptions"
          :key="s.id"
          :label="`${s.title} - ${s.artist_name}`"
          :value="s.id"
        >
          <div class="flex items-center justify-between gap-2">
            <span class="truncate">{{ s.title }}</span>
            <span class="text-xs text-gray-400 truncate">{{ s.artist_name }}<template v-if="s.album_name"> · {{ s.album_name }}</template></span>
          </div>
        </el-option>
      </el-select>
    </div>
    <div v-else class="rounded-lg bg-gray-50 border border-gray-200 px-3.5 py-2.5 text-sm text-gray-600">
      目标歌曲：<b>{{ fixedSong.title }}</b>
    </div>

    <!-- 贡献者（选已有 或 输入新昵称） -->
    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1.5">
        你的昵称（贡献者）<span class="text-red-500">*</span>
      </label>
      <el-select
        v-model="contributorName"
        filterable
        allow-create
        default-first-option
        :remote-method="searchContributors"
        :loading="contributorLoading"
        placeholder="选择已有贡献者，或直接输入新昵称"
        class="w-full"
        @change="onContributorChange"
      >
        <el-option
          v-for="c in contributorOptions"
          :key="c.id"
          :label="c.name"
          :value="c.name"
        />
      </el-select>
      <p v-if="isNewContributor" class="text-xs text-gray-400 mt-1">新昵称将在投稿通过后自动创建贡献者</p>
    </div>

    <!-- 联系方式（新贡献者必填邮箱） -->
    <div v-if="isNewContributor">
      <label class="block text-sm font-medium text-gray-700 mb-1.5">
        邮箱<span class="text-red-500">*</span>
        <span class="text-xs text-gray-400 font-normal">（新贡献者必填，用于投稿结果通知，不公开）</span>
      </label>
      <el-input v-model="email" placeholder="you@example.com" />
    </div>

    <!-- 已有版本提示 + 查重 -->
    <div v-if="targetSong" class="text-xs space-y-1">
      <div class="text-gray-500">
        该歌曲已有 {{ existingVersions.length }} 个歌词版本
        <template v-if="existingByContributor.length">
          ，其中你已贡献 {{ existingByContributor.length }} 个
        </template>
      </div>
      <div v-if="dupFormat" class="text-red-500">
        你已投过该歌曲的{{ dupFormat === 'ttml' ? ' TTML ' : '逐字 LRC ' }}版本，请勿重复投稿（如需修订请联系站长）
      </div>
    </div>

    <!-- 歌词粘贴 -->
    <div>
      <label class="block text-sm font-medium text-gray-700 mb-1.5">
        歌词内容<span class="text-red-500">*</span>
        <span class="text-xs text-gray-400 font-normal">（粘贴 TTML 源代码 或 逐字 LRC；逐行 LRC 不支持多语言合并）</span>
      </label>
      <el-input
        v-model="lyrics"
        type="textarea"
        :rows="10"
        :placeholder="isTtml ? '已识别为 TTML 源代码' : '粘贴 TTML 源代码 或 逐字 LRC 歌词'"
        class="font-mono!"
      />
      <div class="text-xs mt-1" :class="lyrics ? (isTtml ? 'text-blue-500' : 'text-green-600') : 'text-gray-400'">
        {{ lyrics ? (isTtml ? '✓ 识别为 TTML（对唱/样式数据完整保留）' : '✓ 识别为 LRC') : '支持自动识别格式' }}
      </div>
    </div>

    <el-button type="primary" class="w-full" :loading="submitting" @click="handleSubmit">
      提交补充版本（进入审核队列）
    </el-button>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '@/lib/api'
import type { Contributor, SongWithNames } from '@/lib/types'
import {
  parseTtmlToRows,
  rowsToLrcText,
  composeMixedLrc,
  splitLrcToVersions,
  groupVersions,
  loadLyricLines,
  loadLyricVersionMetas,
  detectTimestampDuplicate,
  type ExistingLyricVersion,
  type LyricLineRow,
  type LyricVersion,
} from '@/lib/lyricLines'

const props = defineProps<{
  /** 固定目标歌曲（歌曲主页弹框传入）；不传则组件内搜索选歌（投稿页补充模式） */
  song?: { id: string; title: string } | null
}>()
const emit = defineEmits<{ submitted: [] }>()

const fixedSong = computed(() => props.song || null)

// ============ 目标歌曲（非固定时远程搜索） ============
const pickedSongKey = ref('')
const pickedSong = ref<SongWithNames | null>(null)
const songOptions = ref<SongWithNames[]>([])
const songLoading = ref(false)
let songTimer: ReturnType<typeof setTimeout> | null = null

async function searchSongs(query: string) {
  if (songTimer) clearTimeout(songTimer)
  songLoading.value = true
  songTimer = setTimeout(async () => {
    try {
      const q = (query || '').trim()
      if (!q) { songOptions.value = []; return }
      const res = await api.search(q)
      // 歌曲标题匹配优先（补充版本场景：用户知道歌名）
      songOptions.value = [...res.songs, ...res.lyrics.filter(l => !res.songs.some(s => s.id === l.id))].slice(0, 20)
    } catch {
      songOptions.value = []
    } finally {
      songLoading.value = false
    }
  }, 250)
}

function onSongPick(id: string) {
  pickedSong.value = songOptions.value.find(s => s.id === id) || null
}

const targetSong = computed(() => fixedSong.value || (pickedSong.value ? { id: pickedSong.value.id, title: pickedSong.value.title } : null))

// ============ 贡献者（远程搜索 + 允许新建） ============
const allContributors = ref<Contributor[]>([])
const contributorOptions = ref<Contributor[]>([])
const contributorLoading = ref(false)
const contributorName = ref('')
let contributorTimer: ReturnType<typeof setTimeout> | null = null

async function ensureContributors() {
  if (!allContributors.value.length) {
    try {
      const list = await api.getContributors()
      allContributors.value = (list || []).filter(c => !c.is_owner)
    } catch { /* 容错：当作无匹配 */ }
  }
  return allContributors.value
}

async function searchContributors(query: string) {
  if (contributorTimer) clearTimeout(contributorTimer)
  contributorLoading.value = true
  contributorTimer = setTimeout(async () => {
    try {
      const list = await ensureContributors()
      const q = (query || '').trim().toLowerCase()
      contributorOptions.value = q
        ? list.filter(c => (c.name || '').toLowerCase().includes(q)).slice(0, 20)
        : list.slice(0, 20)
    } finally {
      contributorLoading.value = false
    }
  }, 200)
}

// 初始化贡献者选项（弹窗打开时已有数据可选）
ensureContributors().then(list => { contributorOptions.value = list.slice(0, 20) })

const selectedContributor = computed(() =>
  contributorName.value ? allContributors.value.find(c => c.name === contributorName.value) || null : null,
)
const isNewContributor = computed(() => !!contributorName.value && !selectedContributor.value)

function onContributorChange() { /* el-select 选择/新建后响应式自动处理，保留钩子 */ }

// ============ 歌词输入 ============
const lyrics = ref('')
const email = ref('')
const isTtml = computed(() => {
  const raw = lyrics.value.trim()
  return /^<\s*tt\b/i.test(raw) || /<p\s+begin=/i.test(raw)
})

// ============ 已有版本 + 同人同格式查重 ============
const existingVersions = ref<Awaited<ReturnType<typeof loadLyricVersionMetas>>>([])
watch(targetSong, async (song) => {
  existingVersions.value = []
  if (!song) return
  try {
    existingVersions.value = await loadLyricVersionMetas(song.id)
  } catch { existingVersions.value = [] }
}, { immediate: true })

/** 当前投稿人已有的版本（按 contributor_id；新建贡献者无 id 不查重） */
const existingByContributor = computed(() =>
  selectedContributor.value
    ? existingVersions.value.filter(v => v.contributor_id === selectedContributor.value!.id)
    : [],
)
/** 粘贴格式与已有版本撞车：ttml ↔ format='ttml'；lrc ↔ format='lrc'/'enhanced' */
const dupFormat = computed<'ttml' | 'lrc' | null>(() => {
  if (!lyrics.value.trim() || !existingByContributor.value.length) return null
  const fmt = isTtml.value ? 'ttml' : 'lrc'
  const hit = existingByContributor.value.some(v => fmt === 'ttml' ? v.format === 'ttml' : v.format !== 'ttml')
  return hit ? fmt : null
})

// ============ 提交 ============
const submitting = ref(false)

async function handleSubmit() {
  if (!targetSong.value) { ElMessage.warning('请先选择目标歌曲'); return }
  const name = contributorName.value.trim()
  if (!name) { ElMessage.warning('请填写贡献者昵称'); return }
  if (isNewContributor.value) {
    const em = email.value.trim()
    if (!em || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) { ElMessage.warning('新贡献者请填写正确的邮箱地址'); return }
  }
  const raw = lyrics.value.trim()
  if (!raw) { ElMessage.warning('请粘贴歌词内容（TTML 或逐字 LRC）'); return }
  if (dupFormat.value) { ElMessage.error('你已投过该歌曲的同格式版本，请勿重复投稿'); return }

  // 解析歌词：TTML 截留原文 + 降级 LRC；LRC 自动拆分多语言版本
  let ttmlText: string | undefined
  let lrcText = ''
  let versions: { lang: string; kind: string; lrc: string }[] | undefined
  // 解析后的版本组（查重用：原文组前 3 句时间戳）
  let parsedGroups: LyricVersion[] = []
  if (isTtml.value) {
    if (raw.length > 500 * 1024) { ElMessage.warning('TTML 原文超过 500KB 限制，请精简样式后重试'); return }
    ttmlText = raw
    const rows = parseTtmlToRows(raw)
    if (!rows.length) { ElMessage.warning('TTML 解析失败，请检查格式（仅支持 clock-time 时间戳，如 00:01:02.500）'); return }
    lrcText = rowsToLrcText(rows)
    parsedGroups = [{ lang: 'und', kind: 'original', rows }]
  } else {
    const split = splitLrcToVersions(raw)
    const vers = split
      .filter(v => v.rows.some(r => r.time_ms != null && r.text.trim()))
      .map(v => ({ lang: v.lang, kind: v.kind, lrc: rowsToLrcText(v.rows) }))
    if (!vers.length) { ElMessage.warning('LRC 解析失败：未识别到带时间戳的歌词行'); return }
    versions = vers
    lrcText = composeMixedLrc(split, 'line')
    parsedGroups = split
  }

  submitting.value = true
  try {
    // 复制查重：前 3 句原文行开始时间戳毫秒级比对（手打轴不可能撞车）；请求异常放行由审核端兜底
    try {
      const [metas, dbRows] = await Promise.all([
        loadLyricVersionMetas(targetSong.value.id, true),
        loadLyricLines(targetSong.value.id),
      ])
      const metaIds = new Set(metas.map(m => m.id))
      // 行表按版本容器分桶（不属于任何已发布容器的归入 '' 兜底桶）
      const buckets = new Map<string, LyricLineRow[]>()
      for (const r of dbRows) {
        const vid = r.version_id && metaIds.has(r.version_id) ? r.version_id : ''
        if (!buckets.has(vid)) buckets.set(vid, [])
        buckets.get(vid)!.push(r)
      }
      const existing: ExistingLyricVersion[] = []
      for (const [vid, rows] of buckets) {
        const groups = groupVersions(rows)
        if (!groups.some(g => g.kind === 'original' && g.rows.some(r => r.time_ms != null))) continue
        const meta = vid ? metas.find(m => m.id === vid) : null
        const fmtLabel = meta?.format === 'enhanced' ? '逐字 LRC' : 'LRC'
        existing.push({
          label: meta?.contributor_name ? `${meta.contributor_name} 的${fmtLabel}版本` : `官方${fmtLabel}版本`,
          groups,
        })
      }
      // TTML 版本：解析原文行成单个原文组参与比对（跨格式抓「TTML 转 LRC 照抄」）
      for (const m of metas) {
        if (m.format !== 'ttml' || !m.ttml_text) continue
        const trows = parseTtmlToRows(m.ttml_text)
        if (!trows.some(r => r.time_ms != null)) continue
        existing.push({
          label: m.contributor_name ? `${m.contributor_name} 的 TTML 版本` : 'TTML 版本',
          groups: [{ lang: 'und', kind: 'original', rows: trows }],
        })
      }
      const hit = detectTimestampDuplicate(parsedGroups, existing)
      if (hit && !hit.hasTranslationDelta) {
        ElMessage({
          type: 'error',
          duration: 8000,
          showClose: true,
          message: `歌词前几句的时间轴与已有的「${hit.label}」完全一致，疑似照抄该版本投稿，请自行制作歌词时间轴；如仅提交更好的翻译，请连原文带译文一起粘贴`,
        })
        return
      }
    } catch (e) {
      console.warn('[version-submit] 复制查重失败，放行由审核端兜底：', e)
    }

    await api.submitSubmissionV2({
      submitter_name: name,
      contact_value: email.value.trim() ? { email: email.value.trim() } : {},
      contributor_id: selectedContributor.value ? selectedContributor.value.id : null,
      song_data: {
        type: 'song_version',
        title: targetSong.value.title,
        song_id: targetSong.value.id,
        song_title: targetSong.value.title,
        artists: [],
        album_artists: [],
        lyricist_arr: [],
        composer_arr: [],
        lrc_text: lrcText,
        ttml_text: ttmlText,
        versions,
      },
    })
    ElMessage.success('补充版本已提交，进入审核队列')
    // 重置歌词（歌曲/贡献者保留，同人连投常用）
    lyrics.value = ''
    emit('submitted')
  } catch (e: any) {
    console.error(e)
    ElMessage.error('网络错误，请稍后重试')
  } finally {
    submitting.value = false
  }
}
</script>
