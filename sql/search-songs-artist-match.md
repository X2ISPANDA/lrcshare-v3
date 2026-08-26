# SQL 方案：search_songs 增加艺术家匹配（v3）

日期：2026-08-25
状态：待确认

## 问题

`search_songs` 的匹配范围只有**歌名 + 歌的别名**，艺术家完全不在匹配范围内：

- 艺术家 `龍胆紫`（繁体）的别名里有 `龙胆紫Purplesoul`，但搜「龙胆紫Purplesoul」「龙胆紫」都搜不到他的歌——因为 RPC 根本不看 artists 表
- Lyrico 插件的查询词是「歌名 + 艺术家」（如 `龙胆紫 龙胆紫Purplesoul`），整串搜不到后回退最长分词 `龙胆紫Purplesoul`，同样因上述原因落空

## 方案

where 条件增加第三路匹配：歌曲的**演唱者/作词/作曲/编曲**四位一体关联的艺术家中，任一位的 `name` 或 `aliases` 命中关键词即返回该歌曲。

- 演唱：`artist_ids`（text[]）→ `ar.id = any(s.artist_ids)`
- 词曲编：`lyricist` / `composer` / `arranger`（ID 逗号串）→ `ar.id = any(string_to_array(...))`
- 艺术家侧：`name ilike` 或 `aliases` 数组任一元素 ilike
- 隐藏艺术家（`is_show = false`）不参与匹配（与艺术家库可见性一致）
- 保留 v2 加固：动态列生成、`unlock_code` 恒为 null、`status = 'published'` 过滤、`SETOF songs` 返回类型

## 行为变化（需知悉）

此 RPC 主站与开放 API 共用，两边同步生效：

- **单曲搜索现在能按艺术家名/别名搜到歌**——搜「龙胆紫」会返回龍胆紫的全部已发布歌曲（此前返回空）
- 歌名/歌别名匹配逻辑不变，已能搜到的不受影响
- Worker **无需重新部署**（RPC 是库端逻辑，Worker 只是调用方）；Lyrico 插件也**无需重打包**（最长分词回退已能命中艺术家别名）

## SQL（Supabase SQL Editor 执行）

```sql
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
    create or replace function public.search_songs(p_q text)
    returns setof public.songs
    language sql
    stable
    as $body$
      select %s
      from public.songs s
      where s.status = 'published'
        and (
          s.title ilike '%%' || p_q || '%%'
          or exists (select 1 from unnest(coalesce(s.aliases, '{}')) a where a ilike '%%' || p_q || '%%')
          or exists (
            select 1
            from public.artists ar
            where ar.is_show is not false
              and (
                ar.id = any(s.artist_ids)
                or ar.id = any(string_to_array(coalesce(s.lyricist, ''), ','))
                or ar.id = any(string_to_array(coalesce(s.composer, ''), ','))
                or ar.id = any(string_to_array(coalesce(s.arranger, ''), ','))
              )
              and (
                ar.name ilike '%%' || p_q || '%%'
                or exists (select 1 from unnest(coalesce(ar.aliases, '{}')) al where al ilike '%%' || p_q || '%%')
              )
          )
        )
    $body$;
  $fn$, sel_list);
end
$do$;
```

- `%%` 为 format() 转义百分号，生成后即普通 `%`
- 词曲编 CSV 按无空格的干净数据匹配（应用层写入即 `','` 拼接，无空格场景）

## 验证

```sql
-- 艺术家别名命中：应返回龍胆紫的全部已发布歌曲
select id, title from search_songs('龙胆紫Purplesoul');
-- 艺术家别名子串命中：同样应返回
select id, title from search_songs('龙胆紫');
-- 回归：歌名搜索照旧
select id, title from search_songs('紫');
-- 加固仍生效：恒为 true
select unlock_code is null as ok from search_songs('紫') limit 1;
```

## 执行顺序

无前置依赖，单独执行即可。API 文档 search.md 的匹配范围描述已同步更新，随下次 push 生效。
