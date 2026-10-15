-- ============================================================================
-- 20-image-backup-rpc.sql
-- 图片灾备补全（批次A）：修复/补全 5 个公共 RPC
--
-- 背景：
--   19-image-backup 给 songs/albums/artists/contributors 加了 *_backup 列后：
--   ① search_songs / search_songs_structured 声明 RETURNS SETOF songs（表已 21 列），
--      但内部 RETURN QUERY 仍是旧的 20 列显式列表 → 42804 失配，线上搜索直接报错；
--   ② get_artist_songs / get_top_artists / get_top_contributors 的 RETURNS TABLE
--      显式列不含备份列，前台经 RPC 拿到的数据无法被图片源拦截器替换。
--
-- 注意：
--   ② 的三个函数是匿名 TABLE 返回类型，加列 = 改返回类型，CREATE OR REPLACE 不允许，
--   必须 DROP 后重建；DROP 会清掉 EXECUTE 授权，故末尾重新 GRANT 给 anon/authenticated
--   （与原公共函数授权口径一致；service_role 本就有全量执行权限）。
--
-- 单事务，可一次性执行；幂等（可重复执行）。
-- ============================================================================

begin;

-- ① 关键词搜索：内部查询补上 songs.cover_backup（返回类型仍是 SETOF songs，OR REPLACE 即可）
create or replace function public.search_songs(p_q text)
 returns setof songs
 language plpgsql
 stable
as $function$
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
          select id, title, album_id, duration, lrc_text, status, created_at, track, contributor_id, lyrics_text, video_url, description, is_hidden, genres, disc, cover, aliases, null::text as search_text, null::jsonb as source_ids, null::text as origin, cover_backup
          from public.songs s
          where s.status = 'published'
            -- ① 召回臂（trgm 索引加速）：search_text 命中任一 token 的候选才进排序层
            and exists (
              select 1 from unnest(tokens) tok
              where lower(s.search_text) like '%' || lower(tok) || '%'
            )
            -- ② 精确复核臂（= 6f 原入围判定，滤掉拼接边界假阳性）
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
            -- ③ 权重总分（struct_hit 内部即 sum(song_token_weight)）
            struct_hit(s.id, s.title, s.aliases, tokens) desc,
            s.title asc
        ) t;
      end
$function$;

-- ① 结构化搜索：同样补 cover_backup（签名与所有复核分支逻辑原样保留）
create or replace function public.search_songs_structured(p_title text default null::text, p_artist text default null::text, p_artist_arr text[] default null::text[])
 returns setof songs
 language sql
 stable
as $function$
      select id, title, album_id, duration, lrc_text, status, created_at, track, contributor_id, lyrics_text, video_url, description, is_hidden, genres, disc, cover, aliases, null::text as search_text, null::jsonb as source_ids, null::text as origin, cover_backup
      from public.songs s
      where s.status = 'published'
        and (
          p_title is null
          or (
            lower(s.search_text) like '%' || lower(btrim(p_title)) || '%'
            and (
              s.title ilike '%' || p_title || '%'
              or exists (select 1 from unnest(coalesce(s.aliases, '{}')) a where a ilike '%' || p_title || '%')
            )
          )
        )
        and (
          (p_artist is null and p_artist_arr is null)
          or (
            -- 【数组模式】调用方已拆好的完整艺人名列表（如未来 Lyrico 字段化后传 ["BuzzY.D","NKidd"]）：
            -- 每个元素视为一个完整艺人名，AND 语义逐元素复核；元素可信，不做斜杠再拆分、不做长度过滤。
            (
              p_artist_arr is not null
              and cardinality(p_artist_arr) > 0
              and exists (
                select 1 from unnest(p_artist_arr) e
                where lower(s.search_text) like '%' || lower(e) || '%'
              )
              and (
                select bool_and(
                  exists (
                    select 1
                    from public.artists ar
                    where ar.is_show is not false
                      and (
                        ar.id = any(public.song_performer_ids(s.id))
                        or ar.id in (
                          select ac.artist_id from public.album_contributors ac
                          where ac.album_id = s.album_id
                        )
                      )
                      and (
                        ar.name ilike '%' || e || '%'
                        or exists (select 1 from unnest(coalesce(ar.aliases, '{}')) al where al ilike '%' || e || '%')
                      )
                  )
                )
                from unnest(p_artist_arr) e
              )
            )
            or (
              p_artist is not null
              and (
                -- 【字符串模式·召回臂】整串命中，或（仅含斜杠时）任一拆段（≥2字符，btrim）命中
                (
                  lower(s.search_text) like '%' || lower(btrim(p_artist)) || '%'
                  or (
                    btrim(p_artist) like '%/%'
                    and exists (
                      select 1
                      from unnest(regexp_split_to_array(btrim(p_artist), '/')) seg
                      where char_length(btrim(seg)) >= 2
                        and lower(s.search_text) like '%' || lower(btrim(seg)) || '%'
                    )
                  )
                )
                and (
                  -- 【字符串模式·复核·分支一】无斜杠 → 现行整串复核，逐字节不变
                  btrim(p_artist) not like '%/%'
                  or (
                    -- 【字符串模式·复核·分支二】含斜杠且整串恰好精确匹配库内艺人名/别名（大小写不敏感）
                    -- → 视为单人（AC/DC、R/Aph 场景），按整名复核（与现行整串逻辑相同）
                    exists (
                      select 1 from public.artists ex
                      where lower(ex.name) = lower(btrim(p_artist))
                         or exists (
                           select 1 from unnest(coalesce(ex.aliases, '{}')) exal
                           where lower(exal) = lower(btrim(p_artist))
                         )
                    )
                    and exists (
                      select 1
                      from public.artists ar
                      where ar.is_show is not false
                        and (
                          ar.id = any(public.song_performer_ids(s.id))
                          or ar.id in (
                            select ac.artist_id from public.album_contributors ac
                            where ac.album_id = s.album_id
                          )
                        )
                        and (
                          ar.name ilike '%' || p_artist || '%'
                          or exists (select 1 from unnest(coalesce(ar.aliases, '{}')) al where al ilike '%' || p_artist || '%')
                        )
                    )
                  )
                  or (
                    -- 【字符串模式·复核·分支三】含斜杠且整串不是库内艺人名 → 斜杠拆段（每段≥2字符）AND 复核。
                    -- 子串穿透：含斜杠艺人名无需拼回即被自身碎片命中（R/Aph 含 "R"/"Aph"）；
                    -- bool_and 空段集恒真，故前置 exists 守卫（全段被滤时本分支不生效）。
                    btrim(p_artist) like '%/%'
                    and not exists (
                      select 1 from public.artists ex2
                      where lower(ex2.name) = lower(btrim(p_artist))
                         or exists (
                           select 1 from unnest(coalesce(ex2.aliases, '{}')) exal2
                           where lower(exal2) = lower(btrim(p_artist))
                         )
                    )
                    and exists (
                      select 1
                      from unnest(regexp_split_to_array(btrim(p_artist), '/')) seg2
                      where char_length(btrim(seg2)) >= 2
                    )
                    and (
                      select bool_and(
                        exists (
                          select 1
                          from public.artists ar3
                          where ar3.is_show is not false
                            and (
                              ar3.id = any(public.song_performer_ids(s.id))
                              or ar3.id in (
                                select ac3.artist_id from public.album_contributors ac3
                                where ac3.album_id = s.album_id
                              )
                            )
                            and (
                              ar3.name ilike '%' || btrim(seg3) || '%'
                              or exists (select 1 from unnest(coalesce(ar3.aliases, '{}')) al3 where al3 ilike '%' || btrim(seg3) || '%')
                            )
                        )
                      )
                      from unnest(regexp_split_to_array(btrim(p_artist), '/')) seg3
                      where char_length(btrim(seg3)) >= 2
                    )
                  )
                )
              )
            )
          )
        )
      order by s.title asc
$function$;

-- ② 三个匿名 TABLE 返回类型的函数：加备份列必须 DROP 后重建 -----------------

drop function if exists public.get_artist_songs(text);

create or replace function public.get_artist_songs(p_artist_id text)
 returns table(id text, title text, aliases text[], artist_ids text[], album_id text, lyricist text, composer text, arranger text, duration text, track integer, disc integer, status text, is_hidden boolean, description text, genres text[], lrc_text text, lyrics_text text, video_url text, cover text, cover_backup text, contributor_id text, created_at timestamp with time zone, albums jsonb, roles text[])
 language sql
 stable
 set search_path to 'public'
as $function$
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
         s.lrc_text, s.lyrics_text, s.video_url, s.cover, s.cover_backup, s.contributor_id, s.created_at,
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

drop function if exists public.get_top_artists(integer);

create or replace function public.get_top_artists(limit_count integer default 6)
 returns table(id text, name text, sort integer, avatar text, avatar_backup text, types text[], disambiguation text, is_show boolean, aliases text[], song_count integer)
 language sql
 stable
as $function$
  with counts as (
    select sc.artist_id, count(*) as cnt
    from public.song_contributors sc
    join public.songs s on s.id = sc.song_id and s.status = 'published'
    group by sc.artist_id
  )
  select
    a.id, a.name, a.sort, a.avatar, a.avatar_backup, a.types, a.disambiguation, a.is_show, a.aliases,
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

drop function if exists public.get_top_contributors(integer);

create or replace function public.get_top_contributors(limit_count integer default 9)
 returns table(id text, name text, avatar text, avatar_backup text, bio text, public_bio boolean, contact_value text, public_contact boolean, is_owner boolean, created_at timestamp with time zone, sort integer, tags text[], song_count integer)
 language sql
 stable
as $function$
  with contributor_counts as (
    select contributor_id, count(*) as cnt
    from songs
    where status = 'published' and contributor_id is not null
    group by contributor_id
  )
  select
    c.id, c.name, c.avatar, c.avatar_backup, c.bio, c.public_bio, c.contact_value,
    c.public_contact, c.is_owner, c.created_at, c.sort, c.tags,
    coalesce(cc.cnt, 0) as song_count
  from contributors c
  left join contributor_counts cc on cc.contributor_id = c.id
  order by
    case when c.sort > 0 then 0 else 1 end,
    case when c.sort > 0 then c.sort end nulls last,
    coalesce(cc.cnt, 0) desc,
    c.created_at asc
  limit limit_count
$function$;

-- DROP 重建后恢复公共执行权限（与原授权口径一致）
grant execute on function public.get_artist_songs(text) to anon, authenticated;
grant execute on function public.get_top_artists(integer) to anon, authenticated;
grant execute on function public.get_top_contributors(integer) to anon, authenticated;

commit;

-- ============================================================================
-- 验收（执行后应全部成功且备份列非空率正常）：
-- select cover, cover_backup is not null as has_backup from public.search_songs('the') limit 5;
-- select cover_backup is not null as has_backup from public.get_artist_songs('art_in3') limit 5;
-- select name, avatar_backup is not null as has_backup from public.get_top_artists(6);
-- select name, avatar_backup is not null as has_backup from public.get_top_contributors(9);
-- ============================================================================
