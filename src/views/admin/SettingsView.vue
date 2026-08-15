<template>
  <div class="space-y-4" v-loading="loading">
    <!-- 通知设置 -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm px-6 py-5">
      <div class="font-semibold text-gray-800 mb-4">📨 通知设置</div>
      <el-form label-width="110px" class="max-w-xl">
        <el-form-item label="管理员邮箱">
          <div class="w-full">
            <el-input v-model="settings.admin_email" placeholder="接收审核通知的邮箱" />
            <div class="text-xs text-gray-400 mt-1">投稿审核结果将通知到投稿者，异常情况抄送此邮箱</div>
          </div>
        </el-form-item>
      </el-form>
    </div>

    <!-- SMTP 设置 -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm px-6 py-5">
      <div class="flex items-center justify-between mb-4">
        <div>
          <div class="font-semibold text-gray-800">📧 SMTP 邮件服务</div>
          <div class="text-xs text-gray-400 mt-0.5">用于投稿审核结果通知（经 Netlify Functions 发送）</div>
        </div>
        <el-button size="small" plain :disabled="!settings.smtp_host || !settings.smtp_pass" @click="sendTestEmail">发送测试邮件</el-button>
      </div>
      <el-form label-width="110px" class="max-w-xl">
        <el-row :gutter="16">
          <el-col :span="14"><el-form-item label="SMTP 服务器"><el-input v-model="settings.smtp_host" placeholder="smtp.qq.com" /></el-form-item></el-col>
          <el-col :span="10"><el-form-item label="端口"><el-input v-model="settings.smtp_port" placeholder="465" /></el-form-item></el-col>
        </el-row>
        <el-form-item label="用户名"><el-input v-model="settings.smtp_user" placeholder="your@example.com" /></el-form-item>
        <el-form-item label="密码">
          <div class="w-full">
            <el-input v-model="settings.smtp_pass" type="password" show-password placeholder="SMTP 授权码" />
            <div class="text-xs text-gray-400 mt-1">QQ 邮箱请使用授权码而非登录密码</div>
          </div>
        </el-form-item>
      </el-form>
    </div>

    <!-- 安全设置 -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm px-6 py-5">
      <div class="font-semibold text-gray-800 mb-4">🔒 安全设置</div>
      <el-form label-width="110px" class="max-w-xl">
        <el-form-item label="隐藏歌词口令">
          <div class="w-full">
            <el-input v-model="settings.hidden_unlock_code" placeholder="全局解锁口令" show-password />
            <div class="text-xs text-gray-400 mt-1">访问隐藏歌曲时输入此口令解锁；未设置独立口令的歌曲使用此口令</div>
          </div>
        </el-form-item>
      </el-form>
    </div>

    <div class="flex justify-end">
      <el-button type="primary" :loading="saving" @click="save" style="--el-button-bg-color: #ec4899; --el-button-border-color: #ec4899; --el-button-hover-bg-color: #db2777; --el-button-hover-border-color: #db2777">保存设置</el-button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { adminApi } from '@/lib/adminApi'
import type { Setting } from '@/lib/types'

/** 系统设置：settings 表 key-value（通知邮箱 / SMTP / 隐藏口令）。管理员账号由 Supabase Auth 管理，此处不再设密码项 */

const SETTING_KEYS = ['admin_email', 'smtp_host', 'smtp_port', 'smtp_user', 'smtp_pass', 'hidden_unlock_code'] as const

const loading = ref(false)
const saving = ref(false)
const settings = ref<Record<string, string>>({
  admin_email: '',
  smtp_host: '',
  smtp_port: '',
  smtp_user: '',
  smtp_pass: '',
  hidden_unlock_code: '',
})

async function load() {
  loading.value = true
  try {
    const rows = await adminApi.getAll<Setting>('settings')
    const m = new Map(rows.map(r => [r.key, r.value]))
    for (const k of SETTING_KEYS) settings.value[k] = m.get(k) || ''
  } catch (e: any) {
    ElMessage.error('加载失败：' + e.message)
  } finally {
    loading.value = false
  }
}
onMounted(load)

async function save() {
  saving.value = true
  try {
    for (const k of SETTING_KEYS) {
      await adminApi.upsertSetting(k, settings.value[k])
    }
    ElMessage.success('设置已保存')
  } catch (e: any) {
    ElMessage.error('保存失败：' + e.message)
  } finally {
    saving.value = false
  }
}

async function sendTestEmail() {
  try {
    const { value: email } = await ElMessageBox.prompt('请输入收件人邮箱', '发送测试邮件', {
      inputValue: settings.value.admin_email || '',
      confirmButtonText: '发送',
      cancelButtonText: '取消',
      inputPattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
      inputErrorMessage: '邮箱格式不正确',
    })
    // SMTP 由邮件服务端从 settings 表直接读取，前端仅传收件人
    const res = await adminApi.callMailServer('/api/mailer', { action: 'test', to: email })
    if (res.skipped) {
      ElMessage.warning('SMTP 未配置，请先在上方填写并保存 SMTP 邮箱服务设置')
    } else if (res.success) {
      ElMessage.success('测试邮件已发送，请查收（含垃圾箱）')
    } else {
      ElMessage.error('发送失败：' + (res.error || '未知错误'))
    }
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error('发送失败：' + (e?.message || e))
  }
}
</script>
