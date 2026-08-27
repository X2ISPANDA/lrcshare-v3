# 阶段二：贡献关系中间表（phase2-song-contributors）

> 依据：`sql/数据库重构总方案.md` 阶段二。
> 执行日期：A 段 2026-08-27 ｜ B 段 2026-08-27（代码批次 1~4 部署验证后）
>
> **本脚本分 A / B 两段，中间夹着代码改造，不可一口气全跑：**
>
> | 段 | 内容 | 执行时机 |
> |---|---|---|
> | **A 段（①~⑤）** | 建表 + 幂等迁移 + RPC 双源重写 | **现在执行**。执行后现有代码零感知（旧代码继续读写旧列，双源 RPC 把两边都算进去） |
> | （代码批次 1~4） | 写入/读取切到中间表，部署验证 | A 段通过后由 AI 改代码，你部署 |
> | **B 段（⑥~⑨）** | 补迁移 + RPC 单源化 + 删旧列 + song_data 规范化 | **⛔ 代码全部部署且验证通过后才执行**（已重组为分步执行手册，见下方「B 段执行手册」） |
>
> 双源过渡原理：A 段后的所有 RPC 同时读中间表和旧列（UNION 去重）。无论过渡期内哪个版本的代码在写入（旧版写旧列 / 新版写中间表），查询结果都正确。B 段删除旧列的同时把 RPC 简化为只读中间表。

---

# ═══════════ A 段（现在执行）═══════════

## ① 建表：song_contributors / album_contributors

```sql
BEGIN;

-- 歌曲级贡献关系（歌手/作词/作曲/编曲统一建模）
CREATE TABLE IF NOT EXISTS public.song_contributors (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  song_id    text NOT NULL REFERENCES public.songs(id) ON DELETE CASCADE,
  artist_id  text NOT NULL REFERENCES public.artists(id) ON DELETE RESTRICT,
  role       text NOT NULL CHECK (role IN ('singer', 'lyricist', 'composer', 'arranger')),
  created_at timestamptz NOT NULL DEFAULT now(),
  -- 同一人在同一首歌同一角色只允许一行；不同角色各一行
  CONSTRAINT song_contributors_song_artist_role_key UNIQUE (song_id, artist_id, role)
);

CREATE INDEX IF NOT EXISTS idx_song_contributors_artist ON public.song_contributors (artist_id, role);
CREATE INDEX IF NOT EXISTS idx_song_contributors_song   ON public.song_contributors (song_id);

-- 专辑艺术家关系（对应旧 albums.artist_ids）
CREATE TABLE IF NOT EXISTS public.album_contributors (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  album_id   text NOT NULL REFERENCES public.albums(id) ON DELETE CASCADE,
  artist_id  text NOT NULL REFERENCES public.artists(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT album_contributors_album_artist_key UNIQUE (album_id, artist_id)
);

CREATE INDEX IF NOT EXISTS idx_album_contributors_artist ON public.album_contributors (artist_id);

COMMIT;
```

**语义**：
- `ON DELETE CASCADE`（歌/专辑侧）：删歌自动清关系行——现有手写回收链做的事交给数据库
- `ON DELETE RESTRICT`（艺术家侧）：艺术家被任何关系行引用时，数据库直接拒绝删除——三处手写引用检查从此有数据库兜底

## ② RLS 策略 + 授权

> ⚠️ **Supabase 坑**：本项目配了 DEFAULT PRIVILEGES，**新建表自动给 anon/authenticated/service_role 授 ALL**（含 TRUNCATE，而 TRUNCATE 不受 RLS 检查）。
> 所以必须先 REVOKE 默认授权再按最小权限重授——只做 GRANT 加法不够（2026-08-27 实测踩坑）。
> **phase3 的 song_secrets 建表后同样必须先 REVOKE。**

```sql
BEGIN;

ALTER TABLE public.song_contributors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.album_contributors ENABLE ROW LEVEL SECURITY;

CREATE POLICY "歌曲贡献：所有人可读" ON public.song_contributors
  FOR SELECT TO public USING (true);
CREATE POLICY "歌曲贡献：管理员可增" ON public.song_contributors
  FOR INSERT TO public WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "歌曲贡献：管理员可改" ON public.song_contributors
  FOR UPDATE TO public USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "歌曲贡献：管理员可删" ON public.song_contributors
  FOR DELETE TO public USING (auth.role() = 'authenticated');

CREATE POLICY "专辑贡献：所有人可读" ON public.album_contributors
  FOR SELECT TO public USING (true);
CREATE POLICY "专辑贡献：管理员可增" ON public.album_contributors
  FOR INSERT TO public WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "专辑贡献：管理员可改" ON public.album_contributors
  FOR UPDATE TO public USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "专辑贡献：管理员可删" ON public.album_contributors
  FOR DELETE TO public USING (auth.role() = 'authenticated');

-- 1) 先收回 Supabase 默认授权（新建表自动 ALL，含不受 RLS 约束的 TRUNCATE）
REVOKE ALL ON public.song_contributors, public.album_contributors FROM anon;
REVOKE ALL ON public.song_contributors, public.album_contributors FROM authenticated;

-- 2) 最小权限重授
GRANT SELECT ON public.song_contributors, public.album_contributors TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.song_contributors, public.album_contributors TO authenticated;
-- identity 列的序列使用权限（INSERT 必需）
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

COMMIT;
```

## ③ 幂等数据迁移（可反复执行）

```sql
-- 歌手：songs.artist_ids → role='singer'
-- 按 artist_ids 数组顺序插入（id 自增），读取时 ORDER BY id 即保持原展示顺序
INSERT INTO public.song_contributors (song_id, artist_id, role)
SELECT s.id, trim(a), 'singer'
FROM public.songs s, unnest(s.artist_ids) AS a
WHERE trim(a) <> ''
  AND EXISTS (SELECT 1 FROM public.artists ar WHERE ar.id = trim(a))
ON CONFLICT (song_id, artist_id, role) DO NOTHING;

-- 作词
INSERT INTO public.song_contributors (song_id, artist_id, role)
SELECT s.id, trim(x), 'lyricist'
FROM public.songs s, unnest(string_to_array(coalesce(s.lyricist, ''), ',')) AS x
WHERE trim(x) <> ''
  AND EXISTS (SELECT 1 FROM public.artists ar WHERE ar.id = trim(x))
ON CONFLICT (song_id, artist_id, role) DO NOTHING;

-- 作曲
INSERT INTO public.song_contributors (song_id, artist_id, role)
SELECT s.id, trim(x), 'composer'
FROM public.songs s, unnest(string_to_array(coalesce(s.composer, ''), ',')) AS x
WHERE trim(x) <> ''
  AND EXISTS (SELECT 1 FROM public.artists ar WHERE ar.id = trim(x))
ON CONFLICT (song_id, artist_id, role) DO NOTHING;

-- 编曲
INSERT INTO public.song_contributors (song_id, artist_id, role)
SELECT s.id, trim(x), 'arranger'
FROM public.songs s, unnest(string_to_array(coalesce(s.arranger, ''), ',')) AS x
WHERE trim(x) <> ''
  AND EXISTS (SELECT 1 FROM public.artists ar WHERE ar.id = trim(x))
ON CONFLICT (song_id, artist_id, role) DO NOTHING;

-- 专辑艺术家：albums.artist_ids → album_contributors
INSERT INTO public.album_contributors (album_id, artist_id)
SELECT al.id, trim(a)
FROM public.albums al, unnest(al.artist_ids) AS a
WHERE trim(a) <> ''
  AND EXISTS (SELECT 1 FROM public.artists ar WHERE ar.id = trim(a))
ON CONFLICT (album_id, artist_id) DO NOTHING;
```

**幽灵 ID 报告**（被 EXISTS 过滤掉的引用——**预期 0 行**，有行则先人工处理再重跑 ③）：

```sql
SELECT 'songs.artist_ids' AS src, s.id AS ref, x AS ghost_id
FROM public.songs s, unnest(s.artist_ids) x
WHERE trim(x) <> '' AND NOT EXISTS (SELECT 1 FROM public.artists a WHERE a.id = trim(x))
UNION ALL
SELECT 'songs.lyricist', s.id, x FROM public.songs s, unnest(string_to_array(coalesce(s.lyricist,''), ',')) x
WHERE trim(x) <> '' AND NOT EXISTS (SELECT 1 FROM public.artists a WHERE a.id = trim(x))
UNION ALL
SELECT 'songs.composer', s.id, x FROM public.songs s, unnest(string_to_array(coalesce(s.composer,''), ',')) x
WHERE trim(x) <> '' AND NOT EXISTS (SELECT 1 FROM public.artists a WHERE a.id = trim(x))
UNION ALL
SELECT 'songs.arranger', s.id, x FROM public.songs s, unnest(string_to_array(coalesce(s.arranger,''), ',')) x
WHERE trim(x) <> '' AND NOT EXISTS (SELECT 1 FROM public.artists a WHERE a.id = trim(x))
UNION ALL
SELECT 'albums.artist_ids', al.id, x FROM public.albums al, unnest(al.artist_ids) x
WHERE trim(x) <> '' AND NOT EXISTS (SELECT 1 FROM public.artists a WHERE a.id = trim(x));
```

## ④ RPC 双源重写

> 签名变更的函数必须先 DROP 再 CREATE（避免重载）。CASCADE 会连带 DROP 依赖它们的函数，下方全部重建，顺序安全。
> **双源 = 中间表 ∪ 旧列**，过渡期两个写入方（旧代码写旧列 / 新代码写中间表）的产物都能被查到。

```sql
-- ⚠️ 整段一次执行（单事务，任一语句失败全部回滚，不会留下函数被删的中间态）
BEGIN;

-- 先清掉旧版（CASCADE 连带依赖方，随后全部重建）
DROP FUNCTION IF EXISTS public.song_artist_hit(text[], text, text, text, text) CASCADE;
DROP FUNCTION IF EXISTS public.performer_hit(text[], text) CASCADE;
DROP FUNCTION IF EXISTS public.song_token_weight(text, text[], text[], text) CASCADE;
DROP FUNCTION IF EXISTS public.struct_hit(text, text[], text[], text[]) CASCADE;
DROP FUNCTION IF EXISTS public.search_songs(text) CASCADE;
DROP FUNCTION IF EXISTS public.search_songs_structured(text, text) CASCADE;
DROP FUNCTION IF EXISTS public.get_top_artists(integer) CASCADE;
DROP FUNCTION IF EXISTS public.recompute_artist_types(text[]) CASCADE;

-- ═══ 辅助：一首歌的演唱者 ID（双源：中间表 singer ∪ 旧 artist_ids）═══
CREATE OR REPLACE FUNCTION public.song_performer_ids(p_song_id text)
RETURNS text[]
LANGUAGE sql STABLE
AS $function$
  select coalesce(array_agg(distinct a), '{}'::text[])
  from (
    select sc.artist_id as a
    from public.song_contributors sc
    where sc.song_id = p_song_id and sc.role = 'singer'
    union
    select unnest(s.artist_ids) from public.songs s where s.id = p_song_id
  ) x
  where a is not null and a <> ''
$function$;

-- ═══ 辅助：一首歌的全部关联艺术家 ID（双源：中间表 ∪ 旧列四路）═══
CREATE OR REPLACE FUNCTION public.song_artist_ids(p_song_id text)
RETURNS text[]
LANGUAGE sql STABLE
AS $function$
  select coalesce(array_agg(distinct a), '{}'::text[])
  from (
    select sc.artist_id as a from public.song_contributors sc where sc.song_id = p_song_id
    union
    select unnest(s.artist_ids) from public.songs s where s.id = p_song_id
    union
    select unnest(string_to_array(coalesce(s.lyricist, ','), ',')) from public.songs s where s.id = p_song_id
    union
    select unnest(string_to_array(coalesce(s.composer, ','), ',')) from public.songs s where s.id = p_song_id
    union
    select unnest(string_to_array(coalesce(s.arranger, ','), ',')) from public.songs s where s.id = p_song_id
  ) x
  where a is not null and a <> ''
$function$;

-- ═══ 演唱者命中（签名改为 song_id）═══
CREATE OR REPLACE FUNCTION public.performer_hit(p_song_id text, p_txt text)
RETURNS boolean
LANGUAGE sql STABLE
AS $function$
  select exists (
    select 1 from public.artists ar
    where ar.is_show is not false
      and ar.id = any(public.song_performer_ids(p_song_id))
      and (
        ar.name ilike '%' || p_txt || '%'
        or exists (select 1 from unnest(coalesce(ar.aliases, '{}')) al where al ilike '%' || p_txt || '%')
      )
  )
$function$;

-- ═══ 全角色命中（原五参数版本改为 song_id）═══
CREATE OR REPLACE FUNCTION public.song_artist_hit(p_song_id text, p_tok text)
RETURNS boolean
LANGUAGE sql STABLE
AS $function$
  select exists (
    select 1 from public.artists ar
    where ar.is_show is not false
      and ar.id = any(public.song_artist_ids(p_song_id))
      and (
        ar.name ilike '%' || p_tok || '%'
        or exists (select 1 from unnest(coalesce(ar.aliases, '{}')) al where al ilike '%' || p_tok || '%')
      )
  )
$function$;

-- ═══ token 权重（签名改为 song_id）═══
CREATE OR REPLACE FUNCTION public.song_token_weight(p_song_id text, p_title text, p_aliases text[], p_tok text)
RETURNS double precision
LANGUAGE sql STABLE
AS $function$
  select case
    when p_title ilike '%' || p_tok || '%' then 3
    when exists (select 1 from unnest(coalesce(p_aliases, '{}')) a where a ilike '%' || p_tok || '%') then 2
    when public.performer_hit(p_song_id, p_tok) then 1
    else 0.5
  end
$function$;

-- ═══ 结构化命中（签名改为 song_id）═══
CREATE OR REPLACE FUNCTION public.struct_hit(p_song_id text, p_title text, p_aliases text[], p_tokens text[])
RETURNS double precision
LANGUAGE sql STABLE
AS $function$
  select (
    select coalesce(sum(case
      when p_title ilike '%' || t || '%' then 3
      when exists (select 1 from unnest(coalesce(p_aliases, '{}')) a where a ilike '%' || t || '%') then 2
      when public.performer_hit(p_song_id, t) then 1
      else 0
    end), 0)
    from unnest(p_tokens) t
  )
$function$;

-- ═══ 模糊搜索（严格镜像原版：参数名 p_q / 列序 / AND-token 过滤 / 排序均不变，
--     仅 song_artist_hit、struct_hit、song_token_weight 三处调用改为 song_id 新签名）═══
CREATE OR REPLACE FUNCTION public.search_songs(p_q text)
RETURNS SETOF songs
LANGUAGE plpgsql
STABLE
AS $function$
      declare
        tokens text[] := array(
          select t from regexp_split_to_table(trim(coalesce(p_q, '')), '\s+') t where t <> ''
        );
      begin
        if cardinality(tokens) = 0 then
          return;
        end if;

        return query
        select id, title, album_id, lyricist, composer, arranger, duration, lrc_text, status, created_at, track, contributor_id, lyrics_text, video_url, description, is_hidden, null::text as unlock_code, genres, artist_ids, disc, cover, aliases
        from public.songs s
        where s.status = 'published'
          -- AND 过滤：每个 token 必须有家，一个无家可归即淘汰
          and not exists (
            select 1 from unnest(tokens) tok
            where not (
                 song_title_hit(s.title, s.aliases, tok)
              or song_artist_hit(s.id, tok)
            )
          )
        order by
          struct_hit(s.id, s.title, s.aliases, tokens) desc,
          (
            select coalesce(sum(song_token_weight(s.id, s.title, s.aliases, tok)), 0)
            from unnest(tokens) tok
          ) desc,
          s.title asc;
      end
$function$;

-- ═══ 结构化搜索（严格镜像原版：列序 / 过滤 / order by title asc 不变，
--     仅演唱者命中从 s.artist_ids 改为双源 song_performer_ids(s.id)）═══
CREATE OR REPLACE FUNCTION public.search_songs_structured(p_title text DEFAULT NULL::text, p_artist text DEFAULT NULL::text)
RETURNS SETOF songs
LANGUAGE sql
STABLE
AS $function$
      select id, title, album_id, lyricist, composer, arranger, duration, lrc_text, status, created_at, track, contributor_id, lyrics_text, video_url, description, is_hidden, null::text as unlock_code, genres, artist_ids, disc, cover, aliases
      from public.songs s
      where s.status = 'published'
        and (
          p_title is null
          or s.title ilike '%' || p_title || '%'
          or exists (select 1 from unnest(coalesce(s.aliases, '{}')) a where a ilike '%' || p_title || '%')
        )
        and (
          p_artist is null
          or exists (
            select 1
            from public.artists ar
            where ar.is_show is not false
              and ar.id = any(public.song_performer_ids(s.id))
              and (
                ar.name ilike '%' || p_artist || '%'
                or exists (select 1 from unnest(coalesce(ar.aliases, '{}')) al where al ilike '%' || p_artist || '%')
              )
          )
        )
      order by s.title asc
$function$;

-- ═══ 首页热门艺术家（双源：中间表 ∪ 旧列；签名/出参/排序与原版完全一致）═══
CREATE OR REPLACE FUNCTION public.get_top_artists(limit_count integer DEFAULT 6)
RETURNS TABLE(id text, name text, sort integer, avatar text, types text[], disambiguation text, is_show boolean, aliases text[], song_count integer)
LANGUAGE sql STABLE
AS $function$
  with song_artist_pairs as (
    -- 新源：中间表（只统计已发布歌曲）
    select sc.song_id, sc.artist_id
    from public.song_contributors sc
    join public.songs s on s.id = sc.song_id and s.status = 'published'
    union
    -- 旧源 1：演唱者数组
    select s.id, unnest(s.artist_ids)
    from public.songs s where s.status = 'published' and s.artist_ids is not null
    union
    -- 旧源 2~4：作词/作曲/编曲逗号串
    select s.id, unnest(string_to_array(s.lyricist, ','))
    from public.songs s where s.lyricist is not null and s.status = 'published'
    union
    select s.id, unnest(string_to_array(s.composer, ','))
    from public.songs s where s.composer is not null and s.status = 'published'
    union
    select s.id, unnest(string_to_array(s.arranger, ','))
    from public.songs s where s.arranger is not null and s.status = 'published'
  ),
  counts as (
    select artist_id, count(*) as cnt
    from song_artist_pairs
    where artist_id is not null and artist_id <> ''
    group by artist_id
  )
  select
    a.id, a.name, a.sort, a.avatar, a.types, a.disambiguation, a.is_show, a.aliases,
    coalesce(c.cnt, 0) as song_count
  from public.artists a
  left join counts c on c.artist_id = a.id
  where a.is_show is not false
  order by
    case when a.sort > 0 then 0 else 1 end,
    case when a.sort > 0 then a.sort end nulls last,
    coalesce(c.cnt, 0) desc,
    a.name asc
  limit coalesce(limit_count, 6)
$function$;

-- ═══ 艺术家类型重算（双源：中间表 ∪ 旧列；B 段简化为单源）═══
CREATE OR REPLACE FUNCTION public.recompute_artist_types(p_artist_ids text[] DEFAULT NULL::text[])
RETURNS void
LANGUAGE plpgsql
AS $function$
begin
  update public.artists a
  set types = (
    select coalesce(array_agg(distinct role), '{}'::text[])
    from (
      -- 新源：歌曲贡献中间表
      select sc.role
      from public.song_contributors sc
      where sc.artist_id = a.id
      union
      -- 新源：专辑贡献 → singer
      select 'singer'
      where exists (select 1 from public.album_contributors ac where ac.artist_id = a.id)
      union
      -- 旧源（过渡期）：数组与逗号串
      select 'singer'
      where exists (select 1 from public.songs s where a.id = any(s.artist_ids))
         or exists (select 1 from public.albums al where a.id = any(al.artist_ids))
      union
      select 'lyricist'
      where exists (
        select 1 from public.songs s
        where a.id = any(string_to_array(coalesce(s.lyricist, ','), ','))
      )
      union
      select 'composer'
      where exists (
        select 1 from public.songs s
        where a.id = any(string_to_array(coalesce(s.composer, ','), ','))
      )
      union
      select 'arranger'
      where exists (
        select 1 from public.songs s
        where a.id = any(string_to_array(coalesce(s.arranger, ','), ','))
      )
    ) r
  )
  where p_artist_ids is null or a.id = any(p_artist_ids);
end
$function$;

-- 通知 PostgREST 重载 schema（识别新函数签名）
NOTIFY pgrst, 'reload schema';

COMMIT;
```

## ⑤ A 段验证（只读）

```sql
-- 1. 行数等式：expected 与 actual 相等，ghosts = 0
WITH exp AS (
  SELECT s.id AS song_id, 'singer' AS role, trim(a) AS artist_id
  FROM public.songs s, unnest(s.artist_ids) a WHERE trim(a) <> ''
  UNION
  SELECT s.id, 'lyricist', trim(x) FROM public.songs s,
    unnest(string_to_array(coalesce(s.lyricist,''), ',')) x WHERE trim(x) <> ''
  UNION
  SELECT s.id, 'composer', trim(x) FROM public.songs s,
    unnest(string_to_array(coalesce(s.composer,''), ',')) x WHERE trim(x) <> ''
  UNION
  SELECT s.id, 'arranger', trim(x) FROM public.songs s,
    unnest(string_to_array(coalesce(s.arranger,''), ',')) x WHERE trim(x) <> ''
)
SELECT
  (SELECT count(*) FROM exp) AS expected_rows,
  (SELECT count(*) FROM public.song_contributors) AS actual_rows,
  (SELECT count(*) FROM public.album_contributors) AS album_rows,
  (SELECT count(*) FROM public.albums al, unnest(al.artist_ids) a WHERE trim(a) <> '') AS album_expected;

-- 2. 类型重算零漂移（双源与旧逻辑应完全一致；有差异会逐行列出）
DO $$
DECLARE
  v_diff int;
  r record;
BEGIN
  CREATE TEMP TABLE _types_snapshot AS SELECT id, types FROM public.artists;
  PERFORM public.recompute_artist_types();
  SELECT count(*) INTO v_diff
  FROM _types_snapshot t JOIN public.artists a ON a.id = t.id
  WHERE t.types IS DISTINCT FROM a.types;
  IF v_diff = 0 THEN
    RAISE NOTICE '✓ 类型重算零变化';
  ELSE
    FOR r IN
      SELECT t.id, a.name, t.types AS before_types, a.types AS after_types
      FROM _types_snapshot t JOIN public.artists a ON a.id = t.id
      WHERE t.types IS DISTINCT FROM a.types
    LOOP
      RAISE NOTICE '⚠ % (%) % -> %', r.id, r.name, r.before_types, r.after_types;
    END LOOP;
  END IF;
  DROP TABLE _types_snapshot;
END $$;

-- 3. 搜索冒烟（结果应与改造前一致，肉眼比对前台搜索）
SELECT count(*) FROM public.search_songs('测试');
SELECT count(*) FROM public.search_songs_structured(p_title := 'a', p_artist := null);
SELECT count(*) FROM public.get_top_artists(6);

-- 4. RESTRICT 兜底验证：删除被引用的艺术家应被拒绝（选一位确定有歌曲的）
-- 期望报错：update or delete on table "artists" violates foreign key constraint ... RESTRICT
DELETE FROM public.artists WHERE id = (
  SELECT artist_id FROM public.song_contributors LIMIT 1
);

-- 5. anon 只读验证：song_contributors 无 anon INSERT/UPDATE/DELETE 权限
SELECT table_name, privilege_type FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND grantee = 'anon'
  AND table_name IN ('song_contributors', 'album_contributors');
-- 预期：仅两行 SELECT
```

**应用层验证**（`npm run dev`，A 段后旧代码应完全正常）：
1. 前台搜索（模糊 + 结构化）、首页热门艺术家、艺术家页、歌曲页署名 全部与改造前一致
2. 后台发布一首测试投稿 → 搜索能找到（双源命中旧列）→ **测试完用「撤回」回收**

---

# ═══════════ B 段执行手册（一步步执行）═══════════

> 前提：代码批次 1~4 已全部部署（含配套改动：投稿停写裸键、后台/仪表盘列表改读 artists 数组、Worker 已切中间表）。
> 规则：每步执行完对照「通过标准」，全绿再进下一步；任何一步报错 → 停下，把报错或查询结果发给 AI，不要继续。
>
> ⚠️ **顺序说明**：原方案的 ⑦（删旧列）和 ⑧（RPC 单源化）已合并为**步骤 2 的单个事务**。
> 原因：双源 RPC 读旧列，新单源 RPC 的列清单又必须匹配删列后的表结构——拆开执行无论谁先谁后，
> 中间窗口期前台搜索都会 500。同一事务内原子生效，无窗口。

## 总览

| 步 | 内容 | 性质 | 状态 |
|---|---|---|---|
| 0 | 前置确认 + 备份旧列 | 只读 / 建备份表 | ☐ |
| 1 | ⑥ 补迁移 + 行数等式 | 幂等，可重跑 | ☐ |
| 2 | ⑧+⑦ 合并事务：RPC 单源化 + 删旧列 | 单事务原子生效 | ☐ |
| 3 | ⑨ song_data 五支规范化 | 幂等，可重跑 | ☐ |
| 4 | 应用层验收 | 只读 | ☐ |

## 步骤 0：前置确认 + 备份

**0a. 确认新代码已部署**（否则后面全白做）：

- 管理后台 → 投稿管理：列表「歌手」列有名字（新代码读 artists 数组）
- 管理后台 → 新增/编辑歌曲：读写正常（走 song_contributors 中间表）

**0b. 检查是否有视图依赖旧列**（应返回 0 行；有行 → 停下发给 AI）：

```sql
SELECT viewname FROM pg_views
WHERE schemaname = 'public' AND definition ILIKE '%artist_ids%';
```

**0c. 备份旧列**（删列兜底，出问题可从备份表恢复）：

```sql
CREATE TABLE IF NOT EXISTS public._backup_p2_songs_contribs AS
  SELECT id, artist_ids, lyricist, composer, arranger FROM public.songs;
CREATE TABLE IF NOT EXISTS public._backup_p2_albums_contribs AS
  SELECT id, artist_ids FROM public.albums;
-- 备份表也吃 Supabase 默认授权的坑：建完立刻收 anon 权限
REVOKE ALL ON public._backup_p2_songs_contribs, public._backup_p2_albums_contribs FROM anon;
```

## 步骤 1：⑥ 补迁移（过渡期旧代码可能写入了旧列，把尾巴补进中间表）

**1a. 五段 INSERT**（幂等，直接执行）：

```sql
-- 歌手：songs.artist_ids → role='singer'
INSERT INTO public.song_contributors (song_id, artist_id, role)
SELECT s.id, trim(a), 'singer'
FROM public.songs s, unnest(s.artist_ids) AS a
WHERE trim(a) <> ''
  AND EXISTS (SELECT 1 FROM public.artists ar WHERE ar.id = trim(a))
ON CONFLICT (song_id, artist_id, role) DO NOTHING;

-- 作词
INSERT INTO public.song_contributors (song_id, artist_id, role)
SELECT s.id, trim(x), 'lyricist'
FROM public.songs s, unnest(string_to_array(coalesce(s.lyricist, ''), ',')) AS x
WHERE trim(x) <> ''
  AND EXISTS (SELECT 1 FROM public.artists ar WHERE ar.id = trim(x))
ON CONFLICT (song_id, artist_id, role) DO NOTHING;

-- 作曲
INSERT INTO public.song_contributors (song_id, artist_id, role)
SELECT s.id, trim(x), 'composer'
FROM public.songs s, unnest(string_to_array(coalesce(s.composer, ''), ',')) AS x
WHERE trim(x) <> ''
  AND EXISTS (SELECT 1 FROM public.artists ar WHERE ar.id = trim(x))
ON CONFLICT (song_id, artist_id, role) DO NOTHING;

-- 编曲
INSERT INTO public.song_contributors (song_id, artist_id, role)
SELECT s.id, trim(x), 'arranger'
FROM public.songs s, unnest(string_to_array(coalesce(s.arranger, ''), ',')) AS x
WHERE trim(x) <> ''
  AND EXISTS (SELECT 1 FROM public.artists ar WHERE ar.id = trim(x))
ON CONFLICT (song_id, artist_id, role) DO NOTHING;

-- 专辑艺术家：albums.artist_ids → album_contributors
INSERT INTO public.album_contributors (album_id, artist_id)
SELECT al.id, trim(a)
FROM public.albums al, unnest(al.artist_ids) AS a
WHERE trim(a) <> ''
  AND EXISTS (SELECT 1 FROM public.artists ar WHERE ar.id = trim(a))
ON CONFLICT (album_id, artist_id) DO NOTHING;
```

**1b. 行数等式**：

```sql
WITH exp AS (
  SELECT s.id AS song_id, 'singer' AS role, trim(a) AS artist_id
  FROM public.songs s, unnest(s.artist_ids) a WHERE trim(a) <> ''
  UNION
  SELECT s.id, 'lyricist', trim(x) FROM public.songs s,
    unnest(string_to_array(coalesce(s.lyricist,''), ',')) x WHERE trim(x) <> ''
  UNION
  SELECT s.id, 'composer', trim(x) FROM public.songs s,
    unnest(string_to_array(coalesce(s.composer,''), ',')) x WHERE trim(x) <> ''
  UNION
  SELECT s.id, 'arranger', trim(x) FROM public.songs s,
    unnest(string_to_array(coalesce(s.arranger,''), ',')) x WHERE trim(x) <> ''
)
SELECT
  (SELECT count(*) FROM exp) AS expected_rows,
  (SELECT count(*) FROM public.song_contributors) AS actual_rows,
  (SELECT count(*) FROM public.album_contributors) AS album_rows,
  (SELECT count(*) FROM public.albums al, unnest(al.artist_ids) a WHERE trim(a) <> '') AS album_expected;
```

**通过标准**：
- **缺失 = 0**（旧列有、中间表没有 —— 真正丢数据的方向，必须为 0）：

```sql
WITH exp AS (
  SELECT s.id AS song_id, 'singer' AS role, trim(a) AS artist_id
  FROM public.songs s, unnest(s.artist_ids) a WHERE trim(a) <> ''
  UNION
  SELECT s.id, 'lyricist', trim(x) FROM public.songs s,
    unnest(string_to_array(coalesce(s.lyricist,''), ',')) x WHERE trim(x) <> ''
  UNION
  SELECT s.id, 'composer', trim(x) FROM public.songs s,
    unnest(string_to_array(coalesce(s.composer,''), ',')) x WHERE trim(x) <> ''
  UNION
  SELECT s.id, 'arranger', trim(x) FROM public.songs s,
    unnest(string_to_array(coalesce(s.arranger,''), ',')) x WHERE trim(x) <> ''
)
SELECT count(*) AS missing_rows FROM exp e
WHERE NOT EXISTS (
  SELECT 1 FROM public.song_contributors sc
  WHERE sc.song_id = e.song_id AND sc.role = e.role AND sc.artist_id = e.artist_id
);
```

- **album_expected == album_rows**。
- actual **≥** expected 属正常（过渡期新代码发布的歌只写中间表，不计入 expected）；多出的行用下方 diff 确认来源即可：

```sql
-- 列出中间表比旧列多出的行（应全部来自近期新代码发布的歌）
WITH exp AS (
  SELECT s.id AS song_id, 'singer' AS role, trim(a) AS artist_id
  FROM public.songs s, unnest(s.artist_ids) a WHERE trim(a) <> ''
  UNION
  SELECT s.id, 'lyricist', trim(x) FROM public.songs s,
    unnest(string_to_array(coalesce(s.lyricist,''), ',')) x WHERE trim(x) <> ''
  UNION
  SELECT s.id, 'composer', trim(x) FROM public.songs s,
    unnest(string_to_array(coalesce(s.composer,''), ',')) x WHERE trim(x) <> ''
  UNION
  SELECT s.id, 'arranger', trim(x) FROM public.songs s,
    unnest(string_to_array(coalesce(s.arranger,''), ',')) x WHERE trim(x) <> ''
)
SELECT sc.song_id, sc.role, sc.artist_id, s.title, s.created_at
FROM public.song_contributors sc
LEFT JOIN public.songs s ON s.id = sc.song_id
WHERE NOT EXISTS (
  SELECT 1 FROM exp e
  WHERE e.song_id = sc.song_id AND e.role = sc.role AND e.artist_id = sc.artist_id
);
```

## 步骤 2：⑧+⑦ 合并事务（RPC 单源化 + 删旧列，整段一次执行）

> 整段复制执行；事务内任一语句失败全部回滚，不留中间态。

```sql
BEGIN;

-- ⑦ 删旧列（备份表见步骤 0c；删列放事务最前，下面重建的函数列清单按删列后结构写）
ALTER TABLE public.songs
  DROP COLUMN IF EXISTS artist_ids,
  DROP COLUMN IF EXISTS lyricist,
  DROP COLUMN IF EXISTS composer,
  DROP COLUMN IF EXISTS arranger;

ALTER TABLE public.albums DROP COLUMN IF EXISTS artist_ids;

-- ⑧ RPC 单源化（旧列已删，双源 UNION 全部撤掉）
DROP FUNCTION IF EXISTS public.song_performer_ids(text) CASCADE;
DROP FUNCTION IF EXISTS public.song_artist_ids(text) CASCADE;
DROP FUNCTION IF EXISTS public.search_songs(text) CASCADE;
DROP FUNCTION IF EXISTS public.search_songs_structured(text, text) CASCADE;
DROP FUNCTION IF EXISTS public.get_top_artists(integer) CASCADE;
DROP FUNCTION IF EXISTS public.recompute_artist_types(text[]) CASCADE;
DROP FUNCTION IF EXISTS public.search_albums_structured(text, text) CASCADE;

-- 辅助：单源化（只查中间表）
CREATE OR REPLACE FUNCTION public.song_performer_ids(p_song_id text)
RETURNS text[]
LANGUAGE sql STABLE
AS $function$
  select coalesce(array_agg(distinct a), '{}'::text[])
  from (
    select sc.artist_id as a
    from public.song_contributors sc
    where sc.song_id = p_song_id and sc.role = 'singer'
  ) x
  where a is not null and a <> ''
$function$;

CREATE OR REPLACE FUNCTION public.song_artist_ids(p_song_id text)
RETURNS text[]
LANGUAGE sql STABLE
AS $function$
  select coalesce(array_agg(distinct a), '{}'::text[])
  from (
    select sc.artist_id as a from public.song_contributors sc where sc.song_id = p_song_id
  ) x
  where a is not null and a <> ''
$function$;

-- performer_hit / song_artist_hit / song_token_weight / struct_hit
-- （签名与 ④ 相同，无需重建——它们经辅助函数自动单源化）

-- 模糊搜索：列清单去掉已删的 artist_ids / lyricist / composer / arranger
CREATE OR REPLACE FUNCTION public.search_songs(p_q text)
RETURNS SETOF songs
LANGUAGE plpgsql
STABLE
AS $function$
      declare
        tokens text[] := array(
          select t from regexp_split_to_table(trim(coalesce(p_q, '')), '\s+') t where t <> ''
        );
      begin
        if cardinality(tokens) = 0 then
          return;
        end if;

        return query
        select id, title, album_id, duration, lrc_text, status, created_at, track, contributor_id, lyrics_text, video_url, description, is_hidden, null::text as unlock_code, genres, disc, cover, aliases
        from public.songs s
        where s.status = 'published'
          and not exists (
            select 1 from unnest(tokens) tok
            where not (
                 song_title_hit(s.title, s.aliases, tok)
              or song_artist_hit(s.id, tok)
            )
          )
        order by
          struct_hit(s.id, s.title, s.aliases, tokens) desc,
          (
            select coalesce(sum(song_token_weight(s.id, s.title, s.aliases, tok)), 0)
            from unnest(tokens) tok
          ) desc,
          s.title asc;
      end
$function$;

-- 结构化搜索：同理去列
CREATE OR REPLACE FUNCTION public.search_songs_structured(p_title text DEFAULT NULL, p_artist text DEFAULT NULL)
RETURNS SETOF songs
LANGUAGE sql STABLE
AS $function$
      select id, title, album_id, duration, lrc_text, status, created_at, track, contributor_id, lyrics_text, video_url, description, is_hidden, null::text as unlock_code, genres, disc, cover, aliases
      from public.songs s
      where s.status = 'published'
        and (
          p_title is null
          or s.title ilike '%' || p_title || '%'
          or exists (select 1 from unnest(coalesce(s.aliases, '{}')) a where a ilike '%' || p_title || '%')
        )
        and (
          p_artist is null
          or exists (
            select 1
            from public.artists ar
            where ar.is_show is not false
              and ar.id = any(public.song_performer_ids(s.id))
              and (
                ar.name ilike '%' || p_artist || '%'
                or exists (select 1 from unnest(coalesce(ar.aliases, '{}')) al where al ilike '%' || p_artist || '%')
              )
          )
        )
      order by s.title asc
$function$;

-- 首页热门：单源
CREATE OR REPLACE FUNCTION public.get_top_artists(limit_count integer DEFAULT 6)
RETURNS TABLE(id text, name text, sort integer, avatar text, types text[], disambiguation text, is_show boolean, aliases text[], song_count integer)
LANGUAGE sql STABLE
AS $function$
  with counts as (
    select sc.artist_id, count(*) as cnt
    from public.song_contributors sc
    join public.songs s on s.id = sc.song_id and s.status = 'published'
    group by sc.artist_id
  )
  select
    a.id, a.name, a.sort, a.avatar, a.types, a.disambiguation, a.is_show, a.aliases,
    coalesce(c.cnt, 0) as song_count
  from public.artists a
  left join counts c on c.artist_id = a.id
  where a.is_show is not false
  order by
    case when a.sort > 0 then 0 else 1 end,
    case when a.sort > 0 then a.sort end nulls last,
    coalesce(c.cnt, 0) desc,
    a.name asc
  limit coalesce(limit_count, 6)
$function$;

-- 类型重算：单源
CREATE OR REPLACE FUNCTION public.recompute_artist_types(p_artist_ids text[] DEFAULT NULL::text[])
RETURNS void
LANGUAGE plpgsql
AS $function$
begin
  update public.artists a
  set types = (
    select coalesce(array_agg(distinct role), '{}'::text[])
    from (
      select sc.role from public.song_contributors sc where sc.artist_id = a.id
      union
      select 'singer' where exists (select 1 from public.album_contributors ac where ac.artist_id = a.id)
    ) r
  )
  where p_artist_ids is null or a.id = any(p_artist_ids);
end
$function$;

-- 专辑结构化搜索：artist_ids 列已删，改走 album_contributors
CREATE OR REPLACE FUNCTION public.search_albums_structured(p_name text DEFAULT NULL, p_artist text DEFAULT NULL)
RETURNS SETOF albums
LANGUAGE sql STABLE
AS $function$
  select al.id, al.name, al.year, al.cover, al.created_at, al.initial, al.description
  from public.albums al
  where (
    p_name is null
    or al.name ilike '%' || p_name || '%'
  )
  and (
    p_artist is null
    or exists (
      select 1
      from public.album_contributors ac
      join public.artists ar on ar.id = ac.artist_id
      where ac.album_id = al.id
        and ar.is_show is not false
        and (
          ar.name ilike '%' || p_artist || '%'
          or exists (select 1 from unnest(coalesce(ar.aliases, '{}')) al2 where al2 ilike '%' || p_artist || '%')
        )
    )
  )
  order by al.name asc
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

**步骤 2 通过标准**（COMMIT 成功后执行）：

```sql
-- 1) 旧列已不存在（应返回 0 行）
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name IN ('songs', 'albums')
  AND column_name IN ('artist_ids', 'lyricist', 'composer', 'arranger');

-- 2) RPC 冒烟（四条都应正常返回数字，不报错）
SELECT count(*) FROM public.search_songs('测试');
SELECT count(*) FROM public.search_songs_structured(p_title := 'a', p_artist := null);
SELECT count(*) FROM public.get_top_artists(6);
SELECT count(*) FROM public.search_albums_structured(p_name := 'a', p_artist := null);
```

## 步骤 3：⑨ song_data 规范化（裸键 → 数组键）

> 消灭双键漂移：v2 老投稿的 `lyricist`/`composer`/`arranger`/`artist`/`album_artist` 裸键（拼接字符串）
> 转为审核端唯一读取的数组格式（`lyricist_arr`/`composer_arr`/`arranger_arr`/`artists`/`album_artists`），
> 转完删除裸键。
>
> 裸键内容自动判别：形如 `art_xxx` 且库内存在的按 ID 直接绑回（带 id + 换算名），
> 否则按名字处理（`id: null`，进入审核时按名自动绑定流程）。
> 分隔符兼容 `,`（v2 旧格式）和 ` / `（批次 1 之前新代码的兼容写入）。
>
> 前置条件已在步骤 0 确认：投稿端已停写裸键、后台列表已改读 artists 数组。

**3a. 执行前检查**（看存量分布，各行即待补行数）：

```sql
SELECT
  count(*) FILTER (WHERE song_data ? 'lyricist'     AND NOT song_data ? 'lyricist_arr')  AS need_lyricist,
  count(*) FILTER (WHERE song_data ? 'composer'     AND NOT song_data ? 'composer_arr')  AS need_composer,
  count(*) FILTER (WHERE song_data ? 'arranger'     AND NOT song_data ? 'arranger_arr')  AS need_arranger,
  count(*) FILTER (WHERE song_data ? 'artist'       AND NOT song_data ? 'artists')       AS need_artist,
  count(*) FILTER (WHERE song_data ? 'album_artist' AND NOT song_data ? 'album_artists') AS need_album_artist,
  count(*) AS total
FROM public.submissions
WHERE song_data ? 'title' AND song_data->>'type' IS DISTINCT FROM 'profile';
```

**五支规范化 UPDATE**（每支独立幂等：数组键已存在的行跳过）：

```sql
BEGIN;

-- ── 作词：lyricist → lyricist_arr ──
UPDATE public.submissions s
SET song_data = jsonb_set(s.song_data, '{lyricist_arr}', (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',   CASE WHEN trim(x) ~ '^art_[a-z0-9_]+$' AND EXISTS (SELECT 1 FROM public.artists ar WHERE ar.id = trim(x))
                 THEN trim(x) ELSE NULL END,
    'name', CASE WHEN trim(x) ~ '^art_[a-z0-9_]+$'
                 THEN coalesce((SELECT name FROM public.artists ar WHERE ar.id = trim(x)), trim(x))
                 ELSE trim(x) END
  ) ORDER BY ord), '[]'::jsonb)
  FROM unnest(regexp_split_to_array(coalesce(s.song_data->>'lyricist', ''), '\s*,\s*|\s+/\s*'))
       WITH ORDINALITY AS u(x, ord)
  WHERE trim(x) <> ''
)) - 'lyricist'
WHERE s.song_data ? 'lyricist' AND NOT s.song_data ? 'lyricist_arr'
  AND s.song_data->>'type' IS DISTINCT FROM 'profile';

-- ── 作曲：composer → composer_arr ──
UPDATE public.submissions s
SET song_data = jsonb_set(s.song_data, '{composer_arr}', (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',   CASE WHEN trim(x) ~ '^art_[a-z0-9_]+$' AND EXISTS (SELECT 1 FROM public.artists ar WHERE ar.id = trim(x))
                 THEN trim(x) ELSE NULL END,
    'name', CASE WHEN trim(x) ~ '^art_[a-z0-9_]+$'
                 THEN coalesce((SELECT name FROM public.artists ar WHERE ar.id = trim(x)), trim(x))
                 ELSE trim(x) END
  ) ORDER BY ord), '[]'::jsonb)
  FROM unnest(regexp_split_to_array(coalesce(s.song_data->>'composer', ''), '\s*,\s*|\s+/\s*'))
       WITH ORDINALITY AS u(x, ord)
  WHERE trim(x) <> ''
)) - 'composer'
WHERE s.song_data ? 'composer' AND NOT s.song_data ? 'composer_arr'
  AND s.song_data->>'type' IS DISTINCT FROM 'profile';

-- ── 编曲：arranger → arranger_arr ──
UPDATE public.submissions s
SET song_data = jsonb_set(s.song_data, '{arranger_arr}', (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',   CASE WHEN trim(x) ~ '^art_[a-z0-9_]+$' AND EXISTS (SELECT 1 FROM public.artists ar WHERE ar.id = trim(x))
                 THEN trim(x) ELSE NULL END,
    'name', CASE WHEN trim(x) ~ '^art_[a-z0-9_]+$'
                 THEN coalesce((SELECT name FROM public.artists ar WHERE ar.id = trim(x)), trim(x))
                 ELSE trim(x) END
  ) ORDER BY ord), '[]'::jsonb)
  FROM unnest(regexp_split_to_array(coalesce(s.song_data->>'arranger', ''), '\s*,\s*|\s+/\s*'))
       WITH ORDINALITY AS u(x, ord)
  WHERE trim(x) <> ''
)) - 'arranger'
WHERE s.song_data ? 'arranger' AND NOT s.song_data ? 'arranger_arr'
  AND s.song_data->>'type' IS DISTINCT FROM 'profile';

-- ── 歌手：artist → artists ──
UPDATE public.submissions s
SET song_data = jsonb_set(s.song_data, '{artists}', (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',   CASE WHEN trim(x) ~ '^art_[a-z0-9_]+$' AND EXISTS (SELECT 1 FROM public.artists ar WHERE ar.id = trim(x))
                 THEN trim(x) ELSE NULL END,
    'name', CASE WHEN trim(x) ~ '^art_[a-z0-9_]+$'
                 THEN coalesce((SELECT name FROM public.artists ar WHERE ar.id = trim(x)), trim(x))
                 ELSE trim(x) END
  ) ORDER BY ord), '[]'::jsonb)
  FROM unnest(regexp_split_to_array(coalesce(s.song_data->>'artist', ''), '\s*,\s*|\s+/\s*'))
       WITH ORDINALITY AS u(x, ord)
  WHERE trim(x) <> ''
)) - 'artist'
WHERE s.song_data ? 'artist' AND NOT s.song_data ? 'artists'
  AND s.song_data->>'type' IS DISTINCT FROM 'profile';

-- ── 专辑艺术家：album_artist → album_artists ──
UPDATE public.submissions s
SET song_data = jsonb_set(s.song_data, '{album_artists}', (
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id',   CASE WHEN trim(x) ~ '^art_[a-z0-9_]+$' AND EXISTS (SELECT 1 FROM public.artists ar WHERE ar.id = trim(x))
                 THEN trim(x) ELSE NULL END,
    'name', CASE WHEN trim(x) ~ '^art_[a-z0-9_]+$'
                 THEN coalesce((SELECT name FROM public.artists ar WHERE ar.id = trim(x)), trim(x))
                 ELSE trim(x) END
  ) ORDER BY ord), '[]'::jsonb)
  FROM unnest(regexp_split_to_array(coalesce(s.song_data->>'album_artist', ''), '\s*,\s*|\s+/\s*'))
       WITH ORDINALITY AS u(x, ord)
  WHERE trim(x) <> ''
)) - 'album_artist'
WHERE s.song_data ? 'album_artist' AND NOT s.song_data ? 'album_artists'
  AND s.song_data->>'type' IS DISTINCT FROM 'profile';

COMMIT;
```

**3c. 执行后验证**（五列应全为 0）：

```sql
SELECT
  count(*) FILTER (WHERE song_data ? 'lyricist')     AS raw_lyricist,
  count(*) FILTER (WHERE song_data ? 'composer')     AS raw_composer,
  count(*) FILTER (WHERE song_data ? 'arranger')     AS raw_arranger,
  count(*) FILTER (WHERE song_data ? 'artist')       AS raw_artist,
  count(*) FILTER (WHERE song_data ? 'album_artist') AS raw_album_artist
FROM public.submissions
WHERE song_data->>'type' IS DISTINCT FROM 'profile';
```

**3d. 双键共存清理**（3c 有非 0 列时执行：数组键已存在的行删裸键残留）：

> 批次 1 之前的代码双写（数组键 + 兼容裸键），3b 只补「缺数组键」的行、不碰双键行。
> 双键行的数组键是权威数据（用户实际选择），裸键直接删。

```sql
BEGIN;

UPDATE public.submissions SET song_data = song_data - 'lyricist'
WHERE song_data ? 'lyricist' AND song_data ? 'lyricist_arr'
  AND song_data->>'type' IS DISTINCT FROM 'profile';

UPDATE public.submissions SET song_data = song_data - 'composer'
WHERE song_data ? 'composer' AND song_data ? 'composer_arr'
  AND song_data->>'type' IS DISTINCT FROM 'profile';

UPDATE public.submissions SET song_data = song_data - 'arranger'
WHERE song_data ? 'arranger' AND song_data ? 'arranger_arr'
  AND song_data->>'type' IS DISTINCT FROM 'profile';

UPDATE public.submissions SET song_data = song_data - 'artist'
WHERE song_data ? 'artist' AND song_data ? 'artists'
  AND song_data->>'type' IS DISTINCT FROM 'profile';

UPDATE public.submissions SET song_data = song_data - 'album_artist'
WHERE song_data ? 'album_artist' AND song_data ? 'album_artists'
  AND song_data->>'type' IS DISTINCT FROM 'profile';

COMMIT;
```

清完重跑 3c，五列全 0 = 步骤 3 通过。

**已知取舍**：艺名本身含 `,` 或 `/` 会被误拆（历史上 A/B 艺名问题，无法完美判别，误拆的审核时人工纠正）。
状态非 pending 的存量投稿也一并规范化（历史数据统一格式，无副作用）。

## 步骤 4：应用层验收（全绿 = B 段完成）

1. **前台**（lrcshare.com）：搜索（模糊 + 结构化）结果正常；首页热门艺术家正常；专辑页按艺术家筛选正常
2. **管理后台**：
   - 投稿管理：列表「歌手」列有名字；打开一首 v2 老投稿的审核弹窗，作词/作曲/编曲/专辑艺术家正常显示
   - 新增/编辑歌曲：艺术家选择、保存正常
3. **Worker API**：
   - `https://api.lrcshare.com/v1/search?keyword=任意词` 正常返回（注意参数名是 `keyword` 不是 `q`）
   - 任一 `/v1/song/:id` 详情：`lyricist`/`composer`/`arranger` 名字数组正常
4. **收尾**（可选，修正历史类型脏数据）：`SELECT public.recompute_artist_types();`
5. **验收通过一周后**：删除备份表 `_backup_p2_songs_contribs` / `_backup_p2_albums_contribs`

---

## A 段执行记录

| 节 | 结果 | 备注 |
|---|---|---|
| ① 建表 | ☑ 通过 | |
| ② RLS/授权 | ☑ 通过 | |
| ③ 迁移 | ☑ 通过 | |
| ④ RPC 双源 | ☑ 通过 | |
| ⑤ 验证 | ☑ 通过 | |

## B 段执行记录

| 步 | 结果 | 备注 |
|---|---|---|
| 0 前置确认 + 备份 | ☑ 通过 | 视图依赖检查 = 0 行 |
| 1 ⑥ 补迁移 | ☑ 通过 | expected=2745 actual=2746（多 1 行为新链路发布歌曲 Intro，缺失=0）/ album 370=370 |
| 2 ⑧+⑦ 单源化 + 删列 | ☑ 通过 | 冒烟四条正常；Worker 需重部署后 API 恢复 |
| 3 ⑨ song_data 规范化 | ☑ 通过 | 3a 待补 arranger=4（其余 0）→ 3b 补齐 → 3c 双键残留（51/51/21/51/51）→ 3d 清理 → 全 0 |
| 4 应用层验收 | ☑ 通过 | 前台/后台/Worker API 正常；recompute_artist_types 已执行 |
