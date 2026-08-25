<template>
  <component :is="iconComp" />
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue'
// 图标体系（2026-08-19 起统一）：
// 全部平台图标来自 iconfont.cn 精选彩色 logo，经 review_tool/_extract_icons.mjs
// 从 iconfont.js 拆出独立 SVG 存于 src/assets/icons/，经 unplugin-icons
// FileSystemIconLoader 以 brand 集合构建期内联（~icons/brand/xxx），SSG 零闪烁、风格统一。
// 后续新增平台：iconfont 项目加图标 → 下载更新 icons 目录 → 此处补映射。
import iconInstagram from '~icons/brand/instagram'
import iconWeibo from '~icons/brand/weibo'
import iconBilibili from '~icons/brand/bilibili'
import iconNetease from '~icons/brand/netease'
import iconQqMusic from '~icons/brand/qq-music'
import iconQq from '~icons/brand/qq'
import iconSpotify from '~icons/brand/spotify'
import iconGithub from '~icons/brand/github'
import iconWechat from '~icons/brand/wechat'
import iconMail from '~icons/brand/mail'
import iconBlog from '~icons/brand/blog'
import iconDouyin from '~icons/brand/douyin'
import iconTwitter from '~icons/brand/twitter'
import iconXiaohongshu from '~icons/brand/xiaohongshu'
import iconPhone from '~icons/brand/phone'
import iconCellphone from '~icons/brand/cellphone'
import iconLink from '~icons/brand/link'
import iconBeatstars from '~icons/brand/beatstars'

const ICON_MAP: Record<string, Component> = {
  // 键名全英文（2026-08-25 起；数据库与代码统一英文键，中文仅展示层标签，
  // 见 constants.ts 的 CONTACT_LABELS / PLATFORM_LABELS）
  // 社交/音乐平台（艺术家页 urls）：qq=联系方式QQ号，qqmusic=QQ音乐，注意区分
  instagram: iconInstagram,
  weibo: iconWeibo,
  bilibili: iconBilibili,
  netease: iconNetease,
  qq: iconQq,
  qqmusic: iconQqMusic,
  spotify: iconSpotify,
  github: iconGithub,
  beatstars: iconBeatstars,
  // 联系方式（贡献者页 contact_value）
  wechat: iconWechat,
  email: iconMail,
  blog: iconBlog,
  douyin: iconDouyin,
  twitter: iconTwitter,
  x: iconTwitter, // twitter.svg 实为 X logo（黑圆底白 X）
  xiaohongshu: iconXiaohongshu,
  homepage: iconLink,
  official: iconLink,
  phone: iconPhone,
  mobile: iconCellphone,
  link: iconLink,
}

const props = defineProps<{ name: string }>()
const iconComp = computed(() => ICON_MAP[props.name] || ICON_MAP[props.name.toLowerCase()] || iconLink)
</script>
