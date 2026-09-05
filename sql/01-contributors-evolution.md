# 01 · 贡献者关系演进（旧列 → song_contributors 中间表）

> 合并自：fix-get-top-artists-count.md、recompute-artist-types.md、phase2-song-contributors.md、
> phase2-batch2-get-artist-songs.md、ghost-artists-fix.md（全部已执行完毕，2026-08-27）

## 一句话现状

歌曲与艺术家的关联统一存 `song_contributors`（歌×艺术家×角色，四角色：singer/lyricist/composer/arranger）
和 `album_contributors`（专辑×艺术家）两张中间表；songs/albums 上的旧列已删除，中间表是唯一事实源。

## 出发点：旧列时代的三个毛病

建库（v2 迁移）时贡献关系直接摊在 songs 表上：

| 旧列 | 形态 | 毛病 |
|---|---|---|
| `songs.artist_ids` | text[]（歌手 ID 数组） | 一人多个身份存四列，删除艺术家全靠上层手写引用检查，漏一处就留孤儿 |
| `songs.lyricist` / `composer` / `arranger` | ID 逗号串 | 拆解靠 string_to_array，逗号/空格稍有差池就出错 |

具体事故：

1. **首页艺术家作品数重复计数**：`get_top_artists` 把一人在一首歌里的多身份（演唱+作词+作曲+编曲）重复累加，一首歌被计成 2-4 个作品
2. **artists.types 靠人工维护**，与真实关联脱节
3. **删歌/删艺术家没有数据库兜底**，全靠前端回收链自觉

## 第一版尝试（已废弃，仅沿革）

- **fix-get-top-artists-count**：在旧列基础上四路 UNION ALL 切串修计数——修了症状，切串逻辑仍然脆弱
- **recompute-artist-types**：从旧列解析派生 types——同样切串

两者都被 phase2 中间表方案整体取代，SQL 已删（git 历史可查）。教训：**旧列结构不变，补丁永远补不完**。

## 最终方案：中间表 + 双源过渡（phase2，2026-08-27 执行）

核心思路：不搞一次性切换，**A 段建表迁移 + RPC 双源重写 → 代码切换部署 → B 段删旧列单源化**，
过渡期内新旧代码无论谁在写，查询结果都正确（双源 = 中间表 ∪ 旧列）。

### 表结构（现行，DDL 备查）

```sql
-- 歌曲级贡献关系：同一人同一首歌同一角色只允许一行
CREATE TABLE public.song_contributors (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  song_id    text NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,
  artist_id  text NOT NULL REFERENCES public.artists(id) ON DELETE RESTRICT,
  role       text NOT NULL CHECK (role IN ('singer', 'lyricist', 'composer', 'arranger')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT song_contributors_song_artist_role_key UNIQUE (song_id, artist_id, role)
);

-- 专辑艺术家关系
CREATE TABLE public.album_contributors (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  album_id   text NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
  artist_id  text NOT NULL REFERENCES public.artists(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT album_contributors_album_artist_key UNIQUE (album_id, artist_id)
);
```

语义要点：
- `CASCADE`（歌/专辑侧）：删歌自动清关系行——原手写回收链交给数据库
- `RESTRICT`（艺术家侧）：被引用的艺术家删除直接被数据库拒绝——手写引用检查有了兜底
- 迁移按 `artist_ids` 数组顺序插入，读取 `ORDER BY id` 保持原展示顺序

### 权限模型

⚠️ **Supabase 大坑（本项目踩过两次）**：新建表自动给 anon/authenticated 授 ALL（含不受 RLS 检查的 TRUNCATE），
**必须先 REVOKE 再最小权限重授**，只做 GRANT 加法不够。

最终：anon 只读（SELECT 策略 + GRANT SELECT），authenticated 增删改查，service_role 全权。

### 幽灵 ID 修复（ghost-artists-fix）

迁移首次拆解逗号串时发现 **16 处 v2 时代直接写人名**（而非 ID）的遗留数据。人工处理 7 处后，
剩余 9 人（JOHN LEE / Soulspeak / xonthebeat / zay / S-X / Johnny Wu / Laykx Prod / 王迪 / 梯依恩TeN）
建档 + 置换为 ID，改名字段旧名先挂别名保可搜索。此后幽灵清零确认 = 0 行。

### get_artist_songs RPC（phase2-batch2）

前台艺术家作品页从「两次全表查询 + ilike 模糊匹配旧列」改为调用 `get_artist_songs(artist_id)` RPC，
一次性返回歌曲 + 专辑 JSON + 该艺术家在每首歌担任的角色数组。

## 踩过的坑

| 坑 | 经过 | 教训 |
|---|---|---|
| **B 段删列后 get_artist_songs 运行时报错** | B 段冒烟只测了 4 个搜索函数，漏了 get_artist_songs——其函数体仍 select 已删旧列，艺术家作品页线上报错，由 phase3 步骤 1 紧急单源重写修复 | 删列前必须全量盘点引用该列的函数，冒烟清单要覆盖全部 RPC |
| **song_data 双键漂移** | v2 老投稿的裸键（拼接字符串）与新代码的数组键（`lyricist_arr` 等）并存，后台审核读键不一致 | B 段步骤 3 做了五支规范化：裸键→数组键，已知取舍是艺名本身含 `,` 或 `/` 会误拆，审核时人工纠正 |

## 执行记录（2026-08-27）

| 步 | 结果 | 备注 |
|---|---|---|
| A 段 ①~⑤ 建表/RLS/迁移/双源 RPC/验证 | ✅ | |
| B 段 0 前置确认 + 备份旧列 | ✅ | 视图依赖检查 = 0 行 |
| B 段 1 补迁移 | ✅ | expected=2745 actual=2746（多 1 行为新链路发布的 Intro，缺失=0）；album 370=370 |
| B 段 2 单源化 + 删旧列 | ✅ | 冒烟四条正常；Worker 需重部署后 API 恢复 |
| B 段 3 song_data 五支规范化 | ✅ | arranger 待补 4 → 补齐；双键残留 51/51/21/51/51 → 清理全 0 |
| B 段 4 应用层验收 | ✅ | 前台/后台/Worker API 正常；recompute_artist_types 已执行 |

## 现行权威函数去向

- `recompute_artist_types` / `get_top_artists` / `song_performer_ids` / `song_artist_ids` 的现行版本：
  phase2 B 段单源版（中间表 JOIN）为基，`song_artist_ids` 后来在 03 口令文档的 phase3 步骤 5 补了专辑艺术家一路
- 搜索函数族（`search_songs` 等）的演进见 **02-search-evolution.md**
- 完整执行版 SQL 已随本整合从仓库删除，git 历史（phase2-song-contributors.md）永远可查
