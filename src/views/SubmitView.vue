<template>
  <main class="max-w-3xl mx-auto px-4 py-8">
    <div class="bg-white rounded-2xl shadow-sm p-8">
      <h1 class="text-3xl font-bold text-gray-800 mb-2">📝 投稿歌词</h1>
      <p class="text-gray-500 mb-4">提交你的歌词作品，管理员审核通过后将发布到网站</p>

      <!-- 投稿须知 -->
      <div class="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
        <div class="text-sm font-semibold text-amber-800 mb-2">📌 投稿须知</div>
        <div class="text-sm text-amber-700 leading-relaxed">
          本网站专注于收集<span class="font-semibold">音乐平台上没有滚动歌词</span>或<span class="font-semibold">因各种原因已下架</span>歌曲的歌词。<br />
          如果网易云、QQ音乐等平台已有该歌曲的滚动歌词，请勿重复投稿。
        </div>
      </div>

      <div v-show="!submitted" class="space-y-6">
        <!-- ===== 你的信息 ===== -->
        <div class="border-b pb-6">
          <h2 class="text-lg font-semibold text-gray-700 mb-4">👤 你的信息</h2>

          <!-- 昵称：远程搜索已有贡献者 / 新建 -->
          <div class="mb-4">
            <label class="block text-sm font-medium text-gray-700 mb-1">昵称 <span class="text-red-500">*</span></label>
            <el-select
              :model-value="userForm.name"
              filterable
              remote
              clearable
              :reserve-keyword="false"
              placeholder="搜索并选择已有贡献者，或输入新昵称后点选下方蓝色新建项"
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
              <el-option v-if="currentQuery" key="__new__" :label="`➕ 新建贡献者「${currentQuery}」`" :value="`__NEW__:${currentQuery}`">
                <span class="text-blue-500 font-medium">➕ 新建贡献者「{{ currentQuery }}」</span>
              </el-option>
            </el-select>
            <div v-if="isNewContributor" class="text-xs text-blue-600 mt-1">
              将作为新贡献者「{{ userForm.name }}」创建（即使数据库已有同名贡献者，也不会自动挂到他人账号下）
            </div>
          </div>

          <!-- 选中已有贡献者的提示条 -->
          <el-alert v-if="selectedContributor" type="warning" :closable="false" show-icon class="mb-4">
            <template #title>
              你选择了已有贡献者 <b>{{ selectedContributor.name }}</b>
            </template>
            由于没有登录流程，我们不会预填你的联系方式等隐私数据到表单。<br />
            只是想用你之前的身份投稿 → <b>下方信息不用再填</b>，直接去填歌曲信息即可。<br />
            如需<b>更新</b>你的联系方式/简介，或需要<b>清空</b>之前填过的所有信息，请勾选下方对应选项。
          </el-alert>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-4">
            <!-- 邮箱 -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">
                邮箱
                <span v-if="!selectedContributor" class="text-red-500">*</span>
                <span v-else class="text-xs text-gray-400 ml-1">（选填，填了可收到审核邮件）</span>
              </label>
              <input
                type="email"
                v-model="userForm.email"
                :disabled="!!(selectedContributor && !userForm.request_update)"
                class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                placeholder="用于接收审核结果通知"
              />
            </div>

            <!-- 简介 -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">
                简介
                <span class="text-xs text-gray-400 ml-1">（选填）</span>
              </label>
              <input
                type="text"
                v-model="userForm.bio"
                :disabled="!!(selectedContributor && !userForm.request_update)"
                class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
                placeholder="一句话介绍自己"
              />
            </div>
          </div>

          <!-- 联系方式动态行 -->
          <div class="mt-4">
            <label class="block text-sm font-medium text-gray-700 mb-1">
              联系方式
              <span class="text-xs text-gray-400 ml-1">（选填，可添加多种方式）</span>
            </label>
            <div class="space-y-2">
              <div v-for="(c, idx) in userForm.contacts" :key="idx" class="flex gap-2 items-center">
                <el-select v-model="c.type" style="width: 110px; flex-shrink: 0" :disabled="!!(selectedContributor && !userForm.request_update)">
                  <el-option v-for="t in CONTACT_TYPES" :key="t" :label="t" :value="t" :disabled="isContactTypeSelected(t, idx)" />
                </el-select>
                <el-input v-model="c.value" placeholder="号码/链接" style="flex: 1; min-width: 0" :disabled="!!(selectedContributor && !userForm.request_update)" />
                <el-button type="danger" link :disabled="!!(selectedContributor && !userForm.request_update)" @click="removeContact(idx)">移除</el-button>
              </div>
            </div>
            <el-button
              type="primary"
              link
              size="small"
              class="mt-1"
              :disabled="!!(selectedContributor && !userForm.request_update)"
              @click="addContact"
            >+ 添加联系方式</el-button>
          </div>

          <!-- 更新/清空 选项（仅选中已有贡献者显示） -->
          <div v-if="selectedContributor" class="mt-5 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
            <div class="text-sm font-medium text-blue-800 mb-2">🛠️ 对已有贡献者资料的操作</div>
            <label class="flex items-start gap-2 text-sm text-blue-900 cursor-pointer select-none">
              <el-checkbox v-model="userForm.request_update" @change="onRequestUpdateChange" />
              <span>
                <b>更新我的信息</b><br />
                <span class="text-xs text-blue-700">勾选后解锁上方邮箱/联系方式/简介，本次填写的内容将在审核通过时<b>全量覆盖</b>你在贡献者库里的对应字段。</span>
              </span>
            </label>
            <label class="flex items-start gap-2 text-sm text-blue-900 cursor-pointer select-none">
              <el-checkbox v-model="userForm.request_clear" @change="onRequestClearChange" />
              <span>
                <b>清空我的信息</b><br />
                <span class="text-xs text-blue-700">勾选后上方输入保持禁用；审核通过时把该贡献者除 ID、昵称、标签外的所有字段置空。要删除 ID 请联系管理员。</span>
              </span>
            </label>
          </div>

          <!-- 公开选项 -->
          <div
            class="mt-4 p-3 bg-pink-50/50 rounded-lg space-y-2"
            :class="{ 'opacity-50 pointer-events-none': selectedContributor && !userForm.request_update }"
          >
            <div class="text-sm font-medium text-gray-700 mb-2">🔓 信息公开（默认不公开，勾选后将在贡献者页面展示）</div>
            <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" v-model="userForm.public_contact" class="w-4 h-4 accent-pink-500" />
              <span>公开联系方式（联系方式将展示在贡献者主页）</span>
            </label>
            <div class="text-xs text-gray-500 mt-2">
              💡 想进入 <RouterLink to="/contributors" target="_blank" class="text-pink-600 hover:underline">贡献者名单</RouterLink>？勾选公开选项，并通过更多投稿让作品被审核通过即可！
            </div>
          </div>
        </div>

        <!-- ===== 歌曲信息 ===== -->
        <div class="border-b pb-6">
          <h2 class="text-lg font-semibold text-gray-700 mb-4">🎵 歌曲信息</h2>
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">歌曲名 <span class="text-red-500">*</span></label>
              <input
                v-model="song.title"
                type="text"
                class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
              />
            </div>

            <!-- 歌手（多选 tag） -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">歌手 <span class="text-red-500">*</span></label>
              <ArtistTagInput v-model="song.artists" :artists="allArtists" :session-names="sessionNewArtists" filter-type="singer" />
            </div>

            <!-- 专辑（单选 + 自动填充专辑艺术家/年份） -->
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

            <!-- 专辑艺术家（多选 tag，选已有专辑时自动填充） -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">专辑艺术家</label>
              <ArtistTagInput v-model="song.albumArtists" :artists="allArtists" :session-names="sessionNewArtists" :filter-type="null" tone="gray" />
              <div class="text-xs text-gray-400 mt-1">如唱片公司、音乐平台等，不限于歌手</div>
            </div>

            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">时长</label>
              <input
                v-model="song.duration"
                type="text"
                class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                placeholder="如：03:30"
              />
            </div>

            <!-- 作词（多选 tag） -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">作词</label>
              <ArtistTagInput v-model="song.lyricists" :artists="allArtists" :session-names="sessionNewArtists" filter-type="lyricist" />
            </div>

            <!-- 作曲（多选 tag） -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">作曲</label>
              <ArtistTagInput v-model="song.composers" :artists="allArtists" :session-names="sessionNewArtists" filter-type="composer" />
            </div>
          </div>
        </div>

        <!-- 视频链接 -->
        <div class="border-b pb-6">
          <h2 class="text-lg font-semibold text-gray-700 mb-4">🎬 视频链接 <span class="text-xs text-gray-400 font-normal">（选填）</span></h2>
          <p class="text-sm text-gray-500 mb-2">如有歌曲视频（B站/YouTube），可粘贴链接，将在歌曲页展示视频播放器</p>
          <input
            v-model="song.videoUrl"
            type="text"
            class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
            placeholder="如：https://www.bilibili.com/video/BV1xx... 或 https://www.youtube.com/watch?v=xxx"
          />
        </div>

        <!-- 歌词内容 -->
        <div>
          <h2 class="text-lg font-semibold text-gray-700 mb-4">📝 LRC 歌词内容</h2>
          <p class="text-sm text-gray-500 mb-2">
            粘贴完整的 LRC 格式歌词，包括时间轴标签。例如：<br />
            <code class="bg-gray-100 px-2 py-1 rounded text-xs">[ti:歌曲名]<br />[ar:歌手]<br />[00:01.00] 歌词内容</code>
          </p>
          <textarea
            v-model="song.lrcText"
            rows="12"
            required
            class="w-full px-4 py-2 border border-gray-200 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
            placeholder="在此粘贴完整的LRC歌词..."
          ></textarea>
        </div>

        <!-- 提交按钮 -->
        <div class="flex items-center gap-4">
          <button
            :disabled="submitting"
            class="px-8 py-3 bg-pink-500 text-white font-medium rounded-xl hover:bg-pink-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
            @click="handleSubmit"
          >{{ submitting ? '提交中...' : '提交审核' }}</button>
          <RouterLink to="/" class="text-gray-500 hover:text-gray-700">返回首页</RouterLink>
        </div>
      </div>

      <!-- 提交成功 -->
      <div v-show="submitted" class="text-center py-12">
        <div class="text-6xl mb-4">✅</div>
        <h2 class="text-2xl font-bold text-gray-800 mb-2">提交成功！</h2>
        <p class="text-gray-500 mb-6">
          我们已经收到您的歌词投稿，管理员会尽快审核。<br v-if="userForm.email" />审核结果将通过邮件通知您，请留意查收。
        </p>
        <RouterLink to="/" class="px-6 py-2 bg-pink-500 text-white rounded-lg hover:bg-pink-600">返回首页</RouterLink>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useHead } from '@unhead/vue'
import { api } from '@/lib/api'
import type { Artist, Contributor } from '@/lib/types'
import ArtistTagInput from '@/components/submit/ArtistTagInput.vue'
import type { AlbumWithArtists } from '@/lib/types'

useHead({ title: '投稿歌词 - LrcShare' })

const DEFAULT_LOGO = 'https://i0.hdslb.com/bfs/article/a2323ad6e33924c39061b35ae29f9fd937977624.png'
const CONTACT_TYPES = ['QQ', '微信', 'B站', 'GitHub', '博客', '抖音', '微博', 'Twitter', '小红书', '网易音乐人', '个人主页', '电话', '手机']

// ============ 全量数据（客户端加载，供 tag 过滤/专辑联想/贡献者搜索） ============
const allArtists = ref<Artist[]>([])
const allAlbums = ref<AlbumWithArtists[]>([])

onMounted(async () => {
  try {
    const [artists, albums] = await Promise.all([api.getArtists(), api.getAlbums()])
    allArtists.value = artists
    allAlbums.value = albums
  } catch (e) {
    console.error('加载艺术家/专辑数据失败', e)
  }
})

// ============ 用户信息 ============
const userForm = reactive({
  name: '',
  email: '',
  bio: '',
  contacts: [{ type: CONTACT_TYPES[0], value: '' }],
  public_contact: false,
  request_update: false,
  request_clear: false,
})

// 贡献者远程搜索
const contributorOptions = ref<Contributor[]>([])
const contributorLoading = ref(false)
const allContributors = ref<Contributor[]>([]) // 缓存全量（排除站长），用于精确匹配
const currentQuery = ref('')
const isNewContributor = ref(false)
let contributorSearchTimer: ReturnType<typeof setTimeout> | null = null

async function loadAllContributorsOnce() {
  if (allContributors.value.length > 0) return allContributors.value
  try {
    const list = await api.getContributors()
    allContributors.value = (list || []).filter(c => !c.is_owner)
  } catch (e) {
    console.error('load contributors failed', e)
  }
  return allContributors.value
}

// onMounted 中触发（SSG 构建时不发请求）
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

/** 仅当用户点选了已有项时返回对象；点选"新建"项返回 null */
const selectedContributor = computed(() => {
  if (isNewContributor.value) return null
  const name = (userForm.name || '').trim()
  if (!name) return null
  return allContributors.value.find(c => c.name === name) || null
})

function onContributorNameChange(val: string | null | undefined) {
  if (val && typeof val === 'string' && val.startsWith('__NEW__:')) {
    userForm.name = val.slice('__NEW__:'.length)
    isNewContributor.value = true
  } else {
    userForm.name = val || ''
    isNewContributor.value = false
  }
  if (!selectedContributor.value) {
    userForm.request_update = false
    userForm.request_clear = false
  }
}

function onRequestUpdateChange(val: boolean | string | number) {
  if (val) userForm.request_clear = false
}
function onRequestClearChange(val: boolean | string | number) {
  if (val) userForm.request_update = false
}

function addContact() {
  const usedTypes = new Set(userForm.contacts.map(c => c.type).filter(Boolean))
  const nextType = CONTACT_TYPES.find(t => !usedTypes.has(t)) || CONTACT_TYPES[0]
  userForm.contacts.push({ type: nextType, value: '' })
}
function removeContact(idx: number) {
  if (userForm.contacts.length <= 1) {
    userForm.contacts[0].value = ''
    return
  }
  userForm.contacts.splice(idx, 1)
}
function isContactTypeSelected(type: string, currentIdx: number) {
  return userForm.contacts.some((c, i) => i !== currentIdx && c.type === type)
}
function collectContactsObj(): Record<string, string> {
  const obj: Record<string, string> = {}
  userForm.contacts.forEach(c => {
    const t = (c.type || '').trim()
    const v = (c.value || '').trim()
    if (t && v) obj[t] = v
  })
  return obj
}

// ============ 歌曲信息 ============
const song = reactive({
  title: '',
  artists: [] as { id: string | null; name: string }[],
  albumArtists: [] as { id: string | null; name: string }[],
  lyricists: [] as { id: string | null; name: string }[],
  composers: [] as { id: string | null; name: string }[],
  duration: '',
  lrcText: '',
  videoUrl: '',
})

// 会话内新建艺术家共享池：从各字段当前值实时派生（id 为 null 即本次新建），删除 tag 后自动出池
const sessionNewArtists = computed(() => {
  const names: string[] = []
  for (const arr of [song.artists, song.albumArtists, song.lyricists, song.composers]) {
    for (const t of arr) {
      if (t.id === null && t.name && !names.includes(t.name)) names.push(t.name)
    }
  }
  return names
})

// 专辑联想（单选；选中已有专辑 → 记录 id 并自动填充专辑艺术家/年份）
const albumName = ref('')
const albumYear = ref('')
const albumId = ref<string | null>(null)
const albumDropdown = ref<AlbumWithArtists[]>([])
const albumDropdownOpen = ref(false)

function onAlbumInput() {
  albumId.value = null // 手动输入即视为新专辑
  const q = albumName.value.trim().toLowerCase()
  if (!q) {
    albumDropdown.value = []
    albumDropdownOpen.value = false
    return
  }
  albumDropdown.value = allAlbums.value.filter(a => a.name.toLowerCase().includes(q)).slice(0, 8)
  albumDropdownOpen.value = true
}

function selectAlbum(a: AlbumWithArtists) {
  albumName.value = a.name
  albumId.value = a.id
  albumDropdownOpen.value = false
  // 用该专辑的 artist_ids 填充专辑艺术家 tag，年份一并填充
  albumYear.value = a.year ? String(a.year) : ''
  const ids = a.artist_ids || []
  const artistObjs = ids
    .map(id => allArtists.value.find(x => x.id === id))
    .filter((x): x is Artist => !!x)
    .map(x => ({ id: x.id, name: x.name }))
  if (artistObjs.length) song.albumArtists = artistObjs
}

// ============ 提交 ============
const submitted = ref(false)
const submitting = ref(false)

async function handleSubmit() {
  const name = (userForm.name || '').trim()
  const email = (userForm.email || '').trim()

  // 校验
  if (!name) {
    ElMessage.warning('请填写昵称')
    return
  }
  if (!selectedContributor.value && !email) {
    ElMessage.warning('请填写邮箱')
    return
  }
  if (email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      ElMessage.warning('请填写正确的邮箱地址')
      return
    }
  }
  if (!song.title.trim() || song.artists.length === 0 || !albumName.value.trim() || !song.lrcText.trim()) {
    ElMessage.warning('请填写所有必填的歌曲字段（歌曲名/歌手/专辑/歌词）')
    return
  }
  if (albumYear.value.trim() && !/^\d{4}$/.test(albumYear.value.trim())) {
    ElMessage.warning('专辑年份请填写 4 位数字（如 2024），或留空')
    return
  }
  if (selectedContributor.value && userForm.request_clear && userForm.request_update) {
    ElMessage.warning('更新信息和清空信息不能同时勾选')
    return
  }

  // 联系方式：邮箱始终加入 contact_value（用于通知）；其他联系方式仅在新建/更新贡献者时添加
  const contactObj: Record<string, string> = {}
  if (email) contactObj['邮箱'] = email
  if (!(selectedContributor.value && !userForm.request_update)) {
    Object.assign(contactObj, collectContactsObj())
  }
  const contactTypes = Object.keys(contactObj)

  const songData = {
    type: 'song',
    title: song.title.trim(),
    // 多艺术家数组（新格式，后台审核时使用）
    artists: song.artists.slice(),
    album_artists: song.albumArtists.slice(),
    lyricist_arr: song.lyricists.slice(),
    composer_arr: song.composers.slice(),
    // 兼容旧字段：拼接字符串（供后台列表展示）
    artist: song.artists.map(a => a.name).join(' / '),
    album_artist: song.albumArtists.map(a => a.name).join(' / '),
    lyricist: song.lyricists.map(a => a.name).join(' / '),
    composer: song.composers.map(a => a.name).join(' / '),
    album: albumName.value.trim(),
    album_id: albumId.value,
    year: albumYear.value.trim() || undefined,
    duration: song.duration.trim(),
    lrc_text: song.lrcText.trim(),
    video_url: song.videoUrl.trim(),
  }

  submitting.value = true
  try {
    await api.submitSubmissionV2({
      submitter_name: name,
      contact_types: contactTypes,
      contact_value: contactObj,
      submitter_public_contact: !!userForm.public_contact,
      contributor_id: selectedContributor.value ? selectedContributor.value.id : null,
      submitter_request_update: !!(selectedContributor.value && userForm.request_update),
      submitter_request_clear: !!(selectedContributor.value && userForm.request_clear),
      submitter_bio: selectedContributor.value && !userForm.request_update ? null : userForm.bio || null,
      song_data: songData,
    })
    submitted.value = true
    window.scrollTo({ top: 0, behavior: 'smooth' })
    // 新投稿通知站长（fire-and-forget：邮件失败不影响投稿结果）
    notifyAdminNewSubmission(name, songData.title)
  } catch (err) {
    console.error(err)
    ElMessage.error('网络错误，请稍后重试')
  } finally {
    submitting.value = false
  }
}

/** 调用邮件服务（Netlify Functions mailer.mjs 的 notify action）通知站长收到新投稿 */
function notifyAdminNewSubmission(userName: string, songTitle: string) {
  const base = import.meta.env.VITE_MAIL_BASE as string | undefined
  if (!base) return
  fetch(base + '/api/mailer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'notify', user_name: userName, song_title: songTitle }),
  }).catch(() => {}) // 静默失败：通知是附带能力，不阻塞投稿流程
}
</script>

<style>
/* Element Plus 输入框与 Tailwind 风格对齐（投稿页内 el-input/el-select/el-checkbox） */
.el-input__wrapper {
  padding: 4px 11px;
  box-shadow: 0 0 0 1px #e5e7eb inset;
  border-radius: 0.5rem;
}
.el-select .el-input.is-focus .el-input__wrapper,
.el-input.is-focus .el-input__wrapper {
  box-shadow: 0 0 0 1px #ec4899 inset, 0 0 0 1px #ec4899;
}
.el-textarea__inner {
  border: 1px solid #e5e7eb;
  border-radius: 0.5rem;
}
.el-form-item {
  margin-bottom: 0;
}
.el-checkbox {
  --el-checkbox-checked-bg-color: #ec4899;
  --el-checkbox-checked-border-color: #ec4899;
}
.el-alert {
  border-radius: 0.75rem;
}
</style>
