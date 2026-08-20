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

const ICON_MAP: Record<string, Component> = {
  // 社交/音乐平台（艺术家页、艺术家库页；兼容后台小写 key 与中文 key）
  instagram: iconInstagram,
  weibo: iconWeibo,
  bilibili: iconBilibili,
  netease: iconNetease,
  qq: iconQqMusic,
  'QQ音乐': iconQqMusic,
  'qq音乐': iconQqMusic,
  spotify: iconSpotify,
  github: iconGithub,
  // 联系方式（贡献者页）
  'QQ': iconQq,
  '微信': iconWechat,
  '邮箱': iconMail,
  'Email': iconMail,
  'B站': iconBilibili,
  'Bilibili': iconBilibili,
  '哔哩哔哩': iconBilibili,
  'GitHub': iconGithub,
  '博客': iconBlog,
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
const iconComp = computed(() => ICON_MAP[props.name] || ICON_MAP[props.name.toLowerCase()] || iconLink)
</script>
