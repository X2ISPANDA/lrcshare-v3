<template>
  <template v-if="list.length">
    <template v-for="(a, i) in list" :key="i">
      <span v-if="i > 0">, </span>
      <RouterLink v-if="a.id" :to="`/artist/${a.id}`" class="text-pink-600 hover:underline">{{ a.name }}</RouterLink>
      <span v-else>{{ a.name }}</span>
    </template>
  </template>
  <span v-else>-</span>
</template>

<script setup lang="ts">
/** 作词/作曲/编曲人员链接列表（id 为空表示数据库中不存在的自由文本，纯展示） */
defineProps<{ list: { id: string; name: string }[] }>()
</script>
