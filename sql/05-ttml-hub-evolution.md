# 05 · 多版本歌词模型 + ttml-hub 接入演进（lyric_versions）

> 合并自：phase5-lyric-versions-ttml-hub.md（总纲）、phase5-stepA-source-ids.md、
> phase5-stepB-lyric-versions.md、phase5-stepB-fix1-langs.md、phase5-stepD-verify.md、
> phase5-stepE-ttml-hub-sync.md、phase5-stepE-cleanup-pending.md、phase5-stepF-verify.md、
> phase5-stepG-strip-ttml-hub-whites.md
> （全部已执行，2026-08；完整执行版 SQL 见 git 历史原文件）

## 一句话现状

歌词从「歌 → 一份文本」升级为「歌 → 多个版本」：`lyric_versions` 每版本独立格式
（lrc / enhanced / ttml）、来源（user / ttml-hub）、贡献者、署名、状态、手动排序；
TTML 原文落盘渲染对唱/分屏/样式，LRC/逐字版拆行表。ttml-hub 每小时 Cron 增量同步，
**全部条目进人工待确认队列**（自动建歌路径已回退，见「G 段大回退」）。

## 出发点

1. 同一首歌不同人会投稿不同「丰富度」的歌词：行级 LRC / 逐字 LRC / TTML。
   TTML 信息量最大（对唱声部、左右显示、行样式），LRC 只是它的降级投影——
   现有「一歌一份 `lrc_text` + 单 `contributor_id`」模型撑不住。
2. ttml-hub 提供「静态发布 + 客户端轮询增量」的接入机制
   （manifest.json 的 revision/ETag → songs.json 索引 → 按需下载 .ttml 附 sha256），
   靠低成本的增量检查制造「实时感」。
3. 期望：库里没有的歌也能展示、已有的歌能合并它的版本、内容跟随它更新/删除。

## 核心模型：歌 → 版本 → 行

```
songs（歌本体：封面、专辑、贡献者、状态、source_ids、origin）
  └── lyric_versions（版本：format / source / contributor / 署名 / status / is_primary / sort_order）
        ├── format=lrc/enhanced → 拆行进 song_lyric_lines（挂 version_id，见 04）
        └── format=ttml         → 原文落盘 ttml_text（不拆行，保留对唱/位置/样式）
```

关键决策（总纲三段讨论收敛）：

| 决策 | 内容 |
|---|---|
| 版本是「投稿/来源」维度的单位 | 一次投稿 = 一个版本；ttml-hub 一份歌词 = 一个版本；版本内多语言沿用 phase4 行表 |
| **推翻 phase4 的「TTML 不落盘」** | 对唱（ttm:agent）/分屏/行样式拆行即丢——这是 TTML 相对 LRC 的核心价值。**任何来源的 TTML 都原文落盘**（用户投稿与 ttml-hub 同待遇）；降级 LRC 仅作「复制 LRC」按需转换，不落库 |
| `songs.lrc_text` 降级为兼容投影 | 始终等于主版本（is_primary 的 lrc/enhanced 版）合成 LRC，旧消费者零感知 |
| 投稿侧同步切版本表 | 表单识别 `<tt` 头自动判定 TTML；只投 LRC 的用户行为零变化 |
| 白板歌（同步建的）无封面 | 接受白板，等投稿或管理员补齐 |

## 分阶段执行（A → G）

| 阶段 | 内容 | 结果 |
|---|---|---|
| A | songs 加 `source_ids`（平台曲目 ID）/`origin`（歌来源标记）两列 | ✅ 纯加列先行 |
| B | `lyric_versions` 建表 + 存量迁移 + 行表挂版本 | ✅ 含 fix1 补丁 |
| C/D | API 输出版本数组 + 投稿侧切版本表（TTML 投稿全链路） | ✅ |
| E | 同步表 + 独立 Worker（Cron 每小时）+ dry-run 首跑 | ✅ 含队列噪音清理 |
| F | 播放页 TTML 渲染（对唱分列/和声/翻译轨）+ admin 待匹配页 | ✅ |
| G | **大回退：剥离自动建的白板歌**，同步改全人工 | ✅ 最终形态 |

### 阶段 A：songs 加列（source_ids / origin）

- `source_ids jsonb` 形如 `{"appleMusicId":["…"],"qqMusicId":["…"],"ncmMusicId":["…"]}`
  （数组语义与 ttml-hub schema v2 对齐），GIN 索引支撑 `@>` 精确匹配。
- `origin text`（'user'/'ttml-hub'）仅用于删除跟随判断，展示层不用。
- **项目纪律坑**：songs 是 `RETURNS SETOF songs` 的输出表，加列后 `search_songs` /
  `search_songs_structured` 必须同步补 `null::jsonb as source_ids, null::text as origin`
  占位，否则「return type mismatch」报错。

### 阶段 B：lyric_versions 建表 + 行表挂版本

表结构（现行，DDL 备查）：

```sql
CREATE TABLE public.lyric_versions (
  id             text PRIMARY KEY,                    -- lv_ 前缀
  song_id        text NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,
  format         text NOT NULL CHECK (format IN ('lrc','enhanced','ttml')),
  source         text NOT NULL DEFAULT 'user' CHECK (source IN ('user','ttml-hub')),
  external_id    text,                                -- ttml-hub 稳定歌词 ID（同步幂等键）
  content_hash   text,                                -- 外部内容 sha256（增量变更检测）
  ttml_text      text,                                -- 仅 ttml；lrc/enhanced 以行表为准
  langs          text[] NOT NULL DEFAULT '{}',       -- 语言摘要（冗余可重建）
  status         text NOT NULL DEFAULT 'published'
                 CHECK (status IN ('pending','published','rejected','withdrawn')),
  is_primary     boolean NOT NULL DEFAULT false,      -- 一歌至多一个主版本（部分唯一索引）
  contributor_id text REFERENCES public.contributors(id) ON DELETE SET NULL,
  source_credit  text,                                -- 外部署名
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (format = 'ttml' OR ttml_text IS NULL),
  CHECK (format <> 'ttml' OR ttml_text IS NOT NULL),
  CHECK (source <> 'ttml-hub' OR external_id IS NOT NULL)
);
CREATE UNIQUE INDEX lyric_versions_song_external_uidx
  ON public.lyric_versions(song_id, external_id) WHERE external_id IS NOT NULL;
CREATE UNIQUE INDEX lyric_versions_song_primary_uidx
  ON public.lyric_versions(song_id) WHERE is_primary;
```

迁移三招（核心设计，保证幂等与零破坏）：

1. **legacy 版本确定性 ID**：`'lv_' + md5('legacy:' || song_id)` 前 12 位——
   存量迁移、INSERT 触发器、rebuild RPC 三处共用，重跑不产生重复版本。
   每首有 `lrc_text` 的歌生成一个 legacy 用户版本（is_primary），format 按
   text 是否含 `<\d{1,6}>` 词标签判 enhanced/lrc。
2. **旧写入路径零破坏**：所有不带 version_id 的行表 INSERT 由触发器
   `trg_sll_default_version` 自动落到该歌的 legacy 版本（没有则现场建）——
   SQL 先行不炸前端，代码改造在 C/D 阶段跟进。
3. **行表主键迁移**：`(song_id,lang,kind,seq)` → `(version_id,lang,kind,seq)`，
   加 version_id FK（版本删则行删）；song_id 列保留并补索引（open-api 读路径）。

**fix1 补丁**（上线后发现）：langs 摘要只在存量迁移时回填过一次，此后
rebuild / saveLyricLines 写入路径都不维护——新发布的歌 langs 恒为空。
修复 = rebuild 函数末尾随行表变化同步刷新 langs + 全表回填一次。

### 阶段 C/D：API 与投稿侧

- 详情接口输出 `lyric_versions` 数组，`comment` 署名按版本（用户版本
  `本歌词来自于:贡献者名@lrcshare.com`，ttml-hub 版本取 TTML metadata 或
  `来自 TTML Hub`）；顶层 `lrc_text`/`comment` 保留，旧客户端零感知。
- 投稿表单自动识别格式（`<tt` 头 = TTML），TTML 与 ttml-hub 同待遇原文落盘；
  审核 TTML 预览为「降级 LRC + 查看源码」切换。

### 阶段 E：ttml-hub 同步（Worker + Cron）

两张表 + 独立 Worker（`cloudflare/ttml-sync/`）：

- `ttml_hub_state`（单行 singleton）：revision / etag / **snapshot jsonb**
  （上次索引快照 `{hubId:{path,sha256}}`，删除跟随的 diff 依据，避免引入 KV）。
- `ttml_hub_pending`（待匹配队列）：同步脚本写、后台人工处理，
  `resolution` ∈ merged/created/ignored，非空即出队（保留记录供审计）。

同步流程：GET manifest（If-None-Match）→ 304 短路零成本 → revision 变化才拉索引
→ 增量下载 .ttml（校验 sha256，失败下轮重试幂等）→ 匹配处理。

**匹配三档置信**（对齐 ttml-hub 官方接入纪律：兜底不取第一候选）：

| 档 | 匹配方式 | 处理 |
|---|---|---|
| 1 | source_ids 平台 ID 交集精确命中 | 自动合并 |
| 2 | 标题+艺术家归一化全等 | 人工队列（存量期不自动合并） |
| 3 | 多候选 / 相似 / Live / Remix / 同名 | 人工队列 |

### 阶段 F：播放页渲染 + admin 待匹配页

- 第三个歌词 tab（仅存在 TTML 版本时出现）：含 `ttm:agent` →「对唱歌词」，
  否则「逐字歌词」；对唱按声部分列（第 1 声部左、第 2 右）、和声 `x-bg` 灰色
  斜体小字、翻译轨随行灰字；URL `?tab=ttml` 可保持。渐进增强：解析不到
  agent/样式自动回退现有渲染。
- admin「TTML Hub 同步管理」页：待确认队列三操作（挂到歌/忽略/挪歌），
  已导入版本管理，移动端可用。

## G 段大回退：自动建歌被推翻（本主题最大教训）

**事故**：正式同步（非 dry-run）按 E 段设计「完全无同名候选才自动建白板歌」
跑了之后，ttml-hub 索引里 **~2686 首歌**被自动建为白板歌（歌+歌手+专辑+关系
全部入库），主站被大量无封面、无 lrc_text 的空壳歌污染，还产生 ~600 个孤立艺术家。

**回退操作**（step G，三步连根拔）：

1. 先部署改造版 Worker（**取消自动建歌/自动合并路径**，否则下一轮同步再建一遍）
2. SQL 全清：删白板歌的歌词版本 → 删白板歌本体（级联关系）→ 清空壳专辑
   （无歌引用的）→ 清孤立艺术家（无任何 song/album 关系的）→ `recompute_artist_types()`
   ——每步都有预览清单过目，确认不含自己手动保留的内容才删
3. 重跑同步 → 索引全部条目重新进入待确认队列，逐条人工处理

**保住的内容**：自己的歌、手动合并/挂到歌的 TTML 版本、自己的艺术家和专辑。

最终形态（现行）：**同步只产 pending，写库全靠人工确认**——「挂到歌」= 合并到
已有歌，「新建展示」= 确认后才建歌，不处理 = 永不出现在主站。

## 中途踩过的坑

| 坑 | 教训 |
|---|---|
| dry-run 首跑把索引全部 2750 条写入 pending；正式同步处理了 2687 条但队列记录没清理，后台待确认显示 2750（真实 63） | 同步脚本补「成功后轮末清理对应记录」；但 manifest 未变时 304 短路，存量噪音只能 SQL 手动清一次 |
| 自动建白板歌污染主站（~2686 首） | 外部数据源自动写库的路径最终被整体放弃——**入库门槛必须是人工确认** |
| langs 摘要只在迁移时回填一次 | 冗余摘要必须挂在每条写入路径的维护点上（rebuild/saveLyricLines） |
| songs 加列炸 SETOF RPC | 加列必同步补 `null::` 占位（项目纪律） |
| 建表自动给 anon 授 ALL（Supabase 默认） | 建表后立即 REVOKE 再按需 GRANT（沿用 phase1 模式） |

## 执行记录

| 步 | 结果 | 备注 |
|---|---|---|
| A songs 加列 + RPC 占位 | ✅ | 搜索行为回归验证通过 |
| B 建表 + 存量迁移 + 行表挂版本 | ✅ | 每首有 lrc_text 的歌恰好一个 legacy 版本 |
| B-fix1 langs 摘要维护 | ✅ | rebuild 内建刷新 + 全表回填 |
| C/D API + 投稿侧 | ✅ | TTML 投稿全链路验证（含撤回级联回收） |
| E 同步表 + Worker | ✅ | dry-run 首跑 → 人工过目 → 切正式 |
| E 补充 pending 噪音清理 | ✅ | 删 2687 条，剩 63 条真实待确认 |
| F 播放页渲染 + admin 页 | ✅ | `npm run build` 通过（SSG 期 DOMParser 有守卫） |
| G 剥离白板歌 + Worker 改全人工 | ✅ | songs/artists/albums 回落原量级，手动合并的版本保留 |
