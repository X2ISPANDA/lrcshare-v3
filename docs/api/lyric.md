# 歌词

## GET /v1/lyric/:id {#get-lyric}

返回歌曲的纯歌词，不带任何歌曲标签字段（无 `title`/`artists`/`album`）。适合已经拿到歌曲信息、只要歌词文本的调用方。

歌词以版本为单位：每个 `(lang, kind)` 组合一个版本——`kind` 为 `original`（原文）/ `translation`（译文）/ `romanization`（罗马音）。

### 参数

| 参数 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `lyric_lang` | 否 | string | 原文语言代码（缺省自动检测，仅双语单曲需显式指定） |
| `lyric_translation_lang` | 否 | string | 译文语言代码，逗号分隔多个，`all` = 全部译文 |
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

- `lrc` / `enhanced` / `verbatim` 版本附 `lrc` 文本，`ttml` 版本附 `ttml_text` 原文
- `enhanced` / `verbatim` 是从 ttml 降级的导出视图，动态生成、不落库
- `ttml-hub` 版本额外带 `external_id`；各版本 `comment` 独立

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
          "rows": [
            { "seq": 7, "time_ms": 14690, "end_ms": null, "text": "Ohayo Tokyo Konichiwa" },
            { "seq": 8, "time_ms": 1610, "end_ms": 2480, "text": "<0>作<120>词<240>：Namewee" }
          ]
        },
        { "lang": "zh", "kind": "translation", "rows": [] }
      ]
    }
  }
}
```

- `rows[]` 按 `seq` 升序；`time_ms` 为行开始毫秒，`end_ms` 仅逐字行有值
- `text` 中的 `<毫秒>` 为相对行首的词偏移；`time_ms` 为 `null` 的行是元数据行（`[ti:...]` 等）

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

**`ttml` — TTML XML**，`<p>` 为行、`<span>` 为词：

```xml
<tt xmlns="http://www.w3.org/ns/ttml"><body><div><p begin="00:00:14.690" end="00:00:16.480"><span begin="00:00:14.690" end="00:00:14.810">作</span><span begin="00:00:14.810" end="00:00:15.000">词</span></p></div></body></tt>
```

- **降级**：无词级时间的数据请求 `enhanced` / `verbatim` 时输出与 `line` 同形；请求 `ttml` 返回 `null`（逐行数据无资格升级）
- 除 `ttml`（纯 XML）外，其余格式末尾带 `[99:99.999]` 署名行

## 语言代码 {#lang-codes}

`lyric_lang` / `lyric_translation_lang` 取值：

| 代码 | 语言 | | 代码 | 语言 | | 代码 | 语言 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `zh` | 中文 | | `ru` | 俄语 | | `hi` | 印地语 |
| `zh-Hant` | 繁体中文 | | `th` | 泰语 | | `he` | 希伯来语 |
| `yue` | 粤语 | | `ar` | 阿拉伯语 | | `el` | 希腊语 |
| `ja` | 日语 | | `bo` | 藏语 | | `my` | 缅甸语 |
| `ko` | 韩语 | | `mn` | 蒙语 | | `km` | 高棉语 |
| `en` | 英语 | | `tr` | 土耳其语 | | `lo` | 老挝语 |
| `fr` | 法语 | | `nl` | 荷兰语 | | `en-US` | 英语（美） |
| `de` | 德语 | | `pl` | 波兰语 | | `und` | 未标注 |
| `es` | 西班牙语 | | `id` | 印尼语 | | | |
| `it` | 意大利语 | | `ms` | 马来语 | | | |
| `pt` | 葡萄牙语 | | `vi` | 越南语 | | | |

**罗马音不是独立语言代码**：版本角色由 `kind` 区分（`romanization`），`lang` 填源语言——日语罗马音 = `lang: ja` + `kind: romanization`。
