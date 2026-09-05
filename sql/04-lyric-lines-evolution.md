# 04 · 歌词行表演进（lrc_text 单字段 → song_lyric_lines 行表）

> 合并自：phase4-lyric-versions.md（方案稿）、phase4-lyric-p1.md（建表迁移）、
> phase4-lyric-nlang.md（同戳 N 行通用化）、phase4-lyric-nlang-v2.md（成对占比判定）
> （全部已执行，2026-08 下旬；完整执行版 SQL 见 git 历史原文件）

## 一句话现状

歌词从「一歌一份 `lrc_text` 文本」拆为行表 `song_lyric_lines`（歌 × 语言 × 类型 × 行号），
原文/译文/罗马音各自独立存储、独立输出；判不出的行进 `song_lyric_doubts` 存疑清单人工处理。
lrc_text 保留为兼容投影。行表后来在 phase5 挂上了版本（见 05）。

## 出发点：lrc_text 单字段的局限

- 一首歌多语言（原文+译文+罗马音）全部塞在一个文本里，下游想单独取罗马音轨只能猜
- 逐字（enhanced）和逐行（line）两种形态混存，无法区分
- 无法按语言独立输出结构化数据（开放 API、播放器都要自己再解析一遍）

## 方案讨论稿：v1 → v2（phase4-lyric-versions.md）

v1 讨论稿经架构评审（7 类 30+ 问题）整体重写为 v2。核心决策（v2 冻结）：

| 决策 | 内容 |
|---|---|
| 存储统一为行表 | line 与 enhanced 不分列——`text` 含 `<偏移毫秒>` 词级标签即逐字，不含即逐行 |
| 词标签时间基准统一「相对行首偏移」 | 上传时无论 LRC enhanced（绝对时间）还是 TTML（绝对时间）都转「绝对 − 行首」偏移再存，输出时还原。**存储只有一种基准** |
| TTML 不落盘（后被 phase5 推翻） | 上传时解析成行表、输出时生成，纯逻辑转换 |
| 拆是必须的 | 原文/译文/罗马音行分离，各自 seq、各自 time_ms，允许跳过、允许时间偏移 |
| 对齐是下游的事 | 行表永远返回原始行；混排/排序只发生在 LRC 文本合成路径 |
| lang 规范化 | 语言码小写、script 首字母大写、region 全大写（`zh-Hant`、`ja-Latn`） |

## 执行：建表 + 存量迁移（phase4-lyric-p1）

全部增量操作（两张新表 + 函数 + 触发器，不碰 songs 结构），回滚 = DROP 新对象。

### 表结构（现行，DDL 备查）

```sql
CREATE TABLE public.song_lyric_lines (
  song_id    text NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,
  lang       text NOT NULL CHECK (lang <> ''),
  kind       text NOT NULL CHECK (kind IN ('original','translation','romanization')),
  seq        integer NOT NULL CHECK (seq >= 1),   -- (lang,kind) 内连续行号
  time_ms    integer CHECK (time_ms IS NULL OR time_ms >= 0),  -- NULL=元数据行
  end_ms     integer CHECK (end_ms IS NULL OR end_ms >= 0),
  text       text NOT NULL DEFAULT '',  -- 逐字版含 <偏移毫秒> 词级标签（相对行首）
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (song_id, lang, kind, seq)
  -- phase5 B 段后主键迁移为 (version_id, lang, kind, seq)，见 05
);

-- 存疑清单：迁移/解析判不出的行
CREATE TABLE public.song_lyric_doubts (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  song_id    text NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,
  line_no    integer,
  raw_text   text NOT NULL,
  reason     text NOT NULL CHECK (reason IN ('multi_same_ts','bare_line','word_tag_ambiguous')),
  resolved   boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
```

权限：anon 只读行表（SELECT）；存疑表 anon 零策略默认拒绝，仅后台可见。
**新歌拆行闭环用触发器**：`songs.lrc_text` 任何 INSERT/UPDATE 自动重拆，发布链零改动。

### 语言判定（lyric_lang_detect，现行 15 文字系统）

判定顺序：假名 → 谚文 → 泰 → 老挝 → 藏 → 蒙 → 缅甸 → 高棉 → 天城 → 阿拉伯 → 希伯来 →
希腊 → 西里尔 → 汉字 → 拉丁 → 未知。独立文字系统均可自动检测；**拉丁字母语言（法/德/西/越）无法与
英语自动区分**，只能手动选；返回 'latin' 由调用方决定映射（original 单行 → en，同戳第二行 → 不硬判）。

## 拆行判定的三轮迭代（p1 特判 → nlang 通用化 → v2 成对占比）

这是本主题的核心演进——「同戳多行怎么判原文/译文」：

### 第一版（p1）：2 行 / 3 行特判

同戳只写了 2 行、3 行两个特判分支，**>3 行全部判回原文并存疑**。

### 第二版（nlang）：同戳 N 行通用化 + 歌级结构判定

- 同戳 N 行通用：第 1 行 = 原文，第 2~N 行 = 译文，语言按行检测
- 歌级判定翻译歌两条件：① 多行组语言互异占比 ≥50%；② 多行组占全部时间戳组比例 ≥60%
  （同文字系统对译如粤→普、意→英，语言检测分不出，靠「整首歌成对」的结构信号）
- 语言检测扩到 15 文字系统

### 第三版（nlang v2，现行）：成对占比判定 + 创作者信息按行序拆

第二版的两个占比条件反复踩坑：

| 踩坑 | 原因 |
|---|---|
| 粤语/普通话、法语/英语互译误判非翻译歌 | 同文字系统，语言检测分不出，条件①失效 |
| 长间奏（`:-)` 单行）稀释占比 → 误判非翻译歌 | 间奏单行组进了条件②分母 |
| 角色标注行（`Yamy：`/`合：`）被当成多行组 → 误存疑 | |
| 译文的创作者信息（`Lyrics By:AAA`）恒归原文 | 丢失翻译语义 |

第三版改**「先剔除非歌词行，再只看歌词成对占比」**：

1. 三类非歌词行剔除：空行（清屏点）、纯符号行（间奏）、创作者信息行
   （新增 `lyric_is_credit`：前缀+冒号正则识别 作词/作曲/Lyrics By/Mixed/Mastering 等）
2. 真歌词行上「同戳 ≥2 行」的组占比 ≥50% → 翻译歌
3. 拆分：空行/符号恒归原文；非翻译歌全归原文**不再存疑**；翻译歌按行序拆
   （第 1 行原文、其余译文），**创作者信息也按行序走**——译文的 `Lyrics By` 跟译文版本

## 踩过的坑

| 坑 | 教训 |
|---|---|
| 特判分支（2行/3行）覆盖不了真实世界 | N 行通用化 + 歌级结构信号 |
| 语言检测分不出同文字系统对译 | 结构信号（成对占比）比语言信号可靠 |
| 间奏/标注行稀释判定统计 | 先剔除非歌词行再看占比 |
| `updated_at` 触发器没建时沦为装饰列（永远等于 created_at） | 建表时同步建 BEFORE UPDATE 触发器 |

## 执行记录

| 步 | 结果 | 备注 |
|---|---|---|
| p1 建表 + 迁移 + 校验 | ✅ | 存量 lrc_text 全量拆行；判不出的进存疑清单 |
| nlang 同戳 N 行通用化 | ✅ | 与前端 lyricLines.ts 同步改 |
| nlang v2 成对占比判定 | ✅ | 一个事务直接执行；第三次迭代定稿 |
