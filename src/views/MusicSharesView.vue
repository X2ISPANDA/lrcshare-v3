<template>
  <main class="max-w-6xl mx-auto px-4 py-8">
    <!-- 标题区 -->
    <div class="bg-white rounded-2xl shadow-sm p-6 sm:p-8 mb-6">
      <div class="text-sm text-pink-500 mb-2">大家都在听</div>
      <div class="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 class="text-2xl sm:text-3xl font-bold text-gray-800 mb-2">🎶 歌曲分享</h1>
          <p class="text-gray-500 text-sm sm:text-base">
            这里是 LrcShare 听众与创作者们分享的歌曲，点卡片即可在站内播放器收听。
          </p>
        </div>
        <RouterLink
          to="/music-share/submit"
          class="inline-flex items-center gap-1 px-5 py-2.5 rounded-full text-white text-sm font-semibold bg-gradient-to-r from-pink-500 to-purple-500 hover:from-pink-600 hover:to-purple-600 shadow-sm whitespace-nowrap"
        >
          🎁 我要分享一首歌
        </RouterLink>
      </div>
    </div>

    <!-- ============ ✦ 创作者自荐：跑马灯式连续横滚（按投稿时间最新在前，与下方普通网格互斥） ============ -->
    <section v-if="!loading && ownShares.length" class="bg-white rounded-2xl shadow-sm p-6 mb-6">
      <div class="flex items-center justify-between gap-3 mb-4">
        <h2 class="text-lg font-bold text-amber-600 flex items-center gap-1.5">
          <span class="mws-own-dot"></span>✦ 创作者自荐
        </h2>
        <span class="text-xs text-gray-400 hidden sm:inline">最新投稿连续播出 · 鼠标悬停可暂停</span>
      </div>

      <!-- 跑马灯视口：内容不足一屏时不滚动（marqueeEnabled=false），静态左对齐 -->
      <div ref="marqueeEl" class="mws-marquee" :class="{ 'is-static': !marqueeEnabled }">
        <div
          ref="trackEl"
          class="mws-marquee-track"
          :class="{ paused: marqueePaused, animated: marqueeEnabled }"
          :style="marqueeEnabled ? { animationDuration: marqueeDuration + 's' } : {}"
          @mouseenter="marqueePaused = true"
          @mouseleave="marqueePaused = false"
        >
          <article
            v-for="(s, i) in marqueeList"
            :key="`${s.id}-${i}`"
            class="mws-mq-card"
            role="button"
            tabindex="0"
            :title="`播放《${s.title}》`"
            @click="playOwn(s)"
            @keydown.enter="playOwn(s)"
          >
            <!-- 横向紧凑卡：左封面右信息；推荐理由全文展示不截断（用户明确要求 200 字内完整可读），
                 卡片高度随理由长短自然变化，轨道 align-items:flex-start 顶部对齐 -->
            <div class="mws-mq-cover" :style="coverWrapStyle(s)">
              <img v-if="s.cover_url" :src="s.cover_url" :alt="s.title" loading="lazy" />
              <div v-else class="mws-mq-cover-fake">🎵</div>
              <div class="mws-mq-mask">
                <span class="mws-mq-play">
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                </span>
              </div>
              <span class="mws-mq-badge">
                <AppIcon :name="s.platform" class="w-3 h-3" />
                {{ platformLabel(s.platform) }}
              </span>
              <!-- 专辑角标：与卡片墙 msg-badge-album 同款紫色药丸 -->
              <span v-if="s.media_type === 'album'" class="mws-mq-badge-album">
                专辑<template v-if="s.tracks?.length"> · {{ s.tracks.length }} 首</template>
              </span>
            </div>
            <div class="mws-mq-info">
              <h3 class="font-bold text-gray-800 text-[13.5px] truncate">{{ s.title }}</h3>
              <p v-if="s.artist" class="text-xs text-gray-500 truncate mt-0.5">{{ s.artist }}</p>
              <!-- 推荐理由：全文不截断，200 字上限内完整可读 -->
              <p v-if="s.reason" class="mws-mq-reason text-xs text-amber-700/80 mt-1.5 leading-relaxed break-words">{{ s.reason }}</p>
              <div class="flex items-center justify-between gap-2 mt-1.5 pt-1.5 border-t border-amber-100/70">
                <span class="mws-mq-sharer min-w-0">
                  <!-- 跑马灯内全部为自荐作品：身份是音乐人本人，不再用推荐人口径 -->
                  <span class="mws-mq-role">音乐人</span>
                  <img v-if="s.contributor?.avatar" :src="s.contributor.avatar" class="w-4 h-4 rounded-full object-cover flex-shrink-0" alt="" />
                  <span class="truncate">{{ s.contributor?.name || s.submitter_name }}</span>
                </span>
                <a
                  :href="s.source_url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="mws-mq-origin flex-shrink-0"
                  title="在原平台打开"
                  @click.stop
                >原链 ↗</a>
              </div>
              <!-- 音乐人公开联系方式（有啥展示啥）：链接一键外跳、号码弹复制；组件内部已阻止点击冒泡 -->
              <ContactIcons v-if="s.contributor" :contributor="s.contributor" class="mws-mq-contacts" />
            </div>
          </article>
        </div>
      </div>
    </section>

    <!-- ============ 普通歌曲分享网格（自荐作品只出现在上方跑马灯，两栏互斥不重复） ============ -->
    <div class="bg-white rounded-2xl shadow-sm p-6 mb-6">
      <div class="flex items-center gap-2 mb-4">
        <h2 class="text-lg font-bold text-gray-800">🎵 歌曲分享</h2>
        <span class="text-xs text-gray-400">共 {{ normalShares.length }} 首</span>
      </div>
      <!-- 空态 -->
      <MusicShareCardGrid
        v-if="!loading"
        :shares="visibleList"
        :empty-text="ownShares.length ? '普通歌曲分享暂时为空，先听听上方创作者们的自荐吧' : '还没有人分享歌曲，来做第一个吧'"
        empty-to="/music-share/submit"
        @play="play"
      />
      <!-- 骨架 -->
      <MusicShareCardGrid v-else loading :shares="[]" @play="play" />

      <!-- 加载更多 -->
      <div v-if="normalShares.length > visibleCount" class="text-center mt-6">
        <button type="button" class="px-6 py-2 rounded-full border border-pink-200 text-pink-600 text-sm font-medium hover:bg-pink-50" @click="visibleCount += 24">
          加载更多（还有 {{ normalShares.length - visibleCount }} 首）
        </button>
      </div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useHead } from '@unhead/vue'
import { api } from '@/lib/api'
import { useSSGData } from '@/composables/useSSGData'
import { useMusicPlayerStore } from '@/stores/musicPlayer'
import { getMusicPlatform, musicPlatformLabel } from '@/lib/musicPlatforms'
import type { MusicShare } from '@/lib/types'
import AppIcon from '@/components/common/AppIcon.vue'
import ContactIcons from '@/components/contributor/ContactIcons.vue'
import MusicShareCardGrid from '@/components/music/MusicShareCardGrid.vue'

defineOptions({ name: 'MusicSharesView' })

useHead({
  title: '歌曲分享 - LrcShare',
  meta: [{ name: 'description', content: 'LrcShare 听众与创作者分享的歌曲，站内统一播放器直接收听：网易云音乐、YouTube、SoundCloud，支持单曲与专辑连播。' }],
})

const player = useMusicPlayerStore()
const { data: shares, loading } = useSSGData<MusicShare[]>('music-shares', () => api.getMusicShares())

// SSG 水合数据灌给全局播放器，供首页随机推荐卡 / 进站随机播放复用（store 已自行加载则不覆盖）
watch(
  shares,
  rows => player.hydrate(rows),
  { immediate: true },
)

// ============ 两栏互斥：自荐只在上方跑马灯，普通网格不含自荐作品 ============
/** 创作者自荐：按投稿时间最新在前（用户明确要求时间序） */
const ownShares = computed(() =>
  (shares.value || [])
    .filter(s => s.is_own_work)
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')),
)
/** 普通歌曲分享：保持 getMusicShares 的排序（sort 置顶优先，其余通过时间倒序） */
const normalShares = computed(() => (shares.value || []).filter(s => !s.is_own_work))

/** 卡片墙分页（总量小，前端切片 + 加载更多） */
const visibleCount = ref(24)
const visibleList = computed(() => normalShares.value.slice(0, visibleCount.value))

/** 普通网格播放队列：普通分享全量（「加载更多」之外的歌也能顺序播到） */
function play(s: MusicShare) {
  player.playShare(s, normalShares.value)
}
/** 自荐跑马灯播放队列：全部自荐作品 */
function playOwn(s: MusicShare) {
  player.playShare(s, ownShares.value)
}

// ============ 跑马灯：无缝连续横滚 ============
// 原理：内容宽度超出视口时，把列表复制一份首尾相接，CSS 动画从 0 平移到 -50% 即正好走完一份，
// 循环时视觉无缝；不足一屏则不复制、不滚动（静态排列，避免复制出孤零零的重复卡片）。
/** 连续滚动速度：约 25px/s（≈ 30s 滚完一屏三张卡），悬停暂停 */
const MARQUEE_PX_PER_SEC = 25

const marqueeEl = ref<HTMLElement | null>(null)
const trackEl = ref<HTMLElement | null>(null)
/** 是否启用滚动（内容必须宽于视口） */
const marqueeEnabled = ref(false)
/** 一次完整循环（走完一份列表）的秒数，按实测宽度/固定速度计算，保证不同数量下速度一致 */
const marqueeDuration = ref(0)
/** 鼠标悬停暂停 */
const marqueePaused = ref(false)

/** 实际渲染列表：启用时复制成两份，未启用时只渲染一份 */
const marqueeList = computed<MusicShare[]>(() =>
  marqueeEnabled.value && ownShares.value.length ? [...ownShares.value, ...ownShares.value] : ownShares.value,
)

/** 依据当前 DOM 实测宽度决定是否开跑马灯并计算动画时长 */
async function measureMarquee() {
  await nextTick()
  const el = marqueeEl.value
  const track = trackEl.value
  if (!el || !track) return
  if (ownShares.value.length === 0) {
    marqueeEnabled.value = false
    marqueeDuration.value = 0
    return
  }
  // 先重置成「单份列表」状态再测量，否则重测时（resize/数据刷新）轨道可能已含两份，宽度翻倍
  marqueeEnabled.value = false
  marqueeDuration.value = 0
  await nextTick()
  // 此刻 track 内只有一份列表（marqueeEnabled=false 时），scrollWidth 即一份的真实宽度
  const oneSetWidth = track.scrollWidth
  if (oneSetWidth > el.clientWidth + 4) {
    marqueeEnabled.value = true
    await nextTick() // 等第二份渲染出来
    marqueeDuration.value = Math.max(8, oneSetWidth / MARQUEE_PX_PER_SEC)
  }
}

// 水合数据到达后测量；窗口尺寸变化时重新判断（桌面缩放/旋转屏）
watch(ownShares, measureMarquee)
onMounted(measureMarquee)
onUnmounted(() => {
  if (typeof window !== 'undefined') window.removeEventListener('resize', measureMarquee)
})

function platformLabel(key: string): string {
  return musicPlatformLabel(key)
}
/** 无封面卡片占位底色：取平台品牌色低透明度渐变（与卡片墙同款） */
function coverWrapStyle(s: MusicShare): Record<string, string> {
  const color = getMusicPlatform(s.platform)?.brandColor || '#ec4899'
  return { '--mqs-brand': color }
}
</script>

<style scoped>
/* ============ 标题金色圆点 ============ */
.mws-own-dot {
  width: 8px;
  height: 8px;
  border-radius: 999px;
  background: linear-gradient(135deg, #f59e0b, #d97706);
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.6);
}

/* ============ 跑马灯视口与轨道 ============ */
.mws-marquee {
  position: relative;
  width: 100%;
  overflow: hidden;
  /* 两侧渐隐遮罩，暗示内容还在延续 */
  -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 24px, #000 calc(100% - 24px), transparent 100%);
  mask-image: linear-gradient(90deg, transparent 0, #000 24px, #000 calc(100% - 24px), transparent 100%);
}
/* 内容不足一屏：关闭遮罩与溢出隐藏，静态左对齐排列 */
.mws-marquee.is-static {
  overflow: visible;
  -webkit-mask-image: none;
  mask-image: none;
}
.mws-marquee-track {
  display: flex;
  width: max-content;
  /* 卡片高度随理由长短自然不齐：顶部对齐，禁止 flex 默认拉伸导致封面变形 */
  align-items: flex-start;
}
.mws-marquee-track.animated {
  animation-name: mws-marquee-x;
  animation-timing-function: linear;
  animation-iteration-count: infinite;
}
.mws-marquee-track.paused {
  animation-play-state: paused;
}
/* 平移一份（-50%）：两份内容完全等宽（卡片用 margin 而非 gap），循环瞬间无跳变 */
@keyframes mws-marquee-x {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-50%);
  }
}

/* ============ 跑马灯卡片（横向紧凑卡：左封面 + 右信息，与卡片墙同一视觉语言） ============ */
.mws-mq-card {
  width: 360px;
  flex: 0 0 auto;
  /* 用 margin 而非父级 gap：保证两份列表宽度严格相等，-50% 衔接无缝 */
  margin-right: 16px;
  border: 1px solid #fbbf24;
  border-radius: 14px;
  background: #fff;
  box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.22);
  cursor: pointer;
  overflow: hidden;
  transition: transform 0.15s, box-shadow 0.15s;
  outline: none;
  /* 横向卡：左封面右信息；cover 自身 align-self:flex-start，理由再长也不拉伸封面 */
  display: flex;
  align-items: stretch;
}
.mws-mq-card:hover,
.mws-mq-card:focus-visible {
  transform: translateY(-2px);
  box-shadow: 0 10px 28px rgba(217, 119, 6, 0.22);
}
.mws-mq-cover {
  position: relative;
  width: 104px;
  flex: 0 0 104px;
  align-self: flex-start;
  margin: 10px 0 10px 10px;
  height: 104px;
  border-radius: 10px;
  background: #f9fafb;
  overflow: hidden;
}
.mws-mq-cover img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.mws-mq-cover-fake {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 40px;
  color: #fff;
  background: linear-gradient(135deg, var(--mqs-brand, #ec4899), #a855f7);
  opacity: 0.85;
}
.mws-mq-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.32);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s;
}
.mws-mq-card:hover .mws-mq-mask,
.mws-mq-card:focus-visible .mws-mq-mask {
  opacity: 1;
}
.mws-mq-play {
  width: 36px;
  height: 36px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  color: #d97706;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-left: 2px;
}
.mws-mq-badge {
  position: absolute;
  left: 6px;
  top: 6px;
  display: inline-flex;
  align-items: center;
  gap: 3px;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  color: #374151;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}
.mws-mq-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  padding: 10px 12px 10px 10px;
}
/* 专辑角标：封面右上紫色药丸（与卡片墙 msg-badge-album 同款） */
.mws-mq-badge-album {
  position: absolute;
  right: 6px;
  top: 6px;
  padding: 2px 7px;
  border-radius: 999px;
  background: rgba(124, 58, 237, 0.9);
  color: #fff;
  font-size: 10px;
  white-space: nowrap;
}
/* 推荐理由：全文展示不截断（200 字上限内完整可读，用户明确要求）；
   卡片高度随文字自然变化，轨道 align-items:flex-start 已保证顶部对齐 */
.mws-mq-reason {
  word-break: break-word;
}
.mws-mq-role {
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: 999px;
  background: #fef3c7;
  color: #b45309;
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
}
.mws-mq-sharer {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  font-size: 12px;
  color: #6b7280;
}
/* 联系方式图标行：紧凑小号，贴在音乐人信息下方 */
.mws-mq-contacts {
  gap: 2px;
  margin-top: 2px;
}
.mws-mq-contacts :deep(a) {
  width: 18px;
  height: 18px;
}
.mws-mq-contacts :deep(svg) {
  width: 13px;
  height: 13px;
}
.mws-mq-origin {
  font-size: 12px;
  color: #d97706;
}
.mws-mq-origin:hover {
  text-decoration: underline;
}

/* ============ 响应式：手机上卡片收窄、封面缩小 ============ */
@media (max-width: 640px) {
  .mws-mq-card {
    width: 300px;
    margin-right: 12px;
  }
  .mws-mq-cover {
    width: 88px;
    flex-basis: 88px;
    height: 88px;
  }
}

/* ============ 无障碍：尊重系统「减少动态效果」设置，改为可手动横滑 ============ */
@media (prefers-reduced-motion: reduce) {
  .mws-marquee {
    overflow-x: auto;
    -webkit-mask-image: none;
    mask-image: none;
  }
  .mws-marquee-track.animated {
    animation: none;
  }
}
</style>
