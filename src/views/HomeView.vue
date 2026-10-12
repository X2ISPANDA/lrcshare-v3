<template>
  <div>
    <!-- Hero 区：背景图 + 艺术字标题 + 搜索框 -->
    <section class="hero-bg text-white py-20">
      <img :src="HERO_BG_URL" alt="背景" class="hero-bg-img" />
      <div class="hero-content max-w-3xl mx-auto px-4 text-center">
        <img :src="LOGO_URL" alt="LrcShare Logo" class="w-24 h-24 mx-auto mb-4" />
        <h1 class="text-4xl md:text-5xl font-bold mb-4">
          <span
            v-for="(c, i) in HERO_CHARS"
            :key="i"
            class="art-title-char"
            :style="{ '--fly-x': c.x, '--fly-y': c.y, '--fly-rotate': c.r, animationDelay: `${i * 80 + 300}ms` }"
          >{{ c.ch }}</span>
        </h1>
        <p class="text-lg opacity-90 mb-8">全球最小滚动歌词分享网站</p>

        <!-- 搜索框（下拉建议，Enter 进入全局搜索弹窗） -->
        <div class="relative max-w-xl mx-auto" ref="searchWrapRef">
          <input
            v-model="keyword"
            type="text"
            placeholder="搜索歌曲、歌手或歌词..."
            class="w-full px-6 py-4 pl-14 rounded-full bg-white/95 backdrop-blur text-gray-800 text-lg placeholder-gray-400 shadow-lg focus:outline-none focus:ring-4 focus:ring-white/30"
            autocomplete="off"
            @input="onInput"
            @focus="keyword.trim() && doSearch()"
            @keyup.enter="keyword.trim() && ui.openSearch(keyword.trim())"
          />
          <svg class="absolute left-5 top-1/2 -translate-y-1/2 w-6 h-6 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
          </svg>

          <!-- 下拉建议 -->
          <div v-if="dropdownOpen" class="absolute w-full mt-2 bg-white rounded-2xl shadow-2xl overflow-hidden z-50 text-left">
            <div class="p-4 border-b bg-gray-50">
              <div class="flex gap-4 text-sm">
                <button
                  v-for="t in SEARCH_TABS"
                  :key="t.key"
                  :class="activeTab === t.key ? 'font-semibold text-pink-600 border-b-2 border-pink-600 pb-1' : 'text-gray-500 pb-1'"
                  @click="switchTab(t.key)"
                >{{ t.label }}</button>
              </div>
            </div>
            <div class="max-h-96 overflow-y-auto">
              <div v-if="searching" class="p-4 text-center text-gray-400">搜索中...</div>
              <template v-else>
                <!-- 歌手 -->
                <template v-if="showSection('artists') && results.artists.length">
                  <div class="px-4 py-2 text-xs font-semibold text-gray-400 uppercase">🎤 歌手</div>
                  <RouterLink
                    v-for="artist in results.artists.slice(0, 3)"
                    :key="artist.id"
                    :to="`/artist/${artist.id}`"
                    class="flex items-center gap-3 px-4 py-2 hover:bg-gray-50"
                  >
                    <img :src="artist.avatar || LOGO_URL" class="w-8 h-8 rounded-full bg-gray-200 object-cover" />
                    <div class="flex-1">
                      <div class="text-sm font-medium text-gray-800">
                        <span v-html="hl(artist.name)"></span>
                        <span v-if="artist.disambiguation" class="text-xs text-purple-500 ml-1">({{ artist.disambiguation }})</span>
                        <span class="text-xs text-gray-400 ml-1">{{ artistTypeIcons(artist.types) }}</span>
                      </div>
                    </div>
                  </RouterLink>
                </template>

                <!-- 专辑 -->
                <template v-if="showSection('albums') && results.albums.length">
                  <div class="px-4 py-2 text-xs font-semibold text-gray-400 uppercase border-t">💿 专辑</div>
                  <RouterLink
                    v-for="album in results.albums.slice(0, 3)"
                    :key="album.id"
                    :to="`/album/${album.id}`"
                    class="flex items-center gap-3 px-4 py-2 hover:bg-gray-50"
                  >
                    <div class="w-8 h-8 bg-gradient-to-br from-pink-500 to-purple-600 rounded flex items-center justify-center overflow-hidden">
                      <img v-if="album.cover" :src="album.cover" class="w-full h-full object-cover" />
                      <span v-else class="text-white text-xs">💿</span>
                    </div>
                    <div class="flex-1">
                      <div class="text-sm font-medium text-gray-800"><span v-html="hl(album.name)"></span></div>
                      <div class="text-xs text-gray-500">{{ album.year || '' }}</div>
                    </div>
                  </RouterLink>
                </template>

                <!-- 单曲 -->
                <template v-if="showSection('songs') && results.songs.length">
                  <div class="px-4 py-2 text-xs font-semibold text-gray-400 uppercase border-t">🎵 单曲</div>
                  <RouterLink
                    v-for="song in results.songs.slice(0, 5)"
                    :key="song.id"
                    :to="`/song/${song.id}`"
                    class="flex items-center gap-3 px-4 py-2 hover:bg-gray-50"
                  >
                    <div class="w-8 h-8 bg-pink-100 rounded-full flex items-center justify-center text-pink-600 text-xs shrink-0">🎵</div>
                    <div class="flex-1 min-w-0">
                      <div class="text-sm font-medium text-gray-800 truncate"><span v-html="hl(song.title)"></span></div>
                      <div class="text-xs text-gray-500 truncate">
                        <span v-html="hl(song.artist_name)"></span> · <span v-html="hl(song.album_name ?? '')"></span>
                      </div>
                    </div>
                    <span class="text-xs text-gray-400 shrink-0 tabular-nums">{{ song.duration || '—' }}</span>
                  </RouterLink>
                </template>

                <!-- 歌词 -->
                <template v-if="showSection('lyrics') && results.lyrics.length">
                  <div class="px-4 py-2 text-xs font-semibold text-gray-400 uppercase border-t">📝 歌词</div>
                  <RouterLink
                    v-for="song in results.lyrics.slice(0, 5)"
                    :key="song.id"
                    :to="`/song/${song.id}`"
                    class="flex items-center gap-3 px-4 py-2 hover:bg-gray-50"
                  >
                    <div class="w-8 h-8 bg-purple-100 rounded-full flex items-center justify-center text-purple-600 text-xs shrink-0">📝</div>
                    <div class="flex-1 min-w-0">
                      <div class="text-sm font-medium text-gray-800 truncate"><span v-html="hl(song.title)"></span></div>
                      <div class="text-xs text-gray-500 truncate"><span v-html="hl(song.artist_name)"></span></div>
                      <div class="text-xs text-gray-400 mt-0.5 truncate">...<span v-html="hl(snippet(song))"></span>...</div>
                    </div>
                  </RouterLink>
                </template>

                <div v-if="totalCount === 0" class="p-8 text-center text-gray-400">没有找到相关结果</div>
              </template>

              <div v-if="totalCount > 0" class="border-t px-4 py-2 text-center">
                <button class="text-sm text-pink-600 hover:underline" @click="ui.openSearch(keyword.trim())">
                  查看全部 {{ totalCount }} 个结果 →
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 内容区 -->
    <main class="max-w-6xl mx-auto px-4 py-12">
      <!-- 艺术家 -->
      <section class="mb-12">
        <div class="flex items-center justify-between mb-6">
          <h2 class="text-2xl font-bold text-gray-800">艺术家</h2>
          <RouterLink to="/artists" class="text-pink-600 hover:underline">查看全部 →</RouterLink>
        </div>
        <div v-if="artistsLoading" class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <div v-for="i in 6" :key="i" class="bg-white rounded-2xl p-4 shadow-sm animate-pulse">
            <div class="w-16 h-16 rounded-full bg-gray-100 mx-auto mb-2"></div>
            <div class="h-4 bg-gray-100 rounded mx-auto w-2/3"></div>
          </div>
        </div>
        <div v-else-if="!artists?.length" class="text-center py-8 text-gray-400">暂无艺术家</div>
        <div v-else class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <RouterLink
            v-for="artist in artists"
            :key="artist.id"
            :to="`/artist/${artist.id}`"
            class="bg-white rounded-2xl p-4 shadow-sm hover:shadow-lg transition text-center"
          >
            <img :src="artist.avatar || LOGO_URL" :alt="artist.name" class="w-16 h-16 rounded-full mx-auto mb-2 bg-gray-100 object-contain cursor-zoom-in" @click.prevent.stop="ui.openPreview([artist.avatar || LOGO_URL])" />
            <div class="font-semibold text-gray-800 truncate">{{ artist.name }}</div>
            <div v-if="artist.disambiguation" class="text-xs text-purple-500 truncate">{{ artist.disambiguation }}</div>
            <div class="mt-1 text-xs text-gray-400">{{ artistTypeIcons(artist.types) }}</div>
            <div class="text-xs text-gray-500 mt-1">{{ artist.song_count }} 首作品</div>
          </RouterLink>
        </div>
      </section>

      <!-- 最新歌词：NFC 歌曲卡（封面满印 + 底部渐变压字 + 投稿人） -->
      <section class="mb-12">
        <div class="flex items-center justify-between mb-6">
          <h2 class="text-2xl font-bold text-gray-800">🆕 最新歌词</h2>
          <RouterLink to="/songs" class="text-pink-600 hover:underline text-sm">查看全部 →</RouterLink>
        </div>
        <div v-if="songsLoading" class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <div v-for="i in 10" :key="i" class="aspect-square rounded-2xl bg-white shadow-sm animate-pulse"></div>
        </div>
        <div v-else-if="!recentSongs?.length" class="bg-white rounded-2xl shadow-sm p-8 text-center text-gray-400">暂无歌词</div>
        <div v-else class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <SongNfcCard v-for="song in recentSongs" :key="song.id" :song="song" />
        </div>
      </section>

      <!-- 优秀贡献者：自动换行的「头像+名字」小块（仅按歌词贡献计数，纯歌曲分享账号不进入） -->
      <section class="bg-white rounded-2xl shadow-sm p-6 mb-8">
        <div class="flex items-center justify-between mb-4">
          <h2 class="text-xl font-bold text-gray-800">🏆 优秀贡献者</h2>
          <RouterLink to="/contributors" class="text-pink-600 hover:underline text-sm">查看全部 →</RouterLink>
        </div>
        <div v-if="contributorsLoading" class="flex flex-wrap justify-center gap-4">
          <div v-for="i in 12" :key="i" class="flex flex-col items-center gap-1.5 w-16">
            <div class="h-11 w-11 rounded-full bg-gray-100"></div>
            <div class="h-2.5 w-12 rounded bg-gray-100"></div>
          </div>
        </div>
        <div v-else-if="!visibleContributors.length" class="text-sm text-gray-400 text-center py-2">
          暂无贡献者，<RouterLink to="/contributors" class="text-pink-600 hover:underline">全部名单 →</RouterLink>
        </div>
        <div v-else class="flex flex-wrap justify-center gap-x-5 gap-y-4">
          <RouterLink
            v-for="c in visibleContributors"
            :key="c.id"
            :to="`/contributor/${c.id}`"
            :title="c.name"
            class="group flex w-16 flex-col items-center gap-1.5"
          >
            <img
              :src="c.avatar || LOGO_URL"
              :alt="c.name"
              class="h-11 w-11 rounded-full bg-gray-100 object-cover ring-1 ring-pink-100 transition group-hover:ring-pink-400"
            >
            <span class="w-full truncate text-center text-xs text-gray-600 group-hover:text-pink-700">{{ c.name }}</span>
          </RouterLink>
        </div>
      </section>

      <!-- 站长逼逼 + 随机推荐：保持两栏对称等高；推荐卡内部用 flex 纵向分配，
           理由区自动填满、按钮沉底，理由字少时不留下垂空白，字多时限高渐隐 -->
      <section class="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <!-- 站长逼逼 -->
        <div class="bg-white rounded-2xl shadow-sm p-6 h-full">
          <div class="flex items-center justify-between mb-5">
            <h2 class="text-xl font-bold text-gray-800">📝 站长逼逼</h2>
            <RouterLink to="/posts" class="text-pink-600 hover:underline text-sm">查看全部 →</RouterLink>
          </div>
          <div v-if="articlesLoading" class="space-y-4">
            <div v-for="i in 3" :key="i" class="p-3"><div class="h-3 bg-gray-100 rounded w-1/4 mb-2"></div><div class="h-4 bg-gray-100 rounded w-3/4 mb-2"></div><div class="h-3 bg-gray-100 rounded"></div></div>
          </div>
          <div v-else-if="!articles?.length" class="text-sm text-gray-400 text-center py-4">
            暂无文章，<RouterLink to="/posts" class="text-pink-600 hover:underline">去看看 →</RouterLink>
          </div>
          <div v-else class="space-y-4">
            <RouterLink
              v-for="a in articles"
              :key="a.id"
              :to="`/post/${a.slug || a.id}`"
              class="block group p-3 rounded-lg hover:bg-pink-50/50 transition"
            >
              <div class="flex items-center gap-2 mb-1">
                <span class="text-xs text-gray-400">{{ formatDate(a.created_at) }}</span>
              </div>
              <div class="text-sm font-semibold text-gray-800 group-hover:text-pink-600 truncate mb-1">{{ a.title }}</div>
              <div class="text-xs text-gray-500 line-clamp-2">{{ a.summary?.trim() || mdToText(a.content) }}</div>
            </RouterLink>
          </div>
        </div>

        <!-- � 音乐推荐：每次刷新客户端随机一首已通过分享，播放交给全局 Dock。
             is_own_work（投稿人自荐原创）走金色变体：金边卡片 + 金色徽章 + 暖色理由面板 + 实心支持按钮。
             存在生效中的 pinned_until 时本卡位改挂「新歌推荐」（多条 30s 轮播），点「换一首」才回随机。 -->
        <div
          class="rec-card bg-white rounded-2xl shadow-sm p-6 h-full flex flex-col"
          :class="{ 'rec-card--own': !!picked?.is_own_work, 'rec-card--pin': pinMode }"
          @mouseenter="onRecEnter"
          @mouseleave="onRecLeave"
        >
          <div class="flex items-center justify-between mb-5">
            <h2 class="text-xl font-bold text-gray-800">� 音乐推荐</h2>
            <button
              v-if="picked"
              type="button"
              class="text-pink-600 hover:underline text-sm inline-flex items-center gap-1"
              @click="shufflePicked"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M17.65 6.35A8 8 0 1 0 19.73 14h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4z" /></svg>
              换一首
            </button>
          </div>

          <!-- 三态（骨架 / 空态 / 内容）统一在一个 Transition 内：轮播切歌与水合出现都走淡入淡出 -->
          <Transition name="rec-fade" mode="out-in">
          <!-- 客户端水合前 / 曲库加载中 -->
          <div v-if="!recMounted || libraryLoading" key="loading" class="flex-1 animate-pulse p-3 flex flex-col justify-center">
            <div class="flex gap-4">
              <div class="w-24 h-24 rounded-xl bg-gray-100 shrink-0"></div>
              <div class="flex-1 space-y-2 py-1">
                <div class="h-3 bg-gray-100 rounded w-1/3"></div>
                <div class="h-4 bg-gray-100 rounded w-4/5"></div>
                <div class="h-3 bg-gray-100 rounded w-1/2"></div>
              </div>
            </div>
            <div class="h-16 bg-gray-100 rounded-xl mt-4"></div>
          </div>

          <!-- 全站还没有已通过分享 -->
          <div v-else-if="!picked" key="empty" class="flex-1 flex items-center justify-center text-sm text-gray-400 text-center py-8">
            还没有人分享歌曲，<RouterLink to="/music-share/submit" class="text-pink-600 hover:underline">来做第一个 →</RouterLink>
          </div>

          <div
            v-else
            :key="pinMode ? `pin-${pinIndex}` : `rnd-${picked.id}`"
            class="flex-1 flex flex-col"
          >
            <div class="flex gap-4">
              <img
                :src="picked.cover_url || LOGO_URL"
                :alt="picked.title"
                class="w-24 h-24 rounded-xl object-cover bg-pink-50 shrink-0"
              >
              <div class="flex-1 min-w-0 py-0.5">
                <div class="flex items-center gap-1.5 mb-1 flex-wrap">
                  <span class="inline-flex items-center gap-1 text-[11px] font-bold text-pink-600">
                    <AppIcon :name="picked.platform" class="w-3.5 h-3.5" />
                    {{ pickedPlatform?.label }}
                  </span>
                  <!-- 新歌推荐置顶角标：仅 pinMode（站长限时推荐位生效中）出现 -->
                  <span v-if="pinMode" class="rec-pin-badge">📢 新歌推荐</span>
                  <!-- 创作者自荐：金色徽章（与卡片墙 mws-badge-own 同一视觉语言） -->
                  <span v-else-if="picked.is_own_work" class="rec-own-badge">✦ 创作者自荐</span>
                </div>
                <div class="font-bold text-gray-800 truncate" :title="picked.title">{{ picked.title }}</div>
                <div v-if="picked.artist" class="text-xs text-gray-400 truncate mt-0.5">{{ picked.artist }}</div>
                <!-- 身份行：自荐作品=音乐人本人（附公开联系方式，有啥展示啥）；普通分享=推荐人。
                     已绑定贡献者→名字可点进主页；未绑定→投稿昵称快照纯文本 -->
                <div class="mt-1.5">
                  <div class="text-xs text-gray-500 truncate">
                    <span class="text-gray-400">{{ picked.is_own_work ? '音乐人：' : '推荐人：' }}</span>
                    <RouterLink
                      v-if="picked.contributor"
                      :to="`/contributor/${picked.contributor.id}`"
                      class="text-pink-600 hover:underline"
                    >{{ picked.contributor.name }}</RouterLink>
                    <span v-else>{{ picked.submitter_name }}</span>
                  </div>
                  <!-- 音乐人公开联系方式：链接一键外跳、号码弹复制；点击不触发卡片播放 -->
                  <ContactIcons
                    v-if="picked.is_own_work && picked.contributor"
                    :contributor="picked.contributor"
                    class="rec-contacts"
                  />
                </div>
              </div>
            </div>

            <!--
              推荐理由：粉色引号面板自动填满歌曲信息与按钮之间的剩余空间。
              - 字少：大号引号装饰 + 文字垂直居中，空间是有意留白而非塌陷；
              - 字多：限 8 行 + 底部渐隐遮罩，不把卡片撑得比左栏更高；
              - 数据库已强制必填，判空仅为防御迁移未执行的环境。
            -->
            <div
              v-if="picked.reason"
              class="rec-quote relative mt-4 flex-1 min-h-[7rem] overflow-hidden rounded-xl border border-pink-100 bg-gradient-to-br from-pink-50/90 to-purple-50/60 px-4 py-3"
              :class="{ 'rec-quote--own': picked.is_own_work }"
            >
              <span
                class="rec-quote-mark pointer-events-none absolute -top-3 left-1 select-none font-serif text-6xl leading-none text-pink-200/70"
              >“</span>
              <p class="relative h-full flex items-center text-sm leading-relaxed text-gray-600">
                <span class="rec-reason-clamp w-full">{{ picked.reason }}</span>
              </p>
            </div>

            <!-- 按钮沉底：mt-auto 保证无论理由长短，按钮始终贴卡片底部，与左栏视觉齐平。
                 右侧为置顶轮播的数字分页（北大官网式 1—2—3，仅多条置顶时出现） -->
            <div class="mt-auto pt-4 flex items-center gap-3 flex-wrap justify-between">
              <div class="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  class="inline-flex items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold text-white shadow-sm transition hover:opacity-90"
                  style="background: linear-gradient(135deg, #ec4899, #a855f7)"
                  @click="playPicked"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
                  播放这首
                </button>
                <!-- 去原平台收听 / 支持正版：普通曲为粉边描边；创作者自荐作品用金色实心强化引导 -->
                <a
                  :href="picked.source_url"
                  target="_blank"
                  rel="noopener noreferrer"
                  class="rec-support inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-semibold transition"
                  :class="picked.is_own_work ? 'rec-support--own text-white shadow-sm' : 'border border-pink-300 text-pink-600 bg-white hover:bg-pink-50'"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true">
                    <path d="M12 21s-7.5-4.6-10-9.2C.4 8.4 2 5 5.5 5c2 0 3.4 1.1 4.5 2.6C11.1 6.1 12.5 5 14.5 5 18 5 19.6 8.4 22 11.8 19.5 16.4 12 21 12 21z" />
                  </svg>
                  {{ picked.is_own_work ? '去平台支持 TA' : '去平台听 · 支持正版' }}
                  <span aria-hidden="true">↗</span>
                </a>
              </div>

              <!-- 数字分页 + 左右箭头：多条置顶轮播时出现；点击切换并重置 30s 计时 -->
              <div v-if="pinMode && pinnedShares.length > 1" class="rec-pin-nav items-center" aria-label="新歌推荐轮播">
                <button type="button" class="rec-pin-arrow" aria-label="上一首" @click="pinStep(-1)">‹</button>
                <button
                  v-for="(s, i) in pinnedShares"
                  :key="s.id"
                  type="button"
                  class="rec-pin-num"
                  :class="{ 'is-on': i === pinIndex }"
                  :aria-label="`第 ${i + 1} 首推荐`"
                  :aria-current="i === pinIndex"
                  @click="pinGoTo(i)"
                >{{ i + 1 }}</button>
                <button type="button" class="rec-pin-arrow" aria-label="下一首" @click="pinStep(1)">›</button>
              </div>
            </div>
          </div>
          </Transition>
        </div>
      </section>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useDebounceFn, onClickOutside } from '@vueuse/core'
import { useHead } from '@unhead/vue'
import { api } from '@/lib/api'
import { highlightHtml, lrcSnippet } from '@/lib/highlight'
import { mdToText } from '@/lib/markdown'
import { HERO_BG_URL, LOGO_URL, artistTypeIcons } from '@/lib/constants'
import { useSSGData } from '@/composables/useSSGData'
import { isMusicOnlyContributor } from '@/lib/contributorTags'
import { useUiStore } from '@/stores/ui'
import { useMusicPlayerStore } from '@/stores/musicPlayer'
import { getMusicPlatform } from '@/lib/musicPlatforms'
import AppIcon from '@/components/common/AppIcon.vue'
import ContactIcons from '@/components/contributor/ContactIcons.vue'
import type { Album, Article, Artist, ArtistWithCount, Contributor, MusicShare, SongWithNames } from '@/lib/types'

useHead({
  title: 'LrcShare - 全球最小滚动歌词分享网站',
  meta: [
    { name: 'description', content: '全球最小滚动歌词分享网站，搜索、分享、欣赏滚动歌词' },
  ],
})

const ui = useUiStore()

// ============ 数据（SSG 预取 → initialState 序列化进 HTML） ============
const { data: artists, loading: artistsLoading } = useSSGData<ArtistWithCount[]>('home:artists', () =>
  api.getArtists({ includeCount: true, limit: 6 }),
)
const { data: recentSongs, loading: songsLoading } = useSSGData<SongWithNames[]>('home:recent-songs', () =>
  api.getSongs(10),
)
const { data: articles, loading: articlesLoading } = useSSGData<Article[]>('home:articles', () =>
  api.getArticles({ status: 'published', limit: 4 }),
)
// 多取（24）再在前端过滤：tags 恰为 ['歌曲分享'] 的纯歌曲分享账号不进歌词站贡献榜，
// 过滤后取前 12。get_top_contributors RPC 本身零改动（隐藏规则只落展示位）。
const { data: contributors, loading: contributorsLoading } = useSSGData<Contributor[]>('home:contributors', () =>
  api.getContributors({ limit: 24 }),
)
const visibleContributors = computed(() =>
  (contributors.value || []).filter(c => !isMusicOnlyContributor(c)).slice(0, 12),
)

// ============ 首页随机推荐 ============
// SSG 静态站：随机只发生在客户端（onMounted 后），避免预渲染 HTML 与水合结果不一致。
// 曲库与全局 Dock 共用同一份 store 数据；点「播放这首」走 playShare 把整库队列交给 Dock 并定位到该曲。
const musicPlayer = useMusicPlayerStore()
const recMounted = ref(false)
const picked = ref<MusicShare | null>(null)
const libraryLoading = computed(() => musicPlayer.libraryLoading)
const pickedPlatform = computed(() => (picked.value ? getMusicPlatform(picked.value.platform) : null))

/** 从已通过曲库随机抽一首；excludeId 用于「换一首」时避开当前项 */
function pickRandom(excludeId?: string) {
  const list = musicPlayer.library
  if (!list.length) {
    picked.value = null
    return
  }
  if (list.length === 1) {
    picked.value = list[0]
    return
  }
  let next = list[Math.floor(Math.random() * list.length)]
  while (excludeId && next.id === excludeId) {
    next = list[Math.floor(Math.random() * list.length)]
  }
  picked.value = next
}

/** 播放推荐曲：整库作为队列，Dock 立即定位开播（点击为用户手势，不触发自动播放拦截） */
function playPicked() {
  if (!picked.value) return
  musicPlayer.playShare(picked.value, musicPlayer.library)
}

// ============ 新歌推荐限时置顶（pinned_until） ============
// 规则（2026-10 用户拍板）：
// - 进站时若存在生效中的置顶（pinned_until > 本机当前时间），随机推荐卡位固定挂置顶，
//   多条每 PIN_ROTATE_MS 自动轮播，按投稿时间新→旧排序；
// - 点「换一首」立即切回随机模式，本次停留内不再被轮播打断（刷新页面才重新挂置顶）；
// - 置顶全部到期/被清空 → 自动回落随机，无需定时任务。
const PIN_ROTATE_MS = 30000
/** 是否处于「新歌推荐」展示模式（false=用户已点换一首或本来就没有置顶） */
const pinMode = ref(false)
const pinIndex = ref(0)
/** 鼠标悬停暂停轮播，移开恢复 */
const pinHoverPaused = ref(false)
let pinTimer: ReturnType<typeof setInterval> | null = null

/** 生效中的置顶列表：按投稿时间最新在前 */
const pinnedShares = computed(() =>
  musicPlayer.library
    .filter(s => !!s.pinned_until && new Date(s.pinned_until).getTime() > Date.now())
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')),
)
/** 当前轮播到的置顶分享（越界保护由下方 watch 兜底） */
const activePinned = computed(() => pinnedShares.value[pinIndex.value] || null)

function stopPinTimer() {
  if (pinTimer) {
    clearInterval(pinTimer)
    pinTimer = null
  }
}

/** 启动 30s 轮播定时器（单条置顶无需定时器） */
function startPinTimer() {
  stopPinTimer()
  if (pinnedShares.value.length <= 1 || pinHoverPaused.value) return
  pinTimer = setInterval(() => {
    if (!pinnedShares.value.length) return
    pinIndex.value = (pinIndex.value + 1) % pinnedShares.value.length
  }, PIN_ROTATE_MS)
}

/** 手动切换（数字/箭头）后重新计时 30s */
function pinGoTo(i: number) {
  if (!pinnedShares.value.length) return
  pinIndex.value = ((i % pinnedShares.value.length) + pinnedShares.value.length) % pinnedShares.value.length
  startPinTimer()
}
function pinStep(delta: number) {
  pinGoTo(pinIndex.value + delta)
}

/** 进入置顶模式：从第一条开始并挂轮播 */
function enterPinMode() {
  if (!pinnedShares.value.length) return false
  pinMode.value = true
  pinIndex.value = 0
  pinHoverPaused.value = false
  picked.value = activePinned.value
  startPinTimer()
  return true
}

/** 用户点「换一首」：退出置顶模式，回到随机（避开当前这首） */
function shufflePicked() {
  pinMode.value = false
  stopPinTimer()
  pickRandom(picked.value?.id)
}

/** 悬停推荐卡暂停自动轮播（正在读推荐理由），移开恢复；随机模式下无操作 */
function onRecEnter() {
  pinHoverPaused.value = true
  if (pinMode.value) stopPinTimer()
}
function onRecLeave() {
  pinHoverPaused.value = false
  if (pinMode.value) startPinTimer()
}

// 轮播下标变化 → 同步当前展示卡片
watch(activePinned, s => {
  if (pinMode.value && s) picked.value = s
})
// 置顶集合变化（停留期间到期/后台调整）：越界回收；全部到期则静默回落随机
watch(pinnedShares, list => {
  if (!pinMode.value) return
  if (!list.length) {
    pinMode.value = false
    stopPinTimer()
    pickRandom()
  } else if (pinIndex.value >= list.length) {
    pinIndex.value = 0
  }
})
onUnmounted(stopPinTimer)

function formatDate(d: string | null | undefined): string {
  return d ? new Date(d).toLocaleDateString('zh-CN') : ''
}

// ============ Hero 艺术字（字符飞入动画参数迁移自 v2） ============
const HERO_CHARS = [
  { ch: 'L', x: '-60px', y: '-80px', r: '-180deg' },
  { ch: 'r', x: '50px', y: '-70px', r: '180deg' },
  { ch: 'c', x: '-45px', y: '50px', r: '-200deg' },
  { ch: 'S', x: '60px', y: '-50px', r: '220deg' },
  { ch: 'h', x: '-35px', y: '60px', r: '-240deg' },
  { ch: 'a', x: '45px', y: '-70px', r: '160deg' },
  { ch: 'r', x: '-55px', y: '45px', r: '-300deg' },
  { ch: 'e', x: '65px', y: '-80px', r: '200deg' },
]

// ============ 搜索下拉建议 ============
// 搜索状态（关键词 + 分类 tab）写入路由 query（?q=xxx&tab=xxx），点结果跳详情后返回时可恢复
const route = useRoute()
const router = useRouter()
const SEARCH_TABS = [
  { key: 'all', label: '全部' },
  { key: 'songs', label: '单曲' },
  { key: 'artists', label: '歌手' },
  { key: 'albums', label: '专辑' },
  { key: 'lyrics', label: '歌词' },
] as const
type TabKey = (typeof SEARCH_TABS)[number]['key']

const initialQ = typeof route.query.q === 'string' ? route.query.q : ''
const keyword = ref(initialQ)
const activeTab = ref<TabKey>(
  SEARCH_TABS.some(t => t.key === route.query.tab) ? (route.query.tab as TabKey) : 'all',
)
const dropdownOpen = ref(false)
const searching = ref(false)
const searchWrapRef = ref<HTMLElement>()
const results = ref<{ artists: Artist[]; albums: Album[]; songs: SongWithNames[]; lyrics: SongWithNames[] }>({
  artists: [],
  albums: [],
  songs: [],
  lyrics: [],
})

// 带 query 返回首页时自动恢复搜索结果（仅客户端）；随机推荐在水合后抽选
onMounted(async () => {
  if (keyword.value.trim()) doSearch()
  recMounted.value = true
  // 与 DefaultLayout 进站自动播放共享 store 的去重 Promise（进行中也会等同一个结果），不会重复拉库
  await musicPlayer.loadLibrary()
  // 有生效中的新歌推荐置顶 → 挂固定推荐 + 轮播；否则走原有随机
  if (!enterPinMode()) pickRandom()
})

/** 搜索状态同步到 query（replace 不产生多余历史记录；空值清除保持 URL 干净） */
function syncQuery() {
  const kw = keyword.value.trim()
  const tab = activeTab.value
  router.replace({
    query: {
      ...route.query,
      q: kw || undefined,
      tab: kw && tab !== 'all' ? tab : undefined,
    },
  })
}

function switchTab(key: TabKey) {
  activeTab.value = key
  if (keyword.value.trim()) doSearch()
}

const totalCount = computed(
  () => results.value.artists.length + results.value.albums.length + results.value.songs.length + results.value.lyrics.length,
)

function showSection(section: 'artists' | 'albums' | 'songs' | 'lyrics'): boolean {
  return activeTab.value === 'all' || activeTab.value === section
}

async function doSearch() {
  const kw = keyword.value.trim()
  if (!kw) return
  dropdownOpen.value = true
  searching.value = true
  syncQuery()
  try {
    results.value = await api.search(kw)
  } catch {
    results.value = { artists: [], albums: [], songs: [], lyrics: [] }
  } finally {
    searching.value = false
  }
}

const debouncedSearch = useDebounceFn(doSearch, 300)
function onInput() {
  if (!keyword.value.trim()) {
    dropdownOpen.value = false
    syncQuery()
    return
  }
  debouncedSearch()
}
onClickOutside(searchWrapRef, () => (dropdownOpen.value = false))

function hl(text: string): string {
  return highlightHtml(text, keyword.value)
}
function snippet(song: SongWithNames): string {
  return lrcSnippet(song.lrc_text, keyword.value) || lrcSnippet(song.lyrics_text, keyword.value)
}

</script>

<style scoped>
.hero-bg { position: relative; }
.hero-bg-img {
  position: absolute;
  top: 0; left: 0;
  width: 100%; height: 100%;
  object-fit: cover;
  object-position: center;
  z-index: 0;
  pointer-events: none;
}
.hero-bg::before {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 0;
}
.hero-content { position: relative; z-index: 1; }

/* 好莱坞风格艺术字：厚重阴影 + 飞入动画（keyframes 内读取每字符 CSS 变量） */
.art-title-char {
  display: inline-block;
  font-weight: 900;
  color: #fff;
  -webkit-text-fill-color: #fff;
  text-shadow:
    1px 1px 0 #1a0a2e, 2px 2px 0 #1a0a2e, 3px 3px 0 #1a0a2e, 4px 4px 0 #1a0a2e,
    5px 5px 0 #1a0a2e, 6px 6px 0 #1a0a2e, 7px 7px 10px rgba(0,0,0,0.6),
    0 0 20px rgba(139, 92, 246, 0.5);
  transform-style: preserve-3d;
  opacity: 0;
  will-change: transform, filter, opacity;
  animation: char-fly-in 1s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
@keyframes char-fly-in {
  0% {
    opacity: 0;
    transform: translate3d(var(--fly-x), var(--fly-y), 0) rotate(var(--fly-rotate)) scale(0.5);
    filter: blur(6px);
  }
  100% {
    opacity: 1;
    transform: translate3d(0, 0, 0) rotate(0deg) scale(1);
    filter: blur(0);
  }
}

/* 推荐理由：超过 8 行截断为省略号，避免长理由把推荐卡撑得高过左侧站长逼逼 */
.rec-reason-clamp {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 8;
  line-clamp: 8;
  overflow: hidden;
  word-break: break-word;
}

/* ============ 随机推荐卡：创作者自荐金色变体（与卡片墙 mws-card--own 同一视觉语言） ============ */
.rec-card {
  border: 1px solid transparent;
}
.rec-card--own {
  border-color: #fbbf24;
  box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.35), 0 10px 28px rgba(217, 119, 6, 0.15);
}
/* 平台行金色小徽章 */
.rec-own-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 700;
  color: #b45309;
  background: #fef3c7;
  border: 1px solid #fcd34d;
  white-space: nowrap;
}
/* 理由面板：粉紫渐变换暖金渐变 */
.rec-quote--own {
  border-color: #fde68a !important;
  background: linear-gradient(135deg, #fffbeb, #fff7ed) !important;
}
/* 音乐人联系方式图标行：推荐卡信息区较窄，用小号图标 */
.rec-contacts {
  gap: 2px;
  margin-top: 2px;
}
.rec-contacts :deep(a) {
  width: 18px;
  height: 18px;
}
.rec-contacts :deep(svg) {
  width: 13px;
  height: 13px;
}
.rec-quote--own .rec-quote-mark {
  color: rgba(252, 211, 77, 0.75) !important;
}
/* 支持按钮：创作者作品金色实心 */
.rec-support--own {
  background: linear-gradient(135deg, #f59e0b, #d97706);
}
.rec-support--own:hover {
  background: linear-gradient(135deg, #d97706, #b45309);
}

/* ============ 新歌推荐限时置顶（粉紫品牌色，与金色自荐区分） ============ */
.rec-card--pin {
  border-color: #e9a8d8;
  box-shadow: 0 0 0 1px rgba(236, 72, 153, 0.22), 0 10px 28px rgba(168, 85, 247, 0.14);
}
/* 平台行实心渐变小角标 */
.rec-pin-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 700;
  color: #fff;
  background: linear-gradient(135deg, #ec4899, #a855f7);
  box-shadow: 0 2px 8px rgba(168, 85, 247, 0.35);
  white-space: nowrap;
}
/* 数字分页（参考北大官网轮播：当前项下划线高亮，非当前项灰色） */
.rec-pin-nav {
  display: inline-flex;
  gap: 2px;
}
.rec-pin-num {
  min-width: 24px;
  height: 24px;
  padding: 0 4px;
  border: 0;
  border-bottom: 2px solid transparent;
  border-radius: 6px 6px 0 0;
  background: transparent;
  font-size: 13px;
  color: #9ca3af;
  cursor: pointer;
  transition: color 0.15s;
}
.rec-pin-num:hover {
  color: #db2777;
}
.rec-pin-num.is-on {
  color: #db2777;
  font-weight: 700;
  border-bottom-color: #db2777;
}
.rec-pin-arrow {
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font-size: 17px;
  line-height: 1;
  color: #9ca3af;
  cursor: pointer;
  transition: color 0.15s, background 0.15s;
}
.rec-pin-arrow:hover {
  color: #db2777;
  background: #fdf2f8;
}
/* 轮播切歌淡入淡出 */
.rec-fade-enter-active,
.rec-fade-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}
.rec-fade-enter-from,
.rec-fade-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
