<script setup lang="ts">
/**
 * Phase 0 关键验证页：复刻 v2 管理后台 el-switch 不渲染的完整场景
 *
 * 复刻要素：
 * 1. el-dialog 内（v2 的审核弹窗）
 * 2. computed 返回新包装数组（v2 的 newArtistsList，entry.item 深层引用）
 * 3. v-for 中 v-model 绑定到包装对象的深层属性（entry.item.is_show）
 * 4. el-form 环境
 *
 * 对照组：A 顶层 switch / B dialog 内直连 ref 的 switch / C 复刻现场的 switch
 */
import { computed, ref } from 'vue'

// 对照 A：顶层独立 switch
const topLevel = ref(true)

const dialogVisible = ref(false)

// 对照 B：dialog 内直连 ref（不经 computed 包装）
const directItem = ref({ name: '直连对照', id: '', is_show: true })

// 复刻现场：v2 待创建艺术家数据结构 + computed 包装
interface NewArtist {
  name: string
  id: string
  is_show: boolean
}
const artists = ref<NewArtist[]>([
  { name: '1111', id: '', is_show: true },
  { name: '2345', id: '', is_show: true },
  { name: '测试公司', id: '', is_show: false },
])
// 与 v2 完全相同的包装方式：computed 每次 map 出新数组，item 是深层引用
const newArtistsList = computed(() =>
  artists.value.map(item => ({ item, source: '歌手 / 专辑艺术家' })),
)
</script>

<template>
  <div class="p-8 space-y-6 max-w-3xl mx-auto">
    <h1 class="text-2xl font-bold">Phase 0 - el-switch 渲染验证</h1>

    <el-card>
      <template #header>对照组 A：顶层 el-switch</template>
      <el-switch v-model="topLevel" />
      <span class="ml-2">{{ topLevel }}</span>
    </el-card>

    <el-button type="primary" @click="dialogVisible = true">
      打开弹窗（复刻 v2 审核场景）
    </el-button>

    <el-dialog v-model="dialogVisible" title="投稿审核" width="720px">
      <el-form label-width="80px">
        <el-form-item label="对照 B">
          <el-switch v-model="directItem.is_show" />
          <span class="ml-2">{{ directItem.name }}: {{ directItem.is_show }}</span>
        </el-form-item>
      </el-form>

      <div class="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
        <div class="text-sm font-semibold text-amber-800 mb-2">🆕 待创建艺术家（复刻 v2 现场）</div>
        <div
          v-for="entry in newArtistsList"
          :key="entry.item.name"
          class="flex items-center gap-2 mb-2 bg-white p-2 rounded border border-amber-200"
        >
          <el-tag size="small" type="warning">{{ entry.source }}</el-tag>
          <span class="font-medium min-w-20">{{ entry.item.name }}</span>
          <el-input v-model="entry.item.id" placeholder="art_xxx" size="small" style="width: 140px" />
          <el-switch v-model="entry.item.is_show" />
          <span class="text-xs text-gray-500">{{ entry.item.is_show }}</span>
        </div>
      </div>
    </el-dialog>
  </div>
</template>
