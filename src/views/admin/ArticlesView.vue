<template>
  <div class="space-y-4">
    <!-- 工具条 -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-wrap items-center gap-3 px-5 py-3">
      <el-input v-model="keyword" placeholder="搜索标题 / slug" clearable class="!w-64" :prefix-icon="Search" />
      <el-select v-model="typeFilter" clearable placeholder="全部分类" class="!w-32">
        <el-option v-for="t in TYPE_OPTIONS" :key="t.value" :label="t.label" :value="t.value" />
      </el-select>
      <div class="flex-1"></div>
      <el-button type="primary" @click="openNew" style="--el-button-bg-color: #ec4899; --el-button-border-color: #ec4899; --el-button-hover-bg-color: #db2777; --el-button-hover-border-color: #db2777">+ 新增文章</el-button>
    </div>

    <div class="bg-white rounded-xl border border-gray-100 shadow-sm">
      <el-table :data="pagedList" stripe v-loading="loading" row-key="id" @selection-change="selected = $event">
        <el-table-column type="selection" width="45" />
        <el-table-column label="标题" min-width="220" show-overflow-tooltip>
          <template #default="{ row }">
            <div class="flex items-center gap-2">
              <span class="font-medium text-gray-800">{{ row.title }}</span>
              <el-tag v-if="row.status === 'draft'" size="small" type="warning">草稿</el-tag>
            </div>
            <div class="text-xs text-gray-400">/post/{{ row.slug }}</div>
          </template>
        </el-table-column>
        <el-table-column label="分类" width="90" align="center">
          <template #default="{ row }">
            <el-tag size="small" :type="typeTag(row.type)">{{ typeLabel(row.type) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="作者" width="100" show-overflow-tooltip>
          <template #default="{ row }">{{ row.author || '站长' }}</template>
        </el-table-column>
        <el-table-column label="浏览" width="70" align="center">
          <template #default="{ row }">{{ row.views || 0 }}</template>
        </el-table-column>
        <el-table-column label="置顶" width="65" align="center">
          <template #default="{ row }">
            <span :class="row.sort > 0 ? 'text-pink-500 font-medium' : 'text-gray-300'">{{ row.sort || 0 }}</span>
          </template>
        </el-table-column>
        <el-table-column label="发布时间" width="110" align="center">
          <template #default="{ row }">{{ (row.created_at || '').slice(0, 10) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="130" align="center">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button link type="danger" size="small" @click="removeOne(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="flex justify-between items-center px-5 py-4 border-t border-gray-100">
        <div class="flex gap-2">
          <el-button size="small" :disabled="!selected.length" plain @click="clearSelection">取消选择</el-button>
          <el-button size="small" type="danger" :disabled="!selected.length" @click="batchRemove">批量删除</el-button>
        </div>
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50]"
          :total="filteredList.length"
          layout="total, sizes, prev, pager, next"
          background
        />
      </div>
    </div>

    <!-- 新增 / 编辑弹窗 -->
    <el-dialog v-model="showDialog" :title="editing ? '编辑文章' : '新增文章'" width="820px" :close-on-click-modal="false">
      <el-form :model="form" label-width="84px">
        <el-row :gutter="16">
          <el-col :span="12"><el-form-item label="标题" required><el-input v-model="form.title" placeholder="文章标题" /></el-form-item></el-col>
          <el-col :span="12"><el-form-item label="slug" required><el-input v-model="form.slug" placeholder="URL 路径，如 my-first-post" /></el-form-item></el-col>
        </el-row>
        <el-row :gutter="16">
          <el-col :span="8">
            <el-form-item label="分类">
              <el-select v-model="form.type" class="w-full">
                <el-option v-for="t in TYPE_OPTIONS" :key="t.value" :label="t.label" :value="t.value" />
              </el-select>
            </el-form-item>
          </el-col>
          <el-col :span="8"><el-form-item label="作者"><el-input v-model="form.author" placeholder="默认：站长" /></el-form-item></el-col>
          <el-col :span="8">
            <el-form-item label="状态">
              <el-select v-model="form.status" class="w-full">
                <el-option label="已发布" value="published" />
                <el-option label="草稿" value="draft" />
              </el-select>
            </el-form-item>
          </el-col>
        </el-row>
        <el-form-item label="封面 URL">
          <el-input v-model="form.cover" placeholder="文章封面图链接（选填）" />
        </el-form-item>
        <el-form-item label="摘要">
          <el-input v-model="form.summary" type="textarea" :rows="2" placeholder="列表页展示的摘要（选填，留空自动截取正文）" />
        </el-form-item>
        <el-form-item label="正文">
          <div class="flex gap-2 w-full">
            <el-input v-model="form.content" type="textarea" :rows="14" placeholder="Markdown 格式正文..." class="flex-1 font-mono! text-[13px]!" />
            <div class="flex-1 border border-gray-200 rounded p-3 overflow-y-auto max-h-96 text-sm content-preview" v-html="contentPreview"></div>
          </div>
        </el-form-item>
        <el-form-item label="置顶排序">
          <div class="flex items-center gap-3">
            <el-input-number v-model="form.sort" :min="0" :step="1" class="!w-36" />
            <span class="text-xs text-gray-400">0=按时间排序，1最置顶，2次之...</span>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { Search } from '@element-plus/icons-vue'
import { marked } from 'marked'
import { adminApi } from '@/lib/adminApi'
import type { Article } from '@/lib/types'

/** 文章管理：列表（分类筛选、草稿标记）+ Markdown 编辑带实时预览 */

const TYPE_OPTIONS = [
  { label: '📢 公告', value: 'notice' },
  { label: '🎉 喜报', value: 'news' },
  { label: '📖 教程', value: 'tutorial' },
  { label: '📄 文章', value: 'post' },
]

const articles = ref<Article[]>([])
const loading = ref(false)
const keyword = ref('')
const typeFilter = ref('')
const page = ref(1)
const pageSize = ref(20)
const selected = ref<Article[]>([])
const tableRef = ref()

function typeLabel(t: string | null) {
  return TYPE_OPTIONS.find(o => o.value === t)?.label.replace(/^\S+\s/, '') || t || '文章'
}
function typeTag(t: string | null): any {
  return { notice: 'warning', news: 'success', tutorial: 'primary', post: 'info' }[t || 'post'] || 'info'
}

const filteredList = computed(() => {
  let list = articles.value
  const kw = keyword.value.trim().toLowerCase()
  if (kw) list = list.filter(a => a.title?.toLowerCase().includes(kw) || a.slug?.toLowerCase().includes(kw))
  if (typeFilter.value) list = list.filter(a => a.type === typeFilter.value)
  return list
})
const pagedList = computed(() => filteredList.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value))

async function load() {
  loading.value = true
  try {
    articles.value = await adminApi.getAll<Article>('articles', { order: 'created_at', ascending: false })
  } catch (e: any) {
    ElMessage.error('加载失败：' + e.message)
  } finally {
    loading.value = false
  }
}
onMounted(load)

function clearSelection() {
  tableRef.value?.clearSelection()
  selected.value = []
}

const showDialog = ref(false)
const editing = ref<Article | null>(null)
const saving = ref(false)

const form = reactive({
  title: '',
  slug: '',
  type: 'post',
  status: 'published',
  author: '站长',
  cover: '',
  summary: '',
  content: '',
  sort: 0,
})

const contentPreview = computed(() => {
  if (!form.content) return '<span style="color:#c0c4cc">预览区</span>'
  try {
    return marked.parse(form.content.replace(/^ {4}/gm, ''), { async: false }) as string
  } catch {
    return form.content
  }
})

function openNew() {
  editing.value = null
  Object.assign(form, { title: '', slug: '', type: 'post', status: 'published', author: '站长', cover: '', summary: '', content: '', sort: 0 })
  showDialog.value = true
}

function openEdit(row: Article) {
  editing.value = row
  Object.assign(form, {
    title: row.title || '',
    slug: row.slug || '',
    type: row.type || 'post',
    status: row.status || 'published',
    author: row.author || '站长',
    cover: row.cover || '',
    summary: row.summary || '',
    content: row.content || '',
    sort: row.sort || 0,
  })
  showDialog.value = true
}

async function save() {
  if (!form.title.trim() || !form.slug.trim()) {
    ElMessage.warning('请填写标题和 slug')
    return
  }
  saving.value = true
  try {
    const payload = {
      title: form.title.trim(),
      slug: form.slug.trim(),
      type: form.type,
      status: form.status,
      author: form.author.trim() || '站长',
      cover: form.cover.trim() || null,
      summary: form.summary.trim() || null,
      content: form.content,
      sort: form.sort || 0,
      updated_at: new Date().toISOString(),
    }
    if (editing.value) {
      await adminApi.update('articles', editing.value.id, payload)
      ElMessage.success('保存成功')
    } else {
      await adminApi.insert('articles', { id: 'art_' + Date.now(), views: 0, created_at: new Date().toISOString(), ...payload })
      ElMessage.success('新增文章成功')
    }
    showDialog.value = false
    await load()
  } catch (e: any) {
    ElMessage.error('保存失败：' + (e?.message || e))
  } finally {
    saving.value = false
  }
}

async function removeOne(row: Article) {
  try {
    await ElMessageBox.confirm(`确定删除文章「${row.title}」？`, '确认删除', { type: 'warning' })
    await adminApi.remove('articles', row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error('删除失败：' + e.message)
  }
}

async function batchRemove() {
  if (!selected.value.length) return
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selected.value.length} 篇文章？`, '批量删除', { type: 'warning' })
    await adminApi.removeBatch('articles', selected.value.map(a => a.id))
    ElMessage.success('批量删除完成')
    clearSelection()
    await load()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error('删除失败：' + e.message)
  }
}

watch([keyword, typeFilter], () => (page.value = 1))
watch(pageSize, () => (page.value = 1))
</script>
