# SQL + API 方案：搜索接口结构化查询（title/artist）

日期：2026-08-26
状态：SQL 已执行并验证通过（①~⑦ 全过）；Worker/插件/文档代码已改，待 Worker 部署 + API 回归 + 插件重打包
前置：[search-songs-artist-match.md](search-songs-artist-match.md) v3 已执行（keyword 已支持艺术家名/别名匹配）

> ⚠️ **部分废弃**：本文的 SQL 主体（`search_songs_structured` 函数体）已被 phase3 的 6f 版重写覆盖（见 [phase3-song-secrets.md](phase3-song-secrets.md)）；**API 层 `title`/`artist` 参数设计仍然有效**。SQL 部分请勿按本文重跑。

## 背景

现行 `/v1/search` 只有 `keyword` 单参数（整串模糊）。API 调用者（Lyrico、MusicTag 等打标工具）手里**本来就有结构化的 title/artist 字段**（来自文件 tag），却被 API 逼着拼成一坨字符串，再让服务端猜怎么切——搜「17 Avril Lavigne」返回歌名叫《Avril Lavigne》的翻唱（MusicBrainz 场景实锤）、搜「Right now YoungQueenz」整串匹配不到返回 0 条（LrcShare 场景实锤）。

曾考虑 v4「服务端多 token AND + 猜切分排序」，被否：**把「猜 Lyrico 拼接方式」塞进服务端，是让全体 API 调用者为 Lyrico 的缺陷买单**。行业正统做法是结构化查询：MusicBrainz `recording:"x" AND artist:"y"`、Last.fm `track=x&artist=y`、Spotify `track:x artist:y`。

## 方案总览（三层各司其职）

### 1. API 层：`/v1/search` 新增可选参数 `title` / `artist`

```
GET /v1/search?type=song&keyword=xxx                       → 模糊搜索（现状不变）
GET /v1/search?type=song&title=17&artist=Avril Lavigne     → 歌名+演唱者 AND 查询（新增）
GET /v1/search?type=album&title=同名专辑&artist=某艺术家    → 专辑名+专辑艺术家 AND 查询（新增）
```

| 规则 | 说明 |
| --- | --- |
| 适用维度 | `type=song`、`type=album`；`type=artist` / `lyric` 传结构化参数报 400 |
| title 匹配 | song：歌名 ∪ 歌的别名（ilike 含子串）；album：专辑名 |
| artist 匹配 | song：**仅演唱者**（`artist_ids` 对应艺术家的名 ∪ 别名，精确对应 TPE1/ARTIST 标签）；album：专辑艺术家（`artist_ids` 的名 ∪ 别名，对应 TPE2/ALBUMARTIST） |
| 单参数 | 允许只传一个：只传 `artist` 等于列出该艺术家（含别名命中）全部已发布歌曲/专辑 |
| 互斥 | `keyword` 与 `title`/`artist` 同传报 400 |
| 两个都空 | 400（与 keyword 缺失同语义） |
| 隐藏艺术家 | 不参与匹配（`is_show is not false`，与 v3 一致） |
| 排序 | `title asc`（结果集小，稳定序即可分页） |

服务端**零猜测、零特化**：朴素 `ilike AND ilike`，《Avril Lavigne》翻唱在 `title=17` 下直接出局。

### 2. 库端：两个新 RPC（PostgREST 做不了数组元素 ilike，别名匹配必须库端）

`keyword` 的 `search_songs`（v3 版）**不动**。

### 3. Lyrico 特化逻辑回插件端（它最了解 Lyrico 的拼接规律）

插件 `searchSongs` 拿到 keyword：整串直传 `keyword` 搜一次（v3 已能命中艺术家名）→ 0 条时按「title 在前 artist 在后」穷举切分点（≤6），每次切分调一次 `title=前段&artist=后段`，第一个有结果的切分即目标。典型 2 次请求，最坏 7 次。

## SQL（Supabase SQL Editor 执行）

```sql
-- ============ song 维度：歌名 ∪ 歌别名 × 演唱者名 ∪ 别名 ============
-- 继承 v2 加固：动态列生成、unlock_code 恒 null、status='published'、SETOF songs

do $do$
declare
  sel_list text;
begin
  select string_agg(
           case when attname = 'unlock_code'
             then format('null::%s as %I', format_type(atttypid, atttypmod), attname)
             else quote_ident(attname)
           end,
           ', ' order by attnum)
    into sel_list
  from pg_attribute
  where attrelid = 'public.songs'::regclass
    and attnum > 0
    and not attisdropped;

  execute format($fn$
    create or replace function public.search_songs_structured(p_title text default null, p_artist text default null)
    returns setof public.songs
    language sql
    stable
    as $body$
      select %s
      from public.songs s
      where s.status = 'published'
        and (
          p_title is null
          or s.title ilike '%%' || p_title || '%%'
          or exists (select 1 from unnest(coalesce(s.aliases, '{}')) a where a ilike '%%' || p_title || '%%')
        )
        and (
          p_artist is null
          or exists (
            select 1
            from public.artists ar
            where ar.is_show is not false
              and ar.id = any(s.artist_ids)
              and (
                ar.name ilike '%%' || p_artist || '%%'
                or exists (select 1 from unnest(coalesce(ar.aliases, '{}')) al where al ilike '%%' || p_artist || '%%')
              )
          )
        )
      order by s.title asc
    $body$;
  $fn$, sel_list);
end
$do$;

-- ============ album 维度：专辑名 × 专辑艺术家名 ∪ 别名 ============
-- albums 无隐藏概念（与现有 /v1/albums 行为一致，全可见）

create or replace function public.search_albums_structured(p_name text default null, p_artist text default null)
returns setof public.albums
language sql
stable
as $body$
  select a.*
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
$body$;

grant execute on function
  public.search_songs_structured(text, text),
  public.search_albums_structured(text, text)
to anon, authenticated;
```

说明：

- `%%` 为 format() 转义百分号（仅 songs 的 do 块内），生成后即普通 `%`
- 两个参数全 null 时不过滤（返回全部），空值防护由 Worker 层参数校验兜底（缺 title/artist 且缺 keyword 一律 400）
- 不用 security definer，artists 表走调用者权限（anon 可读，与 v3 相同）

## Worker 改造（open-api.js，需重新部署）

`/v1/search` 路由入口处：

1. 解析 `title` / `artist` 参数（trim）
2. 校验：`keyword` 与 `title`/`artist` 同传 → 400；`type` 非 `song`/`album` 却传结构化参数 → 400；两者都空沿用现有 keyword 必填校验
3. `type=song` + 结构化 → PostgREST `rpc/search_songs_structured`，query 串 `p_title=…&p_artist=…` + `select=SONG_SUMMARY_SELECT` + limit/offset
4. `type=album` + 结构化 → `rpc/search_albums_structured`，query 串 + `select=ALBUM_SELECT` + limit/offset
5. 响应结构不变：`{ code, data: { keyword/title/artist, type, total: null, items } }`，缓存沿用 `TTL_LIST`（10 分钟）

## Lyrico 插件改造（com.lrcshare.source，需重打包）

`searchSongs` 替换本次讨论期间的临时「切分穷举」补丁为：

```
keyword 整串调 ?keyword=（v3 已支持艺术家名命中）
  → 有结果直接用
  → 0 条且含空格：切分点 i=1..6，调 ?title=前段&artist=后段，首个有结果的切分即目标
  → 全部落空：返回 []
```

## 文档更新（docs/api/search.md）

- 参数表新增 `title` / `artist`（可选，适用 `type=song|album`，与 `keyword` 互斥）
- 补一节「结构化查询」：打标场景示例 `?type=song&title=17&artist=Avril Lavigne`、同名专辑场景示例 `?type=album&title=II&artist=xxx`
- 标注 artist 语义：song 为演唱者（TPE1），album 为专辑艺术家（TPE2），均含别名命中

## 验证

```sql
-- ① 结构化精确命中：应返回 Right now (otaku mobb remix)（keyword 整串搜索为 0 条）
select id, title from search_songs_structured(p_title => 'Right now', p_artist => 'YoungQueenz');

-- ② 单传 artist：应返回 YoungQueenz 全部已发布歌曲
select id, title from search_songs_structured(p_artist => 'YoungQueenz');

-- ③ 艺术家别名命中
select id, title from search_songs_structured(p_artist => '龙胆紫');

-- ④ 加固仍生效：恒为 true
select unlock_code is null as ok from search_songs_structured(p_title => 'Right now') limit 1;

-- ⑤ 专辑结构化：同名专辑 + 专辑艺术家过滤
select id, name from search_albums_structured(p_name => 'II', p_artist => 'xxx');

-- ⑥ keyword 回归（v3 不受影响）
select id, title from search_songs('龙胆紫');
```

API 回归（Worker 部署后）：

```bash
curl "https://api.lrcshare.com/v1/search?type=song&title=Right%20now&artist=YoungQueenz"
# 期望：code=200，items 含 Right now (otaku mobb remix)
curl "https://api.lrcshare.com/v1/search?type=song&keyword=xx&title=yy"
# 期望：code=400（互斥）
```

## 执行顺序

1. 执行本文档 SQL（两个 RPC）
2. 库端验证 ①~⑥
3. Worker 改造 + 部署 + curl 回归
4. LrcShare 插件替换临时补丁为「keyword 直传 + 切分穷举调结构化参数」+ 重打包
5. 更新 docs/api/search.md
