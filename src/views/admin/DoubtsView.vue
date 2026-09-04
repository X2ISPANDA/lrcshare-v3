<template>
  <div class="space-y-4">
    <!-- 工具条 -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-wrap items-center gap-3 px-5 py-3">
      <el-radio-group v-model="filter">
        <el-radio-button value="pending">待处理</el-radio-button>
        <el-radio-button value="resolved">已处理</el-radio-button>
        <el-radio-button value="all">全部</el-radio-button>
      </el-radio-group>
      <div class="flex-1"></div>
      <span class="text-sm text-gray-400">{{ list.length }} 条</span>
      <el-button @click="load" :loading="loading">刷新</el-button>
    </div>

    <div class="bg-white rounded-xl border border-gray-100 shadow-sm">
      <el-table :data="pagedList" :loading="loading" row-key="id">
        <el-table-column label="歌曲" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">{{ songMap.get(row.song_id)?.title || row.song_id }}</template>
        </el-table-column>
        <el-table-column label="行号" width="70" align="center">
          <template #default="{ row }">{{ row.line_no ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="原始行" min-width="240" show-overflow-tooltip>
          <template #default="{ row }"><span class="font-mono text-xs text-gray-600">{{ row.raw_text }}</span></template>
        </el-table-column>
        <el-table-column label="原因" width="120">
          <template #default="{ row }">
            <el-tag size="small" :type="reasonType(row.reason)">{{ reasonLabel(row.reason) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80" align="center">
          <template #default="{ row }">
            <el-tag v-if="row.resolved" size="small" type="success">已处理</el-tag>
            <el-tag v-else size="small" type="warning">待处理</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="处理结果" width="150">
          <template #default="{ row }">
            <template v-if="row.resolved">
              <el-tag v-if="row.resolved_kind === 'skip'" size="small" type="info">仅标记</el-tag>
              <span v-else-if="row.resolved_lang" class="inline-flex items-center gap-1">
                <el-tag size="small">{{ langLabel(row.resolved_lang) }}</el-tag>
                <span class="text-gray-300">·</span>
                <el-tag size="small" :type="row.resolved_kind === 'original' ? 'primary' : 'info'">{{ kindLabel(row.resolved_kind) }}</el-tag>
              </span>
              <span v-else class="text-xs text-gray-400">—</span>
            </template>
            <span v-else class="text-xs text-gray-300">待处理</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="150" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openHandle(row)">处理</el-button>
            <el-button link size="small" @click="viewLines(row)">查看行</el-button>
          </template>
        </el-table-column>
      </el-table>
      <div class="flex justify-end items-center px-5 py-4 border-t border-gray-100">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50]"
          :total="list.length"
          layout="total, sizes, prev, pager, next"
          :pager-count="5"
          background
        />
      </div>
    </div>

    <!-- 处理弹窗 -->
    <el-dialog v-model="showHandle" title="处理存疑行" width="600px" :close-on-click-modal="false">
      <div v-if="target" class="space-y-4">
        <div class="text-sm text-gray-500">
          <span class="text-gray-400">歌曲：</span>{{ songMap.get(target.song_id)?.title || target.song_id }}
          <span v-if="target.line_no" class="ml-3 text-gray-400">行号：{{ target.line_no }}</span>
        </div>
        <div class="font-mono text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-3 whitespace-pre-wrap break-all">{{ target.raw_text }}</div>

        <el-form label-width="70px" label-position="left">
          <el-form-item label="语言">
            <el-select v-model="handleForm.lang" filterable allow-create default-first-option class="w-full">
              <el-option v-for="l in (handleForm.kind === 'romanization' ? TRANSLIT_LANG_OPTIONS : LYRIC_LANG_OPTIONS)" :key="l" :label="l" :value="l" />
            </el-select>
          </el-form-item>
          <el-form-item label="类型">
            <el-select v-model="handleForm.kind" class="w-full" @change="onHandleKindChange">
              <el-option label="原文" value="original" />
              <el-option label="译文" value="translation" />
              <el-option label="罗马音" value="romanization" />
            </el-select>
          </el-form-item>
          <el-form-item label="时间戳">
            <el-input v-model="handleForm.time_ms" placeholder="留空则沿用原行时间 / 无时间戳行归位时需填写，单位毫秒" />
            <div class="text-xs text-gray-400 mt-1">毫秒整数（如 12000 = 00:12.000）；定位到已有行时忽略此值</div>
          </el-form-item>
        </el-form>

        <div v-if="targetLines.length" class="text-xs text-gray-500">
          <div class="mb-1">该歌曲现有版本（对照）：</div>
          <div v-for="v in targetLines" :key="v.lang + v.kind" class="mb-1">
            <el-tag size="small" class="mr-1">{{ langLabel(v.lang) }}</el-tag>
            <el-tag size="small" :type="v.kind === 'original' ? 'primary' : 'info'" class="mr-1">{{ LYRIC_KIND_LABEL[v.kind] }}</el-tag>
            <span class="text-gray-400">{{ v.rows.length }} 行</span>
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="showHandle = false">取消</el-button>
        <el-button @click="markResolved(undefined, 'skip')" :loading="saving">仅标记已处理（不改行）</el-button>
        <el-button type="primary" :loading="saving" @click="applyHandle">归位到行表并标记</el-button>
      </template>
    </el-dialog>

    <!-- 查看行弹窗 -->
    <el-dialog v-model="showLines" :title="(songMap.get(viewSongId)?.title || viewSongId) + ' - 歌词行'" width="720px">
      <div v-for="v in viewVersions" :key="v.lang + v.kind" class="mb-4">
        <div class="flex items-center gap-2 mb-2">
          <el-tag size="small">{{ langLabel(v.lang) }}</el-tag>
          <el-tag size="small" :type="v.kind === 'original' ? 'primary' : 'info'">{{ LYRIC_KIND_LABEL[v.kind] }}</el-tag>
          <span class="text-xs text-gray-400">{{ v.rows.length }} 行</span>
        </div>
        <pre class="text-xs text-gray-600 font-mono whitespace-pre-wrap bg-gray-50 border border-gray-100 rounded-lg p-3 max-h-64 overflow-y-auto m-0">{{ rowsToLrcText(v.rows) }}</pre>
      </div>
      <div v-if="!viewVersions.length" class="text-sm text-gray-400 py-6 text-center">该歌曲暂无歌词行</div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { supabase } from '@/lib/supabase'
import { loadLyricLines, groupVersions, rowsToLrcText, stripWordTags, LYRIC_LANG_OPTIONS, TRANSLIT_LANG_OPTIONS, LYRIC_KIND_LABEL, langLabel, type LyricVersion, type LyricKind } from '@/lib/lyricLines'

/** 存疑清单：展示迁移拆行判不出的行，人工归位 lang/kind + 标记 resolved */

const doubts = ref<any[]>([])
const songs = ref<any[]>([])
const loading = ref(false)
const filter = ref<'pending' | 'resolved' | 'all'>('pending')
const page = ref(1)
const pageSize = ref(20)

const songMap = computed(() => new Map(songs.value.map(s => [s.id, s])))

const list = computed(() => {
  if (filter.value === 'all') return doubts.value
  return doubts.value.filter(d => d.resolved === (filter.value === 'resolved'))
})
const pagedList = computed(() => list.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

const reasonLabel = (r: string) => ({ multi_same_ts: '同时间戳多行', bare_line: '无时间戳裸行', word_tag_ambiguous: '词标签歧义' } as Record<string, string>)[r] || r
const reasonType = (r: string): 'warning' | 'info' | 'danger' => ({ multi_same_ts: 'warning', bare_line: 'info', word_tag_ambiguous: 'danger' } as Record<string, 'warning' | 'info' | 'danger'>)[r] || 'info'
const kindLabel = (k: string) => (LYRIC_KIND_LABEL as Record<string, string>)[k] || k

async function load() {
  loading.value = true
  try {
    const [d, s] = await Promise.all([
      supabase.from('song_lyric_doubts').select('*').order('created_at', { ascending: false }),
      supabase.from('songs').select('id,title'),
    ])
    if (d.error) throw d.error
    if (s.error) throw s.error
    doubts.value = d.data || []
    songs.value = s.data || []
  } catch (e: any) {
    ElMessage.error('加载失败：' + e.message)
  } finally {
    loading.value = false
  }
}
onMounted(load)

// ===== 处理 =====
const showHandle = ref(false)
const saving = ref(false)
const target = ref<any>(null)
const targetLines = ref<LyricVersion[]>([])
const handleForm = reactive({ lang: 'zh', kind: 'translation' as LyricKind, time_ms: '' })

/** 归位类型切换时语言自动归位：罗马音必须是拉丁化方案；原文/译文不能是 Latn 标签 */
function onHandleKindChange() {
  if (handleForm.kind === 'romanization') {
    if (!TRANSLIT_LANG_OPTIONS.includes(handleForm.lang)) handleForm.lang = 'zh-Latn-pinyin'
  } else if (/Latn/i.test(handleForm.lang)) {
    handleForm.lang = 'zh'
  }
}

/** 解析 raw_text 的行首时间戳（毫秒），非时间戳行返回 null */
function parseTsOf(raw: string): number | null {
  const m = String(raw || '').match(/^\[(\d{1,3}):(\d{2})[.:](\d{2,3})\]/)
  if (!m) return null
  const frac = m[3]
  return parseInt(m[1]) * 60000 + parseInt(m[2]) * 1000 + (frac.length === 2 ? parseInt(frac) * 10 : parseInt(frac))
}

async function openHandle(row: any) {
  target.value = row
  handleForm.lang = 'zh'
  handleForm.kind = 'translation'
  const ts = parseTsOf(row.raw_text)
  handleForm.time_ms = ts != null ? String(ts) : ''
  try {
    const rows = await loadLyricLines(row.song_id)
    targetLines.value = groupVersions(rows)
  } catch {
    targetLines.value = []
  }
  showHandle.value = true
}

/** 归一化匹配文本：去时间戳前缀 + 词标签，得到纯文本 */
function normalizeText(raw: string): string {
  return stripWordTags(String(raw || '').replace(/^\[(\d{1,3}):(\d{2})[.:]\d{2,3}\]/, ''))
}

async function applyHandle() {
  if (!target.value) return
  const lang = handleForm.lang?.trim() || 'zh'
  const kind = handleForm.kind
  const rawText = target.value.raw_text
  const norm = normalizeText(rawText)
  const existing = targetLines.value.flatMap(v => v.rows.map(r => ({ ...r, _lang: v.lang, _kind: v.kind })))
  const hit = existing.find(r => stripWordTags(r.text) === norm)

  saving.value = true
  try {
    if (hit) {
      // 行已存在：RPC 单事务内删旧行→插到目标 lang/kind→标记 resolved（失败整体回滚，不再有删后插失败的丢行）
      const { error } = await supabase.rpc('resolve_lyric_doubt', {
        p_doubt_id: target.value.id,
        p_song_id: target.value.song_id,
        p_mode: 'relocate',
        p_lang: lang,
        p_kind: kind,
        p_src_lang: hit._lang,
        p_src_kind: hit._kind,
        p_src_seq: hit.seq,
      })
      if (error) throw error
    } else {
      // 行不存在（裸行归位）：用表单时间戳插入新行；无时间戳则按元数据行（裸文本作 time_ms=null）
      const timeMs = handleForm.time_ms.trim() ? parseInt(handleForm.time_ms, 10) : null
      if (timeMs == null && rawText.includes(':')) {
        // 无法归位为时间戳行且带冒号 → 提示需填时间戳
        ElMessage.warning('该行无法定位且未填时间戳，请填写时间戳（毫秒）后归位，或改用「仅标记已处理」')
        return
      }
      const { error } = await supabase.rpc('resolve_lyric_doubt', {
        p_doubt_id: target.value.id,
        p_song_id: target.value.song_id,
        p_mode: 'insert',
        p_lang: lang,
        p_kind: kind,
        p_time_ms: timeMs,
        p_text: stripWordTags(rawText),
      })
      if (error) throw error
    }
    // RPC 成功后同步本地状态（与旧 markResolved 的界面更新一致；skip 路径仍走 markResolved）
    target.value.resolved = true
    target.value.resolved_lang = lang
    target.value.resolved_kind = kind
    showHandle.value = false
    ElMessage.success('已归位并标记处理')
  } catch (e: any) {
    ElMessage.error('处理失败：' + e.message)
  } finally {
    saving.value = false
  }
}

async function markResolved(lang?: string, kind?: string) {
  if (!target.value) return
  saving.value = true
  try {
    const update: Record<string, unknown> = { resolved: true }
    if (lang) update.resolved_lang = lang
    if (kind) update.resolved_kind = kind
    const { error } = await supabase.from('song_lyric_doubts').update(update).eq('id', target.value.id)
    if (error) throw error
    target.value.resolved = true
    if (lang) target.value.resolved_lang = lang
    if (kind) target.value.resolved_kind = kind
    showHandle.value = false
    ElMessage.success('已标记处理')
  } catch (e: any) {
    ElMessage.error('标记失败：' + e.message)
  } finally {
    saving.value = false
  }
}

// ===== 查看行 =====
const showLines = ref(false)
const viewSongId = ref('')
const viewVersions = ref<LyricVersion[]>([])
async function viewLines(row: any) {
  viewSongId.value = row.song_id
  try {
    const rows = await loadLyricLines(row.song_id)
    viewVersions.value = groupVersions(rows)
  } catch {
    viewVersions.value = []
  }
  showLines.value = true
}
</script>
