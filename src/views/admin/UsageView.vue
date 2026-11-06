<template>
  <div class="space-y-4">
    <!-- 工具条 -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-wrap items-center gap-3 px-5 py-3">
      <div class="text-sm text-gray-500">
        API 调用统计 · 按 UTC 自然日（0-24 点）统计 · 数据源 Cloudflare Analytics Engine（约 1 分钟延迟）
      </div>
      <div class="flex-1"></div>
      <div class="flex items-center gap-1">
        <el-button size="small" :type="span === 1 ? 'primary' : ''" @click="quickRange(1)">今天</el-button>
        <el-button size="small" :type="span === 7 ? 'primary' : ''" @click="quickRange(7)">近 7 天</el-button>
        <el-button size="small" :type="span === 30 ? 'primary' : ''" @click="quickRange(30)">近 30 天</el-button>
      </div>
      <el-date-picker
        v-model="range"
        type="daterange"
        size="small"
        value-format="YYYY-MM-DD"
        range-separator="至"
        start-placeholder="开始日期"
        end-placeholder="结束日期"
        :clearable="false"
        :disabled-date="isFutureDate"
        style="width: 240px"
        @change="handleRangeChange"
      />
      <el-button type="primary" :loading="loadingChart" @click="refreshAll">刷新</el-button>
    </div>

    <!-- 每日调用量柱状图 -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-4">
      <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2">
        <span class="text-sm font-medium text-gray-700">每日调用量</span>
        <span class="text-xs text-gray-400">UTC 0-24 点 · 按 API Key 堆叠 · 点击柱子查看该日明细</span>
        <div class="flex-1"></div>
        <span class="text-xs text-gray-500">范围合计 <b class="text-gray-800">{{ rangeTotal.toLocaleString() }}</b> 次</span>
        <span class="text-xs text-gray-500">今日 <b class="text-gray-800">{{ todayCalls.toLocaleString() }}</b> 次</span>
      </div>

      <div v-if="loadingChart && !dailyRows.length" class="h-72 flex items-center justify-center text-gray-400 text-sm">加载中…</div>
      <div v-else-if="!hasAnyCalls" class="h-72 flex items-center justify-center text-gray-400 text-sm">所选范围内没有调用记录</div>
      <div v-show="hasAnyCalls && !loadingChart" ref="chartEl" class="w-full h-72"></div>
    </div>

    <!-- 选中日 KEY / IP 明细 -->
    <div class="bg-white rounded-xl border border-gray-100 shadow-sm px-5 py-2">
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
        <span class="text-sm font-medium text-gray-700">{{ selectedDate }}（UTC）明细</span>
        <span class="text-xs text-gray-400">
          {{ detailTotal.toLocaleString() }} 次 · {{ groups.length }} 个 KEY
        </span>
        <div class="flex-1"></div>
        <el-button size="small" :loading="loadingDetail" @click="loadDetail">重新加载</el-button>
      </div>

      <div v-if="loadingDetail && !groups.length" class="text-center py-14 text-gray-400 text-sm">加载中…</div>
      <div v-else-if="!groups.length" class="text-center py-14 text-gray-400 text-sm">该日没有调用记录</div>

      <!-- KEY 分组（按调用量降序，展开看 IP 明细） -->
      <el-collapse v-else v-model="openKeys">
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
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import 'element-plus/es/components/message/style/css'
import * as echarts from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import { adminApi, normalizeIpForBan } from '@/lib/adminApi'
import type { ApiKey, ApiUsageDailyRow, ApiUsageRow } from '@/lib/types'

// 按需注册，避免把 echarts 全量打进 admin chunk（只用到堆叠柱状图）
echarts.use([BarChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

/**
 * API 用量分析
 * - 柱状图：按 UTC 自然日（0-24 点）分桶，与 Cloudflare 免费额度按 UTC 零点重置的口径一致；
 *   分色维度为 API KEY，调用量前 8 的 KEY 单独着色，其余合并为「其他」。
 * - 明细：点击柱子查看那一天的 KEY + IP 排行，可一键封禁异常 IP。
 * - 范围上限 30 天：Analytics Engine 免费版只保留 30 天数据。
 */

/** 单 IP 调用量告警阈值（超过标红，便于快速定位滥用） */
const CALL_ALERT_THRESHOLD = 10000

/** 统计范围上限（天）：超过后 AE 没有数据，且会让柱子挤成一团 */
const MAX_DAYS = 30

/** 柱状图 KEY 配色（循环使用；'none' 为未登记 KEY，固定灰色） */
const PALETTE = ['#6366f1', '#ec4899', '#14b8a6', '#f59e0b', '#8b5cf6', '#06b6d4', '#ef4444', '#84cc16']
const OTHER_COLOR = '#94a3b8'
const NONE_COLOR = '#cbd5e1'
/** 单独着色的 KEY 数量上限，超出合并为「其他」 */
const MAX_LEGEND_KEYS = 8

/** 今天（UTC）的 YYYY-MM-DD；不能直接用本地时间，否则跨时区会错一天 */
function utcToday(): string {
  return new Date().toISOString().slice(0, 10)
}

/** 日期加减（按 UTC 计算，不受本地时区影响） */
function addDays(date: string, delta: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + delta * 86400000).toISOString().slice(0, 10)
}

/** start→end 的 UTC 自然日跨度（含首尾） */
function daySpan(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000) + 1
}

// ============ 数据状态 ============
const range = ref<[string, string]>([addDays(utcToday(), -6), utcToday()])
const selectedDate = ref(utcToday())
const loadingChart = ref(false)
const loadingDetail = ref(false)
const dailyRows = ref<ApiUsageDailyRow[]>([])
const detailRows = ref<ApiUsageRow[]>([])
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

const span = computed(() => daySpan(range.value[0], range.value[1]))

const keyMap = computed(() => {
  const m = new Map<string, ApiKey>()
  for (const k of apiKeys.value) m.set(k.key_hash, k)
  return m
})

/** KEY hash → 展示名（登记过的用名称，未登记的显示 hash 前缀） */
function keyName(hash: string): string {
  const k = keyMap.value.get(hash)
  if (k) return k.name
  return hash === 'none' ? '未登记的 KEY（none）' : `未登记的 KEY（${hash.slice(0, 8)}…）`
}

/** 范围内的连续 UTC 日期（含首尾），用于补齐没有调用记录的日期 */
const dateList = computed(() => {
  const out: string[] = []
  for (let d = range.value[0]; d <= range.value[1]; d = addDays(d, 1)) out.push(d)
  return out
})

/** date → key_hash → calls */
const callMap = computed(() => {
  const m = new Map<string, Map<string, number>>()
  for (const r of dailyRows.value) {
    // AE 返回的 date 可能是 "YYYY-MM-DD" 或带时间后缀的 ISO 串，统一截取前 10 位
    const date = String(r.date).slice(0, 10)
    if (!m.has(date)) m.set(date, new Map())
    const inner = m.get(date)!
    inner.set(r.key_hash, (inner.get(r.key_hash) || 0) + (Number(r.calls) || 0))
  }
  return m
})

/** 各 KEY 在范围内的总调用量 */
const keyTotals = computed(() => {
  const t = new Map<string, number>()
  for (const r of dailyRows.value) {
    t.set(r.key_hash, (t.get(r.key_hash) || 0) + (Number(r.calls) || 0))
  }
  return t
})

/** 图例分组：调用量前 N 的 KEY 单独着色，其余归为「其他」 */
const legendGroup = computed(() => {
  const all = Array.from(keyTotals.value.entries()).sort((a, b) => b[1] - a[1])
  const top = all.slice(0, MAX_LEGEND_KEYS)
  return {
    top: top.map(([hash]) => hash),
    hasOther: all.length > MAX_LEGEND_KEYS,
  }
})

const colorMap = computed(() => {
  const m = new Map<string, string>()
  legendGroup.value.top.forEach((hash, i) => {
    m.set(hash, hash === 'none' ? NONE_COLOR : PALETTE[i % PALETTE.length])
  })
  return m
})

/** 图表系列：每个 KEY 一条堆叠柱，前 8 名之外的合并为「其他 KEY」 */
interface ChartSeries {
  name: string
  color: string
  calls: number[]
}

const chartSeries = computed<ChartSeries[]>(() => {
  const list: ChartSeries[] = legendGroup.value.top.map(hash => ({
    name: keyName(hash),
    color: colorMap.value.get(hash) || OTHER_COLOR,
    calls: dateList.value.map(d => callMap.value.get(d)?.get(hash) || 0),
  }))
  if (legendGroup.value.hasOther) {
    const topSet = new Set(legendGroup.value.top)
    list.push({
      name: '其他 KEY',
      color: OTHER_COLOR,
      calls: dateList.value.map(d => {
        const inner = callMap.value.get(d)
        if (!inner) return 0
        let sum = 0
        for (const [hash, calls] of inner) if (!topSet.has(hash)) sum += calls
        return sum
      }),
    })
  }
  return list
})

const hasAnyCalls = computed(() => chartSeries.value.some(s => s.calls.some(v => v > 0)))
const rangeTotal = computed(() => dailyRows.value.reduce((s, r) => s + (Number(r.calls) || 0), 0))
const todayCalls = computed(() => {
  const inner = callMap.value.get(utcToday())
  if (!inner) return 0
  let sum = 0
  for (const v of inner.values()) sum += v
  return sum
})

// ============ 图表渲染（ECharts） ============
const chartEl = ref<HTMLElement | null>(null)
let chart: ReturnType<typeof echarts.init> | null = null
let resizeObserver: ResizeObserver | null = null

function renderChart() {
  if (!chartEl.value) return
  if (!chart) {
    chart = echarts.init(chartEl.value)
    // 点柱子 → 切换到该 UTC 日并拉明细
    chart.on('click', (params) => {
      const date = dateList.value[(params as { dataIndex: number }).dataIndex]
      if (date) selectDate(date)
    })
  }
  const dates = dateList.value
  chart.setOption(
    {
      animationDuration: 300,
      color: chartSeries.value.map(s => s.color),
      grid: { left: 4, right: 12, top: 34, bottom: 4, containLabel: true },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: unknown) => {
          const list = (Array.isArray(params) ? params : [params]) as Array<{
            dataIndex: number
            seriesName: string
            value: number
            marker: string
          }>
          if (!list.length) return ''
          const total = list.reduce((s, p) => s + (Number(p.value) || 0), 0)
          const rows = list
            .map(p => `${p.marker}${p.seriesName}：${(Number(p.value) || 0).toLocaleString()} 次`)
            .join('<br/>')
          return `<div style="font-size:12px;line-height:1.6"><b>${dates[list[0].dataIndex]}（UTC）</b><br/>${rows}<br/>合计：<b>${total.toLocaleString()}</b> 次</div>`
        },
      },
      legend: {
        top: 0,
        type: 'scroll',
        icon: 'roundRect',
        itemWidth: 10,
        itemHeight: 10,
        textStyle: { fontSize: 11, color: '#6b7280' },
      },
      xAxis: {
        type: 'category',
        data: dates.map(d => d.slice(5)),
        axisTick: { show: false },
        axisLine: { lineStyle: { color: '#e5e7eb' } },
        axisLabel: { fontSize: 10, color: '#9ca3af' },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: '#f1f5f9' } },
        axisLabel: {
          fontSize: 10,
          color: '#9ca3af',
          formatter: (v: number) => (v >= 10000 ? `${v / 10000}万` : String(v)),
        },
      },
      series: chartSeries.value.map(s => ({
        name: s.name,
        type: 'bar' as const,
        stack: 'total',
        barMaxWidth: 32,
        emphasis: { focus: 'series' as const },
        data: s.calls,
      })),
    },
    // notMerge：KEY 数量变化时清掉上一轮残留的系列
    true,
  )
}

/** 数据变化后重绘；容器隐藏（空态）时跳过，等显示后由 ResizeObserver 补一次 */
function scheduleRender() {
  if (!hasAnyCalls.value) return
  nextTick(() => {
    renderChart()
    chart?.resize()
  })
}

watch([chartSeries, dateList], scheduleRender)

// ============ 明细分组（选中 UTC 日） ============
const groups = computed<KeyGroup[]>(() => {
  const byKey = new Map<string, KeyGroup>()
  for (const r of detailRows.value) {
    const k = keyMap.value.get(r.key_hash)
    let g = byKey.get(r.key_hash)
    if (!g) {
      g = {
        keyHash: r.key_hash,
        name: keyName(r.key_hash),
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

const detailTotal = computed(() => groups.value.reduce((s, g) => s + g.totalCalls, 0))

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

// ============ 加载 ============
async function loadChart() {
  loadingChart.value = true
  try {
    // 并行：KEY 列表（供 hash → 名称映射）+ 逐日用量
    const [keys, daily] = await Promise.all([
      adminApi.getAll<ApiKey>('api_keys', { order: 'created_at', ascending: false }),
      adminApi.queryApiUsageDaily(range.value[0], range.value[1]),
    ])
    apiKeys.value = keys
    dailyRows.value = daily
  } catch (e: any) {
    ElMessage.error('加载失败：' + (e?.message || e))
  } finally {
    loadingChart.value = false
  }
}

async function loadDetail() {
  loadingDetail.value = true
  try {
    detailRows.value = await adminApi.queryApiUsageDetail(selectedDate.value)
    // 默认折叠；只有一组时自动展开，省一次点击
    openKeys.value = groups.value.length === 1 ? [groups.value[0].keyHash] : []
  } catch (e: any) {
    ElMessage.error('明细加载失败：' + (e?.message || e))
  } finally {
    loadingDetail.value = false
  }
}

async function refreshAll() {
  await loadChart()
  await loadDetail()
}

onMounted(async () => {
  await refreshAll()
  await nextTick()
  if (chartEl.value) {
    // 侧边栏折叠、窗口缩放都会改变容器宽度，交给 ResizeObserver 兜底
    resizeObserver = new ResizeObserver(() => chart?.resize())
    resizeObserver.observe(chartEl.value)
  }
  scheduleRender()
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
  chart?.dispose()
  chart = null
})

/** 点柱子：切换到该 UTC 日并重新拉明细 */
function selectDate(date: string) {
  if (selectedDate.value === date) return
  selectedDate.value = date
  loadDetail()
}

/** 快捷范围：n 个 UTC 自然日（含今天） */
function quickRange(n: number) {
  const end = utcToday()
  range.value = [addDays(end, -(n - 1)), end]
  selectedDate.value = end
  refreshAll()
}

/** 日期选择器只允许选今天及以前（未来没有数据） */
function isFutureDate(d: Date) {
  return d.getTime() > Date.now()
}

/**
 * 范围变更：修正非法输入（倒序、超 30 天、选到未来），
 * 并保证选中日落在新范围内，避免图表高亮和明细表对不上。
 */
function handleRangeChange(v: unknown) {
  const arr = Array.isArray(v) ? (v as string[]) : []
  if (arr.length !== 2 || !arr[0] || !arr[1]) {
    range.value = [addDays(utcToday(), -6), utcToday()]
    refreshAll()
    return
  }
  let [start, end] = arr
  if (start > end) [start, end] = [end, start]
  const today = utcToday()
  if (end > today) end = today
  if (start > end) start = end
  if (daySpan(start, end) > MAX_DAYS) {
    start = addDays(end, -(MAX_DAYS - 1))
    ElMessage.warning(`统计范围最多 ${MAX_DAYS} 天（Analytics Engine 免费版保留上限）`)
  }
  range.value = [start, end]
  if (selectedDate.value < start || selectedDate.value > end) selectedDate.value = end
  refreshAll()
}

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
  banForm.reason = `${selectedDate.value}（UTC）单 IP ${row.calls.toLocaleString()} 次调用`
  banForm.duration = '7d'
  showBanDialog.value = true
}

/** 到期时间换算：返回 ISO 字符串；forever 返回 null（永久封禁） */
function expiresAt(duration: string): string | null {
  if (duration === 'forever') return null
  const map: Record<string, number> = { '1d': 1, '7d': 7, '30d': 30 }
  const addDaysN = map[duration]
  if (!addDaysN) return null
  return new Date(Date.now() + addDaysN * 24 * 60 * 60 * 1000).toISOString()
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
    // 通知 Worker 清缓存，使封禁立即生效（失败则等 1h TTL 兜底）
    await adminApi.refreshIpCache().catch(() => {
      ElMessage.warning('封禁成功，但缓存刷新失败，最长 1 小时后生效')
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
