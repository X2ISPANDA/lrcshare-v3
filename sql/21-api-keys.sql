-- ============================================================================
-- 21 · API Key 管理：api_keys 建表 + RLS + updated_at 触发器
-- 执行环境：Supabase SQL Editor（PostgreSQL）
-- 用法：整段一次性执行（单事务，失败整体回滚）。
--
-- 背景：开放 API 从「匿名调用」升级为「注册制 API Key + catalog-first」。
--   - 调用方必须携带 X-API-Key 头；Worker 查 api_keys 表验证 hash + status。
--   - 管理员在后台手动签发 Key（明文只显示一次，库内只存 SHA-256 哈希）。
--   - 封禁 = status 置 'banned'，配合 Worker 端 KV 缓存即时失效。
--
-- 安全模型：
--   - RLS 开启，仅 authenticated（管理员）可读写；anon 完全不可访问。
--   - key_hash 为 SHA-256 十六进制串（64 字符），不存明文。
--   - key_prefix 仅用于后台列表识别（前 8 位），不用于校验。
-- ============================================================================

BEGIN;

-- ============ 1. 建表 ============
CREATE TABLE IF NOT EXISTS public.api_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,                    -- 客户端名称（如「Lyrico 插件」）
  key_hash    text NOT NULL,                    -- API Key 的 SHA-256 哈希（64 位十六进制）
  key_prefix  text NOT NULL,                    -- Key 前 8 位，后台列表识别用
  status      text NOT NULL DEFAULT 'active'
              CHECK (status IN ('active', 'banned')),
  note        text,                             -- 备注（谁在用、联系方式）
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT api_keys_key_hash_len_chk CHECK (char_length(key_hash) = 64),
  CONSTRAINT api_keys_key_prefix_len_chk CHECK (char_length(key_prefix) = 8)
);

-- ============ 2. RLS ============
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;

-- 仅 authenticated（管理员）可读
DROP POLICY IF EXISTS api_keys_select ON public.api_keys;
CREATE POLICY api_keys_select ON public.api_keys
  FOR SELECT TO authenticated USING (true);

-- 仅 authenticated（管理员）可增
DROP POLICY IF EXISTS api_keys_insert ON public.api_keys;
CREATE POLICY api_keys_insert ON public.api_keys
  FOR INSERT TO authenticated WITH CHECK (true);

-- 仅 authenticated（管理员）可改
DROP POLICY IF EXISTS api_keys_update ON public.api_keys;
CREATE POLICY api_keys_update ON public.api_keys
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

-- 仅 authenticated（管理员）可删
DROP POLICY IF EXISTS api_keys_delete ON public.api_keys;
CREATE POLICY api_keys_delete ON public.api_keys
  FOR DELETE TO authenticated USING (true);

-- 纵深防御：收回 public 的所有权限（RLS 已挡，但 REVOKE 双保险）
REVOKE ALL ON public.api_keys FROM PUBLIC;
REVOKE ALL ON public.api_keys FROM anon;

-- ============ 3. updated_at 触发器 ============
-- 复用项目通用的 set_updated_at 函数（若不存在则创建私有函数）。
-- 注意：DO 块用 $$ 分隔，内部函数体必须用不同的分隔符（$func$），否则 $$ 会提前闭合外层。
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'set_updated_at') THEN
    CREATE OR REPLACE FUNCTION public.set_updated_at()
    RETURNS trigger AS $func$
    BEGIN
      NEW.updated_at = now();
      RETURN NEW;
    END;
    $func$ LANGUAGE plpgsql;
  END IF;
END $$;

DROP TRIGGER IF EXISTS api_keys_set_updated_at ON public.api_keys;
CREATE TRIGGER api_keys_set_updated_at
  BEFORE UPDATE ON public.api_keys
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ============ 4. Worker 查询用 RPC（SECURITY DEFINER） ============
-- Worker 用 anon key 调用，RLS 不允许 anon 直读 api_keys 表。
-- 此函数以表所有者权限执行，仅返回 active 状态的 key_hash 数组（不含 name/note 等）。
-- key_hash 为 SHA-256，不可逆，暴露无妨。
CREATE OR REPLACE FUNCTION public.get_active_api_key_hashes()
RETURNS text[]
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(key_hash), ARRAY[]::text[])
  FROM public.api_keys
  WHERE status = 'active';
$$;

-- 允许 anon 调用（Worker 端用）
GRANT EXECUTE ON FUNCTION public.get_active_api_key_hashes() TO anon;

COMMIT;

-- ============================================================================
-- 验证查询（执行后确认）：
--   -- 表存在
--   SELECT to_regclass('public.api_keys') IS NOT NULL AS table_exists;
--   -- RLS 已开启
--   SELECT relrowsecurity FROM pg_class WHERE relname = 'api_keys';
--   -- 无明文 key（只有 hash）
--   SELECT id, name, key_prefix, status, created_at FROM public.api_keys;
-- ============================================================================
