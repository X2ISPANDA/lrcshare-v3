<template>
  <main class="max-w-3xl mx-auto px-4 py-8">
    <div class="bg-white rounded-2xl shadow-sm p-8">
      <h1 class="text-3xl font-bold text-gray-800 mb-2">🎶 分享歌曲</h1>
      <p class="text-gray-500 mb-4">把你喜欢的单曲或专辑分享给大家，管理员审核通过后将出现在歌曲分享墙与浮动播放器中</p>

      <!-- 投稿须知 -->
      <div class="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
        <div class="text-sm font-semibold text-amber-800 mb-2">📌 投稿须知</div>
        <div class="text-sm text-amber-700 leading-relaxed space-y-1">
          <p>· 只接受<b>单曲</b>与<b>专辑</b>，歌单 / 合集 / 播放列表一律不收；</p>
          <p>· 仅支持提供官方外链播放器的 9 个平台（见下方下拉），粘贴链接后会调用平台官方接口当场识别并可试播验证；</p>
          <p>· Spotify / Apple Music / Deezer / Tidal 未登录通常只能听 30 秒预览，属平台官方限制；</p>
          <p>· 同一首歌原则上只保留一条分享（同平台链接、跨平台同名同歌手都会拦截）。</p>
        </div>
      </div>

      <div v-if="!submitted" class="space-y-6">
        <!-- ===== 第一步：选择平台 ===== -->
        <div class="border-b pb-6">
          <h2 class="text-lg font-semibold text-gray-700 mb-4">1️⃣ 选择平台</h2>
          <el-select v-model="platformKey" placeholder="请选择音乐平台" style="width: 100%">
            <el-option v-for="p in MUSIC_PLATFORMS" :key="p.key" :label="p.label" :value="p.key">
              <div class="flex items-center justify-between w-full">
                <span class="flex items-center gap-2">
                  <span class="inline-block w-2.5 h-2.5 rounded-full" :style="{ background: p.brandColor }"></span>
                  <span class="font-medium">{{ p.label }}</span>
                </span>
                <span class="text-xs text-gray-400">
                  {{ p.accepts.includes('album') ? '单曲 / 专辑' : '单曲' }} · {{ p.tier }} 档
                </span>
              </div>
            </el-option>
          </el-select>
          <div v-if="platform" class="mt-2 text-xs leading-relaxed text-gray-500">
            {{ platform.limitation }}
          </div>
        </div>

        <!-- ===== 第二步：粘贴链接/嵌入代码并识别 ===== -->
        <div class="border-b pb-6">
          <h2 class="text-lg font-semibold text-gray-700 mb-1">
            2️⃣ 粘贴{{ platform?.inputMode === 'embed' ? '嵌入代码' : '链接' }}并识别
          </h2>
          <p v-if="platform" class="text-sm text-gray-400 mb-3">
            {{ platform.inputMode === 'embed'
              ? '在 Bandcamp 歌曲/专辑页点击「Share/Embed」，复制弹窗中的整段代码'
              : '到平台的歌曲/专辑详情页复制浏览器地址栏链接即可' }}
          </p>

          <el-input
            v-if="platform?.inputMode === 'embed'"
            v-model="urlOrEmbed"
            type="textarea"
            :rows="5"
            :placeholder="platform?.placeholder"
          />
          <el-input v-else v-model="urlOrEmbed" clearable :placeholder="platform?.placeholder || '请先选择平台'" />

          <!-- 实时正则校验提示（未点识别也能立刻发现格式错误） -->
          <div v-if="urlOrEmbed.trim()" class="mt-1.5 text-xs" :class="inputValid ? 'text-green-600' : 'text-red-500'">
            {{ inputValid ? '✔ 链接格式看起来没问题，点「识别」继续' : `✘ ${platform?.invalidHint}` }}
          </div>

          <div class="mt-3 flex items-center gap-3">
            <el-button
              type="primary"
              :disabled="!platform || !inputValid"
              :loading="resolving"
              class="!bg-pink-500 hover:!bg-pink-600 !border-pink-500"
              @click="recognize"
            >🔍 识别并试播</el-button>
            <span v-if="resolveError" class="text-sm text-red-500">{{ resolveError }}</span>
          </div>

          <!-- 识别结果 + 官方组件试播 -->
          <div v-if="resolved" :key="resolved.platform_id + resolved.source_url" class="mt-5 p-4 rounded-xl bg-pink-50/50 border border-pink-100">
            <div class="flex flex-wrap items-center gap-2 mb-3">
              <span
                class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium text-white"
                :style="{ background: platform?.brandColor }"
              >
                <span class="inline-block w-1.5 h-1.5 rounded-full bg-white/80"></span>
                {{ platform?.label }}
              </span>
              <el-tag size="small" :type="resolved.media_type === 'album' ? 'warning' : 'success'">
                {{ resolved.media_type === 'album' ? '专辑' : '单曲' }}
              </el-tag>
              <el-tag v-if="resolved.need_manual" size="small" type="info">需补全信息</el-tag>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">
                  标题 <span class="text-red-500">*</span>
                  <span v-if="!resolved.need_manual" class="text-xs text-gray-400 ml-1">（来自官方接口，可修正）</span>
                </label>
                <el-input v-model="form.title" placeholder="歌曲 / 专辑标题" />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">
                  歌手 / UP 主
                  <span class="text-xs text-gray-400 ml-1">（选填，用于跨平台重复比对）</span>
                </label>
                <el-input v-model="form.artist" placeholder="歌手或创作者名称" />
              </div>
            </div>

            <!-- 官方组件试播（仅在客户端识别成功后渲染，SSG 首屏不产生 iframe） -->
            <div class="mt-4">
              <div class="text-sm font-medium text-gray-700 mb-2">▶ 官方组件试播（可点击播放验证可用性）</div>
              <div
                class="rounded-lg overflow-hidden bg-black/5 border border-gray-200"
                :style="previewFrameStyle"
              >
                <iframe
                  :src="previewSrc"
                  class="w-full h-full border-0"
                  :allow="platform?.iframeAllow"
                  loading="lazy"
                  referrerpolicy="no-referrer"
                ></iframe>
              </div>
              <p class="mt-1.5 text-xs text-gray-400">
                若此处提示无版权、地区限制或无法播放，说明访客也听不到，建议换一个平台链接投稿。
              </p>
            </div>
          </div>
        </div>

        <!-- ===== 第三步：推荐理由 + 原创自荐 ===== -->
        <div class="border-b pb-6">
          <h2 class="text-lg font-semibold text-gray-700 mb-4">3️⃣ 推荐理由</h2>
          <el-input
            v-model="form.reason"
            type="textarea"
            :rows="3"
            maxlength="200"
            show-word-limit
            placeholder="为什么想分享这首歌？可以留空（最多 200 字）"
          />
          <label class="mt-4 flex items-start gap-2 text-sm text-gray-700 cursor-pointer select-none">
            <el-checkbox v-model="form.is_own_work" />
            <span>
              <b>这是我本人的原创作品（歌手/创作者就是我）</b>
              <br />
              <span class="text-xs text-gray-400">
                勾选后这条分享会以「创作者」专属卡片样式展示。需经站长核实，冒认会被取消标记。
              </span>
            </span>
          </label>
        </div>

        <!-- ===== 第四步：你的信息 ===== -->
        <div>
          <h2 class="text-lg font-semibold text-gray-700 mb-4">4️⃣ 你的信息</h2>

          <!-- 昵称：远程搜索已有贡献者（全量，不过滤标签；命中即以该账号身份分享） -->
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-1">昵称 <span class="text-red-500">*</span></label>
            <el-select
              :model-value="form.name"
              filterable
              remote
              clearable
              :reserve-keyword="false"
              placeholder="搜索已有昵称，或输入新昵称后点选蓝色新建项"
              :remote-method="searchContributors"
              :loading="contributorLoading"
              style="width: 100%"
              @change="onContributorNameChange"
            >
              <el-option v-for="c in contributorOptions" :key="c.id" :label="c.name" :value="c.name">
                <div class="flex items-center gap-2">
                  <img :src="c.avatar || DEFAULT_LOGO" class="w-6 h-6 rounded-full object-cover" />
                  <span class="font-medium">{{ c.name }}</span>
                  <span v-if="c.tags && c.tags.length" class="text-xs text-gray-400 ml-1">{{ c.tags.slice(0, 2).join(' · ') }}</span>
                </div>
              </el-option>
              <el-option v-if="currentQuery" key="__new__" :label="`➕ 使用新昵称「${currentQuery}」`" :value="`__NEW__:${currentQuery}`">
                <span class="text-blue-500 font-medium">➕ 使用新昵称「{{ currentQuery }}」</span>
              </el-option>
            </el-select>
            <div v-if="selectedContributor" class="mt-1.5 text-xs text-blue-600">
              将以已有贡献者「{{ selectedContributor.name }}」的身份提交本次分享
            </div>
            <div v-else-if="isNewContributor" class="mt-1.5 text-xs text-blue-600">
              将以新昵称「{{ form.name }}」记录，审核通过后自动创建贡献者账号
            </div>
          </div>

          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-1">
              邮箱 <span class="text-xs text-gray-400 ml-1">（选填，填写后可收到审核结果通知）</span>
            </label>
            <input
              v-model="form.email"
              type="email"
              class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
              placeholder="用于接收审核结果通知，不会公开展示"
            />
          </div>

          <!-- 联系方式动态行（键名复用歌词投稿 CONTACT_TYPES，不含 email——邮箱已单独一栏） -->
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">
              联系方式 <span class="text-xs text-gray-400 ml-1">（选填，仅站长可见，可添加多种）</span>
            </label>
            <div class="space-y-2">
              <div v-for="(c, idx) in form.contacts" :key="idx" class="flex gap-2 items-center">
                <el-select v-model="c.type" style="width: 120px; flex-shrink: 0">
                  <el-option v-for="t in CONTACT_TYPES" :key="t" :label="contactLabel(t)" :value="t" :disabled="isContactTypeSelected(t, idx)" />
                </el-select>
                <el-input v-model="c.value" placeholder="号码/链接" style="flex: 1; min-width: 0" />
                <el-button type="danger" link @click="removeContact(idx)">移除</el-button>
              </div>
            </div>
            <el-button type="primary" link size="small" class="mt-1" @click="addContact">+ 添加联系方式</el-button>
          </div>
        </div>

        <el-button
          type="primary"
          class="w-full !bg-pink-500 hover:!bg-pink-600 !border-pink-500 py-2.5 text-base"
          :loading="submitting"
          @click="handleSubmit"
        >
          提交分享（进入审核）
        </el-button>
        <p class="text-center text-xs text-gray-400 mt-2">提交即表示你确认该链接来自上述平台官方页面，且不包含歌单类内容</p>
      </div>

      <!-- 提交成功 -->
      <div v-else class="py-10 text-center">
        <div class="text-6xl mb-4">📨</div>
        <h2 class="text-2xl font-bold text-gray-800 mb-2">分享已提交</h2>
        <p class="text-gray-500 mb-6">
          「{{ lastTitle }}」已进入审核队列，通过后会出现在歌曲分享墙，进站访客也可能随机听到它。
        </p>
        <div class="flex gap-3 justify-center">
          <el-button type="primary" class="!bg-pink-500 !border-pink-500" @click="resetForm">再分享一首</el-button>
          <RouterLink to="/"><el-button>返回首页</el-button></RouterLink>
        </div>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useHead } from '@unhead/vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '@/lib/api'
import type { Contributor, MusicShareDupHints } from '@/lib/types'
import type { MusicResolveResult } from '@/lib/musicPlatforms'
import {
  MUSIC_PLATFORMS,
  getMusicPlatform,
  musicPlatformLabel,
  type MusicPlatformKey,
} from '@/lib/musicPlatforms'
import { contactLabel, LOGO_URL as DEFAULT_LOGO } from '@/lib/constants'

useHead({ title: '分享歌曲 - LrcShare' })

/** 联系方式键（与歌词投稿页保持同一套；email 已单独成栏，此处不重复） */
const CONTACT_TYPES = ['qq', 'wechat', 'bilibili', 'github', 'blog', 'douyin', 'weibo', 'twitter', 'xiaohongshu', 'netease', 'homepage', 'phone', 'mobile']

// ============ 平台选择 + 输入 ============
const platformKey = ref<MusicPlatformKey>('netease')
const platform = computed(() => getMusicPlatform(platformKey.value))
const urlOrEmbed = ref('')
const resolving = ref(false)
const resolveError = ref('')
const resolved = ref<MusicResolveResult | null>(null)

const form = reactive({
  title: '',
  artist: '',
  reason: '',
  is_own_work: false,
  name: '',
  email: '',
  contacts: [{ type: CONTACT_TYPES[0], value: '' }],
})

// 切换平台或修改输入后，旧的识别结果作废（避免拿着 A 平台结果配 B 平台链接提交）
watch([platformKey, urlOrEmbed], () => {
  resolved.value = null
  resolveError.value = ''
})

/** 实时格式校验：B 档嵌入代码走各自正则，其余走链接正则 */
const inputValid = computed(() => {
  const p = platform.value
  if (!p) return false
  const v = urlOrEmbed.value.trim()
  if (!v) return false
  return p.inputPattern.test(v)
})

/** 识别：调 Netlify 函数（服务端复核 + 官方元数据），成功后渲染官方试播组件 */
async function recognize() {
  if (!platform.value || !inputValid.value) return
  resolving.value = true
  resolveError.value = ''
  try {
    const data = await api.resolveMusicShare(platformKey.value, urlOrEmbed.value.trim())
    resolved.value = data
    form.title = data.title || ''
    form.artist = data.artist || ''
  } catch (e) {
    resolved.value = null
    resolveError.value = e instanceof Error ? e.message : '识别失败，请稍后重试'
  } finally {
    resolving.value = false
  }
}

// ============ 官方组件试播（投稿阶段一律不自动播放） ============
const previewSrc = computed(() =>
  resolved.value && platform.value
    ? platform.value.buildEmbed(resolved.value, { autoplay: false })
    : '',
)

/** 不同平台官方组件的推荐高度；YouTube/B站用 16:9 自适应 */
const previewFrameStyle = computed(() => {
  if (!resolved.value || !platform.value) return {}
  const k = platform.value.key
  const t = resolved.value.media_type
  if (k === 'youtube' || k === 'bilibili') return { aspectRatio: '16 / 9' }
  if (k === 'netease') return { height: t === 'album' ? '450px' : '86px' }
  if (k === 'spotify') return { height: t === 'album' ? '380px' : '152px' }
  if (k === 'apple_music') return { height: t === 'album' ? '450px' : '175px' }
  if (k === 'soundcloud') return { height: '330px' }
  if (k === 'deezer') return { height: t === 'album' ? '380px' : '260px' }
  if (k === 'tidal') return { height: t === 'album' ? '300px' : '200px' }
  if (k === 'bandcamp') return { height: t === 'album' ? '410px' : '120px' }
  return { height: '200px' }
})

// ============ 贡献者昵称搜索（与歌词投稿页同一套：全量、不按标签过滤） ============
const contributorOptions = ref<Contributor[]>([])
const contributorLoading = ref(false)
const allContributors = ref<Contributor[]>([])
const currentQuery = ref('')
const isNewContributor = ref(false)
let contributorSearchTimer: ReturnType<typeof setTimeout> | null = null

async function loadAllContributorsOnce() {
  if (allContributors.value.length > 0) return allContributors.value
  try {
    const list = await api.getContributors()
    // 与歌词投稿页一致：排除站长本人
    allContributors.value = (list || []).filter(c => !c.is_owner)
  } catch (e) {
    console.error('load contributors failed', e)
  }
  return allContributors.value
}

onMounted(() => {
  loadAllContributorsOnce()
})

async function searchContributors(query: string) {
  currentQuery.value = (query || '').trim()
  if (contributorSearchTimer) clearTimeout(contributorSearchTimer)
  contributorLoading.value = true
  contributorSearchTimer = setTimeout(async () => {
    try {
      const list = await loadAllContributorsOnce()
      const q = (query || '').trim().toLowerCase()
      contributorOptions.value = q
        ? list.filter(c => (c.name || '').toLowerCase().includes(q)).slice(0, 20)
        : list.slice(0, 20)
    } finally {
      contributorLoading.value = false
    }
  }, 200)
}

/** 仅当选中已有贡献者时返回对象；新建昵称返回 null（pending 阶段只存快照名，审核通过才建账号） */
const selectedContributor = computed(() => {
  if (isNewContributor.value) return null
  const name = (form.name || '').trim()
  if (!name) return null
  return allContributors.value.find(c => c.name === name) || null
})

function onContributorNameChange(val: string | null | undefined) {
  if (val && typeof val === 'string' && val.startsWith('__NEW__:')) {
    form.name = val.slice('__NEW__:'.length)
    isNewContributor.value = true
  } else {
    form.name = val || ''
    isNewContributor.value = false
  }
}

// ============ 联系方式动态行 ============
function addContact() {
  const used = new Set(form.contacts.map(c => c.type).filter(Boolean))
  const next = CONTACT_TYPES.find(t => !used.has(t)) || CONTACT_TYPES[0]
  form.contacts.push({ type: next, value: '' })
}
function removeContact(idx: number) {
  form.contacts.splice(idx, 1)
}
function isContactTypeSelected(type: string, idx: number) {
  return form.contacts.some((c, i) => i !== idx && c.type === type && c.value)
}

/** 收集非空联系方式；email 不进 contact（单独写 user_email 列） */
function collectContacts(): Record<string, string> {
  const obj: Record<string, string> = {}
  for (const c of form.contacts) {
    const v = (c.value || '').trim()
    if (v) obj[c.type] = v
  }
  return obj
}

// ============ 提交（双层去重 + 写库 + 站长邮件通知） ============
const submitting = ref(false)
const submitted = ref(false)
const lastTitle = ref('')

/** 把查重结果翻译成友好提示；任一层命中即返回 true 阻断提交 */
async function blockIfDuplicate(): Promise<boolean> {
  if (!resolved.value) return true
  let hints: MusicShareDupHints
  try {
    hints = await api.getMusicShareDupHints({
      platform: resolved.value.platform,
      platform_id: resolved.value.platform_id,
      title: form.title.trim(),
      artist: form.artist.trim() || null,
    })
  } catch (e) {
    // 查重服务异常不硬阻断（DB 部分唯一索引仍会兜底），仅提醒
    console.error('dup check failed', e)
    return false
  }

  if (hints.platform_approved) {
    await ElMessageBox.alert(
      `《${hints.platform_approved.title}》已经被 ${hints.platform_approved.contributor_name} 在${musicPlatformLabel(resolved.value.platform)}分享过啦，去听听吧～`,
      '这首已被分享',
      { confirmButtonText: '知道了', type: 'info' },
    ).catch(() => {})
    return true
  }
  if (hints.song_approved) {
    await ElMessageBox.alert(
      `《${hints.song_approved.title}》${hints.song_approved.artist ? `（${hints.song_approved.artist}）` : ''}已被 ${hints.song_approved.contributor_name} 从${musicPlatformLabel(hints.song_approved.platform)}分享过，同一首歌原则上只保留一条哦。`,
      '歌曲已存在',
      { confirmButtonText: '知道了', type: 'info' },
    ).catch(() => {})
    return true
  }
  if (hints.platform_pending) {
    ElMessage.warning('该链接已有一条正在审核的分享，请勿重复提交')
    return true
  }
  if (hints.song_pending) {
    ElMessage.warning('同名同歌手的这首歌已有一条正在审核的分享，请勿重复提交')
    return true
  }
  return false
}

async function handleSubmit() {
  // ---- 基础校验（防护逻辑不省略） ----
  if (!resolved.value) {
    ElMessage.warning('请先识别平台链接并完成试播')
    return
  }
  if (!form.title.trim()) {
    ElMessage.warning('请填写标题（官方接口未带出时可手动填写）')
    return
  }
  if (form.title.trim().length > 200) {
    ElMessage.warning('标题过长（最多 200 字）')
    return
  }
  if (!form.name.trim()) {
    ElMessage.warning('请填写昵称')
    return
  }
  const email = form.email.trim()
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    ElMessage.warning('请填写正确的邮箱地址，或留空')
    return
  }
  if (form.reason.length > 200) {
    ElMessage.warning('推荐理由最多 200 字')
    return
  }

  // ---- 双层去重（同平台 ID / 跨平台同名同歌手，approved + pending） ----
  if (await blockIfDuplicate()) return

  submitting.value = true
  try {
    await api.submitMusicShare({
      platform: resolved.value.platform,
      media_type: resolved.value.media_type,
      platform_id: resolved.value.platform_id,
      source_url: resolved.value.source_url,
      title: form.title.trim(),
      artist: form.artist.trim() || null,
      cover_url: resolved.value.cover_url,
      reason: form.reason.trim() || null,
      is_own_work: form.is_own_work,
      contributor_id: selectedContributor.value?.id || null,
      submitter_name: form.name.trim(),
      submitter_contact: collectContacts(),
      user_email: email || null,
    })
    lastTitle.value = form.title.trim()
    submitted.value = true
    notifyAdmin(form.name.trim(), `【歌曲分享】${musicPlatformLabel(resolved.value.platform)} · ${form.title.trim()}`)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  } catch (e) {
    console.error('submit music share failed', e)
    // 23505 唯一索引冲突（并发下前端查重的兜底）翻译成友好提示
    const msg = String((e as { message?: string })?.message || '')
    if (/duplicate key|23505/i.test(msg)) {
      ElMessage.error('这首歌刚刚已被别人分享/提交审核，请刷新后重试')
    } else {
      ElMessage.error('提交失败，请稍后重试')
    }
  } finally {
    submitting.value = false
  }
}

/** 复用现有 mailer 的 notify 动作通知站长（与歌词投稿同端点，失败静默不阻塞） */
function notifyAdmin(userName: string, songTitle: string) {
  const base = import.meta.env.VITE_MAIL_BASE as string | undefined
  if (!base) return
  fetch(base + '/api/mailer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'notify', user_name: userName, song_title: songTitle }),
  }).catch(() => {})
}

function resetForm() {
  submitted.value = false
  resolved.value = null
  urlOrEmbed.value = ''
  resolveError.value = ''
  form.title = ''
  form.artist = ''
  form.reason = ''
  form.is_own_work = false
  // 昵称保留（同人连续分享常用），邮箱与联系方式也保留
}
</script>
