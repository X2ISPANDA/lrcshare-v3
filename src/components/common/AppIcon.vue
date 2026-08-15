<template>
  <component :is="iconComp" />
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue'
// unplugin-icons 构建期解析 ~icons/ 前缀（@iconify/json 按需 tree-shake，仅打包用到的图标）
// 图标映射迁移自 v2 icons.js 的 ICON_MAP（weibo/douyin 在本地 @iconify/json 中不存在，
// 用等价替代：mdi:weibo → fa7-brands:weibo，simple-icons:douyin → simple-icons:tiktok 同款音符标志）
import iconInstagram from '~icons/mdi/instagram'
import iconWeibo from '~icons/fa7-brands/weibo'
import iconBilibili from '~icons/fa7-brands/bilibili'
import iconNetease from '~icons/thesvg-color/netease-cloud-music'
import iconQqColor from '~icons/thesvg-color/qq'
import iconGithub from '~icons/mdi/github'
import iconWechat from '~icons/thesvg-color/wechat'
import iconEmail from '~icons/material-icon-theme/email'
import iconBlogger from '~icons/mdi/blogger'
import iconDouyin from '~icons/simple-icons/tiktok'
import iconTwitter from '~icons/mdi/twitter'
import iconXiaohongshu from '~icons/thesvg-color/xiaohongshu'
import iconLink from '~icons/mdi/link-variant'
import iconPhone from '~icons/mdi/phone'
import iconCellphone from '~icons/mdi/cellphone'

const ICON_MAP: Record<string, Component> = {
  // 社交平台（艺术家页/艺术家库页）
  instagram: iconInstagram,
  weibo: iconWeibo,
  bilibili: iconBilibili,
  netease: iconNetease,
  qq: iconQqColor,
  github: iconGithub,
  // 联系方式（贡献者页）
  'QQ': iconQqColor,
  '微信': iconWechat,
  '邮箱': iconEmail,
  'Email': iconEmail,
  'B站': iconBilibili,
  'Bilibili': iconBilibili,
  'GitHub': iconGithub,
  '博客': iconBlogger,
  '抖音': iconDouyin,
  '微博': iconWeibo,
  'Twitter': iconTwitter,
  '小红书': iconXiaohongshu,
  '网易音乐人': iconNetease,
  '个人主页': iconLink,
  '电话': iconPhone,
  '手机': iconCellphone,
  'link': iconLink,
}

const props = defineProps<{ name: string }>()
const iconComp = computed(() => ICON_MAP[props.name] || iconLink)
</script>
