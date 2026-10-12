<script setup lang="ts">
/**
 * 投稿人身份面板（歌词投稿 / 歌曲分享投稿共用）
 *
 * 从 SubmitView.vue 抽出的唯一身份区实现，两站行为统一，避免再次走偏：
 * - 昵称远程搜索全量贡献者（排除站长）/ 输入新昵称新建（不会自动挂到同名账号）；
 * - 选中已有贡献者：邮箱/简介/联系方式/公开勾选全部锁定，提示「下方信息不用再填」；
 * - 勾选「更新我的信息」解锁并全量覆盖；勾选「清空我的信息」保持锁定，审核通过置空；
 *   两个勾选互斥；改选/新建身份时自动复位；
 * - 邮箱与其他联系方式同属用户资料（不再有「一次性邮箱」语义）；
 * - 9 类平台主页键强制 http(s) 完整链接，号码/文本类不校验（contactValueError）；
 * - 「仅提交资料更新」按钮仅歌词投稿需要（该审核流走 submissions），由 props 开启。
 *
 * v-model 持有全部字段；父页面通过 ref 调用 validateForSubmit / validateForProfileUpdate
 * / buildContactValue，并读取 selected 判断是否命中已有贡献者。
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '@/lib/api'
import type { Contributor } from '@/lib/types'
import {
  CONTACT_TYPES,
  contactLabel,
  contactPlaceholder,
  contactValueError,
  LOGO_URL as DEFAULT_LOGO,
} from '@/lib/constants'

/** 身份面板数据（v-model）：与两个投稿页的表单字段一一对应 */
export interface SubmitterIdentity {
  name: string
  email: string
  bio: string
  contacts: { type: string; value: string }[]
  public_contact: boolean
  request_update: boolean
  request_clear: boolean
}

const props = withDefaults(
  defineProps<{
    modelValue: SubmitterIdentity
    /** lyric=歌词投稿（贡献者主页文案）；music=歌曲分享投稿（音乐人主页/自荐卡文案） */
    variant?: 'lyric' | 'music'
    /** 新昵称（未命中已有贡献者）时是否强制填邮箱：歌词投稿必填，歌曲分享选填 */
    requireEmailForNew?: boolean
    /** 是否显示「仅提交资料更新（无需投稿）」按钮（仅歌词投稿） */
    showProfileOnlyButton?: boolean
    /** 资料更新按钮的 loading 态（复用父页面提交中状态） */
    submitting?: boolean
  }>(),
  {
    variant: 'lyric',
    requireEmailForNew: false,
    showProfileOnlyButton: false,
    submitting: false,
  },
)

const emit = defineEmits<{
  (e: 'update:modelValue', value: SubmitterIdentity): void
  /** 点击「仅提交资料更新」（父页面完成自身业务校验后发 profile 投稿） */
  (e: 'profile-submit'): void
}>()

/** 本地可变副本：初始化自 modelValue，变更后整体回发（字段都是基本类型/浅数组） */
const form = reactive<SubmitterIdentity>({
  name: props.modelValue.name,
  email: props.modelValue.email,
  bio: props.modelValue.bio,
  contacts: props.modelValue.contacts.map(c => ({ ...c })),
  public_contact: props.modelValue.public_contact,
  request_update: props.modelValue.request_update,
  request_clear: props.modelValue.request_clear,
})

function syncOut() {
  emit('update:modelValue', {
    name: form.name,
    email: form.email,
    bio: form.bio,
    contacts: form.contacts.map(c => ({ ...c })),
    public_contact: form.public_contact,
    request_update: form.request_update,
    request_clear: form.request_clear,
  })
}
watch(form, syncOut, { deep: true })

// ============ 贡献者远程搜索（两站同一套：全量、排除站长、防抖 200ms） ============
const contributorOptions = ref<Contributor[]>([])
const contributorLoading = ref(false)
const allContributors = ref<Contributor[]>([])
const currentQuery = ref('')
const isNewContributor = ref(false)
let contributorSearchTimer: ReturnType<typeof setTimeout> | null = null

async function loadAllContributorsOnce() {
  if (allContributors.value.length > 0) return allContributors.value
  try {
    const list = await api.getContributors()
    allContributors.value = (list || []).filter(c => !c.is_owner)
  } catch (e) {
    console.error('load contributors failed', e)
  }
  return allContributors.value
}

onMounted(() => {
  loadAllContributorsOnce()
})

async function searchContributors(query: string) {
  currentQuery.value = (query || '').trim()
  if (contributorSearchTimer) clearTimeout(contributorSearchTimer)
  contributorLoading.value = true
  contributorSearchTimer = setTimeout(async () => {
    try {
      const list = await loadAllContributorsOnce()
      const q = (query || '').trim().toLowerCase()
      contributorOptions.value = q
        ? list.filter(c => (c.name || '').toLowerCase().includes(q)).slice(0, 20)
        : list.slice(0, 20)
    } finally {
      contributorLoading.value = false
    }
  }, 200)
}

/** 命中已有贡献者返回对象；新昵称/未输入返回 null */
const selected = computed<Contributor | null>(() => {
  if (isNewContributor.value) return null
  const name = (form.name || '').trim()
  if (!name) return null
  return allContributors.value.find(c => c.name === name) || null
})

function onContributorNameChange(val: string | null | undefined) {
  if (val && typeof val === 'string' && val.startsWith('__NEW__:')) {
    form.name = val.slice('__NEW__:'.length)
    isNewContributor.value = true
  } else {
    form.name = val || ''
    isNewContributor.value = false
  }
  // 离开已有账号身份：两个资料动作复位，避免无效值携带提交
  if (!selected.value) {
    form.request_update = false
    form.request_clear = false
  }
}

// ============ 锁定状态机 ============
/** 锁定：选中已有贡献者且未勾选「更新我的信息」（勾选「清空」时同样保持锁定） */
const locked = computed(() => !!selected.value && !form.request_update)

/** 「更新」与「清空」互斥（el-checkbox @change 触发） */
function onRequestUpdateChange(val: boolean | string | number) {
  // :model-value 为单向绑定，必须在这里把勾选状态写回，否则复选框视觉上无法勾上
  form.request_update = !!val
  if (val) form.request_clear = false
}
function onRequestClearChange(val: boolean | string | number) {
  form.request_clear = !!val
  if (val) form.request_update = false
}

// ============ 联系方式动态行 ============
function addContact() {
  const usedTypes = new Set(form.contacts.map(c => c.type).filter(Boolean))
  const nextType = CONTACT_TYPES.find(t => !usedTypes.has(t)) || CONTACT_TYPES[0]
  form.contacts.push({ type: nextType, value: '' })
}
function removeContact(idx: number) {
  if (form.contacts.length <= 1) {
    form.contacts[0].value = ''
    return
  }
  form.contacts.splice(idx, 1)
}
function isContactTypeSelected(type: string, currentIdx: number) {
  return form.contacts.some((c, i) => i !== currentIdx && c.type === type)
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * 校验联系方式动态行（平台主页类必须完整链接）。
 * 锁定状态下输入框禁用、不会有新值，跳过；非法时弹提示并返回 false。
 */
function validateContactRows(): boolean {
  if (locked.value) return true
  for (const c of form.contacts) {
    const t = (c.type || '').trim()
    const v = (c.value || '').trim()
    if (!t || !v) continue
    const err = contactValueError(t, v)
    if (err) {
      ElMessage.warning(err)
      return false
    }
  }
  return true
}

/**
 * 组装 contributors.contact_value 同构对象（空值行丢弃），邮箱始终作为其中一键。
 * 锁定（已有账号未勾更新）时动态行不参与，邮箱栏同样禁用，正常返回 {} 。
 * 链接校验失败返回 null，调用方应中止提交。
 */
function buildContactValue(): Record<string, string> | null {
  const obj: Record<string, string> = {}
  const email = (form.email || '').trim()
  if (email) obj['email'] = email
  if (!locked.value) {
    for (const c of form.contacts) {
      const t = (c.type || '').trim()
      const v = (c.value || '').trim()
      if (!t || !v) continue
      const err = contactValueError(t, v)
      if (err) {
        ElMessage.warning(err)
        return null
      }
      obj[t] = v
    }
  }
  return obj
}

/** 是否有任意可公开内容（邮箱或其他联系方式非空）；没有时公开勾选无意义 */
const hasAnyPublicContact = computed(() => {
  if ((form.email || '').trim()) return true
  return form.contacts.some(c => !!(c.value || '').trim())
})

// 可公开内容被清空时，连带取消公开意愿（歌曲投稿口径；防止置灰状态携带旧值提交）
watch(hasAnyPublicContact, has => {
  if (!has && props.variant === 'music') form.public_contact = false
})

/**
 * 公开勾选区禁用态：
 * - 选中已有账号且未勾更新：两站统一锁定；
 * - 歌曲投稿且没有任何可公开内容（邮箱/联系方式都空）：置灰（歌词投稿保持原行为，不置灰）。
 */
const publicBoxDisabled = computed(() => locked.value || (props.variant === 'music' && !hasAnyPublicContact.value))

/**
 * 常规投稿校验：昵称必填；新昵称按 requireEmailForNew 决定邮箱是否必填；
 * 邮箱格式；更新/清空互斥；联系方式链接规范。
 * 不通过时已弹出中文提示，返回 false。
 */
function validateForSubmit(): boolean {
  const name = (form.name || '').trim()
  const email = (form.email || '').trim()
  if (!name) {
    ElMessage.warning('请填写昵称')
    return false
  }
  if (!selected.value && props.requireEmailForNew && !email) {
    ElMessage.warning('请填写邮箱')
    return false
  }
  if (email && !EMAIL_REGEX.test(email)) {
    ElMessage.warning('请填写正确的邮箱地址')
    return false
  }
  if (selected.value && form.request_clear && form.request_update) {
    ElMessage.warning('更新信息和清空信息不能同时勾选')
    return false
  }
  if (!validateContactRows()) return false
  return true
}

/**
 * 「仅提交资料更新」专用校验：必须选中已有贡献者、勾选了更新、
 * 邮箱格式正确，且至少填写一项要更新的内容（邮箱/联系方式/简介）。
 */
function validateForProfileUpdate(): boolean {
  if (!selected.value) {
    ElMessage.warning('资料更新仅支持已有贡献者，请先在昵称中选择你自己')
    return false
  }
  const email = (form.email || '').trim()
  if (email && !EMAIL_REGEX.test(email)) {
    ElMessage.warning('请填写正确的邮箱地址')
    return false
  }
  if (!validateContactRows()) return false
  const contactObj = buildContactValue()
  if (contactObj === null) return false
  const hasBio = !!(form.bio || '').trim()
  if (!hasBio && Object.keys(contactObj).length === 0) {
    ElMessage.warning('请至少填写一项要更新的内容（邮箱/联系方式/简介）')
    return false
  }
  return true
}

function onProfileOnlyClick() {
  if (!validateForProfileUpdate()) return
  emit('profile-submit')
}

defineExpose({
  /** 当前命中的已有贡献者（新昵称/未命中为 null） */
  selected,
  /** 常规投稿前校验 */
  validateForSubmit,
  /** 仅资料更新投稿前校验 */
  validateForProfileUpdate,
  /** 组装 contact_value（邮箱并入；校验失败返回 null） */
  buildContactValue,
})
</script>

<template>
  <div>
    <!-- 昵称：远程搜索已有贡献者 / 新昵称新建 -->
    <div class="mb-4">
      <label class="block text-sm font-medium text-gray-700 mb-1">昵称 <span class="text-red-500">*</span></label>
      <el-select
        :model-value="form.name"
        filterable
        remote
        clearable
        :reserve-keyword="false"
        :placeholder="variant === 'music'
          ? '搜索已有昵称，或输入新昵称后点选蓝色新建项'
          : '搜索并选择已有贡献者，或输入新昵称后点选下方蓝色新建项'"
        :remote-method="searchContributors"
        :loading="contributorLoading"
        style="width: 100%"
        @change="onContributorNameChange"
      >
        <el-option v-for="c in contributorOptions" :key="c.id" :label="c.name" :value="c.name">
          <div class="flex items-center gap-2">
            <img :src="c.avatar || DEFAULT_LOGO" class="w-6 h-6 rounded-full object-cover" />
            <span class="font-medium">{{ c.name }}</span>
            <span v-if="c.tags && c.tags.length" class="text-xs text-gray-400 ml-1">{{ c.tags.slice(0, 2).join(' · ') }}</span>
          </div>
        </el-option>
        <el-option v-if="currentQuery" key="__new__" :label="`__NEW__:${currentQuery}`" :value="`__NEW__:${currentQuery}`">
          <span class="text-blue-500 font-medium">
            ➕ {{ variant === 'music' ? '使用新昵称' : '新建贡献者' }}「{{ currentQuery }}」
          </span>
        </el-option>
      </el-select>
      <!-- 新昵称提示 -->
      <div v-if="isNewContributor" class="text-xs text-blue-600 mt-1">
        <template v-if="variant === 'music'">将以新昵称「{{ form.name }}」记录，审核通过后自动创建贡献者账号</template>
        <template v-else>将作为新贡献者「{{ form.name }}」创建（即使数据库已有同名贡献者，也不会自动挂到他人账号下）</template>
      </div>
    </div>

    <!-- 选中已有贡献者的提示条 -->
    <el-alert v-if="selected" type="warning" :closable="false" show-icon class="mb-4">
      <template #title>
        你选择了已有贡献者 <b>{{ selected.name }}</b>
      </template>
      由于没有登录流程，我们不会预填你的联系方式等隐私数据到表单。<br />
      只是想用你之前的身份{{ variant === 'music' ? '分享' : '投稿' }} → <b>下方信息不用再填</b>，直接去填{{ variant === 'music' ? '歌曲' : '歌曲' }}信息即可。<br />
      如需<b>更新</b>你的联系方式/简介，或需要<b>清空</b>之前填过的所有信息，请勾选下方对应选项。
    </el-alert>

    <div class="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-4">
      <!-- 邮箱（同属用户资料；新昵称时歌词投稿必填） -->
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">
          邮箱
          <span v-if="!selected && requireEmailForNew" class="text-red-500">*</span>
          <span v-else class="text-xs text-gray-400 ml-1">（选填，填了可收到审核邮件）</span>
        </label>
        <input
          v-model="form.email"
          type="email"
          :disabled="locked"
          class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
          placeholder="用于接收审核结果通知，不会公开展示"
        />
      </div>

      <!-- 简介 -->
      <div>
        <label class="block text-sm font-medium text-gray-700 mb-1">
          简介
          <span class="text-xs text-gray-400 ml-1">（选填）</span>
        </label>
        <input
          v-model="form.bio"
          type="text"
          :disabled="locked"
          class="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-500 disabled:bg-gray-100 disabled:text-gray-400 disabled:cursor-not-allowed"
          placeholder="一句话介绍自己"
        />
      </div>
    </div>

    <!-- 联系方式动态行 -->
    <div class="mt-4">
      <label class="block text-sm font-medium text-gray-700 mb-1">
        联系方式
        <span class="text-xs text-gray-400 ml-1">
          （选填，可添加多种方式{{ variant === 'music' ? '；默认仅站长可见，勾选下方公开后才会对外展示' : '' }}）
        </span>
      </label>
      <div class="space-y-2">
        <div v-for="(c, idx) in form.contacts" :key="idx" class="flex gap-2 items-center">
          <el-select v-model="c.type" style="width: 110px; flex-shrink: 0" :disabled="locked">
            <el-option v-for="t in CONTACT_TYPES" :key="t" :label="contactLabel(t)" :value="t" :disabled="isContactTypeSelected(t, idx)" />
          </el-select>
          <el-input
            v-model="c.value"
            :placeholder="contactPlaceholder(c.type) || '号码/文本'"
            style="flex: 1; min-width: 0"
            :disabled="locked"
          />
          <el-button type="danger" link :disabled="locked" @click="removeContact(idx)">移除</el-button>
        </div>
      </div>
      <el-button type="primary" link size="small" class="mt-1" :disabled="locked" @click="addContact">
        + 添加联系方式
      </el-button>
    </div>

    <!-- 更新/清空 选项（仅选中已有贡献者显示） -->
    <div v-if="selected" class="mt-5 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-3">
      <div class="text-sm font-medium text-blue-800 mb-2">🛠️ 对已有贡献者资料的操作</div>
      <label class="flex items-start gap-2 text-sm text-blue-900 cursor-pointer select-none">
        <el-checkbox :model-value="form.request_update" @change="onRequestUpdateChange" />
        <span>
          <b>更新我的信息</b><br />
          <span class="text-xs text-blue-700">勾选后解锁上方邮箱/联系方式/简介，本次填写的内容将在审核通过时<b>全量覆盖</b>你在贡献者库里的对应字段。</span>
        </span>
      </label>
      <label class="flex items-start gap-2 text-sm text-blue-900 cursor-pointer select-none">
        <el-checkbox :model-value="form.request_clear" @change="onRequestClearChange" />
        <span>
          <b>清空我的信息</b><br />
          <span class="text-xs text-blue-700">勾选后上方输入保持禁用；审核通过时把该贡献者除 ID、昵称、标签外的所有字段置空。要删除 ID 请联系管理员。</span>
        </span>
      </label>
      <!-- 仅歌词投稿：不投作品、只改资料时单独进入审核队列 -->
      <div v-if="showProfileOnlyButton && form.request_update" class="pt-1">
        <el-button type="primary" size="small" :loading="submitting" @click="onProfileOnlyClick">
          仅提交资料更新（无需投稿歌词）
        </el-button>
        <div class="text-xs text-blue-700 mt-1">不投歌词、只想改自己资料时点这个，提交后单独进入审核队列</div>
      </div>
    </div>

    <!-- 公开选项 -->
    <div
      class="mt-4 p-3 bg-pink-50/50 rounded-lg space-y-2"
      :class="{ 'opacity-50 pointer-events-none': publicBoxDisabled }"
    >
      <div class="text-sm font-medium text-gray-700 mb-2">
        {{ variant === 'music' ? '🔓 公开我的联系方式（默认不公开）' : '🔓 信息公开（默认不公开，勾选后将在贡献者页面展示）' }}
      </div>
      <label class="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
        <input v-model="form.public_contact" type="checkbox" class="w-4 h-4 accent-pink-500" />
        <span>
          <template v-if="variant === 'music'">
            公开联系方式（展示在音乐人主页与自荐卡片上，方便听众一键跳转）
          </template>
          <template v-else>
            公开联系方式（联系方式将展示在贡献者主页）
          </template>
        </span>
      </label>
      <!-- 歌曲投稿：填错后的自助修正路径说明 -->
      <div v-if="variant === 'music'" class="text-xs text-gray-500 mt-1 leading-relaxed">
        填错了可之后在投稿页勾选「更新我的信息」自助修改，或联系站长在贡献者管理中修改。
      </div>
      <!-- 歌词投稿：贡献者名单引导（原链接保留） -->
      <div v-else class="text-xs text-gray-500 mt-2">
        💡 想进入 <RouterLink to="/contributors" target="_blank" class="text-pink-600 hover:underline">贡献者名单</RouterLink>？勾选公开选项，并通过更多投稿让作品被审核通过即可！
      </div>
    </div>
  </div>
</template>
