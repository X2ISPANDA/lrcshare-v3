# Phase5：多歌词版本模型 + ttml-hub 接入

> 状态：**方案讨论稿，待确认**。确认后按第八节分阶段出正式 SQL 与代码计划。
> 前置：phase4 已收尾（`song_lyric_lines` 行表 + `song_lyric_doubts` 已执行，前端 `lyricLines.ts` 已同步）。

---

## 一、背景与目标

**背景**（三段讨论收敛）：

1. 同一首歌，不同人可能投稿不同"丰富度"的歌词：行级 LRC / 逐字 LRC / TTML。TTML 信息量最大（对唱声部、左右显示、行样式），LRC 只是它的降级投影。现有"一歌一份 `lrc_text` + 单 `contributor_id`"模型撑不住。
2. ttml-hub（<https://github.com/2755337087/ttml-hub>）提供静态发布 + 客户端轮询增量的接入机制：`manifest.json`（revision/ETag）+ `songs.json`（schema v2 索引）+ 按需下载 `.ttml`（附 sha256）。它不是实时推送，靠低成本的增量检查制造"实时感"。
3. 期望接入后：**我们库里没有的歌也能展示**（ttml-hub 自动建歌）、**库里已有的歌能合并它的版本**（我们出元数据、它出 TTML 内容，互补）、**内容跟随它更新/删除**。

**目标**：

1. 歌词从"歌 → 一份文本"升级为"歌 → 多个歌词版本"：每版本独立格式（lrc/enhanced/ttml）、来源、贡献者、署名、状态。
2. songs 表增加平台曲目 ID（`source_ids`），作为匹配合并的最高置信通道。
3. ttml-hub 接入：Workers Cron 增量同步，含自动建歌、匹配合并、更新/删除跟随、低置信人工队列。
4. 播放页提供歌词版本选择器。

**非目标**（本期不做）：

- TTML **可视化编辑器**（拖拽改声部归属、可视化调分屏/样式的图形界面——站内编辑仅提供源码文本框，与现有 LRC 编辑同体验；想做可视化编辑器另立项）。
- 其他歌词源接入（抽象出 source 字段但只实现 ttml-hub 一家）。

> **歌词编辑照常支持**（v2 澄清）：后台/审核的歌词编辑能力不变——LRC/逐字版在文本框里改（保存后重拆行表），TTML 版在源码文本框里改（保存即更新 `ttml_text`）。改文字、复制粘贴、修正时间轴都是普通文本编辑，不涉及任何特殊工具。

> 投稿 TTML **属于本期**（v2 修订）：用户投稿与 ttml-hub 同待遇——TTML 原文落盘、前端完整渲染对唱/分屏/样式。只投稿 LRC 时表现与现在完全一致，老投稿人零负担。

---

## 二、核心模型：歌 → 版本 → 行

```
songs（歌本体：封面、专辑、贡献者、状态、source_ids）
  └── lyric_versions（版本：format / source / contributor / 署名 / status / is_primary）
        ├── format=lrc/enhanced → 拆行进 song_lyric_lines（挂 version_id）
        └── format=ttml         → 原文落盘 ttml_text（不拆行，保留对唱/位置/样式）
```

**关键决策**：

1. **版本是"投稿/来源"维度的单位**：一次投稿 = 一个版本；ttml-hub 一份歌词 = 一个版本。同一版本内部的多语言/多类型（original/translation/romanization）沿用 phase4 行表模型，**不**再往下分版本。
2. **推翻 phase4 的"TTML 不落盘"决策（全部来源，含用户投稿）**：TTML 的对唱（`ttm:agent`）、左右显示、行样式在拆行时会丢失——这正是 TTML 相对 LRC 的核心价值，丢了就等于"TTML 只是另一种时间轴格式"。因此**任何来源的 TTML 都原文落盘**（用户投稿与 ttml-hub 同待遇），前端直出渲染；LRC/逐字版仍走行表。降级 LRC 仅作为播放页"复制 LRC"功能的按需转换，不落库。
3. **phase4 行表挂接版本**：`song_lyric_lines` 增加 `version_id` 列，主键从 `(song_id, lang, kind, seq)` 迁移为 `(version_id, lang, kind, seq)`。存量行表数据整体归属迁移产生的"legacy 用户版本"（见第八节步骤 B）。`rebuild_song_lyric_lines` 等 RPC 同步改造。
4. **`songs.lrc_text` 降级为兼容投影**：始终等于"当前主版本"（`is_primary=true` 的 lrc/enhanced 版本）的合成 LRC。无主版本时置空。详情/搜索 API 的既有消费者零感知。
5. **投稿侧同步切版本表（v2 收紧）**：投稿表单支持直接粘贴/上传 TTML（识别 `<tt` 头自动判定格式）；发布时无论什么格式都写 `lyric_versions`（TTML 存原文、LRC/逐字拆行）。投稿审核界面沿用现有 LRC 预览 + 新增 TTML 源码预览（结构化渲染预览属渲染层工作，随阶段 E 播放页一起做）。

---

## 三、数据模型

### 3.1 `lyric_versions`（新表）

```sql
CREATE TABLE public.lyric_versions (
  id             text PRIMARY KEY,                    -- lv_ 前缀（沿用项目 id 风格）
  song_id        text NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,
  format         text NOT NULL CHECK (format IN ('lrc','enhanced','ttml')),
  source         text NOT NULL DEFAULT 'user' CHECK (source IN ('user','ttml-hub')),
  external_id    text,                                -- ttml-hub 稳定歌词 ID（source=ttml-hub 必填）
  content_hash   text,                                -- 外部内容 sha256（增量变更检测）
  ttml_text      text,                                -- 仅 format='ttml'；lrc/enhanced 以行表为准
  langs          text[] NOT NULL DEFAULT '{}',        -- 摘要：该版本包含的语言（展示用，冗余可重建）
  status         text NOT NULL DEFAULT 'published'
                 CHECK (status IN ('pending','published','rejected','withdrawn')),
  is_primary     boolean NOT NULL DEFAULT false,      -- 一歌至多一个主版本（部分唯一索引保证）
  contributor_id text REFERENCES public.contributors(id) ON DELETE SET NULL,  -- 用户投稿贡献者；ttml-hub 来源为 NULL
  source_credit  text,                                -- 外部署名（ttml-hub metadata 的贡献者/站点名）
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX lyric_versions_song_external_uidx
  ON public.lyric_versions(song_id, external_id) WHERE external_id IS NOT NULL;  -- 同步幂等
CREATE UNIQUE INDEX lyric_versions_song_primary_uidx
  ON public.lyric_versions(song_id) WHERE is_primary;                            -- 主版本唯一
```

- **RLS**：沿用 phase2/3 模式——建表后立即 `REVOKE ALL FROM anon`，`GRANT SELECT` 给 anon（只读 published），写走 service role（同步）与 authenticated（后台）。
- **`ttml_text` 尺寸**：单文件普遍 < 100KB，text 列可承受，不入对象存储。
- **`UNIQUE(song_id, source, contributor_id, format)` 不加**：同一用户理论上可换内容重投，防重靠审核，不靠约束（对齐 phase4 第 4 条的思路）。

### 3.2 `songs.source_ids`（加列）

```sql
ALTER TABLE public.songs
  ADD COLUMN source_ids jsonb NOT NULL DEFAULT '{}'::jsonb;
-- 形如 {"appleMusicId":["1411387590"],"qqMusicId":["..."],"ncmMusicId":["..."]}
-- 数组语义与 ttml-hub schema v2 对齐（同一歌多发行版多 ID）
CREATE INDEX songs_source_ids_gin ON public.songs USING gin (source_ids);
```

⚠️ **硬约束（项目纪律）**：songs 加列后，所有 `RETURNS SETOF songs` 的 RPC 必须同步补 `null::jsonb as source_ids` 占位（`get_artist_songs`、搜索 RPC 等，逐个核对执行清单）。

### 3.3 ttml-hub 同步状态与待匹配队列（新表）

```sql
CREATE TABLE public.ttml_hub_state (
  id           text PRIMARY KEY DEFAULT 'singleton',
  revision     text,          -- 上次成功同步的 manifest revision
  etag         text,          -- manifest 的 ETag（If-None-Match 用）
  last_check   timestamptz,   -- 上次检查时间
  last_sync    timestamptz    -- 上次实际发生数据变更的时间
);

CREATE TABLE public.ttml_hub_pending (
  id           text PRIMARY KEY,          -- = ttml-hub 稳定歌词 ID
  title        text NOT NULL,
  artists      text[] NOT NULL,
  album        text,
  source_ids   jsonb NOT NULL DEFAULT '{}',
  path         text NOT NULL,             -- .ttml 相对路径（确认后再下载）
  reason       text NOT NULL CHECK (reason IN ('multi_candidate','low_confidence','conflict')),
  candidates   jsonb,                     -- 候选匹配到的我们 song_id 列表（含各自命中方式）
  resolution   text CHECK (resolution IS NULL OR resolution IN ('merged','created','ignored')),
  resolved_song text,                     -- 处理结果指向的 song_id
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);
```

- `ttml_hub_pending` 是**同步脚本写、后台人工读/处理**的队列；`resolution` 非空即出队（保留记录供审计）。
- RLS：anon 对两表零授权（同步与后台全走 service role / authenticated）。

---

## 四、ttml-hub 同步机制（Cloudflare Workers Cron）

### 4.1 同步流程（每小时 Cron）

```
1. GET manifest.json（带 If-None-Match: <etag>）
   ├─ 304 → 更新 last_check，结束（零成本）
   └─ 200 → revision 与 state.revision 比较
        ├─ 相同 → 更新 etag/last_check，结束
        └─ 不同 → 进入增量流程
2. GET songs.json（新索引）
3. 对比内存中的旧索引快照（state 存 revision，全量 diff 由索引对比得出）：
   新增/变更（path 或 sha256 变化）→ 逐个下载 .ttml（校验 sha256）→ 走第五节匹配
   删除（旧有、新无）→ 走 4.3 删除跟随
4. 更新 state（revision/etag/last_sync）+ 清理受影响歌曲的边缘缓存（见第六节）
```

- Cron 间隔 1 小时（`wrangler.toml` cron triggers：`0 * * * *`）。无更新时成本为一次 304 请求。
- 下载 `.ttml` 失败/校验不过 → 该歌记入日志跳过，下轮重试（幂等）。
- 端到端时效：ttml-hub 构建发布延迟 + ≤1h Cron + 缓存即时清理。**瓶颈在 ttml-hub 自己的发布周期，不在我们。**

### 4.2 自动建歌（库内没有的歌）

匹配不到已有 song 时，自动创建：

- `songs` 新行：title、`source_ids`（来自索引）、cover 为空（白板歌）、`status='published'`。
- 歌手：按索引 `artists` 文本建/复用 artist + `song_contributors`（role=singer）。
- 专辑：按 `album` 文本建/复用 album + `album_contributors`。
- 同步建的歌与投稿建的共用同一套搜索/展示路径，用户无感知。

### 4.3 删除跟随（他删我们跟）

- ttml-hub 删除某歌词 → 定位 `lyric_versions`（source='ttml-hub', external_id=X）：
  - 该歌**还有其他版本或正常元数据来源**（用户投稿行、投稿发布的歌）→ 只删该版本；若删的是主版本，主版本标记转移到剩余版本（优先用户版本）。
  - 该歌**整体由 ttml-hub 创建**（歌的来源标记，见第五节 5.4）且无任何用户版本 → 删歌本体（级联清 song_contributors/行表/缓存）。
- 与 submissions 级联删除共用"只删来源自己创建的实体"原则。

---

## 五、匹配与合并

### 5.1 三档置信

| 档 | 匹配方式 | 处理 |
|---|---|---|
| 1 | `source_ids` 平台 ID 精确命中（appleMusicId/qqMusicId/ncmMusicId，任一 ID 数组交集） | 自动合并 |
| 2 | 标题 + 艺术家完全一致（NFKC + 小写 + 删空白/`·・._-` 归一后比对；artists 与我们 song_contributors(role=singer) 全等） | 入 `ttml_hub_pending`，后台人工确认（D3 已定：存量期不自动合并） |
| 3 | 其余（多候选 / 相似 / Live / Remix / 同名歌） | 入 `ttml_hub_pending`，后台人工确认（合并/建歌/忽略） |

- 对齐 ttml-hub 官方接入指南的匹配纪律：兜底匹配**不取第一候选**，多候选交人工。
- 档 2 命中但歌名带 Live/Remaster/伴奏等标记 → 强制降档 3。

### 5.2 合并语义

合并 = 保留我们这条 song（封面、专辑、贡献者、状态都是我们的），把它的 TTML 作为一条 `lyric_versions`（source='ttml-hub'）挂到歌下。**不覆盖、不混写**任何我们已有的数据。

### 5.3 存量回填（一次性任务，全人工确认）

我们存量歌无平台 ID，且歌库为下架歌曲、与 ttml-hub 重合度预计不高：

1. 同步脚本首跑用 **dry-run 模式**：只做匹配计算，全部结果（含"标题+艺术家完全一致"的档 2）写入 `ttml_hub_pending`，**不写库**。
2. 后台待匹配页人工过目：看实际匹配量级，逐条确认合并 / 新建 / 忽略。
3. 确认合并时才回填 `songs.source_ids`；后续新增投稿歌可在投稿表单引导填平台 ID（另立 phase，本期只留字段）。

### 5.4 歌来源标记

`songs` 加 `origin text NOT NULL DEFAULT 'user' CHECK (origin IN ('user','ttml-hub'))`——仅用于 4.3 删除跟随判断"歌本体是否同步来源创建"。投稿/同步都写，展示层不用。

---

## 六、API 变更（open-api.js）

1. **`GET /v1/songs/:id` 详情**：响应新增 `lyric_versions` 数组（每项：`id/format/source/langs/is_primary/署名`），TTML 版本附 `ttml_text` 全文，lrc/enhanced 版本附结构化行（行表查询）。`comment` 署名字段升级为**按版本**：用户版本 `本歌词来自于:贡献者名@lrcshare.com`（沿用现有链路，贡献者取 `lyric_versions.contributor_id`）；ttml-hub 版本取 TTML `<metadata>` 贡献者，无则 `来自 TTML Hub`。歌对象顶层 `comment` 保留 = 主版本署名（兼容旧客户端）。
2. **`lrc_text` 投影**：始终等于主版本合成 LRC，旧消费者零感知。
3. **搜索**：ttml-hub 建的歌进正常索引；歌词内容搜索对 TTML 版本按需解析为纯文本行参与 `search_text`（不含对唱/样式信息，只有文本）。⚠️ 拆行/编辑路径的 trigger 覆盖清单需补 `lyric_versions` 插入/更新路径。
4. **缓存**：详情 1h / 列表 10min 照旧；同步发生实际变更时，Cron 主动 purge 受影响 song 的详情缓存 + 首页/最新列表缓存。
5. **RPC 纪律**：所有新 RPC 显式列名、禁 `SELECT *`；songs 加列后补 `null::` 占位（3.2）。CORS/`{code,data}` 结构照旧。

---

## 七、前端变更

1. **播放页版本选择器**：有多个版本时显示紧凑下拉（如 `逐字(TTML) · 逐字 · 行级`），默认主版本（`is_primary`，规则：优先 TTML > 逐字 > 行级？——**待确认 D2**）。
2. **TTML 渲染升级（本项目的价值核心）**：现有 `parseTtmlToRows` 只读行/词时间（薄投影），需扩展渲染层支持：
   - `ttm:agent`（对唱声部）：同歌多人演唱时按 agent 分左右列显示（AMLL 风格），单人则正常居中；
   - 行位置/对齐属性：左右偏移按属性渲染，无属性时沿用现有布局；
   - 行内样式（颜色/加粗等）：按属性渲染，无属性时沿用默认样式;
   - **渐进增强策略**：解析不到 agent/位置/样式的 TTML 自动回退现有渲染，保证老 TTML 与简单 TTML 不受影响。
3. **投稿表单**：歌词输入框自动识别格式（`<tt` 头 = TTML，含 `<mm:ss.xx>` 词标签 = 逐字，其余 = 行级），TTML 提供源码预览；投稿说明补充"支持 TTML（可含对唱/分屏/样式）"。
4. **复制 LRC**：TTML 版本也可复制——按需降级转换（`lyricLines.ts` 已有 TTML→行→LRC 能力，对唱/样式信息降级时丢弃），不落库。
5. **admin 新页：ttml-hub 待匹配队列**（`ttml_hub_pending`）：列表 + 每行三操作（合并到候选歌 / 新建歌 / 忽略），移动端可用（沿用批量审核页的移动端适配模式）。
6. **admin 歌曲编辑 / 投稿审核**：版本列表管理（设主版本 / 删除版本），署名展示；审核页 TTML 版本显示源码预览。
7. **歌词编辑（文本级）**：沿用现有编辑入口——LRC/逐字版文本框编辑，保存后重拆行表（`rebuild_song_lyric_lines` 改造后按 version 重拆）；TTML 版源码文本框编辑，保存即更新 `ttml_text`（XML 合法性前端校验，不合法拒存）。改文字/复制粘贴/修时间轴与现在编辑 LRC 同体验。

---

## 八、分阶段执行计划

| 阶段 | 内容 | 边界 |
|---|---|---|
| **A** | SQL：`songs.source_ids` + `origin` 加列 + SETOF RPC 补占位 + 权限 | 纯加列，零代码影响，先行 |
| **B** | SQL：`lyric_versions` 建表 + 存量迁移（每首有 `lrc_text` 的歌生成 legacy 用户版本，`is_primary=true`，行表数据挂 version）+ `rebuild_song_lyric_lines` 改造 + RLS | 迁移幂等（可回滚重跑）；行表 PK 迁移是本阶段最大风险点，出正式 SQL 前单独核对 `song_lyric_lines` 的全部读写方 |
| **C** | 代码：API 详情/列表输出 `lyric_versions` + `lrc_text` 投影逻辑 + 署名按版本 | B 部署后、C 部署前旧客户端仍读 `lrc_text`（投影保兼容） |
| **D** | 代码：**投稿侧切版本表**（表单格式识别 + 发布写 `lyric_versions` + 审核 TTML 预览）+ submissions 表单字段支持 TTML | 投稿新歌直接带版本；发布写版本表的同时保持旧 `lrc_text` 写入（投影一致性） |
| **E** | 代码+部署：Workers Cron 同步脚本 + `ttml_hub_state`/`ttml_hub_pending` 建表 SQL + wrangler cron 配置 | 同步脚本先用 dry-run 模式跑一轮存量匹配（只产出 pending 清单不写库），人工过目后开写入 |
| **F** | 代码：播放页版本选择器 + **TTML 渲染升级（agent 对唱/分屏/样式）** + admin 待匹配页/版本管理 + 搜索收编 | 完成后本项目收尾 |

每阶段维持既有纪律：SQL 先出 MD 确认 → 执行 → 代码改动 → 部署验证 → 下一阶段。

---

## 九、待确认决策点

| # | 决策 | 结论 |
|---|---|---|
| D1 | 白板歌（ttml-hub 建的歌）无封面 | **已定**：接受白板（封面等用户投稿或管理员后续补齐）|
| D2 | 主版本默认规则 | **已定**：版本选择器为 **tab 页**，tab 顺序即优先级（TTML > 逐字 > 行级），默认选第一个 tab；`is_primary` 仅作管理员强制置顶的可选手段 |
| D3 | 存量回填匹配策略 | **已定**：**全部走人工队列**（含标题+艺术家完全一致的），先跑 dry-run 看匹配量再定后续；我方歌库为下架歌曲，与 ttml-hub 重合度预计不高 |
| D4 | ttml-hub 删除歌本体 | **已定**：硬删、保持同步（那是它的源）；仅删 ttml-hub 来源创建且无用户版本的歌 |
| ~~D5~~ | ~~投稿侧是否纳入本期~~ | **已定（v2）**：纳入。投稿 TTML 与 ttml-hub 同待遇原文落盘，含对唱/分屏/样式；只投 LRC 行为零变化 |
| D5' | TTML 投稿的大小限制 | **默认 500KB**（如无异议按此执行）|

---

## 十、验收清单

- [ ] 同一歌挂 3 版本（TTML / 逐字 / 行级），播放页可切换，各自署名正确
- [ ] 用户投稿 TTML：表单识别格式 → 原文落盘 → 播放页渲染对唱/分屏/样式
- [ ] TTML 渲染渐进增强：无 agent/位置/样式的 TTML 自动回退现有渲染，老数据不受影响
- [ ] 投稿 LRC 的用户路径零变化（表单、审核、发布、展示与现状一致）
- [ ] 后台编辑歌词：LRC 版改文字保存后行表正确重拆；TTML 版源码文本框改文字保存后渲染同步更新
- [ ] 无平台 ID 时 ttml-hub 新歌自动建站并可搜索播放（含 `song_contributors` 歌手）
- [ ] 平台 ID 命中的存量歌自动合并，`source_ids` 回填
- [ ] 多候选歌进入待匹配页，人工三操作闭环
- [ ] ttml-hub 更新某歌词 → 1 小时内我们版本同步更新且缓存已清
- [ ] ttml-hub 删除歌 → 按规则删版本/删歌，用户版本不受影响
- [ ] 旧客户端（只读 `lrc_text`/顶层 `comment`）行为不变
- [ ] 歌词内容搜索含 TTML 版本文本，且隐藏歌不泄漏（沿用 phase3 隐藏规则）
- [ ] anon 对 `ttml_hub_state`/`ttml_hub_pending`/`lyric_versions` 写零授权验证
