# 阶段四：多语言多类型歌词（行表统一存储，TTML 逻辑输出）— v2 优化版

> 来源：v1 讨论稿经架构评审（7 类 30+ 问题）后整体重写。
> 状态：**方案定稿讨论稿，待确认**。确认后出正式迁移 SQL / 分阶段代码计划。
> 前置：phase3 已收尾（song_secrets、搜索 6f、B 段删旧列）。
>
> **v1→v2 主要修正**（详见文末附录）：结构化输出 schema 定死、romanization 可达、词标签时间基准统一为相对偏移、元数据行位置钉死头部、语言判定保守化（拉丁不再硬判 en）、lrc_text 语义划清适用范围、迁移幂等与预检补全、SQL 约束补齐、署名行兼容、验收具体化。

---

## 一、目标与核心决策

1. **翻译歌词**：一首歌支持多语言版本，原文/译文/罗马音各自独立存储、独立输出。
2. **多类型**：逐行（line）/ 逐字（enhanced，行内词级标签）/ TTML 三种格式。
3. **核心决策（多轮讨论收敛，v2 冻结）**：
   - **存储统一为行表**，line 与 enhanced 不区分列——`text` 含 `<偏移毫秒>` 词级标签即逐字，不含即逐行。
   - **词级标签时间基准统一为「相对行首偏移（毫秒整数）」**：上传时无论 LRC enhanced（绝对时间）还是 TTML（绝对时间）都转成「绝对 − 行首」的偏移再存；输出 enhanced/TTML 时再「行时间 + 偏移」还原绝对时间。**存储只有一种基准，消除混存歧义。**
   - **TTML 不落盘**：上传时解析成行表、输出时从行表生成，纯逻辑转换。
   - **拆是必须的**：原文/译文/罗马音行分离（各自 seq、各自 time_ms），API 给结构化行，下游自由组合任意形态。
   - **译文/罗马音不与原文行对齐**：各自有自己的行序列和时间戳（允许跳过、允许时间偏移），不存在孤儿行问题。
   - **对齐是下游的事，不是存储/结构化输出的事**：行表与 `lyric_lines` 永远返回原始行；混排/排序只发生在 `lyric_format` 的 LRC 文本合成路径（第七节）。

---

## 二、数据模型

```sql
CREATE TABLE public.song_lyric_lines (
  song_id    text NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,
  lang       text NOT NULL CHECK (lang <> ''),   -- BCP47，规范化见下
  kind       text NOT NULL CHECK (kind IN ('original','translation','romanization')),
  seq        integer NOT NULL CHECK (seq >= 1),  -- 该 (lang,kind) 内连续行号，从 1 起
  time_ms    integer CHECK (time_ms IS NULL OR time_ms >= 0),  -- 行级时间戳（毫秒）；NULL=无时间戳元数据行（ti/ar/al/by）
  text       text NOT NULL DEFAULT '',            -- 行文本；逐字版含 <偏移毫秒> 词级标签（相对行首）
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (song_id, lang, kind, seq)
);

-- 存疑清单：迁移/解析判不出的行（3.1 / 3.3 / 6.4「写存疑清单」的落点），P2 存疑页人工处理
CREATE TABLE public.song_lyric_doubts (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  song_id    text NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,
  line_no    integer,                 -- 原 lrc_text 行号（定位用）
  raw_text   text NOT NULL,           -- 原文
  reason     text NOT NULL CHECK (reason IN ('multi_same_ts','bare_line','word_tag_ambiguous')),
  resolved   boolean NOT NULL DEFAULT false,  -- 处理标记：P2 存疑页标「已处理」
  created_at timestamptz NOT NULL DEFAULT now()
);
```

**约束与规范（v2 补齐）**：

1. **lang 规范化（应用层，SQL 不做复杂正则）**：语言码小写（`zh/ja/ko/en`）、script 首字母大写（`Latn/Hant/Hans`）、region 全大写（`CN/TW`）——即存储 `ja-Latn`、`zh-Hant`、`en-US`。写入前一律按此归一，防止 `ja-latn` 与 `ja-Latn` 分裂成两个版本。
2. **kind 枚举**：`original | translation | romanization`，CHECK 强制，杜绝拼写错误脏数据。
3. **seq 从 1 起连续**：每个 `(lang,kind)` 内独立计数。分配顺序：无时间戳元数据行按 key 序（`ti,ar,al,by`）排最前，其后有时间戳行按 `time_ms` 升序。多时间戳展开（`[t1][t2]`）按**源文件标签出现顺序**连续分配（乱序 `[t2][t1]` 也按出现顺序，不按 time_ms 重排）；最终输出顺序由第七节按 time_ms 稳定排序决定，seq 仅作同戳 tie-break。
4. **不加 `UNIQUE(song_id,lang,kind,time_ms,text)`**：会误伤「多时间戳展开产生同 text 同 time_ms」「同戳双行同文本」等合法形态。防重复由迁移脚本幂等（先 DELETE 再 INSERT）保证，不靠约束。
5. **time_ms 是毫秒整数，存储全程无精度损失**：三位小数（如 `00:10.005` = 10005ms）原样可存；输出格式化到 `mm:ss.xxx`（三位毫秒，不舍入，见第四节）。
6. **RLS 沿用 phase2 模式**：先 `REVOKE` 默认授权，再 `GRANT SELECT` 给 anon（只读）；后台写入走 service role（与现有 songs 一致）。

**与现有字段的关系**：

- `songs.lrc_text`（LRC 时间轴歌词）：保留为兼容字段。迁移时**只读不改**；仅 P2 后台主动保存歌词时重合成写回（见第七节、第八节）。
- `songs.lyrics_text`（Markdown 文本歌词）：**本阶段完全不碰**——它与 LRC 时间轴是两套独立能力，翻译歌词/LRC 不进 `lyrics_text` 搜索。翻译歌词的检索召回不在 phase4 范围（附录记录为后续可选）。
- **主语言不新增字段**：`primary_lang` 由行表推导——original 版本中行数最多的 lang（正常一首歌只有一个 original lang，迁移误判才可能多个）。写进 API 响应 `primary_lang`，不落 songs 表，保持 songs 零改动。

---

## 三、上传解析（三种输入 → 行表）

### 3.1 line / enhanced（同一套 LRC 解析器）

| 行形态 | 处理 |
|---|---|
| `[ti:]/[ar:]/[al:]/[by:]` 无时间戳元数据 | `time_ms=NULL` 存行，seq 按 key 序排最前；合成时输出头部（第七节） |
| `[mm:ss.xx]text` | 一行（time_ms, text）；text 内 `<..>` 标签按下方规则转相对偏移（enhanced） |
| `[t1][t2]text` 多时间戳 | 展开：每个时间戳一行（text 重复），seq 按标签出现顺序连续分配（乱序也按出现顺序） |
| 同时间戳双行（字符集/语言不同） | 第一行→original（lang 见 3.3），第二行→按 3.3 判定进 translation/romanization |
| 同时间戳双行（判定不出） | **两行都进 original（不丢数据）** + 写存疑清单人工 |
| 无时间戳裸行（非已知元数据 key） | **进存疑清单，不静默丢弃**；纯空白行跳过 |
| 行内混排（`[t] 中文 English`） | **不拆**，当单行原文存（存量已确认无此形态） |
| `[mm:ss.xx]`（空文本） | **保留**：time_ms 有值、text=''——空文本时间戳是「间奏清屏点」，播放器滚到此应清空歌词显示，剔除会丢语义 |

**词级标签（`<..>`）的解析与转义（v2 钉死，分「输入态 / 存储态」两态）**：

**输入态（解析上传的 LRC enhanced）**：
- 识别 `<mm:ss.xx>` **时间形态标签**（含冒号点，**绝对时间**）→ 转「绝对时间 − 行首时间 = 偏移毫秒」入库。TTML 走 3.2（span 的 begin）。
- 字面量 `<mm:ss.xx>`（歌词文本真含这种时间形态）会被输入态误当标签——比 `<123>` 更隐蔽，遇此**并入存疑清单**人工确认。

**存储态（数据库 text 字段内）**：
- 标签格式统一为 `<偏移毫秒>`（纯数字），例如行 `[00:12.00]世界<120>が<400>終わる`（「世界」偏移 0ms、「が」120ms、「終わる」400ms）。
- 判定 enhanced vs line：`text ~ '<\d{1,6}>'` 即逐字，否则逐行——**该 regex 只适用于存储态**，不用于输入态解析。
- 存储态字面量 `<123>` 会被误当标签——概率极低，遇此进存疑清单人工确认。

### 3.2 ttml（XML 解析 → 行表）

```
<p begin="HH:MM:SS.mmm" end="..."> → 行（time_ms = begin）
<span begin="..." end="...">词</span> → 词级标签（词绝对时间 − 行 begin = 偏移毫秒）
```

- **时间格式仅支持 clock-time `HH:MM:SS.mmm`**；遇 smpte 帧 / offset 单位（`1.5s`、`12f`、带 frameRate）→ 该行进存疑清单，不硬解析。
- **original 轨道判定**：上传者指定 xml:lang 谁是原文；未指定 → 第一个轨道（首个 `<div>`/`<p>` 组）为 original，其余按 `xml:lang` 进 translation/romanization。
- `xml:lang` 缺失时按 3.3 语言判定。

### 3.3 语言判定（v4：歌级 primary_lang + 位置结构整体判断，非行级）

**核心原则（整体判断，不逐行猜）**：一首歌一个 `primary_lang`；多行同戳时**先统计「位置结构」**（每个位置的语言众数），再按位置分配，**不靠逐行 detect**——detect 会被中日同形汉字误导（如纯汉字日语「川崎 任天堂」判成 zh），但位置众数不受个别行影响。

**primary_lang 确定**：统计整首时间戳行的 detect（假名→`ja`、谚文→`ko`、汉字→`zh`、纯拉丁→`en`），多数者 = primary_lang。

**单行（非同戳）**：全部归 `original(primary_lang)`——中文歌里歌手自己唱的英文句（如 `in3 forever`）属原文，不单独判 en。

**同戳双行**：
- 两行 detect 都明确（非 latin/unknown）且不同 → 第一行 original、第二行 translation（如日文+中文双语对照）。
- 其余（latin/unknown/相同）→ **都归 `original(primary_lang)`，不拆、不 und、不存疑**（中文歌里偶尔英文句、个别单词带的中文翻译，都属原文）。

**同戳三行（三语言对照，如 Tokyo Bon 英文+中文+日语）**：
- 先统计三行组的位置众数（位置1/2/3 各是什么语言，`latin→en`）。
- 位置结构明确（位置1=primary_lang 且三位置互异）→ 位置1→original、位置2/3→translation，**按位置分配，忽略个别行的 detect 误判**（第三行写纯汉字也判日语）。
- 位置结构不明确 → 归 original + 存疑 `multi_same_ts`。

- 繁体细分：仅用常见繁体特征字启发式判 `zh-Hant`，判不出统一 `zh`，误判进存疑。

---

## 四、输出生成（行表 → 三种格式 / 结构化行，纯逻辑不落盘）

| 请求格式 | 生成规则 |
|---|---|
| `line` | 行表剥 `<偏移毫秒>` 词标签，只留词文本 → `[mm:ss.xxx]text` |
| `enhanced` | 行表词标签「偏移 + 行时间 = 绝对时间」→ `[mm:ss.xxx]<mm:ss.xxx绝对>词...`（标准 enhanced LRC 词标签是**绝对时间**） |
| `ttml` | 行 → `<p begin=行时间 end=下一行begin><span begin=行时间+偏移 end=下一span begin>词</span></p>`（end 派生见下） |

- **时间格式化**：`mm:ss.xxx`（三位毫秒，1ms 精度，与歌词滚动姬一致），**不舍入**。`time_ms` 是整数毫秒，存储与输出全程无精度损失。示例：10005ms → `00:10.005`。
- **TTML end 派生**：`<p>` 的 `end` = 下一行 `begin`（末行 = 末词偏移 + 固定兜底时长，如 +3000ms）；`<span>` 的 `end` = 下一个 span 的 `begin`（行内末词 = 本行 end）。end 缺失则 XML 时间范围不闭合，P2 验收「能过解析器」会卡。
- **enhanced 降级**：请求 `enhanced` 但该版本无词标签 → 输出等同于 line（不报错）。
- **line 对 enhanced 数据**：请求 `line` 但行表有词标签 → 剥标签输出（已定义）。

**结构化输出 schema（v2 定死，替代 v1 的 keyed-by-kind）**：

```
GET /v1/song/:id?lyric_lines=1
→ data.lyric_lines = {
     primary_lang: "ja",
     versions: [
       { lang: "ja",      kind: "original",     rows: [{seq, time_ms, text}, ...] },
       { lang: "zh",      kind: "translation",  rows: [...] },
       { lang: "ja-Latn", kind: "romanization", rows: [...] }
     ]
   }
```

- **versions 数组**：一个 `(lang, kind)` = 一个 version，天然支持多语言、不撞 key、含 romanization。
- **rows 是纯行**（seq / time_ms / text），**不做任何对齐/混排**——对齐是下游的事。
- `lyric_lines=1` 不带其他参数 → 返回全部 versions；带 `lyric_lang`/`lyric_translation_lang` → 只返回被选中的 versions。
- **`lyric_lines` 优先于 `lyric_format`**：两者同时给，返回结构化行，忽略 `lyric_format`（不生成 LRC/TTML 文本）。

**三个歌词输出字段的职责与触发（v2 钉死，消除 v1「谁先谁后」歧义）**：

| 字段 | 类型 | 内容 | 触发条件 |
|---|---|---|---|
| `lrc` | string | 合成混排 LRC 文本 + 署名（或存量 lrc_text + 署名） | **永远返回** |
| `lyrics` | array | 每个选中版本一份**独立完整 LRC 文本** `{lang, kind, format, lrc}`（不混排，带署名） | 带 `lyric_lang` 或 `lyric_translation_lang` 任一 |
| `lyric_lines` | object | `versions[]` 结构化行（纯行，不对齐） | `lyric_lines=1` |

- `lrc`：默认 = 存量 lrc_text + 署名（现状零改动）；带 `lyric_lang`/`lyric_translation_lang` = 按第七节合成混排 + 署名。
- `lyrics`：带 lyric 语言参数时返回，每个选中版本一份独立文本，供调用端自己挑（如单独把英文译文写进标签）；**不带任何 lyric 参数不返回**（保持存量响应字段集不变）。
- `lyrics[].format`：`lyrics[].lrc` 文本的**实际格式**，等于 `lyric_format` 参数值（默认 `line`），值域 `line | enhanced | ttml`——调用端据此解析该文本。若需探知版本**固有粒度**（数据本身是逐行还是逐字）：请求 `lyric_format=enhanced`，返回文本无词标签即固有 `line`。
- `lyrics[].lrc`：该版本独立完整 LRC 文本，**带署名行**（与 `lrc` 一致，可直接写标签）。
- `lyric_format` 同时作用于 `lrc` 与 `lyrics[].lrc` 的文本格式。
- `lyric_lines=1` 时：`lyric_lines` 返回；`lrc` 仍返回（默认存量或按参数合成）；`lyrics` 数组仍按「是否带 lang 参数」决定是否返回——三字段独立触发，互不挤占。

---

## 五、API 契约（向后兼容）

```
GET /v1/song/:id                                    → lrc = 存量 lrc_text + 署名行（现状零改动）
GET /v1/song/:id?lyric_lang=ja                      → 主语言（缺省 = primary_lang，即 original 主语言）
    &lyric_translation_lang=zh,en                   → 非原文版本语言（逗号分隔；缺省=无；`all`=全部非原文版本）
    &lyric_format=line|enhanced|ttml                → 合成文本格式（默认 line）
    &lyric_lines=1                                  → 结构化行（versions 数组）
```

**参数语义（v2 钉死）**：

1. **`lyric_lang`**：选 original 主语言。缺省 = 行表推导的 `primary_lang`。匹配不到任何 original 行时**回退到 primary_lang 的 original**（保证主语言总有内容）。
2. **`lyric_translation_lang`**：选**所有非 original 版本**（`kind ∈ {translation, romanization}`）中 lang 命中的版本。**罗马音通过其 lang（如 `ja-Latn`）自然被选中**，无需额外参数。`all` = 全部非 original 版本。极端情况：同一 lang 同时存在 translation 与 romanization（罕见）会一并选中——接受，文档记录。
3. **缺省语义**：带任何 lyric 参数 = **显式圈定**——只给主语言，非原文版本须显式请求；不带任何参数 = 存量 lrc_text + 署名行原样（向后兼容零改动）。
4. **`lyric_format`**：只作用于文本合成路径（`lrc` 与 `lyrics[].lrc` 的格式）；`lyric_lines=1` 时被忽略。
5. **请求 lang 不存在**：该版本返回空（跳过），不报错；所有选中版本都空 → 返回空 `lrc` / 空 `versions`（不 404，歌存在）。
6. **署名行兼容**：带参数合成输出时，末尾同样追加 `[419:19.999]本歌词来自于:xxx@lrcshare.com`（与现有 open-api.js 一致），保证两条路径署名行为一致。
7. **is_hidden 门控**：`lyric_*` 新参数路径与存量 `lrc` 字段走**同一处理**——API 对 `is_hidden` 不过滤、全量开放（门控仅在前台，见 open-api.js 注释「网站隐藏逻辑仅作用于前台，API 全量开放」），**不新增任何门控逻辑**。

**组合示例**：

```
lyric_lang=ja&lyric_translation_lang=zh        → 日文原文 + 中文译文
lyric_lang=ja&lyric_translation_lang=zh,ja-Latn → 日文原文 + 中文译文 + 罗马音
lyric_lang=ja&lyric_translation_lang=all       → 日文原文 + 全部译文 + 全部罗马音（「有多少展示多少」）
lyric_lang=ja                                  → 只日文原文
（不带任何参数）                                 → 存量 lrc_text + 署名（现状）
```

**响应结构（带语言参数时）**：

```
GET /v1/song/:id?lyric_lang=ja&lyric_translation_lang=zh
→ data = {
     lrc: "[00:12.00]世界が終わる\n[00:12.00]世界终结\n[419:19.999]本歌词来自于:xxx@lrcshare.com",
     lyrics: [
       { lang: "ja", kind: "original",    format: "line", lrc: "[00:12.00]世界が終わる\n[419:19.999]本歌词来自于:xxx@lrcshare.com" },
       { lang: "zh", kind: "translation", format: "line", lrc: "[00:12.00]世界终结\n[419:19.999]本歌词来自于:xxx@lrcshare.com" }
     ]
   }
```

- `lrc` = 混排成一份（日文原文 + 中文译文按时间穿插）；`lyrics` = 每版本独立一份（各带署名，可直接写标签）。
- 不带任何 lyric 参数 → 只返回 `lrc`（存量 + 署名），**不出现 `lyrics` 字段**，存量调用端响应零改动。

**实现前提（v2 标注）**：现有 `handleSong(env, id)` 只收 id（open-api.js L503），需改签名传入 `url` 解析上述参数。新参数名 `lyric_*` 与现有 search 的 `type=lyric` 不冲突，已核对。

---

## 六、存量迁移（一次性，幂等可重复跑）

1. **迁移前预检（只读，两项都要查）**：
   - ① 同时间戳 **>2 行** 的歌数（三行同戳，原文+2 译文会撞版本）——大概率 0。
   - ② 同时间戳 **=2 行且两行字符集/语言判定相同或判不出** 的歌数——**这是存疑主力**（会「两行都进 original」），先看规模再决定迁移节奏。
2. **迁移幂等**：按 song 分批执行，每首 `DELETE FROM song_lyric_lines WHERE song_id = X` 后再 INSERT。单曲脚本可重复跑不产生重复、不报主键冲突。
3. **解析入库**：逐行解析 `songs.lrc_text`，按 3.1 规则拆入行表（元数据→time_ms=NULL 存行 / 单行→original / 同戳双行语言不同→original+translation / 同字符集→全进 original / 多时间戳展开 / 词标签转相对偏移）。**不写回 lrc_text。**
4. **判不出/存疑**：写存疑清单（song_id + 行号 + 原文 + 判定原因）。
5. **校验（合成回读比对，先规范化双侧）**：
   - ① 原文侧先做「多时间戳展开 + 时间统一到输出精度 `mm:ss.xxx`（三位毫秒，不舍入）」——与合成输出同一精度。
   - ② 统一用 **line 格式**比对（两侧都剥词标签），逐行比：时间戳按数值、文本逐字符。
   - ③ 无时间戳元数据行**参与内容比对**（`[ti:]` 写错要能发现），仅不参与「行数」比对（合成可能去重）。元数据行先按 key 排序归一后比。
   - ④ 词标签偏移精度另行**小样本抽查**（主比对用 line 规避偏移偏差）。
   - ⑤ **合成侧先剥署名行再比对**：第七节合成步骤 5 末尾追加署名 `[419:19.999]本歌词来自于:...`，而 lrc_text 原文无此行——比对前按前缀 `^\[419:19\.999\]本歌词来自于:` 剥掉合成侧署名（两种形态通吃：`...来自于:名字@lrcshare.com` 与无贡献者回退 `...来自于:lrcshare.com`），否则每首都「不一致」。

---

## 七、组合合成规则（仅 `lyric_format` 文本路径；`lyric_lines` 不适用）

> 行表是权威，合成输出是派生。原则：**有多少展示多少**；调用端用参数选子集。

**合成步骤（v2 简化为统一流程，消除 v1 规则 1/2 的分叉）**：

1. **选版本**：original(`lyric_lang`) + 命中 `lyric_translation_lang` 的非 original 版本。

   > **翻译版本补齐公共行**：每个非 original 版本（translation / romanization）输出时，补齐 original 中「该版本没有对应」的公共行——即 original 里 `time_ms` 不在该版本 `time_ms` 集合中的行（`Hello`、`Jah Rastafari`、前奏创作者信息等「不需要翻译」的行）。补齐行文本原样、按各自 `time_ms` 排序，作为该版本的一部分输出，保证**只取某个翻译版本也完整不缺行**。
2. **元数据行（time_ms=NULL）→ 固定头部**：各选中版本的无时间戳元数据行，按 key 序 `ti → ar → al → by → 其他` 输出；**同 key 去重**（优先级 original > translation > romanization）。**永不追加到末尾**（v1 规则 3 作废）。
3. **有时间戳行 → 合并后稳定排序**：全部选中版本的有时间戳行按 `time_ms` 升序；同 time_ms 时 tie-break：`kind` 优先级 original > translation > romanization，再同 kind 按 lang 字典序，再按 seq。**「同戳并列多行」与「未配对插入」都是这条稳定排序的自然结果，无需区分。**

   > **补齐语义**：原文与翻译行数不对应（原文 50 行、翻译 45 行）时，原文多出的行（前奏创作者信息 `lyrics by`/`beats by`/`LRC:`、间奏空行、独白等）在合并输出中**照常输出**（按各自 `time_ms` 排序），不因翻译缺行而丢弃。「有多少展示多少」天然保证补齐——**注记就是歌词，不标记、不归元数据，保留其时间戳与前奏展示**。
4. **每行格式化**：`[mm:ss.xxx]text`（enhanced 还原绝对时间标签，line 剥标签）。
5. **署名行追加末尾**：`[419:19.999]本歌词来自于:xxx@lrcshare.com`。

**lrc_text 写回语义（v2 划清适用范围，消除「原样保留 vs 重合成覆盖」矛盾）**：

- 存量迁移：**只读不改** lrc_text。
- P2 后台**主动保存**某歌歌词时：按上述步骤重合成后**写回 lrc_text**（默认 = 原文 + 全部译文/罗马音，即「有多少展示多少」的后台端行为）。此后「不带参数」的 API 返回的就是这次合成的结果——这是预期行为，不再声称「原样」。
- 明确：**迁移不碰 lrc_text；只有 P2 编辑保存才写**。

---

## 八、后台 / 投稿端改动（分阶段）

| 环节 | 内容 | 阶段 |
|---|---|---|
| DB + 迁移 + 校验 + API | 建表、存量拆行、`lyric_lines` 结构化输出 + line/enhanced 生成、存疑清单**查询接口（RPC/视图）** | **P1** |
| TTML 转换器 + 后台版本管理 + 存疑页 | ttml 解析/生成器；歌曲编辑弹窗歌词 tab 改「版本管理」（每 lang/kind 一个文本域 + 格式选择，贴 LRC 自动解析入库，保存时重合成写回 lrc_text）；存疑清单**页面**（人工改 kind/lang/归位） | **P2** |
| 投稿端 + 插件 | 投稿表单多格式上传（line/enhanced/ttml 三选一 + 语言选择）；Lyrico 插件 structured 的 original/translated/romanization 接真数据（当前恒 null） | **P3** |

> 存疑数据在 P1 迁移产生，故 P1 先给**查询接口**（能看能导出），P2 再做**处理页面**，消除「数据有了、工具没有」的窗口期。

---

## 九、分阶段验收（v2 具体化）

| 阶段 | 验收点（可操作） |
|---|---|
| P1 | ① 迁移预检两项分布已记录；② **重复跑迁移不产生重复/不报主键冲突**（抽 5 首跑两次对比行数）；③ 存量迁移后合成回读一致（第六节 5，line 格式比对，抽 50 首 + 全量计数）；④ `lyric_lines` 返回 versions 数组、含 romanization；⑤ `lyric_format=line/enhanced` 输出正确（enhanced 词标签为绝对时间）；⑥ **不带参数响应与现状逐字节一致**（抽 20 首 diff）；⑦ 存疑清单查询接口返回迁移产生的全部存疑项 |
| P2 | ① 上传 ttml → 行表；`lyric_format=ttml` 生成合法 XML（能过解析器）；② 后台给某歌加 en 译本（贴 LRC 自动解析）→ 保存后 lrc_text 按第七节重合成，元数据行在头部、署名在末尾、无重复 `[ti:]`；③ 存疑页可改 kind/lang 并落库；④ 罗马音版本 `lyric_translation_lang=ja-Latn` 能取到 |
| P3 | ① 投稿多格式上传入库；② 插件 structured 三字段（original/translated/romanization）非空且 time_ms 对齐正确 |

---

## 十、风险与边界

1. **行内混排不拆**：存量已确认无此形态；未来出现当单行原文存（不猜）。
2. **译文/罗马音行不对齐**：孤儿行、时间偏移天然支持——seq/time_ms 各自独立。
3. **多时间戳行展开**：text 重复存，行数按时间戳个数计，校验按第六节 5 规范化。
4. **时间精度**：`time_ms` 毫秒存储**全程无损失**；输出 `mm:ss.xxx`（三位毫秒，不舍入），与歌词滚动姬一致。
5. **拉丁系译文/罗马音盲区**：纯拉丁第二行一律进存疑，不硬判 en（3.3）。
6. **同字符集双行**：两行都进 original，不丢数据（3.1）。
7. **参数组合**：`lyric_lines` 优先于 `lyric_format`（第四节）。
8. **lrc_text 写回**：仅 P2 编辑保存触发重合成写回；迁移不碰。
9. **RLS/权限**：沿用 phase2 模式（先 REVOKE 默认授权再最小权限重授；anon 只读）。
10. **TTML 特性取舍**：行表只映射 p/span 的时间与文本，样式/角色/声道不保留——个人库场景可接受；非 clock-time 时间格式进存疑。
11. **词标签转义边界**：文本字面量 `<数字>` 被当标签的极端情况进存疑。
12. **`lyrics_text` 与翻译歌词检索**：本阶段不处理（范围外，附录记录）。
13. **「原文在前」假设无兜底**（记录级已知限制，不修）：同戳双行默认第一行是原文（3.1）；若存量某歌译文写在前，`primary_lang` 会判反且无自动检测——纯惯例假设，存疑清单覆盖不到，接受。
14. **元数据同 key 跨版本去重的比对歧义**（记录级已知限制，不修）：original 与 translation 各存一个 `[ti:]` 时，合成只输出一个（第七节步骤 2 去重），回读内容比对「按哪个比」未明说——极罕见，届时人工看。

---

## 十一、待确认点

- [x] 元数据/说明行：无特殊机制，各版本独立存取（已确认 2026-08-28）
- [x] `lyric_lines` 语义：不指定 lang/kind 就给全部 versions（已确认 2026-08-28）
- [x] 第七节合成：默认原文+全部非原文版本（有多少展示多少），调用端用 `lyric_translation_lang` 选子集（已确认 2026-08-28）
- [ ] 分期 P1/P2/P3 先做哪层（用户：不急）
- [x] v2 新增决策全部已确认（2026-08-29）：词标签统一相对偏移、元数据行固定头部、拉丁行进存疑不硬判 en、迁移幂等=先 DELETE 再 INSERT、**保留 `lyrics` 数组并钉死三字段职责**、romanization 经 `lyric_translation_lang` 选中

---

## 附录：v1 → v2 修正对照

| 类别 | v1 问题 | v2 修正 |
|---|---|---|
| 前后矛盾 | 结构化输出 L77 `{original:[]}` 与 L100 `lyrics` 数组两套结构、keyed-by-kind 装不下多语言 | 结构化统一 `lyric_lines.versions[]`；`lyrics` 数组**保留并钉死职责**（lrc=混排一份 / lyrics=每版本独立 / lyric_lines=结构化行，三字段独立触发） |
| 前后矛盾 | 元数据行「追加末尾」vs「头部不补 [ti:]」 | 元数据行固定头部、key 序去重 |
| 前后矛盾 | 「纯拉丁→en」与盲区自否 | 分场景判定：original 纯拉丁→en，第二行纯拉丁→存疑 |
| 前后矛盾 | 词标签时间基准（模型注释 vs 3.1 vs 3.2）三处不一 | 统一相对偏移，上传转偏移、输出转绝对 |
| 前后矛盾 | lrc_text「原样保留」vs「重合成覆盖」 | 划清：迁移不改，仅 P2 保存写 |
| 前后矛盾 | 「对齐是下游的事」vs 第七节做了对齐 | 对齐只限 `lyric_format` 文本路径 |
| 参数歧义 | romanization 无参数可达 | `lyric_translation_lang` 匹配所有非 original 版本（含 romanization） |
| 参数歧义 | primary_lang 无权威来源 | 行表推导，不新增字段 |
| 参数歧义 | 请求 lang 不存在行为 | 该版本空、主语言回退、不 404 |
| 参数歧义 | enhanced 无标签降级未定义 | 降级为 line |
| 迁移漏洞 | 幂等未定义 | 先 DELETE 再 INSERT，单曲可重复 |
| 迁移漏洞 | 预检只查 >2 行 | 补「=2 行且判不出」分布 |
| 迁移漏洞 | 裸行静默跳过 | 进存疑，纯空白才跳过 |
| 迁移漏洞 | 校验不比元数据内容 | 元数据参与内容比对、仅不参与行数 |
| 迁移漏洞 | 存疑 P1 产生 P2 才可处理 | P1 给查询接口，P2 给页面 |
| 边界遗漏 | `<` 字面量转义 | 仅 `<纯数字>` 为标签，其余字面量 |
| 边界遗漏 | 繁简译文 | `zh-Hant` 启发式细分 |
| 边界遗漏 | TTML 时间格式/多轨道 original | 仅 clock-time；未指定取第一轨道 |
| 边界遗漏 | enhanced 输出绝对时间 | 偏移+行时间还原绝对 |
| 边界遗漏 | 署名行 `[419:19.999]` | 合成路径同样追加，与现状一致 |
| 边界遗漏 | `lyrics_text` 字段 | 明确范围外，记录 |
| 验收缺失 | 「一致」无验证方法 | 具体化到抽样数、diff、行数对比 |
| SQL 约束 | 无 CHECK/无规范化/无时间戳 | 补 CHECK(kind)、CHECK(seq)、CHECK(time_ms)、规范化规则、时间戳列；并说明为何不加 UNIQUE |
