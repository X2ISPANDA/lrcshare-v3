# phase5 阶段 F 验证清单（播放页 TTML 渲染 + admin 待匹配确认）

> F 阶段为纯前端改动，无 SQL。改动文件：
> - `src/lib/lyricLines.ts`：`parseTtmlStructure`（对唱/和声/语言结构化解析，展示容错版）+ `loadLyricVersionMetas`（D2 排序）+ `detectTtmlLangs`
> - `src/views/SongView.vue`：第三个歌词 tab（仅当存在 TTML 版本时出现），白板歌默认落 TTML tab
> - `src/views/admin/TtmlHubView.vue`（新）+ 路由 + AdminLayout 菜单：待确认队列 / 已导入版本管理
> - `src/lib/constants.ts`：新增 `TTML_HUB_BASE`
>
> 前置：B/D/E 阶段已执行；库内已有 ttml-hub 白板歌（~2600）与 63 条 pending。

## 1. 播放页 · ttml-hub 白板歌（核心路径）

打开任一 `origin='ttml-hub'` 的歌（歌曲管理里筛选，或从首页搜索点进一首 ttml-hub 同步来的歌）。

- [ ] 默认落在 **「逐字歌词」/「对唱歌词」** tab（无 lrc_text/lyrics_text 的白板歌自动选中）
- [ ] tab 标签动态：TTML 含 `ttm:agent` → 「🎭 对唱歌词」；不含 → 「⌨️ 逐字歌词」
- [ ] 歌词按时间序渲染；**对唱歌行分列**（第 1 声部居左、第 2 声部居右、group/无声部居中）
- [ ] 和声行（`ttm:role="x-bg"`）以灰色斜体小字显示在主行下方
- [ ] 翻译轨道（同 begin 不同 xml:lang 的行）以灰色小字随行显示
- [ ] 页底署名：ttml-hub 版本显示「歌词来自 TTML Hub」
- [ ] URL 带 `?tab=ttml` 刷新后保持在该 tab
- [ ] 多 TTML 版本时出现版本下拉（来源 · 语言），切换正常

## 2. 播放页 · 回归（老歌零变化）

打开一首**用户投稿的 LRC 歌**（无 TTML 版本）：

- [ ] 不出现第三个 tab；文本歌词 / LRC 歌词行为与改造前完全一致
- [ ] LRC tab 的版本/格式下拉、逐字/TTML 导出均正常
- [ ] 隐藏歌：未解锁时无歌词数据请求泄露（TTML 版本查询仅在非隐藏时发起）；解锁后 TTML tab 正常

## 3. admin · TTML Hub 待确认队列

进入 `/admin/ttml-hub`：

- [ ] 待确认队列显示 pending 条目（数量与 `SELECT count(*) FROM ttml_hub_pending WHERE resolution IS NULL` 一致）
- [ ] 命中情况列正确区分：多候选 / 标题歌手全等（附候选歌名）/ 无同名候选
- [ ] **挂到歌**：点开后搜索框预填候选歌名 → 选歌 → 提示成功 → 歌曲详情页出现该 TTML（对唱 tab 可看）
- [ ] SQL 复核：`SELECT * FROM lyric_versions WHERE id = 'lv_<hubId>'`（format=ttml, source=ttml-hub, status=published, langs 有值）；pending 行 `resolution='merged'`
- [ ] **忽略**：确认后条目从队列消失（resolution='ignored'）
- [ ] **挪歌**（拆分场景）：选目标歌后版本 song_id 更新，详情页两首歌的歌词归属正确
- [ ] **删除已导入版本**：版本删除后，ttml-hub 下一轮同步会重新将其按未导入处理（幂等可恢复）
- [ ] 移动端（<768px）卡片布局正常（AdminTable 双形态）

## 4. 全链路回归

- [ ] 投稿一首 LRC → 审核 → 发布 → 详情页无 TTML tab，LRC tab 正常
- [ ] 投稿一首带 `ttm:agent` 的 TTML → 发布 → 详情页出现「对唱歌词」tab 且分列渲染正确
- [ ] open-api 详情接口 `lyric_versions` 字段正常（部署过阶段 C 的 Worker 无需重新部署）
- [ ] `npm run build` 通过（SSG 构建期无 DOMParser，已加守卫返回空结构）

## 5. 已知边界（非缺陷）

- 对唱左右归属按"声部首次出现顺序"（v1 左 / v2 右），不读取歌手性别信息——AMLL 标准本身不含性别
- `parseTtmlStructure` 对非 clock-time 时间戳容错（begin 置 null 保留行），与投稿解析的严格模式（`parseTtmlToRows` 报错拒绝）不同，属设计差异
- admin 各旧页面（AlbumsView 等）的 `DefaultRow` 类型报错为历史遗留，与本次改动无关
