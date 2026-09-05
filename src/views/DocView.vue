<template>
  <main class="max-w-6xl mx-auto px-4 py-8">
    <template v-if="doc">
      <div class="flex gap-8 items-start">
        <!-- 桌面端侧边栏（VitePress 风） -->
        <aside class="hidden md:block w-60 flex-shrink-0 sticky top-24 max-h-[calc(100vh-7rem)] overflow-y-auto">
          <RouterLink to="/docs" class="block font-bold text-gray-800 mb-3 hover:text-pink-600 transition">🗄️ 开发文档</RouterLink>
          <nav class="space-y-0.5 text-sm border-l border-gray-200">
            <RouterLink
              v-for="d in docs"
              :key="d.slug"
              :to="`/docs/${d.slug}`"
              class="block pl-3 pr-2 py-1.5 -ml-px border-l-2 rounded-r transition leading-snug"
              :class="d.slug === doc.slug
                ? 'border-pink-500 text-pink-600 font-medium bg-pink-50/60'
                : 'border-transparent text-gray-600 hover:text-pink-600 hover:border-pink-200'"
            >
              <span class="font-mono text-xs text-gray-400 mr-1">{{ d.num }}</span>{{ d.title }}
            </RouterLink>
          </nav>
        </aside>

        <!-- 内容区 -->
        <div class="flex-1 min-w-0">
          <!-- 移动端文档切换 -->
          <el-select
            v-model="currentSlug"
            class="w-full mb-4 md:hidden"
            @change="onSelect"
          >
            <el-option
              v-for="d in docs"
              :key="d.slug"
              :label="`${d.num} ${d.title}`"
              :value="d.slug"
            />
          </el-select>

          <article class="bg-white rounded-2xl shadow-sm p-6 md:p-10">
            <div class="article-content" v-html="html"></div>
          </article>

          <!-- 上/下篇 -->
          <nav class="flex justify-between gap-4 mt-6">
            <RouterLink
              v-if="prev"
              :to="`/docs/${prev.slug}`"
              class="flex-1 bg-white rounded-xl shadow-sm px-5 py-4 hover:shadow-md transition group"
            >
              <div class="text-xs text-gray-400 mb-1">← 上一篇</div>
              <div class="text-sm font-medium text-gray-700 group-hover:text-pink-600 transition truncate">{{ prev.title }}</div>
            </RouterLink>
            <span v-else class="flex-1"></span>
            <RouterLink
              v-if="next"
              :to="`/docs/${next.slug}`"
              class="flex-1 bg-white rounded-xl shadow-sm px-5 py-4 text-right hover:shadow-md transition group"
            >
              <div class="text-xs text-gray-400 mb-1">下一篇 →</div>
              <div class="text-sm font-medium text-gray-700 group-hover:text-pink-600 transition truncate">{{ next.title }}</div>
            </RouterLink>
          </nav>
        </div>
      </div>
    </template>

    <!-- 文档不存在 -->
    <div v-else class="text-center py-20">
      <div class="text-6xl mb-4">😢</div>
      <h2 class="text-2xl font-bold text-gray-800 mb-2">文档不存在</h2>
      <p class="text-gray-500 mb-6">链接可能有误，或文档已调整</p>
      <RouterLink to="/docs" class="inline-block px-6 py-2 bg-pink-500 text-white rounded-lg hover:bg-pink-600 transition">← 返回文档目录</RouterLink>
    </div>
  </main>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useHead } from '@unhead/vue'
import { mdToHtml } from '@/lib/markdown'
import { docs, getDoc } from '@/lib/docs'

const route = useRoute()
const router = useRouter()

const slug = computed(() => String(route.params.slug || ''))
const doc = computed(() => getDoc(slug.value))
const html = computed(() => mdToHtml(doc.value?.content))
const currentSlug = ref(slug.value)

watch(slug, v => { currentSlug.value = v })

function onSelect(v: string) {
  router.push(`/docs/${v}`)
}

const idx = computed(() => docs.findIndex(d => d.slug === slug.value))
const prev = computed(() => (idx.value > 0 ? docs[idx.value - 1] : null))
const next = computed(() => (idx.value >= 0 && idx.value < docs.length - 1 ? docs[idx.value + 1] : null))

useHead({ title: () => doc.value ? `${doc.value.title} - 开发文档 - LrcShare` : '开发文档 - LrcShare' })
</script>
