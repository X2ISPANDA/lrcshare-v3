<template>
  <div class="min-h-screen flex items-center justify-center bg-gradient-to-br from-pink-50 via-purple-50 to-indigo-50 px-4">
    <div class="w-full max-w-sm">
      <div class="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
        <div class="text-center mb-8">
          <img
            :src="LOGO_URL"
            alt="LrcShare"
            class="w-16 h-16 mx-auto mb-3 rounded-xl"
          />
          <h1 class="text-2xl font-bold text-gray-800">管理后台</h1>
          <p class="text-sm text-gray-400 mt-1">LrcShare Administration</p>
        </div>

        <el-input
          v-model="email"
          type="email"
          placeholder="管理员邮箱"
          size="large"
          :disabled="loading"
          @keyup.enter="handleLogin"
        >
          <template #prefix><span class="text-gray-400">📧</span></template>
        </el-input>

        <el-input
          v-model="password"
          type="password"
          show-password
          placeholder="密码"
          size="large"
          class="mt-4"
          :disabled="loading"
          @keyup.enter="handleLogin"
        >
          <template #prefix><span class="text-gray-400">🔒</span></template>
        </el-input>

        <el-button
          type="primary"
          size="large"
          class="w-full mt-6"
          :loading="loading"
          style="--el-button-bg-color: #ec4899; --el-button-border-color: #ec4899; --el-button-hover-bg-color: #db2777; --el-button-hover-border-color: #db2777"
          @click="handleLogin"
        >登 录</el-button>

        <p v-if="error" class="text-sm text-red-500 mt-4 text-center">{{ error }}</p>
      </div>

      <p class="text-center text-xs text-gray-400 mt-4">
        <RouterLink to="/" class="hover:text-pink-500">← 返回前台</RouterLink>
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useHead } from '@unhead/vue'
import { useAdminAuth } from '@/composables/useAdminAuth'
import { LOGO_URL } from '@/lib/constants'

useHead({ title: '登录 - 管理后台 - LrcShare' })

const route = useRoute()
const router = useRouter()
const { login } = useAdminAuth()

const email = ref('')
const password = ref('')
const loading = ref(false)
const error = ref('')

async function handleLogin() {
  if (!email.value || !password.value) {
    error.value = '请输入邮箱和密码'
    return
  }
  loading.value = true
  error.value = ''
  try {
    await login(email.value, password.value)
    router.replace((route.query.redirect as string) || '/admin/dashboard')
  } catch (e: any) {
    error.value = '登录失败：' + (e?.message || '邮箱或密码错误')
  } finally {
    loading.value = false
  }
}
</script>
