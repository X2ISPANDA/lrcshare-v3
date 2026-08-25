<template>
  <div v-if="links.length" class="flex items-center gap-1 flex-wrap">
    <template v-for="link in links" :key="link.key">
      <!-- 单图标：URL 直接跳转；邮箱/微信/QQ 等弹出复制操作框 -->
      <a
        :href="link.href"
        :target="link.href?.startsWith('http') ? '_blank' : undefined"
        :rel="link.href?.startsWith('http') ? 'noopener noreferrer' : undefined"
        :title="link.label"
        class="inline-flex items-center justify-center transition cursor-pointer"
        :class="iconClass"
        @click.stop="!link.href && openCopy(link)"
      ><AppIcon :name="link.icon" :class="iconSize" /></a>
    </template>

    <!-- 联系方式操作弹窗（邮箱：复制 + 写邮件；微信等：仅复制） -->
    <Teleport to="body">
      <Transition name="copy-fade">
        <div
          v-if="copyModal"
          class="fixed inset-0 z-[3000] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          @click.self="copyModal = null"
        >
          <div class="bg-white rounded-2xl shadow-xl p-6 w-80 max-w-full">
            <div class="flex items-center gap-3">
              <span class="w-11 h-11 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0">
                <AppIcon :name="copyModal.key" class="w-7 h-7" />
              </span>
              <div class="min-w-0">
                <div class="font-semibold text-gray-800">{{ copyModal.label }}</div>
                <div class="text-xs text-gray-400">{{ copyModal.hint }}</div>
              </div>
            </div>
            <div class="mt-4 px-4 py-3 bg-gray-50 border border-gray-100 rounded-xl text-center text-gray-700 break-all select-all font-medium">{{ copyModal.value }}</div>
            <div class="mt-4 flex gap-3">
              <button
                class="flex-1 py-2.5 rounded-xl text-white font-medium transition"
                :class="copied ? 'bg-green-500' : 'bg-pink-500 hover:bg-pink-600'"
                @click="doCopy"
              >{{ copied ? '已复制' : '复制' }}</button>
              <a
                v-if="copyModal.mailto"
                :href="copyModal.mailto"
                class="flex-1 py-2.5 rounded-xl bg-gray-600 hover:bg-gray-700 text-white font-medium transition text-center"
              >✉️ 写邮件</a>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import AppIcon from '@/components/common/AppIcon.vue'
import { contactLabel } from '@/lib/constants'
import type { Contributor } from '@/lib/types'

const props = defineProps<{ contributor: Contributor; variant?: 'light' | 'white' }>()

const iconClass = computed(() =>
  props.variant === 'white'
    ? 'w-9 h-9 rounded-lg bg-white/90 backdrop-blur-sm shadow-sm hover:bg-white hover:scale-105'
    : 'w-6 h-6 text-gray-500 hover:text-pink-600',
)
const iconSize = computed(() => (props.variant === 'white' ? 'w-5.5 h-5.5' : 'w-5 h-5'))

/** 全量公开联系方式 → 图标列表：URL 直接跳转；
 *  邮箱/微信/QQ 等弹出操作框（邮箱额外带写邮件按钮）。
 *  键为英文（见 constants.ts CONTACT_LABELS），展示用中文标签 */
const links = computed<{ key: string; label: string; value: string; href?: string; icon: string }[]>(() => {
  const c = props.contributor
  if (!c?.public_contact || !c.contact_value) return []
  let cv: Record<string, string> = {}
  try {
    cv = typeof c.contact_value === 'string' ? JSON.parse(c.contact_value || '{}') : c.contact_value
  } catch {
    return []
  }
  return Object.entries(cv || {})
    .filter(([, v]) => v)
    .map(([k, v]) => {
      const key = k.toLowerCase()
      if (/^https?:\/\//i.test(v)) return { key, label: contactLabel(key), value: v, href: v, icon: key }
      return { key, label: contactLabel(key), value: v, icon: key }
    })
})

// ============ 操作弹窗 ============
const copyModal = ref<{ key: string; label: string; value: string; hint: string; mailto?: string } | null>(null)
const copied = ref(false)
let copyTimer: ReturnType<typeof setTimeout> | undefined

/** 邮箱判定：key 为 email 或值含 @ */
function isEmail(key: string, value: string): boolean {
  return /^(email|e-mail)$/i.test(key) || /@/.test(value)
}

function openCopy(link: { key: string; label: string; value: string }) {
  copyModal.value = isEmail(link.key, link.value)
    ? { key: link.key, label: link.label, value: link.value, hint: '可复制地址或直接写邮件', mailto: `mailto:${link.value.trim()}` }
    : { key: link.key, label: link.label, value: link.value, hint: `复制${link.label}号后前往对应平台添加` }
  copied.value = false
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const ta = document.createElement('textarea')
    ta.value = text
    document.body.appendChild(ta)
    ta.select()
    document.execCommand('copy')
    document.body.removeChild(ta)
    return true
  }
}

async function doCopy() {
  if (!copyModal.value) return
  await copyText(copyModal.value.value)
  copied.value = true
  clearTimeout(copyTimer)
  copyTimer = setTimeout(() => {
    copied.value = false
    copyModal.value = null
  }, 900)
}

onUnmounted(() => clearTimeout(copyTimer))
</script>

<style scoped>
.copy-fade-enter-active, .copy-fade-leave-active { transition: opacity 0.18s ease; }
.copy-fade-enter-from, .copy-fade-leave-to { opacity: 0; }
</style>
