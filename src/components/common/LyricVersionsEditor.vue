<template>
  <div class="space-y-3">
    <div v-for="(v, i) in model" :key="i" class="border border-gray-200 rounded-lg p-3 bg-gray-50/50">
      <div class="flex items-center gap-2 mb-2">
        <el-select v-model="v.lang" filterable allow-create default-first-option class="!w-40" placeholder="语言">
          <el-option v-for="l in LYRIC_LANG_OPTIONS" :key="l" :label="langLabel(l)" :value="l" />
        </el-select>
        <el-select v-model="v.kind" class="!w-28">
          <el-option label="原文" value="original" />
          <el-option label="译文" value="translation" />
          <el-option label="罗马音" value="romanization" />
        </el-select>
        <div class="flex-1"></div>
        <el-button link type="danger" size="small" @click="removeVersion(i)">删除</el-button>
      </div>
      <el-input
        v-model="v.lrc"
        type="textarea"
        :rows="5"
        placeholder="粘贴 LRC 歌词..."
        class="font-mono!"
      />
    </div>
    <el-button size="small" :disabled="addDisabled" @click="addVersion">+ 添加版本</el-button>
  </div>
</template>

<script setup lang="ts">
import { LYRIC_LANG_OPTIONS, langLabel, type LyricKind } from '@/lib/lyricLines'

/** 单个歌词版本（lang/kind 明确；lrc 为该版本的文本） */
export interface LyricVersionForm {
  lang: string
  kind: LyricKind
  lrc: string
}

const props = withDefaults(defineProps<{
  /** 禁用「添加版本」 */
  addDisabled?: boolean
  /** 新增版本默认语言 */
  addDefaultLang?: string
  /** 新增版本默认类型 */
  addDefaultKind?: LyricKind
}>(), {
  addDisabled: false,
  addDefaultLang: 'en',
  addDefaultKind: 'translation',
})

const model = defineModel<LyricVersionForm[]>({ required: true })

function addVersion() {
  model.value.push({ lang: props.addDefaultLang, kind: props.addDefaultKind, lrc: '' })
}
function removeVersion(i: number) {
  model.value.splice(i, 1)
}
</script>
