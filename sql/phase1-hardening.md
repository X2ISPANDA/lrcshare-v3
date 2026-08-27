# 阶段一：SQL 加固包（phase1-hardening）

> 依据：`sql/数据库重构总方案.md` 阶段一（2026-08-27 全库审计结论）。
> 执行日期：____（执行后填写）
> 执行人：____

## ⚠️ 执行前必读

1. **先备份**：Supabase 控制台 → Database → Backups（或 pg_dump 全量导出）。1.5 删列不可逆。
2. 本脚本**自带前置检查**：任一 DO 块检查失败会 `RAISE EXCEPTION` 中止，不会半写。
3. 代码侧已就绪（`incrementArticleView` 已删除，前台无任何 anon UPDATE 路径；剩余 anon 写操作仅 submissions INSERT）。
4. 逐节执行（① → ⑧），每节执行后看"预期结果"。

---

## ① 前置检查（人工核对，只读不写）

```sql
-- 1. 艺术家重名检查：必须 0 行，否则先人工合并再继续
SELECT lower(name) AS ln, count(*) AS n, array_agg(id || ':' || name) AS dupes
FROM artists GROUP BY lower(name) HAVING count(*) > 1;

-- 2. 孤儿引用检查：必须全 0
SELECT 'songs.contributor_id 孤儿' AS chk, count(*) FROM songs s
WHERE s.contributor_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM contributors c WHERE c.id = s.contributor_id)
UNION ALL
SELECT 'submissions.contributor_id 孤儿', count(*) FROM submissions x
WHERE x.contributor_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM contributors c WHERE c.id = x.contributor_id);

-- 3. status 现有值域（决定 ⑤ 的 CHECK 白名单是否需要调整）
SELECT 'songs' t, status, count(*) FROM songs GROUP BY status
UNION ALL SELECT 'submissions', status, count(*) FROM submissions GROUP BY status
UNION ALL SELECT 'articles', status, count(*) FROM articles GROUP BY status;
-- 预期：songs ∈ {published}，submissions ∈ {pending, approved, rejected}，articles ∈ {published, draft}
-- 若出现白名单外的值（如空串），先清洗（UPDATE）再执行 ⑤

-- 4. status NULL 行数：必须全 0（⑤ 要 SET NOT NULL）
SELECT 'songs NULL status' AS chk, count(*) FROM songs WHERE status IS NULL
UNION ALL SELECT 'submissions NULL status', count(*) FROM submissions WHERE status IS NULL
UNION ALL SELECT 'articles NULL status', count(*) FROM articles WHERE status IS NULL;
```

---

## ② anon 权限收缩（审计 R1）

```sql
BEGIN;

-- 1) 收回 anon 全部表权限（当前：全部 10 表 INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER）
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;

-- 2) authenticated 收回 TRUNCATE（后台从不使用，纯收口）
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM authenticated;

-- 3) 按最小权限重新授予 anon
-- 3a. 公开只读表：表级 SELECT（行级过滤由 RLS 策略负责）
GRANT SELECT ON albums, artists, contributors, articles,
  friends, friend_categories, sponsors, settings TO anon;

-- 3b. submissions：INSERT（投稿入口）+ SELECT（api.ts 贡献者主页兜底查询需要表级
--     SELECT 才能走 RLS 返回空集，否则报权限错误；RLS 无 anon 读策略，行级全拒）
GRANT INSERT, SELECT ON submissions TO anon;

-- 3c. songs：列级 SELECT，排除 unlock_code（动态按 pg_attribute 实际列结构授权，
--     与 revoke-unlock-code-column.md v3 同思路——新增公开列自动纳入，无需维护清单）
DO $$
DECLARE
  col_list text;
BEGIN
  SELECT string_agg(quote_ident(a.attname), ', ')
  INTO col_list
  FROM pg_attribute a
  WHERE a.attrelid = 'public.songs'::regclass
    AND a.attnum > 0 AND NOT a.attisdropped
    AND a.attname <> 'unlock_code';
  EXECUTE format('GRANT SELECT (%s) ON public.songs TO anon', col_list);
END $$;

COMMIT;
```

**预期结果**：Success, no rows returned。
**回滚**（如前台异常时临时恢复）：

```sql
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
```

---

## ③ 艺术家名唯一索引（审计 R2）

```sql
-- 函数唯一索引：lower(name) 维度去重（拦 "aa"/"AA" 类大小写变体重复）
CREATE UNIQUE INDEX IF NOT EXISTS artists_name_lower_uniq ON public.artists (lower(name));
```

**预期结果**：`CREATE INDEX`。若报 `could not create unique index` 说明存在重名——回到 ①-1 人工合并后重跑。

**代码侧注意**：此后新建艺术家若撞名（含大小写变体），Supabase 返回唯一冲突错误；前端 ArtistTagInput 的不区分大小写匹配是体验层（提前拦），数据库约束是兜底层。若后台新建报 duplicate key，提示"已存在同名艺术家"即可。

---

## ④ 补外键（审计 R3）

```sql
BEGIN;

ALTER TABLE songs
  ADD CONSTRAINT songs_contributor_id_fkey
  FOREIGN KEY (contributor_id) REFERENCES contributors(id) ON DELETE SET NULL;

ALTER TABLE submissions
  ADD CONSTRAINT submissions_contributor_id_fkey
  FOREIGN KEY (contributor_id) REFERENCES contributors(id) ON DELETE SET NULL;

COMMIT;
```

**预期结果**：Success。若报 `violates foreign key constraint` 说明存在孤儿——回到 ①-2 处理。
**语义**：删除贡献者 → 歌曲保留、署名置空（与现有回收链行为一致）。

---

## ⑤ status CHECK 约束（审计 O3）

```sql
BEGIN;

ALTER TABLE songs ALTER COLUMN status SET NOT NULL,
  DROP CONSTRAINT IF EXISTS songs_status_chk,
  ADD CONSTRAINT songs_status_chk CHECK (status IN ('published', 'draft'));

ALTER TABLE submissions ALTER COLUMN status SET NOT NULL,
  DROP CONSTRAINT IF EXISTS submissions_status_chk,
  ADD CONSTRAINT submissions_status_chk
    CHECK (status IN ('pending', 'approved', 'rejected', 'withdrawn'));

ALTER TABLE articles ALTER COLUMN status SET NOT NULL,
  DROP CONSTRAINT IF EXISTS articles_status_chk,
  ADD CONSTRAINT articles_status_chk CHECK (status IN ('published', 'draft'));

COMMIT;
```

**预期结果**：Success。若报 `check constraint is violated by some row`——回到 ①-3 清洗意外值。

---

## ⑥ 删除死列（审计 O1，不可逆——确认已备份）

```sql
-- contributors.song_count：全 0 且永不更新，前台实时计算覆盖
ALTER TABLE public.contributors DROP COLUMN IF EXISTS song_count;

-- articles.views：自算浏览量逻辑已删（改用 busuanzi），列彻底死亡
ALTER TABLE public.articles DROP COLUMN IF EXISTS views;
```

**预期结果**：`ALTER TABLE` ×2。

---

## ⑦ search_albums_structured 显式列清单（审计合规项）

```sql
CREATE OR REPLACE FUNCTION public.search_albums_structured(p_name text DEFAULT NULL, p_artist text DEFAULT NULL)
RETURNS SETOF albums
LANGUAGE sql
STABLE
AS $function$
  select id, name, year, cover, created_at, artist_ids, initial, description
  from public.albums a
  where (
    p_name is null
    or a.name ilike '%' || p_name || '%'
  )
  and (
    p_artist is null
    or exists (
      select 1
      from public.artists ar
      where ar.is_show is not false
        and ar.id = any(a.artist_ids)
        and (
          ar.name ilike '%' || p_artist || '%'
          or exists (select 1 from unnest(coalesce(ar.aliases, '{}')) al where al ilike '%' || p_artist || '%')
        )
    )
  )
  order by a.name asc
$function$;
```

**预期结果**：`CREATE FUNCTION`（旧签名同参同型，直接覆盖，无需 DROP）。

---

## ⑧ 执行后回归验证（只读）

```sql
-- 1. anon 权限终态核对：应只剩下列行
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee = 'anon'
ORDER BY table_name, privilege_type;
-- 预期：
--   albums/artists/contributors/articles/friends/friend_categories/sponsors/settings → SELECT
--   submissions → INSERT, SELECT
--   songs → 无表级行（列级授权不在此视图，另查 column_privileges）

-- 2. songs 列级授权核对：unlock_code 不应出现
SELECT column_name FROM information_schema.column_privileges
WHERE table_schema = 'public' AND table_name = 'songs' AND grantee = 'anon'
  AND column_name = 'unlock_code';
-- 预期：0 行

-- 3. 约束终态：应出现 songs_contributor_id_fkey / submissions_contributor_id_fkey
--   / 三个 *_status_chk
SELECT conrelid::regclass::text AS tbl, conname FROM pg_constraint
WHERE connamespace = 'public'::regnamespace
  AND (conname LIKE '%_status_chk' OR conname LIKE '%contributor_id_fkey')
ORDER BY 1;

-- 4. 唯一索引存在
SELECT indexname FROM pg_indexes
WHERE schemaname = 'public' AND indexname = 'artists_name_lower_uniq';
-- 预期：1 行

-- 5. 死列已删
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public'
  AND ((table_name = 'contributors' AND column_name = 'song_count')
    OR (table_name = 'articles' AND column_name = 'views'));
-- 预期：0 行
```

**应用层验证**（前端 `npm run dev`）：

1. 前台首页 / 歌曲页 / 专辑 / 艺术家 / 贡献者 / 文章 / 友链 / 赞赏 / 关于 全部正常加载
2. 匿名投稿提交成功（submissions INSERT）
3. 后台登录 → 歌曲增删改 / 艺术家增删 / 专辑 / 文章 / 投稿审核 全部正常（authenticated 不受影响）
4. 后台新建同名艺术家（含大小写变体）→ 数据库拒绝

---

## 执行记录

| 节 | 结果 | 备注 |
|---|---|---|
| ① 前置检查 | ☐ 通过 | |
| ② anon 收权 | ☐ 通过 | |
| ③ 唯一索引 | ☐ 通过 | |
| ④ 外键 | ☐ 通过 | |
| ⑤ CHECK | ☐ 通过 | |
| ⑥ 删死列 | ☐ 通过 | |
| ⑦ RPC 重写 | ☐ 通过 | |
| ⑧ 回归验证 | ☐ 通过 | |
