# SQL 方案：隐藏歌词口令校验 RPC

日期：2026-08-25
状态：已执行，v2 修正（p_song_id 类型 uuid → text）

## 背景

`SongView.vue` 解锁口令原为前端比对：anon key 直接读 `settings.hidden_unlock_code`，但 settings 表 RLS 全员可读项仅 `site_name`、`admin_email`，查回为空，全局口令永远失败；歌曲独立口令则依赖 `songs.unlock_code` 明文下发到客户端比对，接口响应即可看到口令。

前端已改为调用 RPC `verify_hidden_unlock_code(p_song_id, p_code)`，口令校验全部在数据库端完成，只返回布尔值。

## v1 → v2 修正记录

v1 把 `p_song_id` 声明为 `uuid`，但 songs 表 `id` 列实为 `text`（歌曲 id 形如 `s_purplesoul_013`），调用报 `22P02 invalid input syntax for type uuid`。v2 改为 `text`，并先 drop 掉 v1 的 uuid 签名函数（参数类型不同会形成重载而非替换，必须显式删除）。**v1 已在库中执行过的，必须跑完整 v2 脚本（含 drop）。**

## 变更内容

新增 1 个函数，无表结构变更，无数据变更。

```sql
-- 删除 v1 的 uuid 签名（若存在）
drop function if exists public.verify_hidden_unlock_code(uuid, text);

-- 校验隐藏歌词解锁口令（全局口令 / 歌曲独立口令），供前端匿名调用
create or replace function public.verify_hidden_unlock_code(
  p_song_id text,
  p_code text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_global text;
  v_song text;
begin
  if p_code is null or btrim(p_code) = '' then
    return false;
  end if;

  -- 全局口令（settings 受 RLS 保护，security definer 以函数属主身份读取，绕过 RLS）
  select s.value into v_global
  from public.settings s
  where s.key = 'hidden_unlock_code';

  if v_global is not null and v_global <> '' and p_code = v_global then
    return true;
  end if;

  -- 歌曲独立口令
  if p_song_id is not null then
    select t.unlock_code into v_song
    from public.songs t
    where t.id = p_song_id;

    if v_song is not null and v_song <> '' and p_code = v_song then
      return true;
    end if;
  end if;

  return false;
end;
$$;

-- 仅匿名/登录用户可调用，返回布尔值不泄露口令
revoke execute on function public.verify_hidden_unlock_code(text, text) from public;
grant execute on function public.verify_hidden_unlock_code(text, text) to anon, authenticated;
```

## 说明

- `security definer` + `set search_path = public`：以函数属主身份读取 settings/songs，绕过 RLS；属主需为表属主角色（默认 postgres，Supabase SQL Editor 中创建即为该角色）
- 调用方：前端 `api.supabase.rpc('verify_hidden_unlock_code', { p_song_id, p_code })`，已改造完成
- 未执行此 SQL 前，前端解锁会提示「解锁失败，请稍后重试」（函数不存在触发 error）
- 原有 RLS 策略无需改动，`hidden_unlock_code` 继续对前端不可见

## 遗留问题（本次不处理）

- `api.getSong` 为 `select *`，隐藏歌曲的 `unlock_code`（以及解锁后重拉时的 `lrc_text`）仍会出现在 anon 接口响应中，懂行的人可直接绕过口令。如需彻底封堵，需收窄 select 字段或改造歌曲读取 RPC，确认后另行出方案
