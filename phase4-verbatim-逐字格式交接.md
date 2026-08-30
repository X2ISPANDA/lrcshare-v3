# 阶段四补：逐字（verbatim）格式支持 — 分步交接文档

> 用途：给任何接手者（含免费 AI）提供**可断点续做**的完整改动清单。
> 背景：Lyrico 有 4 种歌词格式，本仓库 phase4 已支持 3 种——`line`（逐行）、`enhanced`（加强逐字）、`ttml`，
> 唯独 `verbatim`（逐字，纯方括号逐字）没支持，且**当前会被解析坏**（见「现状 bug」）。
> 本文档把支持 verbatim 拆成 **3 步**，每步独立闭环、可验收、可随时停。第 3 步是可选的无损升级。
> 更新时间：2026-08-29（基于 phase4 P1/P2/P3 已完成的现状）。

---

## 零、为什么必须做 Step 1（现状 bug）

verbatim 行的结构是「每词前一个 `[词开始]`，行尾再一个 `[行结束]`」，N 词 = N+1 个时间戳：

```
[00:12.34]我[00:12.78]爱[00:13.20]你[00:13.60]
  词1开始   词2开始   词3开始   行尾(词3结束)
```

现有两个解析器遇到它会出错：

- **前端 `parseLrcToRows`**（`src/lib/lyricLines.ts`）只吃行首连续时间戳，`[00:12.34]` 后面是「我」不是 `[`，正则停止 →
  中间/行尾的 `[00:12.78]`、`[00:13.20]`、`[00:13.60]` 全变成**字面文本**，词级时间全丢。
- **SQL `rebuild_song_lyric_lines`**（`sql/phase4-lyric-p1.md`）用 `regexp_matches(...,'g')` 取到全部 4 个时间戳，
  循环 INSERT 4 行，每行 text 都是剥了行首时间戳的同一段脏文本 → **炸成 4 条重复垃圾行**。

所以 Step 1 是纯 bug 修复，无论后面做不做，都必须做。

---

## 一、verbatim 格式精确定义（勿再读错）

| | 结构 | 词级括号 | 行首标签 | 行尾标签 |
|---|---|---|---|---|
| `line`（逐行） | `[行时间]整行文本` | 无 | `[...]` | 无 |
| `enhanced`（加强逐字） | `[行时间]<词1>词1<词2>词2...<行尾>` | `<...>` | `[...]`（独立于词1） | `<...>`（可选） |
| `verbatim`（逐字） | `[词1]词1[词2]词2...[词N]词N[行尾]` | `[...]` | 无（词1时间即行时间） | `[...]`（最后 1 个） |
| `ttml` | XML `<p>/<span>` | `<span>` | — | — |

**verbatim 三条铁律**（接手者务必记住）：

1. 时间戳数量 = 词数 + 1。前 N 个是**词开始**（第 1 个 = 行开始），最后 1 个是**行尾结束**，后面没有词。
2. **verbatim 没有独立的行首标签**——词 1 的时间戳就是行时间。
3. 识别判据：**行首剥掉连续 `[mm:ss.xx]` 后，剩余文本里仍含 `[mm:ss.xx]`** → verbatim。
   （enhanced 的词标签是 `<...>` 不是 `[...]`；多时间戳 `[t1][t2]text` 剥完行首连续标签后 body 无时间戳——两者都不会误判。）

**存储态**（两种方案统一，不区分 verbatim/enhanced 列）：
```
time_ms = 12340（行开始，整数毫秒）
text    = 我<440>爱<860>你   （<偏移毫秒> = 词开始相对行首的偏移；词1 偏移 0 省略不写）
```

---

## 二、三步总览

| 步 | 目标 | 动哪些文件 | 是否依赖前一步 | 可否停在这 |
|---|---|---|---|---|
| **Step 1** | verbatim 输入识别 + 拆词开始（行尾丢弃） | `src/lib/lyricLines.ts`、`sql/phase4-lyric-p1.md` | 否 | ✅ 是（修完 bug，verbatim 不再解析坏） |
| **Step 2** | verbatim 输出（`lyric_format=verbatim`） | `cloudflare/open-api.js`、`src/lib/lyricLines.ts`、`docs/api/*` | 依赖 Step 1 | ✅ 是（功能闭环，行尾走派生） |
| **Step 3** | 无损升级（加 `end_ms` 列，行尾存真值） | 见下，约 6 个文件 + 迁移 | 依赖 Step 1（Step 2 可并入） | ✅ 是（可选，成本收益比低） |

> **关键认知**：Step 3 的 verbatim 识别解析（= Step 1）完全复用，唯一区别是识别后「行尾丢弃」改成「存 `end_ms`」。
> 所以正确顺序永远是先 Step 1，Step 3 只是在其上增量。

---

## 三、Step 1：verbatim 输入识别（零迁移，纯 bug 修复）

### 3.1 前端 `src/lib/lyricLines.ts` → `parseLrcToRows`（现 L100-138）

**现状**：`tsMatch = line.match(/^((?:\[\d{1,3}:\d{2}[.:]\d{2,3}\])+)(.*)$/)` 后，直接对 `tsText` 里每个时间戳循环
`timed.push({ time_ms, text: convertWordTagsToOffset(body, timeMs) })`。

**改成**：拿到 `body` 后先判 verbatim，是则走 verbatim 分支，否则走原逻辑。伪代码：

```ts
const tsMatch = line.match(/^((?:\[\d{1,3}:\d{2}[.:]\d{2,3}\])+)(.*)$/)
if (tsMatch) {
  const tsText = tsMatch[1]
  const body = tsMatch[2]
  // 判据：body 里仍含方括号时间戳 → verbatim
  if (/\[\d{1,3}:\d{2}[.:]\d{2,3}\]/.test(body)) {
    // verbatim 分支（见下）
    const firstTs = parseTs(tsText.match(/\[(\d{1,3}:\d{2}[.:]\d{2,3})\]/)![1])
    const parts = body.split(/\[(\d{1,3}:\d{2}[.:]\d{2,3})\]/)
    // 例：body = '我[00:12.78]爱[00:13.20]你[00:13.60]'
    // parts = ['我','00:12.78','爱','00:13.20','你','00:13.60','']
    // 偶数索引=词文本，奇数索引=时间戳
    let text = ''
    let offset = 0
    for (let i = 0; i < parts.length; i++) {
      if (i % 2 === 0) {
        if (parts[i]) text += (offset === 0 ? '' : `<${offset}>`) + parts[i]
      } else {
        const isEnd = i + 1 < parts.length && parts[i + 1] === '' // 后面是空串 = 行尾结束
        if (!isEnd) offset = parseTs(parts[i]) - firstTs
        // isEnd → 行尾时间戳：Step 1 丢弃（Step 3 才捕获）
      }
    }
    timed.push({ time_ms: firstTs, text })
  } else {
    // 原有多时间戳展开逻辑不变
    for (const m of tsText.matchAll(/\[(\d{1,3}:\d{2}[.:]\d{2,3})\]/g)) {
      const timeMs = parseTs(m[1])
      timed.push({ time_ms: timeMs, text: convertWordTagsToOffset(body, timeMs) })
    }
  }
}
```

**验收**：`parseLrcToRows('[00:12.34]我[00:12.78]爱[00:13.20]你[00:13.60]')` 应返回
`[{time_ms:12340, text:'我<440>爱<860>你'}]`（单行、词开始全保留、行尾 13600 丢弃）。

### 3.2 SQL `sql/phase4-lyric-p1.md` → `rebuild_song_lyric_lines` 第一遍（现 L198-223）

**现状**：`IF v_line ~ '^\[\d{1,3}:\d{2}[.:]\d{2,3}\]' THEN` 后，
`v_text := regexp_replace(v_line, '^(\[...\])+', '')`，再 `FOR ... regexp_matches(v_line, '\[...\]','g')` 每个时间戳 INSERT 一行。

**改成**：剥完行首连续标签后，判 `v_text` 是否仍含方括号时间戳；是则走 verbatim 分支，只 INSERT **1 行**。

plpgsql 伪代码（要点，接手者按此写循环）：

```sql
-- 剥行首连续时间戳后
v_text := regexp_replace(v_line, '^(\[\d{1,3}:\d{2}[.:]\d{2,3}\])+', '');

-- verbatim 判据：v_text 仍含 [mm:ss.xx]
IF v_text ~ '\[\d{1,3}:\d{2}[.:]\d{2,3}\]' THEN
  -- 行时间 = 原行第一个时间戳（regexp_match 取 v_line 首个 [t]）
  -- 把 v_text 按 [mm:ss.xx] 分割，逐个：
  --   词文本 → 拼接，非首个词前补 '<' || 偏移 || '>'（偏移 = 该词时间戳 − 行时间）
  --   时间戳后紧跟空串 → 行尾，丢弃（Step 1）
  -- INSERT 单行 (line_no, time_ms=行时间, text=带偏移词标签)
ELSE
  -- 原有多时间戳循环逻辑不变
END IF;
```

**关键点**：Step 1 的 SQL 端只加一个分支，**不新增任何列**，`_parsed` 表结构不动。
verbatim 转出的 `text` 与 enhanced 存储态完全一致（`<偏移>` 纯数字），后续语言判定/同戳拆分/seq 分配全部复用现有逻辑，零影响。

**验收**：对一首含 verbatim 行的 `lrc_text` 调 `rebuild_song_lyric_lines(id)`，
行表该行应为 1 条 `time_ms=行首、text='词<偏移>词...'`，且守恒校验（步骤 6 时间戳数 vs 行数）仍为 0 差异。

### 3.3 Step 1 测试 SQL（Supabase SQL Editor 全选执行）

```sql
BEGIN;

-- 1. 插入测试歌（trg_song_lyric_rebuild 触发器在 INSERT 后自动重拆）
INSERT INTO public.songs (
  id, title, status, lrc_text, is_hidden, duration, track, genres
) VALUES (
  'test-verbatim-001',
  '【verbatim解析测试】',
  'published',
  E'[00:12.34]我[00:12.78]爱[00:13.20]你[00:13.60]\n[00:15.00]世界[00:15.30]和平[00:15.60]\n[00:18.00]你好\n[00:20.00][00:22.00]副歌',
  true, '', null, '{}'
);

-- 2. 查行表结果
SELECT seq, time_ms, text, lang, kind
FROM public.song_lyric_lines
WHERE song_id = 'test-verbatim-001'
ORDER BY seq;

-- 3. 查存疑（应无记录）
SELECT reason, raw_text FROM public.song_lyric_doubts WHERE song_id = 'test-verbatim-001';

-- 4. 清理（行表/存疑有 ON DELETE CASCADE，删歌即级联；此处显式删更稳妥）
DELETE FROM public.song_lyric_lines WHERE song_id = 'test-verbatim-001';
DELETE FROM public.song_lyric_doubts WHERE song_id = 'test-verbatim-001';
DELETE FROM public.songs WHERE id = 'test-verbatim-001';

COMMIT;
```

**预期行表 5 行**（全部 `lang=zh, kind=original`）：

| seq | time_ms | text | 验证点 |
|---|---|---|---|
| 1 | 12340 | `我<440>爱<860>你` | verbatim 3 词：行首 12340=行时间，中间 12780→440、13200→860，行尾 13600 丢弃 ✅ |
| 2 | 15000 | `世界<300>和平` | verbatim 2 词：行尾 15600 丢弃 ✅ |
| 3 | 18000 | `你好` | line 不受影响 ✅ |
| 4 | 20000 | `副歌` | 多时间戳展开 ✅ |
| 5 | 22000 | `副歌` | 多时间戳展开 ✅ |

> 若 INSERT 报 `genres` 类型错（jsonb 而非 text[]），把 `'{}'` 改成 `'[]'`；报其他列 NOT NULL 按报错补列即可。

---

## 四、Step 2：verbatim 输出（功能闭环，行尾派生）

### 4.1 Worker `cloudflare/open-api.js` → `composeLrc`（现 L614-637）+ 新增 `composeVerbatimText`

**现状**：`composeLrc` 里 `format === 'enhanced' ? composeEnhancedText(...) : stripWordTags(...)`，
外层统一 `[${formatLyricTime(time_ms)}]${text}`。

**改成**：`verbatim` 不能复用外层 `[行时间]` 模板（那会多出重复标签，verbatim 无独立行首），要单独处理：

```js
function composeVerbatimText(text, timeMs) {
  const s = String(text || '')
  if (!/<\d{1,6}>/.test(s)) {
    // 无词标签 → 降级 line（单词 verbatim 与 line 同形）
    return `[${formatLyricTime(timeMs)}]${s}`
  }
  const words = parseWordTags(s) // 已有函数（现 L654-668），返回 [{text, offset_ms}]
  return words.map(w => `[${formatLyricTime(timeMs + w.offset_ms)}]${w.text}`).join('')
}
```

`composeLrc` 的 body 段改成：

```js
const body = lines.map(l => {
  if (format === 'verbatim') return composeVerbatimText(l.text, l.time_ms)
  const text = format === 'enhanced' ? composeEnhancedText(l.text, l.time_ms) : stripWordTags(l.text)
  return `[${formatLyricTime(l.time_ms)}]${text}`
}).join('\n')
```

**为什么 verbatim 不能带外层 `[行时间]`**：enhanced 是 `[行时间]<词1>词1...`（行首独立），
verbatim 是 `[词1]词1...`（词1 时间 = 行时间，无独立行首）。混用会产生 `[行时间][词1]词1` 重复标签。

**行尾派生（Step 2 不存真值）**：verbatim 输出**不带行尾** `[结束]`。
Lyrico 解析时末词 end 会兜底 `+500ms`（`LrcDocumentFormat.kt` parseLrc 的 `wordStart + 500`），
与现有 enhanced 输出行为一致（enhanced 也不带行尾）。Step 3 加了 `end_ms` 后再补真行尾。

### 4.2 参数值域 `lyric_format`

- `open-api.js` 头部注释 + `apiIndex()` 若列了枚举，加 `verbatim`。
- `lyric_format` 合法值变为 `line | enhanced | verbatim | ttml`（默认仍 `line`）。
- 若 `docs/api/song.md` 有 `lyric_format` 表，补 `verbatim` 一行。

### 4.3 前端输出（一致性，非阻塞但建议做）

`src/lib/lyricLines.ts` 的 `rowsToLrcText`（现 L141-155）和 `composeMixedLrc`（现 L179-199）
同样加 `verbatim` 分支（复制 `composeVerbatimText` 到前端，或抽公共函数），
让前端版本管理/写回 `lrc_text` 也能出 verbatim。`format` 参数类型 `'line' | 'enhanced'` 扩成含 `'verbatim'`。

### 4.4 验收（Step 2）

- `GET /v1/song/:id?lyric_lang=ja&lyric_format=verbatim` 对含词标签的歌返回
  `[00:12.340]我[00:12.780]爱[00:13.200]你`（方括号、绝对时间、无行尾、无重复行首标签）。
- 无词标签的行降级 `[time]text`（等同 line）。
- `lyric_format=enhanced` / `line` / `ttml` 行为与改动前**逐字节一致**（回归）。

---

## 五、Step 3：无损升级（加 `end_ms` 列，行尾存真值）—— 可选

> 收益仅「每行最后一个词的结束时间精确」；主信号（词点亮时刻）Step 1/2 已零偏差。
> 成本：加一列 + 约 6 个文件透传 + 回归。**是否做由余额决定，可跳过。**

### 5.1 DB 迁移（新 SQL，追加到 `sql/phase4-lyric-p1.md` 或新文件）

```sql
ALTER TABLE public.song_lyric_lines
  ADD COLUMN end_ms integer CHECK (end_ms IS NULL OR end_ms >= 0);
COMMENT ON COLUMN public.song_lyric_lines.end_ms IS '行结束时间（毫秒）；仅逐字行的末词结束，逐行 NULL';
```

- **存量无需回填**：库里只有逐行 LRC，逐行行 `end_ms` 天然 NULL（结束 = 下一行 begin，LRC 隐式语义）。
- 只有 Step 3 上线后**新上传的逐字**才写 `end_ms`。

### 5.2 SQL `rebuild_song_lyric_lines`

Step 1 的 verbatim 分支里，把「行尾时间戳」从「丢弃」改为「写入 `_parsed` 的新列 + 最终 INSERT 的 `end_ms`」。
即 `_parsed` 加一列 `end_ms int`，verbatim 行尾时间戳 `t(N+1)` 填进去，普通行 NULL。

### 5.3 前端 `src/lib/lyricLines.ts` 全链路透传

1. `LyricRow` 接口（现 L13-17）加 `end_ms: number | null`。
2. `parseLrcToRows` verbatim 分支：行尾时间戳写入 `end_ms`（而非丢弃）。
3. `saveLyricLines`（现 L449）INSERT 加 `end_ms`；`loadLyricLines`（现 L438）select 加 `end_ms`。

### 5.4 Worker `cloudflare/open-api.js` 全链路透传

1. `getLyricVersions`（现 L506）select 加 `end_ms`。
2. `groupVersions`（现 L515）rows push 加 `end_ms`。
3. `selectVersions` / `fillCommonRows` 透传 `end_ms`（fill 补齐的公共行 `end_ms` 取 original 对应行的值）。
4. 输出用真值：
   - `composeVerbatimText(text, timeMs, endMs)`：`endMs != null` 时行尾补 `[${formatLyricTime(endMs)}]`。
   - `composeEnhancedText` 同样可补行尾 `<${formatLyricTime(endMs)}>`（enhanced 与 verbatim 行为对齐）。
   - `composeTtml`（现 L671）：`<p>` 的 `end` 改用 `line.end_ms ?? (下一行 begin 或 +3000)`；
     行内末 span 的 `end` 改用 `end_ms ?? pEnd`。

### 5.5 结构化 `lyric_lines` schema（已决定：自然透传）

`lyric_lines=1` 的 `versions[].rows[]` **自然带 `end_ms`**（`groupVersions` 的 rows 已含 `end_ms`，`handleSong` 里 `rows: v.rows` 直接透传，不额外剥离）。
加字段是向后兼容的（JSON 消费者忽略未知字段），Lyrico 插件读 `seq/time_ms/text`，多出的 `end_ms` 无害。

### 5.6 验收（Step 3）

- 新上传 verbatim `[00:12.34]我[00:12.78]爱[00:13.20]你[00:13.60]` →
  行表 `time_ms=12340, text='我<440>爱<860>你', end_ms=13600`。
- `lyric_format=verbatim` 输出 `[00:12.340]我[00:12.780]爱[00:13.200]你[00:13.600]`（行尾真值还原）。
- 逐行行 `end_ms=NULL`，`line`/`enhanced`/`ttml` 输出与 Step 2 逐字节一致（回归）。

### 5.7 Step 3 测试 SQL（先执行 ALTER + 重跑 rebuild 函数，再跑本脚本）

```sql
BEGIN;

INSERT INTO public.songs (id, title, status, lrc_text, is_hidden, duration, track, genres)
VALUES ('test-verbatim-002', '【verbatim end_ms测试】', 'published',
  E'[00:12.34]我[00:12.78]爱[00:13.20]你[00:13.60]\n[00:15.00]世界[00:15.30]和平[00:15.60]\n[00:18.00]你好',
  true, '', null, '{}');

SELECT seq, time_ms, end_ms, text, lang, kind
FROM public.song_lyric_lines
WHERE song_id = 'test-verbatim-002'
ORDER BY seq;

DELETE FROM public.song_lyric_lines WHERE song_id = 'test-verbatim-002';
DELETE FROM public.song_lyric_doubts WHERE song_id = 'test-verbatim-002';
DELETE FROM public.songs WHERE id = 'test-verbatim-002';

COMMIT;
```

**预期行表 3 行**（`lang=zh, kind=original`）：

| seq | time_ms | end_ms | text | 验证点 |
|---|---|---|---|---|
| 1 | 12340 | 13600 | `我<440>爱<860>你` | verbatim 3 词，行尾 13600 **存进 end_ms** ✅ |
| 2 | 15000 | 15600 | `世界<300>和平` | verbatim 2 词，行尾 15600 **存进 end_ms** ✅ |
| 3 | 18000 | NULL | `你好` | line 行 end_ms 为 NULL ✅ |

---

## 六、全局约束（接手者严禁破坏，全部来自已收敛的 phase4 决策）

1. 存储统一行表，line/enhanced/verbatim 不区分列——`text` 含 `<偏移毫秒>` 即逐字，否则逐行。
2. 词标签存储态 = `<偏移毫秒>`（相对行首，纯数字）；输入态 `<mm:ss.xx>`（绝对）转偏移入库；输出还原绝对。
3. 语言判定 = 歌级 `primary_lang` + 位置结构（整体判断，不逐行 detect）。
4. 元数据行（`[ti:]/[ar:]/[al:]/[by:]`）`time_ms=NULL`，text 存完整原文，合成时输出头部去重。
5. 空文本时间戳行（间奏清屏点）保留，`time_ms` 有值、text=''。
6. 时间戳正则 `[.:]` 同时认 `[mm:ss.xx]` 和 `[mm:ss:xx]`；时间输出 `mm:ss.xxx` 三位毫秒不舍入。
7. 触发器 `trg_song_lyric_rebuild` **仅 AFTER INSERT**（行表权威、lrc_text 派生），勿改回。
8. 不带任何 lyric 参数的 `GET /v1/song/:id` 响应 = 存量 `lrc_text` + 署名，**零改动**（这是最硬的红线）。
9. `rebuild_song_lyric_lines` 幂等（先 DELETE 再 INSERT），改函数后需重新 `CREATE OR REPLACE` + 重跑。
10. verbatim 识别判据：剥行首连续 `[time]` 后 body 仍含 `[mm:ss.xx]`；多时间戳 `[t1][t2]text` 不误判。

---

## 七、总验收清单（每步做完打勾）

### Step 1
- [x] 前端 `parseLrcToRows` 对 verbatim 行返回单行 `{time_ms, text:'词<偏移>...'}`，词开始全保留（7 用例验证通过）
- [x] SQL `rebuild` 对 verbatim 行只 INSERT 1 行（已写入，逻辑手动走查通过，**未在 DB 实测**）
- [x] 多时间戳 `[t1][t2]text`、enhanced `<...>`、line 三种行为与改动前一致（7 用例验证通过）

### Step 2
- [x] `lyric_format=verbatim` 输出方括号绝对时间、无重复行首、无行尾（`composeVerbatimText` 4 用例 + 整段 `composeLrc` 验证通过）
- [x] 无词标签行降级 line（验证通过）
- [x] `line` 输出逐字节回归一致（验证通过）；`enhanced`/`ttml` 走原路径未动，逻辑上不受影响

### Step 3（可选）
- [x] 代码改动完成：`song_lyric_lines` 加 `end_ms` 列 + 前端/Worker 全链路透传 + 输出补行尾（`composeVerbatimText`/`composeEnhancedText` 5 用例验证通过）
- [x] `song_lyric_lines` 有 `end_ms` 列，line 行 `end_ms=NULL`（DB 实测通过）
- [x] 新上传 verbatim 的行表 `end_ms` = 行尾时间（DB 测试 SQL 实测通过：13600/15600 正确入库）
- [x] `lyric_format=verbatim` 输出含真行尾 `[end]`（代码 + 单元测试通过；Worker 部署后 API 实测即可）

---

## 八、断点续做提示（给接手者）

- 当前进度：**Step 1 + Step 2 + Step 3 全部完成**（verbatim 输入识别 + 输出 + end_ms 无损，代码 + SQL 均验证通过）。剩余动作：① Worker 重新部署（Step 3 改了 `open-api.js`）；② 前端 `lyricLines.ts` 改动随下次前端上线一起 rebuild。
- 每步只改文档列出的文件/函数，勿顺手重构无关逻辑。
- 改完一个文件就跑一次 `pnpm run type-check`（前端）确认不引入类型错误。
- Worker 改动需部署到 Cloudflare Worker 才生效；前端改动需 rebuild Web 产物。
- 若余额不足停在 Step 2，verbatim 已「能正确解析 + 能输出」，功能闭环；Step 3 只差末词结束时间的精确性。
