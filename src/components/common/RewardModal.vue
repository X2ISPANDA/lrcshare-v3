<template>
  <Teleport to="body">
    <div
      v-if="modelValue"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="close"
    >
      <div class="bg-white rounded-2xl p-6 max-w-md w-full mx-4">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-xl font-bold text-gray-800">赞助 LrcShare</h3>
          <button class="text-gray-400 hover:text-gray-600 text-2xl" @click="close">&times;</button>
        </div>
        <div class="text-center text-gray-500 mb-4">觉得有用？请站长喝杯奶茶吧～</div>
        <div class="flex justify-center gap-4">
          <div class="text-center">
            <div class="w-40 h-40 rounded-xl overflow-hidden mb-2 border border-gray-100">
              <img :src="qrCodes[0]" class="w-full h-full object-cover cursor-zoom-in" alt="微信赞助" @click="ui.openPreview(qrCodes, 0)" />
            </div>
            <div class="text-sm text-gray-600">微信赞助</div>
          </div>
          <div class="text-center">
            <div class="w-40 h-40 rounded-xl overflow-hidden mb-2 border border-gray-100">
              <img :src="qrCodes[1]" class="w-full h-full object-cover cursor-zoom-in" alt="支付宝赞助" @click="ui.openPreview(qrCodes, 1)" />
            </div>
            <div class="text-sm text-gray-600">支付宝赞助</div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted } from 'vue'
import { useUiStore } from '@/stores/ui'
import { qrCodeUrls } from '@/lib/imageSource'

/** 赞赏二维码（随图片源开关在原外链 / OSS 灾备间切换） */
const qrCodes = computed(() => qrCodeUrls())

const props = defineProps<{ modelValue: boolean }>()
const emit = defineEmits<{ (e: 'update:modelValue', v: boolean): void }>()
const ui = useUiStore()

function close() {
  emit('update:modelValue', false)
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape' && props.modelValue) close()
}
onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))
</script>
