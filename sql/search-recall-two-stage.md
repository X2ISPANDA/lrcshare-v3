# SQL 方案：搜索两段式改造——召回走索引，排序沿用 6f

> 来源：整体审查.md M2。
> 状态：**已执行**（2026-08-28，验证通过，见文末执行记录；纯库端改动，Worker 零感知）。
> 前置阅读：[phase3-song-secrets.md](phase3-song-secrets.md) 步骤 6f（现行权威排序逻辑，本方案**不碰它的阶梯权重**）。

---

## 一、问题：6f 的排序语义是对的，但召回路径是全表扫

6f 之后 `search_songs` 的执行模型：

```
songs 全表（status='published'）→ 每行逐 token 跑
  song_title_hit / song_artist_hit（后者每行再经 song_artist_ids → song_contributors/album_contributors → artists 多跳子查询）
```

- `strpos()` 判定吃不到任何索引（当时从 ilike 换 strpos 是为了修通配符 bug，代价就是索引彻底无缘）
- 复杂度 = O(行数 × token 数 × 每行多跳子查询)。500 首毫秒级；上万首数十毫秒，10 万首每次搜索 500ms+，CPU 全打在库上——这正是「按上万级准备」的架构缺口

## 二、架构：召回层 / 排序层分离（与搜索引擎同构）

```
查询串 → 分词 tokens
   │
   ├─ ① 召回层（新）：GIN 倒排候选集——索引扫描，从 N 行缩到几百行
   │     lower(search_text) like '%tok%'（trgm 三元组索引加速，语义仍是精确子串）
   │
   └─ ② 排序层（不变）：6f 的 ①整串优先 → ②token 命中数 → ③struct_hit 阶梯权重
         只在候选集上跑，结果与现在逐字节一致
```

关键决策：**不做索引化的 OR 多路召回，改为冗余列单索引召回**。

| 备选 | 否决/采纳理由 |
|---|---|
| title/aliases/artist 各建 trgm 索引 + OR | ❌ aliases 是 text[] 无法精确子串索引；OR 混入不可索引臂会把整个查询拖回顺序扫描 |
| artists 单独建索引 + JOIN 召回 | ❌ 仍解决不了 aliases 臂 |
| ✅ **songs 冗余列 `search_text`**（title + aliases + 可见艺术家的 name/aliases 拼接，触发器维护）+ 单个 trgm GIN 表达式索引 | 一个索引覆盖全部召回字段；艺术家改名/别名变更/关系行增删/专辑艺术家变更/隐藏切换全部由触发器自动同步——延续 phase2/3 的「正确性靠结构保证」哲学 |

## 三、语义保持承诺（与 6f 逐字节一致）

- 召回条件 = `search_text` 命中 **且** 原入围判定（`song_title_hit or song_artist_hit`）——后者只对候选集求值。拼接边界可能产生的假阳性候选会被第二道条件滤掉，**结果集与 6f 完全相同**
- `search_text` 覆盖 **歌曲级 + 专辑级**（album_contributors）两类艺术家及其别名、且过滤 `is_show=false`——与 6f 的 `song_artist_hit` 命中域对齐（初稿漏了专辑艺术家一路，定稿已补，否则 Intro/阴三儿类歌曲会在召回层漏掉）
- ORDER BY 三层（整串 strpos 优先 / token 命中数 / struct_hit）**一字不改**
- ⚠️ `RETURNS SETOF songs` 要求返回列凑满全表列（位置对齐）：新列 `search_text` 追加在表尾，
  两个搜索函数的 select 清单末尾补 `null::text as search_text` 占位（沿用 phase3 的 unlock_code 置 null 套路），
  **不把拼接串吐进 API 响应**。今后凡 `RETURNS SETOF songs` 的函数，songs 加列都要同步补占位
- 召回臂用 `like`（trgm 索引只认 like/ilike，strpos 吃不到索引）：token 含 `%`/`_` 时 like 只会**多召回**（通配符超集），不会漏召回，多余候选由精确复核臂滤掉——通配符安全性不受影响
- 已知退化：单字符 token（`爱`、`a`）提取不出 trigram，该查询退化为顺序过滤——结果正确，仅慢；此类查询罕见，可接受

### ⚠️ 维护 checklist：search_text 正确性完全依赖触发器覆盖所有变更路径

`search_text` 是冗余列，**漏一条变更路径 = 搜索静默漏结果，且比全表扫更难察觉**。
凡改动 songs / song_contributors / album_contributors / artists 的结构或同步逻辑时，逐行对照：

| 变更源 | 触发器 | 涉及路径 |
|---|---|---|
| songs 的 title / aliases / album_id 增改 | trg_sst_songs | 本歌重算 |
| song_contributors 增 / 删 / 改 | trg_sst_contribs | 本歌重算 |
| album_contributors 增 / 删 / 改 | trg_sst_album_contribs | 该专辑**全部歌**重算 |
| artists 的 name / aliases / is_show 改、行删 | trg_sst_artists | 歌曲级 + 专辑级两条路涉及的全部歌重算 |

自查口令：**「有什么写路径能改变一首歌该被搜到的方式？」**——每新增一种（新中间表、
新的艺术家可见性字段、别名机制变更），必须同步补触发器分支，并在第五节验证清单 3 补对应回归项。
注意盲区：触发器只覆盖**库内写入**；若未来引入绕过 PostgREST 的批量导入（如直连 SQL 拷贝），
语句级批量写入后需手动跑一次 `recompute_song_search_text(ARRAY(SELECT id FROM public.songs))` 兜底。

## 四、执行脚本（一次性，整段粘贴执行）

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
            -- 歌曲级艺术家名
            SELECT lower(ar.name) AS t
            FROM public.song_contributors sc
            JOIN public.artists ar ON ar.id = sc.artist_id AND ar.is_show IS NOT FALSE
            WHERE sc.song_id = s.id
            UNION
            -- 歌曲级艺术家别名
            SELECT lower(al)
            FROM public.song_contributors sc2
            JOIN public.artists ar2 ON ar2.id = sc2.artist_id AND ar2.is_show IS NOT FALSE
            CROSS JOIN LATERAL unnest(coalesce(ar2.aliases, '{}')) AS u1(al)
            WHERE sc2.song_id = s.id
            UNION
            -- 专辑级艺术家名（TPE2，6f 步骤5 已纳入命中域）
            SELECT lower(ar3.name)
            FROM public.album_contributors ac
            JOIN public.artists ar3 ON ar3.id = ac.artist_id AND ar3.is_show IS NOT FALSE
            WHERE ac.album_id = s.album_id
            UNION
            -- 专辑级艺术家别名
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

-- ═══ 2) 触发器：五类源变更自动同步（songs / song_contributors / album_contributors / artists）═══
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
    -- 专辑艺术家变了 → 该专辑下全部歌曲重算
    v_song_ids := ARRAY(
      SELECT s.id FROM public.songs s
      WHERE s.album_id = COALESCE(NEW.album_id, OLD.album_id)
    );
  ELSIF TG_TABLE_NAME = 'artists' THEN
    -- 改名/别名/隐藏 → 歌曲级 + 专辑级两条路涉及的歌曲都重算
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

-- ═══ 3) 全量回填 ═══
SELECT public.recompute_song_search_text(ARRAY(SELECT id FROM public.songs));

-- ═══ 4) 召回索引（表达式索引：查询统一走 lower(search_text)）═══
CREATE INDEX IF NOT EXISTS idx_songs_search_text_trgm
  ON public.songs USING gin (lower(search_text) gin_trgm_ops);

-- ═══ 5) 授权：songs 是列级授权表（phase1 基线），新列显式授予 ═══
GRANT SELECT (search_text) ON public.songs TO anon;
GRANT UPDATE (search_text) ON public.songs TO authenticated;

-- ═══ 6) search_songs：仅加召回臂，ORDER BY / 复核臂与 6f 一字不差 ═══
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

-- ═══ 7) search_songs_structured：title/artist 各加一路召回臂（AND 语义的精确复核保留）═══
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

## 五、验证清单（执行后逐条过）

1. **结果一致性（最重）**：6f 通过标准 ①~⑥ 全部重跑，改造前后结果集与顺序 diff = 零
   ```sql
   SELECT id, title FROM public.search_songs('No Money No Friend 阴三儿In3') LIMIT 15;
   SELECT count(*) FROM public.search_songs('阴三儿in3');
   SELECT id, title FROM public.search_songs('intro') LIMIT 3;
   SELECT id, title FROM public.search_songs('北京') LIMIT 5;
   SELECT count(*) FROM public.search_songs('爱');
   SELECT count(*) FROM public.search_songs('100%');
   -- 专辑艺术家召回域（初稿缺口回归）：应返回 Intro
   SELECT id, title FROM public.search_songs('intro 阴三儿in3');
   ```
2. **索引确认**：RPC 函数对 `EXPLAIN` 是黑盒，直接验证函数体内的召回查询：
   ```sql
   SET enable_seqscan = off;
   EXPLAIN
   SELECT id FROM public.songs s
   WHERE s.status = 'published'
     AND lower(s.search_text) like '%阴三儿in3%';   -- 用含 ASCII 片段的模式
   RESET enable_seqscan;
   ```
   出现 `Bitmap Index Scan on idx_songs_search_text_trgm` 即索引可用。
   ⚠️ 两个注意点（实测踩过）：
   - 纯中文短模式（`%北京%`）在当前数据量下 planner 可能选 `idx_songs_status` 或 Seq Scan——
     纯成本选择，不代表索引坏了；用 `show_trgm('北京')` 返回非空数组确认 CJK 可提词即可
   - 表只有几百行时顺序扫本来就比走 GIN 便宜，索引是给上万级准备的
3. **触发器回归**：
   ```sql
   -- 改歌名 → search_text 秒级同步（改完立即查，记得手动还原）
   SELECT search_text FROM public.songs WHERE title = '没钱没朋友';
   ```
   - 艺术家加别名 → 其全部歌曲 search_text 更新
   - 删 song_contributors 行 → 对应歌曲 search_text 移除该艺术家
   - 艺术家切 `is_show=false` → 该艺术家名不再参与召回（其歌仍可按歌名搜到）
4. **权限回归**：匿名 `select search_text from songs limit 1` 可读；`song_secrets` 直查仍拒绝
5. **API 回归**：`/v1/search` 加 `&cb=1` 穿透缓存，与改造前结果 diff 为零；Worker 无需重部署

## 六、回滚（零残留）

```sql
BEGIN;
DROP TRIGGER IF EXISTS trg_sst_songs ON public.songs;
DROP TRIGGER IF EXISTS trg_sst_contribs ON public.song_contributors;
DROP TRIGGER IF EXISTS trg_sst_album_contribs ON public.album_contributors;
DROP TRIGGER IF EXISTS trg_sst_artists ON public.artists;
DROP FUNCTION IF EXISTS public.trg_song_search_text();
DROP FUNCTION IF EXISTS public.recompute_song_search_text(text[]);
DROP INDEX IF EXISTS public.idx_songs_search_text_trgm;
ALTER TABLE public.songs DROP COLUMN IF EXISTS search_text;
NOTIFY pgrst, 'reload schema';
COMMIT;
```

随后把 `search_songs` 按 phase3 步骤 6f 原文重跑一遍、`search_songs_structured` 按步骤 5 原文重跑一遍，即与现状完全一致。

## 七、执行记录

> 执行日期：2026-08-28

| 项 | 结果 | 备注 |
|---|---|---|
| 第四节脚本整段执行 | ✅ 通过 | 两次报错均已当场修正进脚本：①`ARRAY(NEW.id)`→`ARRAY[NEW.id]`（标量数组构造器语法）；②`RETURNS SETOF songs` 列数不匹配→select 清单补 `null::text as search_text` 占位 |
| 结果一致性 | ✅ 通过 | `'No Money No Friend 阴三儿In3'` / `'阴三儿in3'` / `'intro'` / `'北京'` / `'爱'` / `'100%'` / `'intro 阴三儿in3'` 与 6f 结果一致 |
| 索引确认 | ✅ 通过 | `show_trgm('北京')` 非空（CJK 可提词）；`'%阴三儿in3%'` + seqscan off 实测 `Bitmap Index Scan on idx_songs_search_text_trgm`。纯中文短模式小表下 planner 选别的 plan 属正常成本选择 |
| 触发器 / 权限 / API 回归 | ✅ 通过 | search_text 触发器同步正常；anon 可读新列；`/v1/search` 带 `&cb=1` 与改造前一致；Worker 零改动 |
