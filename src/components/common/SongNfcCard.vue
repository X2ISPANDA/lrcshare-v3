<template>
  <RouterLink
    :to="`/song/${song.id}`"
    class="group relative aspect-square rounded-2xl overflow-hidden shadow-sm hover:shadow-xl hover:-translate-y-1 transition-all duration-300 bg-gradient-to-br from-pink-400 to-purple-500 block"
  >
    <!-- 封面（无封面用渐变兜底），点击封面可预览大图；懒加载，列表页只加载视口内图片 -->
    <img
      v-if="song.cover || song.album_cover"
      :src="song.cover || song.album_cover!"
      :alt="song.title"
      loading="lazy"
      decoding="async"
      class="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-300 cursor-zoom-in"
      @click.prevent.stop="ui.openPreview([song.cover || song.album_cover!])"
    />
    <span v-else class="absolute inset-0 flex items-center justify-center text-white/90 text-4xl">🎵</span>

    <!-- NFC 角标 -->
    <svg class="absolute top-2.5 right-2.5 w-4 h-4 text-white/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
      <path d="M6 8.5a8.5 8.5 0 0 0 12 0" />
      <path d="M8.8 11.5a4.5 4.5 0 0 0 6.4 0" />
      <circle cx="12" cy="15.5" r="1" fill="currentColor" stroke="none" />
    </svg>

    <!-- hover 查看歌词遮罩（本站只提供歌词，不放歌） -->
    <span class="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-center justify-center text-white font-semibold text-sm">查看歌词</span>

    <!-- 底部渐变信息：歌名 / 歌手 / 投稿人 -->
    <div class="absolute inset-x-0 bottom-0 p-3 pt-10 bg-gradient-to-t from-black/85 via-black/45 to-transparent">
      <div class="text-white font-bold text-sm truncate">{{ song.title }}</div>
      <div class="text-white/80 text-xs truncate">{{ song.artist_name || '未知' }}</div>
      <div v-if="song.contributor" class="text-white/70 text-[11px] truncate">📤 {{ song.contributor.name }} 投稿</div>
    </div>
  </RouterLink>
</template>

<script setup lang="ts">
import { useUiStore } from '@/stores/ui'
import type { SongWithNames } from '@/lib/types'

/** 歌曲 NFC 方卡（封面满印 + 底部渐变压字 + 投稿人）：首页最新歌词 / 歌词库共用 */
defineProps<{ song: SongWithNames }>()

const ui = useUiStore()
</script>
