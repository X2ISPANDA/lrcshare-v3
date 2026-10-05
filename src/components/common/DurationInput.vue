<template>
  <!--
    DurationInput · 歌曲时长输入组件（全项目唯一时长入口）
    - 分、秒两个数字输入框：分钟 0–999，秒 0–59 硬限制（秒超 59 直接夹回 59，不进位）
    - 只能输入数字；v-model 对外只输出两种值：''（空）或标准 mm:ss（如 05:07）
    - 初始值仅接受严格 mm:ss；数据库已全量清洗，不会有其他格式，组件不做任何归一化兼容
    - tone：plain = 投稿页原生样式；el（默认）= 仿 Element Plus 输入框，用于后台
    - size：default / small（后台表格内使用）
  -->
  <div class="duration-input" :class="[`is-${tone}`, `is-${size}`]">
    <input
      ref="minInput"
      v-model="minuteVal"
      class="di-field"
      type="text"
      inputmode="numeric"
      aria-label="分钟"
      maxlength="3"
      placeholder="00"
      @input="onMinuteInput"
      @focus="onFocusSel"
    />
    <span class="di-sep">:</span>
    <input
      ref="secInput"
      v-model="secondVal"
      class="di-field"
      type="text"
      inputmode="numeric"
      aria-label="秒"
      maxlength="2"
      placeholder="00"
      @input="onSecondInput"
      @focus="onFocusSel"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'

const props = withDefaults(defineProps<{
  /** 绑定值：'' 表示空，否则必须为标准 mm:ss */
  modelValue?: string | null
  /** 外观：plain 投稿页原生风格 / el 仿 Element Plus（默认） */
  tone?: 'plain' | 'el'
  /** 尺寸：后台默认 / 表格 small */
  size?: 'default' | 'small'
}>(), {
  modelValue: '',
  tone: 'el',
  size: 'default',
})

const emit = defineEmits<{
  'update:modelValue': [value: string]
}>()

/** 分、秒输入框内部显示值（只允许数字串，显示层不强制补零；对外值始终标准） */
const minuteVal = ref('')
const secondVal = ref('')

/** 数字补零到指定宽度（分钟 3 位数时不截断） */
function pad(v: string, width: number): string {
  return v.length >= width ? v : '0'.repeat(width - v.length) + v
}

/** 将当前内部分秒合成为对外标准值；两个框都空才输出 '' */
function compose(): string {
  if (!minuteVal.value && !secondVal.value) return ''
  return `${pad(minuteVal.value || '0', 2)}:${pad(secondVal.value || '0', 2)}`
}

/** 同步对外值（每次按键后调用） */
function syncOut() {
  emit('update:modelValue', compose())
}

/** 分钟输入：剥离非数字，最多 3 位（上限 999，不做任何进位） */
function onMinuteInput(e: Event) {
  const el = e.target as HTMLInputElement
  el.value = el.value.replace(/\D/g, '').slice(0, 3)
  minuteVal.value = el.value
  syncOut()
}

/** 秒输入：剥离非数字，最多 2 位；超 59 夹回 59（硬限制，不进位到分） */
function onSecondInput(e: Event) {
  const el = e.target as HTMLInputElement
  let v = el.value.replace(/\D/g, '').slice(0, 2)
  if (v !== '' && Number(v) > 59) v = '59'
  el.value = v
  secondVal.value = v
  syncOut()
}

/** 聚焦时全选已有内容，方便直接改数 */
function onFocusSel(e: FocusEvent) {
  ;(e.target as HTMLInputElement).select()
}

/**
 * 外部值回填：仅接受严格 mm:ss（分 1–3 位数字、秒 2 位数字）；
 * 其余一切写法（含 null/空串/历史脏值）一律按「空」处理，不猜测不归一化。
 * 与当前内部合成值一致时跳过，避免输入过程中被打断。
 */
function syncFromOutside(val: string | null | undefined) {
  const composed = compose()
  if (val === composed) return
  const m = String(val ?? '').match(/^(\d{1,3}):(\d{2})$/)
  if (m && Number(m[2]) <= 59) {
    minuteVal.value = m[1]
    secondVal.value = m[2]
  } else {
    minuteVal.value = ''
    secondVal.value = ''
  }
}

watch(() => props.modelValue, v => syncFromOutside(v), { immediate: true })
</script>

<style scoped>
.duration-input {
  display: flex;
  align-items: center;
  gap: 4px;
  width: 100%;
}

.di-field {
  flex: 1 1 0;
  min-width: 0;
  width: 100%;
  margin: 0;
  text-align: center;
  font-variant-numeric: tabular-nums;
  background: #fff;
  outline: none;
}

.di-sep {
  flex: 0 0 auto;
  color: #909399;
  font-variant-numeric: tabular-nums;
}

/* ===== 仿 Element Plus 输入框（后台，default 尺寸：高 32px / 14px） ===== */
.is-el .di-field {
  height: 32px;
  padding: 0 4px;
  border: 1px solid #dcdfe6;
  border-radius: 4px;
  color: #606266;
  font-size: 14px;
  transition: border-color 0.2s;
}
.is-el .di-field:hover {
  border-color: #c0c4cc;
}
.is-el .di-field:focus {
  border-color: #409eff;
}
.is-el .di-field::placeholder {
  color: #c0c4cc;
}
.is-el .di-sep {
  font-size: 14px;
}

/* ===== small 尺寸（后台表格：高 24px / 12px，与 el-input small 对齐） ===== */
.is-el.is-small .di-field {
  height: 24px;
  font-size: 12px;
  border-radius: 4px;
}
.is-el.is-small .di-sep {
  font-size: 12px;
}

/* ===== 投稿页原生样式（与 SubmitView 输入框同款：灰边圆角、粉色 focus ring） ===== */
.is-plain .di-field {
  padding: 8px 4px;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  color: #111827;
  font-size: 14px;
}
.is-plain .di-field:focus {
  border-color: #e5e7eb;
  box-shadow: 0 0 0 2px rgba(242, 93, 142, 0.35);
}
.is-plain .di-field::placeholder {
  color: #d1d5db;
}
.is-plain .di-sep {
  font-size: 14px;
}
</style>
