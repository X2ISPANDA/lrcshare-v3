# 歌曲与歌词

## 歌曲列表 {#song-list}

```
GET /v1/songs
```

最新收录的歌曲（按收录时间倒序），用于增量同步全站曲目。

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `limit` | `20` | 每页数量，1 ~ 100 |
| `offset` | `0` | 偏移量 |

返回**轻量摘要**（与搜索 `type=song` 同构），适合渲染选择列表：

```json
{
  "code": 200,
  "data": {
    "total": 532,
    "limit": 20,
    "offset": 0,
    "items": [
      {
        "id": "s_purplesoul_013",
        "title": "歌名",
        "artists": [{ "id": "art_xxx", "name": "歌手" }],
        "album": { "id": "alb_xxx", "name": "专辑名", "year": "2024", "cover": "https://...", "artists": [{ "id": "art_a", "name": "歌手A" }] },
        "genres": ["Hip-Hop"]
      }
    ]
  }
}
```

## 歌曲详情 {#song-detail}

```
GET /v1/song/:id
```

用户在列表中确认目标后调用，**一次请求返回全部数据**——元数据、词曲编署名、歌词、来源 comment 全在这里。

```json
{
  "code": 200,
  "data": {
    "id": "s_purplesoul_013",
    "title": "歌名",
    "aliases": ["别名", "英文名"],
    "artists": [{ "id": "art_a", "name": "歌手A" }, { "id": "art_b", "name": "歌手B" }],
    "album": { "id": "alb_xxx", "name": "专辑名", "year": "2024", "cover": "https://...", "artists": [{ "id": "art_a", "name": "歌手A" }] },
    "track": 3,
    "disc": 1,
    "genres": ["Hip-Hop", "Trap"],
    "lyricist": ["词作者A", "词作者B"],
    "composer": ["曲作者"],
    "arranger": ["编曲"],
    "comment": "本歌词来自于:贡献者@lrcshare.com",
    "lrc": "[00:00.00] ...\n[99:99.999]本歌词来自于:贡献者@lrcshare.com"
  }
}
```

字段说明：

| 字段 | 说明 |
| --- | --- |
| `lrc` | 完整时间轴的 LRC 歌词，**末尾自动追加一行来源署名**：`[99:99.999]本歌词来自于:贡献者@lrcshare.com`。时间戳 `99:99.999` 超出任何真实歌曲长度，播放器永不滚动渲染该行（视觉上等同于纯文本尾注），但它是合法 LRC 行，可被歌词工具按普通时间轴行解析收录；无 LRC 数据时为 `null` |
| `comment` | 署名字符串（不带时间戳），可直接整串写入音乐文件的 comment 标签；无贡献者时为 `本歌词来自于:lrcshare.com` |
| `lyricist` / `composer` / `arranger` | 作词 / 作曲 / 编曲（名字数组，多人合作多项，写入标签时自行拼接） |
| `genres` | 流派数组（多风格并存，写入标签时自行拼接） |

各字段与 ID3v2 / Vorbis 标签帧的对应关系见[数据对象](/api/objects)。

- `id` 不存在或未发布时返回 `404`
- 写音乐标签建议：`LYRICS` ← `lrc`，`COMMENT` ← `comment`，其余按字段对应

## 多语言歌词 {#multi-lang-lyrics}

歌词以**版本**为单位存储：每个 `(lang, kind)` 组合一个版本——`kind` 为 `original`（原文）/ `translation`（译文）/ `romanization`（罗马音）。默认请求（不带歌词参数）返回合成的 `lrc` 单字段；带参数可按语言圈定版本、选择输出格式，或直接取结构化行。

| 参数 | 说明 |
| --- | --- |
| `lyric_lang` | 原文语言代码。**通常无需传**——缺省自动用 `primary_lang`（原文语言）。仅两种情况需要：官方双语单曲（存在多个原文版本，如日语版 + 英语版）时指定要哪个；语言标注异常时显式覆盖 |
| `lyric_translation_lang` | 译文语言代码，逗号分隔多个（如 `zh,en`），`all` = 全部译文版本。可与 `lyric_lang` 组合，也可单传 |
| `lyric_format` | 歌词格式：`line`（默认，标准 LRC）/ `enhanced`（词级增强 LRC）/ `verbatim`（逐字 LRC）/ `ttml`（TTML XML） |
| `lyric_lines` | `1` = 附带结构化行对象 `lyric_lines`。单传时返回**全部版本**；与语言参数同传时只返回选中版本 |

行为细节：

- **公共行补齐**：译文版本会补齐原文中无对应译文的时间戳行（如语气词、间奏标记）——直接用原文行填充，保证每个译文版本都是完整可独立渲染的歌词
- **显式圈定语义**：带语言参数圈定后匹配不到任何版本时 `lrc` 为 `null`（不回退原始文本，避免拿到意料之外的语言组合）
- `lyrics` 数组：带语言参数时附带，每个选中版本一份 `{lang, kind, format, lrc}`——`lrc` 为该版本的独立完整文本（`line` / `enhanced` 末尾带署名行，`ttml` 为纯 XML 不带）

常用语言代码：`zh` 中文、`zh-Hant` 繁体中文、`yue` 粤语、`ja` 日语、`ko` 韩语、`en` 英语、`ja-Latn` 罗马音；另有 `fr` / `de` / `es` / `ru` / `th` / `bo` / `mn` 等二十余种，以站内投稿语言选项为准。

### 歌词格式 {#lyric-formats}

同一份逐字数据可输出四种格式（`lyric_format` 参数选择）。假设一行歌词「作词：Namewee」开始于 `00:14.690`、词级时间已知：

**`line`（默认）— 标准 LRC**，行级时间戳，词级数据被剥离：

```lrc
[00:14.690]作词：Namewee
```

**`enhanced` — 增强逐字 LRC**，行首行级时间戳 + 行内 `<mm:ss.xxx>` 绝对词时间，行尾附行结束时间（仅逐字行有）：

```lrc
[00:14.690]<00:14.690>作<00:14.810>词<00:15.000>：Namewee<00:16.480>
```

**`verbatim` — 逐字 LRC**，每词前缀 `[mm:ss.xxx]` 绝对时间，无独立行首（首词时间 = 行时间），行尾附末词结束时间：

```lrc
[00:14.690]作[00:14.810]词[00:15.000]：[00:15.200]Namewee[00:16.480]
```

**`ttml` — TTML XML**，`<p>` 为行、`<span>` 为词，`begin` / `end` 为 `HH:MM:SS.mmm`；元数据进 `<head><metadata>`，署名为超界时间 `<p>`（`06:59:19.999`）：

```xml
<tt xmlns="http://www.w3.org/ns/ttml"><head><metadata>[ti:歌名]</metadata></head><body><div><p begin="00:00:14.690" end="00:00:16.480"><span begin="00:00:14.690" end="00:00:14.810">作</span><span begin="00:00:14.810" end="00:00:15.000">词</span></p></div></body></tt>
```

说明：

- 行的 `end` 派生规则：`end_ms`（逐字行末词结束）> 下一行 `begin`；词的 `end` = 下一词 `begin`，末词兜底行 `end`
- **降级**：无词级时间的数据请求 `enhanced` / `verbatim` 时输出与 `line` 同形（行级时间戳 + 纯文本）
- `ttml` 为纯 XML，不带 LRC 式署名尾行（署名在 TTML `<p>` 内）；其余格式末尾带 `[99:99.999]` 署名行

### lyric_lines 结构化行 {#lyric-lines}

`lyric_lines=1` 时返回，适合自绘歌词 UI——毫秒时间戳直接可用，无需解析 LRC 文本：

```json
{
  "lyric_lines": {
    "primary_lang": "ja",
    "versions": [
      {
        "lang": "ja",
        "kind": "original",
        "rows": [
          { "seq": 7, "time_ms": 14690, "end_ms": null, "text": "Ohayo Tokyo Konichiwa" },
          { "seq": 8, "time_ms": 1610, "end_ms": 2480, "text": "<0>作<120>词<240>：Namewee" }
        ]
      },
      { "lang": "zh", "kind": "translation", "rows": [ /* ... */ ] }
    ]
  }
}
```

- `rows[]` 按 `seq` 升序（全歌顺序，元数据行在最前）
- `time_ms` 为行开始毫秒；`end_ms` 仅逐字行有值（末词结束时间），行级为 `null`
- `text` 中的 `<毫秒>` 为**相对行首的词偏移**（逐字数据）；无词级数据时为纯文本
- `time_ms` 为 `null` 的行是元数据行（`[ti:...]` 等），`text` 为完整原始行

## 示例

```bash
curl "https://api.lrcshare.com/v1/songs?limit=10&offset=20"
curl "https://api.lrcshare.com/v1/song/s_purplesoul_013"

# 原文日语 + 中文译文，标准 LRC
curl "https://api.lrcshare.com/v1/song/s_purplesoul_013?lyric_lang=ja&lyric_translation_lang=zh"

# 全部版本结构化行（自绘歌词 UI）
curl "https://api.lrcshare.com/v1/song/s_purplesoul_013?lyric_lines=1"

# 原文 + 全部译文，逐字格式
curl "https://api.lrcshare.com/v1/song/s_purplesoul_013?lyric_format=verbatim&lyric_translation_lang=all"
```
