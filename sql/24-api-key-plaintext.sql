-- ============================================================================
-- 24 · API Key 明文入库存档
-- 执行环境：Supabase SQL Editor（PostgreSQL）
-- 用法：整段一次性执行（单事务，失败整体回滚）。
--
-- 背景：21 号脚本按常规安全惯例只存 SHA-256 哈希、明文仅签发时显示一次，
--   导致后台再也查不到 Key 明文。实际运维需要明文参与两件事：
--     1. 在 Cloudflare WAF 白名单规则里填写「合法 Key 集合」（规则只能匹配明文字符串）
--     2. 客户端配置丢失时，管理员能重新取回并下发
-- 权衡：若攻击者已突破 admin RLS，哈希并不能阻止其调用 API（可直接改表或调 RPC），
--   因此明文存档不构成额外实质风险；且 Key 本就随客户端分发。
--
-- 说明：
--   - 新增列对历史行默认为 NULL（旧 Key 明文已永久丢失，无法回填的保持 NULL）
--   - 校验逻辑不变：Worker 仍用 SHA-256(key) 与 KV 中的 active hash 比对
--   - RLS 不变：api_keys 现有策略为 TO authenticated，新列自动继承，anon 仍不可见
-- ============================================================================

BEGIN;

ALTER TABLE public.api_keys
  ADD COLUMN IF NOT EXISTS key_plain text;

COMMENT ON COLUMN public.api_keys.key_plain IS
  'API Key 明文（仅管理员可见；历史 Key 明文已丢失为 NULL，仅供展示与 WAF 白名单维护）';

-- 回填已知明文的历史 Key（按 key_hash 精确匹配，避免 key_prefix 撞车）
-- 依赖 pgcrypto 的 digest()；若提示 function digest does not exist，
-- 改用 extensions.digest(...)，或在脚本开头加 SET search_path = public, extensions;
UPDATE public.api_keys SET key_plain = 'ls_b9160c7f8789e7b450e3c7c479b00da6'
  WHERE key_hash = encode(digest('ls_b9160c7f8789e7b450e3c7c479b00da6', 'sha256'), 'hex');
UPDATE public.api_keys SET key_plain = 'ls_280602e9fdfd79f910b2d4962f8f78d8'
  WHERE key_hash = encode(digest('ls_280602e9fdfd79f910b2d4962f8f78d8', 'sha256'), 'hex');
UPDATE public.api_keys SET key_plain = 'ls_7d6c9313d01b029255be682fbd8c7ed2'
  WHERE key_hash = encode(digest('ls_7d6c9313d01b029255be682fbd8c7ed2', 'sha256'), 'hex');

COMMIT;

-- ============================================================================
-- 验证查询（执行后确认）：
--   SELECT name, key_prefix, key_plain IS NOT NULL AS has_plain, status
--   FROM public.api_keys ORDER BY created_at;
-- ============================================================================
