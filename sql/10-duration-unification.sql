-- ============================================================
-- 10 · 歌曲时长统一清洗为 mm:ss（对应 10-duration-unification-evolution.md）
-- 执行环境：Supabase SQL Editor（PostgreSQL）
-- 用法：严格按章节顺序执行。先跑「0 → 2」做备份+预览，确认 A/B 两类结果
--       无误后，再跑「3 更新」，最后跑「4 校验」。全部幂等可重跑。
-- ============================================================


-- ------------------------------------------------------------
-- 0. 备份所有「非标准 / 空值」时长（含 songs 与 submissions）
--    备份表已存在则跳过（如需重建先 drop table _backup_duration_20261005）
-- ------------------------------------------------------------
create table if not exists _backup_duration_20261005 as
select 'songs'::text       as src,
       id::text            as row_id,
       duration            as old_value
from songs
where duration is not null
  and duration !~ '^[0-9]{2}:[0-9]{2}$'
union all
select 'submissions'::text,
       id::text,
       song_data->>'duration'
from submissions
where song_data ? 'duration'
  and coalesce(song_data->>'duration', '') !~ '^[0-9]{2}:[0-9]{2}$';

-- 确认备份行数：
select src, count(*) from _backup_duration_20261005 group by src order by src;


-- ------------------------------------------------------------
-- 1. 创建时长归一化函数（纯函数；规则见 MD 文档第二节）
-- ------------------------------------------------------------
create or replace function public.normalize_duration(raw text)
returns text
language plpgsql
immutable
as $$
declare
  v text;
  i int;
  m text[];
  min_part text;
  sec_part text;
begin
  -- 规则 1：null / 空串 / 纯空白 → null（空值口径统一为 null）
  if raw is null or btrim(raw) = '' then
    return null;
  end if;

  v := btrim(raw);

  -- 规则 2：全角数字 ０(FF10)～９(FF19) → 半角（用码位循环替换，避免手写生僻字符）
  for i in 0..9 loop
    v := replace(v, chr(65296 + i), i::text);
  end loop;

  -- 规则 2：Unicode 冒号 → 半角冒号
  --   ：全角冒号 U+FF1A；︰竖排呈现形 U+FE13
  v := replace(v, chr(65306), ':');
  v := replace(v, chr(65043), ':');

  if position(':' in v) > 0 then
    -- 规则 3：有冒号 = 分:秒；小数点起视为毫秒整段丢弃（半角 . / 全角 ．U+FF0E）
    v := regexp_replace(v, '[.' || chr(65294) || '].*$', '');
    -- 此时应为「数字:数字」，秒允许 1~2 位
    m := regexp_match(v, '^([0-9]+):([0-9]{1,2})$');
  else
    -- 规则 4：无冒号有点号 = 分.秒（如 05.37 → 05:37）
    v := replace(v, chr(65294), '.');
    m := regexp_match(v, '^([0-9]+)\.([0-9]{1,2})$');
  end if;

  -- 规则 6：无法解析（纯秒数 / 多段 / 含字母等）不猜测，返回 null
  if m is null then
    return null;
  end if;

  min_part := m[1];
  sec_part := m[2];

  -- 规则 6：秒必须 0–59（不做进位；非法直接 null）
  if sec_part::int > 59 then
    return null;
  end if;

  -- 规则 5：分、秒各补齐两位（分钟原值不截断）
  return lpad(min_part, 2, '0') || ':' || lpad(sec_part, 2, '0');
end;
$$;


-- ------------------------------------------------------------
-- 2. 执行前预览（只 SELECT，不改数据）
-- ------------------------------------------------------------

-- 2-A：可自动转换的行（旧值 → 新值）
select 'songs'::text as src, id::text as row_id,
       duration as old_value, normalize_duration(duration) as new_value
from songs
where duration is distinct from normalize_duration(duration)
  and not (btrim(coalesce(duration, '')) <> '' and normalize_duration(duration) is null)
union all
select 'submissions', id::text,
       song_data->>'duration', normalize_duration(song_data->>'duration')
from submissions
where song_data ? 'duration'
  and (song_data->>'duration') is distinct from normalize_duration(song_data->>'duration')
  and not (btrim(coalesce(song_data->>'duration', '')) <> ''
           and normalize_duration(song_data->>'duration') is null)
order by src, row_id;

-- 2-B：无法解析、将被置 null 的非空值——请逐行确认。
--      如需保留某行，先手动 update 成标准 mm:ss 再执行第 3 节（幂等）。
select 'songs'::text as src, id::text as row_id, duration as old_value
from songs
where btrim(coalesce(duration, '')) <> ''
  and normalize_duration(duration) is null
union all
select 'submissions', id::text, song_data->>'duration'
from submissions
where song_data ? 'duration'
  and btrim(coalesce(song_data->>'duration', '')) <> ''
  and normalize_duration(song_data->>'duration') is null
order by src, row_id;


-- ------------------------------------------------------------
-- 3. 正式更新（确认 2-A / 2-B 后执行）
-- ------------------------------------------------------------
begin;

-- songs：仅更新转换后与旧值不同的行（空串 → null，m:ss → mm:ss，去毫秒）
update songs
set duration = public.normalize_duration(duration)
where duration is distinct from public.normalize_duration(duration);

-- submissions：只改 jsonb 中的 duration 键，song_data 其余内容原样保留
-- 注意：归一化结果为 NULL（空串/无法解析）时，直接移除 duration 键；
--   不能用 jsonb_set(..., to_jsonb(NULL))——SQL NULL 会使 jsonb_set 整体
--   返回 NULL，违反 song_data 的 NOT NULL 约束（2026-10-05 实测踩坑）。
update submissions
set song_data = case
      when public.normalize_duration(song_data->>'duration') is null
        then song_data - 'duration'
      else jsonb_set(
        song_data,
        '{duration}',
        to_jsonb(public.normalize_duration(song_data->>'duration')))
      end
where song_data ? 'duration'
  and (song_data->>'duration') is distinct from
      public.normalize_duration(song_data->>'duration');

-- 先检查上面两个 UPDATE 影响的行数是否与预览一致；确认后执行 commit，
-- 有异议执行 rollback：
commit;
-- rollback;


-- ------------------------------------------------------------
-- 4. 执行后校验（两个查询都必须返回 0）
-- ------------------------------------------------------------
select 'songs' as tbl, count(*) as bad_count
from songs
where duration is not null
  and duration !~ '^[0-9]{2}:[0-9]{2}$'
union all
select 'submissions', count(*)
from submissions
where song_data ? 'duration'
  and song_data->>'duration' is not null
  and song_data->>'duration' !~ '^[0-9]{2}:[0-9]{2}$';

-- 可选：清洗确认无误后，删除临时函数与备份表
-- drop function if exists public.normalize_duration(text);
-- drop table if exists _backup_duration_20261005;
