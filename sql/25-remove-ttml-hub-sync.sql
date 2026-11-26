-- ============================================================================
-- 25 · 移除 ttml-hub 同步（LunaBeat TTML HUB 连接）
-- 执行环境：Supabase SQL Editor（PostgreSQL）
-- 用法：整段一次性执行（单事务，失败整体回滚）。
--
-- 背景：终止与第三方歌词库 LunaBeat TTML HUB 的同步接入。
--   - 同步链路（Cloudflare Worker / GitHub Actions / Node 脚本）与后台管理页已从代码库移除
--   - 已入库歌词版本（lyric_versions.source = 'ttml-hub'）与「来自 TTML Hub」署名**保留**
--   - 本脚本仅删除同步过程使用的两张中间表，不影响 lyric_versions 及任何歌/版本数据
--
-- 说明：
--   - 两张表的 RLS policy / 索引 / CHECK 约束随 DROP TABLE 一并删除
--   - lyric_versions 无外键引用这两张表，DROP 无级联影响
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS public.ttml_hub_pending;
DROP TABLE IF EXISTS public.ttml_hub_state;

COMMIT;

-- ============================================================================
-- 验证查询（执行后确认）：
--   SELECT to_regclass('public.ttml_hub_pending') AS pending,
--          to_regclass('public.ttml_hub_state')   AS state;
--   -- 两列均应为 NULL，表示表已删除
--   -- 同时确认已入库歌词仍在：
--   SELECT count(*) AS ttml_hub_versions
--   FROM public.lyric_versions WHERE source = 'ttml-hub';
-- ============================================================================
