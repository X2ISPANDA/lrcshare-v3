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

## 执行记录

> 执行日期：2026-08-27 ~ 2026-08-28

| 步 | 结果 | 备注 |
|---|---|---|
| 1 建表 + 迁移 + 修复 get_artist_songs | ✅ 通过 | 顺带修复 B 段遗留：get_artist_songs 引用已删旧列导致艺术家作品页报错 |
| （代码部署） | ✅ 完成 | 过渡期双写旧列兜底；曾遇 schema cache 报错（旧代码读写已删的 unlock_code 列），重部署后解决 |
| 3 删列 + RPC 收尾 | ✅ 通过 | verify 冒烟 'global'/false 通过；清口令后回退全局口令验证通过 |
| 4 通行证语义 | ✅ 通过 | verify 返回 'global'/'song'/'' 三态 + song_has_own_code 探测；全局口令会话通行、独立口令逐首验 |
| 脏数据清理 | ✅ 通过 | 删测试/冗余孤儿艺术家 5 个：pice、testwang、art_chill9、art_yanxiang、art_chensixing（保留 art_hexiuping） |
