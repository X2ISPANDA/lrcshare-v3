<template>
  <div class="space-y-3">
    <div v-for="(v, i) in model" :key="i" class="border border-gray-200 rounded-lg p-3 bg-gray-50/50">
      <div class="flex items-center gap-2 mb-2">
        <el-select v-model="v.lang" filterable allow-create default-first-option class="!w-40" placeholder="语言">
          <el-option v-for="l in langOptionsFor(v.kind)" :key="l" :label="langLabel(l)" :value="l" />
        </el-select>
        <el-select v-model="v.kind" class="!w-28" @change="onKindChange(v)">
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
import { LYRIC_LANG_OPTIONS, TRANSLIT_LANG_OPTIONS, langLabel, type LyricKind } from '@/lib/lyricLines'

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

/** 语言下拉选项：罗马音类型只列 BCP47 拉丁化方案，其余类型列自然语言 */
function langOptionsFor(kind: LyricKind): string[] {
  return kind === 'romanization' ? TRANSLIT_LANG_OPTIONS : LYRIC_LANG_OPTIONS
}

/** 类型切换时语言自动归位：罗马音必须是拉丁化方案；原文/译文不能是 Latn 标签 */
function onKindChange(v: LyricVersionForm) {
  if (v.kind === 'romanization') {
    if (!TRANSLIT_LANG_OPTIONS.includes(v.lang)) v.lang = 'zh-Latn-pinyin'
  } else if (/Latn/i.test(v.lang)) {
    v.lang = 'zh'
  }
}

function addVersion() {
  // 新增罗马音版本：默认语言跟随拉丁化方案（addDefaultLang 是自然语言码时不适用）
  const lang = props.addDefaultKind === 'romanization' && !TRANSLIT_LANG_OPTIONS.includes(props.addDefaultLang)
    ? 'zh-Latn-pinyin'
    : props.addDefaultLang
  model.value.push({ lang, kind: props.addDefaultKind, lrc: '' })
}
function removeVersion(i: number) {
  model.value.splice(i, 1)
}
</script>
