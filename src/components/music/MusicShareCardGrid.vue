<template>
  <!--
    歌曲分享卡片网格（歌曲分享主页 / 贡献者主页「TA 分享的歌曲」Tab 共用的唯一真源）

    设计要点：
    - 横向紧凑卡（小封面 + 右侧信息），桌面两列、移动端单列；信息密度远高于早期 1:1 大封面墙；
    - 推荐理由【全文展示不折叠】（用户明确决策，200 字上限内完整可读），因此卡片高度不固定，
      网格必须 items-start，避免相邻卡片被强行拉伸；
    - 功能元素一个不少：平台角标、专辑角标、✦创作者自荐金边+徽章、hover 播放遮罩、
      分享者入口、原链外跳；
    - 播放队列由父页面决定（主页可能带筛选、贡献者页只含 TA 的分享），故只 emit('play')。
  -->
  <div>
    <!-- 骨架屏 -->
    <div v-if="loading" class="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      <div v-for="i in skeletonCount" :key="i" class="msg-card flex gap-3 p-3 animate-pulse">
        <div class="w-[96px] h-[96px] rounded-xl bg-gray-200 flex-shrink-0"></div>
        <div class="flex-1 min-w-0 py-1">
          <div class="h-4 bg-gray-200 rounded w-2/3 mb-2"></div>
          <div class="h-3 bg-gray-100 rounded w-1/3 mb-3"></div>
          <div class="h-3 bg-gray-100 rounded w-full mb-1.5"></div>
          <div class="h-3 bg-gray-100 rounded w-4/5"></div>
        </div>
      </div>
    </div>

    <!-- 空态 -->
    <div v-else-if="!shares.length" class="text-center py-14 text-gray-400">
      <div class="text-5xl mb-3">🎵</div>
      <p class="mb-1">{{ emptyText }}</p>
      <RouterLink v-if="emptyTo" :to="emptyTo" class="text-pink-500 font-medium hover:underline">{{ emptyLinkText }}</RouterLink>
    </div>

    <!-- 卡片网格：items-start 保证理由长短不一时卡片顶部对齐、互不拉伸 -->
    <div v-else class="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
      <div
        v-for="s in shares"
        :key="s.id"
        class="msg-card flex gap-3 p-3"
        :class="s.is_own_work ? 'msg-card--own' : ''"
        role="button"
        tabindex="0"
        :title="`播放《${s.title}》`"
        @click="$emit('play', s)"
        @keydown.enter="$emit('play', s)"
      >
        <!-- 左：封面（角标与 hover 播放遮罩都限定在封面区域内） -->
        <div class="msg-cover-wrap flex-shrink-0" :style="coverWrapStyle(s)">
          <img v-if="s.cover_url" :src="s.cover_url" :alt="s.title" class="msg-cover-img" loading="lazy" />
          <div v-else class="msg-cover-fake">🎵</div>
          <div class="msg-cover-mask">
            <span class="msg-cover-play">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
            </span>
          </div>
          <!-- 角标 -->
          <span class="msg-badge-platform">
            <AppIcon :name="s.platform" class="w-3 h-3" />
            {{ platformLabel(s.platform) }}
          </span>
          <span v-if="s.media_type === 'album'" class="msg-badge-album">专辑<template v-if="s.tracks?.length"> · {{ s.tracks.length }} 首</template></span>
          <span v-if="s.is_own_work" class="msg-badge-own">✦ 创作者自荐</span>
        </div>

        <!-- 右：信息（理由全文展示，不截断不折叠） -->
        <div class="flex-1 min-w-0 flex flex-col">
          <h3 class="font-bold text-gray-800 text-[15px] truncate">{{ s.title }}</h3>
          <p v-if="s.artist" class="text-sm text-gray-500 truncate mt-0.5">{{ s.artist }}</p>
          <p v-if="s.reason" class="text-xs text-gray-400 mt-1.5 leading-relaxed break-words">{{ s.reason }}</p>

          <!--
            底栏：
            - 自荐作品（is_own_work）：身份为「音乐人」本人，名字旁展示其公开联系方式
              （有啥展示啥：填了链接的图标一键跳转，号码/邮箱点图标弹复制），不再叫推荐人；
            - 普通分享：仅头像+昵称（推荐人语义）；
            - 贡献者本人主页通过 hideSharer 隐藏自引用；原链始终可外跳。
          -->
          <div v-if="!hideSharer" class="mt-auto pt-2.5 space-y-1">
            <div class="flex items-center justify-between gap-2">
              <RouterLink
                v-if="s.contributor"
                :to="`/contributor/${s.contributor.id}`"
                class="msg-sharer"
                @click.stop
              >
                <span v-if="s.is_own_work" class="msg-role-tag">音乐人</span>
                <img v-if="s.contributor.avatar" :src="s.contributor.avatar" class="w-5 h-5 rounded-full object-cover" alt="" />
                <span class="truncate">{{ s.contributor.name }}</span>
              </RouterLink>
              <span v-else class="msg-sharer msg-sharer--text">
                <span class="w-5 h-5 rounded-full bg-pink-100 text-pink-500 text-[10px] inline-flex items-center justify-center">🎵</span>
                <span class="truncate">{{ s.submitter_name }}</span>
              </span>
              <a
                :href="s.source_url"
                target="_blank"
                rel="noopener noreferrer"
                class="msg-origin flex-shrink-0"
                title="在原平台打开"
                @click.stop
              >
                原链 ↗
              </a>
            </div>
            <!-- 音乐人公开联系方式：链接类一键外跳，号码/文本类弹复制框；整行已由组件阻止点击冒泡 -->
            <ContactIcons v-if="s.is_own_work && s.contributor" :contributor="s.contributor" class="msg-contacts" />
          </div>
          <div v-else class="mt-auto pt-2.5 flex justify-end">
            <a
              :href="s.source_url"
              target="_blank"
              rel="noopener noreferrer"
              class="msg-origin flex-shrink-0"
              title="在原平台打开"
              @click.stop
            >
              原链 ↗
            </a>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { getMusicPlatform, musicPlatformLabel } from '@/lib/musicPlatforms'
import AppIcon from '@/components/common/AppIcon.vue'
import ContactIcons from '@/components/contributor/ContactIcons.vue'
import type { MusicShare } from '@/lib/types'

/**
 * props:
 * - shares：当前要展示的分享（已筛选/已分页后的列表由父层负责）
 * - loading：骨架屏
 * - hideSharer：贡献者本人主页使用，隐藏底栏分享者（自引用无意义）
 * - emptyText / emptyTo / emptyLinkText：空态文案与可选跳转
 */
withDefaults(
  defineProps<{
    shares: MusicShare[]
    loading?: boolean
    hideSharer?: boolean
    skeletonCount?: number
    emptyText?: string
    emptyTo?: string
    emptyLinkText?: string
  }>(),
  {
    loading: false,
    hideSharer: false,
    skeletonCount: 6,
    emptyText: '还没有歌曲分享',
    emptyTo: '',
    emptyLinkText: '去分享一首歌 →',
  },
)

/** 播放事件：队列由父页面组装（筛选后列表 / 某人的分享列表） */
defineEmits<{
  (e: 'play', s: MusicShare): void
}>()

function platformLabel(key: string): string {
  return musicPlatformLabel(key)
}

/** 无封面卡片的占位底色：取平台品牌色的低透明度渐变 */
function coverWrapStyle(s: MusicShare): Record<string, string> {
  const color = getMusicPlatform(s.platform)?.brandColor || '#ec4899'
  return { '--msg-brand': color }
}
</script>

<style scoped>
.msg-card {
  border: 1px solid #f3f4f6;
  border-radius: 14px;
  background: #fff;
  cursor: pointer;
  transition: transform 0.15s, box-shadow 0.15s, border-color 0.15s;
  outline: none;
}
.msg-card:hover,
.msg-card:focus-visible {
  transform: translateY(-2px);
  box-shadow: 0 10px 28px rgba(190, 100, 180, 0.18);
}
/* 创作者自荐：金边卡片（与首页推荐卡创作者样式一致） */
.msg-card--own {
  border-color: #fbbf24;
  box-shadow: 0 0 0 1px rgba(251, 191, 36, 0.35);
}
.msg-card--own:hover,
.msg-card--own:focus-visible {
  box-shadow: 0 10px 28px rgba(217, 119, 6, 0.25);
}

.msg-cover-wrap {
  position: relative;
  width: 96px;
  height: 96px;
  border-radius: 12px;
  background: #f9fafb;
  overflow: hidden;
}
.msg-cover-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.msg-cover-fake {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36px;
  color: #fff;
  background: linear-gradient(135deg, var(--msg-brand, #ec4899), #a855f7);
  opacity: 0.85;
}
.msg-cover-mask {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.32);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.15s;
}
.msg-card:hover .msg-cover-mask,
.msg-card:focus-visible .msg-cover-mask {
  opacity: 1;
}
.msg-cover-play {
  width: 40px;
  height: 40px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.92);
  color: #db2777;
  display: flex;
  align-items: center;
  justify-content: center;
  padding-left: 2px;
}
.msg-badge-platform {
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
  max-width: calc(100% - 12px);
  white-space: nowrap;
}
.msg-badge-album {
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
.msg-badge-own {
  position: absolute;
  left: 6px;
  bottom: 6px;
  padding: 2px 8px;
  border-radius: 999px;
  background: linear-gradient(135deg, #f59e0b, #d97706);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  box-shadow: 0 2px 8px rgba(217, 119, 6, 0.4);
  white-space: nowrap;
}

.msg-sharer {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  font-size: 12px;
  color: #6b7280;
}
a.msg-sharer:hover {
  color: #db2777;
}
.msg-sharer--text {
  cursor: default;
}
/* 自荐音乐人身份小标签（琥珀色药丸，与创作者自荐金边同一色系） */
.msg-role-tag {
  flex-shrink: 0;
  padding: 1px 7px;
  border-radius: 999px;
  background: #fef3c7;
  color: #b45309;
  font-size: 10px;
  font-weight: 700;
  line-height: 16px;
}
/* 联系方式图标行：比贡献者主页更紧凑，避免卡片底栏拥挤 */
.msg-contacts {
  gap: 2px;
}
.msg-contacts :deep(a) {
  width: 20px;
  height: 20px;
}
.msg-contacts :deep(svg) {
  width: 15px;
  height: 15px;
}
.msg-origin {
  font-size: 12px;
  color: #ec4899;
}
.msg-origin:hover {
  text-decoration: underline;
}
</style>
