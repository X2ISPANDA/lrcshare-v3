# 阶段四：多语言多类型歌词 — 进度交接文档

> 用途：供 AI 在 Trae 中继续 phase4 开发时快速理解现状、设计决策与剩余待办。
> 更新日期：2026-08-29（P2-2 完成、触发器改仅 INSERT、fallback 修复后）。

---

## 一、整体进度

| 阶段 | 内容 | 状态 |
|---|---|---|
| P1 | 建表 + 存量迁移 + 拆行函数 + 触发器 + 校验 | ✅ 完成（已执行，守恒校验通过） |
| P2-1 | 三语言拆分（位置结构） | ✅ 完成（函数已改，s_namewee_005 已拆对） |
| P2-2 | API 读取（line/enhanced/ttml + lyric_lines + lyrics 数组） | ✅ 完成（Worker 已部署并测试） |
| P2-3 | 后台（存疑页 + 版本管理 + TTML 解析器） | ✅ 完成（代码已实现，type-check 通过） |
| P3 | 投稿端多格式 + Lyrico 插件 structured 接真数据 | 🔶 投稿端完成（TTML 转 LRC + 语言选择）；插件在外部仓库待做 |

---

## 二、数据库对象（已建）

**表**：
- `public.song_lyric_lines`：歌词行表。列 `song_id, lang, kind, seq, time_ms, text, created_at, updated_at`，PK `(song_id, lang, kind, seq)`。
- `public.song_lyric_doubts`：存疑清单。列 `id, song_id, line_no, raw_text, reason, resolved, created_at`；`reason ∈ ('multi_same_ts','bare_line','word_tag_ambiguous')`。
- `public._backup_p4_lrc_text`：迁移前 lrc_text 备份（确认无误后可 DROP）。

**函数**：
- `lyric_lang_detect(text)`：单行语言判定（假名→ja、谚文→ko、汉字→zh、纯拉丁→latin、其他→unknown）。
- `rebuild_song_lyric_lines(song_id)`：拆行主函数（SECURITY DEFINER，幂等=先 DELETE 再 INSERT）。
- `trg_song_lyric_rebuild()`：触发器函数。
- `set_lyric_line_updated_at()`：updated_at 维护。

**触发器**：
- `trg_song_lyric_rebuild`：**仅 AFTER INSERT**（P2 起已改，行表权威）。
- `trg_lyric_lines_updated_at`：BEFORE UPDATE 维护 updated_at。

**RLS**：`song_lyric_lines` anon 只读（SELECT 策略 `USING (true)`）、authenticated 全权；`song_lyric_doubts` 仅 authenticated 可见。

---

## 三、P2-2 Worker 改动（cloudflare/open-api.js）

**核心函数**（已实现）：
- `getLyricVersions(env, songId)`：pgListAll 读行表。
- `groupVersions(rows)`：按 `(lang,kind)` 分组为 versions。
- `derivePrimaryLang(versions)`：original 版本里行数最多的 lang。
- `selectVersions(versions, lyricLang, translationLangs)`：选版本。
- `fillCommonRows(versions)`：**补齐公共行**（非 original 版本补 original 中 time_ms 缺失的行）。
- `formatLyricTime(ms)`：`mm:ss.xxx`（三位毫秒，不舍入）。
- `formatTtmlTime(ms)`：`HH:MM:SS.mmm`。
- `escapeXml(s)`：XML 转义。
- `stripWordTags(text)`：剥词标签（line）。
- `composeEnhancedText(text, timeMs)`：词标签相对偏移→绝对时间（enhanced）。
- `parseWordTags(text)`：解析词标签。
- `metaKeyOf(line)` / `dedupeMeta(metaLines)`：元数据 key 提取 + 去重排序（ti/ar/al/by/其他）。
- `composeLrc(versions, format)`：合成 LRC（元数据头部 + 歌词稳定排序 + line/enhanced）。
- `composeTtml(versions, credit)`：合成 TTML（`<p>`/`<span>` + end 派生 + 元数据 `<metadata>` + 署名超界 `<p>`）。
- `handleSong(env, id, url)`：**已改签名**，解析 `lyric_lang` / `lyric_translation_lang` / `lyric_format` / `lyric_lines`。

**API 行为**：
- 不带任何 lyric 参数 → `lrc` = 存量 `lrc_text` + 署名（零改动）。
- `lyric_lang` + `lyric_translation_lang` → 合成 `lrc` + `lyrics` 数组。
- `lyric_lines=1` → `lyric_lines` 结构化 `{primary_lang, versions[]}`。
- `lyric_format=line|enhanced|ttml`。
- 匹配不到任何版本 → `lrc = null`（已修，不 fallback 原始）。
- 署名：LRC `[419:19.999]本歌词来自于:...`；ttml 超界 `<p begin="06:59:19.999" ...>`。

---

## 四、关键设计决策（已收敛，勿回退）

1. **存储统一行表**，line/enhanced 不区分列——text 含 `<偏移毫秒>` 词标签即逐字，否则逐行。
2. **词标签存储态 = `<偏移毫秒>`（相对行首）**；输入态 LRC enhanced 的 `<mm:ss.xx>`（绝对）转偏移入库；输出 enhanced 时「行时间+偏移」还原绝对。
3. **语言判定 = 歌级 primary_lang + 位置结构（整体判断，不逐行 detect）**：
   - primary_lang：统计整首时间戳行 detect（`latin→en`），多数者。
   - 单行（非同戳）→ 全部归 `original(primary_lang)`（中文歌里一句英文也算原文）。
   - 同戳双行 → 两行 detect 都明确且不同才拆 original/translation，否则都归 original。
   - 同戳三行（三语言）→ **先统计位置众数**（第1/2/3行各是什么语言），再按位置分配（位置1=original、位置2/3=translation），**忽略个别行 detect 误判**（中日同形汉字也能按位置判对）。
4. **注记就是歌词**（`lyrics by`/`beats by`/`LRC:` 等前奏署名），不标记、不归元数据、保留时间戳与前奏展示。
5. **公共行补齐**：非 original 版本输出时补齐 original 中该版本没有对应 time_ms 的行（Hello/NONONO 等），保证「只取某个翻译版本」也完整。
6. **time_ms 整数毫秒（三位精度）**，输出 `mm:ss.xxx`（不舍入，与歌词滚动姬一致）。
7. **元数据行**（`[ti:]/[ar:]/[al:]/[by:]` 等）`time_ms=NULL`，text 存**完整 `[ti:xxx]`**；合成时输出头部、去重。
8. **latin 归属**：primary_lang=en→latin 是英文原文；ja→latin 是罗马音 ja-Latn；其他→译文 en。
9. **时间戳点/冒号双格式**：正则 `[.:]` 同时认 `[mm:ss.xx]` 和 `[mm:ss:xx]`。
10. **触发器仅 INSERT**（行表权威、lrc_text 派生）；后台重合成写回 lrc_text 不触发重拆。
11. **空文本时间戳行保留**（间奏清屏点，time_ms 有值 text=''）。
12. **text 前导空格保留**（用户觉得好看，滚动姬默认带空格）。

---

## 五、已知边界 / 坑

- **中日同形汉字**（如「川崎 任天堂」纯汉字日语）detect 无法区分——靠位置结构兜底；用户倾向手动把日语改成假名写法。
- **参数匹配不到版本 → lrc=null**（已修）。
- **触发器已改仅 INSERT**：后台版本管理上线后，任何 `UPDATE songs.lrc_text` 都不会再触发重拆，需要手动重合成。
- 拆行函数是幂等的（先 DELETE 再 INSERT），改函数后需重新执行 `CREATE OR REPLACE FUNCTION` 再重跑。

---

## 六、剩余待办

### P2-3（后台）—— ✅ 已完成
1. **存疑页**：`src/views/admin/DoubtsView.vue`（展示 `song_lyric_doubts`，按文本定位改 kind/lang 归位写 `song_lyric_lines` + 标记 resolved；路由 `/admin/lyric-doubts` + 菜单「歌词存疑」）
2. **版本管理**：`SongsView.vue` 歌词 tab 新增「多语言版本」子 tab（每 lang/kind 一个文本域 + LRC/TTML 格式选择，编辑已有歌曲时从行表加载，保存时写行表 + 重合成 lrc_text；整体 lrc_text 改动走 `rebuild_song_lyric_lines` RPC）
3. **TTML 解析器**：`src/lib/lyricLines.ts`（`parseTtmlToRows` / `versionsToTtml` + LRC 行 ↔ 文本互转 + 多版本合成）

### P3（投稿端 + 插件）
- ✅ **投稿表单多格式上传（无感）**：`SubmitView.vue` 歌词区单一文本域，提交时自动识别格式——TTML（`<tt`/`<p begin=` 开头）`parseTtmlToRows` 转 LRC，LRC 原样；多语言由发布时触发器自动拆分（不设语言/格式选择）
- ⏳ **Lyrico 插件 structured 接真数据**：插件代码在外部仓库 `Replica0110/Lyrico-Plugins`，不在本仓库；API 端 `lyric_lines=1`（structured）已就绪，改插件调用即可

---

## 七、文件清单

- `sql/phase4-lyric-versions.md`：方案定稿（v4，含位置结构、补齐语义、数据模型）。
- `sql/phase4-lyric-p1.md`：P1 正式 SQL（建表 + 迁移 + 校验 + 触发器，触发器已改仅 INSERT）。
- `cloudflare/open-api.js`：P2-2 全部 API 改动。
- `src/lib/lyricLines.ts`：P2-3 前端歌词工具（LRC/TTML 解析合成、行表读写、rebuild RPC）。
- `src/views/admin/DoubtsView.vue`：P2-3-1 存疑页。
- `src/views/admin/SongsView.vue`：P2-3-2 版本管理 tab。
- `src/views/SubmitView.vue`：P3 投稿多格式（TTML 转 LRC + 语言）。
- `phase4-进度交接.md`：本文档。

---

## 八、测试要点（回归）

- 不带参数 → `lrc` 与存量完全一致（零改动）。
- `lyric_lines=1` → 结构化行含 primary_lang + versions。
- `lyric_lang=en&lyric_translation_lang=zh` → 合成 LRC（英文原文+中文翻译）。
- `lyric_format=enhanced` → 词标签绝对时间；无词标签的行降级 line。
- `lyric_format=ttml` → 合法 XML，署名在超界 `<p>`。
- 三语言歌 `s_namewee_005`：`original/en + translation/zh + translation/ja`。
