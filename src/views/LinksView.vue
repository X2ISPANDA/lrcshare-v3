<template>
  <main class="max-w-5xl mx-auto px-4 py-8">
    <div class="bg-white rounded-2xl shadow-sm p-8 mb-6">
      <div class="text-sm text-pink-500 mb-2">Friends</div>
      <h1 class="text-3xl font-bold text-gray-800 mb-2">友情链接</h1>
      <p class="text-gray-500">UNDALYRIC UNDAMUSIC</p>
    </div>

    <div class="mb-6">
      <div v-if="loading" class="text-center py-8 text-gray-400">加载中...</div>
      <div v-else-if="!friends?.length" class="text-center py-8 text-gray-400">暂无友链</div>
      <template v-else>
        <!-- 分组友链 -->
        <div v-for="group in grouped" :key="group.category.id" class="mb-8">
          <div class="flex items-center gap-2 mb-4">
            <span class="inline-block w-1 h-5 rounded" :style="{ backgroundColor: group.category.color || '#3b82f6' }"></span>
            <h2 class="text-lg font-bold text-gray-800">{{ group.category.icon }} {{ group.category.name }}</h2>
            <span class="text-sm text-gray-400">({{ group.items.length }})</span>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <a
              v-for="item in group.items"
              :key="item.id"
              :href="item.url"
              target="_blank"
              rel="noopener"
              class="bg-white rounded-xl shadow-sm p-5 flex items-start gap-4 hover:-translate-y-0.5 hover:shadow-md transition"
            >
              <img :src="item.avatar || LOGO_URL" referrerpolicy="no-referrer" :alt="item.name" class="w-14 h-14 rounded-full object-cover bg-gray-100 shrink-0 cursor-zoom-in" @click.prevent.stop="ui.openPreview([item.avatar || LOGO_URL])" />
              <div class="min-w-0 flex-1">
                <div class="font-bold text-gray-800 mb-1 truncate">{{ item.name }}</div>
                <div class="text-sm text-gray-500 line-clamp-2">{{ item.descr || '' }}</div>
              </div>
            </a>
          </div>
        </div>

        <!-- 未分类 -->
        <div v-if="noCategory.length" class="mb-8">
          <div class="flex items-center gap-2 mb-4">
            <span class="inline-block w-1 h-5 rounded bg-gray-400"></span>
            <h2 class="text-lg font-bold text-gray-800">🔗 未分类</h2>
            <span class="text-sm text-gray-400">({{ noCategory.length }})</span>
          </div>
          <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <a
              v-for="item in noCategory"
              :key="item.id"
              :href="item.url"
              target="_blank"
              rel="noopener"
              class="bg-white rounded-xl shadow-sm p-5 flex items-start gap-4 hover:-translate-y-0.5 hover:shadow-md transition"
            >
              <img :src="item.avatar || LOGO_URL" referrerpolicy="no-referrer" :alt="item.name" class="w-14 h-14 rounded-full object-cover bg-gray-100 shrink-0 cursor-zoom-in" @click.prevent.stop="ui.openPreview([item.avatar || LOGO_URL])" />
              <div class="min-w-0 flex-1">
                <div class="font-bold text-gray-800 mb-1 truncate">{{ item.name }}</div>
                <div class="text-sm text-gray-500 line-clamp-2">{{ item.descr || '' }}</div>
              </div>
            </a>
          </div>
        </div>
      </template>
    </div>

    <div class="bg-white rounded-2xl shadow-sm p-8">
      <h2 class="text-xl font-bold text-gray-800 mb-3">💌 我要申请友链</h2>
      <p class="text-gray-600 mb-3">本站专注于滚动歌词分享与社区交流，欢迎主题相近的优质站点互换友链。</p>
      <p class="text-gray-600">
        申请请发送邮件至：<a href="mailto:xmy329@gmail.com" class="text-pink-600 hover:underline font-medium">xmy329@gmail.com</a>
      </p>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useHead } from '@unhead/vue'
import { api } from '@/lib/api'
import { LOGO_URL } from '@/lib/constants'
import { useSSGData } from '@/composables/useSSGData'
import { useUiStore } from '@/stores/ui'
import type { Friend, FriendCategory } from '@/lib/types'

useHead({ title: '友情链接 - LrcShare' })

const ui = useUiStore()
const { data: friends, loading } = useSSGData<Friend[]>('links', () => api.getFriends())

/** 按 category 分组（保持服务端返回顺序） */
const grouped = computed<{ category: FriendCategory; items: Friend[] }[]>(() => {
  const map = new Map<string, { category: FriendCategory; items: Friend[] }>()
  for (const item of friends.value || []) {
    const cat = (item as Friend & { category: FriendCategory | null }).category
    if (!cat) continue
    if (!map.has(cat.id)) map.set(cat.id, { category: cat, items: [] })
    map.get(cat.id)!.items.push(item)
  }
  return [...map.values()]
})

const noCategory = computed<Friend[]>(() =>
  (friends.value || []).filter(item => !(item as Friend & { category: FriendCategory | null }).category),
)
</script>
