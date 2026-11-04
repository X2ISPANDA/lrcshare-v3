-- ============================================================================
-- 23 · IP 黑名单：banned_ips 建表 + RLS + get_banned_ips() RPC
-- 执行环境：Supabase SQL Editor（PostgreSQL）
-- 用法：整段一次性执行（单事务，失败整体回滚）。
--
-- 背景：开放 API 接入 Analytics Engine 用量分析后，可按「KEY → IP → 调用量」
--   定位滥用来源。管理员在后台一键封禁异常 IP，Worker 入口读黑名单直接拒绝
--   该 IP 的全部请求（纯 IP 粒度，不影响同 KEY 下其他 IP 的正常调用）。
--
-- IP 归一化约定（Worker 端 normalizeIpForBan 必须与本表存储格式一致，
--   否则「存的」和「比的」对不上，封禁不生效）：
--   - IPv4：原样存储，如 1.2.3.4
--   - IPv6：取前 4 组 + '::/64'，如 2001:db8:85a3:0::/64（封整个 /64 段，
--     覆盖同一宽带用户的 IPv6 分配；完整 IPv6 超出 Analytics Engine 的
--     32 字节 blob 上限，必须压缩）
--
-- 前置依赖：public.is_admin()（由 22-rls-admin-lockdown.sql 创建），需先执行 22。
--
-- 安全模型：
--   - RLS 开启，策略统一校验 public.is_admin()（app_metadata.role='admin'），
--     与 22 号脚本保持一致；普通登录用户无法读写。anon 不可直读表。
--   - Worker 通过 SECURITY DEFINER 函数 get_banned_ips() 取「生效中」IP 列表
--     （expires_at 为 NULL 或尚未到期），已过期的行不会返回。
-- ============================================================================

BEGIN;

-- ============ 1. 建表 ============
CREATE TABLE IF NOT EXISTS public.banned_ips (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ip          text NOT NULL UNIQUE,          -- 归一化后的 IP（IPv4 原样 / IPv6 取 /64 段）
  reason      text,                          -- 封禁原因（如「KEY lyrico-官 单日调用 1.5 万次」）
  expires_at  timestamptz,                   -- 到期时间；NULL = 永久封禁
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT banned_ips_ip_len_chk CHECK (char_length(ip) BETWEEN 3 AND 64)
);

-- ============ 2. RLS ============
ALTER TABLE public.banned_ips ENABLE ROW LEVEL SECURITY;

-- 仅管理员可读（校验 app_metadata.role='admin'，与 22 号脚本一致）
DROP POLICY IF EXISTS banned_ips_select ON public.banned_ips;
CREATE POLICY banned_ips_select ON public.banned_ips
  FOR SELECT TO public USING (public.is_admin());

-- 仅管理员可增
DROP POLICY IF EXISTS banned_ips_insert ON public.banned_ips;
CREATE POLICY banned_ips_insert ON public.banned_ips
  FOR INSERT TO public WITH CHECK (public.is_admin());

-- 仅管理员可改
DROP POLICY IF EXISTS banned_ips_update ON public.banned_ips;
CREATE POLICY banned_ips_update ON public.banned_ips
  FOR UPDATE TO public USING (public.is_admin()) WITH CHECK (public.is_admin());

-- 仅管理员可删
DROP POLICY IF EXISTS banned_ips_delete ON public.banned_ips;
CREATE POLICY banned_ips_delete ON public.banned_ips
  FOR DELETE TO public USING (public.is_admin());

-- 纵深防御：收回 public 的所有权限（RLS 已挡，但 REVOKE 双保险）
REVOKE ALL ON public.banned_ips FROM PUBLIC;
REVOKE ALL ON public.banned_ips FROM anon;

-- ============ 3. Worker 查询用 RPC（SECURITY DEFINER） ============
-- Worker 用 anon key 调用，RLS 不允许 anon 直读 banned_ips 表。
-- 此函数以表所有者权限执行，仅返回生效中的 IP 字符串数组（不含 reason 等管理字段）。
-- 过期行（expires_at <= now()）不返回，到期自动解除封禁。
CREATE OR REPLACE FUNCTION public.get_banned_ips()
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(ip), ARRAY[]::text[])
  FROM public.banned_ips
  WHERE expires_at IS NULL OR expires_at > now();
$$;

-- 允许 anon 调用（Worker 端用）
GRANT EXECUTE ON FUNCTION public.get_banned_ips() TO anon;

COMMIT;

-- ============================================================================
-- 验证查询（执行后确认）：
--   -- 表存在
--   SELECT to_regclass('public.banned_ips') IS NOT NULL AS table_exists;
--   -- RLS 已开启
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'banned_ips';
--   -- RPC 可调用（应返回空数组 '{}'）
--   SELECT public.get_banned_ips();
-- ============================================================================
