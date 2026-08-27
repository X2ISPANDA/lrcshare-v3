<template>
  <el-dialog
    :model-value="true"
    :title="isNew ? '补全新建艺术家' : '编辑艺术家信息'"
    width="560px"
    :close-on-click-modal="false"
    append-to-body
    @close="emit('close')"
  >
    <div class="flex items-center gap-3 mb-4">
      <img v-if="form.avatar" :src="form.avatar" class="w-12 h-12 rounded-full object-cover shrink-0" />
      <span v-else class="w-12 h-12 rounded-full bg-pink-100 text-pink-500 flex items-center justify-center shrink-0 text-lg">{{ tag.name?.charAt(0) }}</span>
      <div class="min-w-0">
        <div class="font-medium text-gray-800 truncate">{{ tag.name }}</div>
        <div class="text-xs text-gray-400">{{ isNew ? '保存后随歌曲保存/审核通过时创建' : '保存即写入数据库' }}</div>
      </div>
    </div>

    <el-form :model="form" label-width="84px" @submit.prevent>
      <!-- 新建艺术家：ID 必填（与投稿审核同体系，如 art_xxx） -->
      <template v-if="isNew">
        <el-row :gutter="12">
          <el-col :span="12">
            <el-form-item label="ID" required>
              <el-input v-model="form.newId" placeholder="art_xxx（手填，创建时使用）" />
            </el-form-item>
          </el-col>
          <el-col :span="12">
            <el-form-item label="前台展示">
              <el-switch v-model="form.is_show" />
            </el-form-item>
          </el-col>
        </el-row>
      </template>
      <el-form-item label="区分信息">
        <el-input v-model="form.disambiguation" placeholder="区分同名，如：北京民谣歌手" />
      </el-form-item>
      <el-form-item label="头像 URL">
        <el-input v-model="form.avatar" placeholder="留空用默认头像" />
      </el-form-item>
      <el-form-item label="别名">
        <el-select v-model="form.aliases" multiple filterable allow-create default-first-option placeholder="输入别名回车添加" class="w-full" />
      </el-form-item>
      <el-form-item label="简介">
        <el-input v-model="form.bio" type="textarea" :rows="3" />
      </el-form-item>
      <el-form-item label="社交链接">
        <div class="w-full space-y-2">
          <div v-for="(row, idx) in form.urlRows" :key="idx" class="flex items-center gap-2">
            <el-select v-model="row.k" filterable allow-create default-first-option class="!w-32 flex-shrink-0" placeholder="平台">
              <el-option v-for="p in URL_PLATFORMS" :key="p" :label="contactLabel(p)" :value="p" />
            </el-select>
            <el-input v-model="row.v" placeholder="https://..." />
            <el-button type="danger" text @click="form.urlRows.splice(idx, 1)">删</el-button>
          </div>
          <el-button size="small" @click="form.urlRows.push({ k: 'official', v: '' })">+ 添加链接</el-button>
        </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="emit('close')">取消</el-button>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { adminApi } from '@/lib/adminApi'
import { contactLabel } from '@/lib/constants'
import type { ArtistTag } from '@/lib/types'

/**
 * 艺术家信息补全弹窗（ArtistTagInput admin 模式点击头像弹出）：
 * - 已有艺术家（有 id 且非 _new）：保存时当场 update 写库
 * - 待创建（无 id 或 _new）：手填 ID + 资料，随审核通过/歌曲保存时统一创建
 * 类型（types）不在此编辑：由歌曲/专辑关联自动派生（发布补全、删除重算）
 */
const URL_PLATFORMS = ['netease', 'qqmusic', 'weibo', 'bilibili', 'instagram', 'spotify', 'youtube', 'x', 'facebook', 'douyin', 'xiaohongshu', 'beatstars', 'official']

const props = defineProps<{ tag: ArtistTag }>()
const emit = defineEmits<{ (e: 'close'): void; (e: 'saved', tag: ArtistTag): void }>()

/** 待创建：无 id，或已手填新 ID（_new 标记，与投稿审核同体系） */
const isNew = computed(() => !props.tag.id || !!props.tag._new)

const saving = ref(false)
const form = reactive({
  newId: (props.tag.id && props.tag._new ? props.tag.id : '') as string,
  is_show: props.tag.is_show !== false,
  disambiguation: props.tag.disambiguation || '',
  avatar: props.tag.avatar || '',
  aliases: [...(props.tag.aliases || [])],
  bio: props.tag.bio || '',
  urlRows: Object.entries(props.tag.urls || {}).map(([k, v]) => ({ k, v: v || '' })),
})

async function save() {
  // 新建必填 ID（与投稿审核「待创建艺术家」清单同一约束）
  if (isNew.value && !form.newId.trim()) {
    ElMessage.warning('新建艺术家需填写 ID（如 art_xxx）')
    return
  }
  saving.value = true
  try {
    const urls = Object.fromEntries(form.urlRows.filter(r => r.k && r.v.trim()).map(r => [r.k, r.v.trim()]))
    // 值写回 tag（引用），随 v-model 数据流带到提交链路（types 保持原值，由歌曲关联派生）
    Object.assign(props.tag, {
      disambiguation: form.disambiguation.trim(),
      avatar: form.avatar.trim() || null,
      aliases: form.aliases,
      bio: form.bio,
      urls,
    })
    if (isNew.value) {
      // 手填 ID 写入 tag.id，_new 标记保持"待创建"（创建链路据此走 insert 而非 update）
      props.tag.id = form.newId.trim()
      props.tag._new = true
      props.tag.is_show = form.is_show
      ElMessage.success('已记录，保存歌曲时将以此 ID 创建艺术家')
      emit('close')
      return
    }
    // 已有艺术家：当场写库（不动 name/types/sort/is_show/背景图等其余字段，types 由歌曲关联派生）
    await adminApi.update('artists', props.tag.id!, {
      disambiguation: form.disambiguation.trim() || null,
      avatar: form.avatar.trim() || null,
      aliases: form.aliases,
      bio: form.bio,
      urls,
    })
    emit('saved', props.tag)
    ElMessage.success('已保存到数据库')
    emit('close')
  } catch (e: any) {
    ElMessage.error('保存失败：' + (e?.message || e))
  } finally {
    saving.value = false
  }
}
</script>
