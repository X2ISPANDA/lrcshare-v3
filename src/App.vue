<template>
  <el-config-provider :locale="zhCn">
    <router-view />
  </el-config-provider>
</template>

<script setup lang="ts">
// Element Plus 中文 locale（分页「共 X 条/上一页」、日期等控件文案）
import zhCn from 'element-plus/es/locale/lang/zh-cn'
</script>
