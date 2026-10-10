# 12 · 歌曲分享（音乐挂件）演进方案

> 状态：**方案待确认，未执行**。确认后按文末「批次计划」分四批实施，每批完成后单独确认。
> 对应 SQL（确认后编写）：`12-music-shares.sql`

## 一、需求与定位

类似 Hexo 博客常见的「音乐挂件」：访客和站长分享自己喜欢的歌曲/专辑，前台以**右下角浮动推荐卡**呈现
（封面/曲名/歌手/推荐人/推荐理由），全站底部有**浮动播放器**；**每次进站随机一首自动播放**；用户可投稿、后台审核管理；
另设一个**歌曲分享页**，卡片墙形式展示，后台可手动置顶排序。

**定位边界（站长已确认）**：

- 这是与「站长逼逼」同级的轻量附属功能，**不是与歌词并列的板块，站内不提供任何音频文件**；
- **只接入官方提供 iframe/嵌入组件、传 ID 即可播放的平台，不做任何非官方接口逆向、不代理音频流**；
- **官方支持嵌入的平台全部纳入**（当前共 9 家，见第二节），平台以「注册表」方式配置，将来新平台具备官方嵌入能力时按同一模式增补；
- 投稿引导优先级：**网易云音乐 → YouTube / B站（通常可完整播放）→ Spotify / Apple Music / Deezer / Tidal（未登录多为 30 秒预览）→ SoundCloud / Bandcamp（独立音乐人为主）**；
- QQ 音乐 / 酷狗 / 酷我无官方第三方外链能力，**不进平台下拉、不支持**；
- **只接受单曲和专辑，禁止投稿歌单/合集/播放列表**；
- **进站即自动播放**：每次打开网站随机选一首 approved 单曲，自动升起底部播放器尝试出声（浏览器拦截见第六节说明），不需要用户先点播放。

**投稿人身份（复用 contributors 账号，不做独立实体）**：

- 歌曲分享直接关联现行 `public.contributors`：已有歌词贡献者可以用**自己的账号**分享歌曲；新投稿人在审核通过时由后台创建 contributor 账号；
- 新增**一个**预置标签「歌曲分享」（不设「音乐人」标签，音乐人也是歌曲分享者）；
- **名单隐藏规则**：`tags` 中**只有**「歌曲分享」这一个标签的账号，不进首页「优秀贡献者」和 `/contributors` 贡献者页
 （他们在歌曲分享页亮相）；已有歌词贡献者账号标签不止一个（如 `['歌词提交','歌曲分享']`），照常出现在贡献者名单，分享歌曲不产生任何副作用；
- **创作者自荐是「每一条分享」的属性，不是账号属性**：投稿某一首歌/专辑时可勾选「这是我本人的原创作品」，
  仅**这一条**走创作者专属卡片样式；同一个账号分享别人的歌仍是普通推荐卡。该勾选随投稿进入审核，管理员可核实/取消，防止冒认。

## 二、平台支持清单（9 家，均有官方依据）

元数据分两档：A 档有官方 oEmbed/公开 API（曲名/歌手/封面自动取）；B 档只有官方嵌入组件（曲名/歌手手填，卡片封面用平台徽标或官方小组件）。

| 顺序 | key | 平台 | 接受类型（仅单曲/专辑） | 官方嵌入 | 元数据 | 播完事件（自动联播） |
|---|---|---|---|---|---|---|
| 1 | `netease` | 网易云音乐 | song（type=2）、album（type=1） | `music.163.com/outchain/player` | B 档（无 oEmbed；卡片内嵌官方 86px 小组件，自带封面/曲名/歌词） | ✘ 无 API |
| 2 | `youtube` | YouTube / YouTube Music | song（watch/shorts/embed/music 同 ID） | `www.youtube.com/embed/{id}` | A 档（官方 oEmbed） | ✔ IFrame API 的 ENDED |
| 3 | `bilibili` | B站 | song（视频 BV/av 号） | `player.bilibili.com/player.html?bvid=...`（[官方站外播放器文档](https://player.bilibili.com/?v=1.0.23)） | B 档（无 oEmbed；组件 poster 自带封面） | ◑ postMessage + 进度兜底 |
| 4 | `spotify` | Spotify | song（/track/）、album（/album/） | `open.spotify.com/embed/{type}/{id}`（[官方 oEmbed](https://developer.spotify.com/documentation/embeds/reference/oembed)） | A 档 | ✔ iFrame API |
| 5 | `apple_music` | Apple Music | song（链接带 `i=`）、album（不带 i） | `embed.music.apple.com/{cc}/album/{albumId}?i={songId}`（[官方营销工具](https://artists.apple.com/support/1117-apple-music-marketing-tools)） | A 档（官方 iTunes Lookup） | ✘ 无 API |
| 6 | `soundcloud` | SoundCloud | song（track；sets 禁投） | `w.soundcloud.com/player/?url=...` | A 档（官方 oEmbed） | ✔ Widget API 的 FINISH |
| 7 | `deezer` | Deezer | song（/track/）、album（/album/） | `widget.deezer.com/widget/{theme}/{type}/{id}`（[官方插件页](https://developers.deezer.com/musicplugins)） | A 档（官方公开 API `api.deezer.com`） | ✘ SDK 已停用，无事件 |
| 8 | `tidal` | Tidal | song（/track/、/browse/track/）、album | `embed.tidal.com/{tracks\|albums}/{id}`（[官方文档](https://developer.tidal.com/documentation/embeds/embeds-overview)） | **B 档**（2026-10 实测：oEmbed `oembed.tidal.com` 对任意 ID 甚至假 ID 都只回嵌入壳，无标题/封面、不能验证存在性，故按手填处理，靠试播自证） | ✘ 无对外 JS API |
| 9 | `bandcamp` | Bandcamp | song（track）、album | `bandcamp.com/EmbeddedPlayer/track={id}` 或 `/album={id}`（[官方帮助](https://get.bandcamp.help/en/articles/15263071-how-do-i-create-a-bandcamp-embedded-player)） | B 档（无公开 oEmbed，见第三节特例） | ✘ 无对外 JS API |

**联播总述**：播放队列中来自 **YouTube / SoundCloud / Spotify / B站（best-effort）** 的条目可凭官方事件在播完后**自动切下一条（跨平台也成立）**；
网易云 / Apple / Deezer / Tidal / Bandcamp 无对外事件，无法感知播完，停在当前条目等用户手动切。手动上一首/下一首对全部平台可用。

**官方固有限制（UI 如实提示）**：

1. Spotify / Apple Music / Deezer / Tidal 未登录访客通常只能听 **30 秒预览**，登录对应平台后才可能听完整曲；
2. 网易云部分版权歌在官方组件内本身不可播；投稿流程提供**官方组件当场试播**提前发现；
3. 浏览器自动播放策略：进站自动播放属于「无手势有声播放」，Chrome/Edge 可能拦截（Safari 更严），拦截时官方组件停在播放键态，用户点一下即可；用户一旦在本站点过一次，后续进站自动播放成功率会提高（浏览器媒体互动策略）。**不做静音自动播放**（站长要求出声）。

## 三、平台选择、链接正则与识别（下拉选择，不存在「不支持的链接」分支）

投稿页先选平台（下拉固定 9 家，顺序同上），再粘贴链接；前端按所选平台**实时正则校验**，未通过不能识别/提交；函数服务端同规则复核。

| 平台 | 接受形态（正则要点） | 拒绝形态 |
|---|---|---|
| 网易云音乐 | `music.163.com/(#/)?(song\|album)\?id=\d+`；短链 `163cn.tv/` 跟随后复核 | `/playlist?id=`、歌手页等 |
| YouTube | `youtube.com/watch?v=[\w-]{11}`、`music.youtube.com/watch?v=`、`youtu.be/[\w-]{11}`、`/embed/`、`/shorts/` | `/playlist?list=`、频道页 |
| B站 | `bilibili.com/video/(BV[\w]+)`、`/video/av\d+`；短链 `b23.tv/` 跟随后复核 | 专栏、直播、合集、番剧 |
| Spotify | `open.spotify.com/(track\|album)/[\w]+`；`spotify.link/` 跟随后复核 | `/playlist/`、`/artist/`、`/episode/` |
| Apple Music | `music.apple.com/[a-z]{2}/album/(/[^/]+)?/\d+(\?i=\d+)?` | `/playlist/`、`/artist/`、MV |
| SoundCloud | `soundcloud.com/{user}/{track}`（函数经 oEmbed 复核为 track） | `/sets/`、用户主页 |
| Deezer | `deezer.com/(../)?(track\|album)/\d+`、`www.deezer.com/(track\|album)/\d+` | `/playlist/`、`/artist/` |
| Tidal | `tidal.com/(browse/)?(track\|album)/\d+`、`listen.tidal.com/(track\|album)/\d+` | playlist、artist、video |
| Bandcamp | **特例**：`*.bandcamp.com/(track\|album)/{slug}` 链接里只有 slug、没有嵌入所需数字 ID（官方不提供按 slug 查询的公开接口，不允许爬页面），因此 Bandcamp 投稿时**粘贴官方「Share/Embed」弹窗里的嵌入代码**，函数从代码中正则提取 `track=\d+`/`album=\d+` 与回链 URL，并从代码 `<a>` 文案预填曲名/歌手（可手改）；自定义域名的 Bandcamp 站点本期不支持 | 仅贴 slug 链接（提示改贴嵌入代码）、其他平台代码 |

## 四、数据库设计：`music_shares` 表

一条记录 = 一次单曲/专辑分享。不拆曲目。投稿人关联现行 `contributors`（待审阶段只存昵称/联系快照，审核通过时回写 contributor_id）。

```sql
CREATE TABLE public.music_shares (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ===== 平台与内容标识（服务端解析后写入，不信任前端传值） =====
  platform         text NOT NULL,
  -- netease / youtube / bilibili / spotify / apple_music / soundcloud / deezer / tidal / bandcamp
  media_type       text NOT NULL,
  -- song / album（视频/单曲类内容一律 song）
  platform_id      text NOT NULL,
  -- 平台内容 ID：多数为数字/字符串 ID；soundcloud 存规范化 track URL；
  -- apple 存 cc/albumId/songId 复合串；bandcamp 存 't123' / 'a123'
  source_url       text NOT NULL,        -- 原始回链（「原平台打开」用）

  -- ===== 展示信息 =====
  title            text NOT NULL,
  artist           text,
  cover_url        text,                 -- A 档官方封面；B 档为 NULL（卡片用官方组件/平台徽标）
  reason           text,                 -- 推荐理由，可空，1~200 字
  is_own_work      boolean NOT NULL DEFAULT false,
  -- 本条为创作者本人自荐（投稿人勾选、审核时核实）；仅本行使用创作者卡片样式

  -- ===== 投稿人：审核通过后关联 contributors；待审阶段仅快照 =====
  contributor_id   uuid REFERENCES public.contributors(id) ON DELETE SET NULL,
  -- ⚠️ contributors.id 的真实类型以批次①执行前库内核对为准（uuid/text），
  --    与 songs/submissions.contributor_id 保持一致；此处先按 uuid 设计
  submitter_name   text NOT NULL,        -- 投稿时昵称快照（待审列表/兜底展示）
  submitter_contact jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- 复用现有 CONTACT_TYPES 结构，如 {"email":"a@b.c","qq":"12345"}；仅后台可见
  user_email       text,                 -- 邮箱冗余列（接收审核结果通知）

  -- ===== 前台排序（与 articles/contributors 的 sort 语义一致） =====
  sort             integer NOT NULL DEFAULT 0,
  -- sort>0 = 手动置顶（数字小在前）；sort=0 按 approved_at 时间倒序

  -- ===== 审核状态 =====
  status           text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','approved','rejected')),
  reject_reason    text,
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  approved_at      timestamptz,

  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),

  -- ===== 跨平台同曲去重规范化生成列 =====
  norm_title       text GENERATED ALWAYS AS (lower(btrim(title))) STORED,
  norm_artist      text GENERATED ALWAYS AS (lower(btrim(artist))) STORED,

  CONSTRAINT music_shares_platform_chk   CHECK (platform IN
                     ('netease','youtube','bilibili','spotify','apple_music',
                      'soundcloud','deezer','tidal','bandcamp')),
  CONSTRAINT music_shares_media_type_chk CHECK (media_type IN ('song','album')),
  CONSTRAINT music_shares_reason_len_chk CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 200),
  CONSTRAINT music_shares_source_url_chk CHECK (source_url ~ '^https://'),
  -- approved 必须已关联贡献者账号（与歌词投稿发布同语义）
  CONSTRAINT music_shares_approved_owner_chk
    CHECK (status <> 'approved' OR contributor_id IS NOT NULL)
);

-- ① 同平台同内容：仅一条 approved
CREATE UNIQUE INDEX uq_music_shares_approved_platform
  ON public.music_shares (platform, platform_id)
  WHERE status = 'approved';

-- ② 跨平台同曲：歌手+歌名规范化后仅一条 approved（歌手缺失无法可靠比对，不纳入）
CREATE UNIQUE INDEX uq_music_shares_approved_song
  ON public.music_shares (norm_title, norm_artist)
  WHERE status = 'approved' AND norm_artist IS NOT NULL AND norm_artist <> '';

CREATE INDEX idx_music_shares_status_created
  ON public.music_shares (status, created_at DESC);
CREATE INDEX idx_music_shares_page_sort
  ON public.music_shares ((sort = 0), sort, approved_at DESC)
  WHERE status = 'approved';
```

**前台取数**：anon SELECT 后用 PostgREST 嵌套带出
`contributors!music_shares_contributor_id(id,name,avatar,public_bio,bio,contact_value,public_contact,tags,is_owner)`，
展示昵称/头像/标签均以关联账号为准；`submitter_name` 仅兜底（理论上 approved 必有账号）。

**双层去重（站长要求：原则上禁止重复推荐）**：

1. 提交前前端：识别后用同一套规范化规则比对 approved + pending：
   - 同平台 ID 命中 approved →「《title》已被 {昵称} 分享，去听听 →」附链接；命中 pending →「已有正在审核的分享，请勿重复提交」；
   - 跨平台 `(norm_title, norm_artist)` 完全相等且歌手非空 → 提示歌曲已存在；歌手打错/缺失比对不出如实放行（人工审核兜底）；
2. 数据库两个 approved 部分唯一索引硬兜底，23505 冲突翻译为友好文案；
3. 规范化只做 trim + 折叠空格 + 英文小写，不做繁简/括号/feat. 清洗，避免误杀现场版/remix。

### 权限模型（沿用现行约定：RLS 双策略 + REVOKE 纵深防御）

| 角色 | 能力 |
|---|---|
| anon | SELECT 仅 approved；INSERT 仅投稿列且 WITH CHECK status='pending'；无 UPDATE/DELETE；**sort / status 等审核结论列不接受投稿人直写** |
| authenticated | ALL（即管理员） |
| service_role | ALL（Netlify 函数） |

> 注：`is_own_work` 是投稿人的**自荐声明**（允许随投稿写入，管理员审核时可改）；
> `contributor_id` 允许投稿人在「联想命中已有账号」时随投稿上送（与 submissions 表同模式，FK 兜底账号必须真实存在，审核可改/可清空）；
> `sort`/`status`/`reviewed_*`/`approved_at` 等审核列不在 anon 授权列内。

```sql
ALTER TABLE public.music_shares ENABLE ROW LEVEL SECURITY;

CREATE POLICY music_shares_anon_select ON public.music_shares
  FOR SELECT TO anon USING (status = 'approved');

CREATE POLICY music_shares_anon_insert ON public.music_shares
  FOR INSERT TO anon WITH CHECK (status = 'pending');

CREATE POLICY music_shares_authenticated_all ON public.music_shares
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY music_shares_service_role_all ON public.music_shares
  FOR ALL TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.music_shares FROM PUBLIC, anon;
GRANT SELECT ON public.music_shares TO anon;
GRANT INSERT (id, platform, media_type, platform_id, source_url,
              title, artist, cover_url, reason, is_own_work,
              contributor_id,
              submitter_name, submitter_contact, user_email, created_at)
  ON public.music_shares TO anon;
GRANT ALL ON public.music_shares TO authenticated, service_role;
```

`updated_at` 触发器：批次①先查库内是否已有通用 `set_updated_at()`，有则复用。

## 五、contributors 标签与名单隐藏（只过滤展示位，绝不过滤下拉框）

1. 后台贡献者管理 `PRESET_TAGS`（`src/views/admin/ContributorsView.vue` 第 349 行
   现为 `['歌词提交', 'Logo设计', '网站搭建', '资料核对']`）追加 **`'歌曲分享'`**；标签仍可自由新建，不引入第二种音乐标签；
2. 审核通过创建新账号时默认打 `['歌曲分享']`；关联到已有贡献者账号时**不改动其 tags**（老账号不被误伤）；
3. **不改 `get_top_contributors` RPC**：歌词投稿（SubmitView/VersionSubmitPanel）、评论区 TwikooComment、
   文章作者选择（PostsView/PostView）、歌曲分享投稿页的用户名联想/下拉框**必须能搜到全部贡献者（含纯音乐账号），一律不做过滤**；
4. 隐藏只在两个**展示位**做前端过滤（新增共享工具 `isMusicOnlyContributor(c)`：`tags` 仅含「歌曲分享」一个标签即为 true）：
   - HomeView「优秀贡献者」卡片区：为避免过滤后不足 12 格，拉取条数提高到 24（`getContributors({ limit: 24 })`），过滤后取前 12；
   - ContributorsView 贡献者页（`api.getContributors()` 全量结果过滤后渲染）；
   其余所有调用点（一切用户名下拉/联想）保持原样、不过滤。隐藏为视觉层隐藏，不改动任何接口与权限。

## 六、Netlify Function：`resolve-music`（唯一新增服务端函数）

- 路径：`netlify/functions/resolve-music.mjs`；`netlify.toml` 增加 `/api/resolve-music` 重定向；
- `POST {VITE_FUNC_BASE}/api/resolve-music`，body `{ platform, urlOrEmbed }`；与邮件函数同站，复用 `VITE_MAIL_BASE`，不新增站点/环境变量；
- 处理：① 按第三节规则复核、提取 media_type/platform_id（短链跟随 3xx；Bandcamp 解析嵌入代码）；② 仅转发**官方**端点取元数据：
  Spotify/YouTube/SoundCloud → 各家官方 oEmbed；Apple → iTunes Lookup；Deezer → `api.deezer.com`；网易云/B站/Tidal/Bandcamp → 不取（Tidal oEmbed 实测无元数据）；
  歌单等拒绝形态直接报错；
- 返回统一 `{ code, data }`：

```json
{
  "code": 0,
  "data": {
    "platform": "spotify", "media_type": "song",
    "platform_id": "3Zwu2K0Qa5sT6teCCHPShP",
    "source_url": "https://open.spotify.com/track/3Zwu2K0Qa5sT6teCCHPShP",
    "title": "歌名", "artist": "歌手",
    "cover_url": "https://i.scdn.co/image/...",
    "need_manual": false
  }
}
```

- B 档平台 `need_manual: true`、`cover_url: null`、标题歌手空（Bandcamp 从嵌入代码尝试预填）；
- 安全：输入长度上限（链接 2048 / Bandcamp 代码 8000）；按所选平台限定 host；外呼 8s 超时；不带凭据；
- 后台「手动添加」复用同一函数，两条入口同一校验。

## 七、前端设计

### 7.1 投稿页 `/music-share/submit`（`MusicShareSubmitView.vue`）

原生粉系风格对齐 SubmitView，流程：

1. **选择平台**（9 家下拉，旁注引导优先级与预览时长提示）；
2. **粘贴链接 / Bandcamp 粘贴嵌入代码**：按平台实时正则校验，错误即时红字提示；
3. 点「识别」→ 调 resolve-music → 显示平台徽标 + 单曲/专辑类型；
4. **官方组件当场试播（可用性自证）**：识别成功内嵌真实官方组件（默认不自动播放），网易云无版权、地区限制在此阶段即可发现；
5. **曲名**（必填）/**歌手·UP 主**（选填）：A 档自动带入且**允许修正**（YouTube oEmbed 的歌手位是频道名，未必是真实歌手），B 档（网易云/B站/Tidal/Bandcamp）手填；
6. **推荐理由**（选填，0~200 字，字数计数）；
7. **「这是我本人的原创作品」勾选框**：勾选后该条以创作者自荐样式展示；文案旁注明需经站长核实，冒认会被取消；
8. **个人信息**：昵称（必填，缺省「匿名」；输入时走与歌词投稿页**完全相同**的全量贡献者联想
   （`getContributors` 全量、不过滤，含纯音乐标签账号），命中可声明「我是该账号」并记录
   contributor_id 随投稿上送——submissions 现有 `contributor_id` 列即此模式；未命中则只存快照名）、
   邮箱（选填）、联系方式动态行（复用 `CONTACT_TYPES`，选填）；
9. 提交前双层去重检查，命中即阻止并友好提示；
10. 提交成功提示进审核；复用现有 `/api/mailer` 的 `notify` 通知站长（以平台中文名+曲名为标题，不改鉴权/SMTP）；
11. 识别/试播/提交全部在客户端事件中触发，SSG 首屏零 iframe、零函数请求。

### 7.2 浮动推荐卡 `components/music/MusicShareCard.vue`（右下角）

- 挂 DefaultLayout（与 SearchOverlay/ImgPreview 同级，后台不显示）；无 approved 数据不出现；
- **进站自动播放哪一首，浮卡首条就展示哪一首**；可上一条/下一条轮换（在已拉取的 approved 集合内环视）；
- 内容：媒体区 + 「{昵称} 推荐」+ 曲名/歌手 + 理由（两行截断、hover 全文）+ 播放/暂停（与 dock 联动）+ 关闭；
- **两种样式**：普通推荐卡（默认）；`is_own_work=true` 显示「创作者」徽标与金边强调（分享页同款视觉语言的小卡版）；
- 媒体区分档：
  - 网易云：内嵌官方 86px 小组件（`auto=0`，真实封面/曲名/歌词入口），推荐人/理由在下方；
  - A 档五家（Spotify/YouTube/SoundCloud/Apple/Deezer/Tidal）：官方封面图；
  - B站/Bandcamp：平台徽标占位（播放后 dock 内官方组件有真实封面）；
- 「查看全部」→ `/music-shares`；关闭按 sessionStorage 本次会话不再出现；移动端贴边小卡，dock 升起时自动隐藏。

### 7.3 全局浮动播放器 `components/music/MusicPlayerDock.vue` + `stores/musicPlayer.ts`

- store：队列、当前索引、dock 开合、**进站自动播放开关（localStorage，默认开）**；
- **进站自动播放**：DefaultLayout 客户端挂载后（SSG 安全，v-if clientMounted 避免 hydration 不匹配），
  拉取最新一批 approved 条目（上限 100），**随机抽 1 条单曲**（无单曲时回退专辑），升起 dock 并以各平台自动播放参数加载
  （netease `auto=1` / youtube&bili `autoplay=1` / spotify&soundcloud ready 后调官方 play() / apple&deezer&tidal 用各自播放参数尝试）；
  被浏览器拦截时保持组件原生播放键可见，不做静音绕过；
- 每次「打开网站」（布局挂载）触发一次，站内路由跳转不重复触发；随机池忽略 sort（置顶只作用于分享页排序）；
- dock 固定底部、布局层挂载，跨页播放不中断；
- 各平台嵌入形态：

| 平台 | 形态 | 自动联播 |
|---|---|---|
| netease song | 86px 细条（type=2） | ✘ |
| netease album | 大面板（type=1，官方曲目表+连播） | ✘ |
| youtube / bilibili | 16:9 小面板 + 官方 API | ✔ / ◑ |
| spotify | 152px 细条 + iFrame API | ✔ |
| soundcloud | 166px + Widget API | ✔ |
| apple_music | 175px（专辑加高） | ✘ |
| deezer | ~240px 细 widget（album 加高） | ✘ |
| tidal | 按 oEmbed html 尺寸 | ✘ |
| bandcamp | track 细条 / album 大卡片 | ✘ |

- 切歌：同平台 API 支持（Spotify/YT/SC）优先同 iframe 切换，其余重建；自动联播仅对有播完事件的平台生效；
- 标题区：曲名/歌手/平台徽标/「原平台打开」/自动播放开关；关闭即收起并停止。

### 7.4 歌曲分享页 `/music-shares`（`MusicSharesView.vue`）

- **卡片墙**（花里胡哨方向：深色/渐变舞台感背景 + 大封面 + 黑胶/波形装饰元素，保持粉系主色调可切换，移动端单列）；
- **两种卡片**：
  - 普通推荐卡：封面、曲名/歌手、平台徽标、「{昵称} 推荐」、理由；
  - **创作者自荐卡**（`is_own_work`）：金色描边/渐变高光、「创作者」角标、头像放大位、「原创作品」字样，视觉权重明显高于普通卡；
- 排序：`ORDER BY (sort=0), sort ASC, approved_at DESC`——sort>0 置顶位（数字小在前），其余按通过时间倒序；
- 平台筛选（9 家+全部）+ 「只看创作者」开关；点播放入队列并激活 dock；SSG 预取 approved（含 contributors 嵌套）。

### 7.5 后台 `views/admin/MusicSharesView.vue`

- 路由 `/admin/music-shares`，菜单「🎶 歌曲分享」（投稿审核附近）；
- 状态 tab + Element Plus 表格 + 分页，对齐现有审核页；
- 审核动作：通过 / 拒绝（必填原因）；通过时选择关联已有贡献者或新建账号（新建账号默认 `tags=['歌曲分享']`，
  可改昵称/头像/简介/联系方式，复用贡献者表单组件或同字段子集），回写 contributor_id；
- 行内可改：曲名/歌手/理由/封面（封面仅在官方地址失效时可改）、**`is_own_work` 核实勾选**、**sort 置顶数字**；
- 删除 / **手动添加**（同一套下拉+识别+试播，手动添加直接 approved，同样必填关联账号）；
- **专辑折叠**：el-table expand 行，展开内嵌官方专辑组件预览；song 行无箭头；
- 拒绝且有邮箱时复用 mailer reject 通知；移动端对齐 SubmissionsView 现有方案。

### 7.6 其他改动点

- 类型 `types.ts`：`MusicShare`（含嵌套 `contributor`）/ `MusicShareInsert` / `MusicPlatform`（9 家联合类型）/ `MusicMediaType`；
- **新增 `src/lib/musicPlatforms.ts`（平台注册表，单一真相源）**：每家一条配置
  （key、中文名、下拉顺序、链接正则、占位符、嵌入 URL 构造器、自动播放参数、元数据档位、播完事件能力、徽标）；
  投稿页/函数（mjs 镜像同规则）/卡片/dock/后台共用，新增平台只改注册表；
- `api.ts`：`getMusicShares()`（含 contributors 嵌套、页面排序）、`getMusicShareDupHints()`、`submitMusicShare()`（显式列名）；
  账号联想直接复用现有 `getContributors()`（全量，不过滤）；
- 新增共享小工具 `isMusicOnlyContributor(c)`（放 `src/lib/contributorTags.ts`），仅 HomeView/ContributorsView 两个展示位使用；
- `adminApi.ts`：音乐分享的分页/审核/排序更新，沿用现有泛型；
- 图标：已有 netease/spotify/qq-music/bilibili；新增 youtube / soundcloud / apple-music / deezer / tidal / bandcamp 线性徽标（批次③前）；
- AppNavbar 增加「歌曲分享」入口（逼逼附近）；
- 全部新增代码带详细中文注释。

## 八、批次计划（每批完成确认后再继续）

| 批次 | 内容 |
|---|---|
| ① | 库内核对 contributors.id 类型与现有触发器/函数现状 → `12-music-shares.sql` 建表部分（执行前再给一次表结构复核）→ resolve-music 函数 + netlify.toml → 平台注册表/类型/api → 投稿页（下拉/正则/识别/试播/去重/创作者勾选/账号联想）+ 路由 + 导航 + 邮件复用 |
| ② | 后台 PRESET_TAGS 追加标签 + 两个展示位前端过滤（`isMusicOnlyContributor`，HomeView 拉取 24 取 12、ContributorsView）→ 后台审核管理（关联/新建贡献者、列表/审核/编辑/is_own_work/sort/删除/手动添加、专辑折叠预览、移动端） |
| ③ | 歌曲分享页卡片墙（两种卡片样式、置顶排序、创作者筛选）+ 右下角浮动推荐卡 + 6 枚新平台图标 |
| ④ | Pinia store + 底部播放器 + 9 家 adapter + 进站随机自动播放 + 播完事件联播（4 家）+ 跨页保活/移动避让 |

## 九、验收与安全验证

1. RLS：relrowsecurity=true；anon curl 实测只读 approved、无法插 sort/status/review 列/生成列、无法改删；pending 行可带本人联想的 contributor_id 但无法伪造 approved；
2. 去重：同平台 ID、跨平台同名同歌手双层拦截生效；缺失歌手/不同版本不误杀；
3. 函数：9 家单曲+专辑真实链接各测（含 163cn.tv/b23.tv/spotify.link 短链、YT Music、Apple 带不带 i、Bandcamp 嵌入代码）；歌单全部被拒；平台与链接不符被拒；超长输入被拒；
4. 投稿页：误填即时报错；试播组件可真实交互（含一条网易云无版权歌）；已有账号联想可命中纯音乐标签账号；
5. 名单隐藏：tags 恰为 `['歌曲分享']` 的账号不出现在首页优秀贡献者与 /contributors；多标签账号照常出现；**歌词投稿页/版本补充页/歌曲分享投稿页的昵名下拉框能搜到全部账号（含纯音乐账号），RPC 零改动**；
6. 创作者样式：仅 is_own_work=true 的条目走创作者卡片（分享页+浮卡），同账号普通分享不受影响；审核可改该标记；
7. 排序：sort>0 按数字升序置顶，sort=0 按通过时间倒序；随机播放池不受 sort 影响；
8. 进站播放：每次挂载随机一首；浏览器放行时自动出声，拦截时显示播放键；刷新/跨页播放不中断；自动播放开关可关；
9. 联播：YouTube/SoundCloud/Spotify 播完自动续；B 站 best-effort；其余 5 家停住等手动；
10. SSG：`verify-ssg.mjs` 通过，首屏无 iframe/无函数请求；移动端浮卡与 dock 不遮挡；
11. 回滚：DROP TABLE 回收数据层；移除两个展示位的前端过滤即恢复榜单；前端/函数文件随 PR 回退。全程不改动任何现存 RPC。

## 十、待确认的默认决策（无异议即按此实施）

1. 对外文案「歌曲分享」，路由 `/music-shares`、投稿页 `/music-share/submit`、后台菜单「🎶 歌曲分享」；
2. 投稿人复用 contributors：通过时关联已有账号或新建账号（新账号打单个标签「歌曲分享」）；不引入「音乐人」标签；
3. 名单只隐藏 tags 恰为「歌曲分享」单标签的账号；多标签（有歌词贡献）账号不受影响；
4. 创作者自荐为行级 `is_own_work`，投稿勾选、审核核实，只影响该条卡片样式（分享页+浮卡）；
5. 平台固定 9 家注册表（网易云/YouTube/B站/Spotify/Apple/SoundCloud/Deezer/Tidal/Bandcamp），后续官方能力变化按注册表增删；
6. 只收单曲/专辑，歌单一律禁止；Bandcamp 因官方机制改贴嵌入代码；
7. 分享页排序：sort>0 置顶（数字小在前），其余 approved_at 倒序；
8. 进站随机一首自动播放（优先单曲），默认开启，dock 上提供开关（localStorage 记忆）；浏览器拦截不做静音绕过；
9. 浮卡首条跟随本次随机播放的条目，关闭仅本次会话有效；
10. 跨平台同曲按歌手+歌名规范化精确相等硬拦截（仅 approved 入库），不做模糊匹配；
11. 一条记录不挂多个平台链接，本期不做备选平台。
