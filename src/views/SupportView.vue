<template>
  <main class="max-w-5xl mx-auto px-4 py-8">
    <!-- 标题 + 充电按钮 -->
    <div class="bg-white rounded-2xl shadow-sm p-8 mb-6 relative reward">
      <div class="text-sm text-pink-500 mb-2">致谢</div>
      <h1 class="text-3xl font-bold text-gray-800 mb-2">赞助名单</h1>
      <p class="text-gray-500">没有你们就没有LrcShare的今天！</p>

      <div class="about-reward">
        <div class="con">
          <div class="ta-con" @click="showReward = true">
            <div class="text-con">
              <div class="linght"></div>
              <div class="ta">点击赞助</div>
            </div>
          </div>
          <div class="tube-con">
            <svg viewBox="0 0 1028 385" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1 77H234.226L307.006 24H790" stroke="#e5e9ef" stroke-width="20" />
              <path d="M0 140H233.035L329.72 71H1028" stroke="#e5e9ef" stroke-width="20" />
              <path d="M1 255H234.226L307.006 307H790" stroke="#e5e9ef" stroke-width="20" />
              <path d="M0 305H233.035L329.72 375H1028" stroke="#e5e9ef" stroke-width="20" />
              <rect y="186" width="236" height="24" fill="#e5e9ef" />
              <ellipse cx="790" cy="25.5" rx="25" ry="25.5" fill="#e5e9ef" />
              <circle r="14" transform="matrix(1 0 0 -1 790 25)" fill="white" />
              <ellipse cx="790" cy="307.5" rx="25" ry="25.5" fill="#e5e9ef" />
              <circle r="14" transform="matrix(1 0 0 -1 790 308)" fill="white" />
            </svg>
            <div class="mask">
              <svg viewBox="0 0 1028 385" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 77H234.226L307.006 24H790" stroke="#f25d8e" stroke-width="20" />
                <path d="M0 140H233.035L329.72 71H1028" stroke="#f25d8e" stroke-width="20" />
                <path d="M1 255H234.226L307.006 307H790" stroke="#f25d8e" stroke-width="20" />
                <path d="M0 305H233.035L329.72 375H1028" stroke="#f25d8e" stroke-width="20" />
                <rect y="186" width="236" height="24" fill="#f25d8e" />
                <ellipse cx="790" cy="25.5" rx="25" ry="25.5" fill="#f25d8e" />
                <circle r="14" transform="matrix(1 0 0 -1 790 25)" fill="white" />
                <ellipse cx="790" cy="307.5" rx="25" ry="25.5" fill="#f25d8e" />
                <circle r="14" transform="matrix(1 0 0 -1 790 308)" fill="white" />
              </svg>
            </div>
            <div class="orange-mask">
              <svg viewBox="0 0 1028 385" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M1 77H234.226L307.006 24H790" stroke="#ffd52b" stroke-width="20" />
                <path d="M0 140H233.035L329.72 71H1028" stroke="#ffd52b" stroke-width="20" />
                <path d="M1 255H234.226L307.006 307H790" stroke="#ffd52b" stroke-width="20" />
                <path d="M0 305H233.035L329.72 375H1028" stroke="#ffd52b" stroke-width="20" />
                <rect y="186" width="236" height="24" fill="#ffd52b" />
                <ellipse cx="790" cy="25.5" rx="25" ry="25.5" fill="#ffd52b" />
                <circle r="14" transform="matrix(1 0 0 -1 790 25)" fill="white" />
                <ellipse cx="790" cy="307.5" rx="25" ry="25.5" fill="#ffd52b" />
                <circle r="14" transform="matrix(1 0 0 -1 790 308)" fill="white" />
              </svg>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 统计区 -->
    <div v-if="sponsors?.length" class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
      <div class="bg-white rounded-2xl shadow-sm p-6 text-center">
        <div class="text-3xl font-bold text-pink-500">{{ sponsors.length }}</div>
        <div class="text-gray-500 mt-1">赞助人数</div>
      </div>
      <div class="bg-white rounded-2xl shadow-sm p-6 text-center">
        <div class="gradient-text">{{ totalAmount.toFixed(2) }}</div>
        <div class="text-gray-500 mt-1">赞助总额（元）</div>
      </div>
      <div class="bg-white rounded-2xl shadow-sm p-6 text-center">
        <div class="text-3xl font-bold text-purple-500">{{ latestDate }}</div>
        <div class="text-gray-500 mt-1">最新赞助日期</div>
      </div>
    </div>

    <!-- 赞助名单 -->
    <div class="bg-white rounded-2xl shadow-sm p-6">
      <h2 class="text-lg font-bold text-gray-800 mb-2">💖 赞助者名单</h2>
      <div v-if="loading" class="w-full text-center py-8 text-gray-400">加载中...</div>
      <div v-else-if="!sponsors?.length" class="w-full text-center py-8 text-gray-400">暂无赞助记录</div>
      <div v-else class="reward-list-all">
        <div v-for="item in sponsors" :key="item.id" class="reward-list-item">
          <div class="reward-list-item-name">{{ item.name }}</div>
          <a
            v-if="item.url"
            :href="item.url"
            target="_blank"
            class="text-xs text-purple-500 hover:underline block mb-1"
          >{{ item.title }}：{{ item.descr }}</a>
          <div v-else-if="item.descr" class="text-xs text-purple-500 mb-1">{{ item.descr }}</div>
          <div class="reward-list-bottom-group">
            <span class="reward-list-item-money" :style="moneyStyle(parseFloat(item.amount))">
              ¥{{ item.amount }}{{ item.suffix || '' }}
            </span>
            <span class="reward-list-item-time">{{ formatDate(item.datatime) }}</span>
          </div>
        </div>
      </div>
      <div v-if="sponsors?.length" class="reward-list-updateDate">
        共有 <b>{{ sponsors.length }}</b> 位小伙伴投喂
        <span class="gradient-text">{{ totalAmount.toFixed(2) }}</span> 元
        最新投喂时间：{{ latestDate }}
      </div>
    </div>
  </main>

  <!-- 赞助二维码弹窗 -->
  <Teleport to="body">
    <div
      v-if="showReward"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      @click.self="showReward = false"
    >
      <div class="bg-white rounded-2xl p-6 max-w-md w-full mx-4">
        <div class="flex justify-between items-center mb-4">
          <h3 class="text-xl font-bold text-gray-800">赞助 LrcShare</h3>
          <button class="text-gray-400 hover:text-gray-600 text-2xl" @click="showReward = false">&times;</button>
        </div>
        <div class="text-center text-gray-500 mb-4">请扫描下方二维码进行赞助</div>
        <div class="flex justify-center gap-4">
          <div class="text-center">
            <div class="w-40 h-40 rounded-xl overflow-hidden mb-2 border border-gray-100">
              <img src="https://i0.hdslb.com/bfs/openplatform/954a7ef000973598f054011146df90b5c3f2a71f.jpg" referrerpolicy="no-referrer" class="w-full h-full object-cover" />
            </div>
            <div class="text-sm text-gray-600">微信赞助</div>
          </div>
          <div class="text-center">
            <div class="w-40 h-40 rounded-xl overflow-hidden mb-2 border border-gray-100">
              <img src="https://i0.hdslb.com/bfs/openplatform/a5de338082f11e2f2876bc7059cde436af978568.jpg" referrerpolicy="no-referrer" class="w-full h-full object-cover" />
            </div>
            <div class="text-sm text-gray-600">支付宝赞助</div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useHead } from '@unhead/vue'
import { api } from '@/lib/api'
import { useSSGData } from '@/composables/useSSGData'
import type { Sponsor } from '@/lib/types'

useHead({ title: '赞助名单 - LrcShare' })

const { data: sponsors, loading } = useSSGData<Sponsor[]>('support', () => api.getSponsors())

const showReward = ref(false)

const totalAmount = computed(() =>
  ((sponsors.value || []).reduce((sum, r) => sum + Math.round(parseFloat(r.amount) * 100), 0)) / 100,
)

const latestDate = computed(() => {
  const list = sponsors.value || []
  if (!list.length) return ''
  return new Date(Math.max(...list.map(r => new Date(r.datatime).getTime()))).toISOString().slice(0, 10)
})

function moneyStyle(amount: number): Record<string, string> {
  if (amount >= 50) return { background: '#ef4444' }
  if (amount >= 30) return { background: '#f59e0b' }
  if (amount >= 10) return { background: '#10b981' }
  return { background: '#6b7280' }
}

function formatDate(dateStr: string | null): string {
  return dateStr ? new Date(dateStr).toISOString().slice(0, 10) : ''
}
</script>

<style scoped>
/* 赞助列表卡片（迁移自 v2） */
.reward-list-all {
  display: flex;
  flex-wrap: wrap;
  flex-direction: row;
  margin-top: 1rem;
  margin-left: -0.25rem;
  margin-right: -0.25rem;
}
.reward-list-item {
  padding: 1rem;
  border-radius: 12px;
  border: 1px solid #e5e7eb;
  width: calc((100% / 3) - 0.5rem);
  margin: 0 0.25rem 0.5rem 0.25rem;
  box-shadow: 0 8px 16px -4px rgba(0, 0, 0, 0.05);
  background: #fff;
  transition: all 0.2s;
}
.reward-list-item:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 24px -4px rgba(0, 0, 0, 0.1);
}
.reward-list-item .reward-list-item-name {
  font-size: 1rem;
  font-weight: 700;
  line-height: 1;
  margin-bottom: 0.5rem;
}
.reward-list-item .reward-list-bottom-group {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.reward-list-item .reward-list-item-money {
  padding: 4px 8px;
  color: #fff;
  font-size: 12px;
  line-height: 1;
  border-radius: 4px;
  margin-right: 4px;
  white-space: nowrap;
  font-weight: 600;
}
.reward-list-item .reward-list-item-time {
  font-size: 12px;
  color: #9ca3af;
  white-space: nowrap;
}
.reward-list-updateDate {
  color: #6b7280;
  font-size: 14px;
  margin-top: 0.5rem;
}
.gradient-text {
  background: linear-gradient(to right, red, orange, #409eff, green, blue, indigo, violet);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  font-size: 20px;
  font-weight: 700;
}

/* 充电按钮（迁移自 v2） */
.about-reward { position: absolute; top: 1rem; right: 2rem; }
.reward .con { position: relative; width: 350px; height: 85px; border-radius: 4px; }
.reward .ta-con {
  position: absolute;
  top: 50%;
  left: 10%;
  width: 157px;
  height: 50px;
  border-radius: 4px;
  background-color: #f25d8e;
  box-shadow: 0 4px 4px rgba(255, 112, 159, 0.3);
  cursor: pointer;
  transform: translateY(-50%);
  transition: background-color 0.3s;
}
.reward .ta-con:hover { background-color: #ff6b9a; }
.reward .text-con { position: relative; margin: 0 auto; width: 100px; height: 100%; }
.reward .linght {
  position: absolute;
  top: 36%;
  left: 4px;
  width: 0;
  height: 0;
  border-color: transparent;
  border-style: solid;
  border-width: 10px;
  border-top: 10px solid #fff;
  border-radius: 4px;
  transform: rotate(-55deg);
}
.reward .linght::after {
  position: absolute;
  top: -13px;
  left: -11px;
  width: 0;
  height: 0;
  border-color: transparent;
  border-style: solid;
  border-width: 10px;
  border-top: 10px solid #fff;
  border-radius: 4px;
  content: "";
  transform: rotate(180deg);
}
.reward .ta { float: right; color: #fff; font-size: 15px; line-height: 50px; }
.reward .tube-con { position: absolute; top: 15px; right: -5px; width: 157px; height: 55px; }
.reward svg { width: 100%; height: 100%; }
.reward .mask { position: absolute; top: 0; left: 0; overflow: hidden; width: 0; height: 100%; transition: all 0.5s; }
.reward .mask svg { width: 157px; height: 55px; }
.reward .ta-con:hover + .tube-con > .mask { width: 157px; }
.reward .ta-con:hover + .tube-con > .orange-mask { animation: move1 0.5s linear 0.2s infinite; }
.reward .ta-con:hover + .tube-con > .orange-mask svg { animation: movetwo 0.5s linear 0.2s infinite; }
.reward .orange-mask { position: absolute; top: 0; left: -15px; overflow: hidden; width: 18px; height: 100%; }
.reward .orange-mask svg { position: absolute; top: 0; left: 15px; width: 157px; height: 55px; }
@keyframes move1 { 0% { left: -15px; } 100% { left: 140px; } }
@keyframes movetwo { 0% { left: 15px; } 100% { left: -140px; } }

@media screen and (max-width: 768px) {
  .reward-list-item { width: 100% !important; }
  .about-reward { position: relative; top: auto; right: auto; margin-top: 1rem; }
  .reward .con { width: 170px; }
  .reward .tube-con { display: none; }
}
</style>
