<template>
  <header class="bg-white shadow-sm sticky top-0 z-50">
    <div class="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
      <RouterLink to="/" class="flex items-center gap-2 text-2xl font-bold">
        <img :src="LOGO_URL" alt="LrcShare Logo" class="w-8 h-8" />
        <span class="nav-art-title">LrcShare</span>
      </RouterLink>

      <!-- 桌面端导航 -->
      <nav class="desktop-nav gap-4 text-gray-600 text-sm">
        <template v-for="item in navItems" :key="item.label">
          <button
            v-if="item.action === 'search'"
            class="hover:text-pink-600 whitespace-nowrap"
            @click="ui.openSearch()"
          >
            {{ item.label }}
          </button>
          <a
            v-else-if="item.href"
            :href="item.href"
            target="_blank"
            rel="noopener"
            class="hover:text-pink-600 whitespace-nowrap"
          >{{ item.label }}</a>
          <RouterLink
            v-else
            :to="item.to"
            custom
            v-slot="{ isActive, href, navigate }"
          >
            <a
              :href="href"
              class="whitespace-nowrap"
              :class="isActive ? 'hover:text-pink-600 font-medium text-pink-600' : 'hover:text-pink-600'"
              @click="navigate"
            >{{ item.label }}</a>
          </RouterLink>
        </template>
      </nav>

      <!-- 移动端汉堡按钮 -->
      <button
        class="mobile-menu-btn"
        :class="{ 'is-open': menuOpen }"
        aria-label="菜单"
        :aria-expanded="menuOpen"
        @click="menuOpen = !menuOpen"
      >
        <span></span>
      </button>
    </div>
  </header>

  <!-- 移动端抽屉菜单 -->
  <Teleport to="body">
    <div
      class="mobile-menu-overlay"
      :class="{ 'is-open': menuOpen }"
      @click="menuOpen = false"
    ></div>
    <div class="mobile-menu" :class="{ 'is-open': menuOpen }">
      <div class="pt-4 pb-2 px-5 border-b border-gray-100">
        <div class="flex items-center gap-2 text-xl font-bold">
          <img :src="LOGO_URL" alt="Logo" class="w-7 h-7" />
          <span class="nav-art-title">LrcShare</span>
        </div>
      </div>
      <template v-for="item in navItems" :key="item.label">
        <button
          v-if="item.action === 'search'"
          class="mobile-menu-item w-full text-left"
          @click="menuOpen = false; ui.openSearch()"
        >
          {{ item.label }}
        </button>
        <a
          v-else-if="item.href"
          :href="item.href"
          target="_blank"
          rel="noopener"
          @click="menuOpen = false"
        >{{ item.label }}</a>
        <RouterLink
          v-else
          :to="item.to"
          custom
          v-slot="{ isActive, href, navigate }"
        >
          <a :href="href" :class="{ active: isActive }" @click="menuOpen = false; navigate()">{{ item.label }}</a>
        </RouterLink>
      </template>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import { useUiStore } from '@/stores/ui'
import { LOGO_URL } from '@/lib/constants'

const ui = useUiStore()
const menuOpen = ref(false)

/** 导航项：to 为路由地址；action=search 时打开全局搜索；href 为外部链接（to 给空串占位） */
interface NavItem {
  to: string
  label: string
  action?: 'search'
  href?: string
}
const navItems: NavItem[] = [
  { to: '/', label: '首页' },
  { to: '/artists', label: '艺术家库' },
  { to: '/albums', label: '专辑库' },
  { to: '/songs', label: '歌词库' },
  { to: '/contributors', label: '贡献者' },
  { to: '', label: '搜索', action: 'search' },
  { to: '/posts', label: '逼逼' },
  { to: '/changelog', label: '更新日志' },
  { to: '/docs', label: '开发文档' },
  { to: '/submit', label: '我要投稿' },
  { to: '/support', label: '赞助' },
  { to: '/about', label: '关于' },
  { to: '/links', label: '友链' },
  { to: '', label: 'API', href: 'https://api.lrcshare.com/docs/' },
]

// 抽屉打开时锁定页面滚动
watch(menuOpen, open => {
  document.body.style.overflow = open ? 'hidden' : ''
})
</script>

<style scoped>
/* 站名艺术字动画（迁移自 v2 layout.js） */
.nav-art-title {
  display: inline-block;
  background: linear-gradient(135deg, #ec4899 0%, #a855f7 33%, #3b82f6 66%, #06b6d4 100%);
  background-size: 300% 300%;
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
  letter-spacing: 1px;
  transform-style: preserve-3d;
  animation: gradient-shift 3s ease infinite, nav-float 2.5s ease-in-out infinite, nav-glow 2s ease-in-out infinite;
  transition: all 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
}
.nav-art-title:hover {
  animation: gradient-shift 1s ease infinite, nav-3d-shake 0.4s ease-in-out infinite;
  transform: scale(1.15) rotateY(20deg) rotateX(10deg);
  filter: drop-shadow(0 0 12px rgba(236, 72, 153, 0.9)) drop-shadow(0 0 24px rgba(168, 85, 247, 0.6));
}
@keyframes gradient-shift { 0%,100%{background-position:0% 50%} 50%{background-position:100% 50%} }
@keyframes nav-float { 0%,100%{transform:translateY(0) rotateZ(0deg)} 33%{transform:translateY(-4px) rotateZ(-2deg)} 66%{transform:translateY(-2px) rotateZ(1deg)} }
@keyframes nav-glow { 0%,100%{filter:drop-shadow(0 0 4px rgba(236,72,153,.4))} 50%{filter:drop-shadow(0 0 10px rgba(236,72,153,.7)) drop-shadow(0 0 16px rgba(168,85,247,.4))} }
@keyframes nav-3d-shake { 0%,100%{transform:scale(1.15) rotateY(20deg) rotateX(10deg) rotateZ(0deg)} 25%{transform:scale(1.18) rotateY(-15deg) rotateX(-5deg) rotateZ(-5deg)} 75%{transform:scale(1.18) rotateY(25deg) rotateX(15deg) rotateZ(5deg)} }

/* 移动端导航 */
.desktop-nav { display: flex; align-items: center; flex-wrap: nowrap; }
.mobile-menu-btn { display: none; align-items: center; justify-content: center; width: 40px; height: 40px; border-radius: 8px; cursor: pointer; transition: background 0.2s; z-index: 60; background: none; border: none; }
.mobile-menu-btn:hover { background: #f3f4f6; }
.mobile-menu-btn span { display: block; width: 22px; height: 2px; background: #6b7280; position: relative; transition: all 0.3s; }
.mobile-menu-btn span::before, .mobile-menu-btn span::after { content: ''; position: absolute; left: 0; width: 22px; height: 2px; background: #6b7280; transition: all 0.3s; }
.mobile-menu-btn span::before { top: -7px; }
.mobile-menu-btn span::after { top: 7px; }
.mobile-menu-btn.is-open span { background: transparent; }
.mobile-menu-btn.is-open span::before { top: 0; transform: rotate(45deg); }
.mobile-menu-btn.is-open span::after { top: 0; transform: rotate(-45deg); }

.mobile-menu {
  position: fixed;
  top: 0; right: 0;
  width: 75%; max-width: 300px;
  height: 100vh;
  background: #fff;
  box-shadow: -4px 0 20px rgba(0,0,0,0.1);
  z-index: 55;
  overflow-y: auto;
  transform: translateX(100%);
  transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
}
.mobile-menu.is-open { transform: translateX(0); }
.mobile-menu a, .mobile-menu .mobile-menu-item {
  display: block;
  width: 100%;
  padding: 14px 20px;
  color: #374151;
  border-bottom: 1px solid #f3f4f6;
  font-size: 16px;
  text-decoration: none;
  transition: all 0.15s;
  background: none;
  border-top: none; border-left: none; border-right: none;
  cursor: pointer;
  text-align: left;
}
.mobile-menu a:hover, .mobile-menu .mobile-menu-item:hover { background: #fdf2f8; color: #ec4899; }
.mobile-menu a.active { color: #ec4899; font-weight: 600; background: #fdf2f8; }

.mobile-menu-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.4);
  z-index: 54;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.3s;
}
.mobile-menu-overlay.is-open { opacity: 1; pointer-events: auto; }

@media (max-width: 1024px) {
  .desktop-nav { display: none !important; }
  .mobile-menu-btn { display: flex !important; }
}
</style>
