<template>
  <el-container class="h-screen">
    <!-- 侧边栏：桌面展开/折叠常驻；移动端(<768px)收起为抽屉（汉堡菜单呼出） -->
    <el-aside
      :width="asideWidth"
      class="admin-aside transition-all duration-200 flex flex-col"
      :class="isMobile ? 'admin-aside--drawer' : ''"
    >
      <RouterLink to="/admin/dashboard" class="h-14 flex items-center gap-2 px-4 border-b border-white/10 shrink-0">
        <img :src="LOGO_URL" alt="logo" class="w-7 h-7 rounded-md shrink-0" />
        <span v-if="!collapsed || isMobile" class="text-white font-bold tracking-wide">LrcShare</span>
      </RouterLink>
      <el-scrollbar class="flex-1">
        <el-menu
          :default-active="activeMenu"
          :collapse="collapsed && !isMobile"
          :collapse-transition="false"
          router
          class="admin-menu border-r-0!"
          @select="onMenuSelect"
        >
          <el-menu-item v-for="m in menus" :key="m.path" :index="m.path">
            <span>{{ m.icon }}</span>
            <template #title>{{ m.label }}</template>
          </el-menu-item>
        </el-menu>
      </el-scrollbar>
      <!-- 移动端抽屉内的关闭按钮（桌面端仍为折叠开关） -->
      <button
        class="h-12 border-t border-white/10 text-gray-400 hover:text-white text-sm flex items-center justify-center gap-1 shrink-0"
        @click="isMobile ? (drawerOpen = false) : (collapsed = !collapsed)"
      >
        {{ isMobile ? '× 关闭菜单' : collapsed ? '»' : '« 收起菜单' }}
      </button>
    </el-aside>

    <!-- 移动端抽屉遮罩 -->
    <div v-if="isMobile && drawerOpen" class="fixed inset-0 bg-black/50 z-40 lg:hidden" @click="drawerOpen = false" />

    <el-container>
      <el-header class="!h-14 flex items-center justify-between border-b border-gray-200 bg-white px-3 sm:px-6">
        <div class="flex items-center gap-2 min-w-0">
          <!-- 移动端汉堡按钮 -->
          <button v-if="isMobile" class="md:hidden text-xl text-gray-600 px-2 -ml-1 shrink-0" @click="drawerOpen = true">☰</button>
          <h1 class="text-base font-semibold text-gray-800 truncate">{{ currentTitle }}</h1>
        </div>
        <div class="flex items-center gap-2 sm:gap-3 shrink-0">
          <span class="text-sm text-gray-400 hidden sm:inline">{{ user?.email }}</span>
          <el-button text type="danger" @click="handleLogout">退出登录</el-button>
        </div>
      </el-header>
      <el-main class="bg-gray-50 !p-3 sm:!p-4 md:!p-6 overflow-y-auto">
        <RouterView />
      </el-main>
    </el-container>
  </el-container>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useHead } from '@unhead/vue'
import { useAdminAuth } from '@/composables/useAdminAuth'
import { LOGO_URL } from '@/lib/constants'

const route = useRoute()
const router = useRouter()
const { user, init, logout } = useAdminAuth()

const menus = [
  { path: '/admin/dashboard', icon: '📊', label: '数据概览' },
  { path: '/admin/submissions', icon: '📝', label: '投稿审核' },
  { path: '/admin/songs', icon: '🎵', label: '歌曲管理' },
  { path: '/admin/artists', icon: '🎤', label: '艺术家管理' },
  { path: '/admin/albums', icon: '💿', label: '专辑管理' },
  { path: '/admin/sponsors', icon: '💖', label: '赞助管理' },
  { path: '/admin/articles', icon: '📰', label: '文章管理' },
  { path: '/admin/contributors', icon: '🏆', label: '贡献者管理' },
  { path: '/admin/friends', icon: '🔗', label: '友链管理' },
  { path: '/admin/settings', icon: '⚙️', label: '系统设置' },
]

const collapsed = ref(false)
const activeMenu = computed(() => route.path)
const currentTitle = computed(() => menus.find(m => m.path === route.path)?.label || '管理后台')
// admin 为纯 SPA：直链经 GitHub Pages 404.html 兜底启动，HTML title 是「页面不存在」，
// 需在布局层按当前页覆盖（各内页自身不设置 title）
useHead({ title: computed(() => `${currentTitle.value} - 管理后台 - LrcShare`) })

// ===== 移动端抽屉态（<768px）：侧栏脱离文档流覆盖在内容上，遮罩/选菜单后收起 =====
const MOBILE_BP = 768
const winWidth = ref(1024)
function onResize() { winWidth.value = window.innerWidth }
const isMobile = computed(() => winWidth.value < MOBILE_BP)
const drawerOpen = ref(false)

const asideWidth = computed(() => {
  if (isMobile.value) return drawerOpen.value ? '220px' : '0px'
  return collapsed.value ? '64px' : '220px'
})

function onMenuSelect() {
  // 移动端选中菜单项后自动收抽屉（桌面端导航行为不变）
  if (isMobile.value) drawerOpen.value = false
}

onMounted(() => {
  init()
  onResize()
  window.addEventListener('resize', onResize)
})
onBeforeUnmount(() => window.removeEventListener('resize', onResize))

async function handleLogout() {
  await logout()
  router.replace('/admin/login')
}
</script>

<style scoped>
.admin-aside {
  background: linear-gradient(180deg, #1e1b4b 0%, #312e81 100%);
}
/* 移动端抽屉态：脱离文档流悬浮（z 高于遮罩），宽度动画照常生效；收起时完全移出 */
.admin-aside--drawer {
  position: fixed;
  top: 0;
  left: 0;
  bottom: 0;
  z-index: 50;
  overflow: hidden;
}
/* 覆盖 el-menu 默认白底变量，透出深色侧边栏背景 */
.admin-menu {
  --el-menu-bg-color: transparent;
  --el-menu-text-color: rgba(255, 255, 255, 0.65);
  --el-menu-hover-bg-color: rgba(255, 255, 255, 0.08);
  --el-menu-active-color: #fff;
  background-color: transparent;
}
.admin-menu :deep(.el-menu-item) {
  background-color: transparent;
}
.admin-menu :deep(.el-menu-item:hover) {
  color: #fff;
}
.admin-menu :deep(.el-menu-item.is-active) {
  background: rgba(236, 72, 153, 0.2);
  color: #fff;
}
</style>
