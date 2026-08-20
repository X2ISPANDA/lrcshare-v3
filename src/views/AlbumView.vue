<template>
  <main class="max-w-4xl mx-auto px-4 py-8">
    <div v-if="loading" class="w-full text-center py-16 text-gray-400">加载中...</div>

    <div v-else-if="album" class="bg-white rounded-2xl shadow-sm overflow-hidden">
      <!-- 渐变头部 -->
      <div class="bg-gradient-to-r from-purple-500 to-pink-500 p-6 md:p-8 text-white">
        <div class="flex items-center gap-6">
          <div class="w-24 h-24 md:w-32 md:h-32 bg-white/20 rounded-xl flex items-center justify-center text-4xl md:text-6xl shadow-lg overflow-hidden flex-shrink-0">
            <img
              v-if="cover"
              :src="cover"
              alt="专辑封面"
              class="w-full h-full rounded-xl cursor-zoom-in"
              :class="cover === LOGO_URL ? 'object-contain p-2' : 'object-cover'"
              @click="ui.openPreview([cover], 0)"
            />
            <span v-else>💿</span>
          </div>
          <div class="min-w-0 text-center md:text-left">
            <h1 class="text-2xl md:text-3xl font-bold mb-2">{{ album.name }}</h1>
            <div class="text-base md:text-lg opacity-90">
              <template v-if="album.artists.length">
                <template v-for="(a, i) in album.artists" :key="a.id">
                  <span v-if="i > 0"> / </span>
                  <RouterLink :to="`/artist/${a.id}`" class="hover:underline">{{ a.name }}</RouterLink>
                </template>
              </template>
              <span v-else>{{ album.artist_name || '未知' }}</span>
            </div>
            <div class="text-xs md:text-sm opacity-75 mt-2">{{ album.year || '' }}</div>
          </div>
        </div>
      </div>

      <!-- 专辑介绍（毛玻璃渐变卡，与歌曲简介同款样式） -->
      <div v-if="descriptionHtml" class="mx-4 md:mx-6 mt-5">
        <div class="relative overflow-hidden rounded-2xl border border-pink-200/60
                    bg-gradient-to-br from-pink-50/90 via-white to-purple-50/70
                    backdrop-blur-sm shadow-[0_2px_12px_-4px_rgba(236,72,153,0.15)]">
          <div class="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-pink-400 via-pink-300 to-purple-300"></div>
          <div class="flex items-start gap-3 px-5 pt-5 pb-5 md:px-6">
            <span class="w-9 h-9 rounded-xl bg-gradient-to-br from-pink-400 to-pink-500 text-white flex items-center justify-center shadow-sm flex-shrink-0">
              <svg class="w-4.5 h-4.5" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V20c0 1 0 1 1 1z" />
                <path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3c0 1 0 1 1 1z" />
              </svg>
            </span>
            <div class="text-sm text-gray-600 leading-relaxed article-content min-w-0" v-html="descriptionHtml"></div>
          </div>
        </div>
      </div>

      <!-- 歌曲列表（多碟专辑按 Disc 分组，单碟维持原样） -->
      <template v-if="songs.length">
        <div v-for="group in discGroups" :key="group.disc">
          <div v-if="hasMultipleDiscs" class="px-4 md:px-6 pt-5 pb-1 text-sm font-semibold text-gray-500 tracking-wide">
            Disc {{ group.disc }}
          </div>

          <!-- 桌面端：表格 -->
          <div class="hidden md:block album-table-wrap">
            <table class="album-table">
              <thead>
                <tr>
                  <th class="col-num">#</th>
                  <th class="col-song">歌曲</th>
                  <th class="col-singer">歌手</th>
                  <th class="col-dur">时长</th>
                </tr>
              </thead>
              <tbody>
                <RouterLink
                  v-for="song in group.songs"
                  :key="song.id"
                  :to="`/song/${song.id}`"
                  custom
                  v-slot="{ navigate }"
                >
                  <tr @click="navigate">
                    <td class="col-num text-xs text-gray-400">{{ song.track && song.track > 0 ? song.track : '—' }}</td>
                    <td class="col-song text-gray-800 font-medium"><span class="ellipsis">{{ song.title }}</span></td>
                    <td class="col-singer text-sm">
                      <template v-if="song.artist_ids?.length">
                        <template v-for="(id, i) in song.artist_ids" :key="id">
                          <span v-if="i > 0"> / </span>
                          <RouterLink
                            v-if="artistMap.get(id)"
                            :to="`/artist/${id}`"
                            class="text-gray-500 hover:text-pink-600 hover:underline"
                            @click.stop
                          >{{ artistMap.get(id)!.name }}</RouterLink>
                          <span v-else class="text-gray-500">未知</span>
                        </template>
                      </template>
                      <span v-else class="text-gray-500">{{ song.artist_name }}</span>
                    </td>
                    <td class="col-dur text-gray-400 text-sm">{{ formatDuration(song.duration) }}</td>
                  </tr>
                </RouterLink>
              </tbody>
            </table>
          </div>

          <!-- 移动端：列表 -->
          <div class="md:hidden px-4 flex flex-col">
            <RouterLink
              v-for="song in group.songs"
              :key="song.id"
              :to="`/song/${song.id}`"
              class="flex items-center gap-3 py-3 border-b border-gray-100 last:border-b-0"
            >
              <span class="w-7 h-7 flex items-center justify-center text-[13px] font-semibold text-pink-500 bg-pink-50 rounded-lg shrink-0">
                {{ song.track && song.track > 0 ? String(song.track).padStart(2, '0') : '♪' }}
              </span>
              <div class="flex-1 min-w-0 flex flex-col gap-0.5">
                <span class="text-[15px] font-semibold text-gray-800 truncate">{{ song.title }}</span>
                <span class="text-xs text-gray-400 truncate">{{ songNames(song) }}</span>
              </div>
              <span class="text-[13px] text-gray-400 tabular-nums shrink-0">{{ formatDuration(song.duration) }}</span>
            </RouterLink>
          </div>
        </div>
      </template>
      <div v-else class="p-8 text-center text-gray-400">暂无歌曲</div>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useHead } from '@unhead/vue'
import { api, formatDuration } from '@/lib/api'
import { mdToHtml } from '@/lib/markdown'
import { useSSGData } from '@/composables/useSSGData'
import { useUiStore } from '@/stores/ui'
import { LOGO_URL } from '@/lib/constants'
import type { AlbumWithArtists, Artist, SongWithNames } from '@/lib/types'

const route = useRoute()
const albumId = route.params.id as string
const ui = useUiStore()

interface AlbumPageData {
  album: AlbumWithArtists
  songs: SongWithNames[]
  /** 专辑涉及的艺术家（序列化友好，客户端构建 Map） */
  artists: Artist[]
}

const { data: page, loading } = useSSGData<AlbumPageData>(`album:${albumId}`, async () => {
  const [album, songs] = await Promise.all([api.getAlbum(albumId), api.getAlbumSongs(albumId)])

  // 按碟号+曲目号排序，曲目号相同时按标题（多碟专辑支持 Disc 分组展示）
  songs.sort((a, b) => {
    const da = a.disc || 1
    const db = b.disc || 1
    if (da !== db) return da - db
    const ta = a.track || 0
    const tb = b.track || 0
    if (ta !== tb) return ta - tb
    return (a.title || '').localeCompare(b.title || '')
  })

  // 批量取专辑涉及的艺术家（专辑艺术家 + 各歌曲歌手），替代 v2 的全量拉取
  const needed = new Set<string>()
  ;(album.artist_ids || []).forEach(id => needed.add(id))
  songs.forEach(s => (s.artist_ids || []).forEach(id => needed.add(id)))
  const artists = await api.getArtistsByIds([...needed])

  return { album, songs, artists }
})

const album = computed(() => page.value?.album)
const songs = computed(() => page.value?.songs || [])
const artistMap = computed(() => new Map((page.value?.artists || []).map(a => [a.id, a])))
const cover = computed(() => album.value?.cover || LOGO_URL)
const descriptionHtml = computed(() => mdToHtml(album.value?.description))

/** 按碟号分组（disc 为空视为 Disc 1）；单碟时 hasMultipleDiscs=false，不显示分组标题 */
const discGroups = computed(() => {
  const groups = new Map<number, SongWithNames[]>()
  for (const s of songs.value) {
    const d = s.disc || 1
    if (!groups.has(d)) groups.set(d, [])
    groups.get(d)!.push(s)
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([disc, list]) => ({ disc, songs: list }))
})
/** 是否展示碟号标题：专辑内任一歌曲 disc>1 即分碟展示（全为 Disc 1 的维持原样，含只有一首歌但在 Disc 3 的情况） */
const hasMultipleDiscs = computed(() => discGroups.value.some(g => g.disc > 1))

useHead({
  title: computed(() => (album.value ? `${album.value.name} - LrcShare` : '专辑详情 - LrcShare')),
  meta: [
    { name: 'description', content: computed(() => (album.value ? `${album.value.name}${album.value.year ? ` (${album.value.year})` : ''} 专辑，共 ${songs.value.length} 首歌曲 - LrcShare` : '专辑详情')) },
  ],
})

function songNames(song: SongWithNames): string {
  const names = (song.artist_ids || []).map(id => artistMap.value.get(id)?.name || '未知')
  return names.join(' / ') || song.artist_name || ''
}
</script>

<style scoped>
/* 专辑页表格样式（迁移自 v2） */
.album-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.album-table {
  width: 100%;
  border-collapse: collapse;
  table-layout: fixed;
}
.album-table th,
.album-table td {
  padding: 12px 16px;
  box-sizing: border-box;
  vertical-align: middle;
}
.album-table thead th {
  font-size: 12px;
  color: #9ca3af;
  font-weight: normal;
  text-align: left;
  border-bottom: 1px solid #f3f4f6;
}
.album-table tbody tr {
  border-bottom: 1px solid #f9fafb;
  transition: background 0.15s;
  cursor: pointer;
}
.album-table tbody tr:hover { background: #f9fafb; }
.album-table tbody tr:last-child { border-bottom: none; }
.col-num { width: 56px; text-align: center; font-variant-numeric: tabular-nums; }
.col-song { width: auto; min-width: 0; }
.col-singer { width: 180px; text-align: right; }
.col-dur {
  width: 96px;
  text-align: right;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.album-table th.col-num { text-align: center; }
.album-table th.col-singer { text-align: right; }
.album-table th.col-dur { text-align: right; }
.ellipsis {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
