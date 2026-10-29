# 12 · 歌曲分享（音乐挂件）演进方案

> 状态：**已上线**。最终保留 **网易云 / YouTube / SoundCloud** 三家平台，其余六家（B站、Spotify、Apple Music、Deezer、Tidal、Bandcamp）已下架，QQ 音乐/酷狗/酷我因免登录取链接口失效未引入。
> 对应 SQL：[`sql/12-music-shares.sql`](./12-music-shares.sql)；后续迭代见 [`13`](./13-music-shares-platform-v2.md)、[`14`](./14-contributor-merge-music-shares.md)、[`15`](./15-music-share-pin.md)、[`16`](./16-music-share-public-contact.md)、[`17`](./17-music-share-profile-requests.md)。

## 一、需求与定位

类似 Hexo 博客常见的「音乐挂件」：访客和站长分享自己喜欢的歌曲/专辑，前台以**右下角浮动推荐卡**呈现
（封面/曲名/歌手/推荐人/推荐理由），全站底部有**浮动播放器**；**每次进站随机一首自动播放**；用户可投稿、后台审核管理；
另设一个**歌曲分享页**，卡片墙形式展示，后台可手动置顶排序。

**定位边界（站长已确认）**：

- 这是与「站长逼逼」同级的轻量附属功能，**不是与歌词并列的板块，站内不提供任何音频文件**；
- **最终保留三家平台**：网易云音乐、YouTube、SoundCloud（平台以「注册表」方式配置，将来新平台具备官方嵌入能力时按同一模式增补）；
- QQ 音乐 / 酷狗 / 酷我免登录取链接口实测失效（vkey 空 / 30020），**不进平台下拉、不支持**；
- **只接受单曲和专辑，禁止投稿歌单/合集/播放列表**；
- **进站即自动播放**：每次打开网站随机选一首 approved 单曲，自动升起底部播放器尝试出声（浏览器拦截见第六节说明），不需要用户先点播放。

**投稿人身份（复用 contributors 账号，不做独立实体）**：

- 歌曲分享直接关联现行 `public.contributors`：已有歌词贡献者可以用**自己的账号**分享歌曲；新投稿人在审核通过时由后台创建 contributor 账号；
- 新增**一个**预置标签「歌曲分享」（不设「音乐人」标签，音乐人也是歌曲分享者）；
- **名单隐藏规则**：`tags` 中**只有**「歌曲分享」这一个标签的账号，不进首页「优秀贡献者」和 `/contributors` 贡献者页
  （他们在歌曲分享页亮相）；已有歌词贡献者账号标签不止一个（如 `['歌词提交','歌曲分享']`），照常出现在贡献者名单，分享歌曲不产生任何副作用；
- **创作者自荐是「每一条分享」的属性，不是账号属性**：投稿某一首歌/专辑时可勾选「这是我本人的原创作品」，
  仅**这一条**走创作者专属卡片样式；同一个账号分享别人的歌仍是普通推荐卡。该勾选随投稿进入审核，管理员可核实/取消，防止冒认。

## 二、平台支持清单（最终保留 3 家）

| key | 平台 | 接受类型 | 元数据 | 播放方式 | 播完事件（自动联播） |
|---|---|---|---|---|---|
| `netease` | 网易云音乐 | song、album | Meting 接口取曲名/歌手/封面 | Netlify 函数实时换 mp3 直链 + 原生 `<audio>` 播放 | ✔ `<audio>` ended 事件 |
| `youtube` | YouTube / YouTube Music | song | 官方 oEmbed | IFrame Player API 完整控制 | ✔ IFrame API 的 ENDED |
| `soundcloud` | SoundCloud | song（sets 禁投） | 官方 oEmbed | Widget API 完整控制 | ✔ Widget API 的 FINISH |

**联播总述（定稿）**：三家平台**全部支持**播放结束自动联播（跨平台也成立）。网易云通过原生 `<audio>` 的 `ended` 事件，YouTube / SoundCloud 通过各自官方 JS API 的播完事件。

**进站自动播放与浏览器拦截**：进站自动播放属于「无手势有声播放」，Chrome/Edge 可能拦截（Safari 更严），拦截时播放器停在播放键态，用户点一下即可；用户一旦在本站点过一次，后续进站自动播放成功率会提高（浏览器媒体互动策略）。**不做静音自动播放**（站长要求出声）。

## 三、平台选择、链接正则与识别（下拉选择，不存在「不支持的链接」分支）

投稿页先选平台（下拉固定 3 家），再粘贴链接；前端按所选平台**实时正则校验**，未通过不能识别/提交；函数服务端同规则复核。

| 平台 | 接受形态（正则要点） | 拒绝形态 |
|---|---|---|
| 网易云音乐 | `music.163.com/(#/)?(song\|album)\?id=\d+`；短链 `163cn.tv/` 跟随后复核 | `/playlist?id=`、歌手页等 |
| YouTube | `youtube.com/watch?v=[\w-]{11}`、`music.youtube.com/watch?v=`、`youtu.be/[\w-]{11}`、`/embed/`、`/shorts/` | `/playlist?list=`、频道页 |
| SoundCloud | `soundcloud.com/{user}/{track}`（函数经 oEmbed 复核为 track） | `/sets/`、用户主页 |

## 四、数据库设计：`music_shares` 表

一条记录 = 一次单曲/专辑分享。不拆曲目。投稿人关联现行 `contributors`（待审阶段只存昵称/联系快照，审核通过时回写 contributor_id）。

```sql
CREATE TABLE public.music_shares (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- ===== 平台与内容标识（服务端解析后写入，不信任前端传值） =====
  platform         text NOT NULL,
  -- netease / youtube / soundcloud
  media_type       text NOT NULL,
  -- song / album
  platform_id      text NOT NULL,
  -- 平台内容 ID：youtube 为视频 ID，soundcloud 为规范化永久链接，netease 为数字 ID
  source_url       text NOT NULL,        -- 原始回链（「原平台打开」用）

  -- ===== 展示信息 =====
  title            text NOT NULL,
  artist           text,
  cover_url        text,
  reason           text,                 -- 推荐理由，1~200 字（14 号改为必填）
  is_own_work      boolean NOT NULL DEFAULT false,
  -- 本条为创作者本人自荐（投稿人勾选、审核时核实）；仅本行使用创作者卡片样式

  -- ===== 投稿人：审核通过后关联 contributors；待审阶段仅快照 =====
  contributor_id   uuid REFERENCES public.contributors(id) ON DELETE SET NULL,
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

  CONSTRAINT music_shares_platform_chk   CHECK (platform IN ('netease','youtube','soundcloud')),
  CONSTRAINT music_shares_media_type_chk CHECK (media_type IN ('song','album')),
  CONSTRAINT music_shares_reason_len_chk CHECK (reason IS NULL OR char_length(reason) BETWEEN 1 AND 200),
  CONSTRAINT music_shares_source_url_chk CHECK (source_url ~ '^https://'),
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

> 注：`platform` CHECK 约束在 [`13-music-shares-platform-v2.sql`](./13-music-shares-platform-v2.sql) 中收窄为三家；`reason` 在 [`14-contributor-merge-music-shares.sql`](./14-contributor-merge-music-shares.md) 中改为必填。

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

`updated_at` 触发器：复用项目通用 `set_updated_at()`。

## 五、contributors 标签与名单隐藏（只过滤展示位，绝不过滤下拉框）

1. 后台贡献者管理 `PRESET_TAGS` 追加 **`'歌曲分享'`**；标签仍可自由新建，不引入第二种音乐标签；
2. 审核通过创建新账号时默认打 `['歌曲分享']`；关联到已有贡献者账号时**不改动其 tags**（老账号不被误伤）；
3. **不改 `get_top_contributors` RPC**：歌词投稿、评论区、文章作者选择、歌曲分享投稿页的用户名联想/下拉框**必须能搜到全部贡献者（含纯音乐账号），一律不做过滤**；
4. 隐藏只在两个**展示位**做前端过滤（共享工具 `isMusicOnlyContributor(c)`：`tags` 仅含「歌曲分享」一个标签即为 true）：
   - HomeView「优秀贡献者」卡片区：拉取条数提高到 24，过滤后取前 12；
   - ContributorsView 贡献者页（全量结果过滤后渲染）；
   其余所有调用点（一切用户名下拉/联想）保持原样、不过滤。隐藏为视觉层隐藏，不改动任何接口与权限。

## 六、Netlify Function：`resolve-music`

- 路径：`netlify/functions/resolve-music.mjs`；`netlify.toml` 增加 `/api/resolve-music` 重定向；
- `POST {VITE_FUNC_BASE}/api/resolve-music`，body `{ platform, urlOrEmbed }`；
- 处理：① 按第三节规则复核、提取 media_type/platform_id（短链跟随 3xx）；② 转发官方端点取元数据：
  YouTube / SoundCloud → 官方 oEmbed；网易云 → Meting 接口取曲名/歌手/封面/曲目列表；
  歌单等拒绝形态直接报错；
- 返回统一 `{ code, data }`：

```json
{
  "code": 0,
  "data": {
    "platform": "youtube", "media_type": "song",
    "platform_id": "dQw4w9WgXcQ",
    "source_url": "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "title": "歌名", "artist": "歌手",
    "cover_url": "https://...",
    "need_manual": false
  }
}
```

- 安全：输入长度上限（链接 2048）；按所选平台限定 host；外呼超时；不带凭据；
- 后台「手动添加」复用同一函数，两条入口同一校验。

## 七、前端设计

### 7.1 投稿页 `/music-share/submit`

1. **选择平台**（3 家下拉）；
2. **粘贴链接**：按平台实时正则校验，错误即时红字提示；
3. 点「识别」→ 调 resolve-music → 显示平台徽标 + 单曲/专辑类型；
4. **当场试播（可用性自证）**：识别成功内嵌真实播放组件（默认不自动播放），网易云无版权、地区限制在此阶段即可发现；
5. **曲名**（必填）/**歌手**（选填）：自动带入且**允许修正**；
6. **推荐理由**（必填，1~200 字，字数计数）；
7. **「这是我本人的原创作品」勾选框**：勾选后该条以创作者自荐样式展示；
8. **个人信息**：昵称（必填，缺省「匿名」；走全量贡献者联想，命中可声明「我是该账号」并记录 contributor_id）、邮箱（选填）、联系方式动态行；
9. 提交前双层去重检查，命中即阻止并友好提示；
10. 提交成功提示进审核；复用现有 `/api/mailer` 通知站长。

### 7.2 浮动推荐卡（右下角）

- 挂 DefaultLayout；无 approved 数据不出现；
- **进站自动播放哪一首，浮卡首条就展示哪一首**；可上一条/下一条轮换；
- 内容：媒体区 + 「{昵称} 推荐」+ 曲名/歌手 + 理由 + 播放/暂停（与 dock 联动）+ 关闭；
- **两种样式**：普通推荐卡（默认）；`is_own_work=true` 显示「创作者」徽标与金边强调；
- 「查看全部」→ `/music-shares`；关闭按 sessionStorage 本次会话不再出现。

### 7.3 全局浮动播放器 + Pinia store

- store：队列、当前索引、dock 开合、**进站自动播放开关（localStorage，默认开）**；
- **进站自动播放**：DefaultLayout 客户端挂载后，拉取最新一批 approved 条目，**随机抽 1 条单曲**（无单曲时回退专辑），升起 dock 并加载；
- 被浏览器拦截时保持播放键可见，不做静音绕过；
- 每次「打开网站」（布局挂载）触发一次，站内路由跳转不重复触发；
- dock 固定底部、布局层挂载，跨页播放不中断；
- **三家全部支持自动联播**：网易云 `<audio>` ended、YouTube IFrame API ENDED、SoundCloud Widget API FINISH；
- 切歌：统一以曲目 id 为 key 重建舞台。

### 7.4 歌曲分享页 `/music-shares`

- **卡片墙**：封面方形大图 + hover 播放遮罩，移动端单列；
- **两种卡片**：普通推荐卡 / **创作者自荐卡**（`is_own_work`，金色描边 + 「✦ 创作者自荐」角标）；
- 排序：sort>0 置顶位（数字小在前），其余按通过时间倒序；
- 平台筛选（3 家+全部 chips）+「✦ 只看创作者自荐」开关；点播把**当前筛选集**作为队列并激活 dock。

### 7.5 后台

- 路由 `/admin/music-shares`，菜单「🎶 歌曲分享」；
- 审核动作：通过 / 拒绝（必填原因）；通过时选择关联已有贡献者或新建账号（新建账号默认 `tags=['歌曲分享']`）；
- 行内可改：曲名/歌手/理由/封面、`is_own_work` 核实勾选、sort 置顶数字；
- 删除 / 手动添加；
- 拒绝且有邮箱时复用 mailer reject 通知。

### 7.6 其他改动点

- 类型 `types.ts`：`MusicShare` / `MusicShareInsert` / `MusicPlatform`（3 家联合类型）/ `MusicMediaType`；
- **`src/lib/musicPlatforms.ts`（平台注册表，单一真相源）**：每家一条配置
  （key、中文名、下拉顺序、链接正则、占位符、嵌入 URL 构造器、自动播放参数、元数据档位、播完事件能力、徽标）；
  投稿页/函数/卡片/dock/后台共用，新增平台只改注册表；
- `api.ts`：`getMusicShares()`、`getMusicShareDupHints()`、`submitMusicShare()`；
- 共享小工具 `isMusicOnlyContributor(c)`。

## 八、最终实现要点

- 网易云播放采用 Netlify 函数实时换 mp3 直链 + 原生 `<audio>` + 自研控制条，而非内嵌官方 86px 小组件；
- 三家平台全部支持播完自动联播；
- 数据库 `platform` CHECK 收窄为三家（见 13 号迁移）；
- `reason` 推荐理由改为必填（见 14 号迁移）；
- 新增 `pinned_until` 首页推荐位置顶字段（见 15 号迁移）；
- 新增投稿人联系方式公开意愿字段（见 16 号迁移）；
- 新增投稿人更新/清空资料动作字段（见 17 号迁移）。

## 九、验收

1. RLS：anon 只读 approved、无法插审核列/生成列、无法改删；
2. 去重：同平台 ID、跨平台同名同歌手双层拦截生效；
3. 函数：3 家单曲+专辑真实链接各测；歌单全部被拒；平台与链接不符被拒；
4. 投稿页：误填即时报错；试播组件可真实交互；
5. 名单隐藏：单标签「歌曲分享」账号不出现在首页优秀贡献者与 /contributors；多标签账号照常出现；下拉框能搜到全部账号；
6. 创作者样式：仅 is_own_work=true 的条目走创作者卡片；
7. 排序：sort>0 按数字升序置顶，sort=0 按通过时间倒序；
8. 进站播放：每次挂载随机一首；浏览器放行时自动出声，拦截时显示播放键；跨页播放不中断；
9. 联播：三家播完自动续；
10. SSG：`vite-ssg build` 通过且 `/music-shares` 首屏直出。
