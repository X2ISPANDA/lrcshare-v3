<template>
  <Teleport to="body">
    <div
      v-if="ui.previewOpen"
      class="img-preview"
      @click.self="ui.closePreview()"
    >
      <button class="img-preview-btn img-preview-close" aria-label="关闭" @click="ui.closePreview()">✕</button>
      <button
        v-if="ui.previewImages.length > 1"
        class="img-preview-btn img-preview-prev"
        aria-label="上一张"
        :disabled="ui.previewIndex === 0"
        @click="ui.prevImage()"
      >‹</button>
      <img
        :src="ui.previewImages[ui.previewIndex]"
        alt="预览"
        :class="{ zoomed: zoomed }"
        @click="zoomed = !zoomed"
      />
      <button
        v-if="ui.previewImages.length > 1"
        class="img-preview-btn img-preview-next"
        aria-label="下一张"
        :disabled="ui.previewIndex === ui.previewImages.length - 1"
        @click="ui.nextImage()"
      >›</button>
      <div class="img-preview-counter">{{ ui.previewIndex + 1 }} / {{ ui.previewImages.length }}</div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { useUiStore } from '@/stores/ui'

const ui = useUiStore()
const zoomed = ref(false)

// 键盘操作：Esc 关闭，← → 切换
function onKeydown(e: KeyboardEvent) {
  if (!ui.previewOpen) return
  if (e.key === 'Escape') {
    e.preventDefault()
    ui.closePreview()
  }
  if (e.key === 'ArrowLeft') ui.prevImage()
  if (e.key === 'ArrowRight') ui.nextImage()
}
onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>

<style scoped>
.img-preview {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.9);
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.img-preview img {
  max-width: 90%;
  max-height: 90vh;
  object-fit: contain;
  transition: transform 0.3s ease;
  cursor: zoom-in;
}
.img-preview img.zoomed {
  cursor: zoom-out;
  transform: scale(2);
}
.img-preview-btn {
  position: absolute;
  width: 48px;
  height: 48px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  color: white;
  border: none;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 20px;
  transition: background 0.2s;
}
.img-preview-btn:hover { background: rgba(255, 255, 255, 0.3); }
.img-preview-btn:disabled { opacity: 0.3; cursor: default; }
.img-preview-close { top: 20px; right: 20px; }
.img-preview-prev { left: 20px; top: 50%; transform: translateY(-50%); }
.img-preview-next { right: 20px; top: 50%; transform: translateY(-50%); }
.img-preview-counter {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  color: white;
  font-size: 14px;
  background: rgba(0, 0, 0, 0.5);
  padding: 6px 16px;
  border-radius: 20px;
}
</style>
