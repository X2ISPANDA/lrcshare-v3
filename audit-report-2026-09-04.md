# lrcshare-v3 全项目代码审计报告

- **审计日期**：2026-09-04
- **审计范围**：`src/`（Vue3 + TS 前端，70 个业务文件，约 17,100 行）、`cloudflare/`（open-api.js 约 1,480 行 + ttml-sync/worker.js 约 460 行）、`netlify/functions/mailer.mjs`（272 行）、`scripts/run-ttml-sync.mjs`、`lyrico-plugin/com.lrcshare.source/`（3 文件约 448 行）、`.github/workflows/`（2 个）、`sql/`（34 份迁移/方案文档）、`docs/`
- **审计方法**：全量源码通读 + 模式扫描（console/TODO/密钥/拼接）+ 符号级调用取证（`符号名(`、`.符号名(`、import 三模式）+ 关键结论人工复核。第三方库（node\_modules）不纳入。
- **重要说明**：凡标注【待确认】的为缺少库内/线上证据的推断；凡子审计初判、经复核被推翻的结论，统一在文末「误报澄清」记录，不混入清单。
- **修复进度（2026-09-04 同日，全部完成）**：批次1【安全】D1 + D6（mailer 会话鉴权 + CORS 收敛）；批次2【数据一致性】B8②（ilike 转义）+ B9（ID 统一）；批次3【架构】C6（语言码规则抽 `cloudflare/shared/lang.mjs` 单一来源）；批次4【高危数据】B1 + B2（歌词写库/存疑归位事务化 RPC，迁移 `sql/phase6`）；批次5【后端健壮性】B3（错误日志）+ B4（畸形 URI 400）+ A5（堆栈不外泄）+ A7（死分支）；批次6【废弃代码】A1-A4、A6（调试页/死函数/DRY_RUN/插件日志清理）；批次7【加固】B5（fetch 超时）+ B6（SMTP 端口 TLS）+ B7/B11/B12（防御性）+ D2（hubId 编码）+ D5（SSRF 同源校验）+ D7（token 改 header）+ D8（错误按鉴权）+ D9（链接协议白名单）；收尾【XSS/性能】D3 + D4（isomorphic-dompurify 全链路消毒）、B10（TTML tab 错位）、C3（TTML 请求级缓存）。语言体系统一（繁/粤归 zh-Hant、音译轨分流）见 README 2026-09-04 条目与 `sql/phase7-lang-unify.md`。**未处理**：C1/C2（架构级性能项，待曲库量级立项）、C4/C5（说明项无需改动）、A9（DevTools 横幅有意保留）、D10（已确认公开注册关闭）；D1③ IP 限流依赖 CF WAF。部署：前端/mailer 随 git push，两个 Worker 在各自目录 `npx wrangler deploy`（ttml-sync 手动触发改为 `X-Sync-Token` 请求头）。

***

# 任务 1：代码问题 / 风险 / 可优化点清单

## A. 残留废弃代码（共 9 项）

### A1.【确定可清理】SwitchTest 调试页进入生产路由且会被 SSG 预渲染
- **✅ 已清理（批次6）**：SwitchTest.vue 与路由注册已删除。

- **文件**：[src/router/index.ts](src/router/index.ts#L28-L29)、[src/views/SwitchTest.vue](src/views/SwitchTest.vue)、[vite.config.ts](vite.config.ts#L87-L92)
- **代码**：

```ts
// router/index.ts L28-29
// dev 专用：el-switch/dialog 回归验证页（不参与导航）
{ path: 'switch-test', name: 'switch-test', component: () => import('@/views/SwitchTest.vue') },
```

```ts
// vite.config.ts includedRoutes：仅排除含 ':' 的动态路径与 /admin
...paths.filter(p => p && !p.includes(':') && !p.startsWith('/admin'))
```

- **问题**：注释自称 dev 专用，但路由注册在生产路由表；`/switch-test` 不含 `:` 也不以 `/admin` 开头，**构建时会预渲染成** **`dist/switch-test/index.html`** **进入生产包**，任何人可访问。页内含硬编码测试数据（`'1111'`、`'2345'`、`'测试公司'`）。
- **建议**：删除 SwitchTest.vue 与 router L29；或在 includedRoutes 过滤追加 `&& p !== '/switch-test'`。推荐直接删除。

### A2.【确定可清理】`versionsToTtml` 死函数（约 80 行）
- **✅ 已清理（批次6）**：函数删除；连带删除失去调用方的孤儿 `formatTtmlTime`（open-api.js 有独立同名实现，不受影响）。

- **文件**：[src/lib/lyricLines.ts](src/lib/lyricLines.ts#L451-L512)
- **取证**：三模式 grep（`versionsToTtml(`、`.versionsToTtml(`、import）全仓仅命中定义处。实际 TTML 产出走编辑器 `composeTtml(model)`，LRC→TTML 合成路径无调用方。
- **建议**：确认无外部包引用后删除（该函数在 v1.4.2 刚被重写为 sidecar 形态，但仍无调用方——属"已修复的死代码"，保留成本是后续维护双倍负担）。

### A3.【确定可清理】`ttmlEditToLrcVersions` 死函数（约 70 行）
- **✅ 已清理（批次6）**：函数删除；连带删除孤儿 `translitPlainText`。

- **文件**：[src/lib/lyricLines.ts](src/lib/lyricLines.ts#L1321)
- **取证**：三模式 grep 全仓仅命中定义处。注意 TTML 编辑模型族其余成员（`TtmlEditModel`/`parseTtmlForEdit`/`composeTtml`/`prettifyTtml`/`generateTtmlVariant`/`generateLrcVariant`/`expandRomanSyntax`/`parseTranslitTokens`/`alignTranslitTokens`）在 SongFormDialog.vue 活跃使用，**不可删**；仅"编辑模型回拆 LRC versions"这一导出无调用方。
- **建议**：删除该函数；注意其私有辅助逻辑若被其他活跃函数共享则保留。

### A4.【确定可清理】ttml-sync wrangler 残留 `DRY_RUN="true"` + 死 scheduled handler
- **✅ 已清理（批次6）**：wrangler.toml 两处 `DRY_RUN` 改为 `"false"`（dry-run 演练改用本地 `wrangler dev --var DRY_RUN:true`）。

- **文件**：[cloudflare/ttml-sync/wrangler.toml](cloudflare/ttml-sync/wrangler.toml#L9)
- **代码**：

```toml
DRY_RUN = "true"        # [vars] L9 与 [env.production.vars] L22 两处
crons = []              # L28：定时已迁 GitHub Actions
```

- **问题**：注释承诺"人工过目后改 false"从未发生；定时任务已迁 GHA（workflow 里 `DRY_RUN='false'` 显式注入，不受影响），但保留的 Worker `/__sync` 手动端点即使带正确 token 也永远不写库，配置语义误导。worker.js 的 `scheduled` handler（L182-184）在 crons=\[] 后为死代码（保留无害）。
- **建议**：生产 vars 改 `DRY_RUN = "false"` 或删除该行；更新注释说明 cron 已迁 GHA。

### A5.【确定可清理】ttml-sync 手动端点把异常堆栈返回客户端（注释自承认待移除）
- **✅ 已修（批次5，方案A）**：`/__sync` catch 改为 `console.error` 记完整堆栈（wrangler tail 可见），客户端只回 `sync failed: <message>`。

- **文件**：[cloudflare/ttml-sync/worker.js](cloudflare/ttml-sync/worker.js#L195-L198)
- **代码**：

```js
} catch (e) {
  // 调试期把异常直接返回，浏览器可见；稳定后可移除
  return new Response('sync failed: ' + (e.stack || e.message), { status: 500 })
}
```

- **问题**：`e.stack` 泄露内部 URL/表名/行号；注释自带 TODO。
- **建议**：服务端 `console.error` 记录后返回通用文案（如 `sync failed, see logs`）。

### A6.【确定可清理】Lyrico 插件生产代码残留逐版本 debug 日志
- **✅ 已清理（批次6）**：每首歌 2 条联调 warn 删除；catch 内错误日志保留。

- **文件**：[lyrico-plugin/com.lrcshare.source/source.js](lyrico-plugin/com.lrcshare.source/source.js#L299)（另 L318）
- **代码**：

```js
Platform.log.warn("LrcShare", "version: lang=" + v.lang + " kind=" + v.kind + " rows=" + (v.rows ? v.rows.length : 0));
Platform.log.warn("LrcShare", "translated rows=" + translatedRows.length + " lines=" + ...);
```

- **问题**：每首歌、每个版本打两条 warn 级日志，联调残留（同文件 L136/L215/L360 的日志都在 catch 内，属正常错误日志）。
- **建议**：删除或挂 debug 开关。

### A7.【确定可清理】open-api 不可达死分支 `path === '/v1/'`
- **✅ 已清理（批次5）**：尾斜杠在前置中间件已归一，死分支删除。

- **文件**：[cloudflare/open-api.js](cloudflare/open-api.js#L1426-L1448)
- **代码**：

```js
const path = url.pathname.replace(/\/+$/, '') // 尾斜杠已剥
...
if (path === '/v1' || path === '/v1/') {      // '/v1/' 永不可达
```

- **建议**：删除 `|| path === '/v1/'`。

### A8.【文档残留】netlify.toml 部署注释与实际所需环境变量不符

- **文件**：[netlify.toml](netlify.toml#L3-L4)
- **代码**：

```toml
# 部署：...环境变量配置：
#   SUPABASE_URL / SUPABASE_ANON_KEY
```

- **问题**：[mailer.mjs L33](netlify/functions/mailer.mjs#L33) 实际必须 `SUPABASE_SERVICE_ROLE_KEY`（anon 因 RLS 读不到 smtp\_pass，会 fail-closed 返回 skipped，邮件永远发不出）。照注释配置必踩坑。
- **建议**：注释改为 `SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY`。
- **✅ 已修复（同日）**：注释已改为 `SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY` 并补充 fail-closed 说明（批次1 的 assertAdmin 会话校验同样依赖 SERVICE\_ROLE\_KEY）。

### A9.【说明项】main.ts DevTools 品牌横幅

- **文件**：[src/main.ts](src/main.ts#L45-L99)
- **问题**：约 55 行 ASCII 艺术 + 多个 `console.log`，生产包固定执行。属有意为之的站长文化输出，非缺陷。
- **建议**：可保留；介意噪音可用 `if (import.meta.env.DEV)` 包裹。

> 其余 console 扫描结论：ttml-sync worker 的 15 处 `console.log/error` 为运维日志（错误路径均有记录）；前端 28 处 console 除 A9 外全部为 catch 内 warn/error 容错日志，无敏感数据；全仓 TODO/FIXME/@deprecated 零匹配（A5 的"稳定后可移除"为唯一中文 TODO 性质注释）。

***

## B. 潜在 BUG（共 12 项，按风险排序）

### B1.【高】saveLyricLines 先删后插，delete 未检查 error → 行表重复风险

- **文件**：[src/lib/lyricLines.ts](src/lib/lyricLines.ts#L1770-L1785)
- **代码**：

```ts
const vid = versionId || await resolveDefaultLinesVersionId(songId)
await supabase.from('song_lyric_lines').delete().eq('version_id', vid)  // ← 返回值未解构
const rows: any[] = []
...
if (rows.length) {
  const { error } = await supabase.from('song_lyric_lines').insert(rows)
  if (error) throw error
}
```

- **问题**：Supabase JS 客户端 DB 错误不抛异常、只返回 `{ error }`。删除失败（RLS/网络/约束）时代码继续 insert → 旧行未删 + 新行插入 = 行表重复，调用方无感知。调用方：投稿发布链（SubmissionsView L1313/L1404）、后台歌曲编辑（SongFormDialog L1314）。
- **建议**：`const { error: delErr } = await ...delete(); if (delErr) throw delErr`，与下方 insert 错误处理风格一致。

### B2.【高】DoubtsView「归位」三处写库未检查 error，失败却提示成功

- **文件**：[src/views/admin/DoubtsView.vue](src/views/admin/DoubtsView.vue#L221-L243)
- **代码**：

```ts
if (hit) {
  await supabase.from('song_lyric_lines').delete().eq('song_id', ...).eq('lang', hit._lang).eq('kind', hit._kind).eq('seq', hit.seq)  // L224 无 error 检查
  await supabase.from('song_lyric_lines').insert({ song_id, lang, kind, seq: targetSeq, time_ms: hit.time_ms, text: hit.text })     // L225 无 error 检查
} else {
  ...
  await supabase.from('song_lyric_lines').insert({ ... })   // L237 无 error 检查
}
await markResolved(lang, kind)
ElMessage.success('已归位并标记处理')   // ← 写库失败也弹成功
```

- **问题**：外层 try/catch 只能捕网络级异常，捕不到 Supabase 返回的 DB 错误。insert 失败时 `markResolved` 仍把疑问标记为"已处理"并弹成功 → 数据未修复但问题从待办消失。对比同文件 L258-259 的 update 正确检查了 error。另：delete 条件未带 `version_id`（当前数据模型一版本一行表，风险低）。
- **建议**：三处均解构 `{ error }` 并 throw；delete 建议补 `.eq('version_id', ...)` 精确定位。

### B3.【中】open-api 入口 catch 吞掉异常且全文件零日志
- **✅ 已修（批次5）**：入口 catch 补 `console.error('[api]', method, path, e)`，可 `wrangler tail` 定位。

- **文件**：[cloudflare/open-api.js](cloudflare/open-api.js#L1473-L1475)
- **代码**：

```js
} catch (e) {
  res = jsonError(500, 'internal error')
}
```

- **问题**：全文件 0 处 `console.*`。上游返回异常 JSON、`decodeURIComponent` 抛错、AMLL 后处理抛错全部静默 500，线上无法定位（对比 ttml-sync 错误路径均有 console.error）。
- **建议**：`} catch (e) { console.error('[api]', request.method, url.pathname, e); res = jsonError(500, 'internal error') }`。

### B4.【中】`decodeURIComponent` 畸形输入抛 URIError → 500
- **✅ 已修（批次5）**：新增 `safeDecode()`，五处路由解码收敛为一次安全解码，畸形编码返回 400。

- **文件**：[cloudflare/open-api.js](cloudflare/open-api.js#L1466-L1470)
- **代码**：

```js
if (m) res = await handleSong(env, decodeURIComponent(m[1]), url)
```

- **问题**：`/v1/song/%zz`、`/v1/song/%E0%A4` 等畸形百分号编码抛 URIError，被 B3 的 catch 兜成无日志 500（应为 400/404）。
- **建议**：包 try/catch，解码失败返回 400。

### B5.【中】全部后端 fetch 无超时
- **✅ 已修（批次7）**：open-api 全部上游 fetch 加 `AbortSignal.timeout(8000)`；ttml-sync（Supabase/hub 共 9 处）加 15s 超时。

- **文件**：[cloudflare/open-api.js](cloudflare/open-api.js#L156-L162)（pgList/pgRpc/pgOne/pgListAll/proxyDocs 同类）、[cloudflare/ttml-sync/worker.js](cloudflare/ttml-sync/worker.js#L125-L126)（sbAll/downloadTtml/manifest 拉取同类）
- **问题**：Supabase / GitHub Pages hang 住时 Worker 挂到平台 wall-clock 上限，白占并发；GHA 拖到 120 分钟超时才被杀。
- **建议**：统一 `signal: AbortSignal.timeout(8000)`（API）/ `15000`（同步任务），超时走现有 502 路径。

## B6.【中】mailer `secure: true` 硬编码，与可配置端口矛盾
- **✅ 已修（批次7）**：改为 `secure: port === 465` + `requireTLS: port === 587`。

- **文件**：[netlify/functions/mailer.mjs](netlify/functions/mailer.mjs#L229-L234)
- **代码**：

```js
const transporter = nodemailer.createTransport({
  host: smtp.host, port: smtp.port,
  secure: true,          // ← 端口后台可配（默认 465）
  auth: { user: smtp.user, pass: smtp.pass },
})
```

- **问题**：管理员若在后台填 587（STARTTLS），`secure:true` 强制隐式 TLS 握手 → 连接失败。
- **建议**：`secure: smtp.port === 465`（587 时配 `requireTLS: true`）。

### B7.【中】AMLL 解析结果结构未防御
- **✅ 已修（批次7）**：parse 后校验 `Array.isArray(result.lines)`，残缺 TTML 安全返回空；`result.metadata?.language` 可选链。

- **文件**：[cloudflare/open-api.js](cloudflare/open-api.js#L975-L991)
- **代码**：

```js
try {
  result = amllParser.parse(String(xml || ''))
} catch {
  return []
}
const rootLang = normalizeLang(result.metadata.language) || ...   // metadata 可能缺失
...
const originalRows = result.lines.filter(l => l.text.trim())     // lines 可能缺失
```

- **问题**：try 只包住 `parse()`；异常 TTML 让 AMLL 返回缺 `metadata/lines` 的对象时，后续 TypeError 冒泡到入口变静默 500。
- **建议**：`result?.metadata?.language`、`result?.lines || []` 兜底。

### B8.【中】全局搜索：artists 缺 is\_show 过滤；ilike 通配符未转义

- **文件**：[src/lib/api.ts](src/lib/api.ts#L357-L373)
- **代码**：

```ts
supabase.from('artists').select('*').ilike('name', `%${kw}%`),          // L359 无 .eq('is_show', true)
supabase.from('albums').select('*').ilike('name', `%${kw}%`),
...
.or(`lrc_text.ilike.%${kwOr}%,lyrics_text.ilike.%${kwOr}%`)             // kwOr 仅剔除 (),
```

- **问题**：① 艺术家搜索建议未过滤 `is_show=false` 的非创作者实体（综艺/唱片公司），对比 getArtists（[api.ts L94](src/lib/api.ts#L94) `.eq('is_show', true)`）有过滤——这些实体可能出现在搜索建议中。albums 表是否有 is\_show 列【待确认】。② 用户输入 `%`/`_` 被当通配符（搜 `%` 近似全表匹配）；非注入（参数化）但语义错误。同类：L534 贡献者作品回退 ilike user\_name（代码注释自承认子串误匹配）。
- **建议**：artists 查询补 `.eq('is_show', true)`；ilike 模式串转义 `%`/`_`/`\`。
- **✅ 处理结果（同日）**：② 已修——新增 `escapeIlike`（转义 `\ % _ *`），应用于 api.ts 全局搜索（artists/albums ilike、歌词 or 过滤器、贡献者回退 L537）与 open-api.js `/v1/search` 三处同源点；行为变化：搜 `100%`、`a_b` 按字面匹配。① 经确认**按现状保留**（搜索建议查出「中国新说唱」类非创作者实体符合预期）；albums 表无 is\_show 列（原【待确认】已关闭）。

### B9.【中】弱 ID 生成器（13 处，风格不统一）

- **文件**：[src/lib/api.ts L420](src/lib/api.ts#L420)、[SubmissionsView.vue L1230/L1250/L1279](src/views/admin/SubmissionsView.vue#L1230)、ArtistsView L362、AlbumsView L246/L272、AlbumInfoDialog L125、ArticlesView L237、FriendsView L302/L374、SponsorsView L228、ContributorsView L285、SongFormDialog L1359
- **代码**：

```ts
id: 'sub' + Date.now() + Math.floor(Math.random() * 1000)
// articles/friends/sponsors/contributors 甚至连随机尾都没有：'cat' + Date.now()
```

- **问题**：同毫秒并发仅 1000 槽位；纯 `Date.now()` 的表连续快速新建必撞主键。同项目 lyric\_versions 已用 `crypto.randomUUID()`。
- **建议**：统一 `crypto.randomUUID()`（或可读前缀 + UUID）。
- **✅ 已修复（批次2）**：14 处（实测比清单多 1 处 AlbumInfoDialog）全部统一为 `crypto.randomUUID()` 纯 UUID 无前缀；`lv_` 前缀短码（lyric_versions 既有格式）、useBusuanzi/AppFooter/main.ts 的非 ID 用途 Date.now 均保留。

### B10.【低-当前不可达】SongView TTML 语言 tab 过滤索引错位
- **✅ 已修（收尾）**：map 保留版本 id，单语言 tab 按 id 过滤；下拉选项同步过滤空 `ttml_text` 条目。

- **文件**：[src/views/SongView.vue](src/views/SongView.vue#L959-L965)
- **代码**：

```ts
const vs = src.entries
  .filter(e => e.ttml_text)                                          // 过滤后新数组
  .map(e => ({ lang: e.langs?.[0] || 'zh', kind: 'original', rows: parseTtmlToRows(e.ttml_text!) }))
if (lrcLangKey.value === 'full') return vs
return vs.filter((_, i) => `ttml:${src.entries[i].id}` === lrcLangKey.value)  // ← i 索引回未过滤数组
```

- **问题**：一旦存在 `ttml_text` 为空的条目，索引错位 → 单语言 tab 匹配错版本或空。当前 ttml 源条目通常都有 ttml\_text，不可达。
- **建议**：map 时保留 id：`.map(e => ({ id: e.id, ... }))`，过滤用 `v.id`。

### B11.【低】ttml-sync `index.songs.length` 未防御
- **✅ 已修（批次7）**：索引解析后 `songs` 非数组归一为 `[]`，一处覆盖全部 `.length` 点。

- **文件**：[cloudflare/ttml-sync/worker.js](cloudflare/ttml-sync/worker.js#L250)
- **代码**：`console.log(\`\[sync] 索引 revision=${index.revision} 歌词数=${index.songs.length}\`)\`
- **问题**：L281 遍历处写了 `index.songs || []`，L250 直接 `.length`；外部索引 JSON 缺 songs 字段时整轮抛错。
- **建议**：同处加 `|| []`。

### B12.【低】专辑曲目硬上限 500，超限静默截断
- **✅ 已修（批次7）**：专辑曲目改 `pgListAll` 翻页拉全，超限不再丢歌。

- **文件**：[cloudflare/open-api.js](cloudflare/open-api.js#L1321-L1327)
- **问题**：`limit: 500` 拉专辑曲目，超 500 首无声丢歌，响应无 truncated 标记。
- **建议**：改 pgListAll 或响应加 `truncated: true`。

> 说明项（知情即可，不建议现在改）：① SubmissionsView 单曲审核 emailOf 每次点击多一次 contributors 查询（批量路径已批量化）；② SongFormDialog 在 onMounted 内注册 watch（依赖初始 false 隐含前提）；③ 五个 resolveArtists 并发读-改-写 types 有竞态，但保存结尾 recomputeArtistTypes RPC 兜底最终一致；④ 发布链 published\_refs 记录/补偿回滚 fire-and-forget 仅 warn（注释说明刻意不阻塞主流程）；⑤ 插件 LRC 兜底正则只认行首单时间戳（服务端契约保证已剥词标签，建议加防御性 replace）。

***

## C. 性能 & 架构优化点（共 6 项）

### C1.【中】`/v1/catalog` 三表全量分页拉取，子请求预算风险
- **⏸ 暂不处理**：属架构级改造（建议方向为 KV 快照）；当前数据量下边缘缓存（10 分钟）兜底、实际子请求数远低于 1000 上限。待曲库量级上来后再立项。

- **文件**：[cloudflare/open-api.js](cloudflare/open-api.js#L189-L200)（pgListAll，1000/页）、L465-L471（catalog 对 songs/artists/albums 并发拉全）
- **问题**：每页 = 1 个子请求；数据量增长（如 5 万歌 ≈ 50+ 子请求/表）可能触 Worker 子请求上限【待确认：当前库行数与 CF 套餐】；`offset > 500000` 兜底只防死循环。响应体随全库线性增大。
- **建议**：catalog 改定时任务生成快照存 KV/R2（Worker 读单对象），或加 ETag 304 + gzip。

### C2.【中】`/v1/artist/:id/songs` 全量拉取后内存分页
- **⏸ 暂不处理**：需改 RPC 签名与 SQL（下推 range）；单艺术家作品量小 + 10 分钟边缘缓存，收益有限，随 C1 一起立项。

- **文件**：[cloudflare/open-api.js](cloudflare/open-api.js#L1382-L1393)
- **代码**：RPC `get_artist_songs` 不带 limit/offset → 拉全量 → `all.slice(offset, offset+limit)`；翻页重拉全量（有 10min 边缘缓存兜底）。
- **建议**：分页下推 RPC（SQL 内 LIMIT/OFFSET + 返回总数）。

### C3.【低】同一 TTML 每请求重复 AMLL 解析 2\~3 次
- **✅ 已修（收尾）**：`parseTtmlVersionsWorker` 增加请求级 cache Map（buildLyricFields 创建并透传给 handleSong 兜底），同一版本每请求只解析一次；不做跨请求缓存（内容更新即时生效、无内存增长）。

- **文件**：[cloudflare/open-api.js](cloudflare/open-api.js#L1045-L1050)（buildLyricFields 拆行）、L1091-L1093（降级循环）、L1243-L1248（handleSong 顶层兜底）
- **问题**：`parseTtmlVersionsWorker`（AMLL+xmldom，CPU 重）同一版本在单请求内重复解析。
- **建议**：请求级 `Map<versionId, parsed>` 缓存。

### C4.【低-说明】管理端全量拉表无分页
- **⏸ 无需改动**：管理端低频操作 + Supabase 秒级内网查询，几千行无感知；分页反而降低管理体验。

- **文件**：[SubmissionsView.vue L732-L737](src/views/admin/SubmissionsView.vue#L732-L737)（submissions+artists+albums+album\_contributors 全量）、各管理页 load() 均 adminApi.getAll 内部分页拉全
- **现状**：代码注释自承认"量小无压力"；Dashb  C4oardView 统计正确用 `count:'exact', head:true`。前台列表 SSG 全量是静态化前提，保留。
- **建议**：投稿页后续可按 status 过滤/服务端分页。

### C5.【说明】插件搜索结果逐首串行补全详情
- **⏸ 无需改动**：Lyrico 平台 `http.getText` 同步阻塞无法并发（平台限制）；已有 catalog 负向预过滤 + internal 详情缓存，属合理设计。

- **文件**：[lyrico-plugin/com.lrcshare.source/source.js L207-L211](lyrico-plugin/com.lrcshare.source/source.js#L207-L211)
- **现状**：平台 `http.getText` 同步阻塞无法并发；已有 catalog 负向预过滤 + internal 详情缓存，属平台限制下合理设计。

### C6.【低】可抽公共逻辑：open-api 与 lyricLines/ttml-sync 三处语言码映射重复

- **位置**：`normalizeLang`（open-api.js L959）、`normTtmlLang`（ttml-sync/worker.js L53）、`ttmlLangToLrc`/`lrcLangToTtml`（lyricLines.ts）规则集三份手抄；`detectLang` 字符区间判定在 worker.js L32 与 lyricLines.ts 各一份。
- **建议**：规则变更需三处同步（v1.4.2 已发生过一次三处同改）；长期可抽共享纯函数包（Worker 与前端均可引用）。
- **✅ 已修复（批次3，方案B）**：新建 [cloudflare/shared/lang.mjs](cloudflare/shared/lang.mjs)（+ lang.d.mts 前端类型）单一规则源，三端改为薄适配接入，各端兜底语义保留（worker `foldToBase`、open-api 原样保留、前端 LABELS 校验 + 'und'/'unknown'）。统一时发现并修复三处真实漂移：① 前端 detectLang 汉字判定 `[一-龥]` 漏 `\u9FA6-\u9FFF` 与 CJK 扩展A、重音拉丁不判 en（对齐 worker 完备区间）；② 前端 ttmlLangToLrc 大小写敏感漏匹配（改不敏感）；③ worker 词标签剥离 `<\d+>` 收紧为 `<\d{1,6}>`。**部署方式变更**：open-api.js 依赖共享模块，须 `cloudflare/` 目录下 `npx wrangler deploy`（已上线），Dashboard 粘贴单文件失效。

***

## D. 安全风险（共 10 项，按风险排序）

### D1.【高】mailer 匿名开放发信：收件人 `to` 完全由请求方指定（开放中继）

- **文件**：[netlify/functions/mailer.mjs](netlify/functions/mailer.mjs#L237-L266)
- **代码**：

```js
if (action === 'test') { mail = { to, subject: '【LrcShare】测试邮件', ... } }
else if (action === 'approve') { if (!to) return ...skipped; mail = { to, ... } }
else if (action === 'reject') { ... mail = { to, ... } }
else if (action === 'batch') { ... mail = { to, ... } }
...
await transporter.sendMail({ from: smtp.user, ...mail })
```

- **问题**：端点**无任何鉴权**（无 token/签名）、无速率限制；`notify` 已正确固定收件人为 admin\_email（L242），但 `test/approve/reject/batch` 的 `to` 全取自请求体；nodemailer 的 `to` 接受逗号分隔/数组（可群发）。正文用户字段虽经 HTML 转义（L59-61/L132）、主题剥离了 `\r\n\t`（L223，信头注入已防），但文案可任意构造 → **任何人都能用本站 SMTP 信誉发送 LrcShare 品牌邮件给任意邮箱**，垃圾邮件放大 + 域名信誉损害。
- **建议**：① 管理后台调用加共享密钥 header（Netlify env token，函数校验）；② `to` 校验单个合法邮箱（拒逗号/数组）；③ IP 维度限流；④ `test` 动作仅允许 admin\_email。
- **✅ 已修复（批次1，方案有调整）**：原建议①「共享密钥 header」升级为**更安全的 Supabase 会话校验**（共享密钥会被打进公开 SPA 包）——mailer 新增 `assertAdmin`：管理端四 action 校验 `Authorization: Bearer` 调 `/auth/v1/user`，无效 401；`notify` 免鉴权（收件人本就固定 admin\_email）；前端 callMailServer 携带管理员会话 token。② 已修：`isSingleEmail` 锁死单地址（含逗号/分号即 400）。③ IP 限流**未做**（依赖 CF WAF 速率限制，见「待确认」项）。④ 用户决策：test 保留管理员自定义收件人（已有会话校验兜底，与其他 action 同规则）。netlify.toml 注释所需环境变量勘误：应为 SUPABASE\_SERVICE\_ROLE\_KEY（assertAdmin 依赖）。

### D2.【中】ttml-sync 外部 hubId 未编码直接拼 PostgREST URL（过滤器注入）
- **✅ 已修（批次7）**：followRemoval 改用 `URLSearchParams` 构造查询，`&or=(...)` 类篡改字符被编码。

- **文件**：[cloudflare/ttml-sync/worker.js](cloudflare/ttml-sync/worker.js#L422-L423)
- **代码**：

```js
const res = await fetch(`${env.SUPABASE_URL}/rest/v1/lyric_versions?source=eq.ttml-hub&external_id=eq.${hubId}&select=id,song_id`, { headers: sbHeaders(env) })
```

- **问题**：`hubId` 来自第三方 manifest（本文件所有 URL 均手工拼接，未用 URLSearchParams）。若 id 含 `&or=(...)` 类字符可改变 WHERE 语义；后续 DELETE 以查出的 `v.id` 为准（L444/L447/L451），配合 service\_role bypass RLS，存在误删版本的理论路径（前提：manifest 源被篡改/输错——正是供应链同步应防御的）。
- **建议**：改用 `new URLSearchParams({ source: 'eq.ttml-hub', external_id: 'eq.'+hubId, select: 'id,song_id' })`。

### D3.【中】v-html/marked 全链路无 HTML 消毒（存储型 XSS 面）
- **✅ 已修（收尾）**：引入 isomorphic-dompurify（浏览器原生 DOM / SSG jsdom 同构，SSG 构建验证通过）；新增 `sanitizeHtml()`，`mdToHtml` 输出统一消毒；全部 6 处 v-html 富文本入口收口（关于页/文章页/歌曲简介/专辑简介/投稿预览/文章管理预览）。`<script>`/`on*`/`javascript:`/`data:` 剥除，table/style/class/target 保留。搜索高亮（highlightHtml）本就先转义后插 `<span>`，确认安全未动。

- **文件**：[src/lib/markdown.ts](src/lib/markdown.ts#L20-L29)（mdToHtml，marked 默认透传内嵌 HTML）；使用点：SongView L94/L556/L708（歌曲简介/tip-box/文本歌词）、AlbumView L49、PostView L33、RichContentView L17、管理员预览 SongFormDialog L140/L1136、ArticlesView L188
- **威胁模型**：内容均来自管理员录入或审核通过的投稿，普通投稿者不能直接触达 v-html；但审核员放行含恶意 HTML 的投稿（或账号被盗）即对全站访客存储型 XSS。缓解已到位：搜索/高亮类 v-html 全部先走 [highlight.ts](src/lib/highlight.ts#L3-L15) 的 escapeHtml；无裸 v-html 于首页/搜索。
- **建议**：`mdToHtml` 出口统一接 DOMPurify（SSR 用 isomorphic-dompurify），一处覆盖全部调用点。

### D4.【中-待确认】AboutView 直接 v-html 原始 content，未经 mdToHtml
- **✅ 已确认并修复（收尾）**：经用户确认，线上 articles.content 历史数据为 marked 转好后存库的 HTML（非 Markdown）——直接 v-html 是对的但缺消毒；现改为 `v-html="sanitizeHtml(article.content)"`。

- **文件**：[src/views/AboutView.vue](src/views/AboutView.vue#L7-L8)
- **代码**：`<div v-else-if="article?.content" class="article-content" v-html="article.content"></div>`（对比 PostView L75 走 mdToHtml）
- **问题**：若种子数据存 Markdown → 语法原样显示（显示异常）；若存 HTML → 显示正常但 XSS 面同 D3。空态提示引用的 `extras.sql` 在仓库中不存在。【待确认：线上 articles where slug='about' 的 content 格式】
- **建议**：查库确认格式；统一改  `mdToHtml(article.content)` 并随 D3 消毒。

### D5.【低】ttml-sync TTML 下载地址可被绝对 URL 覆盖（SSRF 面）
- **✅ 已修（批次7）**：新增 `hubUrl()` 同源校验——downloadTtml 与索引地址解析后比对 origin，绝对 URL 指向外域直接抛错跳过（实测 evil.com 被拦）。

- **文件**：[cloudflare/ttml-sync/worker.js](cloudflare/ttml-sync/worker.js#L151-L157)
- **代码**：`const res = await fetch(new URL(hub.path, base).href)`
- **问题**：`hub.path` 为绝对 URL 时覆盖 base → Worker 向任意源发起请求（不带凭据；内容受同 manifest sha256 校验，但 manifest 与 sha 同源可同时改）。影响主要是"任意外部内容写进 ttml\_text"。
- **建议**：解析后校验 `new URL(...).origin === new URL(base).origin`，否则跳过并告警。

### D6.【低】mailer CORS 为 `*`

- **文件**：[netlify/functions/mailer.mjs](netlify/functions/mailer.mjs#L209-L214)
- **代码**：`'Access-Control-Allow-Origin': '*'`（注释 L208 称只给管理后台跨域用）
- **建议**：收敛为 `https://lrcshare.com` / `https://v3.lrcshare.com` 白名单（与 D1 一并修）。open-api 的 `*` CORS 为公开只读 GET 数据，可接受。
- **✅ 已修复（批次1）**：改为 `*.lrcshare.com` 反射式回显（读 Origin → 正则锚定匹配 → 回显，防 `lrcshare.com.evil.com` 仿冒；比固定两域名更省心，子域扩展无需改函数）；`Access-Control-Allow-Headers` 补 `Authorization` 供预检放行。Netlify 随机预览域名不在白名单——确认未使用预览站功能，无影响。

### D7.【低】SYNC\_TOKEN 走 URL query
- **✅ 已修（批次7）**：手动触发改 `X-Sync-Token` 请求头（不进 URL/边缘日志）；GHA 脚本直接调 `sync()` 不经 HTTP，零影响。

- **文件**：[cloudflare/ttml-sync/worker.js](cloudflare/ttml-sync/worker.js#L188-L191)
- **问题**：token 在 query 中可能被边缘日志/代理记录；`!==` 比较非恒定时间（网络场景时序攻击基本不可利用）。
- **建议**：改 header（`X-Sync-Token`）传递。

### D8.【低】mailer SMTP 原始错误回传匿名调用方
- **✅ 已修（批次7）**：catch 按鉴权分流——匿名 `notify` 只回「邮件发送失败，请稍后重试」；已过会话校验的管理端 action 才回 humanizeMailError 中文明细。

- **文件**：[netlify/functions/mailer.mjs](netlify/functions/mailer.mjs#L268-L270)
- **问题**：humanizeMailError 把原始 SMTP 报错（可能含主机名/greeting/认证细节）拼进响应体。
- **建议**：鉴权落地后（D1），仅管理端返回明细，匿名端只返回中文结论。

### D9.【低】RichTextToolbar 链接未过滤 `javascript:` 协议
- **✅ 已修（批次7）**：显式协议头白名单校验（http/https/mailto/tencent/weixin/tel），`javascript:`/`data:` 拒绝并提示；href 属性转义 + 补 `rel="noopener"`。

- **文件**：[src/components/admin/RichTextToolbar.vue](src/components/admin/RichTextToolbar.vue#L249-L251)
- **代码**：

```ts
if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) url = 'https://' + url  // javascript: 命中协议正则 → 不补前缀
apply(s.start, s.end, `<a href="${url}" target="_blank">`, s.sel, '</a>')  // url 未转义引号
```

- **问题**：`javascript:alert(1)` 原样进 href；管理员自录入属低危，D3 的 DOMPurify 渲染端可兜底拦截。同类：SupportView 赞助链接直接进 href。
- **建议**：协议白名单（http(s)/mailto/tencent/weixin），属性转义。

### D10.【架构说明】RLS 策略 `TO authenticated USING(true)` 依赖 Supabase 关闭公开注册

- **证据**：[sql/phase4-lyric-p1.md L62-L63](sql/phase4-lyric-p1.md#L62-L63) `CREATE POLICY "歌词行：管理员全权" ... FOR ALL TO authenticated USING (true) WITH CHECK (true)`；song\_secrets、ttml\_hub\_pending 同模式。
- **说明**：任何**已注册** Supabase 用户即获全站写权限。安全边界 = Supabase 项目设置中禁用公开注册 + 账号人工发放。代码层无邮箱白名单二次校验。【待确认：Supabase 面板已关闭匿名注册】
- **✅ 已确认关闭（同日）**：用户确认 Supabase 公开注册已关闭，本项安全边界成立，无需代码改动。
- **已核实正常的安全项**：① 前端仅持有 VITE\_SUPABASE\_ANON\_KEY（公开设计），service\_role 仅存于 CF/Netlify/GHA secrets，全前端代码零命中；② `.env` 已 gitignore 且仅含 VITE\_ 公开变量；③ anon 权限经 REVOKE 收口（公开表 SELECT、submissions INSERT、song\_secrets/ttml\_hub 两表 anon 零授权、unlock\_code 列级收权 + verify\_hidden\_unlock\_code SECURITY DEFINER RPC）；④ 隐藏歌 SSG 阶段清空 lrc\_text/lyrics\_text 防静态包泄露；⑤ YouTube postMessage 校验 origin；⑥ 外链普遍带 rel=noopener；⑦ open-api 全 GET、PostgREST 参数经 URLSearchParams 编码（逗号→%2C），无注入面；⑧ 邮件 HTML 用户字段均转义、信头控制字符已剥离。

***

# 任务 2：业务功能链路文档

## 模块总览

| 模块                          | 链路数    |
| --------------------------- | ------ |
| 一、前台展示（SSG 静态站）             | 11     |
| 二、投稿                        | 2      |
| 三、后台管理                      | 8      |
| 四、公开 API（Cloudflare Worker） | 9      |
| 五、TTML Hub 同步               | 2      |
| 六、邮件服务                      | 1      |
| 七、构建 / 部署 / 插件              | 3      |
| **合计**                      | **36** |

**数据库表（17 张）**：`songs`、`artists`、`albums`、`contributors`、`articles`、`friends`、`friend_categories`、`sponsors`、`settings`、`submissions`、`song_contributors`（歌-艺人中间表，role: singer/lyricist/composer/arranger）、`album_contributors`、`lyric_versions`（歌词版本容器）、`song_lyric_lines`（歌词行表）、`song_lyric_doubts`（拆行存疑队列）、`song_secrets`（隐藏歌口令）、`ttml_hub_state`/`ttml_hub_pending`（同步状态/待匹配队列）。
**RPC 函数（约 20 个）**：search\_songs / search\_songs\_structured / search\_albums\_structured（两阶段分词召回）、get\_artist\_songs、get\_top\_artists、get\_top\_contributors、verify\_hidden\_unlock\_code、song\_has\_own\_code、rebuild\_song\_lyric\_lines、recompute\_artist\_types、recompute\_song\_search\_text + 触发器 trg\_sll\_default\_version / trg\_song\_lyric\_rebuild / trg\_song\_search\_text 等。

***

## 一、前台展示模块（Vue3 + vite-ssg，构建时预渲染）

### 链路 1：首页

- **入口**：`/`（HomeView\.vue，SSG 预渲染）
- **逻辑**：useSSGData（composables/useSSGData.ts，构建期/客户端两级缓存）→ supabase 拉最新 songs（按 created\_at）、`get_top_artists` RPC → 歌卡/艺术家卡展示；关键词片段用 lrcSnippet 高亮（highlight.ts 先 escapeHtml）。
- **文件**：src/views/HomeView\.vue、src/composables/useSSGData.ts、src/lib/api.ts
- **输出**：静态 HTML；写表：无。

### 链路 2：歌曲详情页（核心页）

- **入口**：`/song/:id`（SongView\.vue）
- **逻辑**：api.getSongById 拉 songs（含 song\_contributors 嵌套）→ 歌词源 tab 构建：① LRC/enhanced/verbatim 版本（lyric\_versions + song\_lyric\_lines 行表，loadLyricLines/groupVersions）② TTML 版本（ttml\_text，parseTtmlToRows 拆行）③ "全开"混合源；语言 tab（lyricLangKey）按 lang|kind 过滤，译文单选时补原文公共行；**隐藏歌**：is\_hidden 时先验 sessionStorage 解锁标记 → 无标记则口令输入 → `verify_hidden_unlock_code` RPC（SECURITY DEFINER，anon 可读）校验通过后置标记；文本歌词三层兜底（lyrics\_text 人工 Markdown → TTML 正文纯文本 → LRC 提取）；YouTube 嵌入（postMessage origin 校验）；复制歌词走 clipboard.ts。
- **文件**：src/views/SongView\.vue、src/lib/lyricLines.ts（parseTtmlToRows/stripWordTags/langLabel）、src/lib/api.ts
- **输出**：页面渲染；写表：无（sessionStorage 写解锁标记）。

### 链路 3：艺术家列表 / 详情

- **入口**：`/artists`、`/artist/:id`（ArtistsView/ArtistView）
- **逻辑**：getArtists（`.eq('is_show',true)` 按 name 排序，中文按拼音分组 pinyinGroup.ts）→ 详情 getArtist + `get_artist_songs` RPC（含角色 roles 过滤 singer/lyricist/composer/arranger）。
- **文件**：src/views/ArtistsView\.vue、ArtistView\.vue、src/lib/pinyinGroup.ts
- **输出**：只读。

### 链路 4：专辑列表 / 详情

- **入口**：`/albums`、`/album/:id`（AlbumsView/AlbumView）
- **逻辑**：albums 表列表 → 详情含 album\_contributors 嵌套 + 曲目（songs.album\_id，按 disc/track 排序）。
- **输出**：只读。

### 链路 5：贡献者列表 / 详情

- **入口**：`/contributors`、`/contributor/:id`
- **逻辑**：contributors 表（歌词投稿者档案）→ 详情聚合其投稿歌曲；`get_top_contributors` RPC 供榜单。
- **输出**：只读。

### 链路 6：文章（逼逼）列表 / 详情

- **入口**：`/posts`、`/post/:slug`（PostsView/PostView）
- **逻辑**：articles 表 → 详情 mdToHtml(article.content) 渲染（v-html，见 D3）；内容图片点击事件委托进 ImgPreview 预览。
- **输出**：只读。

### 链路 7：友链页

- **入口**：`/links`（LinksView）
- **逻辑**：friends + friend\_categories 联表，按分类渲染外链卡片（ContactIcons 组件 + rel=noopener）。

### 链路 8：关于页

- **入口**：`/about`（AboutView）
- **逻辑**：articles 表 slug='about' 的 content **直接 v-html**（见 D4，与 PostView 的 mdToHtml 不一致）。

### 链路 9：赞助页

- **入口**：`/support`（SupportView）
- **逻辑**：sponsors 表渲染赞助者名单 + 赞助二维码/链接；RewardModal 组件。

### 链路 10：全局搜索浮层

- **入口**：任意页导航栏搜索图标（SearchOverlay.vue）
- **逻辑**：api.globalSearch 并发 4 查询：artists ilike name、albums ilike name、`search_songs` RPC（两阶段分词：title/aliases/artist 命中 + struct\_hit 排序）、lrc\_text/lyrics\_text ilike（**隐藏歌歌词不参与匹配**，防白嫖口令内容）→ 结果分组展示 + 关键词高亮（highlight.ts 转义）。
- **文件**：src/components/layout/SearchOverlay.vue、src/lib/api.ts L355+
- **输出**：只读。（B8② ilike 转义已修，通配符按字面匹配；① 缺 is\_show 过滤经确认保留现状）

### 链路 11：评论

- **入口**：投稿页/歌曲页 TwikooComment 组件
- **逻辑**：第三方 Twikoo 评论系统（init 失败仅 warn 不阻塞）。

***

## 二、投稿模块

### 链路 12：新歌批量投稿

- **入口**：`/submit` → BatchSubmitPanel（批量表格）
- **逻辑**：填写每行歌曲（title/艺术家/专辑/年份/时长/曲序/LRC 或多语言版本/视频链接）→ 校验（年份 4 位等）→ 多语言版本 composeMixedLrc 合成 lrc\_text、versions 原样保留 → `api.submitSubmissionV2`（api.ts L418）→ **submissions 表 INSERT**（anon 仅有 INSERT 权限；id=`sub`+Date.now+随机；status='pending'；song\_data JSONB 含全部投稿数据）→ 成功后调 Netlify mailer `action:'notify'`（收件人固定 admin\_email）通知站长 → emit submitted 重置。
- **文件**：src/components/submit/BatchSubmitPanel.vue、src/lib/api.ts、netlify/functions/mailer.mjs
- **输出**：写 submissions 表；发通知邮件。

### 链路 13：补充版本投稿（已有歌曲追加歌词/翻译/TTML）

- **入口**：`/submit` → VersionSubmitPanel
- **逻辑**：搜索定位目标歌（searchSongs + 复制查重，查重失败放行由审核端兜底）→ 粘贴 LRC/TTML（ArtistTagInput 选贡献者）→ submitSubmissionV2，song\_data.type='song\_version' 带 song\_id + lrc\_text/ttml\_text/versions → 同链路 12 入队 + 邮件通知。
- **文件**：src/components/submit/VersionSubmitPanel.vue

***

## 三、后台管理模块（/admin，纯 SPA，Supabase Auth 会话守卫）

### 链路 14：管理员登录 / 路由守卫

- **入口**：`/admin/login`（AdminLoginView）
- **逻辑**：useAdminAuth.login → supabase.auth.signInWithPassword → session 落库 → setupAdminGuard（router/index.ts L67）beforeEach 检查 `/admin/**`（除 login）会话，无则跳登录页带 redirect query（登录后 vue-router 内部导航，无开放重定向）。
- **写表**：无（auth.users 由 Supabase 托管）。

### 链路 15：投稿审核与发布（最复杂链路）

- **入口**：后台「投稿审核」SubmissionsView，单曲审核 / 批量审核
- **逻辑**：onMounted 全量拉 submissions(pending) + artists + albums + album\_contributors → 审核弹窗：自动匹配已有艺术家/专辑（ilike 命中提示，可新建）→ 发布 `publishSubmission`：
  1. 艺术家不存在则 insert artists（id `art_` 前缀）；专辑不存在则 insert albums（含 AlbumInfoDialog 保存回调 onAlbumSaved）；
  2. `adminApi.insert('songs', { id: 's'+ts+rand, title, album_id, duration, track, lrc_text, cover, video_url, status:'published', contributor_id, genres })`；
  3. syncSongContributors（contribRelations.ts）写 song\_contributors 中间表（失败不静默，提示部分成功）；
  4. 多语言版本 → lyric\_versions 建版本容器（crypto.randomUUID）+ saveLyricLines 写 song\_lyric\_lines（先删后插）；TTML 版本 → lyric\_versions.ttml\_text；
  5. submissions 标记 approved + published\_refs 记录发布产物（fire-and-forget warn）；失败补偿回滚（删已建实体，失败仅 warn）；
  6. recompute\_artist\_types RPC 重算艺术家类型；
  7. 邮件：approve/reject/batch 调 mailer（按投稿者 contact\_value.email，无邮箱则跳过并提示）。
     拒绝：status='rejected' + reject\_reason + 拒绝邮件。
- **文件**：src/views/admin/SubmissionsView\.vue（2000+ 行）、src/lib/adminApi.ts、src/lib/contribRelations.ts、src/lib/lyricLines.ts
- **输出**：写 songs/artists/albums/song\_contributors/lyric\_versions/song\_lyric\_lines/submissions；发审核结果邮件。
- **注意**：aliases/description/lyrics\_text/is\_hidden/unlock\_code 为管理员后置字段，投稿表单不采集、发布链不写（审核后在歌曲编辑补），**非遗漏**（见误报澄清）。

### 链路 16：歌曲管理 / 编辑（SongFormDialog）

- **入口**：后台「歌曲」SongsView → 新建/编辑弹窗
- **逻辑**：加载歌曲 + loadLyricLines（行表多版本）+ loadLyricVersionMetas + TTML 版本 parseTtmlForEdit（编辑模型：bodyRaw 正文 + 翻译/音译轨道表格）→ 保存：songs upsert（含 aliases/description/lyrics\_text/is\_hidden/genres 等全字段）→ syncSongContributors → upsertTtmlVersions（composeTtml 合成完整 TTML 落 ttml\_text，含 sidecar + itunes:key + xml:lang）→ saveLyricLines 写行表 → syncSongSecrets（contribRelations.ts，song\_secrets 表 upsert/删除解锁口令）→ resolveArtists 补艺术家 types + recomputeArtistTypes RPC。
- **文件**：src/components/admin/SongFormDialog.vue（1300+ 行）、src/lib/lyricLines.ts、src/lib/contribRelations.ts
- **输出**：写 songs/song\_contributors/lyric\_versions/song\_lyric\_lines/song\_secrets。

### 链路 17：歌词存疑归位

- **入口**：后台「歌词存疑」DoubtsView
- **逻辑**：song\_lyric\_doubts 队列（LRC 迁移/拆行判不出 lang/kind 的裸行）→ 人工选目标歌 + lang/kind + 时间戳 → applyHandle：命中已有行则先删后插改 lang/kind，否则插新行 → markResolved 标记 resolved。（已知问题见 B2）
- **输出**：写 song\_lyric\_lines + 更新 song\_lyric\_doubts。

### 链路 18：TTML Hub 待匹配队列

- **入口**：后台「TTML Hub」TtmlHubView
- **逻辑**：ttml\_hub\_pending（同步 Worker 写入的外部待确认条目）+ ttml\_hub\_state → 人工「挂到歌」（合并为已有歌的 lyric\_versions，fetch 外部 TTML 后 **sha256 content\_hash 校验**，确定性 version id `lv_`+hubId 幂等）或「新建展示」（建白板歌）。
- **输出**：写 lyric\_versions / songs；更新 ttml\_hub\_state。

### 链路 19：版本排序

- **入口**：歌曲编辑内 VersionSortDialog
- **逻辑**：loadLyricVersionMetas 拉版本元数据 → 拖拽排序 → 更新 lyric\_versions.sort（phase7 排序字段）。

### 链路 20：艺术家 / 专辑 / 贡献者 / 赞助者 / 文章 / 友链 / 设置 CRUD

- **入口**：后台各管理页（ArtistsView/AlbumsView/ContributorsView/SponsorsView/ArticlesView/FriendsView/SettingsView）
- **逻辑**：统一走 adminApi.ts 通用封装（getAll 内部分页拉全 / getById / insert / update / upsert / removeWhere / callMailServer）；艺术家有 ArtistInlineForm + types 多选；专辑有 AlbumInfoDialog（含专辑艺术家）；设置页写 settings 表（smtp\_host/port/user/pass、admin\_email、hidden\_unlock\_code、site\_name 等；smtp\_pass 仅 service\_role 可读，anon RLS 隐藏）。
- **输出**：对应表增删改。

### 链路 21：仪表盘统计

- **入口**：`/admin/dashboard`
- **逻辑**：各表 count（`count:'exact', head:true` 聚合，不拉数据）展示待审核数等。

***

## 四、公开 API 模块（Cloudflare Worker，api.lrcshare.com，纯 GET + 边缘缓存）

统一行为：anon key 调 Supabase PostgREST/RPC；`caches.default` 按完整 URL 缓存（仅 200 且带 Cache-Control 才写，错误不缓存）；CORS `*`（公开只读）；未知子域返回 HTML 404。

### 链路 22：`GET /v1` API 索引

- 返回端点清单（apiIndex，含各端点参数示例）。

### 链路 23：`GET /v1/search`

- **参数**：keyword 或 title+artist（互斥）；type=song|album|artist|lyric；limit/offset
- **逻辑**：song → search\_songs\_structured RPC（title/artist 结构化）/ keyword → search\_songs RPC（两阶段分词）；album → search\_albums\_structured；artist → artists ilike；lyric → songs lrc\_text/lyrics\_text ilike（剔除 `(),` 防 or 语法破坏）。
- **输出**：JSON 检索结果。

### 链路 24：`GET /v1/catalog`

- **逻辑**：pgListAll 分页（1000/页，50 万防御上限）拉 songs/artists/albums 全量可搜索文本快照 → 供客户端本地负向预过滤（批量工具省无效请求）。（性能见 C1）

### 链路 25：`GET /v1/songs`

- 歌曲分页列表（limit/offset + total），assembleSummaries 组装艺术家/专辑摘要。

### 链路 26：`GET /v1/song/:id`（核心，歌词合成）

- **逻辑**：pgOne 拉 songs 全字段 + 嵌套 → 版本元数据 lyric\_versions → 按参数合成：
  - `lyric_format`：line（stripWordTags 行级 LRC）/ enhanced（行首+行内绝对词时间）/ verbatim（逐词 LRC）/ **ttml**；
  - 无词级数据求 ttml → 返回 null（资格门控）；
  - 版本选择 selectVersions（v1.4.2：原文精确优先 + BCP47 层级匹配，fuzzy 只取一个防港繁/台繁混排；译文/音译精确或层级命中全收）；
  - **TTML 合成 composeTtml**（v1.4.2 重写为 Apple sidecar：正文 original 行 `<p itunes:key="Ln">` + 词级 span；译文/音译进 head iTunesMetadata `<text for="Ln">` 配对；根 `xml:lang`（zh→zh-Hans 映射）+ `itunes:timing="Word"`；AMLL 拆行 parseTtmlVersionsWorker，根语言缺失时正则兜底读 `<body xml:lang>`）；
  - 署名 credits：跨版本合并时按实际来源版本去重并列，LRC 超界时间行 `[419:19.999]` / TTML 超界 `<p begin="06:59:19.999">`（播放器不渲染、工具收录）；
  - 全开形态额外返回 ttml\_text 原文 + lyric\_lines 结构化。
- **输出**：完整歌曲 JSON（fields.lrc / lyrics\[].lrc 等）。

### 链路 27：`GET /v1/lyric/:id`

- 仅歌词子集（同合成逻辑，不含歌曲元信息）。

### 链路 28：`GET /v1/albums` / `GET /v1/album/:id`

- 专辑分页 / 详情；专辑曲目 limit 500（见 B12）。

### 链路 29：`GET /v1/artists` / `GET /v1/artist/:id` / `GET /v1/artist/:id/songs`

- 艺术家分页 / 详情（assembleSummaries）/ 艺术家歌曲（get\_artist\_songs RPC 全量 + 内存分页，见 C2）。

### 链路 30：`/docs/*` 文档反代

- api 域名 /docs 路径 proxyDocs 反代 VitePress 文档站。

***

## 五、TTML Hub 同步模块

### 链路 31：定时同步（GitHub Actions 每小时）

- **入口**：.github/workflows/ttml-sync.yml（schedule + workflow\_dispatch）→ `node scripts/run-ttml-sync.mjs`（env：SUPABASE\_URL/SERVICE\_ROLE\_KEY/DRY\_RUN='false'/SYNC\_BUDGET='50000'）→ import cloudflare/ttml-sync/worker.js 的 `sync(env)`
- **逻辑**：拉第三方 manifest（2755337087.github.io/ttml-hub，ETag 304 短路）→ revision 变化才拉索引全量 diff：
  - 已导入版本（external\_id 命中）：sha256 未变=unchanged；变了=更新 ttml\_text（**同步唯一的自动写库**）；
  - 其余一律入 ttml\_hub\_pending 待人工确认（绝不自动合并/建歌；Live/Remaster/伴奏等 LOW\_QUALITY 标记强制降档）；
  - hub 删除 → 跟随删 lyric\_versions / 删白板歌（D4）；
  - 子请求预算用尽则本轮不落 revision，下轮续跑；单歌失败跳过记日志；detectLangsFromTtml 正则提取语言集合写 langs 摘要。
- **输出**：写 lyric\_versions.ttml\_text / ttml\_hub\_pending / ttml\_hub\_state；删除跟随。

### 链路 32：手动触发同步

- **入口**：Worker `/__sync?token=SYNC_TOKEN`（wrangler.toml crons=\[] 后保留的调试端点）
- **现状**：wrangler DRY\_RUN="true" 残留导致该端点永不写库（见 A4）；异常堆栈直接返回（见 A5/D7）。

***

## 六、邮件模块

### 链路 33：Netlify Function mailer

- **入口**：`POST /api/mailer`（netlify.toml redirect 到 /.netlify/functions/mailer），管理后台 callMailServer（adminApi.ts）与投稿成功通知调用
- **逻辑**：loadSmtp（service\_role 读 settings 表 smtp\_host/port/user/pass/admin\_email；未配置返回 skipped 不报错）→ nodemailer transport → 按 action 分发：test（测试信）/ notify（新投稿通知，**收件人固定 admin\_email**）/ approve / reject / batch（批量结果一封）→ HTML 模板（用户字段 escapeHtml，主题剥离 \r\n\t）→ 发送；错误经 humanizeMailError 翻译中文结论。
- **输出**：邮件外发；不写库。
- **风险**：匿名开放 + to 任意指定（D1）、CORS \*（D6）、secure:true（B6）。

***

## 七、构建 / 部署 / 插件

### 链路 34：SSG 构建与部署

- **入口**：git push → .github/workflows/deploy.yml
- **逻辑**：vite-ssg 构建 → includedRoutes 排除 /admin 与动态路径后，collectDynamicRoutes 构建期用 anon key 从 Supabase 拉全部 song/album/artist/post id 逐一生成真实 HTML（隐藏歌清空 lrc\_text/lyrics\_text 防泄露）→ 部署 Netlify（netlify.toml，含 mailer function redirect）；404 预渲染 404.html。
- **文件**：vite.config.ts、verify-ssg.mjs（构建后校验）、.github/workflows/deploy.yml

### 链路 35：Cloudflare Worker 部署

- open-api.js → CF Dashboard/wrangler 部署绑定 api.lrcshare.com（env：SUPABASE\_URL/SUPABASE\_ANON\_KEY）；ttml-sync worker（secrets：SUPABASE\_SERVICE\_ROLE\_KEY、SYNC\_TOKEN；vars：TTML\_HUB\_BASE/DRY\_RUN/SYNC\_BUDGET）。wrangler.toml 无明文密钥。

### 链路 36：Lyrico APP 插件（com.lrcshare.source）

- **入口**：Lyrico APP 内歌词源搜索/播放
- **逻辑**：source.js 搜索 → `GET /v1/search`（type=song）+ 本地 `/v1/catalog` 快照负向预过滤 → 结果逐首 enrich（同步 HTTP 拉 /v1/song/:id 详情，internal 缓存）→ getLyrics：优先 lyric\_lines 结构化数据（多语言/音译轨道映射 APP 模型），兜底解析 LRC/TTML → 返回歌词。manifest 1.5.1 / 协议 API 4。
- **文件**：lyrico-plugin/com.lrcshare.source/（source.js、lib/02\_lyrics.js 等 3 文件）

***

# 任务 3：统计汇总

## 3.1 问题数量

| 分类      |     数量 | 明细                                                                                                                    |
| ------- | -----: | --------------------------------------------------------------------------------------------------------------------- |
| 残留废弃代码  |  **9** | 确定可清理 7（A1 SwitchTest、A2/A3 两个死函数、A4 DRY\_RUN 残留、A5 堆栈返回、A6 插件 debug 日志、A7 死分支、A8 文档注释错误——其中 A1-A8 为 8 项可处理项，A9 为说明项） |
| 潜在 BUG  | **12** | 高 2（B1 行表重复、B2 假成功）、中 7（B3-B9）、低 3（B10-B12）；另有 5 条说明项不计入                                                              |
| 性能/架构优化 |  **6** | 中 2（C1 catalog 子请求、C2 内存分页）、低 3（C3/C4/C6）、说明 1（C5）                                                                    |
| 安全风险    | **10** | 高 1（D1 邮件开放中继）、中 3（D2 注入、D3 XSS、D4 AboutView）、低 6（D5-D10）；另有 8 项已核实正常的安全面                                             |

**按处置优先级**：

- **立即修**：D1（邮件滥发）、B1+B2（写库错误静默致数据错乱/假成功）
- **尽快修**：A1（删测试页）、D2（hubId 编码）、B3+B4+B5（可观测性/超时）、A5+A6（调试残留）
- **计划修**：D3+D4（DOMPurify）、B8（搜索 is\_show/转义）、B6（mailer secure）、B9（ID 统一 UUID）、C1-C3（性能）
- **知情即可**：A9、C4/C5、B10-B12 及各说明项

## 3.2 业务链路数量

| 模块          |    链路数 | 编号     |
| ----------- | -----: | ------ |
| 前台展示        |     11 | 1-11   |
| 投稿          |      2 | 12-13  |
| 后台管理        |      8 | 14-21  |
| 公开 API      |      9 | 22-30  |
| TTML Hub 同步 |      2 | 31-32  |
| 邮件服务        |      1 | 33     |
| 构建/部署/插件    |      3 | 34-36  |
| **合计**      | **36** | <br /> |

数据库表 17 张、RPC/触发器函数约 20 个、定时任务 1 个（GHA 每小时 ttml-sync）、HTTP 端点 10 个（9 个 API 端点 + 1 个邮件 function）、前端路由页 27 个（前台 16 + 后台 12，含 1 个待删测试页）。

## 3.3 误报澄清（初判经复核推翻，不计入清单）

1. **「投稿发布链丢弃 aliases/description/lyrics\_text/is\_hidden/unlock\_code 五个字段」——不成立**。复核投稿表单（BatchSubmitPanel L411-L427、VersionSubmitPanel L334-L346）：投稿者采集字段仅 title/artists/album/duration/track/lrc\_text/versions/video\_url，**这五个字段本就是管理员后置字段**（别名、简介、人工美化文本歌词、隐藏标记、解锁口令均在 SongFormDialog 歌曲编辑里维护），SubmissionsView 无 syncSongSecrets 调用属正常流程而非丢失。
2. **「review-data emit 含 is\_hidden/unlock\_code」——引用代码不存在**，全仓 grep 零命中，系子审计臆造，已剔除。

## 3.4 待确认事项清单

- [ ] Supabase 面板是否已关闭公开注册（D10 的安全边界依赖）
- [ ] CF 套餐子请求上限与当前 songs/artists/albums 行数（C1 风险量化）
- [ ] CF zone 级 WAF/限流规则是否已启用（open-api 无限流的兜底）
- [ ] albums 表是否有 is\_show 列（B8 专辑搜索建议是否同步加过滤）
- [ ] 线上 articles where slug='about' 的 content 存储格式（D4 修法依赖）
- [ ] mailer 部署是否已配 SUPABASE\_SERVICE\_ROLE\_KEY（A8 注释修正后核对线上配置）

