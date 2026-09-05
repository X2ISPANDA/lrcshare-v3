# 06 · 歌词写入事务化与语言治理演进

> 合并自：phase6-lyric-write-rpc.md（B1/B2 事务修复）、phase7-lang-unify.md（语言码统一）、
> phase7-lyric-version-sort.md（版本手动排序）
> （全部已执行，2026-09；完整执行版 SQL 见 git 历史原文件）

## 一句话现状

歌词行表的所有写入走 SECURITY DEFINER RPC（函数体即事务边界，中途失败整体回滚）；
语言码统一为 Apple 标准标签（繁体正文 zh-Hant、音译轨 BCP47 拉丁化方案）；
版本展示顺序由站长手动 `sort_order` 控制。

## 一、写入事务化（phase6）

### 出发点

前端直连 PostgREST **无事务能力**，两处「先删后插」链路在中途失败时留脏数据：

- **B1** `saveLyricLines`（歌词编辑保存）：`DELETE song_lyric_lines WHERE version_id`
  未检查 error，删除失败时 INSERT 照跑 → 新旧行并存；
- **B2** DoubtsView「归位」：DELETE + INSERT + 标记 resolved 三次写库均无事务，
  删成功、插失败 → 行丢失且界面提示「已归位」。

### 方案

写入逻辑下沉为 SECURITY DEFINER RPC——PL/pgSQL 函数体本身就是事务边界，任一步
失败整体回滚；前端各改为一次 `supabase.rpc(...)` 调用。上线顺序：**先执行 SQL
再发布前端**（反了会报「Could not find the function」）。

两个函数（现行，DDL 备查）：

```sql
-- 存疑行归位：锁源行 → 删 → 插目标 (lang,kind) 末尾 → 标记 resolved（单事务）
-- p_mode='relocate'（行已存在，改 lang/kind）/ 'insert'（裸行，用表单时间戳+文本）
CREATE OR REPLACE FUNCTION public.resolve_lyric_doubt(
  p_doubt_id bigint, p_song_id text, p_mode text, p_lang text, p_kind text,
  p_src_lang text DEFAULT NULL, p_src_kind text DEFAULT NULL, p_src_seq integer DEFAULT NULL,
  p_time_ms integer DEFAULT NULL, p_text text DEFAULT NULL
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER ...;
-- 内部：FOR UPDATE 锁源行（并发处理同一行时第二个事务在此等待/报缺行）；
-- 删/插均不带 version_id（trg_sll_default_version 触发器落 legacy 版本，与旧前端同语义）

-- 歌词版本行表全量替换：删旧 → 批量插新 → 刷 langs 摘要（单事务）
CREATE OR REPLACE FUNCTION public.save_lyric_lines(
  p_song_id text, p_version_id text DEFAULT NULL,
  p_rows jsonb DEFAULT '[]', p_langs text[] DEFAULT '{}'
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER ...;
-- 版本解析与前端 resolveDefaultLinesVersionId 同语义：
-- 显式 p_version_id 优先，否则取 format in ('lrc','enhanced') 的主版本（is_primary 优先、最早创建）
```

配套：`song_lyric_doubts` 幂等补齐 `resolved_lang` / `resolved_kind` 两列
（早期建表没有，归位结果记语境）。两函数均 `REVOKE ALL FROM PUBLIC` 后仅
GRANT 给 authenticated。回滚 = DROP 函数 + 前端退旧版（旧代码直连表写入）。

## 二、语言码统一（phase7-lang-unify）

### 出发点

1. **繁体细分标签下游读不到**：AMLL 等播放器对 `xml:lang` 做**精确字符串匹配**
   （默认请求 `zh-Hans`/`zh-Hant` 这种 Apple 标准粗标签），`zh-Hant-HK`/`zh-Hant-TW`/
   `yue` 直接 miss。open-api 的 BCP47 层级匹配只对 JSON 接口客户端有效，
   吃 TTML 的播放器兜不住。
2. **粤语正文统一 zh-Hant**：Apple 生态粤语 TTML 正文即标 `zh-Hant`；粤语身份由
   Cantopop 曲风与粤拼音译轨 `zh-Latn-jyutping` 承载。
3. **音译轨错标修正**：`<transliteration xml:lang="yue">` 应为 `zh-Latn-jyutping`
   ——音译轨必须是 BCP47 拉丁化方案标签，en/yue 等自然语言码语义错误。

### 迁移口径（四处同步修正，整段幂等可重跑）

| 位置 | 规则 |
|---|---|
| 行表 `song_lyric_lines` | 音译轨：`yue`→`zh-Latn-jyutping`、`zh/zh-Hans/zh-CN/zh-SG`→`zh-Latn-pinyin`、`ja`→`ja-Latn`、`ko`→`ko-Latn`；原文/译文轨：粤语/繁体地区变体（yue/zh-Hant-HK/zh-HK/zh-Hant-MO/zh-MO/zh-Hant-TW/zh-TW）统一 `zh-Hant` |
| `lyric_versions.langs` 摘要 | lrc/enhanced 版本从修正后行表重新聚合；ttml 版本（行表不落地）数组内旧码按正文规则替换 |
| 存疑表 `resolved_lang` | 按 `resolved_kind` 区分语境，同上行表规则 |
| TTML 原文 `ttml_text` | 13 层嵌套 regexp_replace：先修 `<transliteration>` 标签 → 再修行内 x-roman span（role/lang 两种属性顺序）→ 最后兜底把其余位置旧码归 zh-Hant |

**唯一不自动纠的**：音译轨 lang='zh-Hant'（粤拼/拼音有歧义），需人工在后台编辑器
手选（下拉仅 4 项：拼音/粤拼/日罗/韩罗）。

**单向标准化，无需回滚**：个别误判在后台歌词编辑器手选正确方案保存即可。
上线顺序：SQL → 前端（下拉分流 + 解析纠错 + shared/lang.mjs 归一目标统一 zh-Hant）
→ open-api Worker → 边缘缓存自然过期。

## 三、版本手动排序（phase7-lyric-version-sort）

### 出发点

多版本投稿上线后，一首歌可并存多个歌词版本（TTML / 逐字 LRC / 行级 LRC，分属
不同贡献者）。前台「TTML 版本下拉」与「LRC 源下拉」原先按写死规则排序
（is_primary → 格式 → 创建时间），站长无法手动控制展示顺序与默认选中版本。

### 方案

`lyric_versions` 加 `sort_order int`，管理端「歌曲管理 → 版本」弹框维护：

- 排序规则：`sort_order` 升序，NULL 排最后；同值/NULL 之间沿用老规则兜底。
- 存量回填：按歌分区，沿用老展示规则给 10,20,30…（留间隔便于插位）。
- 新审核通过的投稿版本不写 `sort_order`（NULL → 自动排最后），站长事后调序。
- `is_primary` 不再参与展示排序，仅保留数据语义（行表默认容器）。
- 索引：`(song_id, sort_order)` 支撑歌曲页版本列表。

```sql
-- 存量回填（备查）：is_primary DESC → 格式（ttml=0/enhanced=1/lrc=2）→ 创建时间
WITH ranked AS (
  SELECT id, 10 * ROW_NUMBER() OVER (
    PARTITION BY song_id
    ORDER BY is_primary DESC,
             CASE format WHEN 'ttml' THEN 0 WHEN 'enhanced' THEN 1 ELSE 2 END,
             created_at
  ) AS new_order
  FROM public.lyric_versions WHERE status = 'published'
)
UPDATE public.lyric_versions v SET sort_order = r.new_order
FROM ranked r WHERE v.id = r.id;
```

## 执行记录

| 步 | 结果 | 备注 |
|---|---|---|
| resolve_lyric_doubt / save_lyric_lines RPC | ✅ | B1/B2 脏数据链路封死 |
| 语言码统一四处迁移 | ✅ | 行表/摘要/存疑表/TTML 原文旧码清零验证通过 |
| sort_order 加列 + 回填 + 索引 | ✅ | published 版本无 NULL，每歌位次唯一 |
