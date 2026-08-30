# Phase5 阶段 E：ttml-hub 同步建表 + Worker 部署（phase5-stepE）

> 依据：`sql/phase5-lyric-versions-ttml-hub.md` 第 3.3 / 4 / 5 节。
> 组成：① 两张同步表 SQL；② 独立同步 Worker（`cloudflare/ttml-sync/`）；③ 部署步骤。
>
> ## 设计要点
>
> 1. **快照存 state 表**（方案 3.3 微调）：`ttml_hub_state` 增加 `snapshot jsonb` 列，保存上次索引的 `{hubId: {path, sha256}}`——删除跟随的 diff 依据。避免为 diff 单独引入 Workers KV。
> 2. **dry-run 首跑**（方案 5.3，D3 已定全人工）：Worker `DRY_RUN=true` 时只产出 `ttml_hub_pending` 不写库；人工过目匹配量级后切 `false`。
> 3. **匹配纪律**（方案 5.1）：平台 ID 交集 = 档 1 自动合并；标题+歌手归一全等 = 档 2 进人工；同名多候选/Live·Remaster 降档 = 档 3 进人工。**非 dry-run 下只有"完全无同名候选"才自动建白板歌**，有同名一律等人工，杜绝撞库。
> 4. **缓存清理简化**：主动跨 Worker purge 边缘缓存实现复杂（需 zone API 或共享版本号），首版跳过，靠详情 1h TTL 自然过期——端到端时效本来就是小时级，瓶颈在 ttml-hub 发布周期。

## SQL（整段复制执行）

```sql
BEGIN;

-- ═══ 1. ttml_hub_state（同步游标，单行 singleton）═══
CREATE TABLE public.ttml_hub_state (
  id         text PRIMARY KEY DEFAULT 'singleton',
  revision   text,          -- 上次成功同步的 manifest revision
  etag       text,          -- manifest ETag（If-None-Match）
  last_check timestamptz,   -- 上次检查时间（含 304 短路）
  last_sync  timestamptz,   -- 上次实际数据变更时间
  snapshot   jsonb          -- 上次索引快照 {hubId: {p: path, h: sha256}}（删除跟随 diff 用）
);

-- ═══ 2. ttml_hub_pending（待匹配队列：同步写、后台人工处理）═══
CREATE TABLE public.ttml_hub_pending (
  id           text PRIMARY KEY,          -- = ttml-hub 稳定歌词 ID
  title        text NOT NULL,
  artists      text[] NOT NULL DEFAULT '{}',
  album        text,
  source_ids   jsonb NOT NULL DEFAULT '{}',
  path         text NOT NULL,
  sha256       text,
  reason       text NOT NULL CHECK (reason IN ('multi_candidate','low_confidence','conflict')),
  candidates   jsonb,                     -- 候选我们 song_id 数组 + 命中方式
  resolution   text CHECK (resolution IS NULL OR resolution IN ('merged','created','ignored')),
  resolved_song text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  resolved_at  timestamptz
);

CREATE INDEX ttml_hub_pending_open_idx
  ON public.ttml_hub_pending (created_at)
  WHERE resolution IS NULL;

-- ═══ 3. 授权：anon 零授权；authenticated 只读 state + pending 读写（F 阶段后台待匹配页用）═══
REVOKE ALL ON public.ttml_hub_state FROM anon;
REVOKE ALL ON public.ttml_hub_pending FROM anon;

GRANT SELECT ON public.ttml_hub_state TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ttml_hub_pending TO authenticated;

-- ═══ 4. RLS + 初始化 singleton ═══
ALTER TABLE public.ttml_hub_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ttml_hub_pending ENABLE ROW LEVEL SECURITY;
CREATE POLICY "同步状态：管理员只读" ON public.ttml_hub_state
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "待匹配：管理员全权" ON public.ttml_hub_pending
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.ttml_hub_state (id) VALUES ('singleton') ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
```

**预期结果**：Success, no rows returned。

## 验证

```sql
-- 1. 两表存在，singleton 就绪
SELECT * FROM public.ttml_hub_state;
-- 2. anon 零授权（RLS 已启 + 无 policy，anon 查询返回空且不可写）
-- 3.authenticated 可读写 pending（后台 F 阶段使用）
```

## Worker 部署（cloudflare/ttml-sync/）

```bash
cd cloudflare/ttml-sync
npm exec wrangler login          # 如未登录
npm exec wrangler secret put SUPABASE_URL --env production       # https://xxxx.supabase.co
npm exec wrangler secret put SUPABASE_SERVICE_ROLE_KEY --env production
npm exec wrangler deploy --env production
```

- 首跑确认 `wrangler.toml` 里 `DRY_RUN = "true"`，手动触发一次观察日志：
  `npm exec wrangler trigger scheduled --env production`（或等整点 Cron）
- 到后台看 `ttml_hub_pending` 匹配量级（SQL 查询即可，F 阶段做页面）：
  `SELECT reason, count(*) FROM ttml_hub_pending WHERE resolution IS NULL GROUP BY reason;`
- 确认无误后把 `wrangler.toml` 的 `DRY_RUN` 改 `"false"` 重新 deploy，进入常态同步。

## 时效与成本

- 无更新时每小时一次 304，近零成本；revision 变化才拉索引 + 增量下载。
- 端到端：ttml-hub 构建发布 + ≤1h Cron + 详情缓存 ≤1h TTL 自然过期。
- 下载失败/sha256 不符 → 该歌跳过记日志，下轮重试（existingVersions 检查天然幂等）。
