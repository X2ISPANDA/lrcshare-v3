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

      <!-- 投稿模式切换：新歌曲 / 为已有歌曲补充版本 -->
      <div v-show="!submitted" class="flex rounded-lg border border-gray-200 p-1 mb-6 text-sm">
        <button
          type="button"
          class="flex-1 py-2 rounded-md transition-colors cursor-pointer"
          :class="submitMode === 'song' ? 'bg-pink-500 text-white font-medium' : 'text-gray-500 hover:text-gray-700'"
          @click="submitMode = 'song'"
        >🎵 投稿新歌曲</button>
        <button
          type="button"
          class="flex-1 py-2 rounded-md transition-colors cursor-pointer"
          :class="submitMode === 'version' ? 'bg-pink-500 text-white font-medium' : 'text-gray-500 hover:text-gray-700'"
          @click="submitMode = 'version'"
        >➕ 为已有歌曲补充版本</button>
      </div>

      <div v-show="!submitted && submitMode === 'version'">
        <h2 class="text-lg font-semibold text-gray-700 mb-1">🎶 补充歌词版本</h2>
        <p class="text-sm text-gray-500 mb-5">为站内已有的歌曲补充 TTML 或逐字 LRC 歌词版本，审核通过后将挂到该歌曲下。</p>
        <VersionSubmitPanel @submitted="onVersionSubmitted" />
      </div>

      <div v-show="!submitted && submitMode === 'song'" class="space-y-6">
        <!-- ===== 你的信息 ===== -->
        <div class="border-b pb-6">
          <h2 class="text-lg font-semibold text-gray-700 mb-4">👤 你的信息</h2>

          <!-- 投稿人身份：昵称/邮箱/简介/联系方式/更新·清空/公开（歌词页与歌曲分享页共用组件） -->
          <SubmitterIdentityPanel
            ref="identityRef"
            :model-value="userForm"
            variant="lyric"
            :require-email-for-new="true"
            show-profile-only-button
            :submitting="submitting"
            @update:model-value="onIdentityUpdate"
            @profile-submit="handleProfileSubmit"
          />
        </div>

        <!-- 上传须知（投稿前必看，单曲/批量都适用） -->
        <div class="text-sm text-red-700 bg-red-50 border border-red-300 rounded-lg px-4 py-3 mb-6 space-y-2">
          <p class="font-semibold text-red-800">⚠️ 注意事项</p>
          <div>
            <p class="font-medium">1. 翻译歌词（多语）这样写：同一时间结构，每种语言各一行</p>
            <div class="mt-1 ml-4 font-mono space-y-1">
              <p>逐行：[00:10.00]Hello World　/　[00:10.00]你好世界</p>
              <p>逐字：[00:10.00]Hello[00:10.50]World[00:10.59]　/　[00:10.00]你好世界</p>
              <p>加强逐字：[00:10.00]Hello&lt;00:10.50&gt;World&lt;00:10.59&gt;　/　[00:10.00]你好世界</p>
              <p>TTML（同 begin）：&lt;p begin="00:00:10.000"&gt;Hello World&lt;/p&gt;　/　&lt;p begin="00:00:10.000"&gt;你好世界&lt;/p&gt;</p>
            </div>
          </div>
          <div>
            <p class="font-medium">2. 禁止同语言多行相同时间戳</p>
            <p>例如:</p>
            <p class="mt-1 ml-4">a. 给单词加注解，写进括号，别拆两行：<span class="font-mono">[00:10.00]Jah Rastafari(耶和华塔法里教)</span></p>
            <p class="ml-4">b. 创作者信息错开时间戳，别堆同一时间点：<span class="font-mono">[00:00:00]作词:XX　[00:01:00]作曲:XX</span></p>
          </div>
          <div>
            <p class="font-medium">3. 每行歌词都要有时间戳</p>
            <p class="mt-1 ml-4">a. 没有 <span class="font-mono">[mm:ss]</span> 的裸文本行会被整行丢弃，不会入库</p>
          </div>
          <div>
            <p class="font-medium">4. 时间戳必须带毫秒（至少 2 位小数）</p>
            <p class="mt-1 ml-4">a. <span class="font-mono">[00:10]</span>（无毫秒）、<span class="font-mono">[00:10.5]</span>（仅 1 位）无法识别，整行会被丢弃</p>
            <p class="ml-4">b. 正确写法：<span class="font-mono">[00:10.00]</span> 或 <span class="font-mono">[00:10.000]</span></p>
          </div>
          <div>
            <p class="font-medium">5. 译文时间戳必须与原文完全一致</p>
            <p class="mt-1 ml-4">a. 译文时间戳哪怕错开一点，就会被判进原文版本，污染原文</p>
            <p class="ml-4">b. 请直接复制原文时间戳，不要手动重新打</p>
          </div>
          <div>
            <p class="font-medium">6. 多语言翻译要整首歌成组（同语言对译也支持，如粤语→普通话）</p>
            <p class="mt-1 ml-4">a. 系统按同戳多行组判断：多数组内语言不同，或整首歌大多时间戳成对出现 → 翻译歌，同戳组按行序拆分（第 1 行原文，第 2 行起为译文）</p>
            <p class="ml-4">b. 只有个别时间戳多行（如开头堆在一起的创作者信息）→ 不拆分译文，全归原文——请参考第 2 条错开时间戳</p>
          </div>
          <div>
            <p class="font-medium">7. 自动识别语言有局限，拆分后请核对版本列表</p>
            <p class="mt-1 ml-4">a. 简体/繁体/粤语都识别为「中文」；罗马音、法语等拉丁字母语言识别为「英语」</p>
            <p class="ml-4">b. 藏语、蒙语可自动识别；标错的请在版本列表里手动改语言标注</p>
          </div>
          <div>
            <p class="font-medium">8. 加强逐字的词标签格式</p>
            <p class="mt-1 ml-4">a. 词标签必须写 <span class="font-mono">&lt;mm:ss.xx&gt;</span> 或 <span class="font-mono">&lt;mm:ss.xxx&gt;</span></p>
            <p class="ml-4">b. <span class="font-mono">&lt;00:10&gt;</span>、<span class="font-mono">&lt;10.5&gt;</span> 等错误格式不识别，会残留在歌词文本里显示出来</p>
          </div>
        </div>

        <!-- ===== 歌曲信息 ===== -->
        <div class="border-b pb-6">
          <div class="flex items-center justify-between mb-4">
            <h2 class="text-lg font-semibold text-gray-700">🎵 歌曲信息</h2>
            <el-radio-group v-model="mode" size="small">
              <el-radio-button value="single">单曲投稿</el-radio-button>
              <el-radio-button value="batch">批量投稿</el-radio-button>
            </el-radio-group>
          </div>

          <!-- 批量模式：预设公共字段 → 上传 LRC/ZIP → 列表确认 → 逐首提交 -->
          <BatchSubmitPanel
            v-if="mode === 'batch'"
            :artists="allArtists"
            :albums="allAlbums"
            :on-submit="submitBatchOne"
            @done="onBatchDone"
          />

          <template v-else>
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

            <div class="grid grid-cols-2 gap-x-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">时长</label>
                <!-- 时长统一走组件：分/秒双数字框，对外只输出 mm:ss -->
                <DurationInput v-model="song.duration" tone="plain" />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 mb-1">曲目号 <span class="text-xs text-gray-400 font-normal">（选填）</span></label>
                <input
                  v-model="song.track"
                  type="text"
                  inputmode="numeric"
                  class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500"
                  placeholder="专辑内第几首，如：3"
                />
                <div class="text-xs text-gray-400 mt-1">绑定已有专辑时可填，决定歌曲在专辑页的排序</div>
              </div>
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

            <!-- 编曲（多选 tag） -->
            <div>
              <label class="block text-sm font-medium text-gray-700 mb-1">编曲</label>
              <ArtistTagInput v-model="song.arrangers" :artists="allArtists" :session-names="sessionNewArtists" filter-type="arranger" />
              <div class="text-xs text-gray-400 mt-1">编曲（Beat/Instrumental 制作）请填在这里，不要填到作曲</div>
            </div>
          </div>
          </template>
        </div>

        <!-- 视频链接 / 歌词内容 / 单曲提交按钮：仅单曲模式显示 -->
        <template v-if="mode === 'single'">
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
          <h2 class="text-lg font-semibold text-gray-700 mb-4">📝 歌词内容</h2>
          <div class="text-sm text-gray-500 mb-3">
            <p class="mb-1">支持四种歌词格式，粘贴后自动识别拆分：</p>
            <div class="text-xs bg-gray-50 border border-gray-100 rounded-lg px-3 py-2 space-y-1">
              <p>· 逐行：每行一个 <code class="font-mono">[时间]</code> 开头　例 <code class="font-mono">[00:01.00]歌词内容</code></p>
              <p>· 逐字：每词前一个 <code class="font-mono">[时间]</code>，最后一个 <code class="font-mono">[时间]</code> 是这句结束　例 <code class="font-mono">[00:01.00]歌[00:01.50]词[00:01.90]</code></p>
              <p>· 加强逐字：行首 <code class="font-mono">[时间]</code>，之后每词 <code class="font-mono">&lt;时间&gt;</code>，行尾 <code class="font-mono">&lt;时间&gt;</code> 是结束　例 <code class="font-mono">[00:01.00]歌&lt;00:01.50&gt;词&lt;00:01.90&gt;</code></p>
              <p>· TTML：每句一个 <code class="font-mono">&lt;p begin="..."&gt;</code>　例 <code class="font-mono">&lt;p begin="00:00:01.000"&gt;歌词&lt;/p&gt;</code></p>
              <p>· TTML 原文完整保留（对唱、左右分屏、样式均有效）；LRC / 逐字按行拆分入库</p>
            </div>
          </div>
          <textarea
            v-model="song.lrcText"
            rows="8"
            required
            class="w-full px-4 py-2 border border-gray-200 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-pink-500"
            placeholder="在此粘贴 LRC 或 TTML 歌词..."
          ></textarea>

          <div v-if="lyricParsed" class="mt-3">
            <div class="text-sm text-gray-600 mb-2">识别到 {{ lyricVersions.length }} 个语言版本，请确认（可增删改）：</div>
            <LyricVersionsEditor v-model="lyricVersions" v-model:has-roman="hasRoman" />
          </div>
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
        </template>
      </div>

      <!-- 提交成功 -->
      <div v-show="submitted" class="text-center py-12">
        <div class="text-6xl mb-4">✅</div>
        <h2 class="text-2xl font-bold text-gray-800 mb-2">{{ submittedType === 'profile' ? '资料更新已提交！' : '提交成功！' }}</h2>
        <p class="text-gray-500 mb-6">
          <template v-if="submittedType === 'profile'">
            我们已经收到您的资料更新请求，管理员会尽快审核。<br v-if="userForm.email" />审核结果将通过邮件通知您，请留意查收。
          </template>
          <template v-else>
            我们已经收到您的歌词投稿，管理员会尽快审核。<br v-if="userForm.email" />审核结果将通过邮件通知您，请留意查收。
          </template>
        </p>
        <div class="flex items-center justify-center gap-3">
          <button class="px-6 py-2 bg-pink-500 text-white rounded-lg hover:bg-pink-600" @click="continueSubmit">继续投稿</button>
          <RouterLink to="/" class="px-6 py-2 border border-gray-200 text-gray-500 rounded-lg hover:bg-gray-50">返回首页</RouterLink>
        </div>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useHead } from '@unhead/vue'
import { api } from '@/lib/api'
import { CONTACT_TYPES, VALIDATION_ABORT } from '@/lib/constants'
import { parseTtmlToRows, rowsToLrcText, splitLrcToVersions, parseLrcToRows, composeMixedLrc, type LyricKind } from '@/lib/lyricLines'
import LyricVersionsEditor, { type LyricVersionForm } from '@/components/common/LyricVersionsEditor.vue'
import type { Artist } from '@/lib/types'
import ArtistTagInput from '@/components/submit/ArtistTagInput.vue'
import DurationInput from '@/components/common/DurationInput.vue'
import BatchSubmitPanel from '@/components/submit/BatchSubmitPanel.vue'
import VersionSubmitPanel from '@/components/submit/VersionSubmitPanel.vue'
import SubmitterIdentityPanel, { type SubmitterIdentity } from '@/components/contributor/SubmitterIdentityPanel.vue'
import type { AlbumWithArtists } from '@/lib/types'

useHead({ title: '投稿歌词 - LrcShare' })

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

// ============ 用户信息（v-model 同步自 SubmitterIdentityPanel；reactive 不便整体替换，用 Object.assign 回写） ============
const userForm = reactive<SubmitterIdentity>({
  name: '',
  email: '',
  bio: '',
  contacts: [{ type: CONTACT_TYPES[0], value: '' }],
  public_contact: false,
  request_update: false,
  request_clear: false,
})

/** 身份面板实例：命中的已有贡献者、校验、contact_value 组装都由组件提供 */
const identityRef = ref<InstanceType<typeof SubmitterIdentityPanel> | null>(null)
/** 选中已有贡献者（新昵称/未命中为 null）——保留同名 computed，三条提交路径继续复用 */
const selectedContributor = computed(() => identityRef.value?.selected ?? null)

function onIdentityUpdate(v: SubmitterIdentity) {
  Object.assign(userForm, v)
}


// ============ 歌曲信息 ============
/** 投稿模式：单曲（默认）/ 批量（LRC 文件，公共字段预设 + 列表确认） */
const mode = ref<'single' | 'batch'>('single')

const song = reactive({
  title: '',
  artists: [] as { id: string | null; name: string }[],
  albumArtists: [] as { id: string | null; name: string }[],
  lyricists: [] as { id: string | null; name: string }[],
  composers: [] as { id: string | null; name: string }[],
  arrangers: [] as { id: string | null; name: string }[],
  duration: '',
  track: '',
  lrcText: '',
  videoUrl: '',
})

// 歌词多语言版本：贴 LRC/TTML → 自动拆分 → 版本列表（对齐后台版本管理），投稿人可确认/调整
const lyricVersions = ref<LyricVersionForm[]>([])
const lyricParsed = ref(false)
// 含音译标记：投稿人勾选后，同戳组末行按音译拆分（2 行组也生效）；切换即重拆
const hasRoman = ref(false)

function parseLyrics(silent = false) {
  const raw = song.lrcText.trim()
  if (!raw) {
    if (!silent) ElMessage.warning('请先粘贴歌词内容')
    return
  }
  // 自动识别格式：TTML → 转 LRC
  let lrc = raw
  if (/^<\s*tt\b/i.test(lrc) || /<p\s+begin=/i.test(lrc)) {
    const rows = parseTtmlToRows(raw)
    if (!rows.length) {
      if (!silent) ElMessage.warning('TTML 解析失败，请检查格式（仅支持 clock-time 时间戳，如 00:01:02.500）')
      return
    }
    lrc = rowsToLrcText(rows)
  }
  const versions = splitLrcToVersions(lrc, { hasRoman: hasRoman.value })
  // 拆分不出任何有内容的行（纯文本/空）→ 视为未解析（不设版本，提交走原样）
  if (!versions.some(v => v.rows.length > 0)) {
    if (!silent) ElMessage.warning('未解析出歌词行，请检查 LRC 格式')
    return
  }
  lyricVersions.value = versions.map(v => ({ lang: v.lang, kind: v.kind, lrc: rowsToLrcText(v.rows) }))
  lyricParsed.value = true
}

// 输入防抖自动拆分：停止输入 600ms 后静默拆分（失败不打断，提交时兜底）
let parseTimer: ReturnType<typeof setTimeout> | null = null
watch(() => song.lrcText, (val) => {
  if (parseTimer) clearTimeout(parseTimer)
  if (!(val || '').trim()) {
    lyricVersions.value = []
    lyricParsed.value = false
    return
  }
  parseTimer = setTimeout(() => parseLyrics(true), 600)
})
// 「含音译」勾选切换：已有粘贴内容时按新规则静默重拆（与后台编辑器一致，重拆覆盖手工微调）
watch(hasRoman, () => {
  if (song.lrcText.trim()) parseLyrics(true)
})

// 会话内新建艺术家共享池：从各字段当前值实时派生（id 为 null 即本次新建），删除 tag 后自动出池
const sessionNewArtists = computed(() => {
  const names: string[] = []
  for (const arr of [song.artists, song.albumArtists, song.lyricists, song.composers, song.arrangers]) {
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
  const q = albumName.value.trim().toLowerCase()
  // 输入与库内专辑名完全一致时自动关联 ID（同一专辑连投多首，手动打字也不会丢关联）
  const exact = q ? allAlbums.value.find(a => a.name.toLowerCase() === q) : undefined
  albumId.value = exact ? exact.id : null
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
const submittedType = ref<'song' | 'profile'>('song')
const submitting = ref(false)
/** 投稿模式：新歌曲 / 为已有歌曲补充版本（VersionSubmitPanel 独立处理表单与提交） */
const submitMode = ref<'song' | 'version'>('song')

/** 补充版本面板提交成功：复用同一成功页 */
function onVersionSubmitted() {
  submitted.value = true
  submittedType.value = 'song'
}

async function handleSubmit() {
  // 身份校验（昵称/新用户邮箱/邮箱格式/更新·清空互斥/联系方式链接规范）统一在面板内
  if (!identityRef.value?.validateForSubmit()) return
  const name = (userForm.name || '').trim()

  if (!song.title.trim() || song.artists.length === 0 || !albumName.value.trim() || !song.lrcText.trim()) {
    ElMessage.warning('请填写所有必填的歌曲字段（歌曲名/歌手/专辑/歌词）')
    return
  }
  if (albumYear.value.trim() && !/^\d{4}$/.test(albumYear.value.trim())) {
    ElMessage.warning('专辑年份请填写 4 位数字（如 2024），或留空')
    return
  }
  if (song.track.trim() && !/^\d+$/.test(song.track.trim())) {
    ElMessage.warning('曲目号请填写正整数（如 3），或留空')
    return
  }

  // 联系方式：组件按锁定状态组装（邮箱始终并入；锁定已有账号时其余方式不带），失败已弹提示
  const contactObj = identityRef.value.buildContactValue()
  if (!contactObj) return

  // 歌词：提交前未自动拆分则静默拆分一次（兜底）；已解析 → versions + 合成 lrc_text；否则原样
  // TTML：原文先截留进 ttml_text（对唱/分屏/样式零丢失），降级 LRC 照常走 versions / lrc_text
  // （注意 parseLyrics 会把 TTML 拆进多语言编辑器，故 TTML 判定必须基于原始输入、置于分支之前）
  const rawLyrics = song.lrcText.trim()
  let lrcText = rawLyrics
  let ttmlText: string | undefined
  let versions: { lang: string; kind: string; lrc: string }[] | undefined
  const isTtml = /^<\s*tt\b/i.test(rawLyrics) || /<p\s+begin=/i.test(rawLyrics)
  if (isTtml) {
    ttmlText = rawLyrics
    if (ttmlText.length > 500 * 1024) {
      ElMessage.warning('TTML 原文超过 500KB 限制，请精简样式后重试')
      return
    }
  }
  if (!lyricParsed.value) parseLyrics(true)
  if (lyricParsed.value && lyricVersions.value.length) {
    const vers = lyricVersions.value
      .filter(v => v.lrc.trim())
      .map(v => ({ lang: v.lang?.trim() || 'zh', kind: v.kind, lrc: v.lrc.trim() }))
    if (!vers.length) {
      ElMessage.warning('多语言版本为空，请确认已粘贴歌词')
      return
    }
    versions = vers
    lrcText = composeMixedLrc(vers.map(v => ({ lang: v.lang, kind: v.kind as LyricKind, rows: parseLrcToRows(v.lrc) })), 'line')
  } else if (isTtml) {
    const rows = parseTtmlToRows(rawLyrics)
    if (!rows.length) {
      ElMessage.warning('TTML 解析失败，请检查格式（仅支持 clock-time 时间戳，如 00:01:02.500）')
      return
    }
    lrcText = rowsToLrcText(rows)
  }

  const songData = {
    type: 'song',
    title: song.title.trim(),
    // 多艺术家数组（新格式，后台审核时使用）
    artists: song.artists.slice(),
    album_artists: song.albumArtists.slice(),
    lyricist_arr: song.lyricists.slice(),
    composer_arr: song.composers.slice(),
    arranger_arr: song.arrangers.slice(),
    album: albumName.value.trim(),
    album_id: albumId.value,
    year: albumYear.value.trim() || undefined,
    // 空时长省略该键（JSON 序列化后 song_data 不含 duration），不再产生空串
    duration: song.duration.trim() || undefined,
    track: song.track.trim() || undefined,
    lrc_text: lrcText,
    ttml_text: ttmlText,
    versions,
    video_url: song.videoUrl.trim(),
  }

  submitting.value = true
  try {
    await api.submitSubmissionV2({
      submitter_name: name,
      contact_value: contactObj,
      submitter_public_contact: !!userForm.public_contact,
      contributor_id: selectedContributor.value ? selectedContributor.value.id : null,
      submitter_request_update: !!(selectedContributor.value && userForm.request_update),
      submitter_request_clear: !!(selectedContributor.value && userForm.request_clear),
      submitter_bio: selectedContributor.value && !userForm.request_update ? null : userForm.bio || null,
      song_data: songData,
    })
    submitted.value = true
    submittedType.value = 'song'
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

/** 继续投稿：回到表单，清空歌曲部分，「你的信息」保留（同人连投常用），滚动回顶部 */
function continueSubmit() {
  submitted.value = false
  submittedType.value = 'song'
  // 清空歌曲表单（单曲 + 批量面板的公共专辑选择）
  Object.assign(song, { title: '', artists: [], albumArtists: [], lyricists: [], composers: [], arrangers: [], duration: '', track: '', lrcText: '', videoUrl: '' })
  lyricVersions.value = []
  lyricParsed.value = false
  hasRoman.value = false
  albumName.value = ''
  albumYear.value = ''
  albumId.value = null
  albumDropdown.value = []
  albumDropdownOpen.value = false
  mode.value = 'single'
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

/** 仅提交资料更新（type=profile 投稿）：不投歌词，单独进审核队列，通过后覆盖贡献者字段 */
async function handleProfileSubmit() {
  // 校验（必须命中已有贡献者/勾选更新、邮箱格式、联系方式链接、至少一项内容）在面板内
  if (!identityRef.value?.validateForProfileUpdate()) return
  const contactObj = identityRef.value.buildContactValue()
  if (!contactObj) return
  // 校验已保证命中已有贡献者；取本地常量帮助 TS 收窄，同时防极端情况下实例变化
  const sc = selectedContributor.value
  if (!sc) return

  submitting.value = true
  try {
    await api.submitSubmissionV2({
      submitter_name: sc.name,
      contact_value: contactObj,
      submitter_public_contact: !!userForm.public_contact,
      contributor_id: sc.id,
      submitter_request_update: true,
      submitter_request_clear: false,
      submitter_bio: userForm.bio || null,
      song_data: { type: 'profile', title: '资料更新' } as any,
    })
    submitted.value = true
    submittedType.value = 'profile'
    window.scrollTo({ top: 0, behavior: 'smooth' })
    notifyAdminNewSubmission(sc.name, '资料更新')
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

// ============ 批量投稿（BatchSubmitPanel 桥接：用户信息校验 + 单首提交） ============

/** 校验「你的信息」区（昵称/邮箱/互斥）；不通过抛 VALIDATION_ABORT 供面板中止整批。
 *  联系方式链接规范在 submitBatchOne 组装 contact_value 时再兜底（失败同样中止本批） */
function validateUserInfoForBatch() {
  const name = (userForm.name || '').trim()
  const email = (userForm.email || '').trim()
  if (!name) {
    ElMessage.warning('请先在「你的信息」中填写昵称')
    throw new Error(VALIDATION_ABORT)
  }
  if (!selectedContributor.value && !email) {
    ElMessage.warning('请先在「你的信息」中填写邮箱')
    throw new Error(VALIDATION_ABORT)
  }
  if (email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    if (!emailRegex.test(email)) {
      ElMessage.warning('请填写正确的邮箱地址')
      throw new Error(VALIDATION_ABORT)
    }
  }
  if (selectedContributor.value && userForm.request_clear && userForm.request_update) {
    ElMessage.warning('更新信息和清空信息不能同时勾选')
    throw new Error(VALIDATION_ABORT)
  }
}

/** 面板逐首调用：校验用户信息（每首提交前都校验，改了也能拦住）+ 组装 payload（带批次 ID）+ 提交。
 *  batchId 由面板生成并保证「同一批动作」始终一致（失败重试沿用，清空重来换新） */
async function submitBatchOne(songData: any, batchId: string, batchSize: number) {
  validateUserInfoForBatch()
  const name = (userForm.name || '').trim()
  // 组件组装：邮箱始终并入；锁定已有账号时其余联系方式不带；链接非法时中止整批
  const contactObj = identityRef.value?.buildContactValue()
  if (!contactObj) throw new Error(VALIDATION_ABORT)
  await api.submitSubmissionV2({
    submitter_name: name,
    contact_value: contactObj,
    submitter_public_contact: !!userForm.public_contact,
    contributor_id: selectedContributor.value ? selectedContributor.value.id : null,
    submitter_request_update: !!(selectedContributor.value && userForm.request_update),
    submitter_request_clear: !!(selectedContributor.value && userForm.request_clear),
    submitter_bio: selectedContributor.value && !userForm.request_update ? null : userForm.bio || null,
    song_data: songData,
    batch_id: batchId,
    batch_size: batchSize,
  })
}

/** 面板全部提交完成：切成功页（复用单曲成功提示）+ 站长通知按批合并为一封 */
function onBatchDone(count: number, summary: { album: string; batchId: string }) {
  submitted.value = true
  submittedType.value = 'song'
  ElMessage.success(`批量投稿完成，共 ${count} 首已进入审核队列`)
  const name = (userForm.name || '').trim()
  notifyAdminNewSubmission(name, `【批量投稿】${summary.album ? `《${summary.album}》` : ''}等 ${count} 首歌曲`)
  window.scrollTo({ top: 0, behavior: 'smooth' })
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
