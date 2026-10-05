# 10 · 歌曲时长全链路统一（mm:ss 唯一格式，删除一切格式化代码）

> 状态：**已执行完成**（2026-10-05：SQL 清洗完成，songs/submissions
> bad_count 均为 0；前端组件化改造完成，`vite-ssg build` 通过）

## 一句话现状

歌曲时长在库里存在 4 种写法（`5:37` / `05:37` / `05:10.310` / 空），投稿、
编辑、审核 6 个输入点全是无校验自由文本；前台靠 `formatDuration()` 运行时
补丁（补零、去毫秒、空值兜底）才能看。本次从**存量数据 + 输入组件**两头
收口为唯一格式 `mm:ss`，之后任何位置拿到时长直接显示，不再有格式化代码。

## 一、存量实测（2026-10-05，anon REST 全量 734 行）

`songs.duration`（text）：

| 写法                  | 数量  | 示例            |
| ------------------- | --- | ------------- |
| `mm:ss` 已规范         | 316 | `03:30`       |
| `m:ss` 分未补零         | 76  | `5:37`、`4:02` |
| `mm:ss.fff` 带 3 位毫秒 | 127 | `05:10.310`   |
| `mm:ss.ff` 带 2 位毫秒  | 23  | `04:50.19`    |
| 空串 `''` / `null`    | 192 | —             |

* 226 条非标准值全部为 ASCII，**songs 表无中文冒号**；秒无 >59、分无 >99。

* 带毫秒的 150 条全部来自早期 TTML Hub 导入（把 `<body dur>` 写进了歌曲时长）。

* `submissions.song_data->>'duration'`（jsonb，批量投稿也是每行一条记录）
  RLS 仅管理员可读，无法在站外核查；站长反馈存在 **`05：37`** **全角冒号** 等
  写法，本次 SQL 一并清洗，执行前预览会把所有异常值列出来。

## 二、清洗规则（两表同一套口径）

1. 去首尾空白；空串、纯空白一律置 `null`。
2. Unicode 冒号统一转半角 `:`：全角 `：`(U+FF1A)、竖排呈现形 `︰`(U+FE13)。
3. **有冒号**时视为「分:秒」：小数点（半角 `.` / 全角 `．` U+FF0E）及其后
   内容视为毫秒，**整段丢弃**（`05:10.310` → `05:10`）。
4. **无冒号但有小数点**时按「分.秒」理解（对应 `05.37` 这种写法）：
   `05.37` → `05:37`。
5. 分、秒各补齐两位（`5:7` → `05:07`，分钟原值不截断）。
6. 秒必须 0–59；无法解析成「数字 + 合法分秒」的值（如纯秒数 `217`、
   `abc`、多点 `1.2.3`）不猜测，归为「待人工确认」（见下），默认置 `null`。

> 分钟不做进位（前端组件同样不进位）；本次只动 `songs.duration` 与
> `submissions.song_data` 内的 `duration` 键，其他字段一律不碰。

## 三、执行版 SQL 将包含的内容（确认后产出）

### 0. 备份（可选但建议）

```sql
create table if not exists _backup_duration_20261005 as
select 'songs' as src, id::text, duration from songs
where duration is not null and duration !~ '^[0-9]{2}:[0-9]{2}$'
union all
select 'submissions', id::text, song_data->>'duration' from submissions
where song_data ? 'duration'
  and coalesce(song_data->>'duration','') !~ '^[0-9]{2}:[0-9]{2}$';
```

### 1. 归一化函数（immutable，纯函数，仅本次清洗用）

按第二节规则实现：全角冒号转换 → 毫秒/小数点分支 → 拆分补零；
非法值返回 `null`。

### 2. 执行前预览（只 SELECT，不改数据）

* A 类「可自动转换」：列出旧值 → 新值对照（songs 预计 226 行；submissions 全量）。

* B 类「无法解析，将置 null」：单列全部行，供人工判断。如有需要保留的行，
  先手动 `update` 成标准值再执行更新语句即可，流程幂等可重跑。

### 3. 更新（单个事务内）

```sql
-- songs：仅更新转换后与旧值不同的行
update songs set duration = normalize_duration(duration)
where duration is distinct from normalize_duration(duration);

-- submissions：只改 jsonb 中的 duration 键，其余数据原样保留；
-- 归一化结果为 NULL（空串/非法）时直接移除 duration 键。
-- 不可用 jsonb_set(..., to_jsonb(NULL))：SQL NULL 会令 jsonb_set 整体
-- 返回 NULL，违反 song_data NOT NULL 约束（已实测踩坑）。
update submissions
set song_data = case
      when normalize_duration(song_data->>'duration') is null
        then song_data - 'duration'
      else jsonb_set(song_data, '{duration}',
        to_jsonb(normalize_duration(song_data->>'duration')))
      end
where song_data ? 'duration'
  and (song_data->>'duration') is distinct from
      normalize_duration(song_data->>'duration');
```

清洗范围含全部状态（pending/approved/rejected），历史数据同样统一，
不影响任何已发布内容。

### 4. 执行后校验（两个查询都必须返回 0）

```sql
select count(*) from songs
where duration is not null and duration !~ '^[0-9]{2}:[0-9]{2}$';

select count(*) from submissions
where song_data ? 'duration'
  and song_data->>'duration' is not null
  and song_data->>'duration' !~ '^[0-9]{2}:[0-9]{2}$';
```

## 四、前端改造（SQL 执行完成后再部署）

1. **新增组件** `src/components/common/DurationInput.vue`：分、秒两个数字
   输入框（分 0–999、秒 0–59 硬限制，**不进位**），只能输入数字；
   v-model 只输出 `''` 或标准 `mm:ss`。组件**不做任何归一化兼容**——
   初始值仅按标准 `mm:ss` 解析，非标准值视为空（洗库后不会再遇到）。
   投稿页与后台两种样式（plain / el 风格尺寸）。
2. **替换 6 处输入**：

   * 单曲投稿 `SubmitView.vue`

   * 批量投稿 `BatchSubmitPanel.vue`

   * 歌曲编辑/单曲审核 `SongFormDialog.vue`

   * 批量审核桌面表格、移动端卡片、⚡统一填充弹窗 `SubmissionsView.vue`
3. **删除格式化代码**：删除 `api.ts` 的 `formatDuration()`；首页、专辑页、
   艺术家页、歌曲页、搜索浮层共 8 处展示改为直接输出
   `{{ s.duration || '—' }}`，同步清理 import。空值全站统一显示 `—`。
4. **入库空值统一** **`null`**：审核发布链（SubmissionsView 插 songs）与
   SongFormDialog 保存/审核回填处，时长为空字符串时落 `null`，
   防止库里再混进空串。

## 五、顺序与回滚

顺序：**SQL 先行 → 校验零残留 → 再部署前端**。洗库后、前端部署前的短暂
窗口内，旧页面只是不再补零/去毫秒（库里已全规范，显示无差异）。
回滚：备份表 `_backup_duration_20261005` 可按 id 还原旧值。
