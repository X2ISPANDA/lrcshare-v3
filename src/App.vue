<template>
  <el-config-provider :locale="zhCn">
    <router-view />
  </el-config-provider>
</template>

<script setup lang="ts">
// Element Plus 中文 locale（分页「共 X 条/上一页」、日期等控件文案）
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import { useHead } from '@unhead/vue'
import { logoUrl } from '@/lib/imageSource'

// favicon 随图片源开关切换（SSG 构建时按当时模式静态输出，客户端引导后按库内最新值）
useHead({ link: [{ rel: 'icon', type: 'image/png', href: logoUrl() }] })
</script>
