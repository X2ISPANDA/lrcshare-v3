<template>
  <div class="space-y-4">
    <el-tabs v-model="tab" @tab-change="page = 1">
      <el-tab-pane v-for="t in tabs" :key="t.key" :name="t.key">
        <template #label>
          {{ t.label }}
          <el-badge v-if="t.key === 'pending' && counts.pending" :value="counts.pending" class="ml-1" />
        </template>
      </el-tab-pane>
    </el-tabs>

    <div class="bg-white rounded-xl border border-gray-100 shadow-sm">
      <div class="flex justify-between items-center px-5 py-3">
        <span class="text-sm text-gray-500">共 {{ displayCount }} 条歌曲分享（点行首箭头展开试播与详情）</span>
        <el-button size="small" type="primary" plain @click="openCreate">＋ 手动添加</el-button>
      </div>

      <AdminTable :data="pagedList" :loading="loading" row-key="id">
        <!-- 展开行：官方组件试播 + 完整投稿信息（专辑类播放器较高，默认折叠） -->
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="px-6 py-4 bg-gray-50/60 space-y-3">
              <!-- 网易云：点按钮实时换取站内音频直链（不自动取，避免审核列表展开即大量请求） -->
              <div v-if="row.platform === 'netease'" class="max-w-2xl">
                <audio v-if="rowStreams[row.id]" :src="rowStreams[row.id]" controls class="w-full h-10"></audio>
                <el-button v-else size="small" :loading="rowLoadingId === row.id" @click="loadRowStream(row as MusicShare)">
                  🔊 获取网易云试播放地址（专辑取第一首）
                </el-button>
              </div>
              <!-- YouTube / SoundCloud：官方嵌入组件试播（iframe 级 referrer 策略修复 YT 153） -->
              <div
                v-else
                class="rounded-lg overflow-hidden bg-black/5 border border-gray-200 max-w-2xl"
                :style="musicEmbedFrameStyle(row.platform, row.media_type)"
              >
                <iframe
                  :src="embedSrcOf(row as MusicShare)"
                  class="w-full h-full border-0"
                  :allow="platformAllow(row.platform)"
                  referrerpolicy="strict-origin-when-cross-origin"
                ></iframe>
              </div>
              <!-- 专辑曲目快照清单 -->
              <div v-if="row.media_type === 'album'" class="max-w-2xl">
                <div class="text-xs font-medium text-gray-500 mb-1">专辑曲目快照（{{ (row.tracks as MusicTrack[] | null | undefined)?.length || 0 }} 首）</div>
                <ol v-if="(row.tracks as MusicTrack[] | null | undefined)?.length" class="rounded-lg border border-gray-200 bg-white divide-y divide-gray-50 text-[13px] text-gray-600 max-h-40 overflow-auto">
                  <li v-for="(t, i) in (row.tracks as MusicTrack[])" :key="t.id" class="flex items-center gap-2 px-3 py-1">
                    <span class="w-6 text-right text-gray-400 flex-none">{{ i + 1 }}.</span>
                    <span class="flex-1 truncate">{{ t.title || `曲目 ${i + 1}` }}</span>
                    <span v-if="t.artist" class="text-xs text-gray-400 truncate flex-none">{{ t.artist }}</span>
                  </li>
                </ol>
                <div v-else class="text-xs text-red-400">缺少曲目快照，前台无法连播（需编辑修复或拒绝）</div>
              </div>
              <div class="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 text-sm max-w-4xl">
                <div class="text-gray-600"><span class="text-gray-400">原始链接：</span>
                  <a :href="row.source_url" target="_blank" rel="noopener noreferrer" class="text-pink-600 hover:underline break-all">{{ row.source_url }}</a>
                </div>
                <div class="text-gray-600"><span class="text-gray-400">平台 ID：</span><span class="break-all">{{ row.platform_id }}</span></div>
                <div class="text-gray-600"><span class="text-gray-400">提交人：</span>{{ row.submitter_name }}</div>
                <div class="text-gray-600"><span class="text-gray-400">邮箱：</span>{{ row.user_email || '—' }}</div>
                <div class="text-gray-600 md:col-span-2">
                  <span class="text-gray-400">联系方式：</span>
                  <template v-if="contactEntries(row).length">
                    <span v-for="c in contactEntries(row)" :key="c.k" class="mr-4">{{ contactLabel(c.k) }}：{{ c.v }}</span>
                  </template>
                  <span v-else>—</span>
                </div>
                <div class="text-gray-600 md:col-span-2"><span class="text-gray-400">推荐理由：</span>{{ row.reason || '—' }}</div>
                <div class="text-gray-600">
                  <el-tag v-if="row.is_own_work" type="warning" size="small">投稿人自荐原创</el-tag>
                  <el-tag v-if="row.contributor_id" type="info" size="small" class="ml-1">已关联：{{ row.contributor?.name || row.contributor_id }}</el-tag>
                </div>
              </div>
            </div>
          </template>
        </el-table-column>

        <el-table-column label="歌曲" min-width="220">
          <template #default="{ row }">
            <div class="flex items-center gap-2.5">
              <img :src="row.cover_url || LOGO_URL" class="w-9 h-9 rounded object-cover bg-gray-100 flex-none" />
              <div class="min-w-0">
                <div class="font-medium text-gray-800 truncate">{{ row.title }}</div>
                <div class="text-xs text-gray-400 truncate">{{ row.artist || '未知歌手' }}</div>
              </div>
            </div>
          </template>
        </el-table-column>
        <el-table-column label="平台" width="110">
          <template #default="{ row }">
            <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs text-white" :style="{ background: platformColor(row.platform) }">
              {{ musicPlatformLabel(row.platform) }}
            </span>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="70" align="center">
          <template #default="{ row }">
            <el-tag :type="row.media_type === 'album' ? 'warning' : 'success'" size="small">
              {{ row.media_type === 'album' ? '专辑' : '单曲' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="提交人" width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.submitter_name }}</template>
        </el-table-column>
        <el-table-column v-if="tab === 'approved'" label="置顶" width="60" align="center">
          <template #default="{ row }">{{ row.sort > 0 ? row.sort : '—' }}</template>
        </el-table-column>
        <el-table-column v-if="tab === 'approved'" label="首页推荐" width="150">
          <template #default="{ row }">
            <el-tag v-if="pinActive(row)" type="warning" size="small">推荐至 {{ formatPin(row.pinned_until) }}</el-tag>
            <span v-else-if="row.pinned_until" class="text-xs text-gray-400">已到期</span>
            <span v-else class="text-gray-300">—</span>
          </template>
        </el-table-column>
        <el-table-column v-if="tab !== 'pending'" label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="提交时间" width="165">
          <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150" align="center">
          <template #default="{ row }">
            <!-- 注意：不要用 <template v-else> 包裹条件按钮——el-table-column 注册阶段会以空
                 上下文预调插槽，v-else 片段内的 click 处理函数会被缓存成 row=undefined 的版本，
                 导致编辑/撤回/删除拿不到行数据（审核按钮在 v-if 分支不受影响）。平铺 v-if 即可 -->
            <el-button v-if="tab === 'pending'" link type="primary" size="small" @click="openReview(row)">审核</el-button>
            <el-button v-else link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button v-if="tab !== 'pending'" link type="warning" size="small" @click="recallRow(row)">撤回</el-button>
            <el-button link type="danger" size="small" @click="deleteRow(row)">删除</el-button>
          </template>
        </el-table-column>

        <!-- 移动端卡片（播放器在审核/编辑弹窗内，卡片只放信息与操作） -->
        <template #card="{ row }">
          <div class="flex items-start justify-between gap-2">
            <div class="flex items-center gap-2.5 min-w-0">
              <img :src="row.cover_url || LOGO_URL" class="w-10 h-10 rounded object-cover bg-gray-100 flex-none" />
              <div class="min-w-0">
                <div class="font-medium text-gray-800 truncate">{{ row.title }}</div>
                <div class="text-xs text-gray-400 truncate">{{ row.artist || '未知歌手' }} · {{ row.submitter_name }}</div>
                <div class="text-xs text-gray-400 mt-0.5">{{ formatTime(row.created_at) }}</div>
              </div>
            </div>
            <div class="flex flex-col items-end gap-1 flex-none">
              <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs text-white" :style="{ background: platformColor(row.platform) }">
                {{ musicPlatformLabel(row.platform) }}
              </span>
              <el-tag v-if="tab !== 'pending'" :type="statusTagType(row.status)" size="small">{{ statusText(row.status) }}</el-tag>
            </div>
          </div>
          <div class="mt-2 pt-2 border-t border-gray-50 flex flex-wrap gap-1">
            <el-button v-if="tab === 'pending'" link type="primary" size="small" @click="openReview(row)">审核</el-button>
            <el-button v-else link type="primary" size="small" @click="openEdit(row)">编辑</el-button>
            <el-button v-if="tab !== 'pending'" link type="warning" size="small" @click="recallRow(row)">撤回</el-button>
            <el-button link type="danger" size="small" @click="deleteRow(row)">删除</el-button>
          </div>
        </template>
      </AdminTable>

      <div class="flex justify-end items-center px-5 py-4 border-t border-gray-100">
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="[10, 20, 50]"
          :total="displayCount"
          layout="total, sizes, prev, pager, next"
          :pager-count="5"
          background
        />
      </div>
    </div>

    <!-- ============ 审核 / 编辑 / 手动添加 共用弹窗 ============ -->
    <el-dialog
      v-model="showDialog"
      :title="dialogTitle"
      width="820px"
      :close-on-click-modal="false"
      top="6vh"
    >
      <!-- 手动添加：平台 + 链接识别（审核/编辑模式平台信息只读） -->
      <template v-if="mode === 'create'">
        <div class="space-y-3 mb-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">平台</label>
            <el-select v-model="form.platform" style="width: 100%">
              <el-option v-for="p in MUSIC_PLATFORMS" :key="p.key" :label="p.label" :value="p.key">
                <span class="flex items-center gap-1.5">
                  <span class="inline-block w-2.5 h-2.5 rounded-full" :style="{ background: p.brandColor }"></span>
                  {{ p.label }}
                  <span class="text-xs text-gray-400">{{ p.accepts.includes('album') ? '单曲 / 专辑' : '单曲' }}</span>
                </span>
              </el-option>
            </el-select>
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 mb-1">歌曲 / 专辑链接</label>
            <el-input v-model="urlOrEmbed" clearable :placeholder="platform?.placeholder" />
            <div v-if="urlOrEmbed.trim()" class="mt-1 text-xs" :class="createInputValid ? 'text-green-600' : 'text-red-500'">
              {{ createInputValid ? '✔ 格式没问题' : `✘ ${platform?.invalidHint}` }}
            </div>
            <div class="mt-2 flex items-center gap-3">
              <el-button
                type="primary"
                size="small"
                :disabled="!createInputValid"
                :loading="resolving || enriching"
                @click="recognizeForCreate"
              >
                🔍 识别并试播
              </el-button>
              <el-radio-group v-model="form.media_type" size="small">
                <el-radio-button label="song">单曲</el-radio-button>
                <el-radio-button label="album">专辑</el-radio-button>
              </el-radio-group>
              <span v-if="resolveError" class="text-xs text-red-500">{{ resolveError }}</span>
            </div>
          </div>
        </div>
      </template>
      <template v-else>
        <div class="bg-gray-50 rounded-lg p-3 mb-3 text-sm text-gray-600 flex flex-wrap items-center gap-2">
          <span class="inline-flex items-center px-2 py-0.5 rounded-full text-xs text-white" :style="{ background: platformColor(form.platform) }">
            {{ musicPlatformLabel(form.platform) }}
          </span>
          <el-tag size="small" :type="form.media_type === 'album' ? 'warning' : 'success'">
            {{ form.media_type === 'album' ? '专辑' : '单曲' }}
          </el-tag>
          <a :href="form.source_url" target="_blank" rel="noopener noreferrer" class="text-pink-600 hover:underline break-all text-xs">{{ form.source_url }}</a>
        </div>
      </template>

      <!-- 试播：网易云实时换直链；YouTube / SoundCloud 走官方嵌入组件 -->
      <div v-if="form.platform_id" class="mb-4">
        <div class="text-sm font-medium text-gray-700 mb-1.5">▶ 试播</div>
        <div v-if="form.platform === 'netease'">
          <audio v-if="formStreamUrl" :src="formStreamUrl" controls class="w-full h-10"></audio>
          <el-button v-else size="small" :loading="formStreamLoading" @click="loadFormStream">
            🔊 获取网易云试播放地址（专辑取第一首）
          </el-button>
        </div>
        <div
          v-else-if="embedSrc"
          class="rounded-lg overflow-hidden bg-black/5 border border-gray-200"
          :style="musicEmbedFrameStyle(form.platform, form.media_type)"
        >
          <iframe
            :src="embedSrc"
            class="w-full h-full border-0"
            :allow="platformAllow(form.platform)"
            referrerpolicy="strict-origin-when-cross-origin"
          ></iframe>
        </div>
        <!-- 专辑曲目快照 -->
        <div v-if="form.media_type === 'album'" class="mt-2">
          <div class="text-xs font-medium text-gray-500 mb-1">专辑曲目快照（{{ form.tracks?.length || 0 }} 首）</div>
          <ol v-if="form.tracks?.length" class="rounded-lg border border-gray-200 bg-white divide-y divide-gray-50 text-[13px] text-gray-600 max-h-40 overflow-auto">
            <li v-for="(t, i) in form.tracks" :key="t.id" class="flex items-center gap-2 px-3 py-1">
              <span class="w-6 text-right text-gray-400 flex-none">{{ i + 1 }}.</span>
              <span class="flex-1 truncate">{{ t.title || `曲目 ${i + 1}` }}</span>
              <span v-if="t.artist" class="text-xs text-gray-400 truncate flex-none">{{ t.artist }}</span>
            </li>
          </ol>
          <div v-else class="text-xs text-red-400">缺少曲目快照，保存后前台无法专辑连播，请重新识别</div>
        </div>
      </div>

      <!-- 查重提示（打开弹窗时实时查；命中自身 id 的结果忽略） -->
      <el-alert
        v-if="dupWarn"
        :title="dupWarn"
        type="warning"
        :closable="false"
        show-icon
        class="mb-3"
      />

      <el-form label-position="top" class="music-share-form">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <el-form-item label="标题" required>
            <el-input v-model="form.title" placeholder="歌曲 / 专辑标题" />
          </el-form-item>
          <el-form-item label="歌手 / UP 主">
            <el-input v-model="form.artist" placeholder="歌手或创作者名称" />
          </el-form-item>
          <el-form-item label="封面 URL" class="md:col-span-2">
            <div class="flex gap-2 w-full">
              <el-input v-model="form.cover_url" placeholder="封面缺失时可手动补 URL，留空用站点默认图" />
              <img :src="form.cover_url || LOGO_URL" class="w-9 h-9 rounded object-cover bg-gray-100 flex-none border" />
            </div>
          </el-form-item>
        </div>

        <el-form-item label="推荐理由" required>
          <el-input v-model="form.reason" type="textarea" :rows="2" maxlength="200" show-word-limit placeholder="必填（1~200 字），会展示在首页音乐推荐" />
        </el-form-item>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
          <el-form-item
            :label="mode === 'create' ? '贡献者（分享者，默认站长；需记到他人名下再勾选修改）' : '关联贡献者（通过后展示为分享者）'"
            required
          >
            <!-- 与歌曲管理 SongFormDialog 同模式：默认锁定防误改，勾「修改贡献者」才放开 -->
            <div class="w-full flex items-center gap-2">
            <el-select
              v-model="form.contributor_id"
              filterable
              :disabled="!contributorUnlock"
              placeholder="勾选右侧「修改贡献者」选择账号"
              style="width: 100%"
              :reserve-keyword="false"
            >
              <!-- 全量不过滤任何标签（红线：歌曲分享账号也必须能在所有场景被选中） -->
              <el-option v-for="c in contributors" :key="c.id" :label="c.name" :value="c.id">
                <span class="flex items-center gap-2">
                  <img :src="c.avatar || LOGO_URL" class="w-5 h-5 rounded-full object-cover" />
                  {{ c.name }}
                  <span v-if="c.tags && c.tags.length" class="text-xs text-gray-400">{{ c.tags.slice(0, 2).join(' · ') }}</span>
                </span>
              </el-option>
              <el-option
                v-if="newContributorLabel"
                :key="'__new__'"
                :label="`新建贡献者：${newContributorLabel}`"
                :value="`__NEW__:${newContributorLabel}`"
              >
                <span class="text-blue-500 font-medium">➕ 新建贡献者「{{ newContributorLabel }}」（自动打「歌曲分享」标签）</span>
                </el-option>
            </el-select>
              <el-checkbox v-model="contributorUnlock" class="shrink-0">修改贡献者</el-checkbox>
            </div>
          </el-form-item>
          <el-form-item label="置顶权重（0 = 按通过时间倒序；>0 置顶，数字小在前）">
            <el-input-number v-model="form.sort" :min="0" :max="9999" controls-position="right" class="w-full" />
          </el-form-item>
        </div>

        <!-- 首页「新歌推荐」限时推荐位：留空=不推荐；到期自动失效回落随机，仅影响首页推荐卡位 -->
        <el-form-item>
          <template #label>
            首页新歌推荐置顶（可选 · 到期自动取消）
            <span class="ml-1 text-xs font-normal text-gray-400">设置后首页「音乐推荐」卡位固定推荐本歌，多条每 30 秒轮播</span>
          </template>
          <div class="w-full flex flex-wrap items-center gap-2">
            <el-date-picker
              v-model="form.pinnedUntil"
              type="datetime"
              placeholder="选择推荐到期时间（留空 = 不置顶）"
              format="YYYY-MM-DD HH:mm"
              clearable
              :shortcuts="pinShortcuts"
              :disabled-date="disablePastDates"
              class="!w-[320px]"
            />
            <el-button v-if="form.pinnedUntil" link type="info" size="small" @click="form.pinnedUntil = null">取消推荐</el-button>
            <span v-if="form.pinnedUntil" class="text-xs text-amber-600">
              将推荐至 {{ formatTime(form.pinnedUntil.toISOString()) }}
            </span>
          </div>
        </el-form-item>

        <el-form-item>
          <el-checkbox v-model="form.is_own_work">本条为投稿人本人原创作品（创作者卡片样式；请核实，冒认应取消勾选）</el-checkbox>
        </el-form-item>

        <!-- 投稿人留资：仅用户投稿（审核/编辑）存在，只读展示，拒绝邮件发往该邮箱。
             手动添加是站长代发，没有投稿人，不显示本区块；submitter_name 保存时自动取贡献者名 -->
        <div v-if="mode !== 'create'" class="bg-gray-50 border border-gray-100 rounded-lg p-3 mb-3 text-sm space-y-1">
          <div class="text-gray-700"><span class="text-gray-400">投稿人昵称：</span>{{ form.submitter_name || '—' }}</div>
          <div class="text-gray-700">
            <span class="text-gray-400">通知邮箱：</span>
            <template v-if="form.user_email">{{ form.user_email }}</template>
            <template v-else-if="resolveNotifyEmail()">{{ resolveNotifyEmail() }}<span class="text-xs text-gray-400">（投稿未留邮箱，回退用资料邮箱）</span></template>
            <template v-else>—（无邮箱，不发通知邮件）</template>
          </div>
          <div v-if="contactEntries(form).length" class="text-gray-700">
            <span class="text-gray-400">其他联系方式：</span>
            <span v-for="c in contactEntries(form)" :key="c.k" class="mr-3">{{ contactLabel(c.k) }}：{{ c.v }}</span>
          </div>
        </div>

        <el-form-item v-if="mode === 'review'" label="拒绝原因（点「拒绝」时必填，会随邮件通知投稿人）">
          <el-input v-model="form.reject_reason" type="textarea" :rows="2" placeholder="如：链接无法播放 / 是歌单 / 重复投稿" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="showDialog = false">取消</el-button>
        <el-button v-if="mode === 'review'" type="danger" plain :loading="saving" @click="doReject">❌ 拒绝并通知</el-button>
        <el-button v-if="mode === 'review'" type="success" :loading="saving" @click="doApprove">✅ 通过</el-button>
        <el-button v-else type="primary" :loading="saving" @click="doApprove">
          {{ mode === 'create' ? '保存（直接发布）' : '保存修改' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { adminApi } from '@/lib/adminApi'
import { api } from '@/lib/api'
import { LOGO_URL, OWNER_CONTRIBUTOR_ID, contactLabel } from '@/lib/constants'
import AdminTable from '@/components/admin/AdminTable.vue'
import { MUSIC_ONLY_TAG, normalizeTags } from '@/lib/contributorTags'
import { enrichAlbumTracks } from '@/lib/musicAlbumEnrich'
import type { Contributor, MusicShare, MusicShareDupHints, MusicShareStatus } from '@/lib/types'
import type { MusicMediaType, MusicPlatformKey, MusicResolveResult, MusicTrack } from '@/lib/musicPlatforms'
import {
  MUSIC_PLATFORMS,
  getMusicPlatform,
  musicEmbedFrameStyle,
  musicPlatformLabel,
} from '@/lib/musicPlatforms'

// ============ 列表 ============
const tabs: { key: MusicShareStatus | 'all'; label: string }[] = [
  { key: 'pending', label: '待审核' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '已拒绝' },
]
const tab = ref<MusicShareStatus | 'all'>('pending')
const list = ref<MusicShare[]>([])
const contributors = ref<Contributor[]>([])
const loading = ref(false)
const page = ref(1)
const pageSize = ref(10)

const counts = computed(() => ({
  pending: list.value.filter(s => s.status === 'pending').length,
}))
const displayList = computed(() => list.value.filter(s => s.status === tab.value))
const pagedList = computed(() =>
  displayList.value.slice((page.value - 1) * pageSize.value, page.value * pageSize.value),
)
const displayCount = computed(() => displayList.value.length)

async function load() {
  loading.value = true
  try {
    // 全量三态 + 贡献者池（数据量小，后台页不分服务端页）
    const [shares, contribs] = await Promise.all([
      adminApi.getAll<MusicShare>('music_shares', { order: 'created_at', ascending: false }),
      adminApi.getAll<Contributor>('contributors', { order: 'name' }),
    ])
    list.value = shares
    contributors.value = contribs
  } catch (e: any) {
    ElMessage.error('加载失败：' + e.message)
  } finally {
    loading.value = false
  }
}
onMounted(load)

// ============ 小工具 ============
const formatTime = (t: string | null) => (t ? new Date(t).toLocaleString('zh-CN') : '')
const statusTagType = (s: string): any => ({ pending: 'warning', approved: 'success', rejected: 'danger' }[s] || 'info')
const statusText = (s: string) => ({ pending: '待审核', approved: '已通过', rejected: '已拒绝' }[s] || s)

// ============ 首页推荐置顶（pinned_until）辅助 ============
/** 日期选择器快捷档：3 / 7 / 14 / 30 天后到期 */
const pinShortcuts = [
  { text: '3 天后', value: () => new Date(Date.now() + 3 * 86400000) },
  { text: '7 天后', value: () => new Date(Date.now() + 7 * 86400000) },
  { text: '14 天后', value: () => new Date(Date.now() + 14 * 86400000) },
  { text: '30 天后', value: () => new Date(Date.now() + 30 * 86400000) },
]
/** 禁止选今天之前的日期（时间部分由保存前校验兜底） */
const disablePastDates = (d: Date) => d.getTime() < Date.now() - 86400000
/** 该分享的首页推荐位是否仍在生效中 */
function pinActive(row: { pinned_until?: string | null }): boolean {
  return !!row.pinned_until && new Date(row.pinned_until).getTime() > Date.now()
}
/** 列表窄列短日期：MM/DD HH:mm */
function formatPin(t: string | null | undefined): string {
  if (!t) return ''
  const d = new Date(t)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}
function platformColor(key: string): string {
  return getMusicPlatform(key)?.brandColor || '#6b7280'
}
function platformAllow(key: string): string | undefined {
  return getMusicPlatform(key)?.iframeAllow
}

/** 行数据 → 官方嵌入地址（YouTube / SoundCloud；网易云无 iframe，返回空串） */
function embedSrcOf(row: Pick<MusicShare, 'platform' | 'media_type' | 'platform_id' | 'source_url'>): string {
  return getMusicPlatform(row.platform)?.buildEmbed?.(row, { autoplay: false }) || ''
}

// ============ 网易云试播直链（展开行 / 弹窗各自懒加载） ============
/** 展开行内已换取的直链：rowId → url */
const rowStreams = ref<Record<string, string>>({})
const rowLoadingId = ref('')
async function loadRowStream(row: MusicShare) {
  const trackId = row.media_type === 'album' && row.tracks?.length ? row.tracks[0].id : row.platform_id
  rowLoadingId.value = row.id
  try {
    rowStreams.value[row.id] = (await api.getMusicStreamUrl('netease', trackId)).url
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '播放地址获取失败')
  } finally {
    rowLoadingId.value = ''
  }
}
/** 弹窗内试播直链 */
const formStreamUrl = ref('')
const formStreamLoading = ref(false)
async function loadFormStream() {
  if (!form.platform_id) return
  const trackId = form.media_type === 'album' && form.tracks?.length ? form.tracks[0].id : form.platform_id
  formStreamLoading.value = true
  try {
    formStreamUrl.value = (await api.getMusicStreamUrl('netease', trackId)).url
  } catch (e) {
    ElMessage.error(e instanceof Error ? e.message : '播放地址获取失败')
  } finally {
    formStreamLoading.value = false
  }
}

/** submitter_contact(jsonb) → [k,v] 列表（兼容空值） */
function contactEntries(row: { submitter_contact?: Record<string, string> | null } | null | undefined) {
  const obj = row?.submitter_contact || {}
  // 映射成 { k, v } 对象数组，模板里按 c.k / c.v 渲染（:key 需要稳定字段名）
  // email 同属资料快照，但列表/弹窗都有独立的「邮箱」行，这里不重复展示
  return Object.entries(obj)
    .filter(([k, v]) => k !== 'email' && v != null && String(v).trim() !== '')
    .map(([k, v]) => ({ k, v }))
}

// ============ 弹窗表单（review / edit / create 共用） ============
type DialogMode = 'review' | 'edit' | 'create'
const mode = ref<DialogMode>('review')
const showDialog = ref(false)
const saving = ref(false)
const editingId = ref<string | null>(null)
const originalStatus = ref<MusicShareStatus>('pending')

/**
 * 贡献者下拉锁定状态（与歌曲管理 SongFormDialog 同模式）：
 * - create：默认锁定在站长 ct_owner；
 * - review：默认锁定在投稿人声明的账号（未绑定的全新投稿人预选「新建贡献者：昵称」）；
 * - edit：默认锁定在记录已绑定的账号；
 * 只有投稿人确实选错用户名时，管理员勾选「修改贡献者」才可改选。
 */
const contributorUnlock = ref(false)

const form = reactive({
  platform: 'netease' as MusicPlatformKey,
  media_type: 'song' as MusicMediaType,
  platform_id: '',
  source_url: '',
  title: '',
  artist: '',
  cover_url: '',
  /** 专辑曲目快照（单曲 null；手动识别专辑时抓取） */
  tracks: null as MusicTrack[] | null,
  reason: '',
  is_own_work: false,
  contributor_id: '' as string | null,
  sort: 0,
  /** 首页新歌推荐置顶截止时间（null=不置顶；el-date-picker 持有 Date 对象） */
  pinnedUntil: null as Date | null,
  reject_reason: '',
  submitter_name: '',
  user_email: '',
  submitter_contact: {} as Record<string, string>,
  /** 投稿人公开联系方式意愿：仅在「审核通过→新建贡献者」时静默写入 public_contact，弹窗不展示 */
  submitter_public_contact: false,
  /** 借歌曲投稿更新本人资料（审核弹窗零意愿元素，通过时静默四路处理） */
  submitter_request_update: false,
  /** 借歌曲投稿清空本人资料（与 update 互斥） */
  submitter_request_clear: false,
  /** 投稿人简介快照（新建/更新贡献者时写入 contributors.bio） */
  submitter_bio: '' as string | null,
})

const dialogTitle = computed(() =>
  mode.value === 'review' ? '歌曲分享审核' : mode.value === 'edit' ? '编辑已通过的分享' : '手动添加歌曲分享',
)
const platform = computed(() => getMusicPlatform(form.platform))

/** 弹窗内试播地址（YouTube / SoundCloud；网易云走音频直链按钮，恒为空串） */
const embedSrc = computed(() => {
  if (!form.platform_id || !form.source_url) return ''
  return getMusicPlatform(form.platform)?.buildEmbed?.(
    { media_type: form.media_type, platform_id: form.platform_id, source_url: form.source_url },
    { autoplay: false },
  ) || ''
})

/** 新建贡献者下拉项：优先用提交人昵称；已被占用（同名/同值）则不显示 */
const newContributorLabel = computed(() => {
  const raw = (form.submitter_name || '').trim()
  if (!raw) return ''
  if (form.contributor_id && !form.contributor_id.startsWith('__NEW__:')) return ''
  if (contributors.value.some(c => c.name === raw)) return ''
  return raw
})

function resetForm() {
  Object.assign(form, {
    platform: 'netease',
    media_type: 'song',
    platform_id: '',
    source_url: '',
    title: '',
    artist: '',
    cover_url: '',
    tracks: null,
    reason: '',
    is_own_work: false,
    contributor_id: null,
    sort: 0,
    pinnedUntil: null,
    reject_reason: '',
    submitter_name: '',
    user_email: '',
    submitter_contact: {},
    submitter_public_contact: false,
    submitter_request_update: false,
    submitter_request_clear: false,
    submitter_bio: '',
  })
  urlOrEmbed.value = ''
  resolvedCreate.value = null
  resolveError.value = ''
  dupWarn.value = ''
  formStreamUrl.value = ''
  editingId.value = null
  contributorUnlock.value = false
}

/**
 * 审核打开时贡献者下拉的默认值：
 * - 投稿时已绑定账号 → 该账号（绝大多数情况，直接通过即可）；
 * - 未绑定但昵称与已有贡献者同名 → 自动归并到同名账号；
 * - 未绑定且无同名 → 预选「新建贡献者：昵称」，保存通过时才真正建号。
 */
function resolveInitialContributorId(submitterName: string | null | undefined): string {
  const name = (submitterName || '').trim()
  if (!name) return ''
  const same = contributors.value.find(c => c.name === name)
  return same ? same.id : `__NEW__:${name}`
}

function fillFromRow(row: MusicShare) {
  Object.assign(form, {
    platform: row.platform,
    media_type: row.media_type,
    platform_id: row.platform_id,
    source_url: row.source_url,
    title: row.title || '',
    artist: row.artist || '',
    cover_url: row.cover_url || '',
    tracks: row.tracks || null,
    reason: row.reason || '',
    is_own_work: !!row.is_own_work,
    contributor_id: row.contributor_id || resolveInitialContributorId(row.submitter_name),
    sort: row.sort || 0,
    pinnedUntil: row.pinned_until ? new Date(row.pinned_until) : null,
    reject_reason: '',
    submitter_name: row.submitter_name || '',
    user_email: row.user_email || '',
    submitter_contact: { ...(row.submitter_contact || {}) },
    // 投稿人意愿随行回填（select * 自动带列）；审核弹窗不展示，仅供通过时静默四路处理
    submitter_public_contact: !!row.submitter_public_contact,
    submitter_request_update: !!row.submitter_request_update,
    submitter_request_clear: !!row.submitter_request_clear,
    submitter_bio: row.submitter_bio || '',
  })
}

// ============ 三种打开方式 ============
function openReview(row: MusicShare) {
  resetForm()
  mode.value = 'review'
  originalStatus.value = row.status
  editingId.value = row.id
  fillFromRow(row)
  showDialog.value = true
  refreshDupHints(row.id)
}

function openEdit(row: MusicShare) {
  resetForm()
  mode.value = 'edit'
  originalStatus.value = row.status
  editingId.value = row.id
  fillFromRow(row)
  showDialog.value = true
  refreshDupHints(row.id)
}

function openCreate() {
  resetForm()
  mode.value = 'create'
  originalStatus.value = 'approved'
  // 站长手动添加：分享者默认锁定为站长本人（与歌曲新增一致），需记到他人名下再勾选修改
  form.contributor_id = OWNER_CONTRIBUTOR_ID
  showDialog.value = true
}

// ============ 手动添加：识别 ============
const urlOrEmbed = ref('')
const resolving = ref(false)
/** 合辑曲目快照前端抓取中（YouTube 列表 / SoundCloud sets） */
const enriching = ref(false)
const resolveError = ref('')
const resolvedCreate = ref<MusicResolveResult | null>(null)

const createInputValid = computed(() => {
  const p = platform.value
  if (!p) return false
  const v = urlOrEmbed.value.trim()
  return !!v && p.inputPattern.test(v)
})

async function recognizeForCreate() {
  if (!platform.value || !createInputValid.value) return
  resolving.value = true
  resolveError.value = ''
  form.tracks = null
  formStreamUrl.value = ''
  try {
    const data = await api.resolveMusicShare(form.platform, urlOrEmbed.value.trim())
    resolvedCreate.value = data
    form.platform = data.platform
    form.media_type = data.media_type
    form.platform_id = data.platform_id
    form.source_url = data.source_url
    form.title = data.title || form.title
    form.artist = data.artist || form.artist
    form.cover_url = data.cover_url || form.cover_url
    // 专辑：网易云后端已给曲目；YouTube / SoundCloud 前端抓取快照
    if (data.media_type === 'album' && (!data.tracks || !data.tracks.length)) {
      enriching.value = true
      try {
        data.tracks = await enrichAlbumTracks(data)
      } catch (e) {
        resolveError.value = e instanceof Error ? e.message : '曲目清单抓取失败'
      } finally {
        enriching.value = false
      }
    }
    form.tracks = data.tracks || null
    refreshDupHints(null)
  } catch (e) {
    resolvedCreate.value = null
    resolveError.value = e instanceof Error ? e.message : '识别失败'
  } finally {
    resolving.value = false
  }
}

// ============ 查重提示（RPC 对 pending/approved 双层都查；命中自身时忽略） ============
const dupWarn = ref('')
async function refreshDupHints(selfId: string | null) {
  dupWarn.value = ''
  if (!form.platform_id || !form.title.trim()) return
  try {
    const hints: MusicShareDupHints = await api.getMusicShareDupHints({
      platform: form.platform,
      platform_id: form.platform_id,
      title: form.title.trim(),
      artist: form.artist.trim() || null,
    })
    if (hints.platform_approved && hints.platform_approved.id !== selfId) {
      dupWarn.value = `同平台链接已通过：《${hints.platform_approved.title}》（${hints.platform_approved.contributor_name}）`
      return
    }
    if (hints.song_approved && hints.song_approved.id !== selfId) {
      dupWarn.value = `同名歌曲已从${musicPlatformLabel(hints.song_approved.platform as MusicPlatformKey)}通过：《${hints.song_approved.title}》（${hints.song_approved.contributor_name}）`
      return
    }
    if (hints.platform_pending) dupWarn.value = '同平台链接已有一条待审核记录'
    else if (hints.song_pending) dupWarn.value = '同名同歌手已有一条待审核记录'
  } catch {
    // 查重失败不阻断（DB 唯一索引兜底）
  }
}

// ============ 保存：新建/确保贡献者 ============
/**
 * 解析弹窗里的贡献者选择：
 * - 真实 id：直接用；
 * - __NEW__:名字：重名再防御一次 → 创建只带「歌曲分享」单标签的贡献者。
 * 返回 { cid, created }；失败（重名等）返回 null。
 */
async function ensureContributor(): Promise<{ cid: string; created: boolean } | null> {
  const val = (form.contributor_id || '').trim()
  if (val && !val.startsWith('__NEW__:')) {
    if (!contributors.value.some(c => c.id === val)) {
      ElMessage.error('所选贡献者不存在，请重新选择')
      return null
    }
    return { cid: val, created: false }
  }
  const name = val.startsWith('__NEW__:') ? val.slice('__NEW__:'.length).trim() : newContributorLabel.value
  if (!name) {
    ElMessage.error('请选择或新建贡献者（已通过的分享必须有关联贡献者）')
    return null
  }
  if (contributors.value.some(c => c.name === name)) {
    ElMessage.error(`已存在同名贡献者「${name}」，请直接在下拉中选择该账号`)
    return null
  }
  const cid = crypto.randomUUID()
  await adminApi.insert<Contributor>('contributors', {
    id: cid,
    name,
    // 投稿带了简介就用投稿简介（邮箱已并入 submitter_contact），否则沿用兜底文案
    bio: (form.submitter_bio || '').trim() || '通过歌曲分享自动创建的贡献者',
    contact_value: { ...form.submitter_contact },
    // 审核通过：静默采用投稿人在投稿页的公开勾选；手动添加（无投稿人意愿）恒为 false，
    // 站长可在贡献者管理中调整。绑定已有贡献者的分支不走这里，不会覆盖其既有设置。
    public_contact: !!form.submitter_public_contact,
    public_bio: true,
    tags: [MUSIC_ONLY_TAG],
    is_owner: false,
    sort: 0,
  } as Partial<Contributor>)
  // 同步本地池（带全资料，供同会话连续审核与通知邮箱回退），避免重复创建
  contributors.value.push({
    id: cid,
    name,
    tags: [MUSIC_ONLY_TAG],
    bio: (form.submitter_bio || '').trim() || '通过歌曲分享自动创建的贡献者',
    contact_value: { ...form.submitter_contact },
    public_contact: !!form.submitter_public_contact,
  } as Contributor)
  return { cid, created: true }
}

/** 把 23505 唯一冲突翻译成友好提示 */
function isDuplicateError(e: unknown): boolean {
  return /duplicate key|23505/i.test(String((e as { message?: string })?.message || ''))
}

/**
 * 审核通过 / 已通过记录编辑保存后，幂等给贡献者补「歌曲分享」标签。
 * 背景：歌词投稿链新建账号会打「歌词提交」，但歌曲分享链此前只有「新建贡献者」
 * 时打了该标签，已有账号通过歌曲分享后标签缺失（个人主页 Hero 胶囊不显示）。
 * 只追加、不覆盖已有标签；失败不阻断审核主流程，提示人工补标即可。
 */
async function ensureMusicShareTag(cid: string) {
  try {
    const c = contributors.value.find(x => x.id === cid)
    const current = normalizeTags(c?.tags)
    if (current.includes(MUSIC_ONLY_TAG)) return
    const next = [...current, MUSIC_ONLY_TAG]
    await adminApi.update('contributors', cid, { tags: next })
    // 同步本地池，保证同会话下拉标签即时刷新
    if (c) c.tags = next
  } catch (e) {
    console.error('append 歌曲分享 tag failed', e)
    ElMessage.warning('分享已保存，但「歌曲分享」标签补写失败，可在贡献者管理里手动补')
  }
}

/**
 * 审核通过时对贡献者资料的静默四路处理（弹窗零意愿元素，与歌词后台同口径）：
 * - new：ensureContributor 已按快照新建（含 bio/contact/公开意愿），这里不再处理；
 * - clear：勾选清空 → 除 ID/昵称/标签外所有字段置空；
 * - update：勾选更新 → contact_value 全量覆盖、公开意愿覆盖，bio 非空时覆盖；
 * - none：纯引用身份，不动资料。
 * 仅 review 模式且关联的是已有账号（!created）时执行；edit/create 不消费历史意愿。
 * 返回实际执行的路径，失败抛错由调用方统一提示（资料写失败不回滚分享审核结果，仅提示人工处理）。
 */
async function applySubmitterProfileRequest(cid: string, created: boolean): Promise<'new' | 'none' | 'update' | 'clear'> {
  if (created) return 'new'
  if (form.submitter_request_clear) {
    await adminApi.update('contributors', cid, {
      avatar: null, bio: '', public_bio: true, contact_value: {}, public_contact: false, location: '', sort: 0,
    })
    // 本地池同步置空，保证紧接着的通知邮箱回退不会读到旧邮箱
    const c = contributors.value.find(x => x.id === cid)
    if (c) {
      c.contact_value = {}
      c.public_contact = false
      c.bio = ''
    }
    return 'clear'
  }
  if (form.submitter_request_update) {
    const patch: Record<string, unknown> = {
      contact_value: { ...form.submitter_contact },
      public_contact: !!form.submitter_public_contact,
    }
    const bio = (form.submitter_bio || '').trim()
    if (bio) patch.bio = bio
    await adminApi.update('contributors', cid, patch)
    // 本地池同步（通知邮箱回退 / 同会话连续审核取到新值）
    const c = contributors.value.find(x => x.id === cid)
    if (c) {
      c.contact_value = { ...form.submitter_contact }
      c.public_contact = !!form.submitter_public_contact
      if (bio) c.bio = bio
    }
    return 'update'
  }
  return 'none'
}

/**
 * 通知收件邮箱：优先投稿快照 user_email（旧投稿/纯引用身份可能为空），
 * 快照缺失时回退到贡献者资料 contact_value.email。
 * resolvedCid 传入审核通过刚解析出的账号（可能是本次新建，form.contributor_id 仍持 __NEW__ 占位）；
 * 拒绝时不传，按 form.contributor_id / 同名匹配自行解析。
 */
function resolveNotifyEmail(resolvedCid?: string): string {
  if ((form.user_email || '').trim()) return form.user_email.trim()
  let cid = (resolvedCid || '').trim()
  if (!cid) {
    const raw = (form.contributor_id || '').trim()
    if (raw && !raw.startsWith('__NEW__:')) {
      cid = raw
    } else {
      const name = raw.startsWith('__NEW__:') ? raw.slice('__NEW__:'.length) : form.submitter_name
      cid = contributors.value.find(c => c.name === (name || '').trim())?.id || ''
    }
  }
  const c = cid ? contributors.value.find(x => x.id === cid) : null
  const cv = (c?.contact_value || {}) as Record<string, string>
  return (cv['email'] || '').trim()
}

/** 收集审核邮件参数（无邮箱时服务端自动 skipped） */
function sendResultMail(action: 'approve' | 'reject', resolvedCid?: string) {
  adminApi
    .callMailServer('/api/mailer', {
      action,
      // 快照邮箱为空时回退贡献者资料邮箱（邮箱语义已并入 contact_value.email）
      to: resolveNotifyEmail(resolvedCid),
      user_name: form.submitter_name,
      song_title: form.title,
      ...(action === 'reject' ? { reject_reason: form.reject_reason } : {}),
    })
    .catch(e => {
      // 与歌词审核一致：邮件失败不阻塞审核结果，仅提示
      console.error('music share mail failed', e)
      ElMessage.warning('审核已保存，但通知邮件发送失败（可在发信日志查看）')
    })
}

// ============ 通过 / 保存 ============
async function doApprove() {
  // ---- 校验（防护不省略） ----
  if (mode.value === 'create' && (!form.platform_id || !form.source_url)) {
    ElMessage.warning('请先识别平台链接')
    return
  }
  // 专辑必须有曲目快照（前台靠它展开连播队列）；仅卡手动添加，审核/编辑历史记录不阻断（界面有红字提示）
  if (mode.value === 'create' && form.media_type === 'album' && !form.tracks?.length) {
    ElMessage.warning('专辑缺少曲目快照，请重新识别链接抓取曲目清单')
    return
  }
  if (!form.title.trim()) {
    ElMessage.warning('标题不能为空')
    return
  }
  if (form.title.trim().length > 200) {
    ElMessage.warning('标题最多 200 字')
    return
  }
  // 推荐理由数据库层已收紧 NOT NULL（1~200 字），所有保存路径统一卡校验
  if (!form.reason.trim()) {
    ElMessage.warning('推荐理由必填（1~200 字）')
    return
  }
  if (form.reason.trim().length > 200) {
    ElMessage.warning('推荐理由最多 200 字')
    return
  }
  // 置顶时间若已早于当前时刻没有任何展示效果（防手滑误设；取消推荐应直接清空日期）
  if (form.pinnedUntil && form.pinnedUntil.getTime() <= Date.now()) {
    ElMessage.warning('首页推荐到期时间已早于当前时刻：要么清空（不置顶），要么改到未来时间')
    return
  }
  if (saving.value) return
  saving.value = true
  try {
    const ensured = await ensureContributor()
    if (!ensured) return
    const { cid, created } = ensured

    // submitter_name（NOT NULL 列）：
    // - 手动添加是站长代发，没有独立投稿人，昵称由所选贡献者名派生；
    // - 审核/编辑沿用投稿当时的昵称快照。
    const submitterName = mode.value === 'create'
      ? (contributors.value.find(c => c.id === cid)?.name || '').trim()
      : form.submitter_name.trim()
    if (!submitterName) {
      ElMessage.warning(mode.value === 'create' ? '所选贡献者不存在，请重新选择' : '投稿人昵称为空，无法保存（原数据异常）')
      return
    }

    const now = new Date().toISOString()
    const fields = {
      title: form.title.trim(),
      artist: form.artist.trim() || null,
      cover_url: form.cover_url.trim() || null,
      reason: form.reason.trim(),
      is_own_work: !!form.is_own_work,
      contributor_id: cid,
      sort: Number(form.sort) || 0,
      // 首页新歌推荐置顶：ISO 时间或 null（清空=取消推荐，回落随机）
      pinned_until: form.pinnedUntil ? form.pinnedUntil.toISOString() : null,
    }

    if (mode.value === 'create') {
      await adminApi.insert('music_shares', {
        id: crypto.randomUUID(),
        platform: form.platform,
        media_type: form.media_type,
        platform_id: form.platform_id,
        source_url: form.source_url,
        // 站长代发：提交人=贡献者，无通知邮箱/联系方式（不触发审核邮件链路）
        submitter_name: submitterName,
        user_email: null,
        submitter_contact: {},
        // 手动添加不存在投稿人资料意愿，三列恒为默认值
        submitter_request_update: false,
        submitter_request_clear: false,
        submitter_bio: null,
        status: 'approved',
        reviewed_at: now,
        approved_at: now,
        reject_reason: null,
        created_at: now,
        // 专辑曲目快照（单曲 null）
        tracks: form.media_type === 'album' ? form.tracks : null,
        ...fields,
      })
      ElMessage.success('已添加并直接发布')
    } else if (mode.value === 'review') {
      // 条件更新：仅当前状态仍为原状态才生效，防重复点击/并发审核
      const updated = await adminApi.update(
        'music_shares',
        editingId.value!,
        { status: 'approved', reviewed_at: now, approved_at: now, reject_reason: null, ...fields },
        { filters: { status: originalStatus.value } },
      )
      if (!updated) {
        ElMessage.warning('该分享已被处理过，已自动刷新')
        await load()
        showDialog.value = false
        return
      }
      // 四路静默处理贡献者资料（new/none/update/clear）；失败仅提示，不回滚审核结果
      try {
        await applySubmitterProfileRequest(cid, created)
      } catch (e) {
        console.error('apply submitter profile request failed', e)
        ElMessage.warning('分享已通过，但贡献者资料更新/清空失败，请在贡献者管理中手动处理')
      }
      sendResultMail('approve', cid)
      ElMessage.success('已通过')
    } else {
      // edit：已通过记录的信息修正（不改时间/状态）
      const updated = await adminApi.update(
        'music_shares',
        editingId.value!,
        fields,
        { filters: { status: 'approved' } },
      )
      if (!updated) {
        ElMessage.warning('保存失败：记录状态已变化，已自动刷新')
        await load()
      } else {
        ElMessage.success('修改已保存')
      }
    }
    // 保存成功（新建/审核通过/编辑）后幂等补「歌曲分享」标签：
    // 新建的账号创建时已带标（函数内自动跳过），已有账号在这里追加
    await ensureMusicShareTag(cid)
    showDialog.value = false
    await load()
  } catch (e: any) {
    console.error('approve music share failed', e)
    ElMessage.error(isDuplicateError(e) ? '与已通过的分享重复（同平台链接或同名同歌手），请改用编辑或拒绝' : '保存失败：' + e.message)
  } finally {
    saving.value = false
  }
}

// ============ 拒绝 ============
async function doReject() {
  if (!form.reject_reason.trim()) {
    ElMessage.warning('请填写拒绝原因（会随邮件通知投稿人）')
    return
  }
  if (saving.value || !editingId.value) return
  saving.value = true
  try {
    const now = new Date().toISOString()
    const updated = await adminApi.update(
      'music_shares',
      editingId.value,
      { status: 'rejected', reject_reason: form.reject_reason.trim(), reviewed_at: now },
      { filters: { status: 'pending' } },
    )
    if (!updated) {
      ElMessage.warning('该分享已被处理过，已自动刷新')
      await load()
      showDialog.value = false
      return
    }
    sendResultMail('reject')
    ElMessage.success('已拒绝')
    showDialog.value = false
    await load()
  } catch (e: any) {
    ElMessage.error('操作失败：' + e.message)
  } finally {
    saving.value = false
  }
}

// ============ 撤回（approved/rejected → pending） ============
async function recallRow(row: MusicShare) {
  try {
    await ElMessageBox.confirm(`将《${row.title}》撤回为待审核？前台会立即隐藏。`, '撤回确认', {
      type: 'warning',
      confirmButtonText: '撤回',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await adminApi.update(
      'music_shares',
      row.id,
      { status: 'pending', reject_reason: null, reviewed_at: null, approved_at: null },
      { filters: { status: row.status } },
    )
    ElMessage.success('已撤回为待审核')
    await load()
  } catch (e: any) {
    ElMessage.error('撤回失败：' + e.message)
  }
}

// ============ 删除 ============
async function deleteRow(row: MusicShare) {
  try {
    await ElMessageBox.confirm(`确定删除《${row.title}》？该操作不可恢复。`, '删除确认', {
      type: 'error',
      confirmButtonText: '删除',
      cancelButtonText: '取消',
    })
  } catch {
    return
  }
  try {
    await adminApi.remove('music_shares', row.id)
    ElMessage.success('已删除')
    await load()
  } catch (e: any) {
    ElMessage.error('删除失败：' + e.message)
  }
}
</script>
