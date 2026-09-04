# 歌词

## GET /v1/lyric/:id {#get-lyric}

返回歌曲的纯歌词，不带任何歌曲标签字段（无 `title`/`artists`/`album`）。适合已经拿到歌曲信息、只要歌词文本的调用方。

歌词以版本为单位：每个 `(lang, kind)` 组合一个版本——`kind` 为 `original`（原文）/ `translation`（译文）/ `romanization`（罗马音）。

### 参数

| 参数 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `lyric_lang` | 否 | string | 原文语言代码（缺省自动检测，仅双语单曲需显式指定；支持 BCP47 层级匹配，如 `zh-Hant` 命中 `zh-Hant-HK/TW`） |
| `lyric_translation_lang` | 否 | string | 译文/音译语言代码，逗号分隔多个，`all` = 全部；支持 BCP47 层级匹配 |
| `lyric_format` | 否 | string | 输出格式：`line` / `enhanced` / `verbatim` / `ttml` |
| `lyric_lines` | 否 | boolean | `=1` 返回结构化行 |

### 请求

```bash
# 所有版本
curl "https://api.lrcshare.com/v1/lyric/s_masiwei_002"

# 指定格式 TTML
curl "https://api.lrcshare.com/v1/lyric/s_masiwei_002?lyric_format=ttml"

# 结构化行
curl "https://api.lrcshare.com/v1/lyric/s_masiwei_002?lyric_lines=1"
```

### 响应（不带参数）

```json
{
  "code": 200,
  "data": {
    "lyric_versions": [
      {
        "id": "lv_d7cb4765519c",
        "format": "lrc",
        "source": "user",
        "langs": ["zh"],
        "is_primary": true,
        "comment": "本歌词来自于:X2ISPANDA@lrcshare.com",
        "lrc": "[ti:崂山道士]\n[ar:马思唯]\n[00:04.74]要学神仙 驾鹤飞天\n[00:08.43]点石成金 妙不可言\n..."
      },
      {
        "id": "lv_48e91dc9ac7af755",
        "format": "ttml",
        "source": "ttml-hub",
        "langs": ["zh", "en"],
        "is_primary": false,
        "comment": "本歌词来自于:LunaBeat TTML 歌词站@lrcshare.com",
        "external_id": "48e91dc9ac7af755",
        "ttml_text": "<?xml version='1.0'...><tt xmlns=\"http://www.w3.org/ns/ttml\" ...>...</tt>"
      },
      {
        "format": "enhanced",
        "source": "ttml-hub",
        "langs": ["zh"],
        "is_primary": false,
        "comment": "本歌词来自于:LunaBeat TTML 歌词站@lrcshare.com",
        "lrc": "[00:04.598]<00:04.598>要<00:04.847>学<00:05.458>神仙..."
      },
      {
        "format": "verbatim",
        "source": "ttml-hub",
        "langs": ["zh"],
        "is_primary": false,
        "comment": "本歌词来自于:LunaBeat TTML 歌词站@lrcshare.com",
        "lrc": "[00:04.598]要[00:04.847]学[00:05.458]神仙..."
      }
    ]
  }
}
```

- `lrc` / `enhanced` / `verbatim` 版本附 `lrc` 文本（末尾带超界署名行 `[419:19.999]`）；`ttml` 版本附 `ttml_text`——输出时在末尾追加超界署名 `<p>`（`06:59:19.999`，播放器不渲染、工具按字幕行收录），**库内原文不含署名**，agent/样式完整保留
- `enhanced` / `verbatim` 是从 ttml 降级的导出视图，动态生成、不落库
- `ttml-hub` 版本额外带 `external_id`；各版本 `comment` 独立——署名跟随歌词实际来源版本

### 响应（指定 `lyric_format`）

```json
{ "code": 200, "data": { "lrc": "[ti:崂山道士]\n[00:04.74]要学神仙 驾鹤飞天\n..." } }
```

指定 `lyric_format` 后只返回 `lrc` 字段，不带 `lyric_versions`。逐行数据请求 `ttml` 返回 `lrc: null`。

### 响应（`lyric_lines=1`） {#lyric-lines}

```json
{
  "code": 200,
  "data": {
    "lyric_lines": {
      "primary_lang": "ja",
      "versions": [
        {
          "lang": "ja",
          "kind": "original",
          "source": "ttml-hub",
          "comment": "本歌词来自于:LunaBeat TTML 歌词站@lrcshare.com",
          "rows": [
            { "seq": 7, "time_ms": 14690, "end_ms": null, "text": "Ohayo Tokyo Konichiwa" },
            { "seq": 8, "time_ms": 1610, "end_ms": 2480, "text": "<0>作<120>词<240>：Namewee" }
          ]
        },
        { "lang": "zh", "kind": "translation", "source": "user", "comment": "本歌词来自于:贡献者名@lrcshare.com", "rows": [] }
      ]
    }
  }
}
```

- `rows[]` 按 `seq` 升序；`time_ms` 为行开始毫秒，`end_ms` 仅逐字行有值
- `text` 中的 `<毫秒>` 为相对行首的词偏移；`time_ms` 为 `null` 的行是元数据行（`[ti:...]` 等）
- `source` / `comment` 为该版本歌词的**实际来源与署名**：多个歌词版本跨容器合并时按占坑容器计（高质量容器优先）。写入音乐文件的署名应取实际采用版本的 `comment`（多来源去重并列），**不要用歌曲顶层 `comment`**——它只代表默认版本，词级歌词可能来自其他版本（如 LunaBeat TTML）

## 歌词格式 {#lyric-formats}

`lyric_format` 的四种取值，同一份逐字数据的不同输出。假设一行「作词：Namewee」开始于 `00:14.690`、词级时间已知：

**`line`（默认）— 标准 LRC**，行级时间戳，词级数据被剥离：

```lrc
[00:14.690]作词：Namewee
```

**`enhanced` — 增强逐字 LRC**，行首行级时间戳 + 行内 `<mm:ss.xxx>` 绝对词时间：

```lrc
[00:14.690]<00:14.690>作<00:14.810>词<00:15.000>：Namewee<00:16.480>
```

**`verbatim` — 逐字 LRC**，每词前缀 `[mm:ss.xxx]` 绝对时间：

```lrc
[00:14.690]作[00:14.810]词[00:15.000]：[00:15.200]Namewee[00:16.480]
```

**`ttml` — TTML XML（Apple sidecar 结构）**，正文 `<p>` 带 `itunes:key`、`<span>` 为词；译文/音译在 head `iTunesMetadata` 侧车按行 key 配对；根标签带 `xml:lang`（BCP47，简体为 `zh-Hans`）与 `itunes:timing="Word"`：

```xml
<tt xmlns="http://www.w3.org/ns/ttml" xmlns:itunes="http://music.apple.com/lyric-ttml-internal" itunes:timing="Word" xml:lang="zh-Hans"><head><metadata><iTunesMetadata xmlns="http://music.apple.com/lyric-ttml-internal"><translations><translation xml:lang="en"><text for="L1">Lyricist: Namewee</text></translation></translations></iTunesMetadata></metadata></head><body><div><p begin="00:00:14.690" end="00:00:16.480" itunes:key="L1"><span begin="00:00:14.690" end="00:00:14.810">作</span><span begin="00:00:14.810" end="00:00:15.000">词</span></p></div></body></tt>
```

- **降级**：无词级时间的数据请求 `enhanced` / `verbatim` 时输出与 `line` 同形；请求 `ttml` 返回 `null`（逐行数据无资格升级）
- **署名行**：`line` / `enhanced` / `verbatim` 末尾带超界时间 LRC 行 `[419:19.999]本歌词来自于:...`；`ttml` 末尾带超界时间 `<p begin="06:59:19.999">署名</p>`——播放器均不渲染，歌词工具按普通时间轴行/字幕行解析收录
- 歌词内容跨版本合并时（如原文来自 TTML 版本、译文来自另一版本），署名按实际来源版本去重并列（LRC 多行、TTML 多个超界 `<p>`）
- 合成 TTML 可被 AMLL / Apple 生态标准库直接解析出原文、译文（`<translations>`）与音译（`<transliterations>`，语言为 BCP47 拉丁化标签）

## 语言代码 {#lang-codes}

`lyric_lang` / `lyric_translation_lang` 取值：

| 代码 | 语言 | | 代码 | 语言 | | 代码 | 语言 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `zh` | 简体中文 | | `ru` | 俄语 | | `hi` | 印地语 |
| `zh-Hant` | 繁体中文 | | `th` | 泰语 | | `he` | 希伯来语 |
| `zh-Hant-HK` | 繁体中文（香港） | | `ar` | 阿拉伯语 | | `el` | 希腊语 |
| `zh-Hant-TW` | 繁体中文（台湾） | | `bo` | 藏语 | | `my` | 缅甸语 |
| `yue` | 粤语 | | `mn` | 蒙语 | | `km` | 高棉语 |
| `ja` | 日语 | | `tr` | 土耳其语 | | `lo` | 老挝语 |
| `ko` | 韩语 | | `nl` | 荷兰语 | | `en-US` | 英语（美） |
| `en` | 英语 | | `pl` | 波兰语 | | `und` | 未标注 |
| `fr` | 法语 | | `id` | 印尼语 | | | |
| `de` | 德语 | | `ms` | 马来语 | | | |
| `es` | 西班牙语 | | `vi` | 越南语 | | | |
| `it` | 意大利语 | | | | | | |
| `pt` | 葡萄牙语 | | | | | | |

音译（`kind: romanization`）使用 BCP47 拉丁化标准标签（与 Apple Music TTML 标注一致）：

| 代码 | 含义 |
| --- | --- |
| `zh-Latn-jyutping` | 粤拼（粤语罗马音） |
| `ja-Latn` | 日语罗马音 |
| `ko-Latn` | 韩语罗马音 |

**音译版本角色由 `kind` 区分**：`lang` 为上述拉丁化标签（TTML 来源）或源语言码（LRC 音译投稿，如日语罗马音 `lang: ja` + `kind: romanization`）。

**语言码按 BCP47 层级匹配**：传基础码会命中其下细分标签——`lyric_lang=zh-Hant` 命中 `zh-Hant-HK` / `zh-Hant-TW`，`lyric_translation_lang=zh` 命中全部中文子标签（含 `zh-Latn-jyutping` 音译）；精确码优先，原文层级命中只取一个版本（避免港繁/台繁两套原文混排）。
