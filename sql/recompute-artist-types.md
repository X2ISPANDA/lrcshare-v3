# recompute_artist_types：艺术家类型派生重算 RPC

## 背景

`artists.types` 不再人工维护，改为从歌曲/专辑关联派生：

- 演唱（`songs.artist_ids`）或专辑艺术家（`albums.artist_ids`）→ `singer`
- `songs.lyricist` / `composer` / `arranger`（ID 逗号分隔 text）→ 对应类型

前端原先把 songs/albums 两张表拉到浏览器内存里算，再逐艺术家 update（多次 HTTP 往返）。本函数把整套计算收进 Postgres，前端一次 `supabase.rpc('recompute_artist_types', ...)` 搞定，也供后台「重算全部类型」按钮使用。

## SQL（Supabase SQL Editor 执行）

```sql
CREATE OR REPLACE FUNCTION public.recompute_artist_types(p_artist_ids text[] DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER   -- 走调用方 RLS：仅登录管理员可触发（与后台直接 update artists 同权限）
AS $function$
BEGIN
  UPDATE public.artists a
  SET types = (
    SELECT COALESCE(array_agg(DISTINCT role), '{}'::text[])
    FROM (
      -- 演唱或专辑艺术家 → singer
      SELECT 'singer'::text AS role
      WHERE EXISTS (SELECT 1 FROM public.songs s WHERE a.id = ANY(s.artist_ids))
         OR EXISTS (SELECT 1 FROM public.albums al WHERE a.id = ANY(al.artist_ids))
      UNION ALL
      SELECT 'lyricist'::text
      WHERE EXISTS (SELECT 1 FROM public.songs s WHERE a.id = ANY(string_to_array(s.lyricist, ',')))
      UNION ALL
      SELECT 'composer'::text
      WHERE EXISTS (SELECT 1 FROM public.songs s WHERE a.id = ANY(string_to_array(s.composer, ',')))
      UNION ALL
      SELECT 'arranger'::text
      WHERE EXISTS (SELECT 1 FROM public.songs s WHERE a.id = ANY(string_to_array(s.arranger, ',')))
    ) r
  )
  WHERE p_artist_ids IS NULL OR a.id = ANY(p_artist_ids);
END;
$function$;

COMMENT ON FUNCTION public.recompute_artist_types(text[]) IS
  '按歌曲/专辑关联重算艺术家 types（singer/lyricist/composer/arranger），覆盖式写入；入参空 = 全部艺术家';
```

## 说明

- **覆盖式**：types 永远等于当前关联算出的值，无作品支撑的类型清空（`'{}'`），幂等可反复执行
- **显式列引用**：仅用 songs(artist_ids, lyricist, composer, arranger) / albums(artist_ids) / artists(id, types)，无 `SELECT *`
- **传参约定**：前端传 `p_artist_ids` 数组只重算牵涉艺术家；不传（NULL）全量重算
- **安全**：SECURITY INVOKER，权限与调用方 session 一致；anon 调用会被 artists 表 RLS 拦下
- **幂等部署**：`CREATE OR REPLACE`，重复执行安全；如未来改参数类型需先 DROP（项目约定）
