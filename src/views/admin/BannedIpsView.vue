<template>
  <div class="space-y-4">
    <!-- 工具条 -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-wrap items-center gap-3 px-5 py-3">
      <div class="text-sm text-gray-500">
        被封禁的 IP 会在 Worker 入口直接拒绝（403），不影响同一 KEY 下其他 IP 的调用
      </div>
      <div class="flex-1"></div>
      <el-button :loading="loading" @click="load">刷新</el-button>
      <el-button type="primary" @click="openCreate">手动封禁 IP</el-button>
    </div>

    <!-- 列表 -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
      <el-table v-loading="loading" :data="list" size="default" row-key="id">
        <el-table-column label="IP" min-width="200">
          <template #default="{ row }">
            <code class="text-xs bg-gray-50 px-2 py-1 rounded text-gray-600">{{ row.ip }}</code>
          </template>
        </el-table-column>

        <el-table-column label="状态" width="100" align="center">
          <template #default="{ row }">
            <el-tag :type="isActive(row as BannedIp) ? 'danger' : 'info'" size="small">
              {{ isActive(row as BannedIp) ? '生效中' : '已过期' }}
            </el-tag>
          </template>
        </el-table-column>

        <el-table-column prop="reason" label="原因" min-width="180" show-overflow-tooltip>
          <template #default="{ row }">
            <span class="text-gray-600">{{ row.reason || '—' }}</span>
          </template>
        </el-table-column>

        <el-table-column label="到期时间" width="160" align="center">
          <template #default="{ row }">
            <span :class="isActive(row as BannedIp) ? 'text-gray-700' : 'text-gray-400'">
              {{ row.expires_at ? formatTime(row.expires_at) : '永久' }}
            </span>
          </template>
        </el-table-column>

        <el-table-column label="创建时间" width="160" align="center">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>

        <el-table-column label="操作" width="110" align="center" fixed="right">
          <template #default="{ row }">
            <el-button link type="danger" size="small" @click="remove(row as BannedIp)">解除</el-button>
          </template>
        </el-table-column>

        <template #empty>
          <div class="py-12 text-center text-gray-400 text-sm">暂无封禁记录</div>
        </template>
      </el-table>
    </div>

    <!-- 新增封禁弹窗 -->
    <el-dialog v-model="showDialog" title="封禁 IP" width="480px" :close-on-click-modal="false">
      <el-form :model="form" label-width="80px">
        <el-form-item label="IP" required>
          <el-input v-model="form.ip" placeholder="IPv4 如 1.2.3.4；IPv6 将自动归一化为 /64 段" />
        </el-form-item>
        <el-form-item label="原因">
          <el-input v-model="form.reason" type="textarea" :rows="2" placeholder="如：单日调用 1.5 万次，疑似爬虫" />
        </el-form-item>
        <el-form-item label="到期">
          <el-select v-model="form.duration" class="w-full">
            <el-option label="1 天后自动解除" value="1d" />
            <el-option label="7 天后自动解除" value="7d" />
            <el-option label="30 天后自动解除" value="30d" />
            <el-option label="永久封禁" value="forever" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button type="danger" :loading="saving" @click="save">确认封禁</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import 'element-plus/es/components/message/style/css'
import 'element-plus/es/components/message-box/style/css'
import { adminApi, normalizeIpForBan } from '@/lib/adminApi'
import type { BannedIp } from '@/lib/types'

/** IP 黑名单管理：查看/新增/解除封禁，变更后通知 Worker 清缓存即时生效 */

const loading = ref(false)
const list = ref<BannedIp[]>([])

function formatTime(v: string) {
  if (!v) return '—'
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return v
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 是否仍在生效（expires_at 为空 = 永久；未到期 = 生效中） */
function isActive(row: BannedIp) {
  if (!row.expires_at) return true
  return new Date(row.expires_at).getTime() > Date.now()
}

async function load() {
  loading.value = true
  try {
    list.value = await adminApi.getAll<BannedIp>('banned_ips', { order: 'created_at', ascending: false })
  } catch (e: any) {
    ElMessage.error('加载失败：' + (e?.message || e))
  } finally {
    loading.value = false
  }
}
onMounted(load)

// ============ 新增 ============
const showDialog = ref(false)
const saving = ref(false)
const form = reactive({ ip: '', reason: '', duration: '7d' })

function openCreate() {
  form.ip = ''
  form.reason = ''
  form.duration = '7d'
  showDialog.value = true
}

/** 到期时间换算：返回 ISO 字符串；forever 返回 null（永久封禁） */
function expiresAt(duration: string): string | null {
  if (duration === 'forever') return null
  const map: Record<string, number> = { '1d': 1, '7d': 7, '30d': 30 }
  const addDays = map[duration]
  if (!addDays) return null
  return new Date(Date.now() + addDays * 24 * 60 * 60 * 1000).toISOString()
}

async function save() {
  const raw = form.ip.trim()
  if (!raw) {
    ElMessage.warning('IP 不能为空')
    return
  }
  // 归一化（IPv4 原样 / IPv6 取 /64 段），与 Worker 端比对格式保持一致，否则封禁不生效
  const ip = normalizeIpForBan(raw)
  if (!ip) {
    ElMessage.warning('IP 格式不正确（IPv4 如 1.2.3.4；IPv6 支持完整或压缩写法）')
    return
  }
  saving.value = true
  try {
    await adminApi.insert('banned_ips', {
      id: crypto.randomUUID(),
      ip,
      reason: form.reason.trim() || null,
      expires_at: expiresAt(form.duration),
    })
    await adminApi.refreshIpCache().catch(() => {
      ElMessage.warning('封禁成功，但缓存刷新失败，最长 5 分钟后生效')
    })
    ElMessage.success('已封禁 ' + ip)
    showDialog.value = false
    await load()
  } catch (e: any) {
    ElMessage.error('封禁失败：' + (e?.message || e))
  } finally {
    saving.value = false
  }
}

// ============ 解除 ============
async function remove(row: BannedIp) {
  try {
    await ElMessageBox.confirm(`确认解除对 ${row.ip} 的封禁？解除后该 IP 可立即恢复调用。`, '解除封禁', {
      type: 'warning',
      confirmButtonText: '解除',
      cancelButtonText: '取消',
    })
  } catch {
    return // 用户取消
  }
  try {
    await adminApi.remove('banned_ips', row.id)
    await adminApi.refreshIpCache().catch(() => {
      ElMessage.warning('已解除，但缓存刷新失败，最长 5 分钟后生效')
    })
    ElMessage.success('已解除封禁')
    await load()
  } catch (e: any) {
    ElMessage.error('解除失败：' + (e?.message || e))
  }
}
</script>
