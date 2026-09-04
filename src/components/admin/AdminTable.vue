<template>
  <!--
    后台管理通用表格容器：桌面(≥768px)渲染 el-table（列由调用方以默认插槽传入，原样搬移），
    移动端渲染卡片列表（#card 插槽按行排版）。数据/分页/批量操作逻辑完全由调用方持有，
    本组件只负责双形态切换，桌面端渲染路径与改造前一致。
  -->
  <div class="hidden md:block">
    <el-table
      ref="tableRef"
      :data="data"
      stripe
      v-loading="loading"
      :row-key="rowKey"
      :default-sort="defaultSort"
      @selection-change="$emit('selection-change', $event)"
      @sort-change="$emit('sort-change', $event)"
    >
      <slot />
    </el-table>
  </div>

  <div v-if="loading" class="md:hidden py-10 text-center text-gray-400 text-sm">加载中...</div>
  <div v-else-if="!data.length" class="md:hidden py-10 text-center text-gray-400 text-sm">暂无数据</div>
  <div v-else class="md:hidden space-y-3">
    <div
      v-for="(row, i) in data"
      :key="String(rowKey ? row[rowKey] : i)"
      class="bg-white rounded-xl border border-gray-100 shadow-sm px-4 py-3"
    >
      <slot name="card" :row="row" :index="i" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'

defineProps<{
  data: any[]
  loading?: boolean
  rowKey?: string
  /** el-table 默认排序（{ prop, order: 'ascending'|'descending' }），列需配 sortable="custom" */
  defaultSort?: { prop: string; order: 'ascending' | 'descending' }
}>()

defineEmits<{
  (e: 'selection-change', val: any[]): void
  (e: 'sort-change', val: { prop: string | null; order: 'ascending' | 'descending' | null }): void
}>()

/** 转发 el-table 实例方法（clearSelection 等），供调用方通过组件 ref 调用 */
const tableRef = ref()
defineExpose({
  clearSelection: () => tableRef.value?.clearSelection(),
})
</script>
