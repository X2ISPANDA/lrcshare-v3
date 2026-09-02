<template>
  <main class="max-w-5xl mx-auto px-4 py-8">
    <!-- Hero：致谢 + 赞助入口 + 统计 -->
    <section class="relative overflow-hidden rounded-3xl bg-gradient-to-br from-pink-500 via-rose-500 to-pink-400 p-8 md:p-10 text-white shadow-lg shadow-pink-200/60 mb-6">
      <div class="absolute -top-16 -right-16 w-56 h-56 rounded-full bg-white/10"></div>
      <div class="absolute -bottom-20 -left-10 w-48 h-48 rounded-full bg-white/10"></div>
      <div class="relative flex flex-col md:flex-row md:items-center md:justify-between gap-6">
        <div>
          <div class="text-xs md:text-sm font-medium tracking-[0.3em] text-white/80 mb-2">致 谢</div>
          <h1 class="text-3xl md:text-4xl font-bold mb-2">赞助名单</h1>
          <p class="text-white/85">没有你们就没有 LrcShare 的今天，每一笔都记在心里。</p>
          <div v-if="sponsors?.length" class="flex flex-wrap gap-2 mt-4">
            <span class="px-3 py-1 rounded-full bg-white/15 text-sm">{{ sponsors.length }} 位伙伴</span>
            <span class="px-3 py-1 rounded-full bg-white/15 text-sm">累计 ¥{{ totalAmount.toFixed(2) }}</span>
            <span class="px-3 py-1 rounded-full bg-white/15 text-sm">最近赞助 {{ latestDate }}</span>
          </div>
        </div>
        <button
          class="shrink-0 self-start md:self-center inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white text-pink-600 font-bold shadow-md hover:shadow-xl hover:-translate-y-0.5 transition-all"
          @click="showReward = true"
        >
          <svg class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M12 21s-7.5-4.7-10-9.3C.4 8.6 2.2 5 5.7 5c2 0 3.4 1.1 4.3 2.4h4C14.9 6.1 16.3 5 18.3 5c3.5 0 5.3 3.6 3.7 6.7C19.5 16.3 12 21 12 21z"/>
          </svg>
          请我喝杯咖啡
        </button>
      </div>
    </section>

    <!-- 加载 / 空态 -->
    <div v-if="loading" class="bg-white rounded-2xl shadow-sm p-12 text-center text-gray-400">加载中...</div>
    <div v-else-if="!sponsors?.length" class="bg-white rounded-2xl shadow-sm p-12 text-center text-gray-400">暂无赞助记录</div>

    <template v-else>
      <!-- Top3 领奖台（搜索时隐藏，结果统一进网格）；内容居中，与榜单卡片对齐方式一致 -->
      <section v-if="!keyword.trim() && top3.length" class="grid grid-cols-1 md:grid-cols-3 gap-4 items-end mb-6">
        <article
          v-for="(entry, idx) in top3"
          :key="entry.item.id"
          class="podium-card relative overflow-hidden rounded-2xl p-6 text-white text-center shadow-md transition-transform duration-200"
          :class="[podiumCardClass(idx), idx === 0 ? 'md:order-2 md:py-9 holo-card' : idx === 1 ? 'md:order-1 hover:-translate-y-1' : 'md:order-3 hover:-translate-y-1']"
          @pointermove="onHoloMove"
          @pointerleave="onHoloLeave"
        >
          <!-- 冠军：镭射卡——中心放射彩虹光芒（持续旋转流动）+ 高光（3D 倾斜随鼠标） -->
          <div v-if="idx === 0" class="holo-rays pointer-events-none absolute" aria-hidden="true"></div>
          <div v-if="idx === 0" class="holo-sheen pointer-events-none absolute inset-0" aria-hidden="true"></div>
          <!-- 季军：蓝紫星空闪烁 -->
          <div v-if="idx === 2" class="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
            <span class="star star-1"></span>
            <span class="star star-2"></span>
            <span class="star star-3"></span>
            <span class="star star-4"></span>
            <span class="star star-5"></span>
            <span class="star star-6"></span>
            <span class="star star-7"></span>
            <span class="star star-8"></span>
          </div>

          <div class="relative">
            <div class="text-3xl leading-none">{{ podiumEmoji[idx] }}</div>
            <div class="mt-1.5 text-xs font-medium text-white/75 tabular-nums">No.{{ entry.rank }}</div>
            <div class="mt-2 text-xl font-bold truncate">{{ entry.item.name }}</div>
            <div class="mt-1.5 tabular-nums">
              <span class="text-3xl font-extrabold">¥{{ formatAmount(entry.item.amount) }}</span><span class="text-base font-semibold opacity-80">{{ entry.item.suffix || '元' }}</span>
            </div>
            <a
              v-if="entry.item.url"
              :href="entry.item.url"
              target="_blank"
              rel="noopener"
              class="mt-3 inline-flex items-center gap-1 max-w-full text-sm bg-white/25 rounded-full px-3 py-1 hover:bg-white/35 transition-colors truncate"
            >🔗 {{ linkText(entry.item) }}</a>
            <div v-else-if="entry.item.descr" class="mt-3 text-sm text-white/90 line-clamp-2 break-all">{{ entry.item.descr }}</div>
            <div class="mt-3 text-xs text-white/85 tabular-nums">{{ formatDate(entry.item.datatime) }}</div>
          </div>
        </article>
      </section>

      <!-- 榜单：卡片网格 + 名字搜索（赞助者多了直接搜名字定位，无需翻页） -->
      <section class="bg-white rounded-2xl shadow-sm overflow-hidden">
        <div class="px-5 sm:px-6 pt-5 pb-3 border-b border-gray-50 flex flex-wrap items-center justify-between gap-3">
          <h2 class="text-lg font-bold text-gray-800">💖 赞助者榜单</h2>
          <input
            v-model="keyword"
            type="text"
            placeholder="搜索名字，快速找到自己"
            class="w-full sm:w-56 rounded-full border border-gray-200 px-4 py-1.5 text-sm outline-none transition focus:border-pink-400 focus:ring-2 focus:ring-pink-100"
          />
        </div>

        <div v-if="gridList.length" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4 p-5 sm:p-6">
          <div
            v-for="entry in gridList"
            :key="entry.item.id"
            class="group flex flex-col items-center text-center rounded-2xl border px-4 py-5 transition-all duration-200 hover:-translate-y-1 hover:shadow-lg"
            :class="tierCardClass[entry.tier]"
          >
            <div class="flex items-center gap-1 text-xs font-bold text-gray-400 tabular-nums">
              <span>No.{{ entry.rank }}</span>
              <span aria-hidden="true">{{ tierEmoji[entry.tier] }}</span>
            </div>
            <div class="mt-1.5 font-bold text-gray-800 truncate max-w-full">{{ entry.item.name }}</div>
            <span class="mt-2.5 inline-block px-3 py-1 rounded-full bg-gray-900 text-white text-xs font-semibold whitespace-nowrap tabular-nums">¥{{ formatAmount(entry.item.amount) }}{{ entry.item.suffix || '元' }}</span>
            <a
              v-if="entry.item.url"
              :href="entry.item.url"
              target="_blank"
              rel="noopener"
              class="mt-2.5 inline-flex items-center gap-1 max-w-full text-[11px] text-pink-600 hover:underline truncate"
            >🔗 {{ linkText(entry.item) }}</a>
            <div v-else-if="entry.item.descr" class="mt-2.5 text-[11px] text-gray-500 line-clamp-2 break-all leading-relaxed">{{ entry.item.descr }}</div>
            <div class="mt-auto pt-2.5 text-[11px] text-gray-400 tabular-nums">{{ formatDate(entry.item.datatime) }}</div>
          </div>
        </div>
        <div v-else class="py-12 text-center text-sm text-gray-400">
          没有找到名字包含「{{ keyword }}」的赞助者
        </div>

        <div class="px-6 py-4 bg-gray-50/60 text-sm text-gray-500 text-center">
          共有 <b class="text-gray-700">{{ sponsors.length }}</b> 位小伙伴投喂
          <b class="text-pink-500">{{ totalAmount.toFixed(2) }}</b> 元，最新投喂时间：{{ latestDate }}
        </div>
      </section>
    </template>
  </main>

  <!-- 赞助二维码弹窗 -->
  <Teleport to="body">
    <div
      v-if="showReward"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="showReward = false"
    >
      <div class="bg-white rounded-2xl p-6 max-w-md w-full mx-4">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-xl font-bold text-gray-800">赞助 LrcShare</h3>
          <button class="text-gray-400 hover:text-gray-600 text-2xl" @click="showReward = false">&times;</button>
        </div>
        <div class="text-center text-gray-500 mb-4">请扫描下方二维码进行赞助</div>
        <div class="flex justify-center gap-4">
          <div class="text-center">
            <div class="w-40 h-40 rounded-xl overflow-hidden mb-2 border border-gray-100">
              <img :src="QR_CODES[0]" class="w-full h-full object-cover cursor-zoom-in" @click="ui.openPreview(QR_CODES, 0)" />
            </div>
            <div class="text-sm text-gray-600">微信赞助</div>
          </div>
          <div class="text-center">
            <div class="w-40 h-40 rounded-xl overflow-hidden mb-2 border border-gray-100">
              <img :src="QR_CODES[1]" class="w-full h-full object-cover cursor-zoom-in" @click="ui.openPreview(QR_CODES, 1)" />
            </div>
            <div class="text-sm text-gray-600">支付宝赞助</div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useHead } from '@unhead/vue'
import { api } from '@/lib/api'
import { useSSGData } from '@/composables/useSSGData'
import { useUiStore } from '@/stores/ui'
import { QR_CODES } from '@/lib/constants'
import type { Sponsor } from '@/lib/types'

useHead({ title: '赞助名单 - LrcShare' })

const ui = useUiStore()
const { data: sponsors, loading } = useSSGData<Sponsor[]>('support', () => api.getSponsors())

const showReward = ref(false)
const keyword = ref('')

const totalAmount = computed(() =>
  ((sponsors.value || []).reduce((sum, r) => sum + Math.round(amountOf(r) * 100), 0)) / 100,
)

const latestDate = computed(() => {
  const list = sponsors.value || []
  if (!list.length) return ''
  return new Date(Math.max(...list.map(r => new Date(r.datatime).getTime()))).toISOString().slice(0, 10)
})

type Tier = 1 | 2 | 3 | 4

/** 榜单：金额降序；同额先到先得（日期早的在前），附带全局名次与卡片档位 */
const rankedEntries = computed(() =>
  [...(sponsors.value || [])]
    .sort((a, b) => amountOf(b) - amountOf(a) || new Date(a.datatime).getTime() - new Date(b.datatime).getTime())
    .map((item, i) => ({ item, rank: i + 1, tier: tierOf(amountOf(item)) })),
)

/** 无搜索：Top3 领奖台；搜索时领奖台隐藏，结果全部进网格 */
const top3 = computed(() => rankedEntries.value.slice(0, 3))
const gridList = computed(() => {
  const kw = keyword.value.trim().toLowerCase()
  if (!kw) return rankedEntries.value.slice(3)
  return rankedEntries.value.filter(e => e.item.name.toLowerCase().includes(kw))
})

/** 领奖台名次用奖牌 emoji，淡化「封号」感 */
const podiumEmoji = ['🥇', '🥈', '🥉']

function podiumCardClass(idx: number): string {
  if (idx === 0) return 'bg-gradient-to-br from-slate-600 via-slate-800 to-gray-900 shadow-slate-400/50'
  if (idx === 1) return 'podium-rainbow shadow-purple-300/60'
  return 'bg-gradient-to-br from-indigo-500 via-violet-500 to-purple-600 shadow-purple-300/50'
}

/** 冠军镭射卡：指针位置驱动 3D 倾斜与高光（移动端触摸同样生效，离开即复位） */
function onHoloMove(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  if (!el.classList.contains('holo-card')) return
  const rect = el.getBoundingClientRect()
  const px = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width))
  const py = Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height))
  el.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`)
  el.style.setProperty('--my', `${(py * 100).toFixed(1)}%`)
  el.style.setProperty('--ry', `${((px - 0.5) * 14).toFixed(2)}deg`)
  el.style.setProperty('--rx', `${((0.5 - py) * 12).toFixed(2)}deg`)
}
function onHoloLeave(e: PointerEvent) {
  const el = e.currentTarget as HTMLElement
  if (!el.classList.contains('holo-card')) return
  el.style.setProperty('--mx', '50%')
  el.style.setProperty('--my', '38%')
  el.style.setProperty('--rx', '0deg')
  el.style.setProperty('--ry', '0deg')
}

/**
 * 名单卡片档位：按金额给整张卡片不同浅亮风格（一分也是爱，不做暗淡灰）
 * 1=金主档（金）/ 2=粉钻档（粉）/ 3=星光档（蓝）/ 4=新芽档（青绿）
 */
function tierOf(amount: number): Tier {
  if (amount >= 50) return 1
  if (amount >= 20) return 2
  if (amount >= 5) return 3
  return 4
}

const tierCardClass: Record<Tier, string> = {
  1: 'border-amber-200 bg-gradient-to-b from-amber-50 to-yellow-50/80 hover:border-amber-300 hover:shadow-amber-100',
  2: 'border-pink-200 bg-gradient-to-b from-pink-50 to-rose-50/80 hover:border-pink-300 hover:shadow-pink-100',
  3: 'border-sky-200 bg-gradient-to-b from-sky-50 to-indigo-50/70 hover:border-sky-300 hover:shadow-sky-100',
  4: 'border-emerald-200 bg-gradient-to-b from-emerald-50 to-teal-50/70 hover:border-emerald-300 hover:shadow-emerald-100',
}

const tierEmoji: Record<Tier, string> = { 1: '👑', 2: '💖', 3: '✨', 4: '🌱' }

/** 广告链接文案：保留「标题：描述」完整信息（如 个人主页：网易音乐人） */
function linkText(s: Sponsor): string {
  if (s.title && s.descr) return `${s.title}：${s.descr}`
  return s.title || s.descr || '个人链接'
}

function amountOf(s: Sponsor): number {
  return parseFloat(s.amount) || 0
}

/** numeric 列返回带尾零（100.00 / 66.60），展示归一为自然写法（100 / 66.6） */
function formatAmount(v: string): string {
  return String(parseFloat(v) || 0)
}

function formatDate(dateStr: string | null): string {
  return dateStr ? new Date(dateStr).toISOString().slice(0, 10) : ''
}
</script>

<style scoped>
/* 领奖台文字在彩色底上的可读性 */
.podium-card {
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.22);
}

/* 冠军：镭射卡——指针位置驱动 3D 倾斜与高光位置（离开缓动回正） */
.holo-card {
  --rx: 0deg;
  --ry: 0deg;
  --mx: 50%;
  --my: 38%;
  transform: perspective(900px) rotateX(var(--rx)) rotateY(var(--ry)) translateY(var(--ty, 0px));
  transition: transform 0.18s ease-out;
  will-change: transform;
}
.holo-card:hover {
  --ty: -4px;
}

/* 镭射彩虹膜：双圈七彩扇形条带持续旋转（暗底 screen 混合呈全息反光）；仅 2px 轻柔化，条带清晰不糊 */
.holo-rays {
  inset: -45%;
  background: conic-gradient(from 0deg at 50% 50%,
    #ff2d75, #ff8a00, #ffe600, #2eff8a, #2ec5ff, #7a5cff,
    #ff2d75, #ff8a00, #ffe600, #2eff8a, #2ec5ff, #7a5cff, #ff2d75);
  mix-blend-mode: screen;
  opacity: 0.8;
  filter: blur(2px);
  animation: rays-spin 14s linear infinite;
}
@keyframes rays-spin {
  to { transform: rotate(360deg); }
}

/* 高光随指针移动 + 卡面内描边/底边压暗，营造卡片厚度（3D 感） */
.holo-sheen {
  background: radial-gradient(circle at var(--mx) var(--my),
    rgba(255, 255, 255, 0.7), rgba(255, 255, 255, 0) 45%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.4), inset 0 -20px 32px rgba(0, 0, 0, 0.45);
}

/* 亚军：七彩渐变沿对角往返缓动流动（色相随条纹方向流转，无硬边、无白条） */
.podium-rainbow {
  background: linear-gradient(120deg, #ff6b6b, #ffa94d, #ffd43b, #51cf66, #4dabf7, #9775fa, #ff6b6b);
  background-size: 300% 300%;
  animation: rainbow-flow 7s ease-in-out infinite;
}
@keyframes rainbow-flow {
  0% { background-position: 0% 0%; }
  50% { background-position: 100% 100%; }
  100% { background-position: 0% 0%; }
}

/* 季军：蓝紫星空闪烁（8 颗星错峰明灭，分布在卡片两侧边缘避免压字） */
.star {
  position: absolute;
  width: 4px;
  height: 4px;
  border-radius: 9999px;
  background: #fff;
  box-shadow: 0 0 6px 1px rgba(255, 255, 255, 0.8);
  opacity: 0.3;
  animation: twinkle 2.8s ease-in-out infinite;
}
.star-1 { top: 18%; left: 12%; }
.star-2 { top: 14%; right: 13%; width: 6px; height: 6px; animation-delay: -0.6s; animation-duration: 3.4s; }
.star-3 { top: 48%; left: 7%; width: 3px; height: 3px; animation-delay: -1.4s; animation-duration: 2.4s; }
.star-4 { top: 44%; right: 8%; width: 3px; height: 3px; animation-delay: -2s; animation-duration: 3.1s; }
.star-5 { top: 74%; left: 15%; width: 5px; height: 5px; animation-delay: -0.9s; }
.star-6 { top: 70%; right: 14%; animation-delay: -1.8s; animation-duration: 3.3s; }
.star-7 { top: 30%; left: 18%; width: 3px; height: 3px; animation-delay: -2.6s; animation-duration: 2.6s; }
.star-8 { top: 84%; right: 18%; animation-delay: -1.1s; animation-duration: 3s; }
@keyframes twinkle {
  0%, 100% { opacity: 0.25; transform: scale(0.7); }
  50% { opacity: 1; transform: scale(1.3); }
}

/* 尊重系统减弱动效设置 */
@media (prefers-reduced-motion: reduce) {
  .holo-card {
    transform: none;
  }
  .holo-rays,
  .podium-rainbow,
  .star {
    animation: none;
  }
}
</style>
