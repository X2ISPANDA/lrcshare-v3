<template>
  <el-dialog v-model="visible" :title="editing ? '编辑歌曲' : title" width="880px" :close-on-click-modal="false">
    <el-form :model="form" label-width="84px">
      <!-- 投稿信息区块（审核模式）：提交人/时间/备注/同名警示/TTML 原文 -->
      <div v-if="mode === 'review' && submissionInfo" class="mb-4 p-3 bg-gray-50 border border-gray-200 rounded-lg space-y-1.5 text-sm">
        <div class="flex flex-wrap gap-x-6 gap-y-1">
          <span v-if="submissionInfo.submitter"><span class="text-gray-500">提交人：</span>{{ submissionInfo.submitter }}</span>
          <span v-if="submissionInfo.contact"><span class="text-gray-500">联系方式：</span>{{ submissionInfo.contact }}</span>
          <span v-if="submissionInfo.time"><span class="text-gray-500">时间：</span>{{ submissionInfo.time }}</span>
        </div>
        <div v-if="submissionInfo.note" class="text-gray-600 break-all">{{ submissionInfo.note }}</div>
        <div v-if="submissionInfo.duplicateWarn" class="text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1">{{ submissionInfo.duplicateWarn }}</div>
        <details v-if="submissionInfo.ttmlText" class="text-xs">
          <summary class="cursor-pointer text-blue-600 select-none">查看 TTML 原文</summary>
          <pre class="mt-1 max-h-56 overflow-y-auto bg-white border border-gray-200 rounded p-2 whitespace-pre-wrap font-mono text-[11px]">{{ submissionInfo.ttmlText }}</pre>
        </details>
      </div>
      <el-row :gutter="16">
        <el-col :span="12"><el-form-item label="歌曲名" required><el-input v-model="form.title" placeholder="歌曲标题" /></el-form-item></el-col>
        <el-col :span="6"><el-form-item label="时长"><el-input v-model="form.duration" placeholder="03:30" /></el-form-item></el-col>
        <el-col :span="6"><el-form-item label="曲目号"><el-input-number v-model="form.track" :min="0" class="!w-full" /></el-form-item></el-col>
      </el-row>

      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="别名">
            <el-select v-model="form.aliases" multiple filterable allow-create default-first-option clearable placeholder="别名/译名（回车添加，参与搜索）" class="w-full">
              <el-option v-for="a in form.aliases" :key="a" :label="a" :value="a" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="16">
        <el-col :span="12">
          <el-form-item label="歌手" required>
            <ArtistTagInput v-model="form.artists" :artists="artists" filter-type="singer" admin @artist-saved="onArtistSaved" />
          </el-form-item>
        </el-col>
        <el-col :span="12">
          <el-form-item label="专辑" :required="requireAlbum">
            <div class="relative w-full">
              <input
                v-model="form.albumName"
                class="w-full min-h-[42px] px-3 border border-gray-200 rounded-lg text-sm outline-none focus:ring-2 focus:ring-pink-500"
                :placeholder="requireAlbum ? '搜索已有专辑，或输入新专辑名' : '选填：搜索已有专辑，或输入新专辑名'"
                @input="onAlbumInput"
                @focus="form.albumName && onAlbumInput()"
                @blur="albumDropdownOpen = false"
              />
              <div v-if="albumDropdownOpen && albumDropdown.length" class="absolute z-10 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-52 overflow-y-auto">
                <div
                  v-for="a in albumDropdown"
                  :key="a.id"
                  class="px-4 py-2 hover:bg-pink-50 cursor-pointer border-b border-gray-100 text-sm"
                  @mousedown.prevent="selectAlbum(a)"
                >
                  <span class="font-medium text-gray-800">{{ a.name }}</span>
                  <span v-if="a.year" class="text-xs text-gray-400 ml-2">{{ a.year }}</span>
                </div>
              </div>
            </div>
            <!-- 专辑信息卡片（与单曲审核同款）：点击打开 AlbumInfoDialog，保存即入库/写回 -->
            <button
              v-if="form.albumName.trim()"
              type="button"
              class="w-full mt-1.5 flex items-center gap-2 p-1.5 rounded-lg border border-gray-200 hover:border-pink-300 hover:bg-pink-50/50 transition text-left"
              @click="openAlbumInfo"
            >
              <img v-if="albumCoverOfForm" :src="albumCoverOfForm" class="w-8 h-8 rounded object-cover flex-shrink-0" />
              <span v-else class="w-8 h-8 rounded bg-gray-200 text-gray-500 flex items-center justify-center flex-shrink-0 text-sm">💿</span>
              <span class="min-w-0 flex-1">
                <span class="block text-xs text-gray-700 truncate">{{ form.albumName }}</span>
                <span class="block text-[11px] text-gray-400">点击{{ form.albumId ? '查看 / 更新专辑信息（保存即写回库）' : '补全专辑信息（保存即入库）' }}（封面 / 艺术家 / 年份 / 简介）</span>
              </span>
              <el-tag v-if="form.albumId" size="small" type="success" class="shrink-0">已关联</el-tag>
              <el-tag v-else size="small" type="warning" class="shrink-0">新建</el-tag>
            </button>
          </el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="8">
        <el-col :span="8">
          <el-form-item label="作词"><ArtistTagInput v-model="form.lyricists" :artists="artists" filter-type="lyricist" admin @artist-saved="onArtistSaved" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="作曲"><ArtistTagInput v-model="form.composers" :artists="artists" filter-type="composer" admin @artist-saved="onArtistSaved" /></el-form-item>
        </el-col>
        <el-col :span="8">
          <el-form-item label="编曲"><ArtistTagInput v-model="form.arrangers" :artists="artists" filter-type="arranger" admin @artist-saved="onArtistSaved" /></el-form-item>
        </el-col>
      </el-row>

      <el-row :gutter="16">
        <el-col v-if="!hideContributor" :span="12">
          <el-form-item label="贡献者">
            <div class="w-full">
              <el-select v-model="form.contributor_id" filterable clearable :disabled="!contributorUnlock" placeholder="歌词提交者（选填）" class="w-full">
                <el-option v-for="c in contributors" :key="c.id" :label="c.name + '（' + (c.tags?.join(', ') || '歌词贡献') + '）'" :value="c.id" />
              </el-select>
              <el-checkbox v-model="contributorUnlock" size="small" class="mt-1" @change="onContributorUnlockChange">修改贡献者</el-checkbox>
            </div>
          </el-form-item>
        </el-col>
        <el-col :span="hideContributor ? 24 : 12">
          <el-form-item label="风格">
            <el-select v-model="form.genres" multiple filterable allow-create clearable default-first-option placeholder="选择或输入风格标签" class="w-full">
              <el-option v-for="g in GENRE_OPTIONS" :key="g" :label="g" :value="g" />
            </el-select>
          </el-form-item>
        </el-col>
      </el-row>

      <el-form-item label="视频链接">
        <el-input v-model="form.video_url" placeholder="B站 / YouTube 链接（选填）" />
      </el-form-item>

      <el-form-item label="歌曲简介">
        <div class="w-full">
          <div class="flex gap-1 mb-1.5 flex-wrap">
            <el-button v-for="(icon, type) in TIP_ICONS" :key="type" size="small" @click="insertTip(type)">{{ icon }}</el-button>
          </div>
          <el-input v-model="form.description" type="textarea" :rows="2" placeholder="Markdown 格式，选填。上方按钮插入提示框标签" />
        </div>
      </el-form-item>
      <div v-if="form.description" class="mx-0 mb-3 ml-[84px] p-3 border border-gray-200 rounded bg-gray-50 max-h-40 overflow-y-auto text-sm" v-html="descPreview"></div>

      <el-form-item v-if="requireLyrics" label="歌词" required>
        <el-tabs v-model="lyricsTab" type="card" class="w-full">
          <el-tab-pane label="LRC 歌词" name="lrc">
            <!-- 版本管理：多 LRC 版本并存（同语言变体如简/繁体），写法对齐 TTML tab -->
            <div class="flex items-center gap-2 mb-2 flex-wrap">
              <el-select v-if="versionForms.length > 1" v-model="activeLrcIdx" size="small" class="!w-48">
                <el-option v-for="(v, i) in versionForms" :key="i" :label="`版本 ${i + 1} · ${LYRIC_KIND_LABEL[v.kind]} · ${langLabel(v.lang)}`" :value="i" />
              </el-select>
              <span class="text-xs text-gray-500 shrink-0">语言</span>
              <el-select v-model="activeLrcLang" filterable allow-create default-first-option size="small" class="!w-32">
                <el-option v-for="l in activeLrcLangOptions" :key="l" :label="langLabel(l)" :value="l" />
              </el-select>
              <span class="text-xs text-gray-500 shrink-0">类型</span>
              <el-select v-model="activeLrcKind" size="small" class="!w-28">
                <el-option v-for="(label, k) in LYRIC_KIND_LABEL" :key="k" :label="label" :value="k" />
              </el-select>
              <div class="flex-1"></div>
              <el-button size="small" @click="addLrcVersion">+ 添加版本</el-button>
              <el-button link type="danger" size="small" @click="removeLrcVersion(activeLrcIdx)">删除此版本</el-button>
            </div>
            <!-- 双区：左 LRC 源码（当前版本，可编辑），右 纯文本（按行对应生成/更新变体）；两侧同步滚动 -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div class="text-xs text-gray-500 mb-1">LRC 源码（当前版本）</div>
                <el-input :ref="el => bindSyncScroll(el, 'lrc')" v-model="activeLrcSource" type="textarea" :rows="10" placeholder="粘贴当前版本的 LRC；粘贴整体多语言 LRC 会自动拆分替换全部版本" class="font-mono!" />
              </div>
              <div>
                <div class="text-xs text-gray-500 mb-1">纯文本歌词</div>
                <el-input :ref="el => bindSyncScroll(el, 'lrcPlain')" v-model="activeLrcPlain" type="textarea" :rows="10" placeholder="粘贴纯文本歌词：本版本有 LRC 则原位更新文字（改错字），否则以原文版本为模板生成变体（简↔繁等，时间戳/词级结构照抄；行数词数需一致）" class="font-mono!" />
              </div>
            </div>
            <div class="flex items-center gap-2 mt-1">
              <div class="text-xs text-gray-400 flex-1">两侧内容永久保留，随时修改；下方预览为最终入库的合成 LRC。</div>
            </div>
            <details open class="mt-2">
              <summary class="cursor-pointer text-xs text-blue-600 select-none">预览（最终入库 LRC，只读）</summary>
              <pre class="mt-1 max-h-56 overflow-y-auto bg-gray-50 border border-gray-200 rounded p-2 whitespace-pre-wrap font-mono text-[11px]">{{ lrcPreview }}</pre>
            </details>
          </el-tab-pane>
          <el-tab-pane label="TTML 原文" name="ttml">
            <!-- 版本管理：多 TTML 版本并存（同语言变体如简/繁体）+ 正文语言标注（入库 langs 首位，替代盲猜） -->
            <div class="flex items-center gap-2 mb-2 flex-wrap">
              <el-select v-if="ttmlVersions.length > 1" v-model="activeTtmlIdx" size="small" class="!w-44">
                <el-option v-for="(v, i) in ttmlVersions" :key="i" :label="`版本 ${i + 1} · ${langLabel(v.model.bodyLang || 'zh')}`" :value="i" />
              </el-select>
              <span class="text-xs text-gray-500 shrink-0">正文语言</span>
              <el-select v-model="activeTtmlBodyLang" filterable allow-create default-first-option size="small" class="!w-36">
                <el-option v-for="l in LYRIC_LANG_OPTIONS" :key="l" :label="langLabel(l)" :value="l" />
              </el-select>
              <div class="flex-1"></div>
              <el-button size="small" @click="addTtmlVersion">+ 添加版本</el-button>
              <el-button link type="danger" size="small" @click="removeTtmlVersion(activeTtmlIdx)">删除此版本</el-button>
            </div>
            <!-- 双区：左 TTML 源码（可编辑），右 纯文本（按行对应生成/更新正文）；两侧同步滚动 -->
            <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <div class="text-xs text-gray-500 mb-1">TTML 源码</div>
                <el-input :ref="el => bindSyncScroll(el, 'ttml')" v-model="activeTtmlSource" type="textarea" :rows="10" placeholder="粘贴完整 TTML（对唱/分屏/样式零丢失，翻译/音译自动提取到表格）" class="font-mono!" />
              </div>
              <div>
                <div class="text-xs text-gray-500 mb-1">纯文本歌词</div>
                <el-input :ref="el => bindSyncScroll(el, 'ttmlPlain')" v-model="activeTtmlPlain" type="textarea" :rows="10" placeholder="粘贴纯文本歌词：本版本有结构则原位更新文字（改错字），否则以另一版本为模板生成变体（简↔繁逐字对应，词级时间照抄；行数词数需一致）" class="font-mono!" />
              </div>
            </div>
            <div class="flex items-center gap-2 mt-1">
              <div class="text-xs text-gray-400 flex-1">两侧内容永久保留，随时修改；下方预览为最终入库的完整 TTML。</div>
            </div>
            <details open class="mt-2">
              <summary class="cursor-pointer text-xs text-blue-600 select-none">预览（最终入库 TTML，只读）</summary>
              <pre class="mt-1 max-h-56 overflow-y-auto bg-gray-50 border border-gray-200 rounded p-2 whitespace-pre-wrap font-mono text-[11px]">{{ ttmlPreview }}</pre>
            </details>

            <!-- 翻译表格：L1~LN 每行一格（留空=未翻译），按 itunes:key 与正文行一一对应 -->
            <div v-if="ttmlEdit.lines.length" class="mt-3">
              <div v-for="(t, ti) in ttmlEdit.translations" :key="ti" class="border border-gray-200 rounded-lg p-3 mb-2">
                <div class="flex items-center gap-2 mb-2">
                  <span class="text-xs text-gray-500">翻译</span>
                  <el-select v-model="t.lrcLang" filterable allow-create default-first-option size="small" class="!w-40">
                    <el-option v-for="l in LYRIC_LANG_OPTIONS" :key="l" :label="langLabel(l)" :value="l" />
                  </el-select>
                  <span v-if="t.ttmlLang && t.ttmlLang !== t.lrcLang" class="text-xs text-gray-400">xml:lang={{ t.ttmlLang }}</span>
                  <div class="flex-1"></div>
                  <el-button link type="danger" size="small" @click="ttmlEdit.translations.splice(ti, 1); batchPaste.trans.splice(ti, 1)">删除</el-button>
                </div>
                <div class="max-h-60 overflow-y-auto">
                  <div v-for="ln in t.lines" :key="ln.for" class="flex items-center gap-2 py-1 border-b border-gray-100 last:border-0">
                    <span class="w-9 shrink-0 text-xs text-gray-400 pt-0.5">{{ ln.for }}</span>
                    <span class="w-2/5 shrink-0 text-xs text-gray-500 pt-0.5 truncate" :title="ttmlLineText(ln.for)">{{ ttmlLineText(ln.for) }}</span>
                    <el-input v-model="ln.text" size="small" placeholder="该行翻译（留空=未翻译）" class="flex-1" />
                  </div>
                </div>
                <details class="mt-2">
                  <summary class="cursor-pointer text-xs text-blue-600 select-none">批量粘贴</summary>
                  <div class="mt-1.5">
                    <el-input v-model="batchPaste.trans[ti]" type="textarea" :rows="6" placeholder="整块粘贴：每行按顺序对应 L1~LN 翻译；某行没有翻译就空一行（补回车对齐）" class="font-mono!" />
                    <div class="flex items-center gap-2 mt-1">
                      <span class="text-xs flex-1" :class="batchCount(batchPaste.trans[ti]) === t.lines.length ? 'text-green-600' : 'text-red-500'">
                        已粘贴 {{ batchCount(batchPaste.trans[ti]) }} 行 / 表格 {{ t.lines.length }} 行{{ batchCount(batchPaste.trans[ti]) === t.lines.length ? '（可填入）' : '（行数需一致：多删少补空行）' }}
                      </span>
                      <el-button size="small" @click="fillBatch('trans', ti)">按行填入</el-button>
                    </div>
                  </div>
                </details>
              </div>
              <el-button size="small" @click="addTtmlTrack('translation')">+ 添加翻译语言</el-button>
            </div>

            <!-- 音译表格：空格分词、{LSU,词 组} 多字并位、{LSJ,原词,N} 跳词；行下显示词级对应预览 -->
            <div v-if="ttmlEdit.lines.length" class="mt-3">
              <div v-for="(tr, ri) in ttmlEdit.transliterations" :key="ri" class="border border-gray-200 rounded-lg p-3 mb-2">
                <div class="flex items-center gap-2 mb-2">
                  <span class="text-xs text-gray-500">音译</span>
                  <el-select v-model="tr.lrcLang" filterable allow-create default-first-option size="small" class="!w-40">
                    <el-option v-for="l in TRANSLIT_LANG_OPTIONS" :key="l" :label="langLabel(l)" :value="l" />
                  </el-select>
                  <span v-if="tr.ttmlLang && tr.ttmlLang !== tr.lrcLang" class="text-xs text-gray-400">xml:lang={{ tr.ttmlLang }}</span>
                  <div class="flex-1"></div>
                  <el-button link type="danger" size="small" @click="ttmlEdit.transliterations.splice(ri, 1); batchPaste.roman.splice(ri, 1)">删除</el-button>
                </div>
                <div class="max-h-60 overflow-y-auto">
                  <div v-for="ln in tr.lines" :key="ln.for" class="py-1 border-b border-gray-100 last:border-0">
                    <div class="flex items-center gap-2">
                      <span class="w-9 shrink-0 text-xs text-gray-400 pt-0.5">{{ ln.for }}</span>
                      <span class="w-2/5 shrink-0 text-xs text-gray-500 pt-0.5 truncate" :title="ttmlLineText(ln.for)">{{ ttmlLineText(ln.for) }}</span>
                      <el-input v-model="ln.text" size="small" placeholder="空格分词；{LSU,词 组} 多字并位；{LSJ,原词,N} 跳到第 N 个原词（N 可省略）" class="flex-1 font-mono!" />
                    </div>
                    <div v-if="ln.text.trim()" class="text-[11px] text-gray-400 mt-0.5 break-all">{{ romanPreview(ln) }}</div>
                  </div>
                </div>
                <details class="mt-2">
                  <summary class="cursor-pointer text-xs text-blue-600 select-none">批量粘贴</summary>
                  <div class="mt-1.5">
                    <el-input v-model="batchPaste.roman[ri]" type="textarea" :rows="6" placeholder="整块粘贴：每行按顺序对应 L1~LN 音译；某行没有音译就空一行（补回车对齐）；{LSU,}/{LSJ,} 语法照常生效" class="font-mono!" />
                    <div class="flex items-center gap-2 mt-1">
                      <span class="text-xs flex-1" :class="batchCount(batchPaste.roman[ri]) === tr.lines.length ? 'text-green-600' : 'text-red-500'">
                        已粘贴 {{ batchCount(batchPaste.roman[ri]) }} 行 / 表格 {{ tr.lines.length }} 行{{ batchCount(batchPaste.roman[ri]) === tr.lines.length ? '（可填入）' : '（行数需一致：多删少补空行）' }}
                      </span>
                      <el-button size="small" @click="fillBatch('roman', ri)">按行填入</el-button>
                    </div>
                  </div>
                </details>
              </div>
              <el-button size="small" @click="addTtmlTrack('romanization')">+ 添加音译语言</el-button>
            </div>
          </el-tab-pane>
          <el-tab-pane label="文本歌词 (Markdown/HTML)" name="text">
            <RichTextToolbar :text="form.lyrics_text" :textarea-ref="lyricsTextRef" @update:text="v => form.lyrics_text = v" />
            <div class="flex gap-2">
              <el-input v-model="form.lyrics_text" ref="lyricsTextRef" type="textarea" :rows="10" placeholder="Markdown 或 HTML 格式文本歌词（支持混写：**加粗**、> 引用、工具栏按钮生成的 HTML 标注）" class="flex-1 font-mono! text-[13px]!" />
              <RichContentView :html="lyricsPreview" class="flex-1 border border-gray-200 rounded p-3 overflow-y-auto max-h-72 text-sm" content-class="rich-lyrics" />
            </div>
          </el-tab-pane>
        </el-tabs>
      </el-form-item>

      <el-form-item label="隐藏设置">
        <div class="flex flex-col gap-2 w-full">
          <div class="flex items-center gap-3">
            <el-switch v-model="form.is_hidden" active-text="隐藏" inactive-text="公开" />
            <span class="text-xs text-gray-400">开启后歌词上锁，需口令解锁查看；歌曲仍出现在各列表中</span>
          </div>
          <el-input v-model="form.unlock_code" placeholder="独立解锁口令（留空则使用全局口令）" />
          <div v-if="form.unlock_code.trim() && !form.is_hidden" class="text-xs text-amber-500">
            未开启隐藏开关，口令暂不生效（已保存，开启后直接使用）
          </div>
        </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button v-if="mode === 'review'" type="danger" plain :disabled="saving" @click="emit('reject')">❌ 拒绝</el-button>
      <el-button type="success" :loading="saving" @click="save">
        {{ mode === 'review' ? '✅ 通过发布' : '保存' }}
      </el-button>
    </template>

    <!-- 专辑信息共用弹窗（保存即入库/写回，与单曲审核同款） -->
    <AlbumInfoDialog
      v-model="showAlbumInfo"
      :artists="artists"
      :album-id="form.albumId || null"
      :album-name="form.albumName"
      :album-artists="form.albumArtists"
      :cover="albumCoverOfForm"
      :year="form.year"
      :description="albumDescOfForm"
      @artist-saved="onArtistSaved"
      @saved="onAlbumInfoSaved"
    />
  </el-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { marked } from 'marked'
import { mdToHtml } from '@/lib/markdown'
import { recomputeArtistTypes } from '@/lib/artistTypes'
import { syncSongContributors, syncSongSecrets } from '@/lib/contribRelations'
import { adminApi } from '@/lib/adminApi'
import ArtistTagInput from '@/components/submit/ArtistTagInput.vue'
import AlbumInfoDialog from '@/components/admin/AlbumInfoDialog.vue'
import RichTextToolbar from '@/components/admin/RichTextToolbar.vue'
import RichContentView from '@/components/common/RichContentView.vue'
import type { LyricVersionForm } from '@/components/common/LyricVersionsEditor.vue'
import { GENRE_OPTIONS, TIP_ICONS, OWNER_CONTRIBUTOR_ID } from '@/lib/constants'
import { loadLyricLines, loadLyricVersionMetas, groupVersions, rowsToLrcText, parseLrcToRows, parseTtmlToRows, composeMixedLrc, saveLyricLines, rebuildLyricLines, splitLrcToVersions, detectLang, detectTtmlLangs, LYRIC_LANG_OPTIONS, TRANSLIT_LANG_OPTIONS, LYRIC_KIND_LABEL, langLabel, parseTtmlForEdit, composeTtml, emptyTtmlEditModel, parseTranslitTokens, alignTranslitTokens, generateTtmlVariant, generateLrcVariant, expandRomanSyntax, prettifyTtml, stripWordTags, type LyricKind, type LyricVersion, type TtmlEditModel } from '@/lib/lyricLines'
import { supabase } from '@/lib/supabase'
import type { Artist, ArtistTag, Contributor } from '@/lib/types'

/**
 * 通用歌曲表单弹窗（后台歌曲管理 / TTML Hub 新建展示 共用）。
 * 封装：歌曲字段 + 专辑联动（选已有/新建/手动编辑）+ 四类艺术家解析与自动补建
 * + 多语言版本管理 + 文本歌词预览 + 隐藏口令 + 保存事务链（建/改专辑 → 写行表 → 建/改歌 → syncContribution → recompute）。
 *
 * 差异开关（props）：
 *   requireLyrics 必需歌词——歌曲管理为 true（必填 LRC）；TTML Hub 导入为 false（TTML 由源方来，不需手填 LRC）
 *   requireAlbum   必需专辑——默认 true；TTML 导入置 false
 * 编辑对象通过 initial（歌曲对象或含 song_id 的初始数据）传入，配合 editMode 决定是否加载歌词版本/走编辑保存链。
 */

const props = withDefaults(defineProps<{
  modelValue: boolean
  artists: Artist[]
  albums: any[]
  contributors: Contributor[]
  /** 编辑时传完整歌曲对象；新建传 { title, artists, albumName, ... } 预填 */
  initial?: Partial<any> | null
  /** 编辑模式：加载该歌歌词版本、保存走 update 链 */
  editSongId?: string | null
  title?: string
  requireLyrics?: boolean
  requireAlbum?: boolean
  /** 隐藏贡献者下拉（TTML Hub 导入用：无站内贡献者概念） */
  hideContributor?: boolean
  /** save=保存写库（歌曲管理/TTML Hub）；review=只回填数据 emit 给父级走发布链路（投稿审核用） */
  mode?: 'save' | 'review'
  /** 投稿信息区块（review 模式用）：提交人/联系方式/时间/备注/同名警示，null 则不渲染 */
  submissionInfo?: {
    submitter?: string
    contact?: string
    time?: string
    note?: string
    duplicateWarn?: string
    ttmlText?: string
  } | null
}>(), {
  initial: null,
  editSongId: null,
  title: '新增歌曲',
  requireLyrics: true,
  requireAlbum: true,
  hideContributor: false,
  mode: 'save',
  submissionInfo: null,
})

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'saved', payload: any): void
  (e: 'reject'): void
  /** review 模式：通过发布前把表单数据回填给父级（结构同 edited_data），父级自行发布 */
  (e: 'review-data', data: any): void
}>()

const visible = computed({
  get: () => props.modelValue,
  set: v => emit('update:modelValue', v),
})

// ===== 双区同步滚动（LRC 源码 ↔ 纯文本 / TTML 源码 ↔ 纯文本）：按滚动比例联动 =====
const syncScrollGroups: Record<string, { els: HTMLElement[]; lock: boolean }> = {
  lrc: { els: [], lock: false },
  lrcPlain: { els: [], lock: false },
  ttml: { els: [], lock: false },
  ttmlPlain: { els: [], lock: false },
}
/** el-input ref 回调 → 取内部 textarea 按组注册（内联函数 ref 每次渲染重触发，采用覆盖式重绑；
 *  组内任一滚动 → 配对组同步同比例位置） */
function bindSyncScroll(el: unknown, group: 'lrc' | 'lrcPlain' | 'ttml' | 'ttmlPlain') {
  const root = (el as any)?.$el ?? el
  const textarea = root?.querySelector?.('textarea')
  const g = syncScrollGroups[group]
  if (!(textarea instanceof HTMLElement)) { g.els = []; return } // 卸载/重渲染 null 阶段
  if (g.els[0] === textarea) return // 已绑定，避免重复挂监听
  g.els = [textarea]
  textarea.addEventListener('scroll', () => {
    const pair = group === 'lrc' ? 'lrcPlain' : group === 'lrcPlain' ? 'lrc'
      : group === 'ttml' ? 'ttmlPlain' : 'ttml'
    const dst = syncScrollGroups[pair]
    if (g.lock) { g.lock = false; return }
    const srcMax = textarea.scrollHeight - textarea.clientHeight
    if (srcMax <= 0) return
    const ratio = textarea.scrollTop / srcMax
    for (const t of dst.els) {
      const tMax = t.scrollHeight - t.clientHeight
      if (tMax > 0) t.scrollTop = ratio * tMax
    }
    dst.lock = true
  })
}

const editing = computed(() => !!props.editSongId)
const saving = ref(false)
const lyricsTab = ref('lrc')
const lyricsTextRef = ref<any>(null)

// ===== 多语言版本管理（LRC 版本列表 = versionForms；加载/拆分统一走 setLrcVersions） =====
// 声明必须先于下方 LRC 版本管理区（watch 注册即读取 getter，TDZ 防护）
const versionForms = ref<LrcVersionEntry[]>([])
const versionsDirty = ref(false)
let suppressDirty = false
watch(versionForms, vs => {
  if (suppressDirty) return
  versionsDirty.value = true
  // 版本内容变化 → 合成 form.lrc_text（保持与预览/落库一致；清空全部版本即清空 LRC）
  form.lrc_text = composeLrcTextOf(vs)
}, { deep: true })

// ===== LRC 版本管理（对齐 TTML tab：版本下拉 + 语言/类型标注 + 添加/删除；双区编辑，预览只读） =====

/** LRC 版本条目：多版本并存（同语言变体如简/繁体）；plain = 纯文本区内容 */
interface LrcVersionEntry extends LyricVersionForm {
  /** 纯文本区内容（从本版本行文本回填；编辑后反向派生回 lrc） */
  plain: string
  /** 上次派生用的纯文本（幂等：切版本/程序化回填不重复派生） */
  lastPlain: string
  /** 上次派生用的 LRC 源码（幂等：切版本/程序化赋值不重复派生） */
  lastDerived: string
}

const activeLrcIdx = ref(0)
const activeLrc = computed(() => versionForms.value[activeLrcIdx.value] || null)

/** LRC 源码区双向代理（当前版本 lrc） */
const activeLrcSource = computed({
  get: () => activeLrc.value?.lrc ?? '',
  set: v => { if (activeLrc.value) activeLrc.value.lrc = v },
})
/** 纯文本区双向代理（当前版本 plain） */
const activeLrcPlain = computed({
  get: () => activeLrc.value?.plain ?? '',
  set: v => { if (activeLrc.value) activeLrc.value.plain = v },
})
/** 语言/类型双向代理（当前版本） */
const activeLrcLang = computed({
  get: () => activeLrc.value?.lang || 'zh',
  set: v => { if (activeLrc.value) activeLrc.value.lang = v },
})
const activeLrcKind = computed({
  get: () => activeLrc.value?.kind || 'original',
  set: v => {
    if (!activeLrc.value) return
    const k = v as LyricKind
    activeLrc.value.kind = k
    // 类型切换时语言自动归位：罗马音类型必须是拉丁化方案；原文/译文不能是 Latn 标签
    if (k === 'romanization') {
      if (!TRANSLIT_LANG_OPTIONS.includes(activeLrc.value.lang)) activeLrc.value.lang = 'zh-Latn-pinyin'
    } else if (/Latn/i.test(activeLrc.value.lang)) {
      activeLrc.value.lang = 'zh'
    }
  },
})
/** LRC 语言下拉选项：罗马音类型只列 BCP47 拉丁化方案，其余类型列自然语言 */
const activeLrcLangOptions = computed(() => activeLrcKind.value === 'romanization' ? TRANSLIT_LANG_OPTIONS : LYRIC_LANG_OPTIONS)

/** 版本 lrc → 纯文本（行主文本，剥词级标签） */
function plainOfLrc(lrc: string): string {
  if (!lrc.trim()) return ''
  return parseLrcToRows(lrc).filter(r => r.time_ms != null).map(r => stripWordTags(r.text)).join('\n')
}

/** 程序化回填纯文本区（不触发派生） */
function syncPlainOf(e: LrcVersionEntry) {
  e.plain = plainOfLrc(e.lrc)
  e.lastPlain = e.plain
}

function toLrcEntry(v: LyricVersionForm): LrcVersionEntry {
  const plain = plainOfLrc(v.lrc)
  return { lang: v.lang?.trim() || 'zh', kind: v.kind, lrc: v.lrc, plain, lastPlain: plain, lastDerived: v.lrc.trim() }
}

/** 版本列表 → 合成 LRC（空 = 空串；与预览/落库同源） */
function composeLrcTextOf(entries: LrcVersionEntry[]): string {
  const vs = buildVersions(entries)
  return vs.length ? composeMixedLrc(vs, 'enhanced') : ''
}

/** 设置 LRC 版本列表（加载/拆分/合并统一入口；回填纯文本区并合成 form.lrc_text） */
function setLrcVersions(list: LyricVersionForm[]) {
  const entries = (list.length ? list : [{ lang: 'zh', kind: 'original' as const, lrc: '' }]).map(toLrcEntry)
  suppressDirty = true
  versionForms.value = entries
  activeLrcIdx.value = 0
  form.lrc_text = composeLrcTextOf(entries)
  nextTick(() => {
    suppressDirty = false
    versionsDirty.value = false
  })
}

/** 添加版本（空白；纯文本区以原文版本为模板生成变体，或直接粘贴该版本 LRC） */
function addLrcVersion() {
  versionForms.value.push({ lang: 'zh', kind: 'original', lrc: '', plain: '', lastPlain: '', lastDerived: '' })
  activeLrcIdx.value = versionForms.value.length - 1
}

/** 删除版本（删最后一个留一个空白，保持 ≥1 不变量） */
function removeLrcVersion(idx: number) {
  if (!versionForms.value[idx]) return
  versionForms.value.splice(idx, 1)
  if (!versionForms.value.length) addLrcVersion()
  activeLrcIdx.value = Math.min(activeLrcIdx.value, versionForms.value.length - 1)
}

/** LRC 源码区变化（防抖后）：单语言原位更新；整体多语言 LRC 拆分替换全部版本 */
let lrcSourceTimer: ReturnType<typeof setTimeout> | null = null
watch(() => activeLrc.value?.lrc, () => {
  if (lrcSourceTimer) clearTimeout(lrcSourceTimer)
  lrcSourceTimer = setTimeout(deriveActiveLrcSource, 400)
})

function deriveActiveLrcSource() {
  const e = activeLrc.value
  if (!e) return
  const raw = e.lrc.trim()
  if (raw === e.lastDerived) return
  e.lastDerived = raw
  if (!raw) { e.plain = ''; e.lastPlain = ''; return }
  if (!/^\[\d{1,3}:\d{2}/m.test(raw)) {
    ElMessage.warning('未检测到时间戳：LRC 代码请粘贴到左侧「LRC 源码」框；纯文本歌词请粘贴到右侧「纯文本」框')
    return
  }
  const lrcVersions = splitLrcToVersions(e.lrc)
  if (!lrcVersions.length) return
  if (lrcVersions.length > 1) {
    // 整体多语言 LRC：拆分替换全部版本（原「多语言版本」tab 的粘贴入口）
    setLrcVersions(lrcVersions.map(v => ({ lang: v.lang, kind: v.kind, lrc: rowsToLrcText(v.rows, 'enhanced') })))
    ElMessage.success(`已拆分为 ${lrcVersions.length} 个语言版本`)
    return
  }
  // 单语言：原位更新当前版本，纯文本区回填
  syncPlainOf(e)
}

/** 纯文本区变化（防抖后）：本版本有 LRC → 以自身行为模板原位更新文字；空版本 → 以原文版本为模板生成变体 */
let lrcPlainTimer: ReturnType<typeof setTimeout> | null = null
watch(() => activeLrc.value?.plain, () => {
  if (lrcPlainTimer) clearTimeout(lrcPlainTimer)
  lrcPlainTimer = setTimeout(() => {
    const e = activeLrc.value
    if (e && e.plain !== e.lastPlain) deriveActiveLrcPlain(e)
  }, 400)
})

function deriveActiveLrcPlain(e: LrcVersionEntry) {
  const raw = e.plain.trim()
  e.lastPlain = e.plain
  if (!raw) return // 纯文本区清空不动作（删除版本请用「删除此版本」）
  const isNew = !e.lrc.trim()
  const base = isNew ? versionForms.value.find(v => v.kind === 'original' && v.lrc.trim()) : e
  if (!base) {
    ElMessage.warning('纯文本生成变体需要先在「LRC 源码」框粘贴 LRC（拆分出原文行版本后才能做模板）')
    return
  }
  const errors: { line: string; expect: number; got: number }[] = []
  const variant = generateLrcVariant(base.lrc, raw, errors)
  if (!variant) {
    if (errors.length) {
      const detail = errors.slice(0, 5).map(x => x.line ? `${x.line}需 ${x.expect} 词，实际 ${x.got} 词` : `行数不匹配：原文 ${x.expect} 行，粘贴 ${x.got} 行`).join('；')
      ElMessage.error(`变体生成失败：${detail}${errors.length > 5 ? ` 等 ${errors.length} 处` : ''}。规则：含空格按空格分词，无空格按单字`)
    } else {
      ElMessage.error('变体生成失败（原文版本解析异常）')
    }
    return
  }
  e.lrc = variant
  e.lastDerived = variant.trim()
  if (isNew) {
    const detected = detectLang(raw)
    e.lang = detected === 'unknown' ? 'zh' : detected
  }
  ElMessage.success(isNew ? '已生成变体（模板：原文行；语言可在上方修改）' : '已按纯文本更新歌词（时间戳照抄）')
}

/** 表格 → 合成版本数组（音译 {LSU,}/{LSJ,} 语法在此展开对齐原文行词级时间；预览与落库共用同一构造，保证所见即所存） */
function buildVersions(forms: LyricVersionForm[]): LyricVersion[] {
  const origLrc = forms.find(v => v.kind === 'original' && v.lrc.trim())?.lrc || ''
  return forms.filter(v => v.lrc.trim()).map(v => ({
    lang: v.lang?.trim() || 'zh',
    kind: v.kind,
    rows: parseLrcToRows(v.kind === 'romanization' && /\{LS[UJ]/.test(v.lrc) ? expandRomanSyntax(v.lrc, origLrc) : v.lrc),
  }))
}

/** LRC 预览（只读）：最终入库的合成 LRC（多语言版本合成；无版本时 = 原文 LRC） */
const lrcPreview = computed(() => composeLrcTextOf(versionForms.value))

// ===== TTML 编辑模型（正文原文 + 翻译/音译表格；保存时 composeTtml 合成回完整原文） =====

/** TTML 版本条目：多版本并存（同语言变体如简/繁体）；id=lyric_versions 行 id（null=新增未落盘） */
interface TtmlVersionEntry {
  id: string | null
  /** TTML 源码区内容（完整 TTML，随时可改） */
  source: string
  /** 纯文本区内容（按行对应正文；编辑后以 TTML 结构为模板重新生成正文文字） */
  plain: string
  /** 版本来源（编辑模式读库保留；新增/审核固定 user） */
  origin: string
  /** 上次派生用的 TTML 源码（幂等：切版本/程序化赋值不重复派生） */
  lastDerived: string
  /** 上次派生用的纯文本（幂等：切版本/程序化同步不重复派生） */
  lastPlain: string
  model: TtmlEditModel
}
const ttmlVersions = ref<TtmlVersionEntry[]>([])
const activeTtmlIdx = ref(0)
const activeTtml = computed(() => ttmlVersions.value[activeTtmlIdx.value] || null)
/** 兜底空模型（不变量：列表恒 ≥1 条，正常不触达） */
const EMPTY_TTML = emptyTtmlEditModel()
/** 编辑代理：模板/脚本统一经此读写当前版本（属性突变落到 entry.model 上） */
const ttmlEdit = computed<TtmlEditModel>(() => activeTtml.value?.model || EMPTY_TTML)
/** 正文语言（权威来源在 model.bodyLang；保存时 composeTtml 写回 body xml:lang） */
const activeTtmlBodyLang = computed({
  get: () => activeTtml.value?.model.bodyLang || 'zh',
  set: v => { if (activeTtml.value) activeTtml.value.model.bodyLang = v },
})

/** 模型正文行 → 纯文本（每行主歌词，不含和声括号后缀） */
function modelPlainText(model: TtmlEditModel): string {
  return model.lines.map(l => l.plain).join('\n')
}

/** 程序化同步纯文本区（模型变化后回填，不触发派生） */
function syncPlainFromModel(e: TtmlVersionEntry) {
  e.plain = modelPlainText(e.model)
  e.lastPlain = e.plain
}

/** 正文语言猜测（解析出的行文本检测；无行时默认 zh） */
function guessBodyLang(model: TtmlEditModel): string {
  const d = detectLang(model.lines.map(l => l.text).join(' '))
  return d === 'unknown' ? 'zh' : d
}

/** 重置为单个版本（新建/审核回填投稿原文/清空） */
function initTtmlVersions(raw: string, opts: { id?: string | null; origin?: string } = {}) {
  // 先格式化再解析：源码区展示与模型 bodyRaw 均为格式化后的 TTML（保存输出保持可读）
  const source = raw.trim() ? prettifyTtml(raw) : ''
  const model = source
    ? (parseTtmlForEdit(source) || { bodyRaw: source, bodyLang: '', origBodyLang: '', origBodyTtmlLang: '', lines: [], translations: [], transliterations: [] })
    : emptyTtmlEditModel()
  // 原文无 xml:lang 标注 → 按内容猜测填默认（用户可改；改动会写回 body xml:lang）
  if (!model.bodyLang) model.bodyLang = guessBodyLang(model)
  const plain = modelPlainText(model)
  ttmlVersions.value = [{ id: opts.id ?? null, source, plain, origin: opts.origin || 'user', lastDerived: source.trim(), lastPlain: plain, model }]
  activeTtmlIdx.value = 0
  batchPaste.trans = []
  batchPaste.roman = []
}

/** 添加版本（空白，粘贴另一语言变体如简/繁体 TTML 或纯文本） */
function addTtmlVersion() {
  const model = emptyTtmlEditModel()
  model.bodyLang = 'zh'
  ttmlVersions.value.push({ id: null, source: '', plain: '', origin: 'user', lastDerived: '', lastPlain: '', model })
  activeTtmlIdx.value = ttmlVersions.value.length - 1
}

/** 删除版本（删最后一个留一个空白，保持 ≥1 不变量；库内 id 的行在保存时删除） */
function removeTtmlVersion(idx: number) {
  const e = ttmlVersions.value[idx]
  if (!e) return
  if (e.id) ElMessage.info('库内版本将在保存时删除')
  ttmlVersions.value.splice(idx, 1)
  if (!ttmlVersions.value.length) addTtmlVersion()
  activeTtmlIdx.value = Math.min(activeTtmlIdx.value, ttmlVersions.value.length - 1)
}

/** 切换版本：清空批量粘贴草稿（行数按版本不同，避免错位） */
watch(activeTtmlIdx, () => {
  batchPaste.trans = []
  batchPaste.roman = []
})

/** 翻译/音译批量粘贴草稿（按轨下标；行数与表格严格一致才允许填入） */
const batchPaste = reactive<{ trans: string[]; roman: string[] }>({ trans: [], roman: [] })

/** 批量粘贴 → 行数组（统一换行符；剥掉末尾一个换行，整块复制语义） */
function batchToLines(raw: string): string[] {
  const s = String(raw || '')
  if (!s) return []
  return s.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n')
}

/** 粘贴行数（实时校验提示用） */
function batchCount(raw: string | undefined): number {
  return batchToLines(raw || '').length
}

/** 按行填入：第 i 行 → 该轨第 i 行（L1~LN 顺序对应；行数不一致拒绝填入） */
function fillBatch(target: 'trans' | 'roman', idx: number) {
  const lines = target === 'trans' ? ttmlEdit.value.translations[idx]?.lines : ttmlEdit.value.transliterations[idx]?.lines
  if (!lines) return
  const raw = (target === 'trans' ? batchPaste.trans : batchPaste.roman)[idx] || ''
  const list = batchToLines(raw)
  if (list.length !== lines.length) {
    ElMessage.warning(`行数不一致：粘贴 ${list.length} 行，表格 ${lines.length} 行；某行没有内容就补一个空行（回车）对齐`)
    return
  }
  list.forEach((txt, i) => { lines[i].text = txt.trim() })
  ElMessage.success(`已填入 ${list.length} 行`)
}

/** 原文区双向代理（当前版本 source） */
const activeTtmlSource = computed({
  get: () => activeTtml.value?.source ?? '',
  set: v => { if (activeTtml.value) activeTtml.value.source = v },
})

/** 纯文本区双向代理（当前版本 plain） */
const activeTtmlPlain = computed({
  get: () => activeTtml.value?.plain ?? '',
  set: v => { if (activeTtml.value) activeTtml.value.plain = v },
})

/** TTML 预览（只读）：最终入库的完整 TTML（原文派生 + 翻译/音译表格合成） */
const ttmlPreview = computed(() =>
  activeTtml.value?.model.bodyRaw.trim() ? composeTtml(activeTtml.value.model) : '')

/** TTML 源码区变化（防抖后派生）：解析提取正文/翻译/音译表格 */
let suppressTtmlDerive = false
let ttmlDeriveTimer: ReturnType<typeof setTimeout> | null = null
watch(() => activeTtml.value?.source, () => {
  if (suppressTtmlDerive) return
  if (ttmlDeriveTimer) clearTimeout(ttmlDeriveTimer)
  ttmlDeriveTimer = setTimeout(() => {
    const e = activeTtml.value
    if (e) deriveTtmlModel(e)
  }, 500)
})

/** 纯文本区变化（防抖后派生）：以 TTML 结构为模板重新生成正文文字（本版本有结构用本版本，否则用其他版本） */
let ttmlPlainTimer: ReturnType<typeof setTimeout> | null = null
watch(() => activeTtml.value?.plain, () => {
  if (ttmlPlainTimer) clearTimeout(ttmlPlainTimer)
  ttmlPlainTimer = setTimeout(() => {
    const e = activeTtml.value
    if (e && e.plain !== e.lastPlain) deriveTtmlPlain(e)
  }, 500)
})

/** 派生入口（幂等：lastDerived 相同直接跳过，切版本/程序化赋值不重复派生） */
function deriveTtmlModel(e: TtmlVersionEntry) {
  const raw = e.source.trim()
  if (raw === e.lastDerived) return
  e.lastDerived = raw
  if (!raw) {
    // 清空源码 = 清空该版本（保存时删除库内行/跳过空白新增条目）
    e.model = emptyTtmlEditModel()
    batchPaste.trans = []
    batchPaste.roman = []
    syncPlainFromModel(e)
    return
  }
  // 完整 TTML → 现有解析链（语言标注尊重人工选择，不重猜）
  const prevLang = e.model.bodyLang
  const model = parseTtmlForEdit(raw)
  if (!model) return
  // 新原文无 xml:lang 标注时沿用此前的手动选择，否则按新标注
  if (!model.bodyLang) model.bodyLang = prevLang || guessBodyLang(model)
  e.model = model
  batchPaste.trans = []
  batchPaste.roman = []
  syncPlainFromModel(e)
  if (model.translations.length || model.transliterations.length) {
    ElMessage.success(`已提取翻译 ${model.translations.length} 种 / 音译 ${model.transliterations.length} 种`)
  }
}

/** 纯文本派生：以 TTML 结构为模板替换正文文字（时间戳/对唱/结构照抄；严格对齐报错） */
function deriveTtmlPlain(e: TtmlVersionEntry) {
  const raw = e.plain.trim()
  e.lastPlain = e.plain
  if (!raw) return // 纯文本区清空不动作（清空版本请用 TTML 源码区或「删除此版本」）
  // 模板：本版本已有结构 → 原位更新文字；否则用第一个有正文的版本（新建变体）
  const base = e.model.bodyRaw.trim() ? e : ttmlVersions.value.find(v => v.model.bodyRaw.trim() && v !== e)
  if (!base) {
    ElMessage.warning('纯文本生成需要先在「TTML 源码」框粘贴完整 TTML 做模板')
    return
  }
  const errors: { line: string; expect: number; got: number }[] = []
  const variant = generateTtmlVariant(base.model, raw, errors)
  if (!variant) {
    if (errors.length) {
      const detail = errors.slice(0, 5).map(x => x.line ? `L「${x.line}」需 ${x.expect} 词，实际 ${x.got} 词` : `行数不匹配：模板 ${x.expect} 行，粘贴 ${x.got} 行`).join('；')
      ElMessage.error(`正文生成失败：${detail}${errors.length > 5 ? ` 等 ${errors.length} 处` : ''}。规则：含空格按空格分词，无空格按单字`)
    } else {
      ElMessage.error('正文生成失败（模板解析异常）')
    }
    return
  }
  // 本版本已编辑过翻译/音译表格 → 保留（纯文本改动只重新生成正文；行 key 不变，对应关系不受影响）
  if (base === e && (e.model.translations.length || e.model.transliterations.length)) {
    variant.translations = e.model.translations
    variant.transliterations = e.model.transliterations
  }
  // 语言：沿用用户此前标注，再按新文本内容猜测修正（简↔繁 detectLang 可区分时生效）
  const prevLang = e.model.bodyLang
  variant.bodyLang = prevLang
  e.model = variant
  const guessed = guessBodyLang(variant)
  if (guessed !== 'zh' || !prevLang || prevLang === 'zh') e.model.bodyLang = guessed
  ElMessage.success(base === e ? '已按纯文本更新正文（结构/时间照抄）' : `已生成变体（模板：${langLabel(base.model.bodyLang || 'zh')}，翻译/音译轨道已复制）`)
}

/** 行文本预览（正文行 → 表格对应列） */
function ttmlLineText(key: string): string {
  return ttmlEdit.value.lines.find(l => l.key === key)?.text || ''
}

/** 音译对应预览：行级音译整行一个箭头（for= 已锚定行对应）；词级音译逐词展示，未命中的锚点/多余词提示 */
function romanPreview(ln: { for: string; text: string; lineLevel?: boolean }): string {
  const line = ttmlEdit.value.lines.find(l => l.key === ln.for)
  if (!line) return ''
  // 行级音译（Line 级 timing / 纯文本 sidecar）：整行对应正文行，不存在逐字未对应
  if (ln.lineLevel) {
    const t = ln.text.trim()
    return t ? `${line.text}→${t}` : line.text
  }
  const { matched, extra, badAnchors } = alignTranslitTokens(parseTranslitTokens(ln.text), line.words)
  const parts = line.words.map((w, i) => {
    const m = matched.find(x => x.wordIdx === i)
    return m ? `${w.text}→${m.text}` : w.text
  })
  let out = parts.join(' ')
  if (extra.length) out += `（未对应：${extra.join(' ')}）`
  if (badAnchors) out += `（${badAnchors} 个锚点未命中）`
  return out
}

/** 新增翻译/音译语言（复制全部行 key，逐行填写） */
function addTtmlTrack(kind: 'translation' | 'romanization') {
  if (kind === 'translation') {
    ttmlEdit.value.translations.push({
      ttmlLang: '', lrcLang: 'en', origTtmlLang: '', origLrcLang: 'en', type: 'subtitle',
      lines: ttmlEdit.value.lines.map(l => ({ for: l.key, text: '', bg: [] })),
    })
  } else {
    ttmlEdit.value.transliterations.push({
      ttmlLang: '', lrcLang: 'zh-Latn-pinyin', origTtmlLang: '', origLrcLang: 'zh-Latn-pinyin',
      lines: ttmlEdit.value.lines.map(l => ({ for: l.key, text: '', bg: [] })),
    })
  }
}

const albumDropdownOpen = ref(false)

const artistMap = computed(() => new Map(props.artists.map(a => [a.id, a])))
const albumMap = computed(() => new Map(props.albums.map(a => [a.id, a])))

const form = reactive({
  title: '',
  aliases: [] as string[],
  duration: '',
  track: 0,
  artists: [] as ArtistTag[],
  albumId: '' as string | null,
  albumName: '',
  albumArtists: [] as ArtistTag[],
  year: '',
  lyricists: [] as ArtistTag[],
  composers: [] as ArtistTag[],
  arrangers: [] as ArtistTag[],
  contributor_id: '' as string | null,
  genres: [] as string[],
  video_url: '',
  description: '',
  lrc_text: '',
  lyrics_text: '',
  /** TTML 原文（含对唱/分屏/样式；保存时独立落盘 lyric_versions.ttml_text） */
  ttmlText: '',
  is_hidden: false,
  unlock_code: '',
})

/** 贡献者锁定：默认锁定防误改（新增默认站长 ct_owner / 编辑保留已绑定贡献者），勾「修改贡献者」解锁 */
const contributorUnlock = ref(false)
/** 本次打开时的贡献者快照：取消勾选时恢复 */
const contributorSnapshot = ref<string | null>('')

/** 取消勾选 → 恢复打开时的贡献者 */
function onContributorUnlockChange(checked: boolean | string | number) {
  if (!checked) form.contributor_id = contributorSnapshot.value
}

// ===== 多语言版本管理（声明已上移至 LRC 版本管理区之前） =====
async function loadVersions(songId: string) {
  try {
    const rows = await loadLyricLines(songId)
    const vers = groupVersions(rows)
    // 行表为空：保留 lrc_text 拆分预填（保存走 rebuild 兜底）
    if (vers.length) {
      setLrcVersions(vers.map(v => ({ lang: v.lang, kind: v.kind, lrc: rowsToLrcText(v.rows, 'enhanced') })))
    }
  } catch (e: any) {
    // 行表读失败保留预填版本（保存走 rebuild 兜底）
    console.warn('[歌词版本加载失败]', songId, e?.message)
  }
}

/** 编辑模式：加载库内全部 TTML 版本（多版本并存，如简/繁体变体；保存时按 id UPDATE/INSERT/DELETE） */
async function loadTtmlVersion(songId: string) {
  try {
    const metas = await loadLyricVersionMetas(songId, true)
    const vers = metas.filter(v => v.format === 'ttml' && v.ttml_text)
    if (!vers.length) return
    ttmlVersions.value = vers.map(v => {
      // 展示前格式化（旧数据可能被挤成一行；下次保存即落盘格式化后的版本）
      const source = prettifyTtml(v.ttml_text!)
      const model = parseTtmlForEdit(source) || { bodyRaw: source, bodyLang: '', origBodyLang: '', origBodyTtmlLang: '', lines: [], translations: [], transliterations: [] }
      // bodyLang 优先取入库 langs 首位（落盘时即正文语言）→ TTML xml:lang → 内容猜测
      model.bodyLang = (v.langs || [])[0] || model.bodyLang || guessBodyLangTtml(v.ttml_text!)
      const plain = modelPlainText(model)
      return {
        id: v.id,
        source,
        plain,
        origin: v.source || 'user',
        lastDerived: source.trim(),
        lastPlain: plain,
        model,
      }
    })
    activeTtmlIdx.value = 0
  } catch (e: any) {
    console.warn('[TTML 版本加载失败]', songId, e?.message)
  }
}

/** TTML 原文行文本语言猜测（loadTtmlVersion 兜底用） */
function guessBodyLangTtml(xml: string): string {
  const rows = parseTtmlToRows(xml)
  const d = detectLang(rows.map(r => r.text).join(' '))
  return d === 'unknown' ? 'zh' : d
}

/** TTML 多版本落盘：逐条 INSERT/UPDATE；被清空/删除的库内版本 → DELETE（与发布链同逻辑） */
async function upsertTtmlVersions(songId: string) {
  for (const e of ttmlVersions.value) {
    const text = e.model.bodyRaw.trim() ? composeTtml(e.model) : ''
    if (!text && !e.id) continue // 空白新增条目：跳过
    // langs：正文语言（人工标注）+ 翻译/音译轨语言；空则回退内容检测
    let langs = [...new Set([
      e.model.bodyLang,
      ...e.model.translations.map(t => t.lrcLang),
      ...e.model.transliterations.map(t => t.lrcLang),
    ].filter(l => l && l !== 'und'))]
    if (!langs.length) {
      // 兜底（无人工标注/翻译轨）：整体判定，根 xml:lang 优先、正文众数兜底
      langs = detectTtmlLangs(text)
    }
    if (text && e.id) {
      const { error } = await supabase.from('lyric_versions').update({
        ttml_text: text, langs,
      }).eq('id', e.id)
      if (error) throw new Error(`TTML 版本更新失败（${error.message}）`)
    } else if (text) {
      // 新增 INSERT（与发布链同结构）
      const newId = 'lv_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      const { error } = await supabase.from('lyric_versions').insert({
        id: newId, song_id: songId, format: 'ttml', source: e.origin || 'user',
        ttml_text: text, langs, status: 'published', is_primary: false,
        contributor_id: form.contributor_id || null,
      })
      if (error) throw new Error(`TTML 版本写入失败（${error.message}）`)
      e.id = newId
    } else if (e.id) {
      // 原文被清空/版本被删：删除库内行（编辑场景）
      const { error } = await supabase.from('lyric_versions').delete().eq('id', e.id)
      if (error) console.warn('[TTML 版本删除失败]', error.message)
      else e.id = null
    }
  }
}

/** 逗号分隔的 ID 串 → {id, name}[]（找不到的 id 原样保留显示） */
function idsToTags(str: string | null | undefined): { id: string; name: string }[] {
  return (str || '').split(',').map(s => s.trim()).filter(Boolean).map(id => ({ id, name: artistMap.value.get(id)?.name || id }))
}

/** 打开时按 initial 初始化；编辑模式额外加载歌词版本 */
onMounted(() => watch(() => props.modelValue, (open) => {
  if (!open) return
  resetForm()
}))

function resetForm() {
  editingBasedInit()
  lyricsTab.value = 'lrc'
  // LRC 版本：lrc_text 预拆分预填（编辑模式随后由行表加载覆盖；review 模式由投稿 versions 覆盖）
  setLrcVersions(form.lrc_text.trim()
    ? splitLrcToVersions(form.lrc_text).map(v => ({ lang: v.lang, kind: v.kind, lrc: rowsToLrcText(v.rows, 'enhanced') }))
    : [])
  initTtmlVersions(form.ttmlText)
  if (props.editSongId) {
    loadVersions(props.editSongId)
    loadTtmlVersion(props.editSongId)
  }
  // review 模式（投稿审核）：无库内 songId，投稿自带的多语言版本直接预填
  else if (props.mode === 'review' && Array.isArray((props.initial as any)?.versions)) {
    setLrcVersions((props.initial as any).versions.map((v: any) => ({
      lang: v.lang, kind: v.kind, lrc: v.lrc,
    })))
  }
  // 贡献者锁定状态重置：审核模式隐藏下拉不处理；新增默认站长（ct_owner），编辑保留已绑定值
  contributorUnlock.value = false
  if (!props.hideContributor) {
    if (!props.editSongId && !form.contributor_id) form.contributor_id = OWNER_CONTRIBUTOR_ID
    contributorSnapshot.value = form.contributor_id
  }
}

/** 依据 props.initial 填充表单（编辑=整歌对象；新建=预填片段） */
function editingBasedInit() {
  const init = props.initial
  if (!init) {
    Object.assign(form, baseEmpty())
    return
  }
  const album = init.album_id ? albumMap.value.get(init.album_id) : null
  Object.assign(form, {
    title: init.title || '',
    aliases: [...(init.aliases || [])],
    duration: init.duration || '',
    track: init.track || 0,
    // 编辑：artist_ids 来自 songs 行；新建预填：initial.artists 直接是 tag 数组
    artists: init.artist_ids?.length
      ? init.artist_ids.map((id: string) => ({ id, name: artistMap.value.get(id)?.name || id }))
      : (init.artists || []).map((t: any) => (typeof t === 'string' ? { id: null, name: t } : t)),
    albumId: init.album_id || '',
    albumName: album?.name || init.albumName || '',
    albumArtists: album?.artist_ids?.length
      ? album.artist_ids.map((id: string) => ({ id, name: artistMap.value.get(id)?.name || id }))
      : (init.albumArtists || []),
    year: album?.year ? String(album.year) : (init.year || ''),
    lyricists: init.lyricists?.length ? init.lyricists : idsToTags(init.lyricist),
    composers: init.composers?.length ? init.composers : idsToTags(init.composer),
    arrangers: init.arrangers?.length ? init.arrangers : idsToTags(init.arranger),
    contributor_id: init.contributor_id || '',
    genres: [...(init.genres || [])],
    video_url: init.video_url || '',
    description: init.description || '',
    lrc_text: init.lrc_text || '',
    lyrics_text: init.lyrics_text || '',
    // 审核模式：投稿自带的 ttml_text 直接回填；编辑模式由 loadTtmlVersion 单独加载
    ttmlText: init.ttml_text || '',
    is_hidden: !!init.is_hidden,
    unlock_code: init.unlock_code || '',
  })
}

function baseEmpty() {
  return {
    title: '', aliases: [], duration: '', track: 0, artists: [], albumId: '', albumName: '', albumArtists: [], year: '',
    lyricists: [], composers: [], arrangers: [], contributor_id: '', genres: [], video_url: '', description: '',
    lrc_text: '', lyrics_text: '', ttmlText: '', is_hidden: false, unlock_code: '',
  }
}

const albumDropdown = ref<any[]>([])
function onAlbumInput() {
  // 手动改字 = 解绑当前专辑（改回原名/从下拉重选可恢复关联）
  if (form.albumId) {
    const cur = props.albums.find(a => a.id === form.albumId)
    if (cur && cur.name !== form.albumName) form.albumId = ''
  }
  const q = form.albumName.trim().toLowerCase()
  if (!q) {
    albumDropdown.value = []
    albumDropdownOpen.value = false
    return
  }
  albumDropdown.value = props.albums.filter(a => a.name?.toLowerCase().includes(q)).slice(0, 8)
  albumDropdownOpen.value = true
}

function selectAlbum(a: any) {
  form.albumId = a.id
  form.albumName = a.name
  form.year = a.year ? String(a.year) : ''
  form.albumArtists = (a.artist_ids || []).map((id: string) => ({ id, name: artistMap.value.get(id)?.name || id }))
  albumDropdownOpen.value = false
}

// ============ 专辑信息共用弹窗（保存即入库/写回，与单曲审核同款） ============
const showAlbumInfo = ref(false)
const albumCoverOfForm = computed(() => albumMap.value.get(form.albumId || '')?.cover || '')
const albumDescOfForm = computed(() => albumMap.value.get(form.albumId || '')?.description || '')
function openAlbumInfo() {
  if (!form.albumName.trim()) {
    ElMessage.warning('请先填写专辑名')
    return
  }
  showAlbumInfo.value = true
}
/** 保存成功 → 回填表单（关联 id/年份/专辑艺术家）+ 更新本地专辑池（搜索下拉即时刷新） */
function onAlbumInfoSaved(p: { albumId: string; name: string; year: number | null; cover: string; description: string | null; artistIds: string[] }) {
  form.albumId = p.albumId
  form.albumName = p.name
  form.year = p.year ? String(p.year) : ''
  form.albumArtists = p.artistIds.map(id => ({ id, name: artistMap.value.get(id)?.name || id }))
  const row = props.albums.find(a => a.id === p.albumId)
  if (row) {
    row.name = p.name
    row.year = p.year
    row.cover = p.cover
    row.description = p.description
    row.artist_ids = p.artistIds
  } else {
    props.albums.push({ id: p.albumId, name: p.name, year: p.year, cover: p.cover, description: p.description, artist_ids: p.artistIds } as any)
  }
}

// ============ 简介 tip 插入与预览 ============
const lyricsPreview = computed(() =>
  form.lyrics_text ? mdToHtml(form.lyrics_text) : '<span style="color:#c0c4cc">预览区</span>')

const descPreview = computed(() => {
  const text = form.description
  if (!text) return ''
  const processed = text.replace(/\{%\s*tip\s+(\w+)\s*%\}([\s\S]*?)\{%\s*endtip\s*%\}/g, (_m, type, content) => {
    const icon = TIP_ICONS[type] || '💡'
    return `<div style="border:1px solid #fed7aa;background:#fff7ed;border-radius:6px;padding:8px 12px;margin:8px 0;display:flex;gap:8px;color:#9a3412;font-size:13px;"><span style="font-size:16px;">${icon}</span><div>${marked.parse(content.trim(), { async: false })}</div></div>`
  })
  return mdToHtml(processed)
})

function insertTip(type: string) {
  form.description += `\n{% tip ${type} %}在此输入提示内容{% endtip %}\n`
}

// ============ 保存 ============
async function resolveArtists(tags: ArtistTag[], type: string): Promise<string[]> {
  const ids: string[] = []
  for (const t of tags) {
    if (t.id && !t._new) {
      const exist = artistMap.value.get(t.id)
      if (exist && type !== 'album' && !(exist.types || []).includes(type) && type !== 'singer') {
        const types = [...(exist.types || []), type]
        await adminApi.update('artists', exist.id, { types })
        exist.types = types
      }
      ids.push(t.id)
    } else {
      const created = await adminApi.insert('artists', {
        id: t.id,
        name: t.name,
        types: t.types?.length ? t.types : (type === 'album' ? [] : [type]),
        is_show: t.is_show !== false,
        sort: 0,
        bio: t.bio || '',
        avatar: t.avatar || '',
        aliases: t.aliases || [],
        disambiguation: t.disambiguation || '',
        urls: t.urls || {},
      })
      ids.push(created?.id || String(t.id))
      t._new = false
    }
  }
  return ids
}

function missingNewIds(): string[] {
  const all = [...form.artists, ...form.albumArtists, ...form.lyricists, ...form.composers, ...form.arrangers]
  return all.filter(t => !t.id || t._new).filter(t => !t.id || !String(t.id).trim()).map(t => t.name)
}

/** 内联表单保存老艺术家 → 同步本地池（ArtistTagInput 内部调用） */
function onArtistSaved(tag: ArtistTag) {
  const a = props.artists.find(x => x.id === tag.id)
  if (a) {
    a.avatar = tag.avatar || null
    a.types = tag.types || []
    a.disambiguation = tag.disambiguation || null
    a.aliases = tag.aliases || []
    a.bio = tag.bio || ''
    a.urls = tag.urls || {}
  } else {
    // 新建艺术家保存即入库：加入本地艺术家池，供其它字段下拉立即可搜到/复用
    props.artists.push({
      id: tag.id!,
      name: tag.name,
      avatar: tag.avatar ?? null,
      types: tag.types ?? [],
      disambiguation: tag.disambiguation ?? null,
      aliases: tag.aliases ?? [],
      bio: tag.bio ?? '',
      urls: tag.urls ?? {},
      sort: 0,
    } as Artist)
  }
}

async function save() {
  if (!form.title.trim() || !form.artists.length) {
    ElMessage.warning('请填写必填字段：歌曲名、歌手')
    return
  }
  if (props.requireAlbum && !form.albumName.trim()) {
    ElMessage.warning('请填写必填字段：专辑（或关闭专辑必填后留空）')
    return
  }
  // 专辑保存即入库：填了专辑名但未入库（未点卡片保存/搜索未选）时兜底阻断，避免歌挂空专辑
  if (form.albumName.trim() && !form.albumId) {
    const hit = props.albums.find(a => a.name.toLowerCase() === form.albumName.trim().toLowerCase())
    if (hit) {
      form.albumId = hit.id
    } else {
      ElMessage.warning('专辑「' + form.albumName.trim() + '」尚未入库：请点击专辑信息卡片填写并保存，或从搜索下拉选择已有专辑')
      return
    }
  }
  // 歌词必填：LRC 或 TTML 任一有内容即可（只有 TTML 版本的歌不再强制填 LRC）
  const hasTtmlContent = ttmlVersions.value.some(e => e.model.bodyRaw.trim())
  if (props.requireLyrics && !lrcPreview.value.trim() && !hasTtmlContent) {
    ElMessage.warning('请填写必填字段：LRC 歌词')
    return
  }
  const missing = missingNewIds()
  if (missing.length) {
    ElMessage.error(`有 ${missing.length} 位新建艺术家未填写 ID（${missing.join('、')}），请点击其头像补全`)
    return
  }

  // ===== review 模式：只回填表单数据（结构同投稿 edited_data），由父级走发布链路 =====
  if (props.mode === 'review') {
    emit('review-data', {
      title: form.title.trim(),
      aliases: form.aliases.map(a => a.trim()).filter(Boolean),
      artists: form.artists,
      album: form.albumName.trim(),
      album_id: form.albumId || null,
      album_artists: form.albumArtists,
      album_cover: albumMap.value.get(form.albumId || '')?.cover || '',
      year: form.year,
      album_desc: albumMap.value.get(form.albumId || '')?.description || '',
      duration: form.duration.trim(),
      track: form.track ? String(form.track) : '',
      lyricist_arr: form.lyricists,
      composer_arr: form.composers,
      arranger_arr: form.arrangers,
      genres: form.genres,
      video_url: form.video_url.trim(),
      description: form.description || null,
      lrc_text: lrcPreview.value.trim(),
      lyrics_text: form.lyrics_text || null,
      versions: versionForms.value.filter(v => v.lrc.trim()).map(v => ({
        lang: v.lang, kind: v.kind,
        // 音译 {LSU,}/{LSJ,} 语法展开对齐原文行词级时间（与预览/落库同构造）
        lrc: v.kind === 'romanization' && /\{LS[UJ]/.test(v.lrc)
          ? expandRomanSyntax(v.lrc, versionForms.value.find(o => o.kind === 'original' && o.lrc.trim())?.lrc || '')
          : v.lrc,
      })),
      // TTML 多版本（审核可编辑：语言标注/简繁变体一气呵成；空数组=审核员清空了全部 TTML）
      ttml_versions: ttmlVersions.value
        .filter(e => e.model.bodyRaw.trim())
        .map(e => ({
          lang: e.model.bodyLang,
          langs: [...new Set([
            e.model.bodyLang,
            ...e.model.translations.map(t => t.lrcLang),
            ...e.model.transliterations.map(t => t.lrcLang),
          ].filter(l => l && l !== 'und'))],
          text: composeTtml(e.model),
        })),
      is_hidden: !!form.is_hidden,
      unlock_code: form.unlock_code.trim(),
    })
    return
  }
  saving.value = true
  try {
    // TTML 多版本合成落盘在 upsertTtmlVersions（表单 ttmlText 仅作 L→T 转换的回退源）
    form.ttmlText = ttmlVersions.value.map(e => (e.model.bodyRaw.trim() ? composeTtml(e.model) : '')).find(Boolean) || ''

    const [artistIds, lyricistIds, composerIds, arrangerIds, albumArtistIds] = await Promise.all([
      resolveArtists(form.artists, 'singer'),
      resolveArtists(form.lyricists, 'lyricist'),
      resolveArtists(form.composers, 'composer'),
      resolveArtists(form.arrangers, 'arranger'),
      resolveArtists(form.albumArtists, 'album'),
    ])

    // 专辑由 AlbumInfoDialog 保存即入库/写回；这里只取表单关联的 albumId 绑定到歌
    const albumId = form.albumId || null

    // 最终入库 LRC 与预览一致（所见即所存）：多语言版本表格优先合成，无表格时用原文
    let finalLrcText = lrcPreview.value.trim()
    if (versionsDirty.value && editing.value) {
      // 行表只存 LRC 拆分的版本（lrc 字段有值）；TTML 拆分不进行表（在 ttml_text 原文里，由后端动态拆分）
      // 音译 {LSU,}/{LSJ,} 语法在 buildVersions 展开对齐原文行词级时间
      const versions = buildVersions(versionForms.value)
      await saveLyricLines(props.editSongId!, versions)
      finalLrcText = composeMixedLrc(versions, 'enhanced')
    }

    const payload: Record<string, unknown> = {
      title: form.title.trim(),
      aliases: form.aliases.map(a => a.trim()).filter(Boolean),
      album_id: albumId,
      duration: form.duration.trim(),
      track: form.track || 0,
      lrc_text: finalLrcText,
      lyrics_text: form.lyrics_text || null,
      video_url: form.video_url.trim() || null,
      description: form.description || null,
      genres: form.genres,
      contributor_id: form.contributor_id || null,
      is_hidden: !!form.is_hidden,
    }

    if (editing.value) {
      const id = props.editSongId!
      await adminApi.update('songs', id, payload)
      // 歌词行表：版本管理脏 → 上面已写行表；否则整体 lrc_text 改动后重拆（触发器仅 INSERT，不会自动重拆 UPDATE）
      if (!versionsDirty.value) await rebuildLyricLines(id)
      // TTML 多版本：逐条 UPDATE/INSERT；被清空/删除的 → DELETE
      await upsertTtmlVersions(id)
      await syncSongSecrets(id, form.unlock_code.trim())
      await syncSongContributors(id, {
        singer: artistIds, lyricist: lyricistIds, composer: composerIds, arranger: arrangerIds,
      })
      // 编辑牵涉的艺术家（新旧值都算）→ 重算 types（角色变化/移除后清掉失去支撑的类型）
      const oldInit = props.initial
      const affected = new Set<string>()
      const oldIdsOf = (v: string | null) => String(v || '').split(',').map(x => x.trim()).filter(Boolean)
      ;(oldInit?.artist_ids || []).forEach((i: string) => affected.add(i))
      oldIdsOf(oldInit?.lyricist).forEach(i => affected.add(i))
      oldIdsOf(oldInit?.composer).forEach(i => affected.add(i))
      oldIdsOf(oldInit?.arranger).forEach(i => affected.add(i))
      ;(albumMap.value.get(oldInit?.album_id)?.artist_ids || []).forEach((i: string) => affected.add(i))
      ;(albumMap.value.get(albumId)?.artist_ids || []).forEach((i: string) => affected.add(i))
      ;[...artistIds, ...lyricistIds, ...composerIds, ...arrangerIds].forEach(i => affected.add(i))
      await recomputeArtistTypes([...affected])
      ElMessage.success('保存成功')
      emit('saved', { id, ...payload })
    } else {
      payload.id = crypto.randomUUID()
      payload.status = 'published'
      await adminApi.insert('songs', payload)
      // TTML 多版本：新增模式只有 INSERT
      await upsertTtmlVersions(payload.id as string)
      await syncSongSecrets(payload.id as string, form.unlock_code.trim())
      await syncSongContributors(payload.id as string, {
        singer: artistIds, lyricist: lyricistIds, composer: composerIds, arranger: arrangerIds,
      })
      // 新增只补类型不减（与发布链一致），走重算同样正确
      await recomputeArtistTypes([...artistIds, ...lyricistIds, ...composerIds, ...arrangerIds, ...albumArtistIds])
      ElMessage.success('新增歌曲成功')
      emit('saved', { id: payload.id, ...payload })
    }
    visible.value = false
  } catch (e: any) {
    ElMessage.error('保存失败：' + (e?.message || e))
  } finally {
    saving.value = false
  }
}
</script>