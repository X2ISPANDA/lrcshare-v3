<template>
  <main class="max-w-3xl mx-auto px-4 py-8">
    <div class="bg-white rounded-2xl shadow-sm p-8">
      <h1 class="text-3xl font-bold text-gray-800 mb-2">🎶 分享歌曲</h1>
      <p class="text-gray-500 mb-4">把你喜欢的单曲或专辑分享给大家，管理员审核通过后将出现在歌曲分享墙与浮动播放器中</p>

      <!-- 投稿须知 -->
      <div class="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
        <div class="text-sm font-semibold text-amber-800 mb-2">📌 投稿须知</div>
        <div class="text-sm text-amber-700 leading-relaxed space-y-1">
          <p>· 只接受<b>单曲</b>与<b>专辑</b>，歌单 / 合集 / 播放列表（非专辑）一律不收；</p>
          <p>· 推荐使用 <b>网易云音乐</b>：适配最好、支持逐句歌词与专辑自动联播；但会员 / 版权曲目可能无法在站内播放，或仅能播放 30~45 秒试听片段，识别时会明确标明；</p>
          <p>· <b>YouTube / SoundCloud 在中国大陆无法直接访问</b>，听众需自备网络条件，可能影响收听体验；其播放列表与 SoundCloud 的 /sets/ 合辑须由你<b>声明确认为专辑</b>，站长会人工复核，自建歌单会被拒绝；</p>
          <p>· 粘贴链接后会当场识别元数据与曲目清单并可试播验证；同一首歌原则上只保留一条分享（同平台链接、跨平台同名同歌手都会拦截）。</p>
        </div>
      </div>

      <div v-if="!submitted" class="space-y-6">
        <!-- ===== 第一步：选择平台 ===== -->
        <div class="border-b pb-6">
          <h2 class="text-lg font-semibold text-gray-700 mb-3">1️⃣ 选择平台</h2>

          <!-- 平台下拉：数组顺序即推荐优先级 -->
          <el-select v-model="platformKey" placeholder="请选择音乐平台" style="width: 100%">
            <el-option v-for="p in MUSIC_PLATFORMS" :key="p.key" :label="p.label" :value="p.key">
              <div class="flex items-center justify-between w-full gap-2">
                <span class="flex items-center gap-1.5 min-w-0">
                  <span class="inline-block w-2.5 h-2.5 rounded-full flex-none" :style="{ background: p.brandColor }"></span>
                  <span class="font-medium flex-none">{{ p.label }}</span>
                  <span
                    v-for="chip in p.chips"
                    :key="chip"
                    class="ms-chip flex-none"
                    :class="`ms-chip--${chipTone(chip)}`"
                  >{{ chip }}</span>
                </span>
                <span class="text-xs text-gray-400 flex-none">
                  {{ p.accepts.includes('album') ? '单曲 / 专辑' : '单曲' }}
                </span>
              </div>
            </el-option>
          </el-select>

          <!-- 选中平台后的醒目局限提示 -->
          <div v-if="platform" class="mt-3 rounded-lg border bg-amber-50 border-amber-300 p-3 text-[13px] leading-relaxed text-amber-800">
            <span class="font-bold">ℹ️ 平台说明：</span>{{ platform.limitation }}
          </div>
        </div>

        <!-- ===== 第二步：粘贴链接并识别 ===== -->
        <div class="border-b pb-6">
          <h2 class="text-lg font-semibold text-gray-700 mb-1">2️⃣ 粘贴链接并识别</h2>
          <p v-if="platform" class="text-sm text-gray-400 mb-3">
            到平台的歌曲 / 专辑详情页复制浏览器地址栏链接即可（{{ platform.label }} 短链也支持）
          </p>

          <el-input v-model="urlOrEmbed" clearable :placeholder="platform?.placeholder || '请先选择平台'" />

          <!-- 实时正则校验提示（未点识别也能立刻发现格式错误） -->
          <div v-if="urlOrEmbed.trim()" class="mt-1.5 text-xs" :class="inputValid ? 'text-green-600' : 'text-red-500'">
            {{ inputValid ? '✔ 链接格式看起来没问题，点「识别」继续' : `✘ ${platform?.invalidHint}` }}
          </div>

          <div class="mt-3 flex items-center gap-3">
            <el-button
              type="primary"
              :disabled="!platform || !inputValid"
              :loading="resolving || enriching"
              class="!bg-pink-500 hover:!bg-pink-600 !border-pink-500"
              @click="recognize"
            >🔍 识别并试播</el-button>
            <span v-if="resolveError" class="text-sm text-red-500">{{ resolveError }}</span>
          </div>

          <!-- 识别结果 + 试播 -->
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
              <!-- 网易云可播性三态：仅试听片段（橙）/ 完全无法播放（红）；playable 旧字段兼容 -->
              <el-tag v-if="resolved.play_mode === 'trial'" size="small" type="warning">
                仅试听片段<template v-if="resolved.trial_seconds"> · {{ resolved.trial_seconds }} 秒</template>
              </el-tag>
              <el-tag v-else-if="resolved.playable === false" size="small" type="danger">无法站内播放</el-tag>
            </div>

            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">
                  标题 <span class="text-red-500">*</span>
                  <span v-if="!resolved.need_manual" class="text-xs text-gray-400 ml-1">（来自官方接口，可修正）</span>
                  <span v-else class="text-xs text-gray-400 ml-1">（合辑无官方标题，请手填专辑名）</span>
                </label>
                <el-input v-model="form.title" placeholder="歌曲 / 专辑标题" />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">
                  歌手 / 频道
                  <span class="text-xs text-gray-400 ml-1">（选填，用于跨平台重复比对）</span>
                </label>
                <el-input v-model="form.artist" placeholder="歌手或创作者名称" />
              </div>
            </div>

            <!-- 专辑曲目快照 + 「我确认是专辑」声明 -->
            <div v-if="resolved.media_type === 'album'" class="mt-4">
              <div class="text-sm font-medium text-gray-700 mb-1">
                📀 曲目清单（共 {{ resolved.tracks?.length || 0 }} 首，识别时记录快照用于顺序连播）
              </div>
              <ol v-if="resolved.tracks?.length" class="max-h-44 overflow-auto rounded-lg border border-pink-100 bg-white/70 divide-y divide-pink-50 text-[13px] text-gray-600">
                <li v-for="(t, i) in resolved.tracks" :key="t.id" class="flex items-center gap-2 px-3 py-1.5">
                  <span class="w-6 text-right text-gray-400 flex-none">{{ i + 1 }}.</span>
                  <span class="flex-1 truncate">{{ t.title || `曲目 ${i + 1}` }}</span>
                  <span v-if="t.duration" class="text-xs text-gray-400 flex-none">{{ fmtDuration(t.duration) }}</span>
                </li>
              </ol>
              <div v-else class="text-xs text-gray-400">曲目清单抓取中…若长时间为空，请重试识别或更换链接</div>

              <!-- 合辑声明（YouTube 播放列表 / SoundCloud sets 必须勾选） -->
              <label class="mt-2 flex items-start gap-2 text-[13px] text-amber-800 cursor-pointer select-none">
                <el-checkbox v-model="albumConfirmed" />
                <span>
                  我确认这个链接是<b>一张专辑</b>，不是自建歌单 / 精选合集 / 电台
                  <template v-if="resolved.album_hint">
                    <br /><span class="text-xs text-amber-600">{{ resolved.album_hint }}</span>
                  </template>
                </span>
              </label>
            </div>

            <!-- 试播（仅在客户端识别成功后渲染，SSG 首屏不产生 iframe） -->
            <div class="mt-4">
              <div class="text-sm font-medium text-gray-700 mb-2">▶ 试播验证（与访客收听效果完全一致）</div>

              <!-- 网易云：直接调用站内统一播放器（左下角 Dock），不再使用原生音频条 -->
              <div v-if="resolved.platform === 'netease'">
                <!-- blocked：会员/版权完全锁死，无试听权益 -->
                <div v-if="resolved.playable === false" class="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-600">
                  ⚠️ {{ resolved.play_note || '该曲目为会员 / 版权受限内容，站内完全无法播放' }}
                </div>
                <!-- full / trial：粉色播放按钮，点击后左下角站内播放器开播 -->
                <template v-else>
                  <div v-if="resolved.play_mode === 'trial'" class="mb-2 text-[13px] text-amber-600">
                    ⏳ {{ resolved.play_note || '该曲目为会员曲目，站内仅可播放试听片段' }}
                  </div>
                  <button type="button" class="mss-preview-btn" @click="previewInDock">
                    <span class="mss-preview-btn__icon">
                      <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                    </span>
                    用站内播放器试听<template v-if="resolved.media_type === 'album'">整张专辑</template>
                  </button>
                </template>
              </div>

              <!-- YouTube / SoundCloud：官方嵌入组件试播 -->
              <div
                v-else
                class="rounded-lg overflow-hidden bg-black/5 border border-gray-200"
                :style="previewFrameStyle"
              >
                <iframe
                  :src="previewSrc"
                  class="w-full h-full border-0"
                  :allow="platform?.iframeAllow"
                  loading="lazy"
                  referrerpolicy="strict-origin-when-cross-origin"
                ></iframe>
              </div>
              <p class="mt-1.5 text-xs text-gray-400">
                <template v-if="resolved.platform === 'netease'">
                  点击后在左下角播放器试听；若提示会员 / 版权受限无法播放，访客同样听不到，建议换一个链接投稿。
                </template>
                <template v-else>
                  若此处提示无版权、地区限制或无法播放，说明访客也听不到，建议换一个链接投稿。
                </template>
              </p>
            </div>
          </div>
        </div>

        <!-- ===== 第三步：推荐理由 + 原创自荐 ===== -->
        <div class="border-b pb-6">
          <h2 class="text-lg font-semibold text-gray-700 mb-4">
            3️⃣ 推荐理由 <span class="text-red-500">*</span>
          </h2>
          <el-input
            v-model="form.reason"
            type="textarea"
            :rows="3"
            maxlength="200"
            show-word-limit
            placeholder="为什么想分享这首歌？必填（1~200 字），通过后会展示在首页音乐推荐上"
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
              联系方式 <span class="text-xs text-gray-400 ml-1">（选填，可添加多种；默认仅站长可见，勾选下方公开后才会对外展示）</span>
            </label>
            <div class="space-y-2">
              <div v-for="(c, idx) in form.contacts" :key="idx" class="flex gap-2 items-center">
                <el-select v-model="c.type" style="width: 120px; flex-shrink: 0">
                  <el-option v-for="t in CONTACT_TYPES" :key="t" :label="contactLabel(t)" :value="t" :disabled="isContactTypeSelected(t, idx)" />
                </el-select>
                <el-input v-model="c.value" :placeholder="contactPlaceholder(c.type) || '号码/文本'" style="flex: 1; min-width: 0" />
                <el-button type="danger" link @click="removeContact(idx)">移除</el-button>
              </div>
            </div>
            <el-button type="primary" link size="small" class="mt-1" @click="addContact">+ 添加联系方式</el-button>

            <!-- 公开意愿（与歌词投稿同一口径：默认不公开，投稿人自行勾选；未填联系方式时置灰） -->
            <div
              class="mt-2 p-3 bg-pink-50/50 rounded-lg"
              :class="{ 'opacity-50 pointer-events-none select-none': !hasAnyContact }"
            >
              <label class="flex items-start gap-2 text-sm text-gray-700 cursor-pointer">
                <input v-model="form.publicContact" type="checkbox" class="w-4 h-4 mt-0.5 accent-pink-500" :disabled="!hasAnyContact" />
                <span>
                  🔓 公开我的联系方式（默认不公开）
                  <span class="block text-xs text-gray-400 mt-1 leading-relaxed">
                    勾选后，本条通过审核并创建音乐人主页时，联系方式将展示在音乐人主页与自荐卡片上，方便听众一键跳转。
                    填错了可之后在「我要投稿」里提交资料更新，或联系站长在贡献者管理中修改。
                  </span>
                </span>
              </label>
            </div>
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
        <p class="text-center text-xs text-gray-400 mt-2">提交即表示你确认该链接来自上述平台官方页面，专辑链接确为专辑而非歌单</p>
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
import type { Contributor, MusicShare, MusicShareDupHints } from '@/lib/types'
import { useMusicPlayerStore } from '@/stores/musicPlayer'
import type { MusicResolveResult } from '@/lib/musicPlatforms'
import {
  MUSIC_PLATFORMS,
  getMusicPlatform,
  musicPlatformLabel,
  type MusicPlatformKey,
} from '@/lib/musicPlatforms'
import { enrichAlbumTracks } from '@/lib/musicAlbumEnrich'
import { contactLabel, contactPlaceholder, contactValueError, LOGO_URL as DEFAULT_LOGO } from '@/lib/constants'

useHead({ title: '分享歌曲 - LrcShare' })

/** 联系方式键（与歌词投稿页保持同一套；email 已单独成栏，此处不重复） */
const CONTACT_TYPES = ['qq', 'wechat', 'bilibili', 'github', 'blog', 'douyin', 'weibo', 'twitter', 'xiaohongshu', 'netease', 'homepage', 'phone', 'mobile']

// ============ 平台选择 + 输入 ============
const platformKey = ref<MusicPlatformKey>('netease')
const platform = computed(() => getMusicPlatform(platformKey.value))

/** 选项 chips 的色调：good=推荐/体验优势；warn=网络或合辑声明类局限；neutral=其他补充说明 */
function chipTone(chip: string): 'good' | 'warn' | 'neutral' {
  if (chip.includes('声明') || chip.includes('自备网络')) return 'warn'
  if (chip.includes('推荐') || chip.includes('歌词')) return 'good'
  return 'neutral'
}
const urlOrEmbed = ref('')
const resolving = ref(false)
/** 合辑曲目清单前端抓取中（YouTube 列表 / SoundCloud sets） */
const enriching = ref(false)
const resolveError = ref('')
const resolved = ref<MusicResolveResult | null>(null)
/** 专辑合辑声明确认（必须勾选才能提交专辑） */
const albumConfirmed = ref(false)

const form = reactive({
  title: '',
  artist: '',
  reason: '',
  is_own_work: false,
  name: '',
  email: '',
  contacts: [{ type: CONTACT_TYPES[0], value: '' }],
  // 联系方式公开意愿（与歌词投稿同口径，默认不公开；提交时落 submitter_public_contact）
  publicContact: false,
})

/** 是否填了至少一条非空联系方式：没有时公开勾选无意义，置灰且提交时强制按 false 处理 */
const hasAnyContact = computed(() => form.contacts.some(c => !!(c.value || '').trim()))

// 联系方式被清空到一条不剩时，连带取消公开意愿，避免不可用状态携带旧值提交
watch(hasAnyContact, has => {
  if (!has) form.publicContact = false
})

// 切换平台或修改输入后，旧的识别结果作废（避免拿着 A 平台结果配 B 平台链接提交）
watch([platformKey, urlOrEmbed], () => {
  resolved.value = null
  resolveError.value = ''
  albumConfirmed.value = false
})

/** 实时格式校验 */
const inputValid = computed(() => {
  const p = platform.value
  if (!p) return false
  const v = urlOrEmbed.value.trim()
  if (!v) return false
  return p.inputPattern.test(v)
})

/** 识别：调 Netlify 函数（服务端复核 + 官方元数据 + 网易云专辑曲目），成功后补抓合辑曲目并渲染试播 */
async function recognize() {
  if (!platform.value || !inputValid.value) return
  resolving.value = true
  resolveError.value = ''
  albumConfirmed.value = false
  try {
    const data = await api.resolveMusicShare(platformKey.value, urlOrEmbed.value.trim())
    resolved.value = data
    form.title = data.title || ''
    form.artist = data.artist || ''
    // YouTube 播放列表 / SoundCloud sets：后端只给元数据，曲目清单由前端官方 API 抓取快照
    if (data.media_type === 'album' && (!data.tracks || !data.tracks.length)) {
      await enrichResolvedTracks(data)
    }
  } catch (e) {
    resolved.value = null
    resolveError.value = e instanceof Error ? e.message : '识别失败，请稍后重试'
  } finally {
    resolving.value = false
  }
}

// ============ 合辑曲目快照前端抓取（与后台手动添加共用同一份抓取逻辑） ============
/** 按平台抓取合辑曲目快照，写入 resolved.tracks；失败给中文提示但保留识别结果（专辑仍可见声明区） */
async function enrichResolvedTracks(data: MusicResolveResult) {
  enriching.value = true
  try {
    const tracks = await enrichAlbumTracks(data)
    if (tracks.length) data.tracks = tracks
  } catch (e) {
    resolveError.value = e instanceof Error ? e.message : '曲目清单抓取失败'
  } finally {
    enriching.value = false
  }
}

// ============ 试播 ============
/** YouTube / SoundCloud 官方嵌入地址（不自动播放） */
const previewSrc = computed(() =>
  resolved.value && platform.value?.buildEmbed
    ? platform.value.buildEmbed(resolved.value, { autoplay: false })
    : '',
)

/** 试播容器尺寸：YT 16:9；SC 单曲/合辑高度 */
const previewFrameStyle = computed((): Record<string, string> => {
  const r = resolved.value
  if (!r) return {}
  if (r.platform === 'youtube') return { aspectRatio: '16 / 9' }
  return { height: r.media_type === 'album' ? '380px' : '200px' }
})

// ============ 网易云试播：直接交给站内统一播放器（左下角 Dock） ============
// 与访客审核通过后听到的是同一条链路（music-stream 实时取链），试播结论才真实可信。
const player = useMusicPlayerStore()

/** 由识别结果构造临时 MusicShare（不入库，仅用于播放器；字段对齐 MusicShare 类型） */
const previewShare = computed<MusicShare | null>(() => {
  const r = resolved.value
  if (!r || r.platform !== 'netease') return null
  return {
    id: `__preview__${r.platform}_${r.platform_id}`,
    platform: r.platform,
    media_type: r.media_type,
    platform_id: r.platform_id,
    source_url: r.source_url,
    // 用户可在表单里修正标题/歌手，试播跟随最新值
    title: form.title.trim() || r.title,
    artist: form.artist.trim() || r.artist || null,
    cover_url: r.cover_url,
    tracks: r.media_type === 'album' ? r.tracks || null : null,
    reason: null,
    is_own_work: false,
    contributor_id: null,
    submitter_name: '投稿试播',
    submitter_contact: null,
    submitter_public_contact: false,
    user_email: null,
    sort: 0,
    status: 'pending',
    reject_reason: null,
    reviewed_at: null,
    approved_at: null,
    created_at: '',
    updated_at: '',
  }
})

/** 点击粉色试听按钮：单曲只播这一首；专辑展开整张快照队列 */
function previewInDock() {
  const s = previewShare.value
  if (!s) return
  player.playShare(s, [s])
}

/** 曲目快照时长秒 → m:ss */
function fmtDuration(sec: number): string {
  if (!sec || !isFinite(sec)) return ''
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

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
  // 专辑：必须有曲目快照 + 投稿人明确声明确认是专辑
  if (resolved.value.media_type === 'album') {
    if (!resolved.value.tracks?.length) {
      ElMessage.warning('专辑曲目清单尚未抓取成功，请重新识别后再提交')
      return
    }
    if (!albumConfirmed.value) {
      ElMessage.warning('请勾选「我确认这个链接是一张专辑」后再提交')
      return
    }
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
  if (!form.reason.trim()) {
    ElMessage.warning('请填写推荐理由（1~200 字）')
    return
  }
  if (form.reason.trim().length > 200) {
    ElMessage.warning('推荐理由最多 200 字')
    return
  }
  // 联系方式：平台主页类（B站/GitHub/网易云等）必须填完整 http(s) 链接，号码/文本类不限制
  for (const c of form.contacts) {
    const t = (c.type || '').trim()
    const v = (c.value || '').trim()
    if (t && v) {
      const err = contactValueError(t, v)
      if (err) {
        ElMessage.warning(err)
        return
      }
    }
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
      // 专辑曲目快照：单曲 null；网易云后端已给，YT/SC 前端刚抓取
      tracks: resolved.value.media_type === 'album' ? resolved.value.tracks || null : null,
      reason: form.reason.trim(),
      is_own_work: form.is_own_work,
      contributor_id: selectedContributor.value?.id || null,
      submitter_name: form.name.trim(),
      submitter_contact: collectContacts(),
      // 公开意愿：没填任何联系方式时恒为 false（勾选框此时已置灰并被 watch 清过一次，这里再兜底）
      submitter_public_contact: hasAnyContact.value && form.publicContact,
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
  albumConfirmed.value = false
  form.title = ''
  form.artist = ''
  form.reason = ''
  form.is_own_work = false
  // 昵称保留（同人连续分享常用），邮箱与联系方式也保留
}
</script>

<style scoped>
/* 平台下拉选项内的局限标签 chips */
.ms-chip {
  display: inline-block;
  padding: 0 6px;
  border-radius: 9999px;
  font-size: 11px;
  line-height: 18px;
  white-space: nowrap;
}
.ms-chip--good {
  background: #ecfdf5;
  color: #059669;
}
.ms-chip--warn {
  background: #fff7ed;
  color: #ea580c;
}
.ms-chip--neutral {
  background: #f3f4f6;
  color: #6b7280;
}

/* 网易云试播按钮：与站点播放器同款粉紫渐变胶囊（替代原原生音频条） */
.mss-preview-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 20px;
  border: none;
  border-radius: 999px;
  background: linear-gradient(135deg, #ec4899, #a855f7);
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(236, 72, 153, 0.35);
  transition: transform 0.15s, box-shadow 0.15s;
}
.mss-preview-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(236, 72, 153, 0.45);
}
.mss-preview-btn:active {
  transform: translateY(0);
}
.mss-preview-btn__icon {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.22);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding-left: 2px;
}
</style>
