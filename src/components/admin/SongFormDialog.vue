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

      <el-form-item label="风格">
        <el-select v-model="form.genres" multiple filterable allow-create clearable default-first-option placeholder="选择或输入风格标签" class="w-full">
          <el-option v-for="g in GENRE_OPTIONS" :key="g" :label="g" :value="g" />
        </el-select>
      </el-form-item>

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
            <!-- 版本（容器）条：下拉切换 + 添加/删除（与 TTML 版本条一致；一个容器 = 一个投稿版本） -->
            <div class="flex items-center gap-2 mb-2 flex-wrap">
              <el-select v-model="activeLrcContainerIdx" size="small" class="!w-64">
                <el-option v-for="(c, i) in lrcContainers" :key="i"
                  :label="`版本 ${i + 1} · 原文·${langLabel(containerOrigLang(c))} · ${contributorName(c.contributorId)}`" :value="i" />
              </el-select>
              <div class="flex-1"></div>
              <el-button v-if="mode !== 'review'" size="small" @click="addLrcContainer">+ 添加版本</el-button>
              <el-button v-if="mode !== 'review'" link type="danger" size="small" @click="removeLrcContainer(activeLrcContainerIdx)">删除此版本</el-button>
            </div>
            <template v-if="activeLrcContainer">
              <!-- 版本卡片：版本贡献者（默认锁定）+ 完整版 LRC 粘贴框 + 含音译标记 -->
              <div class="border border-gray-200 rounded-lg p-3 mb-2">
                <div v-if="!hideContributor" class="flex items-center gap-2 mb-2 flex-wrap">
                  <span class="text-xs text-gray-500 shrink-0">版本贡献者</span>
                  <el-select v-model="activeLrcContainer.contributorId" filterable :disabled="!activeLrcContainer.contributorUnlock" size="small" class="!w-56">
                    <el-option v-for="c in contributors" :key="c.id" :label="c.name + '（' + (c.tags?.join(', ') || '歌词贡献') + '）'" :value="c.id" />
                  </el-select>
                  <el-checkbox v-model="activeLrcContainer.contributorUnlock" size="small">修改贡献者</el-checkbox>
                </div>
                <div class="flex items-center gap-2 mb-1 flex-wrap">
                  <span class="text-xs text-gray-500 shrink-0">完整版 LRC（粘贴多语言混排自动拆分到下方各轨）</span>
                  <el-checkbox v-model="activeLrcContainer.hasRoman" size="small">含音译（勾选后同戳组末行按音译拆分，2 行组也生效）</el-checkbox>
                </div>
                <el-input v-model="activeLrcContainer.fullLrc" type="textarea" :rows="4" placeholder="粘贴完整版多语言 LRC：自动按同戳组拆分原文/翻译；勾了「含音译」则每组最后一行判为音译" class="font-mono!" />
              </div>
              <!-- 轨卡片：原文固定第一张始终可见，翻译/音译每添加一种语言就在下方平铺一张（与 TTML 正文+翻译表格同构） -->
              <div v-for="(t, ti) in activeLrcContainer.tracks" :key="ti" class="border border-gray-200 rounded-lg p-3 mb-2">
                <div class="flex items-center gap-2 mb-2 flex-wrap">
                  <span class="text-xs text-gray-500 shrink-0">{{ LYRIC_KIND_LABEL[t.kind] }}</span>
                  <el-select :model-value="t.lang" @update:model-value="(v) => setTrackLang(t, v)" filterable allow-create default-first-option size="small" class="!w-36">
                    <el-option v-for="l in trackLangOptions(t)" :key="l" :label="langLabel(l)" :value="l" />
                  </el-select>
                  <div class="flex-1"></div>
                  <el-button v-if="t.kind !== 'original'" link type="danger" size="small" @click="removeLrcTrack(ti)">删除</el-button>
                </div>
                <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <div class="text-xs text-gray-500 mb-1">LRC 源码{{ t.kind === 'original' ? '（原文轨；粘贴整体多语言 LRC 会自动拆分替换本版本全部轨）' : '' }}</div>
                    <el-input :ref="el => bindSyncScroll(el, `lrc-${ti}`, `lrcPlain-${ti}`)" v-model="t.lrc" @input="onTrackLrcInput(t)" type="textarea" :rows="t.kind === 'original' ? 10 : 5" :placeholder="t.kind === 'original' ? '粘贴原文轨 LRC；粘贴整体多语言 LRC 会自动拆分' : '粘贴该轨 LRC（头部公共行/同戳原文行保存时自动剥离）'" class="font-mono!" />
                  </div>
                  <div>
                    <div class="text-xs text-gray-500 mb-1">纯文本歌词</div>
                    <el-input :ref="el => bindSyncScroll(el, `lrcPlain-${ti}`, `lrc-${ti}`)" v-model="t.plain" @input="onTrackPlainInput(t)" type="textarea" :rows="t.kind === 'original' ? 10 : 5" placeholder="粘贴纯文本歌词：本轨有 LRC 则原位更新文字（改错字），否则以原文轨为模板生成变体（简↔繁等，时间戳/词级结构照抄；行数词数需一致）" class="font-mono!" />
                  </div>
                </div>
              </div>
              <!-- 添加轨：翻译可多轨，音译每版本至多 1 轨 -->
              <div class="flex items-center gap-2 mb-2 flex-wrap">
                <el-button size="small" @click="addLrcTrack('translation')">+ 添加翻译语言</el-button>
                <el-button size="small" :disabled="activeLrcContainer.tracks.some(t => t.kind === 'romanization')" @click="addLrcTrack('romanization')">+ 添加音译</el-button>
                <span class="text-xs text-gray-400">每张轨卡内容永久保留；翻译可多轨，音译每版本至多 1 轨</span>
              </div>
              <details open class="mt-2">
                <summary class="cursor-pointer text-xs text-blue-600 select-none">预览（当前版本最终入库 LRC，只读）</summary>
                <pre class="mt-1 max-h-56 overflow-y-auto bg-gray-50 border border-gray-200 rounded p-2 whitespace-pre-wrap font-mono text-[11px]">{{ activeLrcPreview }}</pre>
              </details>
            </template>
          </el-tab-pane>
          <el-tab-pane label="TTML 原文" name="ttml">
            <!-- 版本管理：多 TTML 版本并存（同语言变体如简/繁体）+ 正文语言标注（入库 langs 首位，替代盲猜）；贡献者绑定在版本上 -->
            <div class="flex items-center gap-2 mb-2 flex-wrap">
              <el-select v-model="activeTtmlIdx" size="small" class="!w-64">
                <el-option v-for="(v, i) in ttmlVersions" :key="i" :label="`版本 ${i + 1} · ${langLabel(v.model.bodyLang || 'zh')} · ${contributorName(v.contributorId)}`" :value="i" />
              </el-select>
              <span class="text-xs text-gray-500 shrink-0">正文语言</span>
              <el-select v-model="activeTtmlBodyLang" filterable allow-create default-first-option size="small" class="!w-36">
                <el-option v-for="l in LYRIC_LANG_OPTIONS" :key="l" :label="langLabel(l)" :value="l" />
              </el-select>
              <div class="flex-1"></div>
              <el-button size="small" @click="addTtmlVersion">+ 添加版本</el-button>
              <el-button link type="danger" size="small" @click="removeTtmlVersion(activeTtmlIdx)">删除此版本</el-button>
            </div>
            <!-- 版本贡献者（默认锁定；无贡献者 = 站长自建；review 模式投稿人信息在投稿信息区块，不显示） -->
            <div v-if="!hideContributor && activeTtml" class="flex items-center gap-2 mb-2 flex-wrap">
              <span class="text-xs text-gray-500 shrink-0">版本贡献者</span>
              <el-select v-model="activeTtml.contributorId" filterable :disabled="!activeTtml.contributorUnlock" size="small" class="!w-56">
                <el-option v-for="c in contributors" :key="c.id" :label="c.name + '（' + (c.tags?.join(', ') || '歌词贡献') + '）'" :value="c.id" />
              </el-select>
              <el-checkbox v-model="activeTtml.contributorUnlock" size="small">修改贡献者</el-checkbox>
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
                  <el-button link type="primary" size="small" @click="copyBatch('roman', ri)">批量复制</el-button>
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
import { copyText } from '@/lib/clipboard'
import ArtistTagInput from '@/components/submit/ArtistTagInput.vue'
import AlbumInfoDialog from '@/components/admin/AlbumInfoDialog.vue'
import RichTextToolbar from '@/components/admin/RichTextToolbar.vue'
import RichContentView from '@/components/common/RichContentView.vue'
import type { LyricVersionForm } from '@/components/common/LyricVersionsEditor.vue'
import { GENRE_OPTIONS, TIP_ICONS, OWNER_CONTRIBUTOR_ID } from '@/lib/constants'
import { loadLyricLines, loadLyricVersionMetas, groupVersionsByContainer, parseTrackBox, fillCommonRows, rowsHaveWordTags, rowsToLrcText, parseLrcToRows, parseTtmlToRows, composeMixedLrc, saveLyricLines, resolveDefaultLinesVersionId, rebuildLyricLines, splitLrcToVersions, detectLang, detectTtmlLangs, LYRIC_LANG_OPTIONS, TRANSLIT_LANG_OPTIONS, LYRIC_KIND_LABEL, langLabel, parseTtmlForEdit, composeTtml, emptyTtmlEditModel, parseTranslitTokens, alignTranslitTokens, generateTtmlVariant, generateLrcVariant, expandRomanSyntax, prettifyTtml, stripWordTags, type LyricKind, type LyricVersion, type TtmlEditModel } from '@/lib/lyricLines'
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

// ===== 双区同步滚动（LRC/TTML 源码 ↔ 纯文本）：按滚动比例联动；轨平铺后每对双区用独立组名 =====
const syncScrollGroups = new Map<string, { els: HTMLElement[]; lock: boolean }>()
function scrollGroup(name: string) {
  let g = syncScrollGroups.get(name)
  if (!g) { g = { els: [], lock: false }; syncScrollGroups.set(name, g) }
  return g
}
/** el-input ref 回调 → 取内部 textarea 按组注册（内联函数 ref 每次渲染重触发，采用覆盖式重绑；
 *  组内任一滚动 → 配对组同步同比例位置。pairGroup 不传时按 lrc/lrcPlain、ttml/ttmlPlain 推断） */
function bindSyncScroll(el: unknown, group: string, pairGroup?: string) {
  const root = (el as any)?.$el ?? el
  const textarea = root?.querySelector?.('textarea')
  const g = scrollGroup(group)
  if (!(textarea instanceof HTMLElement)) { g.els = []; return } // 卸载/重渲染 null 阶段
  if (g.els[0] === textarea) return // 已绑定，避免重复挂监听
  g.els = [textarea]
  const pair = pairGroup || (group === 'lrc' ? 'lrcPlain' : group === 'lrcPlain' ? 'lrc'
    : group === 'ttml' ? 'ttmlPlain' : 'ttml')
  textarea.addEventListener('scroll', () => {
    const dst = syncScrollGroups.get(pair)
    if (!dst) return
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

// ===== LRC 版本管理（容器模型：一个容器 = 一个投稿版本 = lyric_versions 一行；
//   每容器 1 个原文轨 + 翻译/音译轨；多个原文 = 多个容器 = 多版本，互不合并。
//   声明必须先于下方 LRC 版本管理区（watch 注册即读取 getter，TDZ 防护） =====

/** LRC 轨条目（原文/翻译/音译；lrc 框展示「API 切片形态」，保存时翻译/音译由 parseTrackBox 剥锚点） */
interface LrcTrackEntry {
  lang: string
  kind: LyricKind
  lrc: string
  /** 纯文本区内容（从本轨行文本回填；编辑后反向派生回 lrc） */
  plain: string
  /** 上次派生用的纯文本（幂等：切轨/程序化回填不重复派生） */
  lastPlain: string
  /** 上次派生用的 LRC 源码（幂等：切轨/程序化赋值不重复派生） */
  lastDerived: string
}

/** LRC 容器条目：id = lyric_versions 行 id（null = 新增未落盘） */
interface LrcContainerEntry {
  id: string | null
  /** 版本级贡献者（默认锁定防误改；新投稿/无贡献者默认站长 ct_owner） */
  contributorId: string
  contributorUnlock: boolean
  /** 含音译标记：勾选后粘贴完整版拆分时，同戳组【末行】判音译（不管 2 行还是 3+ 行） */
  hasRoman: boolean
  /** 完整版粘贴框内容 + 上次拆分快照（幂等） */
  fullLrc: string
  lastFull: string
  /** 轨列表：第 1 个恒为原文，翻译居中，音译末位 */
  tracks: LrcTrackEntry[]
}

const lrcContainers = ref<LrcContainerEntry[]>([])
const activeLrcContainerIdx = ref(0)
const versionsDirty = ref(false)
let suppressDirty = false

const activeLrcContainer = computed(() => lrcContainers.value[activeLrcContainerIdx.value] || null)

/** 轨 lrc → 纯文本（行主文本，剥词级标签） */
function plainOfLrc(lrc: string): string {
  if (!lrc.trim()) return ''
  return parseLrcToRows(lrc).filter(r => r.time_ms != null).map(r => stripWordTags(r.text)).join('\n')
}

function makeTrack(lang: string, kind: LyricKind, lrc: string): LrcTrackEntry {
  const plain = plainOfLrc(lrc)
  return { lang: lang?.trim() || 'zh', kind, lrc, plain, lastPlain: plain, lastDerived: lrc.trim() }
}

function makeContainer(id: string | null, contributorId: string, trackForms: LyricVersionForm[], hasRoman = false): LrcContainerEntry {
  const tracks = trackForms.length
    ? trackForms.map(f => makeTrack(f.lang, f.kind, f.lrc))
    : [makeTrack('zh', 'original', '')]
  return { id, contributorId: contributorId || OWNER_CONTRIBUTOR_ID, contributorUnlock: false, hasRoman, fullLrc: '', lastFull: '', tracks }
}

/** 回填「完整版 LRC」框：raw 显式传入用 raw（新建预填=lrc_text 原文），否则由各轨合成（库内加载/审核回填）；
 *  同步 lastFull 快照，防止粘贴框 watch 把已加载的轨框误重拆覆盖 */
function fillContainerFullLrc(c: LrcContainerEntry, raw?: string) {
  c.fullLrc = raw != null ? raw : composeLrcTextOf(c)
  c.lastFull = c.fullLrc.trim()
}

/** 容器原文轨语言（版本下拉标签用） */
function containerOrigLang(c: LrcContainerEntry): string {
  return c.tracks.find(t => t.kind === 'original')?.lang || 'zh'
}

/** 贡献者名（版本下拉标签用；传入列表缺失时回退站长名/原始 id） */
function contributorName(id: string | null | undefined): string {
  if (!id) return '未设置'
  return props.contributors.find(c => c.id === id)?.name || (id === OWNER_CONTRIBUTOR_ID ? 'X2ISPANDA' : id)
}

/** 容器轨框 → 合成版本数组（原文直解；翻译/音译 parseTrackBox 剥锚点；音译 {LSU,}/{LSJ,} 先展开对齐原文词级时间） */
function buildContainerVersions(c: LrcContainerEntry): LyricVersion[] {
  const origTrack = c.tracks.find(t => t.kind === 'original' && t.lrc.trim())
  const origVersion: LyricVersion | null = origTrack
    ? { lang: origTrack.lang, kind: 'original', rows: parseLrcToRows(origTrack.lrc) }
    : null
  const out: LyricVersion[] = []
  for (const t of c.tracks) {
    if (!t.lrc.trim()) continue
    if (t.kind === 'original') {
      if (origVersion) out.push(origVersion)
    } else if (t.kind === 'romanization' && /\{LS[UJ]/.test(t.lrc)) {
      out.push(parseTrackBox(expandRomanSyntax(t.lrc, origTrack?.lrc || ''), t.lang, 'romanization', origVersion))
    } else {
      out.push(parseTrackBox(t.lrc, t.lang, t.kind, origVersion))
    }
  }
  return out.filter(v => v.rows.length)
}

/** 容器 → 合成 LRC 文本（预览/落库同源；同戳同文本去重在 composeMixedLrc 兜底） */
function composeLrcTextOf(c: LrcContainerEntry | null | undefined): string {
  if (!c) return ''
  const vs = buildContainerVersions(c)
  return vs.length ? composeMixedLrc(vs, 'enhanced') : ''
}

/** 主版本（排序第一的容器）合成 LRC：写 songs.lrc_text；其余容器各自独立落盘 */
const lrcPreview = computed(() => composeLrcTextOf(lrcContainers.value[0]))
/** 当前编辑容器的合成预览（只读） */
const activeLrcPreview = computed(() => composeLrcTextOf(activeLrcContainer.value))

/** 容器列表整体替换（加载/重置统一入口；回填 form.lrc_text） */
function setLrcContainers(containers: LrcContainerEntry[]) {
  suppressDirty = true
  lrcContainers.value = containers.length ? containers : [makeContainer(null, form.contributor_id || OWNER_CONTRIBUTOR_ID, [])]
  activeLrcContainerIdx.value = 0
  form.lrc_text = composeLrcTextOf(lrcContainers.value[0])
  nextTick(() => {
    suppressDirty = false
    versionsDirty.value = false
  })
}

/** 容器增删（编辑模式多版本并存；新增/审核模式仅单容器，按钮隐藏） */
function addLrcContainer() {
  lrcContainers.value.push(makeContainer(null, OWNER_CONTRIBUTOR_ID, []))
  activeLrcContainerIdx.value = lrcContainers.value.length - 1
}
function removeLrcContainer(idx: number) {
  const c = lrcContainers.value[idx]
  if (!c) return
  if (c.id) ElMessage.info('库内版本将在保存时删除')
  lrcContainers.value.splice(idx, 1)
  if (!lrcContainers.value.length) lrcContainers.value.push(makeContainer(null, OWNER_CONTRIBUTOR_ID, []))
  activeLrcContainerIdx.value = Math.min(activeLrcContainerIdx.value, lrcContainers.value.length - 1)
}

/** 轨增删（原文轨不可删——删原文 = 删整版本；音译轨每容器至多 1 个） */
function addLrcTrack(kind: LyricKind) {
  const c = activeLrcContainer.value
  if (!c) return
  if (kind === 'romanization' && c.tracks.some(t => t.kind === 'romanization')) return
  c.tracks.push(makeTrack(kind === 'romanization' ? 'zh-Latn-pinyin' : 'en', kind, ''))
}
function removeLrcTrack(ti: number) {
  const c = activeLrcContainer.value
  if (!c || !c.tracks[ti] || c.tracks[ti].kind === 'original') return
  c.tracks.splice(ti, 1)
}

/** 轨语言下拉选项：罗马音轨只列 BCP47 拉丁化方案，其余列自然语言 */
function trackLangOptions(t: LrcTrackEntry): string[] {
  return t.kind === 'romanization' ? TRANSLIT_LANG_OPTIONS : LYRIC_LANG_OPTIONS
}
/** 轨语言设置（类型联动）：罗马音轨必须是拉丁化方案；原文/译文不能是 Latn 标签 */
function setTrackLang(t: LrcTrackEntry, v: string) {
  if (t.kind === 'romanization') t.lang = TRANSLIT_LANG_OPTIONS.includes(v) ? v : 'zh-Latn-pinyin'
  else t.lang = /Latn/i.test(v) ? 'zh' : v
}

/** 完整版粘贴框：防抖拆分；勾选/取消「含音译」且已有粘贴内容时用新规则重拆 */
let lrcFullTimer: ReturnType<typeof setTimeout> | null = null
watch(() => activeLrcContainer.value?.fullLrc, () => {
  if (lrcFullTimer) clearTimeout(lrcFullTimer)
  lrcFullTimer = setTimeout(splitFullLrc, 400)
})
watch(() => activeLrcContainer.value?.hasRoman, (v, old) => {
  if (v === old) return
  const c = activeLrcContainer.value
  if (c && c.fullLrc.trim()) { c.lastFull = ''; splitFullLrc() }
})

function splitFullLrc() {
  const c = activeLrcContainer.value
  if (!c) return
  const raw = c.fullLrc.trim()
  if (raw === c.lastFull) return
  c.lastFull = raw
  if (!raw) return
  if (!/^\[\d{1,3}:\d{2}/m.test(raw)) {
    ElMessage.warning('未检测到时间戳：完整版 LRC 请粘贴到「完整版 LRC」框；纯文本歌词请粘贴到右侧「纯文本」框')
    return
  }
  const vs = splitLrcToVersions(c.fullLrc, { hasRoman: c.hasRoman })
  if (vs.length < 2) {
    // 单语言：写入原文轨
    const orig = c.tracks.find(t => t.kind === 'original')
    if (orig) {
      orig.lrc = rowsToLrcText(vs[0].rows, 'enhanced')
      orig.lastDerived = orig.lrc.trim()
      orig.plain = plainOfLrc(orig.lrc)
      orig.lastPlain = orig.plain
    }
    return
  }
  // 多轨：替换本容器全部轨（原文/翻译/音译），人工核对语言标注
  c.tracks = vs.map(v => makeTrack(v.lang, v.kind, rowsToLrcText(v.rows, 'enhanced')))
  c.hasRoman = c.hasRoman || vs.some(v => v.kind === 'romanization')
  ElMessage.success(`已拆分为 ${vs.length} 个轨（原文/翻译/音译），请核对语言与类型`)
}

/** 轨输入防抖（平铺后每张轨卡独立监听；WeakMap 随轨对象销毁自动回收） */
const trackTimers = new WeakMap<LrcTrackEntry, { lrc?: ReturnType<typeof setTimeout>; plain?: ReturnType<typeof setTimeout> }>()
function onTrackLrcInput(t: LrcTrackEntry) {
  let tm = trackTimers.get(t)
  if (!tm) { tm = {}; trackTimers.set(t, tm) }
  if (tm.lrc) clearTimeout(tm.lrc)
  tm.lrc = setTimeout(() => deriveTrackSource(t), 400)
}
function onTrackPlainInput(t: LrcTrackEntry) {
  let tm = trackTimers.get(t)
  if (!tm) { tm = {}; trackTimers.set(t, tm) }
  if (tm.plain) clearTimeout(tm.plain)
  tm.plain = setTimeout(() => { if (t.plain !== t.lastPlain) deriveTrackPlain(t) }, 400)
}

/** 轨 LRC 源码变化（防抖后）：原文轨粘贴整体多语言 LRC → 拆分替换本容器各轨（便捷入口）；单轨原位更新 */
function deriveTrackSource(t: LrcTrackEntry) {
  const c = activeLrcContainer.value
  if (!c) return
  const raw = t.lrc.trim()
  if (raw === t.lastDerived) return
  t.lastDerived = raw
  if (!raw) { t.plain = ''; t.lastPlain = ''; return }
  if (!/^\[\d{1,3}:\d{2}/m.test(raw)) {
    ElMessage.warning('未检测到时间戳：LRC 代码请粘贴到左侧「LRC 源码」框；纯文本歌词请粘贴到右侧「纯文本」框')
    return
  }
  if (t.kind === 'original') {
    const vs = splitLrcToVersions(t.lrc, { hasRoman: c.hasRoman })
    if (vs.length > 1) {
      // 原文框粘贴整体多语言 LRC：拆分替换本容器各轨
      c.tracks = vs.map(v => makeTrack(v.lang, v.kind, rowsToLrcText(v.rows, 'enhanced')))
      c.hasRoman = c.hasRoman || vs.some(v => v.kind === 'romanization')
      ElMessage.success(`已拆分为 ${vs.length} 个轨（原文/翻译/音译）`)
      return
    }
  }
  // 单轨：原位更新，纯文本区回填（翻译/音译框里的头部公共行/同戳原文行在保存时由 parseTrackBox 剥离）
  t.plain = plainOfLrc(t.lrc)
  t.lastPlain = t.plain
}

/** 纯文本区变化（防抖后）：本轨有 LRC → 原位更新文字；空轨 → 以原文轨为模板生成变体 */
function deriveTrackPlain(t: LrcTrackEntry) {
  const c = activeLrcContainer.value
  const raw = t.plain.trim()
  t.lastPlain = t.plain
  if (!raw || !c) return // 纯文本区清空不动作（删轨请用轨卡右上角「删除」）
  const isNew = !t.lrc.trim()
  // 模板：本轨有 LRC 用自身；空轨先用本容器原文轨，再跨容器找第一个有 LRC 的原文轨（简↔繁变体 = 新版本场景）
  const base = !isNew ? t
    : c.tracks.find(x => x.kind === 'original' && x.lrc.trim())
      || lrcContainers.value.flatMap(x => x.tracks).find(x => x.kind === 'original' && x.lrc.trim())
  if (!base) {
    ElMessage.warning('纯文本生成变体需要先粘贴 LRC（拆分出原文轨后才能做模板）')
    return
  }
  const errors: { line: string; expect: number; got: number }[] = []
  const variant = generateLrcVariant(base.lrc, raw, errors)
  if (!variant) {
    if (errors.length) {
      const detail = errors.slice(0, 5).map(x => x.line ? `${x.line}需 ${x.expect} 词，实际 ${x.got} 词` : `行数不匹配：原文 ${x.expect} 行，粘贴 ${x.got} 行`).join('；')
      ElMessage.error(`变体生成失败：${detail}${errors.length > 5 ? ` 等 ${errors.length} 处` : ''}。规则：含空格按空格分词，无空格按单字`)
    } else {
      ElMessage.error('变体生成失败（原文轨解析异常）')
    }
    return
  }
  t.lrc = variant
  t.lastDerived = variant.trim()
  if (isNew && t.kind !== 'romanization') {
    const detected = detectLang(raw)
    if (detected !== 'unknown') t.lang = detected
  }
  ElMessage.success(isNew ? '已生成变体（模板：原文轨；语言可在上方修改）' : '已按纯文本更新歌词（时间戳照抄）')
}

/** 容器内容变化 → 脏标记 + 合成主版本 lrc_text（保持与预览/落库一致；清空全部容器即清空 LRC） */
watch(lrcContainers, () => {
  if (suppressDirty) return
  versionsDirty.value = true
  form.lrc_text = lrcPreview.value
}, { deep: true })

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
  /** 版本级贡献者（默认锁定；新投稿/无贡献者默认站长 ct_owner） */
  contributorId: string
  contributorUnlock: boolean
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

/** 重置为单个版本（新建/审核回填投稿原文/清空；contributorId 默认站长，审核回填投稿人） */
function initTtmlVersions(raw: string, opts: { id?: string | null; origin?: string; contributorId?: string | null } = {}) {
  // 先格式化再解析：源码区展示与模型 bodyRaw 均为格式化后的 TTML（保存输出保持可读）
  const source = raw.trim() ? prettifyTtml(raw) : ''
  const model = source
    ? (parseTtmlForEdit(source) || { bodyRaw: source, bodyLang: '', origBodyLang: '', origBodyTtmlLang: '', lines: [], translations: [], transliterations: [] })
    : emptyTtmlEditModel()
  // 原文无 xml:lang 标注 → 按内容猜测填默认（用户可改；改动会写回 body xml:lang）
  if (!model.bodyLang) model.bodyLang = guessBodyLang(model)
  const plain = modelPlainText(model)
  ttmlVersions.value = [{
    id: opts.id ?? null, source, plain, origin: opts.origin || 'user',
    contributorId: opts.contributorId || OWNER_CONTRIBUTOR_ID, contributorUnlock: false,
    lastDerived: source.trim(), lastPlain: plain, model,
  }]
  activeTtmlIdx.value = 0
  batchPaste.trans = []
  batchPaste.roman = []
}

/** 添加版本（空白，粘贴另一语言变体如简/繁体 TTML 或纯文本） */
function addTtmlVersion() {
  const model = emptyTtmlEditModel()
  model.bodyLang = 'zh'
  ttmlVersions.value.push({ id: null, source: '', plain: '', origin: 'user', contributorId: OWNER_CONTRIBUTOR_ID, contributorUnlock: false, lastDerived: '', lastPlain: '', model })
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

/** 批量复制：该轨表格全部行按 L1~LN 顺序写入剪贴板（空行保留，与批量粘贴的行数对齐语义对应；
 *  用途：换版本 TTML 前先复制某语种翻译/音译，换入后再批量粘贴合并，取两版之长） */
async function copyBatch(target: 'trans' | 'roman', idx: number) {
  const lines = target === 'trans' ? ttmlEdit.value.translations[idx]?.lines : ttmlEdit.value.transliterations[idx]?.lines
  if (!lines) return
  const empty = lines.filter(ln => !ln.text.trim()).length
  await copyText(lines.map(ln => ln.text).join('\n'))
  ElMessage.success(`已复制 ${lines.length} 行到剪贴板（空行 ${empty} 行已保留，粘贴时按行对齐）`)
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

/** 编辑模式加载时的 LRC 容器快照：已落盘 id 集合（保存时判删除）& 主版本 id（主版本被删时兜底置顶） */
const initialLrcVersionIds = new Set<string>()
let initialPrimaryLrcId: string | null = null

// ===== LRC 容器加载（行表按 version_id 归容器；历史「多原文合进一个容器」的数据自愈拆回多容器） =====
async function loadVersions(songId: string) {
  try {
    const [rows, metas] = await Promise.all([loadLyricLines(songId), loadLyricVersionMetas(songId)])
    const lrcMetas = metas.filter(m => m.format === 'lrc' || m.format === 'enhanced')
    const buckets = groupVersionsByContainer(rows)
    /** 行表版本 → 轨框表单（fillCommonRows 补公共行 = API 切片形态；原文在前、翻译居中、音译末位） */
    const tracksOf = (versions: LyricVersion[]): LyricVersionForm[] => {
      const rank = (k: LyricKind) => (k === 'original' ? 0 : k === 'translation' ? 1 : 2)
      return [...fillCommonRows(versions)]
        .sort((a, b) => rank(a.kind) - rank(b.kind) || a.lang.localeCompare(b.lang))
        .map(v => ({ lang: v.lang, kind: v.kind, lrc: rowsToLrcText(v.rows, 'enhanced') }))
    }
    const containers: LrcContainerEntry[] = []
    const matched = new Set<string | null>()
    for (const m of lrcMetas) {
      const bucket = buckets.find(b => b.versionId === m.id)
      matched.add(m.id)
      const forms = bucket ? tracksOf(bucket.versions) : []
      // 无贡献者的库内版本 = 站长自建（投稿审核入库的版本必有贡献者）
      const contrib = m.contributor_id || OWNER_CONTRIBUTOR_ID
      const originals = forms.filter(f => f.kind === 'original')
      if (originals.length > 1) {
        // 自愈：历史数据把多个原文版本合进了一个容器 → 拆成多个容器（翻译/音译轨挂首个原文）
        const firstOrig = originals[0]
        const mainForms = forms.filter(f => f.kind !== 'original' || f === firstOrig)
        containers.push(makeContainer(m.id, contrib, mainForms, forms.some(f => f.kind === 'romanization')))
        for (const ex of originals.slice(1)) containers.push(makeContainer(null, contrib, [ex], false))
      } else {
        containers.push(makeContainer(m.id, contrib, forms, forms.some(f => f.kind === 'romanization')))
      }
      initialLrcVersionIds.add(m.id)
      if (m.is_primary) initialPrimaryLrcId = m.id
    }
    // 脏数据兜底：有行表但元数据缺失的桶单独成容器
    for (const b of buckets) {
      if ((b.versionId && matched.has(b.versionId)) || !b.versions.length) continue
      containers.push(makeContainer(b.versionId, OWNER_CONTRIBUTOR_ID, tracksOf(b.versions)))
      if (b.versionId) initialLrcVersionIds.add(b.versionId)
    }
    // 行表/元数据为空：保留 lrc_text 拆分预填（保存走 rebuild 兜底）
    if (containers.length) {
      // 完整版 LRC 框回填（与预览同源合成）；lastFull 同步防 watch 误重拆
      for (const c of containers) fillContainerFullLrc(c)
      setLrcContainers(containers)
    }
  } catch (e: any) {
    // 行表读失败保留预填容器（保存走 rebuild 兜底）
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
        // 无贡献者的库内版本 = 站长自建（投稿审核入库的版本必有贡献者）
        contributorId: v.contributor_id || OWNER_CONTRIBUTOR_ID,
        contributorUnlock: false,
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
        ttml_text: text, langs, contributor_id: e.contributorId || null,
      }).eq('id', e.id)
      if (error) throw new Error(`TTML 版本更新失败（${error.message}）`)
    } else if (text) {
      // 新增 INSERT（与发布链同结构）
      const newId = 'lv_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      const { error } = await supabase.from('lyric_versions').insert({
        id: newId, song_id: songId, format: 'ttml', source: e.origin || 'user',
        ttml_text: text, langs, status: 'published', is_primary: false,
        contributor_id: e.contributorId || null,
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

/**
 * LRC 容器逐版本落盘（一个容器 = lyric_versions 一行 = 一个投稿版本）：
 * - 有 id → UPDATE 元数据（format/langs/贡献者）+ save_lyric_lines 全量替换行表
 * - 无 id → INSERT lyric_versions 后写行表；新歌第一个有内容的容器复用触发器按 lrc_text 建的默认版本
 * - 空容器（轨全清空）且有 id → 删除版本（行表随版本级联）
 * - 编辑模式：加载时存在（initialLrcVersionIds）、现已消失的版本 → 删除
 */
async function upsertLrcContainers(songId: string, isNewSong = false) {
  let defaultReused = false
  for (const c of lrcContainers.value) {
    const versions = buildContainerVersions(c)
    if (!versions.length) {
      if (c.id) {
        const { error } = await supabase.from('lyric_versions').delete().eq('id', c.id)
        if (error) console.warn('[LRC 版本删除失败]', c.id, error.message)
        else c.id = null
      }
      continue
    }
    const allRows = versions.flatMap(v => v.rows)
    const meta = {
      format: rowsHaveWordTags(allRows) ? 'enhanced' : 'lrc',
      langs: [...new Set(versions.map(v => v.lang).filter(Boolean))],
      contributor_id: c.contributorId || null,
    }
    let vid: string
    if (c.id) {
      vid = c.id
      const { error } = await supabase.from('lyric_versions').update(meta).eq('id', vid)
      if (error) throw new Error(`LRC 版本更新失败（${error.message}）`)
    } else if (isNewSong && !defaultReused) {
      // 新歌：触发器已按 lrc_text 建默认 lrc/enhanced 版本 → 复用并刷新元数据（与发布链 saveLyricLines 同路径）
      vid = await resolveDefaultLinesVersionId(songId)
      defaultReused = true
      const { error } = await supabase.from('lyric_versions').update(meta).eq('id', vid)
      if (error) throw new Error(`LRC 默认版本更新失败（${error.message}）`)
      c.id = vid
    } else {
      vid = 'lv_' + crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      const { error } = await supabase.from('lyric_versions').insert({
        id: vid, song_id: songId, source: 'user',
        status: 'published', is_primary: false, ...meta,
      })
      if (error) throw new Error(`LRC 版本写入失败（${error.message}）`)
      c.id = vid
    }
    await saveLyricLines(songId, versions, vid)
  }
  if (!isNewSong) {
    const keepIds = lrcContainers.value.map(c => c.id).filter(Boolean) as string[]
    const keep = new Set(keepIds)
    for (const id of initialLrcVersionIds) {
      if (keep.has(id)) continue
      const { error } = await supabase.from('lyric_versions').delete().eq('id', id)
      if (error) console.warn('[LRC 旧版本删除失败]', id, error.message)
    }
    // 主版本被删：首个保留容器兜底置顶（默认版本解析/API 主版本选取不落空）
    if (initialPrimaryLrcId && !keep.has(initialPrimaryLrcId) && keepIds.length) {
      const { error } = await supabase.from('lyric_versions').update({ is_primary: true }).eq('id', keepIds[0])
      if (error) console.warn('[LRC 主版本兜底置顶失败]', error.message)
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
  // LRC 容器：lrc_text 预拆分预填单容器（编辑模式随后由行表加载覆盖；review 模式由投稿 versions 覆盖）；
  // 贡献者绑定在版本上——无投稿人默认站长 ct_owner
  const seedContrib = form.contributor_id || OWNER_CONTRIBUTOR_ID
  const seed = makeContainer(
    null,
    seedContrib,
    form.lrc_text.trim()
      ? splitLrcToVersions(form.lrc_text).map(v => ({ lang: v.lang, kind: v.kind, lrc: rowsToLrcText(v.rows, 'enhanced') }))
      : [],
  )
  // 完整版框回填 lrc_text 原文（编辑模式随後由行表加载覆盖）
  fillContainerFullLrc(seed, form.lrc_text)
  setLrcContainers([seed])
  initTtmlVersions(form.ttmlText, { contributorId: form.contributor_id })
  if (props.editSongId) {
    loadVersions(props.editSongId)
    loadTtmlVersion(props.editSongId)
  }
  // review 模式（投稿审核）：无库内 songId，投稿自带的多语言版本直接预填（单容器；含音译轨 → 勾选含音译）
  else if (props.mode === 'review' && Array.isArray((props.initial as any)?.versions)) {
    const revVers = (props.initial as any).versions as any[]
    const revSeed = makeContainer(
      null,
      seedContrib,
      revVers.map((v: any) => ({ lang: v.lang, kind: v.kind, lrc: v.lrc })),
      revVers.some((v: any) => v.kind === 'romanization'),
    )
    // 投稿无完整版原文 → 由各轨合成回填完整版框
    fillContainerFullLrc(revSeed)
    setLrcContainers([revSeed])
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
      // review 单容器：轨框 → 合成版本数组（翻译/音译剥锚点、音译 {LSU,}/{LSJ,} 展开均在 buildContainerVersions 内）
      versions: buildContainerVersions(lrcContainers.value[0] || makeContainer(null, OWNER_CONTRIBUTOR_ID, []))
        .map(v => ({ lang: v.lang, kind: v.kind, lrc: rowsToLrcText(v.rows, 'enhanced') })),
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

    // 最终入库 LRC 与预览一致（所见即所存）：容器脏 → 逐容器落盘（行表/版本元数据/版本贡献者）
    let finalLrcText = lrcPreview.value.trim()
    if (versionsDirty.value && editing.value) {
      await upsertLrcContainers(props.editSongId!)
      finalLrcText = lrcPreview.value.trim()
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
      // songs 表展示兼容：用主容器（第一版本）贡献者
      contributor_id: lrcContainers.value[0]?.contributorId || form.contributor_id || null,
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
      // LRC 容器落盘：首容器复用触发器按 lrc_text 建的默认版本（精确行表/音译判定），其余容器新增版本
      await upsertLrcContainers(payload.id as string, true)
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