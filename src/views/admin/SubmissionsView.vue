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
        <span class="text-sm text-gray-500">共 {{ displayCount }} 条投稿（批量按批合并）</span>
        <div v-if="tab === 'pending'" class="flex gap-2">
          <el-button v-if="!selected.length" size="small" type="success" plain @click="openBatchReviewAll">批量审核全部待审核</el-button>
          <template v-else>
            <el-button size="small" type="success" plain @click="openBatchReview">批量审核 ({{ selected.length }})</el-button>
            <el-button size="small" type="danger" plain @click="batchReject">批量拒绝</el-button>
            <el-button size="small" type="danger" plain @click="batchDelete">批量删除</el-button>
          </template>
        </div>
      </div>

      <AdminTable :data="pagedDisplay" :loading="loading" row-key="__key" @selection-change="onSelectionChange">
        <el-table-column type="selection" width="45" />
        <el-table-column label="提交人" width="110" show-overflow-tooltip>
          <template #default="{ row }">{{ row.row.user_name }}</template>
        </el-table-column>
        <el-table-column label="歌曲名" min-width="160" show-overflow-tooltip>
          <template #default="{ row }">
            <template v-if="row.kind === 'batch'">
              <el-tag type="warning" size="small" class="mr-1">批量</el-tag>
              <span class="font-medium">{{ row.label }}</span>
            </template>
            <template v-else>
              <el-tag v-if="row.row.song_data?.type === 'profile'" type="warning" size="small">资料更新</el-tag>
              <template v-else>{{ row.row.song_data?.title || '—' }}</template>
            </template>
          </template>
        </el-table-column>
        <el-table-column label="歌手" width="130" show-overflow-tooltip>
          <template #default="{ row }">
            <span v-if="row.kind === 'batch' && row.rows">
              {{ [...new Set(row.rows.map((r: any) => artistNamesOf(r.song_data)).filter(Boolean))].join('、') || '—' }}
            </span>
            <span v-else>{{ artistNamesOf(row.row.song_data) || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column v-if="tab !== 'pending'" label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.row.status)" size="small">{{ statusText(row.row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column v-if="tab === 'rejected'" label="拒绝原因" min-width="140" show-overflow-tooltip>
          <template #default="{ row }">{{ row.row.reject_reason || '—' }}</template>
        </el-table-column>
        <el-table-column label="提交时间" width="165">
          <template #default="{ row }">{{ formatTime(row.row.created_at) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="110" align="center">
          <template #default="{ row }">
            <template v-if="tab === 'pending'">
              <el-button v-if="row.kind === 'batch'" link type="success" size="small" @click="openBatchReviewForBatch(row)">审核整批</el-button>
              <el-button v-else link type="primary" size="small" @click="openReview(row.row)">审核</el-button>
            </template>
            <template v-else>
              <el-button link type="danger" size="small" @click="recallRow(row)">
                {{ row.kind === 'batch' ? '撤回整批' : '撤回' }}
              </el-button>
            </template>
          </template>
        </el-table-column>

        <!-- 移动端卡片 -->
        <template #card="{ row }">
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="font-medium text-gray-800 truncate">
                <template v-if="row.kind === 'batch'">
                  <el-tag type="warning" size="small" class="mr-1">批量</el-tag>{{ row.label }}
                </template>
                <template v-else>
                  <el-tag v-if="row.row.song_data?.type === 'profile'" type="warning" size="small">资料更新</el-tag>
                  <template v-else>{{ row.row.song_data?.title || '—' }}</template>
                </template>
              </div>
              <div class="text-xs text-gray-400 truncate mt-0.5">{{ row.row.user_name }}<template v-if="artistNamesOf(row.row.song_data)"> · {{ artistNamesOf(row.row.song_data) }}</template></div>
              <div class="text-xs text-gray-400 mt-0.5">{{ formatTime(row.row.created_at) }}</div>
              <div v-if="tab === 'rejected' && row.row.reject_reason" class="text-xs text-red-400 mt-1 truncate">拒绝：{{ row.row.reject_reason }}</div>
            </div>
            <el-tag v-if="tab !== 'pending'" :type="statusTagType(row.row.status)" size="small" class="shrink-0">{{ statusText(row.row.status) }}</el-tag>
          </div>
          <div class="mt-2 pt-2 border-t border-gray-50">
            <el-button v-if="tab === 'pending' && row.kind === 'batch'" link type="success" size="small" @click="openBatchReviewForBatch(row)">审核整批</el-button>
            <el-button v-else-if="tab === 'pending'" link type="primary" size="small" @click="openReview(row.row)">审核</el-button>
            <el-button v-else link type="danger" size="small" @click="recallRow(row)">
              {{ row.kind === 'batch' ? '撤回整批' : '撤回' }}
            </el-button>
          </div>
        </template>
      </AdminTable>

      <div class="flex justify-between items-center px-5 py-4 border-t border-gray-100">
        <div class="flex gap-2">
          <el-button size="small" :disabled="!selected.length" plain @click="clearSelection">取消选择</el-button>
          <el-button size="small" type="danger" :disabled="!selected.length" @click="batchDelete">批量删除</el-button>
        </div>
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

    <!-- 审核弹窗 -->
    <el-dialog v-model="showReview" title="投稿审核" width="760px" :close-on-click-modal="false">
      <template v-if="review">
        <!-- 投稿人信息 -->
        <div class="bg-gray-50 rounded-lg p-3 mb-3 text-sm text-gray-600">
          <span class="font-medium text-gray-800">{{ review.user_name }}</span>
          <span class="mx-2 text-gray-300">|</span>
          <span>{{ formatTime(review.created_at) }}</span>
          <el-tag v-if="review.song_data?.type === 'profile'" size="small" class="ml-2" type="warning">资料更新</el-tag>
          <el-tag v-if="review.contributor_id" size="small" class="ml-2" type="info">已关联贡献者</el-tag>
          <el-tag v-if="review.submitter_request_update" size="small" class="ml-2" type="warning">请求更新资料</el-tag>
          <el-tag v-if="review.submitter_request_clear" size="small" class="ml-2" type="danger">请求清空资料</el-tag>
          <el-tag v-if="review.submitter_public_contact" size="small" class="ml-2" type="success">公开联系方式</el-tag>
        </div>

        <!-- 资料更新投稿：展示提交的新资料 -->
        <div v-if="isProfileReview" class="bg-blue-50 border border-blue-100 rounded-lg p-3 mb-3 space-y-1.5">
          <div class="text-sm font-medium text-gray-700 mb-1">👤 提交的新资料（通过后覆盖贡献者对应字段）</div>
          <div class="text-sm text-gray-600"><span class="text-gray-400">昵称：</span>{{ review.user_name }}</div>
          <div v-if="review.submitter_bio" class="text-sm text-gray-600"><span class="text-gray-400">简介：</span>{{ review.submitter_bio }}</div>
          <div class="text-sm text-gray-600">
            <span class="text-gray-400">联系方式：</span>
            <template v-if="contactEntries(review).length">
              <span v-for="c in contactEntries(review)" :key="c.k" class="mr-3 break-all">{{ contactLabel(c.k) }}：{{ c.v }}</span>
            </template>
            <span v-else class="text-gray-400">（未填，将清空联系方式）</span>
          </div>
          <div class="text-sm text-gray-600"><span class="text-gray-400">公开联系方式：</span>{{ review.submitter_public_contact ? '是' : '否' }}</div>
        </div>

        <!-- 歌词预览 -->
        <div v-if="!isProfileReview" class="bg-gray-50 rounded-lg p-3 mb-3">
          <div class="text-sm font-medium text-gray-700 mb-2">
            歌词预览{{ review.song_data?.ttml_text ? '（降级 LRC）' : '（原文）' }}
            <el-button v-if="review.song_data?.ttml_text" link size="small" class="ml-2" @click="ttmlPreview = !ttmlPreview">{{ ttmlPreview ? '查看 LRC' : '查看 TTML 源码' }}</el-button>
          </div>
          <pre v-if="!ttmlPreview" class="text-[13px] text-gray-600 whitespace-pre-wrap max-h-40 overflow-y-auto m-0">{{ review.song_data?.lrc_text }}</pre>
          <pre v-else class="text-[13px] text-gray-600 whitespace-pre-wrap max-h-40 overflow-y-auto m-0 font-mono">{{ review.song_data?.ttml_text }}</pre>
          <div v-if="review.song_data?.ttml_text" class="text-xs text-gray-400 mt-1">投稿为 TTML（含对唱/分屏/样式），发布时原文独立成版本落盘</div>
        </div>

        <!-- 审核修改表单：复用 SongFormDialog（review 模式：通过发布=回填数据走发布链路，不写库） -->
        <SongFormDialog
          v-if="!isProfileReview"
          v-model="showReviewForm"
          mode="review"
          title="审核修改"
          :artists="artists"
          :albums="albums"
          :contributors="[]"
          :hide-contributor="true"
          :initial="reviewInitial"
          @review-data="onReviewData"
          @reject="onReviewReject"
        />

        <!-- 同名歧义警示 -->
        <div v-if="!isProfileReview && ambiguousArtists.length" class="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg">
          <div class="text-sm font-semibold text-red-800 mb-1">⚠️ 同名歧义</div>
          <div class="text-xs text-red-700 mb-2">以下艺术家库内有多位同名，无法自动绑定。请删除其在各字段中的标签，从下拉中重新选择正确的一位（下拉带消歧标注）：</div>
          <div v-for="a in ambiguousArtists" :key="a.name" class="text-xs text-red-700 mb-1">
            · {{ a.name }} → 库内 {{ a.entries.length }} 位：{{ a.entries.join('、') }}
          </div>
        </div>
      </template>

      <template #footer>
        <el-button @click="showReview = false">取消</el-button>
        <template v-if="isProfileReview">
          <el-button type="danger" plain @click="reject(review)">❌ 拒绝</el-button>
          <el-button type="success" @click="approve(review)">✅ 通过并更新资料</el-button>
        </template>
        <template v-else>
          <el-button type="primary" @click="openReviewForm">📝 审核修改</el-button>
        </template>
      </template>
    </el-dialog>

    <!-- 专辑信息共用弹窗（保存即入库）：抽取为 AlbumInfoDialog，批量审核单行/歌曲管理/TTML Hub 同款复用 -->
    <AlbumInfoDialog
      v-model="showAlbumDialog"
      :artists="artists"
      :album-id="review?.edited_data?.album_id || null"
      :album-name="review?.edited_data?.album || ''"
      :album-artists="review?.edited_data?.album_artists"
      :cover="review?.edited_data?.album_cover"
      :year="review?.edited_data?.year"
      :description="review?.edited_data?.album_desc"
      @artist-saved="onArtistSaved"
      @saved="onAlbumSaved"
    />

    <!-- 批量审核单行专辑编辑（点行内专辑封面打开，与单曲审核同款弹窗） -->
    <AlbumInfoDialog
      v-model="showBatchAlbum"
      :artists="artists"
      :album-id="batchRows[batchAlbumRowIndex]?.sd?.album_id || null"
      :album-name="batchRows[batchAlbumRowIndex]?.sd?.album || ''"
      :album-artists="batchRows[batchAlbumRowIndex]?.sd?.album_artists"
      :cover="batchRows[batchAlbumRowIndex]?.sd?.album_cover"
      :year="batchRows[batchAlbumRowIndex]?.sd?.year"
      :description="batchRows[batchAlbumRowIndex]?.sd?.album_desc"
      @artist-saved="onArtistSaved"
      @saved="onBatchAlbumSaved"
    />

    <!-- 批量审核弹窗：Excel 式表格（行=投稿、列=字段），列头⚡统一填充（勾选行则仅填充勾选行），单元格直接改，底部一键全部发布 -->
    <el-dialog v-model="showBatchReview" title="批量审核" width="min(1500px, 94vw)" :close-on-click-modal="false" append-to-body>
      <div class="text-xs text-gray-400 mb-3 hidden md:block">
        行首勾选后，列头「⚡」只应用到勾选的行（不勾 = 全部行）；歌手/作词/作曲/编曲/专辑单元格可点击编辑该行；▶ 展开歌词。
        行状态「就绪」= 数据完整可提交；「待补 ID」= 有新建艺术家未填 ID（悬停看明细，点击徽标直达补全）；存在待补行时无法提交。移动端自动切卡片视图，能力一致。
      </div>
      <!-- 桌面：Excel 式表格（<768px 由下方卡片形态接管，同一份 batchRows 与编辑弹窗） -->
      <div class="hidden md:block">
      <el-table :data="batchRows" size="small" border max-height="60vh" row-key="row.id" @selection-change="batchSelected = $event">
        <el-table-column type="selection" width="40" fixed="left" />
        <el-table-column type="expand">
          <template #default="{ row }">
            <div class="px-6 py-3 space-y-3">
              <div class="text-xs text-gray-400">歌词（LRC 全文，可直接修改）<el-tag v-if="row.sd.ttml_text" size="small" type="warning" class="ml-1">TTML</el-tag><span v-if="row.sd.ttml_text" class="ml-1">投稿含 TTML 原文，发布时独立成版本落盘</span></div>
              <el-input v-model="row.sd.lrc_text" type="textarea" :autosize="{ minRows: 8, maxRows: 24 }" class="font-mono" />
              <div class="text-xs text-gray-400">多语言版本（{{ row.sd.versions?.length || 0 }} 个，留空发布时按 LRC 自动拆分）</div>
              <LyricVersionsEditor v-model="row.sd.versions" />
            </div>
          </template>
        </el-table-column>
        <el-table-column label="提交人" width="90" fixed="left" show-overflow-tooltip>
          <template #default="{ row }">{{ row.row.user_name }}</template>
        </el-table-column>
        <el-table-column width="170" fixed="left" label="歌曲名">
          <template #default="{ row }"><el-input v-model="row.sd.title" size="small" /></template>
        </el-table-column>
        <el-table-column min-width="140">
          <template #header>
            <div class="flex items-center gap-1">歌手<el-button link size="small" type="primary" @click="openFill('artists')">⚡</el-button></div>
          </template>
          <template #default="{ row, $index }">
            <el-button link size="small" :class="row.sd.artists.some((a: any) => !a.id) ? 'text-amber-600' : ''" @click="openFill('artists', $index)">
              <span class="inline-flex items-center gap-0.5 mr-0.5">
                <template v-for="a in row.sd.artists" :key="a.name">
                  <img v-if="artistAvatar(a.id)" :src="artistAvatar(a.id)" class="w-4 h-4 rounded-full object-cover" :title="a.name" />
                  <span v-else class="w-4 h-4 rounded-full bg-pink-300 text-white text-[8px] leading-none flex items-center justify-center" :title="a.name">{{ a.name?.charAt(0) }}</span>
                </template>
              </span>
              {{ row.sd.artists.map((a: any) => a.name).join('、') || '+ 设置' }}
              <el-tag v-if="row.sd.artists.some((a: any) => !a.id)" size="small" type="warning" class="ml-1">新建</el-tag>
            </el-button>
          </template>
        </el-table-column>
        <el-table-column min-width="110">
          <template #header>
            <div class="flex items-center gap-1">作词<el-button link size="small" type="primary" @click="openFill('lyricist_arr')">⚡</el-button></div>
          </template>
          <template #default="{ row, $index }">
            <el-button link size="small" @click="openFill('lyricist_arr', $index)">{{ row.sd.lyricist_arr.map((a: any) => a.name).join('、') || '+ 设置' }}<el-tag v-if="row.sd.lyricist_arr.some((a: any) => !a.id)" size="small" type="warning" class="ml-1">新建</el-tag></el-button>
          </template>
        </el-table-column>
        <el-table-column min-width="110">
          <template #header>
            <div class="flex items-center gap-1">作曲<el-button link size="small" type="primary" @click="openFill('composer_arr')">⚡</el-button></div>
          </template>
          <template #default="{ row, $index }">
            <el-button link size="small" @click="openFill('composer_arr', $index)">{{ row.sd.composer_arr.map((a: any) => a.name).join('、') || '+ 设置' }}<el-tag v-if="row.sd.composer_arr.some((a: any) => !a.id)" size="small" type="warning" class="ml-1">新建</el-tag></el-button>
          </template>
        </el-table-column>
        <el-table-column min-width="110">
          <template #header>
            <div class="flex items-center gap-1">编曲<el-button link size="small" type="primary" @click="openFill('arranger_arr')">⚡</el-button></div>
          </template>
          <template #default="{ row, $index }">
            <el-button link size="small" @click="openFill('arranger_arr', $index)">{{ row.sd.arranger_arr.map((a: any) => a.name).join('、') || '+ 设置' }}<el-tag v-if="row.sd.arranger_arr.some((a: any) => !a.id)" size="small" type="warning" class="ml-1">新建</el-tag></el-button>
          </template>
        </el-table-column>
        <el-table-column min-width="130">
          <template #header>
            <div class="flex items-center gap-1">专辑<el-button link size="small" type="primary" @click="openFill('album')">⚡</el-button></div>
          </template>
          <template #default="{ row, $index }">
            <el-button link size="small" @click="openFill('album', $index)">
              <span class="inline-flex items-center gap-0.5 mr-0.5">
                <img v-if="albumCoverOf(row.sd)" :src="albumCoverOf(row.sd)" class="w-4 h-4 rounded object-cover" :title="row.sd.album" />
                <span v-else class="w-4 h-4 rounded bg-gray-300 text-white text-[8px] leading-none flex items-center justify-center" :title="row.sd.album">💿</span>
              </span>
              {{ row.sd.album || '+ 设置' }}
              <el-tag v-if="row.sd.album && row.sd.album_id" size="small" type="success" class="ml-1">已关联</el-tag>
              <el-tag v-else-if="row.sd.album" size="small" type="warning" class="ml-1">新建</el-tag>
            </el-button>
          </template>
        </el-table-column>
        <el-table-column width="70">
          <template #header>
            <div class="flex items-center gap-1">曲目<el-button link size="small" type="primary" @click="openFill('track')">⚡</el-button></div>
          </template>
          <template #default="{ row }"><el-input v-model="row.sd.track" size="small" /></template>
        </el-table-column>
        <el-table-column width="80" label="时长">
          <template #default="{ row }"><el-input v-model="row.sd.duration" size="small" placeholder="03:30" /></template>
        </el-table-column>
        <el-table-column min-width="140">
          <template #header>
            <div class="flex items-center gap-1">单曲封面<el-button link size="small" type="primary" @click="openFill('cover')">⚡</el-button></div>
          </template>
          <template #default="{ row }">
            <div class="flex items-center gap-1.5">
              <img
                v-if="row.sd.cover"
                :src="row.sd.cover"
                class="w-10 h-10 rounded object-cover cursor-pointer border border-gray-200 flex-shrink-0"
                @click="ui.openPreview([row.sd.cover])"
              />
              <el-input v-model="row.sd.cover" size="small" placeholder="图片 URL，不填用专辑封面" />
            </div>
          </template>
        </el-table-column>
        <el-table-column min-width="110" show-overflow-tooltip>
          <template #header>
            <div class="flex items-center gap-1">风格<el-button link size="small" type="primary" @click="openFill('genres')">⚡</el-button></div>
          </template>
          <template #default="{ row }">{{ row.sd.genres.join('、') || '—' }}</template>
        </el-table-column>
        <el-table-column label="行状态" width="160" align="center">
          <template #default="{ row, $index }">
            <template v-if="row.decision === 'reject'">
              <el-tag type="danger" size="small">已标拒绝</el-tag>
              <el-button link size="small" class="ml-1" @click="setDecision($index, 'approve')">恢复</el-button>
              <div class="text-[11px] text-red-400 mt-0.5 px-1 truncate" :title="row.rejectReason">原因：{{ row.rejectReason || '未填' }}</div>
            </template>
            <template v-else>
              <el-tooltip v-if="rowIssues(row.sd).length" :content="rowIssues(row.sd).join('；')" placement="top">
                <el-tag type="warning" size="small" class="cursor-pointer" @click="openFill(firstIssueField(row.sd), $index)">待补 ID</el-tag>
              </el-tooltip>
              <el-tag v-else type="success" size="small">就绪</el-tag>
              <el-button link size="small" type="danger" class="ml-1" @click="markReject($index)">拒绝</el-button>
            </template>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="65" align="center">
          <template #default="{ $index }">
            <el-button link type="info" size="small" @click="removeBatchRow($index)">移出</el-button>
          </template>
        </el-table-column>
      </el-table>
      </div>

      <!-- 移动端(<768px)：折叠卡片——收起时一行一歌纵览全批，点开编辑；数据/勾选/编辑弹窗与桌面表格完全同源 -->
      <div class="md:hidden">
        <!-- 顶部工具条（吸附）：全选 / 勾选标拒 -->
        <div class="sticky top-0 z-10 -mx-1 px-1 pt-1 pb-2 bg-white flex items-center gap-2 border-b border-gray-100">
          <el-checkbox :model-value="allChecked" :indeterminate="!!batchSelected.length && !allChecked" @change="toggleAll">全选</el-checkbox>
          <span class="text-xs text-gray-400">已选 {{ batchSelected.length }}/{{ batchRows.length }}</span>
          <div class="flex-1"></div>
          <el-button size="small" type="danger" plain :disabled="!batchSelected.length" @click="rejectBatchRows">勾选标拒</el-button>
        </div>

        <div class="space-y-2 pt-2">
          <div v-for="(r, i) in batchRows" :key="r.row.id" class="rounded-lg border border-gray-200 bg-white">
            <!-- 折叠头：勾选 + 序号歌名 + 状态标签，点击展开/收起 -->
            <div class="flex items-center gap-2 px-3 py-2 cursor-pointer select-none" @click="expandedId = expandedId === r.row.id ? null : r.row.id">
              <el-checkbox :model-value="cardChecked(r)" @click.stop @change="toggleBatchSel(r)" />
              <span class="flex-1 min-w-0 truncate text-sm" :class="r.decision === 'reject' ? 'text-gray-400 line-through' : 'text-gray-800 font-medium'">{{ i + 1 }}. {{ r.sd.title || '（未命名）' }}</span>
              <el-tag v-if="r.decision === 'reject'" type="danger" size="small" class="shrink-0">拒</el-tag>
              <el-tag v-else-if="rowIssues(r.sd).length" type="warning" size="small" class="shrink-0">待补</el-tag>
              <el-tag v-else type="success" size="small" class="shrink-0">就绪</el-tag>
              <span class="text-gray-300 text-xs shrink-0">{{ expandedId === r.row.id ? '▲' : '▼' }}</span>
            </div>

            <!-- 展开编辑区：字段行 = 标签 + 点按编辑（本行）+ ⚡（填充到勾选行/全部行） -->
            <div v-if="expandedId === r.row.id" class="px-3 pb-2.5 pt-2 border-t border-gray-50 space-y-2">
              <div class="text-xs text-gray-400">提交人：{{ r.row.user_name }}</div>
              <div class="space-y-1.5 text-xs">
                <div class="flex items-center gap-2">
                  <span class="w-8 shrink-0 text-gray-400">歌名</span>
                  <el-input v-model="r.sd.title" size="small" class="flex-1" />
                </div>
                <div class="flex items-center gap-2">
                  <span class="w-8 shrink-0 text-gray-400">歌手</span>
                  <el-button link size="small" class="!ml-0 flex-1 min-w-0 justify-start" :class="r.sd.artists.some((a: any) => !a.id) ? 'text-amber-600' : ''" @click="openFill('artists', i)">
                    <span class="inline-flex items-center gap-0.5 mr-0.5 shrink-0">
                      <template v-for="a in r.sd.artists" :key="a.name">
                        <img v-if="artistAvatar(a.id)" :src="artistAvatar(a.id)" class="w-4 h-4 rounded-full object-cover" :title="a.name" />
                        <span v-else class="w-4 h-4 rounded-full bg-pink-300 text-white text-[8px] leading-none flex items-center justify-center" :title="a.name">{{ a.name?.charAt(0) }}</span>
                      </template>
                    </span>
                    <span class="truncate">{{ r.sd.artists.map((a: any) => a.name).join('、') || '+ 设置' }}</span>
                    <el-tag v-if="r.sd.artists.some((a: any) => !a.id)" size="small" type="warning" class="ml-1 shrink-0">新建</el-tag>
                  </el-button>
                  <el-button link size="small" type="primary" class="!ml-1 shrink-0" title="填充到勾选行（未勾选 = 全部行）" @click="openFill('artists')">⚡</el-button>
                </div>
                <div class="flex items-center gap-2">
                  <span class="w-8 shrink-0 text-gray-400">作词</span>
                  <el-button link size="small" class="!ml-0 flex-1 min-w-0 justify-start" @click="openFill('lyricist_arr', i)"><span class="truncate">{{ r.sd.lyricist_arr.map((a: any) => a.name).join('、') || '+ 设置' }}</span><el-tag v-if="r.sd.lyricist_arr.some((a: any) => !a.id)" size="small" type="warning" class="ml-1 shrink-0">新建</el-tag></el-button>
                  <el-button link size="small" type="primary" class="!ml-1 shrink-0" title="填充到勾选行（未勾选 = 全部行）" @click="openFill('lyricist_arr')">⚡</el-button>
                </div>
                <div class="flex items-center gap-2">
                  <span class="w-8 shrink-0 text-gray-400">作曲</span>
                  <el-button link size="small" class="!ml-0 flex-1 min-w-0 justify-start" @click="openFill('composer_arr', i)"><span class="truncate">{{ r.sd.composer_arr.map((a: any) => a.name).join('、') || '+ 设置' }}</span><el-tag v-if="r.sd.composer_arr.some((a: any) => !a.id)" size="small" type="warning" class="ml-1 shrink-0">新建</el-tag></el-button>
                  <el-button link size="small" type="primary" class="!ml-1 shrink-0" title="填充到勾选行（未勾选 = 全部行）" @click="openFill('composer_arr')">⚡</el-button>
                </div>
                <div class="flex items-center gap-2">
                  <span class="w-8 shrink-0 text-gray-400">编曲</span>
                  <el-button link size="small" class="!ml-0 flex-1 min-w-0 justify-start" @click="openFill('arranger_arr', i)"><span class="truncate">{{ r.sd.arranger_arr.map((a: any) => a.name).join('、') || '+ 设置' }}</span><el-tag v-if="r.sd.arranger_arr.some((a: any) => !a.id)" size="small" type="warning" class="ml-1 shrink-0">新建</el-tag></el-button>
                  <el-button link size="small" type="primary" class="!ml-1 shrink-0" title="填充到勾选行（未勾选 = 全部行）" @click="openFill('arranger_arr')">⚡</el-button>
                </div>
                <div class="flex items-center gap-2">
                  <span class="w-8 shrink-0 text-gray-400">专辑</span>
                  <el-button link size="small" class="!ml-0 flex-1 min-w-0 justify-start" @click="openFill('album', i)">
                    <span class="inline-flex items-center gap-0.5 mr-0.5 shrink-0">
                      <img v-if="albumCoverOf(r.sd)" :src="albumCoverOf(r.sd)" class="w-4 h-4 rounded object-cover" :title="r.sd.album" />
                    </span>
                    <span class="truncate">{{ r.sd.album || '+ 设置' }}</span>
                    <el-tag v-if="r.sd.album && r.sd.album_id" size="small" type="success" class="ml-1 shrink-0">已关联</el-tag>
                    <el-tag v-else-if="r.sd.album" size="small" type="warning" class="ml-1 shrink-0">新建</el-tag>
                  </el-button>
                  <el-button link size="small" type="primary" class="!ml-1 shrink-0" title="填充到勾选行（未勾选 = 全部行）" @click="openFill('album')">⚡</el-button>
                </div>
                <div class="flex items-center gap-2">
                  <span class="w-8 shrink-0 text-gray-400">曲目</span>
                  <div class="flex flex-1 gap-2">
                    <el-input v-model="r.sd.track" size="small" placeholder="曲目号" class="!w-16" />
                    <el-input v-model="r.sd.duration" size="small" placeholder="时长 03:30" class="flex-1" />
                  </div>
                  <el-button link size="small" type="primary" class="!ml-1 shrink-0" title="曲目号填充到勾选行（未勾选 = 全部行）" @click="openFill('track')">⚡</el-button>
                </div>
                <div class="flex items-center gap-2">
                  <span class="w-8 shrink-0 text-gray-400">封面</span>
                  <div class="flex flex-1 items-center gap-1.5 min-w-0">
                    <img v-if="r.sd.cover" :src="r.sd.cover" class="w-8 h-8 rounded object-cover cursor-pointer border border-gray-200 shrink-0" @click="ui.openPreview([r.sd.cover])" />
                    <el-input v-model="r.sd.cover" size="small" placeholder="单曲封面 URL，不填用专辑封面" />
                  </div>
                  <el-button link size="small" type="primary" class="!ml-1 shrink-0" title="封面填充到勾选行（未勾选 = 全部行）" @click="openFill('cover')">⚡</el-button>
                </div>
                <div class="flex items-center gap-2">
                  <span class="w-8 shrink-0 text-gray-400">风格</span>
                  <el-button link size="small" class="!ml-0 flex-1 min-w-0 justify-start" @click="openFill('genres', i)"><span class="truncate">{{ r.sd.genres.join('、') || '+ 设置' }}</span></el-button>
                  <el-button link size="small" type="primary" class="!ml-1 shrink-0" title="填充到勾选行（未勾选 = 全部行）" @click="openFill('genres')">⚡</el-button>
                </div>
              </div>

              <!-- 行状态操作：与桌面表格「行状态 / 操作」列同逻辑 -->
              <div class="flex items-center justify-between gap-2 pt-1.5 border-t border-gray-100">
                <template v-if="r.decision === 'reject'">
                  <div class="min-w-0">
                    <el-tag type="danger" size="small">已标拒绝</el-tag>
                    <el-button link size="small" class="ml-1" @click="setDecision(i, 'approve')">恢复</el-button>
                    <div class="text-[11px] text-red-400 truncate" :title="r.rejectReason">原因：{{ r.rejectReason || '未填' }}</div>
                  </div>
                </template>
                <template v-else>
                  <div>
                    <el-tooltip v-if="rowIssues(r.sd).length" :content="rowIssues(r.sd).join('；')" placement="top">
                      <el-tag type="warning" size="small" class="cursor-pointer" @click="openFill(firstIssueField(r.sd), i)">待补 ID</el-tag>
                    </el-tooltip>
                    <el-tag v-else type="success" size="small">就绪</el-tag>
                    <el-button link size="small" type="danger" class="ml-1" @click="markReject(i)">拒绝</el-button>
                  </div>
                </template>
                <div class="flex items-center shrink-0">
                  <el-button link size="small" @click="lyricOpenId = lyricOpenId === r.row.id ? null : r.row.id">{{ lyricOpenId === r.row.id ? '收起歌词' : '歌词' }}</el-button>
                  <el-button link type="info" size="small" @click="removeBatchRow(i)">移出</el-button>
                </div>
              </div>
              <div v-if="lyricOpenId === r.row.id" class="space-y-2">
                <div class="text-xs text-gray-400"><el-tag v-if="r.sd.ttml_text" size="small" type="warning">TTML</el-tag><span v-if="r.sd.ttml_text" class="ml-1">投稿含 TTML 原文，发布时独立成版本落盘</span></div>
                <el-input v-model="r.sd.lrc_text" type="textarea" :autosize="{ minRows: 6, maxRows: 16 }" class="font-mono" />
                <div class="text-xs text-gray-400">多语言版本（{{ r.sd.versions?.length || 0 }} 个，留空发布时按 LRC 自动拆分）</div>
                <LyricVersionsEditor v-model="r.sd.versions" />
              </div>
            </div>
          </div>
          <div v-if="!batchRows.length" class="py-8 text-center text-gray-400 text-sm">暂无待审行</div>
        </div>
      </div>

      <template #footer>
        <!-- 桌面：勾选拒绝在左，取消/提交在右 -->
        <div class="hidden md:flex justify-between w-full">
          <el-button type="danger" plain :disabled="!batchSelected.length" @click="rejectBatchRows">勾选行标为拒绝（{{ batchSelected.length }}）</el-button>
          <div>
            <el-button @click="showBatchReview = false">取消</el-button>
            <el-button type="success" :loading="batchPublishing" @click="publishBatch">
              ✅ 按标记提交（就绪 {{ batchStats.ready }} / 待补 {{ batchStats.blocked }} / 拒绝 {{ batchStats.rejected }}）
            </el-button>
          </div>
        </div>
        <!-- 移动端：勾选拒绝已在列表顶部工具条，底栏只留取消 + 提交（双按钮等宽防溢出） -->
        <div class="flex md:hidden w-full gap-2">
          <el-button class="flex-1" @click="showBatchReview = false">取消</el-button>
          <el-button type="success" class="flex-1" :loading="batchPublishing" @click="publishBatch">
            ✅ 提交（就绪{{ batchStats.ready }}/待补{{ batchStats.blocked }}/拒{{ batchStats.rejected }}）
          </el-button>
        </div>
      </template>
    </el-dialog>

    <!-- 列统一填充弹窗（批量审核表头 ⚡）：填一次值，应用到表格该列所有行 -->
    <el-dialog v-model="showFill" :title="`${isFillAll ? '统一填充' : '编辑'}「${FILL_LABELS[fillKey] || fillKey}」`" width="560px" append-to-body :close-on-click-modal="false">
      <div class="text-xs text-gray-400 mb-3">
        {{ isFillAll
          ? (batchSelected.length ? `该值将应用到勾选的 ${batchSelected.length} 行（批量表中已勾选）。` : `该值将覆盖全部 ${batchRows.length} 行（未勾选任何行时）。`)
          : '仅修改该行的此字段。' }}
      </div>
      <template v-if="['artists', 'album_artists', 'lyricist_arr', 'composer_arr', 'arranger_arr'].includes(fillKey)">
        <ArtistTagInput v-model="fillArtists" :artists="artists" :filter-type="fillKey === 'artists' ? 'singer' : fillKey === 'lyricist_arr' ? 'lyricist' : fillKey === 'composer_arr' ? 'composer' : fillKey === 'arranger_arr' ? 'arranger' : null" :tone="fillKey === 'album_artists' ? 'gray' : 'pink'" admin @artist-saved="onArtistSaved" />
        <div v-if="fillArtists.some(a => !a.id)" class="text-xs text-amber-600 mt-2">含新建艺术家：点击其头像填写 ID 后再应用，否则这些行发布时会被跳过</div>
      </template>
      <template v-else-if="fillKey === 'album'">
        <el-select
          v-model="fillAlbum"
          filterable
          allow-create
          default-first-option
          :filter-method="filterAlbums"
          placeholder="搜索库内专辑，或输入新专辑名"
          class="w-full"
        >
          <el-option v-for="al in filteredAlbums" :key="al.id" :label="al.name + (al.year ? `（${al.year}）` : '')" :value="al.id" />
        </el-select>
        <!-- 批量覆盖模式只选专辑应用行；单行编辑走 AlbumInfoDialog（保存即入库/写回，与单曲审核同款） -->
        <div v-if="isFillAll" class="text-xs text-gray-400 mt-2">批量覆盖只设置专辑关联；需编辑封面/年份/简介，请先应用到行，再点该行专辑封面编辑。</div>
      </template>
      <el-select v-else-if="fillKey === 'genres'" v-model="fillGenres" multiple filterable allow-create clearable default-first-option placeholder="选择或输入风格标签" class="w-full">
        <el-option v-for="g in GENRE_OPTIONS" :key="g" :label="g" :value="g" />
      </el-select>
      <el-input v-else v-model="fillText" :placeholder="fillKey === 'duration' ? '03:30' : fillKey === 'year' ? '2024' : '统一值'" />
      <template #footer>
        <el-button @click="showFill = false">取消</el-button>
        <el-button type="primary" @click="applyFill">{{ isFillAll ? '应用到全部行' : '保存该行' }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { adminApi } from '@/lib/adminApi'
import { supabase } from '@/lib/supabase'
import { recomputeArtistTypes } from '@/lib/artistTypes'
import { syncSongContributors, syncAlbumContributors } from '@/lib/contribRelations'
import { contactLabel, GENRE_OPTIONS } from '@/lib/constants'
import { useUiStore } from '@/stores/ui'
import { splitLrcToVersions, rowsToLrcText, parseLrcToRows, parseTtmlToRows, detectLang, saveLyricLines } from '@/lib/lyricLines'
import LyricVersionsEditor from '@/components/common/LyricVersionsEditor.vue'
import ArtistTagInput from '@/components/submit/ArtistTagInput.vue'
import AlbumInfoDialog from '@/components/admin/AlbumInfoDialog.vue'
import SongFormDialog from '@/components/admin/SongFormDialog.vue'
import AdminTable from '@/components/admin/AdminTable.vue'
import type { Artist } from '@/lib/types'

/** 投稿审核：列表 + 审核弹窗（edited_data 可编辑、新建艺术家点头像弹窗补全、通过时事务链发布） */
const ARTIST_FIELDS = [
  { key: 'artists', label: '歌手', type: 'singer' },
  { key: 'album_artists', label: '专辑艺术家', type: 'singer' },
  { key: 'lyricist_arr', label: '作词', type: 'lyricist' },
  { key: 'composer_arr', label: '作曲', type: 'composer' },
  { key: 'arranger_arr', label: '编曲', type: 'arranger' },
] as const

interface ReviewItem {
  id: string
  user_name: string
  song_data: any
  edited_data: any
  status: string
  created_at: string
  reject_reason?: string | null
  contact_value?: Record<string, any>
  contributor_id?: string | null
  submitter_request_update?: boolean
  submitter_request_clear?: boolean
  submitter_public_contact?: boolean
  submitter_bio?: string | null
}

const tab = ref('pending')
const tabs = [
  { key: 'pending', label: '待审核' },
  { key: 'approved', label: '已通过' },
  { key: 'rejected', label: '已拒绝' },
]

const submissions = ref<any[]>([])
const artists = ref<Artist[]>([])
const albums = ref<{ id: string; name: string; year?: number | null; cover?: string | null; description?: string | null; artist_ids?: string[] | null }[]>([])
const ui = useUiStore()
const loading = ref(false)
const page = ref(1)
const pageSize = ref(10)
const selected = ref<any[]>([])
const tableRef = ref()

const counts = computed(() => ({
  pending: submissions.value.filter(s => s.status === 'pending').length,
}))
const listSource = computed(() => submissions.value.filter(s => s.status === tab.value))

/**
 * 待审核列表按批次折叠：批量投稿（batch_id 相同）合并为一个分组行，单曲投稿各占一行。
 * 分组行点击「审核整批」直接进入批量审核弹窗（范围=批内全部）。
 */
interface ListEntry {
  kind: 'single' | 'batch'
  /** single：原投稿行；batch：批内第一行（携带提交人/时间等公共信息） */
  row: any
  /** batch 专属：批内全部投稿行 */
  rows?: any[]
  /** batch 专属：批 ID */
  batchId?: string
  /** 展示标题：single = 歌名；batch = 「专辑」等 N 首 */
  label: string
  /** batch 专属：批内歌手（拼接展示，截断由 tooltip 处理） */
  artist?: string
}

const displayList = computed<ListEntry[]>(() => {
  const pendingTab = tab.value === 'pending'
  // 已通过/已拒绝的批次行取全状态（同批的通过/拒绝分散在两个 tab，
  // 撤回整批 / 勾选删除都以批为单位一次性处理，不用切 tab 分两次）；待审核只取本 tab 行
  const groupSrc = pendingTab ? listSource.value : submissions.value
  // 预分组：batch_id → 行数组（一趟 O(n)，避免循环内反复 filter 的 O(n·m)）
  const byBatch = new Map<string, any[]>()
  for (const row of groupSrc) {
    if (row.batch_id) {
      const list = byBatch.get(row.batch_id)
      if (list) list.push(row)
      else byBatch.set(row.batch_id, [row])
    }
  }
  const seen = new Set<string>()
  const out: ListEntry[] = []
  for (const row of listSource.value) {
    const bid = row.batch_id
    if (bid && !seen.has(bid)) {
      seen.add(bid)
      const all = byBatch.get(bid) || [row]
      const sd = all[0].song_data || {}
      if (pendingTab) {
        out.push({
          kind: 'batch',
          row: all[0],
          rows: all,
          batchId: bid,
          label: `${sd.album ? `《${sd.album}》` : ''}等 ${all.length} 首歌曲`,
          artist: artistNamesOf(sd),
        })
      } else {
        const okN = all.filter(r => r.status === 'approved').length
        const rjN = all.filter(r => r.status === 'rejected').length
        const parts: string[] = []
        if (okN) parts.push(`通过 ${okN}`)
        if (rjN) parts.push(`拒绝 ${rjN}`)
        out.push({
          kind: 'batch',
          row: all.find(r => r.status === tab.value) || all[0],
          rows: all,
          batchId: bid,
          label: `${sd.album ? `《${sd.album}》` : ''}等 ${all.length} 首${parts.length ? `（${parts.join(' / ')}）` : ''}`,
          artist: artistNamesOf(sd),
        })
      }
    } else if (!bid) {
      out.push({ kind: 'single', row, label: row.song_data?.type === 'profile' ? '资料更新' : (row.song_data?.title || '—') })
    }
  }
  return out
})
const pagedDisplay = computed(() => displayList.value.map(e => ({ ...e, __key: e.kind === 'batch' ? 'b_' + e.batchId : 's_' + e.row.id })).slice((page.value - 1) * pageSize.value, page.value * pageSize.value))
/** 展示计数：按投稿动作计（批次算一次） */
const displayCount = computed(() => displayList.value.length)

/** 选择变化：列表行是 ListEntry 包装；勾选批次行 = 选中批内全部投稿（删除/拒绝按整批展开） */
function onSelectionChange(entries: any[]) {
  const out: any[] = []
  for (const e of entries) {
    if (!e) continue
    if (e.kind === 'batch' && e.rows) out.push(...e.rows)
    else if (e.kind === 'single') out.push(e.row)
  }
  // 批内多行去重（批次行与单曲行不会重叠，稳妥起见仍去重）
  selected.value = [...new Map(out.map(r => [r.id, r])).values()]
}

async function load() {
  loading.value = true
  try {
    const [subs, arts, als, ac] = await Promise.all([
      adminApi.getAll('submissions', { order: 'created_at', ascending: false }),
      adminApi.getAll<Artist>('artists', { order: 'name' }),
      adminApi.getAll<{ id: string; name: string; year?: number | null; cover?: string | null; description?: string | null; artist_ids?: string[] | null }>('albums', { order: 'name' }),
      adminApi.getAll<any>('album_contributors'),
    ])
    submissions.value = subs
    artists.value = arts
    // 中间表 → 专辑池装饰 artist_ids（下游沿用旧字段名）
    const acMap = new Map<string, string[]>()
    for (const r of ac) {
      const list = acMap.get(r.album_id) || []
      list.push(r.artist_id)
      acMap.set(r.album_id, list)
    }
    const decorated = als.map(a => ({ ...a, artist_ids: acMap.get(a.id) || [] }))
    albums.value = decorated
    filteredAlbums.value = decorated
  } catch (e: any) {
    ElMessage.error('加载失败：' + e.message)
  } finally {
    loading.value = false
  }
}
onMounted(load)

function clearSelection() {
  tableRef.value?.clearSelection()
  selected.value = []
}

// ============ 审核弹窗 ============
const showReview = ref(false)
const review = ref<ReviewItem | null>(null)
/** TTML 源码预览开关（仅含 ttml_text 的投稿显示切换按钮，每次打开弹窗重置为 LRC） */
const ttmlPreview = ref(false)
/** 审核修改表单（SongFormDialog review 模式）：edited_data → 表单 initial 的映射与回填 */
const showReviewForm = ref(false)
const reviewInitial = ref<any>(null)
/** 打开审核修改表单：把 edited_data 映射为 SongFormDialog 的 initial 结构 */
function openReviewForm() {
  if (!review.value) return
  const sd = review.value.edited_data
  reviewInitial.value = {
    title: sd.title,
    aliases: sd.aliases || [],
    duration: sd.duration || '',
    track: sd.track ? parseInt(String(sd.track), 10) || 0 : 0,
    artists: (sd.artists || []).map((t: any) => (typeof t === 'string' ? { id: null, name: t } : t)),
    album_id: sd.album_id || '',
    albumName: sd.album || '',
    albumArtists: (sd.album_artists || []).map((t: any) => (typeof t === 'string' ? { id: null, name: t } : t)),
    year: sd.year || '',
    lyricists: sd.lyricist_arr || [],
    composers: sd.composer_arr || [],
    arrangers: sd.arranger_arr || [],
    genres: [...(sd.genres || [])],
    video_url: sd.video_url || '',
    description: sd.description || '',
    lrc_text: sd.lrc_text || '',
    lyrics_text: sd.lyrics_text || '',
    versions: (sd.versions || []).map((v: any) => ({ lang: v.lang, kind: v.kind, lrc: v.lrc })),
  }
  showReviewForm.value = true
}
/** review 模式「通过发布」：表单数据回填 edited_data（保留投稿独有字段 ttml_text/单曲封面），走原发布链路 */
function onReviewData(data: any) {
  if (!review.value) return
  const sd = review.value.edited_data
  const keep = {
    ttml_text: sd.ttml_text,
    // 单曲封面不在表单里（用投稿的），多语言版本以表单为准（表单里可编辑）
    cover: sd.cover,
  }
  review.value.edited_data = { ...data, ...keep }
  showReviewForm.value = false
  approve(review.value)
}
/** review 模式「拒绝」：直接走原拒绝链路 */
function onReviewReject() {
  showReviewForm.value = false
  reject(review.value)
}

/** 资料更新类投稿（song_data.type === 'profile'）：弹窗不显示歌曲表单，通过时只更新贡献者 */
const isProfileReview = computed(() => review.value?.song_data?.type === 'profile')

/** contact_value（JSONB）→ 可展示的键值列表（过滤空值） */
function contactEntries(row: any): { k: string; v: string }[] {
  const cv = row?.contact_value
  let obj: Record<string, any> = {}
  if (typeof cv === 'string') {
    try { obj = JSON.parse(cv || '{}') } catch { obj = {} }
  } else if (cv && typeof cv === 'object') {
    obj = cv
  }
  return Object.entries(obj).filter(([, v]) => v != null && v !== '').map(([k, v]) => ({ k: String(k), v: String(v) }))
}

/** 专辑池 artist_ids → tag 对象数组（name 从艺术家池查；查不到的 id 丢弃） */
function albumArtistTags(ids: string[] | null | undefined): { id: string; name: string }[] {
  return (ids || [])
    .map(id => {
      const a = artists.value.find(x => x.id === id)
      return a ? { id: a.id, name: a.name } : null
    })
    .filter(Boolean) as { id: string; name: string }[]
}

function openReview(row: any) {
  const sd = normalizeSubmission(row)
  // 已关联库内专辑 → 预填库内封面/年份/简介/专辑艺术家（改了发布时写回；投稿自带值仅在库内为空时作默认）
  if (sd.album_id) {
    const hit = albums.value.find(a => a.id === sd.album_id)
    if (hit) {
      sd.album_cover = hit.cover || sd.album_cover || ''
      sd.year = hit.year ? String(hit.year) : (sd.year || '')
      sd.album_desc = hit.description || sd.album_desc || ''
      if (hit.artist_ids?.length) sd.album_artists = albumArtistTags(hit.artist_ids)
    }
  }
  review.value = { ...row, edited_data: sd }
  ttmlPreview.value = false
  filteredAlbums.value = albums.value
  showReview.value = true
}

/** 歌手名拼接（song_data.artists 数组，唯一格式；v2 裸键 artist 已在 phase2-B ⑨ 规范化清除） */
const artistNamesOf = (sd: any) =>
  (Array.isArray(sd?.artists) ? sd.artists : []).map((a: any) => a?.name).filter(Boolean).join('、')

/** 深拷贝 song_data 并规范化：补数组字段、_new 标记、按名自动绑定已入库艺术家（大小写不敏感，
 *  仅库内名字唯一时绑——同名多人保留待创建态）。单曲审核与批量通过共用 */
function normalizeSubmission(row: any): any {
  const edited = JSON.parse(JSON.stringify(row.song_data || {}))
  // 兼容旧格式：补全新格式数组字段 + 初始化新艺术家的 is_show
  if (!Array.isArray(edited.artists)) edited.artists = []
  if (!Array.isArray(edited.album_artists)) edited.album_artists = []
  if (!Array.isArray(edited.lyricist_arr)) edited.lyricist_arr = []
  if (!Array.isArray(edited.composer_arr)) edited.composer_arr = []
  if (!Array.isArray(edited.arranger_arr)) edited.arranger_arr = []
  if (!Array.isArray(edited.genres)) edited.genres = []
  if (edited.album_cover === undefined) edited.album_cover = ''
  if (edited.cover === undefined) edited.cover = ''
  if (edited.album_desc === undefined) edited.album_desc = ''
  if (edited.track === undefined) edited.track = ''
  if (!Array.isArray(edited.versions)) edited.versions = []
  // 投稿未带多语言版本（批量传 LRC 文件 / 老投稿）→ 从 lrc_text 自动拆分，审核人只需核对、无需逐首手动拆
  if (!edited.versions.length && edited.lrc_text?.trim()) {
    const vers = splitLrcToVersions(edited.lrc_text.trim())
    edited.versions = vers.map(v => ({ lang: v.lang, kind: v.kind, lrc: rowsToLrcText(v.rows) }))
  }
  for (const f of ARTIST_FIELDS) {
    edited[f.key].forEach((item: any) => {
      if (!item) return
      // _new 标记投稿时无 ID 的待创建艺术家（输入 ID 后仍保留在待创建清单）
      if (!item.id) item._new = true
      if (item.is_show === undefined) item.is_show = true
    })
  }
  // 投稿未带 ID，但该艺术家已入库（如审核同批上一首时刚创建）→ 按名自动绑定，
  // 免去逐首删除 tag 再从下拉重选；types 缺口由发布时的补 type 逻辑兜底
  for (const f of ARTIST_FIELDS) {
    edited[f.key].forEach((item: any) => {
      if (!item || item.id) return
      const hits = artists.value.filter(a => a.name.toLowerCase() === item.name.toLowerCase())
      if (hits.length === 1) {
        item.id = hits[0].id
        item.name = hits[0].name
        item._new = false
      }
    })
  }
  return edited
}

/** 专辑下拉过滤：精确匹配置顶 → 前缀匹配 → 包含匹配（原 filterable 默认按选项原顺序展示，
 *  用户输入的专辑名不会排前面，得在长列表里翻找） */
const albumFilterQuery = ref('')
const filteredAlbums = ref<{ id: string; name: string; year?: number | null }[]>([])
function filterAlbums(q: string) {
  albumFilterQuery.value = q
  const query = q.trim().toLowerCase()
  if (!query) {
    filteredAlbums.value = albums.value
    return
  }
  const hit = albums.value.filter(al => al.name.toLowerCase().includes(query))
  const exact = hit.filter(al => al.name.toLowerCase() === query)
  const prefix = hit.filter(al => al.name.toLowerCase().startsWith(query) && !exact.includes(al))
  const rest = hit.filter(al => !exact.includes(al) && !prefix.includes(al))
  filteredAlbums.value = [...exact, ...prefix, ...rest]
}

/** 同名歧义：投稿未带 ID 且库内同名人 ≥2（大小写不敏感）→ 程序无法自动判断，人工从下拉（带消歧标注）选择 */
const ambiguousArtists = computed(() => {
  const res: { name: string; entries: string[] }[] = []
  if (!review.value) return res
  for (const f of ARTIST_FIELDS) {
    for (const item of review.value.edited_data[f.key] || []) {
      if (!item || item.id) continue
      const hits = artists.value.filter(a => a.name.toLowerCase() === item.name.toLowerCase())
      if (hits.length >= 2 && !res.some(r => r.name === item.name)) {
        res.push({ name: item.name, entries: hits.map(h => (h.disambiguation ? `${h.name}（${h.disambiguation}）` : h.name)) })
      }
    }
  }
  return res
})

/** 收集待创建艺术家（无 ID 或 _new 标记；跨字段按名合并，types 取并集）。
 *  单曲审核（review）与批量通过（独立 edited）共用 */
function collectNewArtists(edited: any) {
  const map = new Map<string, { item: any; source: string[]; types: Set<string> }>()
  for (const f of ARTIST_FIELDS) {
    const arr = edited[f.key] || []
    for (const item of arr) {
      if (!item || (!item._new && item.id)) continue
      if (!map.has(item.name)) {
        item.is_show ??= true
        map.set(item.name, { item, source: [f.label], types: new Set([f.type]) })
      } else {
        map.get(item.name)!.source.push(f.label)
        map.get(item.name)!.types.add(f.type)
      }
    }
  }
  return [...map.entries()].map(([, v]) => ({ item: v.item, source: v.source.join(' / '), types: [...v.types] }))
}
const newArtistsList = computed(() => (review.value ? collectNewArtists(review.value.edited_data) : []))

/** 从 contact_value（JSONB）解析邮箱（英文键 email；'邮箱' 为旧数据兼容） */
function parseEmail(row: any): string {
  const cv = row.contact_value
  try {
    const obj = typeof cv === 'string' ? JSON.parse(cv || '{}') : (cv || {})
    return obj['email'] || obj['邮箱'] || ''
  } catch {
    return ''
  }
}

/**
 * 批量解析投稿邮箱：投稿记录 contact_value 优先；为空时回退查贡献者资料。
 * （老贡献者投稿不强制填邮箱，但其资料库里有 → 审核结果邮件不该因此蒸发。）
 * 一次 in 查询批量取回，避免逐行 N+1。
 */
async function emailMapOf(rows: any[]): Promise<Map<string, string>> {
  const map = new Map<string, string>()
  const needLookup: any[] = []
  for (const row of rows) {
    const email = parseEmail(row)
    if (email) map.set(row.id, email)
    else if (row.contributor_id) needLookup.push(row)
    else map.set(row.id, '')
  }
  if (needLookup.length) {
    try {
      const ids = [...new Set(needLookup.map(r => r.contributor_id))]
      const { data } = await supabase.from('contributors').select('id,contact_value').in('id', ids)
      const cvById = new Map<string, any>((data || []).map((c: any) => [c.id, c.contact_value]))
      for (const row of needLookup) {
        try {
          const cv = cvById.get(row.contributor_id)
          const obj = typeof cv === 'string' ? JSON.parse(cv || '{}') : (cv || {})
          map.set(row.id, obj['email'] || obj['邮箱'] || '')
        } catch { map.set(row.id, '') }
      }
    } catch { /* 回退查询失败：保持无邮箱，由 notifyByEmail 提示 */ }
  }
  return map
}
const emailOf = (row: any) => emailMapOf([row]).then(m => m.get(row.id) || '')

/** 发审核通知邮件：skipped/失败必须双通道可感知（ElMessage + console），禁止静默蒸发 */
async function notifyByEmail(payload: Record<string, any>, label: string, who: string) {
  try {
    const r = await adminApi.callMailServer('/api/mailer', payload)
    if (r?.skipped) {
      console.warn(`[邮件未发送] ${label} → ${who}:`, r.reason)
      ElMessage.warning(`${label}邮件未发送给 ${who}：${r.reason || '原因未知'}`)
    }
  } catch (e: any) {
    console.warn(`[邮件发送失败] ${label} → ${who}:`, e?.message)
    ElMessage.warning(`${label}邮件发送失败（${who}）：${e?.message || '网络错误'}`)
  }
}

/** 内联表单保存老艺术家（已写库）→ 同步本地艺术家池 */
function onArtistSaved(tag: any) {
  const a = artists.value.find(x => x.id === tag.id)
  if (a) {
    a.avatar = tag.avatar || null
    a.types = tag.types || []
    a.disambiguation = tag.disambiguation || null
    a.aliases = tag.aliases || []
    a.bio = tag.bio || ''
    a.urls = tag.urls || {}
  } else {
    // 新建艺术家保存即入库：加入本地艺术家池，供其它字段下拉立即可搜到/复用
    artists.value.push({ ...tag })
  }
}

/** AlbumInfoDialog 保存成功 → 回填审核表单关联 + 更新本地专辑池（⚡下拉等即时刷新） */
function onAlbumSaved(p: { albumId: string; name: string; year: number | null; cover: string; description: string | null; artistIds: string[] }) {
  const ed = review.value?.edited_data
  if (ed) {
    ed.album = p.name
    ed.album_id = p.albumId
    ed.album_cover = p.cover
    ed.year = p.year ?? ''
    ed.album_desc = p.description || ''
  }
  const row = albums.value.find(a => a.id === p.albumId)
  if (row) {
    row.name = p.name
    row.year = p.year
    row.cover = p.cover
    row.description = p.description
    row.artist_ids = p.artistIds
  } else {
    albums.value.push({ id: p.albumId, name: p.name, year: p.year, cover: p.cover, description: p.description, artist_ids: p.artistIds })
  }
}

// ============ 通过发布（事务链，迁移自 v2 并统一 lyricist/composer 存 ID） ============
/** 单曲审核通过（弹窗内） */
async function approve(sub: ReviewItem | null) {
  if (!sub) return
  const res = await publishSubmission(sub, newArtistsList.value)
  if (res === 'ok') {
    showReview.value = false
    await load()
  }
}

/** 发布一条投稿（事务链：状态 → 邮件 → 建艺术家/补 type → 贡献者四路 → 专辑 → 歌曲）。
 *  单曲审核与批量通过共用；silent 时逐条静默（批量场景由调用方汇总结果）。
 *  skipMail：批量按批合并邮件场景跳过单曲邮件（由调用方统一发 batch 邮件）。
 *  返回 'ok' | 'missing'（新建艺术家未填 ID）| 'error' */
async function publishSubmission(sub: any, newList: { item: any; types: string[] }[], silent = false, skipMail = false): Promise<'ok' | 'missing' | 'error'> {
  const sd = sub.edited_data
  const isProfile = sd?.type === 'profile'

  // 1. 校验新建艺术家必须填 ID（资料更新类无歌曲表单，跳过）；ID 在头像弹窗里填写
  if (!isProfile) {
    const missing = newList.filter(e => !e.item.id || !String(e.item.id).trim())
    if (missing.length) {
      if (!silent) ElMessage.error(`有 ${missing.length} 位新建艺术家未填写 ID（${missing.map(e => e.item.name).join('、')}），请点击其头像补全`)
      return 'missing'
    }
    // ID 冲突预检：撞库内已有艺术家（且非本行同名绑定场景）提前拦下，避免 insert 时抛 PK 冲突
    const dup: string[] = []
    for (const e of newList) {
      const id = String(e.item.id).trim()
      const exists = artists.value.find(a => a.id === id)
      // 本地池没有该 id → 是真新建，安全；有 → 若名字相同视为行内同名绑定（不该出现在 _new 清单，防御性放行），名字不同才是真冲突
      if (exists && exists.name !== e.item.name) dup.push(`${id}（${exists.name}）`)
    }
    if (dup.length) {
      if (!silent) ElMessage.error(`新建艺术家 ID 与库内已有艺术家冲突：${dup.join('、')}，请点击其头像更换 ID`)
      return 'missing'
    }
  }

  /** 本次发布新建的实体（删除已通过投稿时按引用检查级联回收）；声明在 try 外，供 catch 补偿回滚读取 */
  const refs: { song_id?: string; album_id?: string; artist_ids: string[]; contributor_id?: string } = { artist_ids: [] }

  try {
    // 2. 更新投稿状态
    await adminApi.update('submissions', sub.id, { status: 'approved', approved_at: new Date().toISOString() })

    // 3. 邮件通知（SMTP 由服务端读取，失败不阻塞；批量按批合并时跳过，由调用方统一发）
    if (!skipMail) {
      const to = await emailOf(sub)
      notifyByEmail({ action: 'approve', to, user_name: sub.user_name, song_title: isProfile ? '资料更新' : sd.title }, '通过', sub.user_name)
    }

    // 4. 插入新建艺术家并回填 ID；已有艺术家缺当前字段类型 → array_append 补上（资料更新类跳过）
    const nameToId: Record<string, string> = {}
    if (!isProfile) {
      for (const e of newList) {
        const id = String(e.item.id).trim()
        nameToId[e.item.name] = id
        // types 由歌曲关联派生：取该艺术家在本投稿各字段类型的并集
        const derivedTypes = e.types.length ? e.types : ['singer']
        await adminApi.insert('artists', {
          id,
          name: e.item.name,
          types: derivedTypes,
          is_show: e.item.is_show !== false,
          sort: 0,
          // 点击头像内联补全的信息（未补全则为空值，行为与原先一致）
          avatar: e.item.avatar || '',
          bio: e.item.bio || '',
          aliases: e.item.aliases || [],
          disambiguation: e.item.disambiguation || '',
          urls: e.item.urls || {},
        })
        refs.artist_ids.push(id)
        // 同步本地艺术家池：批量发布后续行的同名自动绑定 / 头像显示 / 歧义检测都依赖它
        artists.value.push({
          id, name: e.item.name, types: [...derivedTypes],
          avatar: e.item.avatar || null, disambiguation: e.item.disambiguation || null,
          aliases: e.item.aliases || [], bio: e.item.bio || '', urls: e.item.urls || {},
          is_show: e.item.is_show !== false,
        } as any)
      }
      for (const f of ARTIST_FIELDS) {
        sd[f.key].forEach((item: any) => {
          if (item && !item.id && nameToId[item.name]) item.id = nameToId[item.name]
        })
      }
      // 已有艺术家被用于新字段类型（如歌手兼作词）→ 补 type（幂等，已含则跳过）。
      // 同一艺术家跨字段出现时用本地缓存累计，避免后一次 update 覆盖前一次刚补的类型
      const typeCache = new Map<string, string[]>()
      for (const f of ARTIST_FIELDS) {
        for (const item of sd[f.key] || []) {
          if (!item?.id) continue
          let types = typeCache.get(item.id)
          if (!types) {
            // 只处理库内已有的（本会话新建的上面 insert 已带全类型并集）
            const exists = artists.value.find(a => a.id === item.id)
            if (!exists) continue
            types = [...(exists.types || ['singer'])]
            typeCache.set(item.id, types)
          }
          if (!types.includes(f.type)) {
            types.push(f.type)
            await adminApi.update('artists', item.id, { types })
          }
        }
      }
    }

    // 5. 贡献者四路逻辑（关联: none/update/clear；未关联: 新建）
    const contactValue = sub.contact_value || {}
    const bio = sub.submitter_bio != null ? String(sub.submitter_bio) : null
    let contributorId = sub.contributor_id || null
    let action = 'none'

    if (contributorId) {
      if (sub.submitter_request_clear) {
        await adminApi.update('contributors', contributorId, {
          avatar: null, bio: '', public_bio: true, contact_value: {}, public_contact: false, location: '', sort: 0,
        })
        action = 'clear'
      } else if (sub.submitter_request_update) {
        const patch: Record<string, unknown> = { contact_value: contactValue, public_contact: !!sub.submitter_public_contact }
        if (bio !== null) patch.bio = bio
        await adminApi.update('contributors', contributorId, patch)
        action = 'update'
      }
    } else {
      // 批量发布时连续 insert 可能同毫秒 → 加随机尾保证主键唯一
      contributorId = 'ct' + Date.now() + Math.floor(Math.random() * 1000)
      await adminApi.insert('contributors', {
        id: contributorId,
        name: sub.user_name || '匿名贡献者',
        bio: bio ?? '通过投稿自动创建的贡献者',
        contact_value: contactValue,
        public_contact: !!sub.submitter_public_contact,
        public_bio: true,
        tags: ['歌词提交'],
        is_owner: false,
        sort: 0,
      })
      refs.contributor_id = contributorId
      action = 'new'
    }

    // 6+7. 专辑沿用/新建 + 插入歌曲（资料更新类投稿无歌曲，跳过）
    if (!isProfile) {
      let albumId: string | null = sd.album_id || null
      if (!albumId && sd.album) {
        albumId = 'al' + Date.now() + Math.floor(Math.random() * 1000)
        const albumArtistIds = (sd.album_artists || []).map((a: any) => a.id).filter(Boolean)
        await adminApi.insert('albums', {
          id: albumId,
          name: sd.album,
          year: sd.year ? (parseInt(sd.year) || null) : null,
          cover: sd.album_cover || '',
          description: sd.album_desc || null,
        })
        await syncAlbumContributors(albumId, albumArtistIds)
        refs.album_id = albumId
      } else if (albumId) {
        // 沿用已有专辑：审核表单里的专辑艺术家/封面/年份/简介与库内不同则写回（预填库内值，改了才生效）
        const albumRow = albums.value.find(a => a.id === albumId)
        const patch: Record<string, any> = {}
        const newArtistIds = (sd.album_artists || []).map((a: any) => a.id).filter(Boolean)
        const oldArtistIds = albumRow?.artist_ids || []
        const artistIdsChanged = newArtistIds.length && JSON.stringify(newArtistIds) !== JSON.stringify(oldArtistIds)
        if (sd.album_cover && sd.album_cover !== (albumRow?.cover ?? '')) patch.cover = sd.album_cover
        if (sd.year) {
          const y = parseInt(String(sd.year), 10) || null
          if (y && y !== (albumRow?.year ?? null)) patch.year = y
        }
        if ((sd.album_desc || '') !== (albumRow?.description || '')) patch.description = sd.album_desc || null
        if (Object.keys(patch).length) await adminApi.update('albums', albumId, patch)
        if (artistIdsChanged) await syncAlbumContributors(albumId, newArtistIds)
      }

      // 插入歌曲（贡献关系只写 song_contributors 中间表，不再写旧列）
      const songId = 's' + Date.now() + Math.floor(Math.random() * 1000)
      refs.song_id = songId
      const singerIds = (sd.artists || []).map((a: any) => a.id).filter(Boolean)
      const lyricistIds = (sd.lyricist_arr || []).map((a: any) => a.id).filter(Boolean)
      const composerIds = (sd.composer_arr || []).map((a: any) => a.id).filter(Boolean)
      const arrangerIds = (sd.arranger_arr || []).map((a: any) => a.id).filter(Boolean)
      await adminApi.insert('songs', {
        id: songId,
        title: sd.title,
        album_id: albumId,
        duration: sd.duration || '',
        track: sd.track ? (parseInt(String(sd.track), 10) || null) : null,
        lrc_text: sd.lrc_text,
        cover: sd.cover || null,
        video_url: sd.video_url || null,
        status: 'published',
        contributor_id: contributorId,
        genres: sd.genres || [],
      })
      // 贡献关系唯一数据源：中间表（失败不静默——歌已插入但无关系行会导致前台不显示歌手）
      try {
        await syncSongContributors(songId, {
          singer: singerIds, lyricist: lyricistIds, composer: composerIds, arranger: arrangerIds,
        })
      } catch (e: any) {
        console.warn('[发布]中间表同步失败:', e?.message)
        throw new Error(`歌曲已插入但贡献关系写入失败（${e?.message}），请撤回后重试`)
      }
      // 多语言版本：投稿/审核提交了 versions → 精确写行表（覆盖触发器按 lrc_text 的语言判定结果）
      if (Array.isArray(sd.versions) && sd.versions.length) {
        try {
          const versions = sd.versions
            .filter((v: any) => v.lrc?.trim())
            .map((v: any) => ({ lang: v.lang?.trim() || 'zh', kind: v.kind, rows: parseLrcToRows(v.lrc) }))
          await saveLyricLines(songId, versions)
        } catch (e: any) {
          console.warn('[发布]多语言版本写行表失败:', e?.message)
          throw new Error(`歌曲已插入但多语言版本写入失败（${e?.message}），请撤回后重试`)
        }
      }
      // TTML 原文版本：独立落盘 lyric_versions（对唱/分屏/样式零丢失；降级 LRC 已写 songs.lrc_text）。
      // is_primary 不设（legacy 版本占位），tab 排序按格式优先级 TTML 自然置顶
      if (sd.ttml_text?.trim()) {
        try {
          const ttmlRows = parseTtmlToRows(sd.ttml_text)
          const langs = [...new Set(ttmlRows.map((r: any) => detectLang(r.text)).filter((l: string) => l && l !== 'unknown'))]
          const { error: ttmlErr } = await supabase.from('lyric_versions').insert({
            id: 'lv_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12),
            song_id: songId,
            format: 'ttml',
            source: 'user',
            ttml_text: sd.ttml_text.trim(),
            langs,
            status: 'published',
            is_primary: false,
            contributor_id: contributorId,
          })
          if (ttmlErr) throw ttmlErr
        } catch (e: any) {
          console.warn('[发布]TTML 版本写入失败:', e?.message)
          throw new Error(`歌曲已插入但 TTML 版本写入失败（${e?.message}），请撤回后重试`)
        }
      }
    }

    // 8. 记录发布产物（删除已通过投稿时级联回收用；失败不阻塞主流程）
    adminApi.update('submissions', sub.id, { published_refs: refs }).catch(e => console.warn('记录发布产物失败:', e?.message))

    if (!silent) {
      const actionText = isProfile
        ? '（已更新贡献者资料）'
        : { none: '（已关联贡献者）', new: '（已自动创建贡献者）', update: '（已更新贡献者资料）', clear: '（已清空贡献者资料）' }[action]
      ElMessage.success(isProfile ? '已通过，贡献者资料已更新' : '审核通过，已发布' + actionText)
    }
    return 'ok'
  } catch (e: any) {
    // 补偿回滚：refs 有实际产物（新建艺术家/贡献者/专辑/歌曲任一）→ 不能清 refs、
    // 也不能拉回 pending（pending tab 无撤回按钮，重审会重复建歌）；
    // 留在已通过 tab + 保留 refs，让「撤回」走级联回收后可重审。无任何产物才拉回 pending。
    // 回滚用 fire-and-forget：回滚自身失败不能掩盖原始错误
    const hasPartial = refs.artist_ids.length > 0 || !!refs.album_id || !!refs.song_id || !!refs.contributor_id
    const rollback: Record<string, any> = hasPartial
      ? { published_refs: refs }
      : { status: 'pending', approved_at: null, published_refs: null }
    adminApi.update('submissions', sub.id, rollback)
      .catch(e2 => console.warn('[补偿回滚失败]', sub.song_data?.title, e2?.message))
    // song_id 在 insert 前就赋值，「refs 含 song_id」≠「歌已建成」——
    // 撤回链删不存在的行是 no-op，无需区分
    const tip = hasPartial ? '（已建部分产物，请在已通过列表撤回本条回收后重试）' : '（已回滚到待审核）'
    if (!silent) ElMessage.error('发布失败' + tip + '：' + e.message)
    else console.warn('[批量发布失败]', sub.song_data?.title, tip, e?.message)
    return 'error'
  }
}

async function reject(sub: ReviewItem | null) {
  if (!sub) return
  try {
    const { value } = await ElMessageBox.prompt('请输入拒绝原因', '拒绝投稿', {
      confirmButtonText: '确认拒绝',
      cancelButtonText: '取消',
      inputPattern: /.+/,
      inputErrorMessage: '拒绝原因不能为空',
    })
    await adminApi.update('submissions', sub.id, {
      status: 'rejected',
      reject_reason: value,
      rejected_at: new Date().toISOString(),
    })
    const to = await emailOf(sub)
    notifyByEmail({ action: 'reject', to, user_name: sub.user_name, song_title: sub.song_data?.title, reject_reason: value }, '拒绝', sub.user_name)
    ElMessage.success('已拒绝')
    showReview.value = false
    await load()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error('操作失败：' + (e?.message || e))
  }
}

async function batchDelete() {
  if (!selected.value.length) return
  try {
    await ElMessageBox.confirm(`确定删除选中的 ${selected.value.length} 条投稿记录？（仅删记录，不清理已发布的歌曲/专辑等数据）`, '删除投稿', { type: 'warning' })
  } catch { return }
  try {
    await adminApi.removeBatch('submissions', selected.value.map(r => r.id))
    ElMessage.success(`已删除 ${selected.value.length} 条投稿记录`)
    clearSelection()
    await load()
  } catch (e: any) {
    ElMessage.error('删除失败：' + e.message)
  }
}

/** 已通过 / 已拒绝 tab 行级撤回：单曲撤回该条；批次行撤回整批（批内同状态全部回到待审核）。
 *  拒绝的没有发布产物，直接状态回退；通过走产物回收链 */
function recallRow(entry: any) {
  const rows = entry.kind === 'batch' && entry.rows ? entry.rows : [entry.row]
  const approved = rows.filter((r: any) => r.status === 'approved')
  const rejected = rows.filter((r: any) => r.status === 'rejected')
  if (rejected.length) recallRejected(rejected)
  if (approved.length) recallSubmissions(approved)
}

/** 拒绝撤回：无发布产物，直接回待审核 */
async function recallRejected(rows: any[]) {
  try {
    await ElMessageBox.confirm(`确定撤回 ${rows.length} 条已拒绝的投稿回到待审核？`, '撤回投稿', { type: 'warning' })
  } catch { return }
  const failed: string[] = []
  for (const row of rows) {
    try {
      await adminApi.update('submissions', row.id, {
        status: 'pending',
        reject_reason: null,
        rejected_at: null,
      })
    } catch (e: any) {
      failed.push(`「${row.song_data?.title || row.user_name}」：${e?.message || e}`)
    }
  }
  if (failed.length) ElMessageBox.alert(`已撤回 ${rows.length - failed.length} 条；${failed.length} 条失败：\n${failed.join('\n')}`, '撤回结果', { type: 'warning', customStyle: { whiteSpace: 'pre-line' } as any })
  else ElMessage.success(`已撤回 ${rows.length} 条，回到待审核`)
  clearSelection()
  await load()
}

/**
 * 撤回投稿（回到待审核，测试 / 误发布用）：
 * - 先按 published_refs 回收发布产物——删歌曲 → 删本次新建的专辑（若无其他歌引用）→
 *   删本次新建的艺术家（若无其他歌/专辑引用）→ 删本次新建的贡献者（若无其他歌引用）；
 *   沿用的库内实体不删，只回收「本次发布新建的」。不清理的话再次通过会重复建歌
 * - 投稿状态回 pending，清空 approved_at / published_refs
 */
async function recallSubmissions(rows: any[]) {
  if (!rows.length) {
    ElMessage.warning('没有可撤回的已通过投稿')
    return
  }
  const hint = rows.some(r => r.published_refs)
    ? `将先回收其发布产物（歌曲/本次新建的专辑/艺术家/贡献者，被其他内容引用的保留），再回到待审核`
    : `将回到待审核`
  try {
    await ElMessageBox.confirm(`确定撤回 ${rows.length} 条已通过的投稿？${hint}`, '撤回投稿', { type: 'warning' })
  } catch { return }

  // ===== 预读取阶段：引用判定数据批量拉取（约 7 个并行查询替代每行 5-6 个串行查询） =====
  const allRefs = rows.map(r => r.published_refs || {})
  const songIds = [...new Set(allRefs.map(f => f.song_id).filter(Boolean))] as string[]
  const directAlbumIds = [...new Set(allRefs.map(f => f.album_id).filter(Boolean))] as string[]
  const contributorIds = [...new Set(allRefs.map(f => f.contributor_id).filter(Boolean))] as string[]
  /** 艺术家删除候选 = 各行显式记录的新建艺术家（关系行里的库内艺术家不在删除范围） */
  const artistDeleteIds = [...new Set(allRefs.flatMap(f => f.artist_ids || []))] as string[]

  let contribRows: any[], songRows: any[], songsOfDirectAlbums: any[], albumContribDirect: any[], songsOfContributors: any[], usageSongRows: any[], usageArtistAlbumRows: any[]
  try {
    ;[contribRows, songRows, songsOfDirectAlbums, albumContribDirect, songsOfContributors, usageSongRows, usageArtistAlbumRows] = await Promise.all([
    // 删歌牵涉的艺术家（幸存者重算 types 用）
    songIds.length ? adminApi.getAll('song_contributors', { select: 'song_id,artist_id', in: { song_id: songIds } }) : Promise.resolve([]),
    // 本次删的歌挂的专辑（refs 未直接记 album_id 时经此反查）
    songIds.length ? adminApi.getAll('songs', { select: 'id,album_id', in: { id: songIds } }) : Promise.resolve([]),
    // 直引专辑的残余歌曲引用（判定专辑可删）
    directAlbumIds.length ? adminApi.getAll('songs', { select: 'id,album_id', in: { album_id: directAlbumIds } }) : Promise.resolve([]),
    // 直引专辑的艺术家（重算 types 用）
    directAlbumIds.length ? adminApi.getAll('album_contributors', { select: 'album_id,artist_id', in: { album_id: directAlbumIds } }) : Promise.resolve([]),
    // 贡献者的残余歌曲引用
    contributorIds.length ? adminApi.getAll('songs', { select: 'id,contributor_id', in: { contributor_id: contributorIds } }) : Promise.resolve([]),
    // 艺术家删除候选的全部歌曲关系行（判定可删：排除本次删歌后无引用）
    artistDeleteIds.length ? adminApi.getAll('song_contributors', { select: 'song_id,artist_id', in: { artist_id: artistDeleteIds } }) : Promise.resolve([]),
    // 艺术家删除候选的全部专辑关系行
    artistDeleteIds.length ? adminApi.getAll('album_contributors', { select: 'album_id,artist_id', in: { artist_id: artistDeleteIds } }) : Promise.resolve([]),
    ])
  } catch (e: any) {
    ElMessage.error('撤回失败，预读取引用数据出错：' + (e?.message || e))
    return
  }

  // 第二轮：歌曲挂载的额外专辑（refs 未直接记录的）
  const songAlbumIds = songRows.map((s: any) => s.album_id).filter(Boolean) as string[]
  const extraAlbumIds = [...new Set(songAlbumIds.filter(id => !directAlbumIds.includes(id)))]
  const [songsOfExtraAlbums, albumContribExtra] = extraAlbumIds.length
    ? await Promise.all([
        adminApi.getAll('songs', { select: 'id,album_id', in: { album_id: extraAlbumIds } }),
        adminApi.getAll('album_contributors', { select: 'album_id,artist_id', in: { album_id: extraAlbumIds } }),
      ])
    : [[], []]

  const allSongsByAlbum = [...songsOfDirectAlbums, ...songsOfExtraAlbums] as any[]
  const affectedArtists = new Set<string>([
    ...contribRows.map((r: any) => r.artist_id),
    ...[...albumContribDirect, ...albumContribExtra].map((r: any) => r.artist_id),
    ...artistDeleteIds,
  ])

  // ===== 内存判定：确认本次要删的专辑 / 各艺术家与贡献者是否仍被引用 =====
  const albumOfSong = new Map<string, string>(songRows.map((s: any) => [s.id, s.album_id].filter(Boolean) as [string, string]))
  /** 行关联的专辑：refs 直接记录的，或经本次歌曲反查的 */
  const rowAlbumId = (f: any) => f.album_id || albumOfSong.get(f.song_id)
  const delSongIds = new Set(songIds)
  const delAlbumIds = new Set<string>()
  for (const aid of [...new Set([...directAlbumIds, ...songAlbumIds])]) {
    const stillUsed = allSongsByAlbum.some((s: any) => s.album_id === aid && !delSongIds.has(s.id))
    if (!stillUsed) delAlbumIds.add(aid)
  }
  const artistStillUsed = (aid: string) =>
    usageSongRows.some((r: any) => r.artist_id === aid && !delSongIds.has(r.song_id)) ||
    usageArtistAlbumRows.some((r: any) => r.artist_id === aid && !delAlbumIds.has(r.album_id))
  const contributorStillUsed = (cid: string) =>
    songsOfContributors.some((s: any) => s.contributor_id === cid && !delSongIds.has(s.id))

  // ===== 删除阶段：分相执行（歌 → 专辑 → 艺术家 → 贡献者），只做删除不再查库。
  // 分相的原因：跨行共享实体必须等全部歌曲删完再判删，否则 FK RESTRICT 会拦住先行删除的行
  const failed: string[] = []
  const rowFailed = new Set<number>()
  const titleOf = (r: any) => r.song_data?.title || r.user_name
  const deletedArtists = new Set<string>()

  // 1) 歌曲（逐行定位失败行）；关系行随 FK CASCADE 自动清除
  for (let i = 0; i < rows.length; i++) {
    const refs = allRefs[i]
    if (!refs.song_id) continue
    try {
      await adminApi.remove('songs', refs.song_id)
    } catch (e: any) {
      rowFailed.add(i)
      failed.push(`「${titleOf(rows[i])}」歌曲回收失败：${e?.message || e}`)
    }
  }
  // 2) 专辑（本次新建且无残余引用的）；失败归因到引用它的行
  for (const aid of delAlbumIds) {
    try {
      await adminApi.remove('albums', aid)
      albums.value = albums.value.filter(a => a.id !== aid)
    } catch (e: any) {
      allRefs.forEach((f, i) => { if (rowAlbumId(f) === aid) rowFailed.add(i) })
      failed.push(`专辑 ${aid} 回收失败：${e?.message || e}`)
    }
  }
  // 3) 新建艺术家（FK RESTRICT 兜底：判定漏了引用数据库直接拦）
  for (const aid of artistDeleteIds) {
    if (deletedArtists.has(aid) || artistStillUsed(aid)) continue
    try {
      await adminApi.remove('artists', aid)
      deletedArtists.add(aid)
    } catch (e: any) {
      allRefs.forEach((f, i) => { if ((f.artist_ids || []).includes(aid)) rowFailed.add(i) })
      failed.push(`艺术家 ${aid} 回收失败：${e?.message || e}`)
    }
  }
  // 4) 新建贡献者
  for (const cid of contributorIds) {
    if (contributorStillUsed(cid)) continue
    try {
      await adminApi.remove('contributors', cid)
    } catch (e: any) {
      allRefs.forEach((f, i) => { if (f.contributor_id === cid) rowFailed.add(i) })
      failed.push(`贡献者 ${cid} 回收失败：${e?.message || e}`)
    }
  }

  // 幸存艺术家重算 types：types 由歌曲/专辑关联派生，删歌后清掉失去作品支撑的类型
  try {
    await recomputeArtistTypes([...affectedArtists].filter(id => !deletedArtists.has(id)))
  } catch (e: any) {
    console.warn('重算艺术家类型失败:', e?.message)
  }

  // 5) 状态回待审核（回收失败的行不回——refs 仍有效，留在已通过列表可重试撤回）
  const recallable = rows.filter((_, i) => !rowFailed.has(i))
  for (const row of recallable) {
    try {
      await adminApi.update('submissions', row.id, {
        status: 'pending',
        approved_at: null,
        published_refs: null,
      })
    } catch (e: any) {
      failed.push(`「${row.song_data?.title || row.user_name}」状态回退失败：${e?.message || e}`)
    }
  }

  if (failed.length) ElMessageBox.alert(`已撤回 ${recallable.length} 条；${failed.length} 条失败（详见列表）：\n${failed.join('\n')}`, '撤回结果', { type: 'warning', customStyle: { whiteSpace: 'pre-line' } as any })
  else ElMessage.success(`已撤回 ${recallable.length} 条，回到待审核`)
  clearSelection()
  await load()
}

/** 批量拒绝（列表多选）：一个原因应用到所有选中投稿，逐条更新 + 发邮件 */
async function batchReject() {
  const rows = selected.value.filter(s => s.status === 'pending')
  if (!rows.length) {
    ElMessage.warning('选中没有待审核投稿')
    return
  }
  let reason: string
  try {
    const { value } = await ElMessageBox.prompt(`将拒绝选中的 ${rows.length} 条投稿，请输入拒绝原因（对所有条目相同）`, '批量拒绝', {
      confirmButtonText: '确认拒绝',
      cancelButtonText: '取消',
      inputPattern: /.+/,
      inputErrorMessage: '拒绝原因不能为空',
    })
    reason = value
  } catch { return }
  let ok = 0
  const failed: string[] = []
  /** 邮箱一次性解析（投稿记录优先，回退贡献者资料），避免逐行查询 */
  const emailMap = await emailMapOf(rows)
  /** 按提交人聚合邮件（一封合并邮件代替逐首单发） */
  const mailGroups = new Map<string, { to: string; user_name: string; items: { title: string; result: 'reject'; reason?: string }[] }>()
  for (const row of rows) {
    try {
      await adminApi.update('submissions', row.id, {
        status: 'rejected',
        reject_reason: reason,
        rejected_at: new Date().toISOString(),
      })
      const to = emailMap.get(row.id) || ''
      const key = `${row.user_name}||${to || ''}`
      if (!mailGroups.has(key)) mailGroups.set(key, { to, user_name: row.user_name, items: [] })
      mailGroups.get(key)!.items.push({ title: row.song_data?.title || '资料更新', result: 'reject', reason })
      ok++
    } catch (e: any) {
      failed.push(`「${row.song_data?.title || row.user_name}」`)
    }
  }
  for (const g of mailGroups.values()) {
    if (!g.to) continue
    notifyByEmail({ action: 'batch', to: g.to, user_name: g.user_name, items: g.items }, '批量拒绝', g.user_name)
  }
  const noMail = [...mailGroups.values()].filter(g => !g.to).map(g => g.user_name)
  if (noMail.length) {
    console.warn('[邮件未通知] 未留邮箱且资料无邮箱:', noMail.join('、'))
    ElMessage.warning(`未通知邮件（未留邮箱）：${noMail.join('、')}`)
  }
  if (failed.length) ElMessageBox.alert(`成功拒绝 ${ok} 条，失败 ${failed.length} 条：${failed.join('、')}`, '批量拒绝结果', { type: 'warning' })
  else ElMessage.success(`已拒绝 ${ok} 条投稿`)
  clearSelection()
  await load()
}

// ============ 批量审核（Excel 式：行=投稿 列=字段，列头统一填充 + 单元格微调 + 一键全部发布） ============
const showBatchReview = ref(false)
const batchPublishing = ref(false)
/** 行数据：row 为原始投稿记录（id/user_name/投稿人联系方式等），sd 为规范化后的编辑态 song_data；
 *  decision 为行级审核决定（approve 默认 / reject），rejectReason 仅 reject 时有值 */
const batchRows = ref<{ row: any; sd: any; decision: 'approve' | 'reject'; rejectReason?: string }[]>([])
/** 批量表内勾选的行（列头 ⚡ 仅应用到勾选行；空 = 全部行） */
const batchSelected = ref<{ row: any; sd: any; decision: 'approve' | 'reject'; rejectReason?: string }[]>([])

/** 移动端卡片勾选：与桌面表格勾选共用 batchSelected（列头 ⚡ / 勾选拒绝的语义不变） */
function cardChecked(r: { row: any }): boolean {
  return batchSelected.value.some(s => s.row.id === r.row.id)
}
function toggleBatchSel(r: { row: any; sd: any; decision: 'approve' | 'reject'; rejectReason?: string }) {
  const i = batchSelected.value.findIndex(s => s.row.id === r.row.id)
  if (i >= 0) batchSelected.value.splice(i, 1)
  else batchSelected.value.push(r)
}

/** 移动端：当前展开歌词的卡片（单开，避免多张长歌词堆叠） */
const lyricOpenId = ref<string | null>(null)

/** 移动端：当前展开编辑的卡片（单开；收起即一行一歌，可纵览全批） */
const expandedId = ref<string | null>(null)
/** 移动端工具条全选：与桌面勾选共用 batchSelected */
const allChecked = computed(() => batchRows.value.length > 0 && batchSelected.value.length === batchRows.value.length)
function toggleAll(v: any) {
  batchSelected.value = v ? [...batchRows.value] : []
}

/** 移出一行（桌面/移动共用）：同步移出勾选，避免遗留选中行污染「勾选拒绝」计数与 ⚡ 填充范围 */
function removeBatchRow(idx: number) {
  const [r] = batchRows.value.splice(idx, 1)
  if (r) {
    const si = batchSelected.value.indexOf(r)
    if (si >= 0) batchSelected.value.splice(si, 1)
  }
}

const FILL_LABELS: Record<string, string> = {
  artists: '歌手', lyricist_arr: '作词', composer_arr: '作曲', arranger_arr: '编曲',
  album: '专辑', track: '曲目号', genres: '风格', cover: '单曲封面',
}

/** 歌手单元格头像：按 id 从本地艺术家池取（新建/未入库返回空 → 显示首字母占位） */
function artistAvatar(id: string | null): string | undefined {
  if (!id) return undefined
  return artists.value.find(a => a.id === id)?.avatar || undefined
}

/** 专辑单元格封面：行内填的优先（新专辑补全值），其次按 album_id 从库内取 */
function albumCoverOf(sd: any): string | undefined {
  return sd?.album_cover || albums.value.find(a => a.id === sd?.album_id)?.cover || undefined
}

/** 单曲审核：专辑信息弹窗（点专辑卡片开关） */
const showAlbumDialog = ref(false)

function openBatchReview() {
  const rows = selected.value.filter(s => s.status === 'pending' && s.song_data?.type !== 'profile')
  if (!rows.length) {
    ElMessage.warning('选中中没有待审核的歌曲投稿（资料更新类请单曲审核）')
    return
  }
  batchRows.value = rows.map(r => ({ row: r, sd: normalizeSubmission(r), decision: 'approve' as const }))
  batchSelected.value = []
  filteredAlbums.value = albums.value
  showBatchReview.value = true
}

/** 一键批量审核当前全部待审核歌曲（无需勾选；受搜索框过滤影响——搜了就只处理搜出来的） */
function openBatchReviewAll() {
  const rows = listSource.value.filter((s: any) => s.song_data?.type !== 'profile')
  if (!rows.length) {
    ElMessage.warning('当前没有待审核的歌曲投稿')
    return
  }
  batchRows.value = rows.map(r => ({ row: r, sd: normalizeSubmission(r), decision: 'approve' as const }))
  batchSelected.value = []
  filteredAlbums.value = albums.value
  showBatchReview.value = true
}

/** 批次行「审核整批」：批量审核弹窗范围 = 该批全部待审核投稿 */
function openBatchReviewForBatch(entry: ListEntry) {
  const rows = (entry.rows || []).filter((r: any) => r.status === 'pending')
  if (!rows.length) {
    ElMessage.warning('该批次没有待审核的投稿')
    return
  }
  batchRows.value = rows.map(r => ({ row: r, sd: normalizeSubmission(r), decision: 'approve' as const }))
  batchSelected.value = []
  filteredAlbums.value = albums.value
  showBatchReview.value = true
}

/** 行级决定：标记为通过（清除拒绝原因） */
function setDecision(idx: number, d: 'approve' | 'reject') {
  const r = batchRows.value[idx]
  if (!r) return
  r.decision = d
  if (d === 'approve') r.rejectReason = ''
}

/** 行间艺术家 ID 同步：任一行已确定的 ID（手填 / 发布时新建）→ 回填其他行的同名字段，
 *  避免同一艺术家每行都要补一遍 ID（行状态徽标随之从「待补」变「就绪」） */
function syncBatchArtistRefs() {
  const known = new Map<string, string>()
  for (const r of batchRows.value) {
    for (const f of ARTIST_FIELDS) {
      for (const item of r.sd[f.key] || []) {
        if (item?.id) known.set(item.name.toLowerCase(), item.id)
      }
    }
  }
  for (const r of batchRows.value) {
    for (const f of ARTIST_FIELDS) {
      for (const item of r.sd[f.key] || []) {
        if (!item || item.id) continue
        const id = known.get(item.name.toLowerCase())
        if (id) {
          item.id = id
          item._new = false
        }
      }
    }
  }
}

/** 行数据完整性检查：新建艺术家缺 ID / 同名歧义 → 阻碍提交的问题列表（与 collectNewArtists 的待建判定一致） */
function rowIssues(sd: any): string[] {
  const issues: string[] = []
  for (const f of ARTIST_FIELDS) {
    for (const item of sd[f.key] || []) {
      if (!item || (!item._new && item.id)) continue
      if (String(item.id || '').trim()) continue
      const hits = artists.value.filter(a => a.name.toLowerCase() === item.name.toLowerCase())
      if (hits.length >= 2) issues.push(`${f.label}「${item.name}」同名歧义（库内 ${hits.length} 位，需人工选择）`)
      else issues.push(`${f.label}「${item.name}」待填 ID`)
    }
  }
  return issues
}

/** 待补行的第一个缺 ID 字段（点「待补 ID」徽标直达该字段编辑弹窗） */
function firstIssueField(sd: any): string {
  for (const f of ARTIST_FIELDS) {
    for (const item of sd[f.key] || []) {
      if (!item || (!item._new && item.id)) continue
      if (!String(item.id || '').trim()) return f.key
    }
  }
  return 'artists'
}

/** 底部提交按钮统计：就绪（可提交）/ 待补（缺 ID）/ 拒绝 */
const batchStats = computed(() => {
  let ready = 0
  let blocked = 0
  let rejected = 0
  for (const r of batchRows.value) {
    if (r.decision === 'reject') rejected++
    else if (rowIssues(r.sd).length) blocked++
    else ready++
  }
  return { ready, blocked, rejected }
})

/** 行级决定：标记为拒绝，弹原因框（取消则不改变标记） */
async function markReject(idx: number) {
  const r = batchRows.value[idx]
  if (!r) return
  let reason: string
  try {
    const { value } = await ElMessageBox.prompt(`拒绝「${r.sd.title || r.row.user_name}」，请输入拒绝原因`, '标记为拒绝', {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      inputValue: r.rejectReason || '',
      inputPattern: /.+/,
      inputErrorMessage: '拒绝原因不能为空',
    })
    reason = value
  } catch { return }
  r.decision = 'reject'
  r.rejectReason = reason
}

/** 按标记提交：拒绝行 → 更新状态 + 拒绝邮件；通过行 → 与单曲审核相同的发布链。同名歧义 / 新建艺术家未填 ID 自动跳过并汇总 */
async function publishBatch() {
  if (!batchRows.value.length) return
  // 校验：拒绝行必须有原因
  const noReason = batchRows.value.filter(r => r.decision === 'reject' && !r.rejectReason)
  if (noReason.length) {
    ElMessage.warning(`有 ${noReason.length} 行标记为拒绝但未填原因，请点击其「拒绝」补填`)
    return
  }
  // 预检前先做行间 ID 同步（其他行已确定的同名人 ID 自动补过来）
  syncBatchArtistRefs()
  // 预检：通过行有缺 ID / 同名歧义 → 阻止提交并逐行列明（不再静默跳过，全程可感知）
  const blockedRows = batchRows.value.filter(r => r.decision !== 'reject' && rowIssues(r.sd).length)
  if (blockedRows.length) {
    ElMessageBox.alert(
      `以下 ${blockedRows.length} 行数据不完整，补全（点行内「待补 ID」徽标）或标为拒绝后才能提交：\n`
      + blockedRows.map(r => `·「${r.sd.title || r.row.user_name}」：${rowIssues(r.sd).join('；')}`).join('\n'),
      '无法提交',
      { type: 'warning', customStyle: { whiteSpace: 'pre-line' } as any },
    )
    return
  }
  batchPublishing.value = true
  let ok = 0
  let rejected = 0
  const skipped: string[] = []
  const failed: string[] = []
  /** 邮箱一次性解析（投稿记录优先，回退贡献者资料），避免逐行查询 */
  const emailMap = await emailMapOf(batchRows.value.map(b => b.row))
  /** 按提交人聚合的邮件结果（一封合并邮件覆盖该提交人本次被处理的所有投稿） */
  const mailGroups = new Map<string, { to: string; user_name: string; items: { title: string; result: 'approve' | 'reject'; reason?: string }[] }>()
  const mailKeyOf = (row: any) => `${row.user_name}||${emailMap.get(row.id) || ''}`
  const addMailItem = (row: any, title: string, result: 'approve' | 'reject', reason?: string) => {
    const key = mailKeyOf(row)
    if (!mailGroups.has(key)) mailGroups.set(key, { to: emailMap.get(row.id) || '', user_name: row.user_name, items: [] })
    mailGroups.get(key)!.items.push({ title, result, reason })
  }
  // 1) 拒绝行：直接落库（邮件合并到批尾发）
  for (const { row, sd, decision, rejectReason } of batchRows.value) {
    if (decision !== 'reject') continue
    const title = sd.title || row.user_name
    try {
      await adminApi.update('submissions', row.id, {
        status: 'rejected',
        reject_reason: rejectReason,
        rejected_at: new Date().toISOString(),
      })
      addMailItem(row, title, 'reject', rejectReason)
      rejected++
    } catch {
      failed.push(`「${title}」（拒绝失败）`)
    }
  }
  // 2) 通过行：发布链（单曲邮件跳过，合并到批尾发）
  for (const { row, sd, decision } of batchRows.value) {
    if (decision === 'reject') continue
    const title = sd.title || row.user_name
    // 同名歧义（库内同名人 ≥2 且未带 ID）程序无法判断 → 跳过待人工处理
    let ambiguous = false
    for (const f of ARTIST_FIELDS) {
      for (const item of sd[f.key] || []) {
        if (!item || item.id) continue
        if (artists.value.filter(a => a.name.toLowerCase() === item.name.toLowerCase()).length >= 2) ambiguous = true
      }
    }
    if (ambiguous) {
      skipped.push(`「${title}」同名歧义`)
      continue
    }
    const res = await publishSubmission({ ...row, edited_data: sd }, collectNewArtists(sd), true, true)
    if (res === 'ok') {
      ok++
      addMailItem(row, title, 'approve')
    }
    else if (res === 'missing') skipped.push(`「${title}」新建艺术家未填 ID`)
    else failed.push(`「${title}」`)
  }
  // 3) 邮件：按提交人合并成一封（未留邮箱的组汇总提示，不再静默）
  for (const g of mailGroups.values()) {
    if (!g.to) continue
    notifyByEmail({ action: 'batch', to: g.to, user_name: g.user_name, items: g.items }, '批量结果', g.user_name)
  }
  const noMail = [...mailGroups.values()].filter(g => !g.to).map(g => g.user_name)
  if (noMail.length) {
    console.warn('[邮件未通知] 未留邮箱且资料无邮箱:', noMail.join('、'))
    ElMessage.warning(`未通知邮件（未留邮箱）：${noMail.join('、')}`)
  }
  batchPublishing.value = false

  const parts: string[] = []
  if (ok) parts.push(`成功发布 ${ok} 条`)
  if (rejected) parts.push(`拒绝 ${rejected} 条`)
  if (skipped.length) parts.push(`跳过 ${skipped.length} 条：${skipped.join('、')}`)
  if (failed.length) parts.push(`失败 ${failed.length} 条：${failed.join('、')}（详见控制台）`)
  if (skipped.length || failed.length) ElMessageBox.alert(parts.join('\n'), '批量审核结果', { type: 'warning', customStyle: { whiteSpace: 'pre-line' } as any })
  else ElMessage.success(parts.join('，'))
  showBatchReview.value = false
  clearSelection()
  await load()
}

/** 批量审核弹窗内：把勾选的行统一标记为拒绝（一个原因），不实际落库——之后统一走「按标记提交」按批发邮件 */
async function rejectBatchRows() {
  const rows = [...batchSelected.value]
  if (!rows.length) return
  let reason: string
  try {
    const { value } = await ElMessageBox.prompt(`将勾选的 ${rows.length} 行标记为拒绝，请输入拒绝原因（对所有条目相同；点「按标记提交」才实际生效）`, '标记为拒绝', {
      confirmButtonText: '确认',
      cancelButtonText: '取消',
      inputPattern: /.+/,
      inputErrorMessage: '拒绝原因不能为空',
    })
    reason = value
  } catch { return }
  const ids = new Set(rows.map(r => r.row.id))
  let marked = 0
  for (const r of batchRows.value) {
    if (ids.has(r.row.id)) {
      r.decision = 'reject'
      r.rejectReason = reason
      marked++
    }
  }
  ElMessage.success(`已将 ${marked} 行标记为拒绝（统一原因），请点击「按标记提交」生效`)
}

// ---------- 填充/编辑弹窗（列头 ⚡ = 全部行；单元格点击 = 仅该行，预填当前值） ----------
const showFill = ref(false)
const fillKey = ref('')
const fillRowIndex = ref(-1) // -1 = 应用到全部行；≥0 = 仅该行
const fillText = ref('')
const fillArtists = ref<any[]>([])
const fillAlbum = ref('')
const fillGenres = ref<string[]>([])

function openFill(key: string, rowIndex = -1) {
  // 单行专辑编辑：直接打开共用 AlbumInfoDialog（保存即入库/写回，与单曲审核同款）
  if (key === 'album' && rowIndex >= 0) {
    openBatchAlbumDialog(rowIndex)
    return
  }
  fillKey.value = key
  fillRowIndex.value = rowIndex
  const sd = rowIndex >= 0 ? batchRows.value[rowIndex].sd : null
  fillText.value = sd ? String(sd[key] ?? '') : ''
  fillArtists.value = sd ? JSON.parse(JSON.stringify(sd[key] || [])) : []
  fillAlbum.value = sd ? (sd.album_id || sd.album || '') : ''
  fillGenres.value = sd ? [...(sd.genres || [])] : []
  showFill.value = true
}

/** 批量审核单行专辑编辑：打开 AlbumInfoDialog，预填该行当前值 */
const showBatchAlbum = ref(false)
const batchAlbumRowIndex = ref(-1)
function openBatchAlbumDialog(rowIndex: number) {
  batchAlbumRowIndex.value = rowIndex
  showBatchAlbum.value = true
}
/** 单行专辑保存成功 → 回填该行关联 + 更新本地专辑池（⚡下拉即时刷新） */
function onBatchAlbumSaved(p: { albumId: string; name: string; year: number | null; cover: string; description: string | null; artistIds: string[] }) {
  const row = batchRows.value[batchAlbumRowIndex.value]
  if (row) {
    row.sd.album = p.name
    row.sd.album_id = p.albumId
    row.sd.album_cover = p.cover
    row.sd.year = p.year ?? ''
    row.sd.album_desc = p.description || ''
  }
  onAlbumSaved(p)
}

const isFillAll = computed(() => fillRowIndex.value < 0)

function applyFill() {
  const key = fillKey.value
  const isArtistCol = ['artists', 'album_artists', 'lyricist_arr', 'composer_arr', 'arranger_arr'].includes(key)
  if (isArtistCol && !fillArtists.value.length) {
    ElMessage.warning('请至少选择一位艺术家，或取消')
    return
  }
  if (key === 'album' && !fillAlbum.value.trim()) {
    ElMessage.warning('请选择或输入专辑名，或取消')
    return
  }
  if (!isArtistCol && key !== 'album' && key !== 'genres' && !fillText.value.trim()) {
    ElMessage.warning('值不能为空，或取消')
    return
  }
  const targets = isFillAll.value ? (batchSelected.value.length ? batchSelected.value : batchRows.value) : [batchRows.value[fillRowIndex.value]]
  for (const r of targets) {
    if (isArtistCol) {
      // 逐行深拷贝，避免多行共享同一 tag 对象（发布时回填 ID/_new 会互相串）
      r.sd[key] = JSON.parse(JSON.stringify(fillArtists.value))
    } else if (key === 'album') {
      // 批量覆盖：只设关联（专辑信息编辑走行内 AlbumInfoDialog，保存即入库）
      const hit = albums.value.find(a => a.id === fillAlbum.value)
      r.sd.album_id = hit ? hit.id : null
      r.sd.album = hit ? hit.name : fillAlbum.value.trim()
    } else if (key === 'genres') {
      r.sd.genres = [...fillGenres.value]
    } else {
      r.sd[key] = fillText.value.trim()
    }
  }
  showFill.value = false
  // 单行补了艺术家 ID → 同步到其他行的同名字段（省得每行补一遍）
  if (isArtistCol || key === 'album') syncBatchArtistRefs()
  const scopeText = isFillAll.value
    ? (batchSelected.value.length ? `勾选的 ${batchSelected.value.length} 行` : `全部 ${batchRows.value.length} 行`)
    : '该行'
  ElMessage.success(`已将「${FILL_LABELS[key]}」应用到${scopeText}`)
}

const statusTagType = (s: string): any => ({ pending: 'warning', approved: 'success', rejected: 'danger' }[s] || 'info')
const statusText = (s: string) => ({ pending: '待审核', approved: '已通过', rejected: '已拒绝' }[s] || s)
const formatTime = (t: string) => (t ? new Date(t).toLocaleString('zh-CN') : '')
</script>
