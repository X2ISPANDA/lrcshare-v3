-- ============================================================================
-- LrcShare 数据库 schema 全量导出函数
-- 在 Supabase SQL Editor 运行一次即可，之后 db-dump.mjs 会通过 RPC 调用它。
-- 只导出 public schema（auth / storage 等 Supabase 内置 schema 不导出）。
-- ============================================================================

CREATE OR REPLACE FUNCTION public.export_schema()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  ddl text := '';
  r record;
  t text;
  col record;
  pk_cols text;
BEGIN
  ddl := ddl || '-- =========================================================' || E'\n';
  ddl := ddl || '-- LrcShare public schema export' || E'\n';
  ddl := ddl || '-- Generated at: ' || now() || E'\n';
  ddl := ddl || '-- =========================================================' || E'\n\n';

  -- 关闭函数体检查，避免 SQL 语言函数因依赖未创建而报错
  ddl := ddl || 'SET check_function_bodies = false;' || E'\n\n';

  -- ── 1. 扩展 ──────────────────────────────────────────────
  ddl := ddl || '-- Extensions' || E'\n';
  FOR r IN
    SELECT e.extname
    FROM pg_extension e
    WHERE e.extname NOT IN ('plpgsql')
    ORDER BY e.extname
  LOOP
    ddl := ddl || format('CREATE EXTENSION IF NOT EXISTS %I;', r.extname) || E'\n';
  END LOOP;
  ddl := ddl || E'\n';

  -- ── 2. 序列 ──────────────────────────────────────────────
  ddl := ddl || '-- Sequences' || E'\n';
  FOR r IN
    SELECT c.relname AS seq_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'S'
    ORDER BY c.relname
  LOOP
    ddl := ddl || format('CREATE SEQUENCE %I;', r.seq_name) || E'\n';
  END LOOP;
  ddl := ddl || E'\n';

  -- ── 3. 表结构 ────────────────────────────────────────────
  ddl := ddl || '-- Tables' || E'\n';
  FOR r IN
    SELECT c.relname AS table_name
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
    ORDER BY c.relname
  LOOP
    ddl := ddl || 'CREATE TABLE ' || quote_ident(r.table_name) || ' (' || E'\n';

    -- 列定义
    FOR col IN
      SELECT
        a.attname AS column_name,
        format_type(a.atttypid, a.atttypmod) AS data_type,
        a.attnotnull AS not_null,
        a.attgenerated AS generated,
        pg_get_expr(ad.adbin, ad.adrelid) AS default_expr
      FROM pg_attribute a
      LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
      WHERE a.attrelid = (SELECT oid FROM pg_class WHERE relname = r.table_name AND relnamespace = 'public'::regnamespace)
        AND a.attnum > 0
        AND NOT a.attisdropped
      ORDER BY a.attnum
    LOOP
      ddl := ddl || '  ' || quote_ident(col.column_name) || ' ' || col.data_type;
      IF col.generated = 's' THEN
        -- 生成列：GENERATED ALWAYS AS (expr) STORED
        ddl := ddl || ' GENERATED ALWAYS AS (' || col.default_expr || ') STORED';
      ELSIF col.default_expr IS NOT NULL THEN
        ddl := ddl || ' DEFAULT ' || col.default_expr;
      END IF;
      IF col.not_null THEN
        ddl := ddl || ' NOT NULL';
      END IF;
      ddl := ddl || ',' || E'\n';
    END LOOP;

    -- 主键约束（内联在 CREATE TABLE 里）
    SELECT string_agg(quote_ident(a.attname), ', ' ORDER BY x.n)
      INTO pk_cols
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS x(attnum, n) ON true
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = x.attnum
    WHERE con.contype = 'p'
      AND c.relname = r.table_name
      AND c.relnamespace = 'public'::regnamespace;

    IF pk_cols IS NOT NULL THEN
      ddl := ddl || '  PRIMARY KEY (' || pk_cols || ')' || E'\n';
    ELSE
      -- 去掉最后一个逗号
      ddl := rtrim(ddl, E',\n') || E'\n';
    END IF;

    ddl := ddl || ');' || E'\n\n';
  END LOOP;

  -- ── 4. 约束（外键 / 唯一 / 检查，非主键）──────────────────
  ddl := ddl || '-- Constraints (FK / Unique / Check)' || E'\n';
  FOR r IN
    SELECT
      c.relname AS table_name,
      con.conname AS constraint_name,
      con.contype AS constraint_type,
      pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND con.contype IN ('f', 'u', 'c')
      AND con.conname NOT LIKE 'pg_%'
    ORDER BY c.relname, con.contype, con.conname
  LOOP
    ddl := ddl || format('ALTER TABLE %I ADD CONSTRAINT %I %s;',
      r.table_name, r.constraint_name, r.def) || E'\n';
  END LOOP;
  ddl := ddl || E'\n';

  -- ── 5. 索引（非主键索引，主键已在建表时创建）──────────────
  ddl := ddl || '-- Indexes' || E'\n';
  FOR r IN
    SELECT
      c.relname AS table_name,
      idx.relname AS index_name,
      pg_get_indexdef(idx.oid) AS def
    FROM pg_index i
    JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_class c ON c.oid = i.indrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT i.indisprimary
      AND NOT i.indisunique  -- 唯一约束的索引已由约束创建
      AND idx.relname NOT LIKE 'pg_%'
    ORDER BY c.relname, idx.relname
  LOOP
    ddl := ddl || r.def || ';' || E'\n';
  END LOOP;
  ddl := ddl || E'\n';

  -- ── 6. 注释（表 & 列）────────────────────────────────────
  ddl := ddl || '-- Comments' || E'\n';
  FOR r IN
    SELECT c.relname AS table_name, obj_description(c.oid) AS comment
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND obj_description(c.oid) IS NOT NULL
    ORDER BY c.relname
  LOOP
    ddl := ddl || format('COMMENT ON TABLE %I IS %L;', r.table_name, r.comment) || E'\n';
  END LOOP;
  FOR r IN
    SELECT
      c.relname AS table_name,
      a.attname AS column_name,
      col_description(c.oid, a.attnum) AS comment
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_attribute a ON a.attrelid = c.oid
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND a.attnum > 0 AND NOT a.attisdropped
      AND col_description(c.oid, a.attnum) IS NOT NULL
    ORDER BY c.relname, a.attnum
  LOOP
    ddl := ddl || format('COMMENT ON COLUMN %I.%I IS %L;',
      r.table_name, r.column_name, r.comment) || E'\n';
  END LOOP;
  ddl := ddl || E'\n';

  -- ── 7. RLS ──────────────────────────────────────────────
  ddl := ddl || '-- Row Level Security' || E'\n';
  FOR r IN
    SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relrowsecurity
    ORDER BY c.relname
  LOOP
    ddl := ddl || format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', r.table_name) || E'\n';
  END LOOP;
  FOR r IN
    SELECT
      schemaname, tablename, policyname, permissive, roles, cmd,
      qual, with_check
    FROM pg_policies
    WHERE schemaname = 'public'
    ORDER BY tablename, policyname
  LOOP
    ddl := ddl || format('CREATE POLICY %I ON %I.%I', r.policyname, r.schemaname, r.tablename);
    IF r.permissive = 'PERMISSIVE' THEN
      ddl := ddl || ' AS PERMISSIVE';
    ELSE
      ddl := ddl || ' AS RESTRICTIVE';
    END IF;
    ddl := ddl || ' FOR ' || r.cmd;
    IF r.roles IS NOT NULL AND array_length(r.roles, 1) > 0 THEN
      ddl := ddl || ' TO ' || array_to_string(r.roles, ', ');
    END IF;
    IF r.qual IS NOT NULL THEN
      ddl := ddl || ' USING (' || r.qual || ')';
    END IF;
    IF r.with_check IS NOT NULL THEN
      ddl := ddl || ' WITH CHECK (' || r.with_check || ')';
    END IF;
    ddl := ddl || ';' || E'\n';
  END LOOP;
  ddl := ddl || E'\n';

  -- ── 8. 函数 ─────────────────────────────────────────────
  ddl := ddl || '-- Functions' || E'\n';
  FOR r IN
    SELECT
      p.oid,
      n.nspname,
      p.proname,
      pg_get_function_identity_arguments(p.oid) AS args,
      p.prokind
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname <> 'export_schema'  -- 不导出自己
      AND p.oid NOT IN (SELECT objid FROM pg_depend WHERE deptype = 'e')  -- 排除扩展自带函数
    ORDER BY p.proname, p.oid
  LOOP
    BEGIN
      ddl := ddl || pg_get_functiondef(r.oid) || ';' || E'\n\n';
    EXCEPTION WHEN OTHERS THEN
      ddl := ddl || format('-- WARNING: could not dump function %s(%s)', r.proname, r.args) || E'\n\n';
    END;
  END LOOP;

  -- ── 9. 触发器 ───────────────────────────────────────────
  ddl := ddl || '-- Triggers' || E'\n';
  FOR r IN
    SELECT
      c.relname AS table_name,
      t.tgname AS trigger_name,
      pg_get_triggerdef(t.oid) AS def
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND NOT t.tgisinternal
    ORDER BY c.relname, t.tgname
  LOOP
    ddl := ddl || r.def || ';' || E'\n';
  END LOOP;
  ddl := ddl || E'\n';

  -- 恢复函数体检查
  ddl := ddl || 'SET check_function_bodies = true;' || E'\n';

  RETURN ddl;
END;
$$;

-- 允许 service_role 调用（service_role 本身是超级用户权限，这里只是显式声明）
GRANT EXECUTE ON FUNCTION public.export_schema() TO service_role;
