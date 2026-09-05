# 03 · 口令安全演进（明文下发 → song_secrets 拆表）

> 合并自：verify-hidden-unlock-code.md、revoke-unlock-code-column.md、search-songs-hardening.md（口令部分）、
> phase3-song-secrets.md（全部已执行，2026-08-25 ~ 08-28）
>
> **本文含现行权威版 SQL**（verify_hidden_unlock_code 三态版 + song_has_own_code + song_secrets DDL）。

## 一句话现状

口令存在独立表 `song_secrets`（anon 零授权零策略，默认拒绝），唯一读口令入口是
SECURITY DEFINER 的 `verify_hidden_unlock_code` RPC——验证在数据库端完成，只返回结果不回口令。
songs 表已无 unlock_code 列。

## 出发点：v2 时代的口令是裸奔的

- 前端比对口令：anon key 直接读 `settings.hidden_unlock_code`（实际被 RLS 挡掉，全局口令永远失败）
  和 `songs.unlock_code`（**明文随接口响应下发**，懂行的人看一眼网络面板就能绕过口令直接拿歌词）

## 第一版尝试：RPC + 列级收权（三轮补丁，全部被拆表取代）

| 轮 | 方案 | 结果 |
|---|---|---|
| v1 | 列级 revoke unlock_code | **空操作**——Supabase 给 anon 的是表级授权，列级 revoke 撤不掉 |
| v2 | 表级收回 + 手写列清单重授 | revoke 生效但 grant 没成功（手写清单与真实表结构不符报错被跳过），anon 对 songs 零读权限，前台直接不可用 |
| v3 | 列清单从 pg_attribute 动态生成 | 终于生效；顺带衍生出 search_songs 的 unlock_code 置 null 占位（该部分沿革见 02） |

v1 的函数还有个签名 bug：`p_song_id` 误声明为 uuid，而 songs.id 实为 text，调用报 22P02。

**教训**：在「default-open + 处处设卡」的模型下，每一个读路径都要单独堵——列级授权、
RPC 占位、禁止 SELECT * 纪律、专项回归……补丁链越拉越长，永远担心漏一处。

## 最终方案：拆表 song_secrets（phase3，default-closed）

安全模型反转：**「default-open + 处处设卡」→「default-closed + 一个正门」**。
口令拆去独立表，anon 对它零授权零策略（默认拒绝），整条补丁链（列级授权、置 null、SELECT * 纪律）连根作废。

### 表结构（现行，DDL 备查）

```sql
CREATE TABLE public.song_secrets (
  song_id     text PRIMARY KEY REFERENCES public.songs(id) ON DELETE CASCADE,
  unlock_code text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- 权限：REVOKE ALL FROM anon（Supabase 新建表默认授权坑，见 01）；authenticated 增删改查；RLS 策略仅 authenticated
-- 迁移语义：非空口令入表；空口令 = 用全局口令，无需行
```

### 现行权威 SQL：verify RPC（三态版）+ 独立口令探测

```sql
BEGIN;

-- 通行证语义：全局口令验证一次 = 会话通行证，对无独立口令的隐藏歌处处生效；
-- 设了独立口令的歌不认通行证，必须逐首验
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

  -- 全局口令（settings 受 RLS 保护，security definer 以函数属主身份读取）
  select s.value into v_global
  from public.settings s
  where s.key = 'hidden_unlock_code';

  if v_global is not null and v_global <> '' and p_code = v_global then
    return 'global';
  end if;

  -- 歌曲独立口令：只读 song_secrets（anon 对该表零授权，此函数是唯一正门）
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

### 演化小史：verify 返回类型 boolean → text

拆表初版 verify 返回 boolean（命中/未命中）。后按通行证语义改为三态：
前端需要区分「全局口令命中（可当会话通行证）」与「歌曲独立口令命中（仅此首）」，
boolean 无法表达，改返回 `'global' | 'song' | ''`，并配套 `song_has_own_code` 探测
（区分「无独立口令（通行证适用）」与「有独立口令（必须逐首验）」）。

## 踩过的坑

| 坑 | 教训 |
|---|---|
| v1 参数声明 uuid 但 id 是 text | 参数类型不同会形成**重载**而非替换，必须显式 DROP 旧签名 |
| 列级 revoke 空操作 | Supabase 授权是表级的；结构性问题别用列级补丁修 |
| v2 grant 静默失败（整段粘贴执行时 revoke 在前已生效） | 手写列清单与真实表结构对不上就报错，动态生成才可靠 |
| 代码切换期 schema cache 报错（旧代码读写已删的 unlock_code 列） | 重部署前端解决 |
| phase2 B 段删旧列连累 get_artist_songs 运行时报错 | 拆表时顺带做了单源重写修复（见 01） |

## 执行记录（2026-08-27 ~ 08-28）

| 步 | 结果 | 备注 |
|---|---|---|
| 1 建表 + 迁移 + 修复 get_artist_songs | ✅ | 迁移行数 = 非空口令数 |
| 3 删列 + RPC 收尾 | ✅ | verify 冒烟 'global'/false 通过；清口令后回退全局口令验证通过 |
| 4 通行证语义 | ✅ | 三态 + song_has_own_code |
| 脏数据清理 | ✅ | 删测试/孤儿艺术家 5 个（pice、testwang、art_chill9、art_yanxiang、art_chensixing） |
| anon 越权回归 | ✅ | anon 直查 song_secrets 报 permission denied |
