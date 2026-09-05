# 02 · 搜索功能演进（v1 子串 → 终版权重阶梯 + 两段式召回）

> 合并自：search-songs-hardening.md、search-songs-artist-match.md、search-structured-query.md、
> search-recall-two-stage.md、phase3-song-secrets.md 步骤 5/6/6b~6f（全部已执行，2026-08-25 ~ 08-28）
>
> **本文含现行权威版全部 SQL**（6f 辅助函数族 + 两段式召回版主函数），是新库里重建搜索的唯一依据。

## 一句话现状

`search_songs(keyword)`：trgm 倒排索引召回（search_text 冗余列）→ 终版权重阶梯排序（完全相等 6/4 分 >
整词 3/2.5 分 > 子串 1.5/1 分，中文按字符数分档，strpos 通配符安全）。
`search_songs_structured(title, artist)`：结构化 AND 查询，同样带召回臂。

## 演进时间线（为什么改 → 怎么改）

| 版本 | 出发点 | 改动 | 结局 |
|---|---|---|---|
| v1 | 建库初始 | 只搜歌名+别名（ilike），艺术家完全不在范围 | 搜「龙胆紫」搜不到龍胆紫的歌 |
| v2 加固 | unlock_code 列级收权后 `s.*` 报权限错 | 动态列生成 + unlock_code 置 null 占位 | 口令问题根治后（见 03）此补丁作废 |
| v3 艺术家匹配 | Lyrico 插件按「歌名+艺术家」查询落空 | where 加第三路：四角色关联艺术家的名/别名 ilike | 思路被中间表版继承 |
| 结构化查询 | API 调用者（打标工具）手里本有 title/artist 字段却被逼拼串 | `/v1/search` 加 `title`/`artist` 参数 + `search_songs_structured` RPC | **API 层设计沿用至今**；SQL 主体被 6f 覆盖 |
| phase2 双源→单源 | 贡献关系切中间表 | 搜索函数改读 song_contributors | 见 01 |
| phase3 步骤5 | 专辑艺术家（TPE2）不在命中域，搜「intro 阴三儿in3」0 结果 | `song_artist_ids` 补专辑艺术家一路；structured 的 artist 同步 | |
| 步骤6 | AND 语义下一个 token 落空整首淘汰 → 0 结果 | 宽松语义：至少命中 1 个 token 即入围，命中数参与排序 | 网易/QQ 式「宁多勿无」 |
| 6b | 宽松后英文 token 碎片误命中大量无关歌且排序并列 | 整串连续命中排绝对第一 | |
| 6c | PostgREST limit=10 下推打乱函数内排序（limit=5 却正确） | `return query` 改物化子查询钉死输出顺序 | |
| 6d | 重复 token 重复计数（No×2 → November Rain 计 2 命中压过目标） | tokens 去重 + 整词/子串权重分档（song_tok_word） | |
| 6e | 艺术家命中只值 1 分，被歌名子串巧合（1.5）压过 | 艺术家命中统一提 2 分 | **被 6f 取代**（未区分相等/子串两种信号强度） |
| **6f 终版** | 6e 没区分「阴三儿in3 精确命中」与「no 子串命中」 | 艺术家完全相等独立档 4 分；删不可达 0.5 兜底；CJK ≥2 字按整词档；ilike 通配符 bug 全链换 strpos | **现行排序逻辑** |
| **两段式召回** | 6f 排序正确但召回是全表扫，10 万首时每次搜索 500ms+ | search_text 冗余列（触发器维护）+ trgm GIN 索引召回，排序层逐字节不变 | **现行召回逻辑** |

## 设计原则（多轮迭代沉淀）

1. **入围宽松、排序分档**：打 Do 必须能搜到 Does（子串入围不设词边界）；整词命中只在权重上分档
2. **精确相等是强信号**：歌名/别名完全相等 6 分、艺术家完全相等 4 分，稳压一切子串
3. **中文无词边界**：CJK ≥2 字符子串的选择性 ≈ 英文整词，拿整词档分；单字 CJK（爱/天）是弱信号压回子串档
4. **通配符安全**：所有判定用 strpos（`%`/`_` 是普通字符），不用 ilike 拼接

## 现行权威 SQL · 一：6f 辅助函数族（终版权重阶梯）

```sql
BEGIN;

-- ═══ 0) 子串判定原语（通配符安全版）：strpos 定位，% 和 _ 都是普通字符 ═══
CREATE OR REPLACE FUNCTION public.song_tok_sub(p_text text, p_tok text)
RETURNS boolean
LANGUAGE sql STABLE
AS $function$
  select strpos(lower(coalesce(p_text, '')), lower(coalesce(p_tok, ''))) > 0
$function$;

-- ═══ 1) 强包含判定：CJK ≥2 字符子串 或 ASCII 整词 → 高档；其余 → 低档 ═══
CREATE OR REPLACE FUNCTION public.song_tok_strong(p_text text, p_tok text)
RETURNS boolean
LANGUAGE sql STABLE
AS $function$
  select case
    when p_tok ~ '[^\x00-\x7F]' then char_length(btrim(p_tok)) >= 2
      and public.song_tok_sub(p_text, p_tok)
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

-- ═══ 3) 歌名/别名完全相等判定 ═══
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

-- ═══ 4) 歌名命中（入围判定，子串语义，通配符安全）═══
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

-- ═══ 5) 演唱者命中 ═══
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

-- ═══ 6) 全角色命中（song_artist_ids 含专辑艺术家一路）═══
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

-- ═══ 7) token 权重：终版阶梯 ═══
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

-- ═══ 8) 结构化命中权重：直接复用 song_token_weight（消除重复）═══
CREATE OR REPLACE FUNCTION public.struct_hit(p_song_id text, p_title text, p_aliases text[], p_tokens text[])
RETURNS double precision
LANGUAGE sql STABLE
AS $function$
  select (
    select coalesce(sum(public.song_token_weight(p_song_id, p_title, p_aliases, t)), 0)
    from unnest(p_tokens) t
  )
$function$;

COMMIT;
```

## 现行权威 SQL · 二：两段式召回（search_text 冗余列 + trgm 索引 + 主函数）

> 召回条件 = search_text 命中**且**原入围判定（后者滤掉拼接边界假阳性），结果集与 6f 逐字节一致。

```sql
BEGIN;

-- ═══ 0) 扩展 + 冗余列 ═══
CREATE EXTENSION IF NOT EXISTS pg_trgm;
ALTER TABLE public.songs ADD COLUMN IF NOT EXISTS search_text text;

-- ═══ 1) 重算函数：title + aliases + 歌曲级艺术家 + 专辑级艺术家（均含别名、滤 is_show=false）═══
CREATE OR REPLACE FUNCTION public.recompute_song_search_text(p_song_ids text[])
RETURNS void
LANGUAGE sql
AS $function$
  UPDATE public.songs s
  SET search_text = concat_ws(' ',
        coalesce(s.title, ''),
        coalesce(array_to_string(s.aliases, ' '), ''),
        coalesce((
          SELECT array_to_string(array_agg(DISTINCT t ORDER BY t), ' ')
          FROM (
            SELECT lower(ar.name) AS t
            FROM public.song_contributors sc
            JOIN public.artists ar ON ar.id = sc.artist_id AND ar.is_show IS NOT FALSE
            WHERE sc.song_id = s.id
            UNION
            SELECT lower(al)
            FROM public.song_contributors sc2
            JOIN public.artists ar2 ON ar2.id = sc2.artist_id AND ar2.is_show IS NOT FALSE
            CROSS JOIN LATERAL unnest(coalesce(ar2.aliases, '{}')) AS u1(al)
            WHERE sc2.song_id = s.id
            UNION
            SELECT lower(ar3.name)
            FROM public.album_contributors ac
            JOIN public.artists ar3 ON ar3.id = ac.artist_id AND ar3.is_show IS NOT FALSE
            WHERE ac.album_id = s.album_id
            UNION
            SELECT lower(al3)
            FROM public.album_contributors ac2
            JOIN public.artists ar4 ON ar4.id = ac2.artist_id AND ar4.is_show IS NOT FALSE
            CROSS JOIN LATERAL unnest(coalesce(ar4.aliases, '{}')) AS u2(al3)
            WHERE ac2.album_id = s.album_id
          ) x
        ), '')
      )
  WHERE s.id = ANY(p_song_ids);
$function$;

-- ═══ 2) 触发器：五类源变更自动同步 ═══
CREATE OR REPLACE FUNCTION public.trg_song_search_text()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_song_ids text[] := '{}'::text[];
BEGIN
  IF TG_TABLE_NAME = 'songs' THEN
    v_song_ids := ARRAY[NEW.id];
  ELSIF TG_TABLE_NAME = 'song_contributors' THEN
    v_song_ids := ARRAY[COALESCE(NEW.song_id, OLD.song_id)];
  ELSIF TG_TABLE_NAME = 'album_contributors' THEN
    v_song_ids := ARRAY(
      SELECT s.id FROM public.songs s
      WHERE s.album_id = COALESCE(NEW.album_id, OLD.album_id)
    );
  ELSIF TG_TABLE_NAME = 'artists' THEN
    v_song_ids := ARRAY(
      SELECT song_id FROM public.song_contributors
      WHERE artist_id = COALESCE(NEW.id, OLD.id)
      UNION
      SELECT s.id FROM public.songs s
      JOIN public.album_contributors ac ON ac.album_id = s.album_id
      WHERE ac.artist_id = COALESCE(NEW.id, OLD.id)
    );
  END IF;
  IF cardinality(v_song_ids) > 0 THEN
    PERFORM public.recompute_song_search_text(v_song_ids);
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_sst_songs ON public.songs;
CREATE TRIGGER trg_sst_songs AFTER INSERT OR UPDATE OF title, aliases, album_id ON public.songs
  FOR EACH ROW EXECUTE FUNCTION public.trg_song_search_text();

DROP TRIGGER IF EXISTS trg_sst_contribs ON public.song_contributors;
CREATE TRIGGER trg_sst_contribs AFTER INSERT OR DELETE OR UPDATE OF song_id, artist_id ON public.song_contributors
  FOR EACH ROW EXECUTE FUNCTION public.trg_song_search_text();

DROP TRIGGER IF EXISTS trg_sst_album_contribs ON public.album_contributors;
CREATE TRIGGER trg_sst_album_contribs AFTER INSERT OR DELETE OR UPDATE OF album_id, artist_id ON public.album_contributors
  FOR EACH ROW EXECUTE FUNCTION public.trg_song_search_text();

DROP TRIGGER IF EXISTS trg_sst_artists ON public.artists;
CREATE TRIGGER trg_sst_artists AFTER UPDATE OF name, aliases, is_show OR DELETE ON public.artists
  FOR EACH ROW EXECUTE FUNCTION public.trg_song_search_text();

-- ═══ 3) 全量回填（新库重建时执行）═══
SELECT public.recompute_song_search_text(ARRAY(SELECT id FROM public.songs));

-- ═══ 4) 召回索引 ═══
CREATE INDEX IF NOT EXISTS idx_songs_search_text_trgm
  ON public.songs USING gin (lower(search_text) gin_trgm_ops);

-- ═══ 5) 授权（songs 是列级授权表，新列显式授予）═══
GRANT SELECT (search_text) ON public.songs TO anon;
GRANT UPDATE (search_text) ON public.songs TO authenticated;

-- ═══ 6) search_songs 主函数（召回臂 + 6f 排序，物化子查询）═══
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
          select id, title, album_id, duration, lrc_text, status, created_at, track, contributor_id, lyrics_text, video_url, description, is_hidden, genres, disc, cover, aliases, null::text as search_text
          from public.songs s
          where s.status = 'published'
            -- ① 召回臂（trgm 索引加速）
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
            -- ① 整串连续命中排绝对第一
            (
              select case when strpos(lower(s.title), p_lower) > 0
                            or exists (select 1 from unnest(coalesce(s.aliases, '{}')) a
                                       where strpos(lower(a), p_lower) > 0)
                          then 1 else 0 end
            ) desc,
            -- ② 命中 token 数（已去重）
            (
              select count(*) from unnest(tokens) tok
              where song_title_hit(s.title, s.aliases, tok)
                 or song_artist_hit(s.id, tok)
            ) desc,
            -- ③ 权重总分
            struct_hit(s.id, s.title, s.aliases, tokens) desc,
            s.title asc
        ) t;
      end
$function$;

-- ═══ 7) search_songs_structured：title/artist 各加一路召回臂（AND 语义复核保留）═══
CREATE OR REPLACE FUNCTION public.search_songs_structured(p_title text DEFAULT NULL::text, p_artist text DEFAULT NULL::text)
RETURNS SETOF songs
LANGUAGE sql STABLE
AS $function$
      select id, title, album_id, duration, lrc_text, status, created_at, track, contributor_id, lyrics_text, video_url, description, is_hidden, genres, disc, cover, aliases, null::text as search_text
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
          p_artist is null
          or (
            lower(s.search_text) like '%' || lower(btrim(p_artist)) || '%'
            and exists (
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
        )
      order by s.title asc
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

## ⚠️ 维护 checklist：search_text 正确性完全依赖触发器

漏一条变更路径 = 搜索静默漏结果，比全表扫更难察觉。凡改动 songs / song_contributors /
album_contributors / artists 的结构或同步逻辑，自查口令：**「有什么写路径能改变一首歌该被搜到的方式？」**

| 变更源 | 触发器 |
|---|---|
| songs 的 title / aliases / album_id 增改 | trg_sst_songs |
| song_contributors 增 / 删 / 改 | trg_sst_contribs |
| album_contributors 增 / 删 / 改 | trg_sst_album_contribs（该专辑全部歌重算） |
| artists 的 name / aliases / is_show 改、行删 | trg_sst_artists（两条路涉及的全部歌重算） |

盲区：触发器只覆盖库内写入；绕过 PostgREST 的批量导入后需手动跑
`recompute_song_search_text(ARRAY(SELECT id FROM public.songs))` 兜底。

## 踩过的坑

| 坑 | 教训 |
|---|---|
| PostgREST 对 RPC 的 select 带嵌套资源 + limit 时生成无 ORDER BY 的 LEFT JOIN，打乱函数内排序 | Worker 端搜索改为裸 RPC + enrichSongRows 批量补关联（open-api.js） |
| 单字符 token（爱、a）提不出 trigram，退化为顺序过滤 | 结果正确仅慢，可接受 |
| `RETURNS SETOF songs` 要求返回列凑满全表列 | songs 加列都要在函数 select 清单末尾补 `null::类型` 占位 |
| 小表（几百行）planner 可能选 Seq Scan 不走 GIN | 成本选择非索引损坏；索引是给上万级准备的 |
| 纯中文短模式（%北京%）planner 可能选其他 plan | `show_trgm('北京')` 非空即 CJK 可提词 |

## 执行记录（2026-08-25 ~ 2026-08-28）

| 步 | 结果 | 备注 |
|---|---|---|
| v2 加固 / v3 艺术家匹配 / 结构化查询 | ✅ 已执行 | 主体被后续版本覆盖，沿革记录见本表 |
| phase3 步骤 5~6f（含 6b/6c/6d） | ✅ 通过 | 6e 被 6f 取代未执行；6f 为终版 |
| 两段式召回 | ✅ 通过 | 主 case 七组结果与 6f 一致；`show_trgm('北京')` 非空；seqscan off 实测走 `idx_songs_search_text_trgm` |
| 触发器 / 权限 / API 回归 | ✅ 通过 | `/v1/search` 带 `&cb=1` 与改造前一致；Worker 零改动 |
