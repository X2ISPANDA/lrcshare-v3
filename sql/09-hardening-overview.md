# 09 · 安全加固与性能收口总纲（数据库重构总纲）

> 合并自：数据库重构总方案.md（2026-08-27 全库审计后的三阶段总纲）、
> phase1-hardening.md（阶段一执行版）、phase8-admin-songs-paginate.md（后台分页，
> 2026-09-04 执行）（全部已执行；完整执行版 SQL 见 git 历史原文件）
> 审计原始结论见 `sql/执行结果.json`。

## 一句话现状

数据库从「靠上层代码纪律保证正确」改为「**靠数据库结构保证正确**」：anon 最小
权限（TRUNCATE 不受 RLS 检查，GRANT 层必须收）、唯一索引/外键/CHECK 兜底、
死列清理；后台歌曲管理服务端分页 + 跨字段搜索下推库端。

## 出发点：2026-08-27 全库审计

对结构/约束/索引/RPC/RLS/权限/数据形态做了一次全库审计，核心发现：

| 编号 | 问题 | 严重性 |
|---|---|---|
| R1 | anon 对全部 10 张表拥有表级 INSERT/UPDATE/DELETE/TRUNCATE，仅靠 RLS 单层拦截，且 **TRUNCATE 不受 RLS 检查**——误删一条策略全库裸奔 | 最高 |
| R2 | `artists.name` 无唯一约束，同名/大小写变体（"aa"/"AA"）可随意插入 | 高 |
| R3 | `songs/submissions.contributor_id` 为裸 text 无外键，孤儿检查纯靠代码自觉 | 高 |
| O1 | 死列：`contributors.song_count`（全 0 永不更新）、`articles.views`（自算浏览量已删改用 busuanzi） | 低 |
| O3 | status 三表可空、任意字符串可插入 | 中 |

## 三阶段路线图（总纲）

审计结论收敛为三阶段重构，**顺序不可换**（权限收口先行，后续阶段的 REVOKE/GRANT
都基于最小权限基线）：

| 阶段 | 内容 | 详述 |
|---|---|---|
| 一 | SQL 加固包（零/极小代码改动，收益立刻兑现） | **本文** |
| 二 | 贡献关系中间表（song_contributors / album_contributors） | 见 **01-contributors-evolution.md** |
| 三 | 口令拆表 song_secrets | 见 **03-unlock-code-evolution.md** |

## 阶段一：SQL 加固包（phase1-hardening 执行版）

八节逐个执行，脚本自带前置检查（DO 块失败即 RAISE EXCEPTION 中止，不半写）。
**执行前必须先备份**（1.6 删列不可逆）。

### ① anon 权限收缩（R1，最高优先级）

```sql
BEGIN;
-- 1) 收回 anon 全部表权限；authenticated 收回 TRUNCATE（后台从不用，纯收口）
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM authenticated;

-- 2) 按最小权限重新授予
-- 2a. 公开只读表：表级 SELECT（行级过滤由 RLS 策略负责）
GRANT SELECT ON albums, artists, contributors, articles,
  friends, friend_categories, sponsors, settings TO anon;
-- 2b. submissions：INSERT（投稿入口）+ SELECT
--     （api.ts 贡献者主页兜底查询需要表级 SELECT 才能走 RLS 返回空集，
--      否则报权限错误；RLS 无 anon 读策略，行级全拒）
GRANT INSERT, SELECT ON submissions TO anon;
-- 2c. songs：列级 SELECT，动态按 pg_attribute 实际列结构授权排除 unlock_code
--     （新增公开列自动纳入，无需维护清单）
DO $$
DECLARE col_list text;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ') INTO col_list
  FROM pg_attribute a
  WHERE a.attrelid = 'public.songs'::regclass
    AND a.attnum > 0 AND NOT a.attisdropped AND a.attname <> 'unlock_code';
  EXECUTE format('GRANT SELECT (%s) ON public.songs TO anon', col_list);
END $$;
COMMIT;
```

> songs 的列级动态授权思路在阶段三拆表（03）后随 unlock_code 列一起消亡。

### ② 艺术家名唯一索引（R2）

```sql
-- 函数唯一索引：lower(name) 维度去重（拦 "aa"/"AA" 类大小写变体）
CREATE UNIQUE INDEX IF NOT EXISTS artists_name_lower_uniq ON public.artists (lower(name));
```

前端不区分大小写匹配是**体验层**（提前拦），数据库约束是**兜底层**——后台新建
报 duplicate key 时提示「已存在同名艺术家」即可。

### ③ 补外键（R3）

```sql
ALTER TABLE songs ADD CONSTRAINT songs_contributor_id_fkey
  FOREIGN KEY (contributor_id) REFERENCES contributors(id) ON DELETE SET NULL;
ALTER TABLE submissions ADD CONSTRAINT submissions_contributor_id_fkey
  FOREIGN KEY (contributor_id) REFERENCES contributors(id) ON DELETE SET NULL;
```

语义：删除贡献者 → 歌曲保留、署名置空（与现有回收链「被引用不删、强行删则摘链」
一致）。与阶段二中间表的 CASCADE/RESTRICT 同一哲学：**回收链交给数据库**。

### ④ status CHECK 约束（O3）

三表 NOT NULL + 白名单：songs/articles ∈ {published, draft}；
submissions ∈ {pending, approved, rejected, withdrawn}（withdrawn 为预留撤回态）。

### ⑤ 删除死列（O1，不可逆）

`contributors.song_count`、`articles.views`——永不读写的列留着只会误导。

### ⑥ search_albums_structured 显式列清单

唯一使用 `select a.*` 的 RPC（违反「RPC 禁 SELECT *」项目约定），重写为显式
列清单。约定就是约定—— albums 虽无敏感列，但今天 a *、明天就是 songs.*。

## phase8：后台歌曲管理分页 + 跨字段搜索（2026-09-04）

### 出发点

后台「歌曲管理」页一次性**全表拉取** songs / song_contributors / song_secrets，
数据量增长后页面加载随曲库线性变慢（审计 C4）。改造为服务端分页后，搜索也必须
下推到库端（否则只能筛当前页）。前台五 tab 搜索**零改动**。

### 方案：两个后台专用函数

- `admin_search_songs(p_q)`：跨**歌名/歌别名/歌手名/歌手别名/专辑名**模糊搜索，
  **不限状态**（草稿、隐藏的歌后台也要能搜到）。歌手命中复用现成的
  `song_artist_ids` 汇总（演唱/词/曲/编 + 专辑艺术家）；专辑表无 aliases 列，
  仅按专辑名匹配（与前台一致）。
- `admin_search_songs_count(p_q)`：同条件计数，包一层保证与列表条件永远一致
  （分页 total）。

排序/翻页由 PostgREST 在函数结果集外层下推（`?order=&limit=&offset=`）。

### 权限（真漏洞修复）

```sql
REVOKE EXECUTE ON FUNCTION public.admin_search_songs(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_search_songs(text) TO authenticated;
```

仅 authenticated 可执行，anon 收权——否则它是绕过 `status='published'` 过滤的
**公开搜索通道**（草稿/隐藏歌全泄露）。

> **踩坑**：CREATE FUNCTION 后 Supabase 默认给 anon 授予执行权，事务里写了
> REVOKE 但 anon 仍能访问——需显式重发 REVOKE 并核对才生效。函数没有 RLS，
> **EXECUTE 权限就是唯一防线**（对比：表有 RLS，GRANT 层 true 无所谓，见 07）。

## 全程纪律（多阶段施工沉淀）

1. **每阶段执行前**：Supabase 控制台备份数据库（或 pg_dump 全量导出）
2. **事务包裹**：任一句失败整体回滚，不留半成品
3. **幂等可重跑**：IF NOT EXISTS / ON CONFLICT / 覆盖语义
4. **删列前全量盘点**：引用该列的函数/视图/代码全部找齐（阶段二 B 段漏查
   get_artist_songs 线上报错的教训，见 01）
5. **songs 加列必补占位**：所有 `RETURNS SETOF songs` 的 RPC 同步补
   `null::` 占位（phase5-stepA 踩过，见 05）
6. **每阶段后回归验证**：前台全站浏览 + 匿名投稿 + 后台全操作 + 匿名越权全被拒
7. **执行顺序**：先 SQL 后前端（新函数依赖）；先备份后删列

## 执行记录

| 步 | 结果 | 备注 |
|---|---|---|
| 前置检查（重名/孤儿/status 值域/NULL） | ✅ | 全 0 通过 |
| ① anon 收权 + 最小权限重授 | ✅ | 前台/投稿/后台全回归通过 |
| ② 艺术家名唯一索引 | ✅ | |
| ③ contributor_id 外键 ×2 | ✅ | |
| ④ status CHECK ×3 | ✅ | |
| ⑤ 删死列 ×2 | ✅ | 备份后执行 |
| ⑥ search_albums_structured 重写 | ✅ | |
| phase8 admin_search_songs / count | ✅ | REVOKE 生效核对后通过 |

## 后续加固去向

- 阶段二（中间表）→ **01**；阶段三（口令拆表）→ **03**
- 搜索函数族演进 → **02**；歌词数据结构 → **04 / 05 / 06**
- 投稿与邮件 → **07**；联系方式与外链 → **08**
