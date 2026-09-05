<template>
  <div
    ref="cardRef"
    class="entity-header rounded-2xl shadow-sm overflow-hidden relative"
    :class="bgAdjustable && bgEdit ? 'cursor-ns-resize' : ''"
  >
    <!-- 背景层：歌手=自定义背景图（可滚轮/拖拽调整位置）；专辑/歌曲=封面模糊铺底（调整功能关闭） -->
    <img
      :src="bgImage || HERO_BG_URL"
      alt=""
      class="entity-bg-img"
      :class="{ 'is-adjustable': bgAdjustable, 'is-blurred': !bgAdjustable }"
      :style="bgAdjustable ? { objectPosition: `center ${bgPosY}%` } : undefined"
      @click="bgAdjustable && onBgClick()"
    />
    <div class="entity-bg-overlay" :class="{ 'is-soft': bgAdjustable }"></div>

    <div class="entity-content px-6 py-6">
      <div class="flex flex-col lg:flex-row gap-5 lg:gap-6">
        <div class="flex flex-col md:flex-row items-center gap-4 flex-1 min-w-0">
          <img
            :src="cover"
            alt=""
            class="entity-cover shadow-lg cursor-zoom-in"
            :class="[
              coverShape === 'circle' ? 'cover-circle' : 'cover-square',
              coverContain ? 'object-contain p-2' : 'object-cover',
            ]"
            @click="onCoverClick"
          />
          <div class="text-center md:text-left min-w-0 flex-1">
            <slot />
          </div>
        </div>

        <!-- 简介面板（毛玻璃深色卡，长文内部滚动；无简介则整块不渲染） -->
        <div v-if="introHtml" class="bio-panel lg:w-[420px] lg:flex-none">
          <div class="bio-inner">
            <div v-if="introTitle" class="bio-title">
              <svg
                width="13"
                height="13"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <polyline points="14 2 14 8 20 8" />
                <line x1="16" y1="13" x2="8" y2="13" />
                <line x1="16" y1="17" x2="8" y2="17" />
                <polyline points="10 9 9 9 8 9" />
              </svg>
              <span>{{ introTitle }}</span>
            </div>
            <div class="bio-text article-content" v-html="introHtml"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- 背景位置调整开关（仅 bgAdjustable 时渲染：左上角隐蔽小按钮，开启后滚轮/拖拽才生效） -->
    <button
      v-if="bgAdjustable"
      type="button"
      class="bg-edit-toggle"
      :class="bgEdit ? 'bg-edit-on' : ''"
      :title="bgEdit ? '退出背景调整' : '调整背景位置'"
      @click="bgEdit = !bgEdit"
    >
      <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor"><path d="M8.59 16.34L4 12l4.59-4.34L9.42 8.5L6.85 11H15v2H6.85l2.57 2.5zM15.41 7.66L20 12l-4.59 4.34l-.83-.84L17.15 13H9v-2h8.15l-2.57-2.5z"/></svg>
    </button>
  </div>

  <!-- 背景位置提示气泡 -->
  <Teleport to="body">
    <div
      v-if="hint"
      class="fixed bottom-6 left-1/2 -translate-x-1/2 bg-black/70 text-white text-sm px-4 py-2 rounded-lg z-[10000] pointer-events-none backdrop-blur-sm transition-opacity duration-300"
    >{{ hint }}</div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { useUiStore } from '@/stores/ui'
import { HERO_BG_URL } from '@/lib/constants'

/**
 * 实体详情页统一头部卡（歌手 / 专辑 / 歌曲三页复用）
 * - 背景层：歌手用自定义背景图并开启位置调整；专辑/歌曲直接用封面模糊铺底
 * - 左侧封面（圆形头像 / 方形专辑封）+ 信息插槽；右侧简介面板（可带标题）
 */
const props = withDefaults(defineProps<{
  /** 主图：歌手头像 / 专辑封面 / 歌曲封面 */
  cover: string
  /** 封面形状：circle=圆形头像（歌手），square=圆角方形（专辑/歌曲） */
  coverShape?: 'circle' | 'square'
  /** 封面图是否用 contain（logo 兜底图留白居中） */
  coverContain?: boolean
  /** 背景图 URL（歌手传 bg_image；专辑/歌曲传封面；缺省用站点默认背景） */
  bgImage?: string
  /** 是否开启背景图位置调整（仅歌手页） */
  bgAdjustable?: boolean
  /** 背景初始位置百分比（歌手 bg_position_y） */
  bgPosition?: number
  /** 简介面板标题（歌手简介 / 专辑简介 / 歌曲简介） */
  introTitle?: string
  /** 简介内容 HTML（mdToHtml 产物；纯文本亦可） */
  introHtml?: string
  /** 点击封面的预览图列表，默认 [cover] */
  previewImages?: string[]
}>(), {
  coverShape: 'square',
  coverContain: false,
  bgAdjustable: false,
  bgPosition: 50,
})

const ui = useUiStore()

function onCoverClick() {
  ui.openPreview(props.previewImages?.length ? props.previewImages : [props.cover], 0)
}
function onBgClick() {
  // 歌手页原行为：背景图优先预览；背景与封面同图时去重
  const list = [props.bgImage, props.cover].filter((u): u is string => !!u)
  ui.openPreview([...new Set(list)], 0)
}

// ============ 背景图上下调整（隐蔽模式：左上角开关开启后，滚轮 + 拖拽才生效） ============
const cardRef = ref<HTMLElement>()
const bgEdit = ref(false)
const bgPosY = ref(props.bgPosition)
const hint = ref('')

let dragging = false
let lastY = 0
let hintTimer: ReturnType<typeof setTimeout> | undefined

// 数据到位后同步背景位置（SSG 阶段 fetcher 晚于初始化）
watch(() => props.bgPosition, v => { bgPosY.value = v ?? 50 }, { immediate: true })

function applyPos() {
  bgPosY.value = Math.max(0, Math.min(100, bgPosY.value))
  hint.value = `背景位置：${Math.round(bgPosY.value)}%`
  clearTimeout(hintTimer)
  hintTimer = setTimeout(() => (hint.value = ''), 2000)
}

// setup 顶层注册（VueUse 自动跟随组件卸载清理；客户端 only）
// 仅调整模式开启时拦截滚轮；bio 简介面板内部滚动永不触发
useEventListener(cardRef, 'wheel', (e: WheelEvent) => {
  if (!bgEdit.value) return
  if ((e.target as HTMLElement).closest('.bio-panel')) return
  e.preventDefault()
  bgPosY.value += e.deltaY > 0 ? 3 : -3
  applyPos()
}, { passive: false })

// window 监听仅客户端注册（SSG 服务端渲染无 window，直接引用会抛 ReferenceError）
if (!import.meta.env.SSR) {
  useEventListener(window, 'pointerdown', (e: PointerEvent) => {
    if (!bgEdit.value) return
    if ((e.target as HTMLElement).closest('a, img, button, .bio-panel')) return
    dragging = true
    lastY = e.clientY
  })
  useEventListener(window, 'pointermove', (e: PointerEvent) => {
    if (!dragging) return
    bgPosY.value += (lastY - e.clientY) * 0.3
    lastY = e.clientY
    applyPos()
  })
  useEventListener(window, 'pointerup', () => (dragging = false))
}
</script>

<style scoped>
.entity-header {
  position: relative;
  min-height: 200px;
}

/* 背景层 */
.entity-bg-img {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  z-index: 0;
}
/* 专辑/歌曲：封面模糊铺底（放大裁切隐藏模糊边缘），不可调整、不可点击预览 */
.entity-bg-img.is-blurred {
  filter: blur(28px) brightness(0.9);
  transform: scale(1.15);
  pointer-events: none;
}
.entity-bg-overlay {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
}
/* 模糊封面底色深浅不一，遮罩略重保证白字可读；歌手自选背景图用轻遮罩 */
.entity-bg-overlay.is-soft {
  background: linear-gradient(135deg, rgba(0, 0, 0, 0.35) 0%, rgba(0, 0, 0, 0.25) 100%);
}
.entity-bg-overlay:not(.is-soft) {
  background: linear-gradient(135deg, rgba(0, 0, 0, 0.55) 0%, rgba(0, 0, 0, 0.42) 100%);
}
.entity-content {
  position: relative;
  z-index: 2;
  /* 头部卡为深色背景（封面模糊 / 自定义背景 + 遮罩），插槽文字默认白色：
     避免调用页只写 opacity-xx 漏写 text-white，导致深色文字继承到深底上隐形 */
  color: rgba(255, 255, 255, 0.92);
  /* 浅封面兜底：副标题/标签白字在高亮模糊背景上靠深色阴影勾勒（标题 h1 自带 drop-shadow filter，下面摘掉避免双重阴影） */
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.5);
}
/* slot 内容在父组件作用域，需 :deep 穿透；h1 已有 Tailwind drop-shadow，不再叠加文字阴影 */
.entity-content :deep(h1) {
  text-shadow: none;
}

/* 封面 */
.cover-circle {
  width: 140px;
  height: 140px;
  border-radius: 9999px;
  border: 4px solid #fff;
  background: rgba(255, 255, 255, 0.2);
}
.cover-square {
  width: 112px;
  height: 112px;
  border-radius: 16px;
  border: 4px solid rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.15);
}
@media (min-width: 768px) {
  .cover-square {
    width: 144px;
    height: 144px;
  }
}

/* 背景调整开关：左上角隐蔽小按钮（半透明，hover 才明显，开启后粉色高亮） */
.bg-edit-toggle {
  position: absolute;
  left: 10px;
  top: 10px;
  z-index: 3;
  width: 28px;
  height: 28px;
  border-radius: 9999px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  background: rgba(255, 255, 255, 0.14);
  backdrop-filter: blur(6px);
  color: rgba(255, 255, 255, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s;
}
.bg-edit-toggle:hover {
  background: rgba(255, 255, 255, 0.28);
  color: #fff;
}
.bg-edit-on {
  background: #ec4899;
  border-color: #ec4899;
  color: #fff !important;
  box-shadow: 0 0 0 3px rgba(236, 72, 153, 0.25);
}

/* 右侧简介面板：竖直居中，毛玻璃卡片，长文内部滚动（全局细滚动条） */
.bio-panel {
  display: flex;
  align-items: center;
  min-width: 0;
}
.bio-inner {
  background: rgba(17, 24, 39, 0.62);
  backdrop-filter: blur(10px);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 12px 16px 14px;
  width: 100%;
  /* 深底卡片自带底色，摘掉头部容器的文字阴影 */
  text-shadow: none;
}
.bio-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.06em;
  color: rgba(255, 255, 255, 0.62);
  margin-bottom: 8px;
}
.bio-title svg {
  color: #f472b6;
  flex-shrink: 0;
}
.bio-text {
  font-size: 13px;
  line-height: 1.8;
  color: rgba(255, 255, 255, 0.9);
  max-height: 150px;
  overflow-y: auto;
  word-break: break-word;
}

/* 深底覆盖全局 article-content 的深色文字排版（v-html 内容需 :deep 穿透 scoped） */
.bio-text :deep(p),
.bio-text :deep(li),
.bio-text :deep(td),
.bio-text :deep(th) {
  color: rgba(255, 255, 255, 0.82);
}
.bio-text :deep(h1),
.bio-text :deep(h2),
.bio-text :deep(h3),
.bio-text :deep(h4),
.bio-text :deep(h5) {
  color: rgba(255, 255, 255, 0.95);
}
.bio-text :deep(h6) {
  color: rgba(255, 255, 255, 0.6);
}
.bio-text :deep(a) {
  color: #f472b6;
}
.bio-text :deep(a:hover) {
  color: #f9a8d4;
}
.bio-text :deep(blockquote) {
  border-left-color: #ec4899;
  background: rgba(236, 72, 153, 0.08);
  color: rgba(255, 255, 255, 0.7);
}
.bio-text :deep(hr) {
  border-color: rgba(255, 255, 255, 0.14);
}
.bio-text :deep(:not(pre) > code) {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.16);
  color: #f9a8d4;
}
.bio-text :deep(th) {
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(255, 255, 255, 0.16);
}
.bio-text :deep(td) {
  border-color: rgba(255, 255, 255, 0.16);
}
/* tip-box 为全局样式（main.css），自带浅底深字：内部文字继承其自身配色，不走深底白字 */
.bio-text :deep(.tip-box p),
.bio-text :deep(.tip-box li),
.bio-text :deep(.tip-box td),
.bio-text :deep(.tip-box th) {
  color: inherit;
}
</style>
