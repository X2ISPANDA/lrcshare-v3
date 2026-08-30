# Phase5 阶段 D 验证清单（含 TTML 测试样例）

> 前置：B 阶段 SQL 已执行、C 阶段代码已写入但需部署。
> 按顺序执行，每步有明确预期结果；任何一步不符合预期先停下排查。

## 步骤 0：C 阶段部署验证（open-api）

```bash
wrangler deploy
```

部署后逐条验证（替换 `<id>`）：

```bash
# 0.1 详情正常 + lyric_versions 数组存在（当前每歌单元素 source=user）
curl "https://api.lrcshare.com/v1/song/<任一歌曲id>"

# 0.2 结构化行与改造前一致
curl "https://api.lrcshare.com/v1/song/<任一歌曲id>?lyric_lines=1"

# 0.3 多语言歌带语言参数合成正常
curl "https://api.lrcshare.com/v1/song/<日语歌id>?lyric_lang=ja&lyric_translation_lang=zh"
```

**预期**：三条都正常返回；0.1 响应含 `lyric_versions: [ { id, format: "lrc"|"enhanced", source: "user", langs, is_primary: true, comment: "本歌词来自于:..." } ]`；`comment` 值与改造前一致。

## TTML 测试样例

把下面内容保存为 `test-duet.ttml`（或直接全选复制）。特点：双人对唱（`ttm:agent` v1/v2 → 播放器左右分屏）、背景和声（`x-bg`）、翻译行（`x-translation`）、词级时间戳、样式定义。

```xml
<tt xmlns="http://www.w3.org/ns/ttml"
    xmlns:ttm="http://www.w3.org/ns/ttml#metadata"
    xmlns:tts="http://www.w3.org/ns/ttml#styling"
    xmlns:amll="http://www.example.com/amll"
    xmlns:itunes="http://music.apple.com/lyric-ttml-internal">
  <head>
    <metadata>
      <amll:meta key="musicName" value="验证用对唱测试曲"/>
      <amll:meta key="artists" value="测试歌手A / 测试歌手B"/>
      <ttm:agent type="person" xml:id="v1"/>
      <ttm:agent type="person" xml:id="v2"/>
    </metadata>
    <styling>
      <style xml:id="s1" tts:color="#FFFFFF"/>
      <style xml:id="s2" tts:color="#FF7BAC"/>
    </styling>
  </head>
  <body dur="00:00:30.000">
    <div begin="00:00:01.000" end="00:00:30.000">
      <p begin="00:00:01.000" end="00:00:05.500" ttm:agent="v1" style="s1">
        <span begin="00:00:01.000" end="00:00:03.200">这是甲唱的第一句</span>
        <span ttm:role="x-translation" xml:lang="zh-CN">这是甲唱的第一句（翻译占位）</span>
      </p>
      <p begin="00:00:06.000" end="00:00:10.800" ttm:agent="v2" style="s2">
        <span begin="00:00:06.000" end="00:00:08.400">这是乙唱的第二句</span>
        <span begin="00:00:08.400" end="00:00:10.800" ttm:role="x-bg">（和声部分）</span>
      </p>
      <p begin="00:00:11.500" end="00:00:16.000" ttm:agent="v1">
        <span begin="00:00:11.500" end="00:00:13.000">甲</span>
        <span begin="00:00:13.000" end="00:00:14.200">乙</span>
        <span begin="00:00:14.200" end="00:00:16.000">合</span>
      </p>
      <p begin="00:00:17.000" end="00:00:22.500" ttm:agent="v2">
        <span begin="00:00:17.000" end="00:00:22.500">对唱验证最后一行</span>
      </p>
    </div>
  </body>
</tt>
```

## 步骤 1：LRC 投稿回归（零破坏）

1. 打开投稿页，用普通 LRC 提交一首测试歌（歌名带"回归"字样方便识别）。
2. 管理后台审核 → 发布。
3. `curl "https://api.lrcshare.com/v1/song/<新歌id>"`。

**预期**：`lyric_versions` 单元素、`source: "user"`、`comment` = 贡献者署名；前台播放页歌词正常。

## 步骤 2：TTML 投稿全链路

1. 投稿页粘贴上面样例 → 表单应自动识别为 TTML（不弹"多语言版本"编辑器）。
2. 提交 → 管理后台待审列表找到该投稿 → 打开审核弹窗。

**预期**：歌词预览标题为"歌词预览（降级 LRC）"，出现"查看 TTML 源码"切换按钮；点击可看到 XML 原文；预览区下方有"投稿为 TTML（含对唱/分屏/样式）"说明。

3. 点击"查看 TTML 源码"确认后切回，点通过发布。
4. SQL 验证：

```sql
-- 版本表应有 2 行：legacy（lrc/enhanced, is_primary）+ ttml
SELECT id, format, source, is_primary, langs, status, contributor_id
FROM public.lyric_versions
WHERE song_id = '<新歌id>' ORDER BY created_at;

-- ttml_text 完整落盘（长度 > 0 且含 ttm:agent）
SELECT length(ttml_text), ttml_text LIKE '%ttm:agent%' AS has_agent
FROM public.lyric_versions
WHERE song_id = '<新歌id>' AND format = 'ttml';
```

5. API 验证：

```bash
curl "https://api.lrcshare.com/v1/song/<新歌id>"
```

**预期**：`lyric_versions` 2 个版本，**TTML 版排第一**（format 优先级），`comment` 与 legacy 版相同（同为该贡献者）；TTML 版含完整 `ttml_text`（带 `lyric_lines=1` 参数时）。

## 步骤 3：歌词编辑回归（saveLyricLines 版本级改造）

1. 管理后台歌曲编辑，打开步骤 1 的"回归"测试歌，微调一句歌词保存。
2. 刷新前台播放页。

**预期**：保存无报错；前台歌词显示修改后的内容；SQL 确认行数没变、仍归属 legacy 版本：

```sql
SELECT version_id, count(*) FROM public.song_lyric_lines
WHERE song_id = '<回归测试歌id>' GROUP BY version_id;
-- 预期：单行结果，version_id = legacy 版本 id，行数与改前一致
```

## 步骤 4：撤回级联回收

1. 对步骤 2 的 TTML 投稿执行"撤回"（级联删除发布产物）。
2. SQL 验证：

```sql
-- 歌删除后，两个歌词版本应随外键级联消失
SELECT count(*) FROM public.lyric_versions WHERE song_id = '<TTML测试歌id>';
-- 预期 0
```

**预期**：返回 0；投稿回到待审状态。

## 清理

验证完成后删除测试歌曲与测试投稿（后台删除按钮 / 待审列表批量删除）。
