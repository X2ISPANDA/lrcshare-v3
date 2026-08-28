# 阶段三：口令拆表 song_secrets（phase3-song-secrets）

> 依据：`sql/数据库重构总方案.md` 阶段三。
> 执行日期：____（执行后填写）
>
> **消灭整条补丁链**：列级授权脚本（revoke-unlock-code-column.md）、RPC 里 `null::text as unlock_code` 补丁、
> "禁止 SELECT *"纪律、专项越权回归——口令拆去独立表后全部作废归档。
> 安全模型从 "default-open + 处处设卡" 变为 "default-closed + 一个正门"：
> anon 对 song_secrets 零授权零策略（默认拒绝），唯一读口令入口是 `verify_hidden_unlock_code` RPC（SECURITY DEFINER）。
>
> 分三步，中间夹一次代码部署（同 phase2 的 A/B 模式，但轻得多）：
>
> | 步 | 内容 | 执行时机 |
> |---|---|---|
> | **步骤 1** | 建 song_secrets + 迁移 + **紧急修复 get_artist_songs** | **现在执行** |
> | （代码） | 后台口令编辑切 song_secrets（过渡期双写） | 步骤 1 通过后 AI 改代码，你部署 |
> | **步骤 3** | 删 songs.unlock_code + verify/search RPC 收尾 | ⛔ 代码部署验证后再执行 |
>
> ⚠️ **步骤 1 含紧急修复**：phase2 B 段删旧列后，`get_artist_songs`（前台艺术家作品页）的函数体
> 仍在 select 已删除的 `s.artist_ids / s.lyricist / s.composer / s.arranger`——B 段冒烟四条没覆盖它，
> 艺术家作品页当前处于运行时报错状态。步骤 1 一并重写为单源版。

## 步骤 1：建表 + 迁移 + 修复 get_artist_songs（现在执行）

```sql
BEGIN;

-- ── 1a. 建表 ──
CREATE TABLE IF NOT EXISTS public.song_secrets (
  song_id     text PRIMARY KEY REFERENCES public.songs(id) ON DELETE CASCADE,
  unlock_code text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ⚠️ Supabase 默认权限坑（同 phase2 ②）：新建表自动给 anon/authenticated 授 ALL
REVOKE ALL ON public.song_secrets FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.song_secrets TO authenticated;

-- RLS：开即可，不给 anon 任何策略（默认拒绝）；authenticated 走显式策略
ALTER TABLE public.song_secrets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "口令：管理员可读" ON public.song_secrets
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "口令：管理员可增" ON public.song_secrets
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "口令：管理员可改" ON public.song_secrets
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "口令：管理员可删" ON public.song_secrets
  FOR DELETE TO authenticated USING (true);

-- ── 1b. 迁移：非空口令入表（空口令 = 用全局口令，无需行）──
INSERT INTO public.song_secrets (song_id, unlock_code)
SELECT s.id, s.unlock_code
FROM public.songs s
WHERE coalesce(s.unlock_code, '') <> ''
ON CONFLICT (song_id) DO NOTHING;

-- ── 1c. 紧急修复：get_artist_songs 单源重写（输出形状不变，前端零感知）──
DROP FUNCTION IF EXISTS public.get_artist_songs(text);
CREATE FUNCTION public.get_artist_songs(p_artist_id text)
RETURNS TABLE (
  id           text,
  title        text,
  aliases      text[],
  artist_ids   text[],
  album_id     text,
  lyricist     text,
  composer     text,
  arranger     text,
  duration     text,
  track        integer,
  disc         integer,
  status       text,
  is_hidden    boolean,
  description  text,
  genres       text[],
  lrc_text     text,
  lyrics_text  text,
  video_url    text,
  cover        text,
  contributor_id text,
  created_at   timestamptz,
  albums       jsonb,
  roles        text[]
)
LANGUAGE sql STABLE
SET search_path = public
AS $function$
  select s.id, s.title, s.aliases,
         -- 单源：歌手数组（按关系行 id 保序，即迁移时的原数组顺序）
         coalesce((select array_agg(sc.artist_id order by sc.id)
                   from public.song_contributors sc
                   where sc.song_id = s.id and sc.role = 'singer'), '{}') as artist_ids,
         s.album_id,
         -- 词/曲/编：中间表拼回逗号串（保持旧输出形状，前端兼容）
         coalesce((select string_agg(sc.artist_id, ',')
                   from public.song_contributors sc
                   where sc.song_id = s.id and sc.role = 'lyricist'), '') as lyricist,
         coalesce((select string_agg(sc.artist_id, ',')
                   from public.song_contributors sc
                   where sc.song_id = s.id and sc.role = 'composer'), '') as composer,
         coalesce((select string_agg(sc.artist_id, ',')
                   from public.song_contributors sc
                   where sc.song_id = s.id and sc.role = 'arranger'), '') as arranger,
         s.duration, s.track, s.disc, s.status, s.is_hidden, s.description, s.genres,
         s.lrc_text, s.lyrics_text, s.video_url, s.cover, s.contributor_id, s.created_at,
         to_jsonb(al) as albums,
         -- 该艺术家在这首歌担任的角色（单源：中间表）
         coalesce((select array_agg(distinct sc.role)
                   from public.song_contributors sc
                   where sc.song_id = s.id and sc.artist_id = p_artist_id), '{}') as roles
  from public.songs s
  left join public.albums al on al.id = s.album_id
  where s.status = 'published'
    and exists (select 1 from public.song_contributors sc
                where sc.song_id = s.id and sc.artist_id = p_artist_id)
  order by s.created_at desc
$function$;

GRANT EXECUTE ON FUNCTION public.get_artist_songs(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

**步骤 1 通过标准**：

```sql
-- 1) 迁移行数 = songs 内非空口令数（两数相等）
SELECT
  (SELECT count(*) FROM public.song_secrets) AS secrets_rows,
  (SELECT count(*) FROM public.songs WHERE coalesce(unlock_code, '') <> '') AS songs_with_code;

-- 2) get_artist_songs 修复冒烟（返回数字即修复成功；B 段后此处原本报 column does not exist）
SELECT count(*) FROM public.get_artist_songs('art_hotdog');
SELECT id, title, albums->>'name' AS album_name FROM public.get_artist_songs('art_hotdog') LIMIT 3;

-- 3) anon 对 song_secrets 零权限（应返回 0 行）
SELECT privilege_type FROM information_schema.role_table_grants
WHERE table_schema = 'public' AND table_name = 'song_secrets' AND grantee = 'anon';
```

应用层：前台任一艺术家主页作品列表恢复显示（B 段后此处应已报错，修复后正常）。

## （代码：后台口令编辑切 song_secrets）

AI 改，你部署。要点：

- `adminApi` 增加通用 `upsert`
- `SongsView.vue`：加载时拉 song_secrets 装饰歌行（`unlock_code` 改从 secrets 取）；保存时
  songs payload 的 `unlock_code` **保留**（过渡期双写，步骤 3 删列前旧值兜底），同时
  口令非空 → upsert song_secrets，口令清空 → 删对应 secrets 行
- `types.ts` / `api.ts` 注释清理

## 步骤 3：删列 + RPC 收尾（⛔ 代码部署验证后执行）

> 整段一个事务（删列与 search RPC 列清单必须原子生效，同 phase2 B 段步骤 2 的道理：
> 函数 `RETURNS SETOF songs`，删列后列清单必须同步去掉 `null::text as unlock_code`）。

```sql
BEGIN;

-- 3a. 删列（迁移已在步骤 1 完成；列级授权随列一起消失，revoke 脚本从此作废）
ALTER TABLE public.songs DROP COLUMN IF EXISTS unlock_code;

-- 3b. verify RPC 改读 song_secrets（唯一读口令入口；签名不变前端零感知）
DROP FUNCTION IF EXISTS public.verify_hidden_unlock_code(text, text) CASCADE;
CREATE OR REPLACE FUNCTION public.verify_hidden_unlock_code(
  p_song_id text,
  p_code text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_global text;
  v_song text;
begin
  if p_code is null or btrim(p_code) = '' then
    return false;
  end if;

  -- 全局口令（settings 受 RLS 保护，security definer 以函数属主身份读取）
  select s.value into v_global
  from public.settings s
  where s.key = 'hidden_unlock_code';

  if v_global is not null and v_global <> '' and p_code = v_global then
    return true;
  end if;

  -- 歌曲独立口令：只读 song_secrets（anon 对该表零授权，此函数是唯一正门）
  if p_song_id is not null then
    select t.unlock_code into v_song
    from public.song_secrets t
    where t.song_id = p_song_id;

    if v_song is not null and v_song <> '' and p_code = v_song then
      return true;
    end if;
  end if;

  return false;
end;
$$;

REVOKE EXECUTE ON FUNCTION public.verify_hidden_unlock_code(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.verify_hidden_unlock_code(text, text) TO anon, authenticated;

-- 3c. search RPC 列清单去掉 unlock_code 补丁（其余与 phase2 B 段 ⑧ 版本一字不差）
DROP FUNCTION IF EXISTS public.search_songs(text) CASCADE;
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
        select id, title, album_id, duration, lrc_text, status, created_at, track, contributor_id, lyrics_text, video_url, description, is_hidden, genres, disc, cover, aliases
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

DROP FUNCTION IF EXISTS public.search_songs_structured(text, text) CASCADE;
CREATE OR REPLACE FUNCTION public.search_songs_structured(p_title text DEFAULT NULL::text, p_artist text DEFAULT NULL::text)
RETURNS SETOF songs
LANGUAGE sql STABLE
AS $function$
      select id, title, album_id, duration, lrc_text, status, created_at, track, contributor_id, lyrics_text, video_url, description, is_hidden, genres, disc, cover, aliases
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

NOTIFY pgrst, 'reload schema';

COMMIT;
```

**步骤 3 通过标准**：

```sql
-- 1) 列已不存在（0 行）
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'songs' AND column_name = 'unlock_code';

-- 2) 冒烟
SELECT count(*) FROM public.search_songs('测试');
SELECT count(*) FROM public.search_songs_structured(p_title := 'a', p_artist := null);
SELECT public.verify_hidden_unlock_code('不存在的歌曲id', '随便');
-- 预期 false

-- 3) 越权回归：anon 直查 song_secrets 应报权限错误（permission denied）
--    在 SQL Editor 以 postgres 执行看不到该效果，用前台 anon 请求验证即可：
--    supabase.from('song_secrets').select('*') → error
```

应用层验收：
- 前台隐藏歌曲口令解锁正常（全局口令 + 歌曲独立口令各试一次）
- 后台编辑歌曲口令 → 保存 → 前台解锁验证生效；清空口令 → 保存 → 前台该歌独立口令失效（回退全局口令）
- Worker API 正常（select 清单本就不含该列，零感知）

## 收尾归档（步骤 3 通过后）

- `sql/revoke-unlock-code-column.md` 标注「随 v3 拆表作废（2026-08-27 phase3）」
- `sql/search-songs-hardening.md` 的置 null 逻辑标注同上

---

## 步骤 4：口令通行证语义（verify 返回类型 + 独立口令探测）

> 语义：全局口令验证一次 = 会话通行证，对**无独立口令**的隐藏歌处处生效；
> 设了独立口令的歌不认通行证，必须逐首验。verify 改返回命中的口令类型。

```sql
BEGIN;

DROP FUNCTION IF EXISTS public.verify_hidden_unlock_code(text, text) CASCADE;
CREATE OR REPLACE FUNCTION public.verify_hidden_unlock_code(
  p_song_id text,
  p_code text
)
RETURNS text  -- 'global' | 'song' | ''（未命中）
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
declare
  v_global text;
  v_song text;
begin
  if p_code is null or btrim(p_code) = '' then
    return '';
  end if;

  select s.value into v_global
  from public.settings s
  where s.key = 'hidden_unlock_code';

  if v_global is not null and v_global <> '' and p_code = v_global then
    return 'global';
  end if;

  if p_song_id is not null then
    select t.unlock_code into v_song
    from public.song_secrets t
    where t.song_id = p_song_id;

    if v_song is not null and v_song <> '' and p_code = v_song then
      return 'song';
    end if;
  end if;

  return '';
end;
$$;

REVOKE EXECUTE ON FUNCTION public.verify_hidden_unlock_code(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.verify_hidden_unlock_code(text, text) TO anon, authenticated;

-- 该歌是否设了独立口令（不回口令本身；供前端判断全局通行证是否适用）
CREATE OR REPLACE FUNCTION public.song_has_own_code(p_song_id text)
RETURNS boolean
LANGUAGE sql STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  select exists (
    select 1 from public.song_secrets
    where song_id = p_song_id and coalesce(unlock_code, '') <> ''
  )
$$;

REVOKE EXECUTE ON FUNCTION public.song_has_own_code(text) FROM public;
GRANT EXECUTE ON FUNCTION public.song_has_own_code(text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

**通过标准**：

```sql
SELECT public.verify_hidden_unlock_code('不存在的id', 'lrcshare-hidden-2023');  -- 'global'
SELECT public.verify_hidden_unlock_code('不存在的id', '瞎输的');                 -- ''
SELECT public.song_has_own_code('不存在的id');                                  -- false
```

---

## 步骤 5：搜索补专辑艺术家匹配（验证期发现的缺口）

> 问题：keyword / 结构化两条搜索路径都只匹配歌曲级关联（song_contributors），
> 专辑艺术家（album_contributors，TPE2）完全不在范围内。
> 典型场景：音乐文件 TPE1=王波、TPE2=阴三儿IN3，搜「intro 阴三儿in3」0 结果。
> open-api.js 注释的既定语义本就是「演唱者/专辑艺术家」，此处补齐实现。Worker 零改动。

```sql
BEGIN;

-- ① song_artist_ids：补专辑艺术家一路（keyword 搜索 token 命中范围随之扩大）
CREATE OR REPLACE FUNCTION public.song_artist_ids(p_song_id text)
RETURNS text[]
LANGUAGE sql STABLE
AS $function$
  select coalesce(array_agg(distinct a), '{}'::text[])
  from (
    select sc.artist_id as a from public.song_contributors sc where sc.song_id = p_song_id
    union
    select ac.artist_id as a
    from public.album_contributors ac
    join public.songs s on s.album_id = ac.album_id
    where s.id = p_song_id
  ) x
  where a is not null and a <> ''
$function$;

-- ② 结构化搜索 artist：演唱者 ∪ 专辑艺术家（对齐 open-api.js 注释语义）
CREATE OR REPLACE FUNCTION public.search_songs_structured(p_title text DEFAULT NULL::text, p_artist text DEFAULT NULL::text)
RETURNS SETOF songs
LANGUAGE sql STABLE
AS $function$
      select id, title, album_id, duration, lrc_text, status, created_at, track, contributor_id, lyrics_text, video_url, description, is_hidden, genres, disc, cover, aliases
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
              and (
                ar.id = any(public.song_performer_ids(s.id))
                or ar.id in (
                  select ac.artist_id
                  from public.album_contributors ac
                  where ac.album_id = s.album_id
                )
              )
              and (
                ar.name ilike '%' || p_artist || '%'
                or exists (select 1 from unnest(coalesce(ar.aliases, '{}')) al where al ilike '%' || p_artist || '%')
              )
          )
        )
      order by s.title asc
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

**通过标准**（以 Intro / 阴三儿为例）：

```sql
-- keyword：两 token 一个命中歌名、一个命中专辑艺术家 → 应返回 1 行
SELECT id, title FROM public.search_songs('intro 阴三儿in3');

-- 结构化：artist 走专辑艺术家 → 应返回 1 行
SELECT id, title FROM public.search_songs_structured(p_title := 'intro', p_artist := '阴三儿in3');

-- 回归：仅演唱者搜索仍正常（王波是 singer）
SELECT id, title FROM public.search_songs_structured(p_title := 'intro', p_artist := '王波');
```

---

## 步骤 6：keyword 搜索改「至少命中一个 token 即返回」（网易/QQ 式宽松语义）

> 原 AND 语义：一个 token 落空整首淘汰 → 数据关联不全时（如 TPE2 对不上）直接 0 结果。
> 新语义：命中的 token 越多排越前，至少命中 1 个就返回。宁多勿无。
> 权重函数（struct_hit / song_token_weight）保留，从「过滤器」转为「排序器」。

```sql
BEGIN;

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
        select id, title, album_id, duration, lrc_text, status, created_at, track, contributor_id, lyrics_text, video_url, description, is_hidden, genres, disc, cover, aliases
        from public.songs s
        where s.status = 'published'
          -- 宽松语义：至少命中 1 个 token 即入围（命中数参与排序）
          and exists (
            select 1 from unnest(tokens) tok
            where song_title_hit(s.title, s.aliases, tok)
               or song_artist_hit(s.id, tok)
          )
        order by
          -- 命中 token 数：全命中的排最前，部分命中的靠后
          (
            select count(*) from unnest(tokens) tok
            where song_title_hit(s.title, s.aliases, tok)
               or song_artist_hit(s.id, tok)
          ) desc,
          struct_hit(s.id, s.title, s.aliases, tokens) desc,
          (
            select coalesce(sum(song_token_weight(s.id, s.title, s.aliases, tok)), 0)
            from unnest(tokens) tok
          ) desc,
          s.title asc;
      end
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

**通过标准**：

```sql
-- 宽松命中：intro 中歌名，阴三儿in3 什么都不中 → 仍返回（不再 0 结果）
SELECT id, title FROM public.search_songs('intro 阴三儿in3');

-- 全命中排前： Intro 应排第一
SELECT id, title FROM public.search_songs('intro') LIMIT 3;

-- 单 token 行为不变
SELECT count(*) FROM public.search_songs('北京');
```

---

## 步骤 6b：排序强化——整串命中优先于 token 碎片命中

> 步骤 6 的宽松语义引入新问题：查询「No Money No Friend 阴三儿in3」时，
> 英文 token（no/money/friend）会命中大量无关英文歌，且这些歌的 token 命中数
> 与目标歌相同（重复 token 只按去重计数），导致目标歌排不到第一。
> 修法：排序第一优先级改为「整串连续命中」——title/aliases 以**连续子串**形式
> 包含完整查询串（或去掉艺术家 token 后的歌名部分）的排最前，
> token 命中数降为第二优先级。

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.search_songs(p_q text)
RETURNS SETOF songs
LANGUAGE plpgsql
STABLE
AS $function$
      declare
        tokens text[] := array(
          select t from regexp_split_to_table(trim(coalesce(p_q, '')), '\s+') t where t <> ''
        );
        p_lower text := lower(trim(coalesce(p_q, '')));
      begin
        if cardinality(tokens) = 0 then
          return;
        end if;

        return query
        select id, title, album_id, duration, lrc_text, status, created_at, track, contributor_id, lyrics_text, video_url, description, is_hidden, genres, disc, cover, aliases
        from public.songs s
        where s.status = 'published'
          -- 宽松语义：至少命中 1 个 token 即入围
          and exists (
            select 1 from unnest(tokens) tok
            where song_title_hit(s.title, s.aliases, tok)
               or song_artist_hit(s.id, tok)
          )
        order by
          -- ① 整串连续命中（title/aliases 含完整查询串，小写）排绝对第一
          (
            select case when lower(s.title) like '%' || p_lower || '%'
                          or exists (select 1 from unnest(coalesce(s.aliases, '{}')) a
                                     where lower(a) like '%' || p_lower || '%')
                        then 1 else 0 end
          ) desc,
          -- ② token 命中数：全命中的排前，部分命中的靠后
          (
            select count(*) from unnest(tokens) tok
            where song_title_hit(s.title, s.aliases, tok)
               or song_artist_hit(s.id, tok)
          ) desc,
          struct_hit(s.id, s.title, s.aliases, tokens) desc,
          (
            select coalesce(sum(song_token_weight(s.id, s.title, s.aliases, tok)), 0)
            from unnest(tokens) tok
          ) desc,
          s.title asc;
      end
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

**通过标准**：

```sql
-- 目标歌必须排第一（整串「no money no friend」命中其别名）
SELECT id, title FROM public.search_songs('No Money No Friend 阴三儿in3') LIMIT 3;
-- 预期：1. 没钱没朋友  2. 及以后为阴三儿其他歌/英文歌

-- 单 token / 简单查询回归
SELECT id, title FROM public.search_songs('intro 阴三儿in3');
SELECT count(*) FROM public.search_songs('北京');
```

---

## 步骤 6c：修复 PostgREST limit 下推打乱排序（物化子查询）

> 现象：API 走 PostgREST 调 `search_songs` 时，`limit=10` 返回顺序错乱（Intro 第一），
> `limit=5` 正确；直查 SQL 任何 limit 都正确。清缓存无效。
> 根因：PostgREST 把 limit 下推为 `select * from search_songs(...) limit N`，
> 带 select 嵌套 embed 时 planner 对函数扫描套 LIMIT 的方式可能打乱
> plpgsql `return query` 的排序输出（limit 值不同触发不同 plan）。
> 修法：`return query` 改为返回**物化子查询**（`select * from (… order by …) t`），
> 函数输出顺序钉死，外层 limit 变纯分页，怎么切都乱不了序。

```sql
BEGIN;

CREATE OR REPLACE FUNCTION public.search_songs(p_q text)
RETURNS SETOF songs
LANGUAGE plpgsql
STABLE
AS $function$
      declare
        tokens text[] := array(
          select t from regexp_split_to_table(trim(coalesce(p_q, '')), '\s+') t where t <> ''
        );
        p_lower text := lower(trim(coalesce(p_q, '')));
      begin
        if cardinality(tokens) = 0 then
          return;
        end if;

        return query
        select * from (
          select id, title, album_id, duration, lrc_text, status, created_at, track, contributor_id, lyrics_text, video_url, description, is_hidden, genres, disc, cover, aliases
          from public.songs s
          where s.status = 'published'
            -- 宽松语义：至少命中 1 个 token 即入围（命中数参与排序）
            and exists (
              select 1 from unnest(tokens) tok
              where song_title_hit(s.title, s.aliases, tok)
                 or song_artist_hit(s.id, tok)
            )
          order by
            -- ① 整串连续命中（title/aliases 含完整查询串，小写）排绝对第一
            (
              select case when lower(s.title) like '%' || p_lower || '%'
                            or exists (select 1 from unnest(coalesce(s.aliases, '{}')) a
                                       where lower(a) like '%' || p_lower || '%')
                          then 1 else 0 end
            ) desc,
            -- ② token 命中数：全命中的排前，部分命中的靠后
            (
              select count(*) from unnest(tokens) tok
              where song_title_hit(s.title, s.aliases, tok)
                 or song_artist_hit(s.id, tok)
            ) desc,
            struct_hit(s.id, s.title, s.aliases, tokens) desc,
            (
              select coalesce(sum(song_token_weight(s.id, s.title, s.aliases, tok)), 0)
              from unnest(tokens) tok
            ) desc,
            s.title asc
        ) t;
      end
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

**通过标准**（必须带 limit=10 复现原 bug 场景）：

```sql
-- 直查（回归，应不变）
SELECT id, title FROM public.search_songs('No Money No Friend 阴三儿In3') LIMIT 10;

-- API 路径（关键）：浏览器或 curl 访问，可加 &cb=1 穿透缓存
-- https://api.lrcshare.com/v1/search?keyword=No%20Money%20No%20Friend%20%E9%98%B4%E4%B8%89%E5%84%BFIn3&type=song&limit=10&cb=1
-- 预期：第一首 = 没钱没朋友
```

---

## 步骤 6d：token 去重 + 整词/子串权重分档

> 现象：搜「No Money No Friend 阴三儿In3」，大量只含 no 子串的无关英文歌
> （November Rain / NOT ME / How You Like Me Now / …）排在阴三儿的歌前面。
> 缺陷：**重复 token 重复计数**——'No' 在查询里出现两次，unnest 出两行，
> 一首歌命中 no 子串被计为 2 个命中（November Rain = 2 > Intro 的阴三儿in3 = 1）。
>
> 设计原则（用户拍板）：**入围保持子串匹配**（打 Do 必须能搜到 Does，
> 「评分低排序低」而非「不命中」）；**整词命中只在权重上分档**——
> 独立单词 No 的命中权重高于 know/November 里的子串命中。
>
> 修法：
> - `search_songs` 的 tokens 构造加 `distinct` 去重（No 不再计双份）
> - 新增 `song_tok_word`（整词判定，仅用于权重分档）：纯 ASCII token 用词边界正则；
>   含中文 token 与子串等价（中文无词边界概念）
> - `song_token_weight` / `struct_hit` 改为分档权重：
>   歌名整词 3 > 别名整词 2 > 歌名子串 1.5 > 别名子串/演唱者 1 > 其他角色 0.5
> - 入围判定（song_title_hit / song_artist_hit / performer_hit）**不动**，保持子串 ilike

```sql
BEGIN;

-- ═══ 0) 整词命中判定（仅用于权重分档；入围仍是子串匹配）═══
-- 纯 ASCII token → 词边界正则（'no' 命中独立单词 No，不命中 know/November）
-- 含非 ASCII（中文）token → 与子串匹配等价
CREATE OR REPLACE FUNCTION public.song_tok_word(p_text text, p_tok text)
RETURNS boolean
LANGUAGE sql STABLE
AS $function$
  select case
    when p_tok ~ '[^\x00-\x7F]' then
      coalesce(p_text, '') ilike '%' || p_tok || '%'
    else
      coalesce(p_text, '') ~* (
        '\y' || regexp_replace(p_tok, '([\\.\+\*\?\(\)\[\]\{\}\|\^\$])', '\\\1', 'g') || '\y'
      )
  end
$function$;

-- ═══ 1) token 权重：整词满档，纯子串降档 ═══
CREATE OR REPLACE FUNCTION public.song_token_weight(p_song_id text, p_title text, p_aliases text[], p_tok text)
RETURNS double precision
LANGUAGE sql STABLE
AS $function$
  select case
    when public.song_tok_word(p_title, p_tok) then 3
    when exists (
      select 1 from unnest(coalesce(p_aliases, '{}')) a
      where public.song_tok_word(a, p_tok)
    ) then 2
    when p_title ilike '%' || p_tok || '%' then 1.5
    when exists (
      select 1 from unnest(coalesce(p_aliases, '{}')) a
      where a ilike '%' || p_tok || '%'
    ) then 1
    when public.performer_hit(p_song_id, p_tok) then 1
    else 0.5
  end
$function$;

-- ═══ 2) 结构化命中权重：同样整词/子串分档 ═══
CREATE OR REPLACE FUNCTION public.struct_hit(p_song_id text, p_title text, p_aliases text[], p_tokens text[])
RETURNS double precision
LANGUAGE sql STABLE
AS $function$
  select (
    select coalesce(sum(case
      when public.song_tok_word(p_title, t) then 3
      when exists (
        select 1 from unnest(coalesce(p_aliases, '{}')) a
        where public.song_tok_word(a, t)
      ) then 2
      when p_title ilike '%' || t || '%' then 1.5
      when exists (
        select 1 from unnest(coalesce(p_aliases, '{}')) a
        where a ilike '%' || t || '%'
      ) then 1
      when public.performer_hit(p_song_id, t) then 1
      else 0
    end), 0)
    from unnest(p_tokens) t
  )
$function$;

-- ═══ 3) 模糊搜索主函数：tokens 去重 + 物化子查询（6c）+ 宽松语义（6）+ 整串优先（6b）═══
CREATE OR REPLACE FUNCTION public.search_songs(p_q text)
RETURNS SETOF songs
LANGUAGE plpgsql
STABLE
AS $function$
      declare
        tokens text[] := array(
          select distinct t from regexp_split_to_table(trim(coalesce(p_q, '')), '\s+') t where t <> ''
        );
        p_lower text := lower(trim(coalesce(p_q, '')));
      begin
        if cardinality(tokens) = 0 then
          return;
        end if;

        return query
        select * from (
          select id, title, album_id, duration, lrc_text, status, created_at, track, contributor_id, lyrics_text, video_url, description, is_hidden, genres, disc, cover, aliases
          from public.songs s
          where s.status = 'published'
            -- 宽松语义：至少命中 1 个 token 即入围（入围 = 子串匹配，不设词边界）
            and exists (
              select 1 from unnest(tokens) tok
              where song_title_hit(s.title, s.aliases, tok)
                 or song_artist_hit(s.id, tok)
            )
          order by
            -- ① 整串连续命中（title/aliases 含完整查询串，小写）排绝对第一
            (
              select case when lower(s.title) like '%' || p_lower || '%'
                            or exists (select 1 from unnest(coalesce(s.aliases, '{}')) a
                                       where lower(a) like '%' || p_lower || '%')
                          then 1 else 0 end
            ) desc,
            -- ② 命中 token 数（已去重）：全命中的排前，部分命中的靠后
            (
              select count(*) from unnest(tokens) tok
              where song_title_hit(s.title, s.aliases, tok)
                 or song_artist_hit(s.id, tok)
            ) desc,
            struct_hit(s.id, s.title, s.aliases, tokens) desc,
            (
              select coalesce(sum(song_token_weight(s.id, s.title, s.aliases, tok)), 0)
              from unnest(tokens) tok
            ) desc,
            s.title asc
        ) t;
      end
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

**通过标准**：

```sql
-- ① 主 case：没钱没朋友第一；子串误命中（know/now/november 系）全部沉底
SELECT id, title FROM public.search_songs('No Money No Friend 阴三儿In3') LIMIT 10;

-- ② 子串入围回归：'Do' 能搜到 'Does'（排在整词 Do 之后）
SELECT id, title FROM public.search_songs('Do') LIMIT 10;

-- ③ 中文回归：子串匹配不受影响
SELECT count(*) FROM public.search_songs('北京');
SELECT count(*) FROM public.search_songs('阴三儿in3');
```

> **API 顺序乱序（limit=10 时整页变为同一专辑的歌）的根因不在本步骤**：
> PostgREST 对 RPC 的 select 带嵌套资源 + limit 时生成无 ORDER BY 的 LEFT JOIN
> 外层查询，join（hash join 按 join 键聚簇）打乱函数内部排序。已在 Worker 端修复
> （open-api.js：搜索改为裸 RPC + enrichSongRows 批量补关联），需重新部署 Worker。

---

## 步骤 6e：艺术家命中权重升至 2（压过歌名子串 1.5）

> 现象：搜「No Money No Friend 阴三儿In3」，"will **not** wake up"（no 子串）这类
> 歌名子串巧合（1.5 分）压过阴三儿的歌（演唱者命中仅 1 分）；Intro 这种
> 阴三儿只挂专辑艺术家的歌更是只拿 0.5（专辑艺术家命中不在权重档内）。
> 艺术家名命中（尤其长 token）是比歌名子串巧合强得多的相关性信号。
>
> 新权重阶梯：歌名整词 3 > 别名整词 2 = **任意角色命中 2** > 歌名子串 1.5 >
> 别名子串 1 > 其他 0.5

```sql
BEGIN;

-- ═══ 1) token 权重：任意角色命中（song_artist_hit，含专辑艺术家）= 2 ═══
CREATE OR REPLACE FUNCTION public.song_token_weight(p_song_id text, p_title text, p_aliases text[], p_tok text)
RETURNS double precision
LANGUAGE sql STABLE
AS $function$
  select case
    when public.song_tok_word(p_title, p_tok) then 3
    when exists (
      select 1 from unnest(coalesce(p_aliases, '{}')) a
      where public.song_tok_word(a, p_tok)
    ) then 2
    when public.song_artist_hit(p_song_id, p_tok) then 2
    when p_title ilike '%' || p_tok || '%' then 1.5
    when exists (
      select 1 from unnest(coalesce(p_aliases, '{}')) a
      where a ilike '%' || p_tok || '%'
    ) then 1
    else 0.5
  end
$function$;

-- ═══ 2) 结构化命中权重：同阶梯 ═══
CREATE OR REPLACE FUNCTION public.struct_hit(p_song_id text, p_title text, p_aliases text[], p_tokens text[])
RETURNS double precision
LANGUAGE sql STABLE
AS $function$
  select (
    select coalesce(sum(case
      when public.song_tok_word(p_title, t) then 3
      when exists (
        select 1 from unnest(coalesce(p_aliases, '{}')) a
        where public.song_tok_word(a, t)
      ) then 2
      when public.song_artist_hit(p_song_id, t) then 2
      when p_title ilike '%' || t || '%' then 1.5
      when exists (
        select 1 from unnest(coalesce(p_aliases, '{}')) a
        where a ilike '%' || t || '%'
      ) then 1
      else 0
    end), 0)
    from unnest(p_tokens) t
  )
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

**通过标准**：

```sql
-- ① 主 case：没钱没朋友 > (FAKE FRIEND / No Cap 整词档) > 阴三儿的歌 > no 子串歌（Dolly 系）
SELECT id, title FROM public.search_songs('No Money No Friend 阴三儿In3') LIMIT 15;

-- ② 专辑艺术家命中升档：Intro（王波演唱、阴三儿专辑艺术家）应排在 Dolly 系前面
-- ③ 单艺术家回归：搜 '阴三儿in3' 全部命中且排序稳定
SELECT count(*) FROM public.search_songs('阴三儿in3');
```

> 纯库端改动，Worker 无需重部署；搜索缓存 10 分钟自动过期（或加 &cb=1 穿透验证）。
>
> ⚠️ **6e 被 6f 取代**（未执行过 6e 也无妨，6f 含其全部意图）：6e 把艺术家命中统一提
> 到 2 分，但没区分「完全相等」与「子串」两种信号强度——用户指出 `阴三儿in3` 是
> `=` 精确命中，`no` 是 like 子串命中，两者不该同档。执行 6f 即可，跳过 6e。

---

## 步骤 6f：终版权重阶梯（艺术家完全相等独立档 + 删 0.5 兜底）

> 三方评审（用户 + 豆包 + DS）确认的终版。核心修正：艺术家字段拆「完全相等 / 子串」
> 两档——精确命中（lower=lower）是强信号给 4 分；子串命中与歌名子串平齐 1.5，
> 不再异常抬高（豆包场景：搜《孤勇者》歌手名含「孤」的乱入）。
> 另删掉不可达的 0.5 兜底分（豆包建议，无命中 = 0）。
>
> 终版阶梯：
>
> | 档 | 分 | 说明 |
> |---|---|---|
> | 歌名/别名**完全相等** | 6 | 双保险：整串优先级（ORDER BY ①）之外的分数层锚点 |
> | 艺术家名/别名**完全相等** | 4 | 阴三儿in3 精确命中，稳压一切子串 |
> | 歌名整词（ASCII 词边界） | 3 | No Cap 的 No；中文退化见下 |
> | 别名整词 | 2.5 | |
> | 艺术家子串 | 1.5 | 与歌名子串平齐 |
> | 歌名子串 | 1.5 | will **not** wake up 的 no |
> | 别名子串 | 1 | |
> | 无命中 | 0 | |
>
> 已知限制的处理（中文整词退化，方案 A）：中文无词边界，改按 **token 字符长度分档**——
> 含 CJK 且 ≥2 字符的子串匹配选择性与 ASCII 整词相当（中文 2 字组合信息量 ≈ 英文单词），
> 拿整词档分；单字符 CJK 是弱信号（`爱`/`天` 能命中几百首），压回子串档。
> ASCII 整词/子串逻辑不变。
>
> 归一化细节：所有比较前 lower() + trim()；艺术家别名参与完全相等判定；
> 单字段多条别名命中同一 token 只计一次（case when 顺序保证）。
>
> 豆包终审补丁（已采纳 2 条 / 驳回 1 条 / 缓 1 条）：
> - ✅ **ilike 通配符 bug**：token 含 `%`/`_`（如歌名 `100%`、`A_B`）会被当通配符误匹配。
>   全链路改用 `song_tok_sub`（strpos 子串判定），覆盖入围判定、权重、整串优先级全部 ilike 拼接点
> - ✅ **struct_hit 代码重复**：改为直接 sum(song_token_weight(...))，两处永不分叉
> - ❌ 正则转义不完整：实际已覆盖（字符类含 `\[` `\]`；`-` 在字符类外是普通字符无需转义）
> - ⏸ song_artist_ids 每 token 重算的性能：当前数据量（500+ 首）无感，观察
> - 顺带清理：6d 遗留的 song_tok_word 不再被引用，DROP

```sql
BEGIN;

-- ═══ 0) 子串判定原语（通配符安全版）：strpos 定位，% 和 _ 都是普通字符 ═══
CREATE OR REPLACE FUNCTION public.song_tok_sub(p_text text, p_tok text)
RETURNS boolean
LANGUAGE sql STABLE
AS $function$
  select strpos(lower(coalesce(p_text, '')), lower(coalesce(p_tok, ''))) > 0
$function$;

-- ═══ 1) 强包含判定（方案 A 核心）：CJK ≥2 字符子串 或 ASCII 整词 → 高档；
--          其余（CJK 单字 / ASCII 子串）→ 低档。仅歌名/别名字段用 ═══
CREATE OR REPLACE FUNCTION public.song_tok_strong(p_text text, p_tok text)
RETURNS boolean
LANGUAGE sql STABLE
AS $function$
  select case
    -- 含 CJK 的 token：≥2 字符 → 高档（选择性与 ASCII 整词相当）
    when p_tok ~ '[^\x00-\x7F]' then char_length(btrim(p_tok)) >= 2
      and public.song_tok_sub(p_text, p_tok)
    -- 纯 ASCII token：词边界整词 → 高档
    else coalesce(p_text, '') ~* (
      '\y' || regexp_replace(p_tok, '([\\.\+\*\?\(\)\[\]\{\}\|\^\$])', '\\1', 'g') || '\y'
    )
  end
$function$;

-- ═══ 2) 艺术家完全相等判定：name 或任一 alias 与 token 精确相等（lower+trim 归一）═══
CREATE OR REPLACE FUNCTION public.song_artist_exact(p_song_id text, p_tok text)
RETURNS boolean
LANGUAGE sql STABLE
AS $function$
  select exists (
    select 1 from public.artists ar
    where ar.is_show is not false
      and ar.id = any(public.song_artist_ids(p_song_id))
      and (
        lower(coalesce(ar.name, '')) = lower(btrim(p_tok))
        or exists (
          select 1 from unnest(coalesce(ar.aliases, '{}')) al
          where lower(coalesce(al, '')) = lower(btrim(p_tok))
        )
      )
  )
$function$;

-- ═══ 3) 歌名/别名完全相等判定（token 与整段文本精确相等，lower+trim 归一）═══
CREATE OR REPLACE FUNCTION public.song_title_exact(p_title text, p_aliases text[], p_tok text)
RETURNS boolean
LANGUAGE sql STABLE
AS $function$
  select lower(coalesce(p_title, '')) = lower(btrim(p_tok))
    or exists (
      select 1 from unnest(coalesce(p_aliases, '{}')) a
      where lower(coalesce(a, '')) = lower(btrim(p_tok))
    )
$function$;

-- ═══ 4) 歌名命中（入围判定，子串语义不变，仅换通配符安全判定）═══
CREATE OR REPLACE FUNCTION public.song_title_hit(p_title text, p_aliases text[], p_tok text)
RETURNS boolean
LANGUAGE sql STABLE
AS $function$
  select public.song_tok_sub(p_title, p_tok)
    or exists (
      select 1 from unnest(coalesce(p_aliases, '{}')) a
      where public.song_tok_sub(a, p_tok)
    )
$function$;

-- ═══ 5) 演唱者命中（同上换 song_tok_sub）═══
CREATE OR REPLACE FUNCTION public.performer_hit(p_song_id text, p_txt text)
RETURNS boolean
LANGUAGE sql STABLE
AS $function$
  select exists (
    select 1 from public.artists ar
    where ar.is_show is not false
      and ar.id = any(public.song_performer_ids(p_song_id))
      and (
        public.song_tok_sub(ar.name, p_txt)
        or exists (
          select 1 from unnest(coalesce(ar.aliases, '{}')) al
          where public.song_tok_sub(al, p_txt)
        )
      )
  )
$function$;

-- ═══ 6) 全角色命中（同上换 song_tok_sub）═══
CREATE OR REPLACE FUNCTION public.song_artist_hit(p_song_id text, p_tok text)
RETURNS boolean
LANGUAGE sql STABLE
AS $function$
  select exists (
    select 1 from public.artists ar
    where ar.is_show is not false
      and ar.id = any(public.song_artist_ids(p_song_id))
      and (
        public.song_tok_sub(ar.name, p_tok)
        or exists (
          select 1 from unnest(coalesce(ar.aliases, '{}')) al
          where public.song_tok_sub(al, p_tok)
        )
      )
  )
$function$;

-- ═══ 7) token 权重：终版阶梯（含中文分档 + 通配符安全）═══
CREATE OR REPLACE FUNCTION public.song_token_weight(p_song_id text, p_title text, p_aliases text[], p_tok text)
RETURNS double precision
LANGUAGE sql STABLE
AS $function$
  select case
    when public.song_title_exact(p_title, p_aliases, p_tok) then 6
    when public.song_artist_exact(p_song_id, p_tok) then 4
    when public.song_tok_strong(p_title, p_tok) then 3
    when exists (
      select 1 from unnest(coalesce(p_aliases, '{}')) a
      where public.song_tok_strong(a, p_tok)
    ) then 2.5
    when public.song_artist_hit(p_song_id, p_tok) then 1.5
    when public.song_tok_sub(p_title, p_tok) then 1.5
    when exists (
      select 1 from unnest(coalesce(p_aliases, '{}')) a
      where public.song_tok_sub(a, p_tok)
    ) then 1
    else 0
  end
$function$;

-- ═══ 8) 结构化命中权重：直接复用 song_token_weight（豆包建议，消除重复）═══
CREATE OR REPLACE FUNCTION public.struct_hit(p_song_id text, p_title text, p_aliases text[], p_tokens text[])
RETURNS double precision
LANGUAGE sql STABLE
AS $function$
  select (
    select coalesce(sum(public.song_token_weight(p_song_id, p_title, p_aliases, t)), 0)
    from unnest(p_tokens) t
  )
$function$;

-- ═══ 9) 模糊搜索主函数：整串优先级改 strpos（通配符安全），其余结构不变 ═══
CREATE OR REPLACE FUNCTION public.search_songs(p_q text)
RETURNS SETOF songs
LANGUAGE plpgsql
STABLE
AS $function$
      declare
        tokens text[] := array(
          select distinct t from regexp_split_to_table(trim(coalesce(p_q, '')), '\s+') t where t <> ''
        );
        p_lower text := lower(trim(coalesce(p_q, '')));
      begin
        if cardinality(tokens) = 0 then
          return;
        end if;

        return query
        select * from (
          select id, title, album_id, duration, lrc_text, status, created_at, track, contributor_id, lyrics_text, video_url, description, is_hidden, genres, disc, cover, aliases
          from public.songs s
          where s.status = 'published'
            -- 宽松语义：至少命中 1 个 token 即入围（入围 = 子串匹配，通配符安全）
            and exists (
              select 1 from unnest(tokens) tok
              where song_title_hit(s.title, s.aliases, tok)
                 or song_artist_hit(s.id, tok)
            )
          order by
            -- ① 整串连续命中（title/aliases 含完整查询串，strpos 判定）排绝对第一
            (
              select case when strpos(lower(s.title), p_lower) > 0
                            or exists (select 1 from unnest(coalesce(s.aliases, '{}')) a
                                       where strpos(lower(a), p_lower) > 0)
                          then 1 else 0 end
            ) desc,
            -- ② 命中 token 数（已去重）：全命中的排前，部分命中的靠后
            (
              select count(*) from unnest(tokens) tok
              where song_title_hit(s.title, s.aliases, tok)
                 or song_artist_hit(s.id, tok)
            ) desc,
            -- ③ 权重总分（struct_hit 内部即 sum(song_token_weight)，二者等价，只保留一处）
            struct_hit(s.id, s.title, s.aliases, tokens) desc,
            s.title asc
        ) t;
      end
$function$;

-- ═══ 10) 清理：6d 遗留 song_tok_word 已无引用 ═══
DROP FUNCTION IF EXISTS public.song_tok_word(text, text);

NOTIFY pgrst, 'reload schema';

COMMIT;
```

**通过标准**：

```sql
-- ① 主 case：没钱没朋友第一；阴三儿的歌（艺术家完全相等 4 分）压过 Dolly 系（no 子串 1.5）
SELECT id, title FROM public.search_songs('No Money No Friend 阴三儿In3') LIMIT 15;

-- ② 艺术家精确命中回归：搜 '阴三儿in3' 全部命中
SELECT count(*) FROM public.search_songs('阴三儿in3');

-- ③ 歌名完全相等锚点：搜 'intro' 时歌名恰为 Intro 的歌排最前（完全相等 6 分）
SELECT id, title FROM public.search_songs('intro') LIMIT 3;

-- ④ 中文强匹配分档：搜 '北京'（2 字 CJK → 高档 3 分）命中北京相关歌
SELECT id, title FROM public.search_songs('北京') LIMIT 5;

-- ⑤ 中文单字压档回归：搜 '爱'（单字 CJK → 低档 1.5）仍能命中但不霸榜
SELECT count(*) FROM public.search_songs('爱');

-- ⑥ 通配符安全回归：'%'' 作为普通字符，不再当通配符
SELECT count(*) FROM public.search_songs('100%');
```

> 纯库端改动，Worker 无需重部署；搜索缓存 10 分钟自动过期（或加 &cb=1 穿透验证）。

---

## 执行记录

> 执行日期：2026-08-27 ~ 2026-08-28

| 步 | 结果 | 备注 |
|---|---|---|
| 1 建表 + 迁移 + 修复 get_artist_songs | ✅ 通过 | 顺带修复 B 段遗留：get_artist_songs 引用已删旧列导致艺术家作品页报错 |
| （代码部署） | ✅ 完成 | 过渡期双写旧列兜底；曾遇 schema cache 报错（旧代码读写已删的 unlock_code 列），重部署后解决 |
| 3 删列 + RPC 收尾 | ✅ 通过 | verify 冒烟 'global'/false 通过；清口令后回退全局口令验证通过 |
| 4 通行证语义 | ✅ 通过 | verify 返回 'global'/'song'/'' 三态 + song_has_own_code 探测；全局口令会话通行、独立口令逐首验 |
| 脏数据清理 | ✅ 通过 | 删测试/冗余孤儿艺术家 5 个：pice、testwang、art_chill9、art_yanxiang、art_chensixing（保留 art_hexiuping） |
