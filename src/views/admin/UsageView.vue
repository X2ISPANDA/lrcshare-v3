<template>
  <div class="space-y-4">
    <!-- 工具条 -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-wrap items-center gap-3 px-5 py-3">
      <div class="text-sm text-gray-500">
        API 调用统计 · 数据源 Cloudflare Analytics Engine（约 1 分钟延迟）
      </div>
      <div class="flex-1"></div>
      <el-radio-group v-model="days" size="small" @change="load">
        <el-radio-button :value="1">近 1 天</el-radio-button>
        <el-radio-button :value="7">近 7 天</el-radio-button>
        <el-radio-button :value="30">近 30 天</el-radio-button>
      </el-radio-group>
      <el-button type="primary" :loading="loading" @click="load">刷新</el-button>
    </div>

    <!-- 加载中 -->
    <div v-if="loading && !groups.length" class="bg-white rounded-xl border border-gray-100 shadow-sm text-center py-16 text-gray-400 text-sm">
      加载中…
    </div>

    <!-- 空态 -->
    <div v-else-if="!groups.length" class="bg-white rounded-xl border border-gray-100 shadow-sm text-center py-16 text-gray-400 text-sm">
      该时间窗口内没有调用记录
    </div>

    <!-- KEY 分组（按调用量降序，展开看 IP 明细） -->
    <div v-else class="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-2">
      <el-collapse v-model="openKeys">
        <el-collapse-item v-for="g in groups" :key="g.keyHash" :name="g.keyHash">
          <template #title>
            <div class="flex items-center gap-3 flex-wrap w-full pr-4">
              <span class="font-medium text-gray-800">{{ g.name }}</span>
              <code class="text-xs bg-gray-50 px-2 py-1 rounded text-gray-500">{{ g.prefix }}...</code>
              <el-tag v-if="g.banned" type="danger" size="small">已封禁</el-tag>
              <div class="flex-1"></div>
              <span class="text-sm text-gray-500">
                {{ g.totalCalls.toLocaleString() }} 次 · {{ g.ips.length }} 个 IP
              </span>
            </div>
          </template>

          <el-table :data="g.ips" size="small">
            <el-table-column label="IP" min-width="180">
              <template #default="{ row }">
                <code v-if="row.ip" class="text-xs bg-gray-50 px-2 py-1 rounded text-gray-600">{{ row.ip }}</code>
                <span v-else class="text-xs text-gray-400">未知</span>
              </template>
            </el-table-column>
            <el-table-column label="调用次数" width="120" align="right">
              <template #default="{ row }">
                <span :class="row.calls >= CALL_ALERT_THRESHOLD ? 'text-red-600 font-medium' : 'text-gray-700'">
                  {{ row.calls.toLocaleString() }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="最后活跃" width="170" align="center">
              <template #default="{ row }">{{ formatTime(row.last_seen) }}</template>
            </el-table-column>
            <el-table-column label="操作" width="100" align="center">
              <template #default="{ row }">
                <el-button v-if="row.ip" link type="danger" size="small" @click="banIp(row as IpRow)">封禁</el-button>
                <span v-else class="text-xs text-gray-300">—</span>
              </template>
            </el-table-column>
          </el-table>
        </el-collapse-item>
      </el-collapse>
    </div>

    <!-- 封禁 IP 弹窗 -->
    <el-dialog v-model="showBanDialog" title="封禁 IP" width="480px" :close-on-click-modal="false">
      <el-form :model="banForm" label-width="80px">
        <el-form-item label="IP">
          <code class="text-xs bg-gray-50 px-2 py-1 rounded text-gray-600">{{ banForm.ip }}</code>
        </el-form-item>
        <el-form-item label="原因">
          <el-input v-model="banForm.reason" type="textarea" :rows="2" placeholder="如：单日调用 1.5 万次，疑似爬虫" />
        </el-form-item>
        <el-form-item label="到期">
          <el-select v-model="banForm.duration" class="w-full">
            <el-option label="1 天后自动解除" value="1d" />
            <el-option label="7 天后自动解除" value="7d" />
            <el-option label="30 天后自动解除" value="30d" />
            <el-option label="永久封禁" value="forever" />
          </el-select>
        </el-form-item>
      </el-form>
      <div class="text-xs text-gray-400 leading-relaxed">
        提示：封禁粒度为纯 IP。IPv6 地址会自动归一化为 /64 段，覆盖同一宽带用户的整段分配。
      </div>
      <template #footer>
        <el-button @click="showBanDialog = false">取消</el-button>
        <el-button type="danger" :loading="banning" @click="confirmBan">确认封禁</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import 'element-plus/es/components/message/style/css'
import { adminApi, normalizeIpForBan } from '@/lib/adminApi'
import type { ApiKey, ApiUsageRow } from '@/lib/types'

/** API 用量分析：按 KEY 分组展示各 IP 调用量，一键封禁异常 IP */

/** 单 IP 调用量告警阈值（超过标红，便于快速定位滥用） */
const CALL_ALERT_THRESHOLD = 10000

const days = ref(7)
const loading = ref(false)
const rows = ref<ApiUsageRow[]>([])
const apiKeys = ref<ApiKey[]>([])
const openKeys = ref<string[]>([])

interface IpRow {
  ip: string
  calls: number
  last_seen: string
}

interface KeyGroup {
  keyHash: string
  name: string
  prefix: string
  banned: boolean
  totalCalls: number
  ips: IpRow[]
}

const keyMap = computed(() => {
  const m = new Map<string, ApiKey>()
  for (const k of apiKeys.value) m.set(k.key_hash, k)
  return m
})

const groups = computed<KeyGroup[]>(() => {
  const byKey = new Map<string, KeyGroup>()
  for (const r of rows.value) {
    const k = keyMap.value.get(r.key_hash)
    let g = byKey.get(r.key_hash)
    if (!g) {
      g = {
        keyHash: r.key_hash,
        name: k ? k.name : `未登记的 KEY（${r.key_hash.slice(0, 8)}…）`,
        prefix: k ? k.key_prefix : r.key_hash.slice(0, 8),
        banned: k ? k.status === 'banned' : false,
        totalCalls: 0,
        ips: [],
      }
      byKey.set(r.key_hash, g)
    }
    g.totalCalls += Number(r.calls) || 0
    g.ips.push({ ip: r.ip, calls: Number(r.calls) || 0, last_seen: r.last_seen })
  }
  // 组内 IP 按调用量降序；组间按总调用量降序（异常 KEY 排最前）
  for (const g of byKey.values()) g.ips.sort((a, b) => b.calls - a.calls)
  return Array.from(byKey.values()).sort((a, b) => b.totalCalls - a.totalCalls)
})

function formatTime(v: string) {
  if (!v) return '—'
  // AE SQL API 返回 "YYYY-MM-DD HH:mm:ss"（UTC，无时区标识）；
  // 直接 new Date 会按本地时区解析，导致显示比实际早 8 小时。补 T/Z 显式声明 UTC。
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(v)
    ? v.replace(' ', 'T') + 'Z'
    : v
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return v
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

async function load() {
  loading.value = true
  try {
    // 并行：KEY 列表（供 hash → 名称映射）+ 用量聚合
    const [keys, usage] = await Promise.all([
      adminApi.getAll<ApiKey>('api_keys', { order: 'created_at', ascending: false }),
      adminApi.queryApiUsage(days.value),
    ])
    apiKeys.value = keys
    rows.value = usage
    // 默认折叠；只有一组时自动展开，省一次点击
    openKeys.value = groups.value.length === 1 ? [groups.value[0].keyHash] : []
  } catch (e: any) {
    ElMessage.error('加载失败：' + (e?.message || e))
  } finally {
    loading.value = false
  }
}
onMounted(load)

// ============ 封禁 IP ============
const showBanDialog = ref(false)
const banning = ref(false)
const banForm = reactive({ ip: '', reason: '', duration: '7d' })

function banIp(row: IpRow) {
  if (!row.ip) {
    ElMessage.warning('该记录没有可用 IP，无法封禁')
    return
  }
  banForm.ip = row.ip
  banForm.reason = `单 IP ${row.calls.toLocaleString()} 次调用（近 ${days.value} 天）`
  banForm.duration = '7d'
  showBanDialog.value = true
}

/** 到期时间换算：返回 ISO 字符串；forever 返回 null（永久封禁） */
function expiresAt(duration: string): string | null {
  if (duration === 'forever') return null
  const map: Record<string, number> = { '1d': 1, '7d': 7, '30d': 30 }
  const addDays = map[duration]
  if (!addDays) return null
  return new Date(Date.now() + addDays * 24 * 60 * 60 * 1000).toISOString()
}

async function confirmBan() {
  // AE 里存的已是归一化 IP；这里再套一次保证与 Worker 比对格式一致（幂等）
  const ip = normalizeIpForBan(banForm.ip.trim())
  if (!ip) {
    ElMessage.warning('IP 不能为空或格式非法')
    return
  }
  banning.value = true
  try {
    await adminApi.insert('banned_ips', {
      id: crypto.randomUUID(),
      ip,
      reason: banForm.reason.trim() || null,
      expires_at: expiresAt(banForm.duration),
    })
    // 通知 Worker 清缓存，使封禁立即生效（失败则等 5min TTL 兜底）
    await adminApi.refreshIpCache().catch(() => {
      ElMessage.warning('封禁成功，但缓存刷新失败，最长 5 分钟后生效')
    })
    ElMessage.success('已封禁 ' + ip)
    showBanDialog.value = false
  } catch (e: any) {
    ElMessage.error('封禁失败：' + (e?.message || e))
  } finally {
    banning.value = false
  }
}
</script>
