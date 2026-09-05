# 08 · 联系方式与外链键名治理（中文键 → 英文键 → 单字段）

> 合并自：migrate-contact-keys-to-english.md（键名英文迁移）、add-contributor-desyeah.md
> （新增贡献者数据）、drop-contact-types.md（删冗余列）、phase6-friends-extra-links.md
> （友链附加链接）（全部已执行，2026-08-25 ~ 08-31；完整执行版 SQL 见 git 历史原文件）
> 另：verify-dual-source.sql 为空文件，无内容可合并。

## 一句话现状

联系方式/外链的键名全库统一**英文键**（qq/wechat/bilibili…），由 `contact_value`
（jsonb，键=类型、值=账号）单字段管理（`contact_types` 冗余列已删除）；友链支持
`extra_links`（`[{label, url}]` 数组）挂多个链接，label 同一套英文图标键。

## 出发点：图标键名中英混杂

建库时联系方式/平台的图标键名体系是中英混杂的——`'微信'`、`'邮箱'`、`'官网'`、
`'网易音乐人'`…代码与数据库两边对不齐，映射维护成本高（用户偏好：键名体系统一英文，
显示层用中文标签）。2026-08-25 起统一英文键。

## 演进：三步走

### 第一步：存量数据键名英文迁移（migrate-contact-keys-to-english）

16 组中文→英文映射（临时表驱动，幂等可重跑）：

| 中文键（旧） | 英文键（新） | | 中文键（旧） | 英文键（新） |
| --- | --- | --- | --- | --- |
| QQ | qq | | Twitter | twitter |
| 微信 | wechat | | X | x |
| 邮箱 | email | | 小红书 | xiaohongshu |
| B站 / 哔哩哔哩 | bilibili | | 网易音乐人 | netease |
| GitHub | github（不变） | | QQ音乐 | qqmusic |
| 博客 | blog | | 个人主页 | homepage |
| 抖音 | douyin | | 官网 | official |
| 微博 | weibo | | 电话 / 手机 | phone / mobile |

涉及三表五列：`contributors` / `submissions` 的 `contact_value`（jsonb 键替换）
与 `contact_types`（数组元素替换）、`artists.urls`（jsonb 键替换）。

迁移技巧（保数据不丢）：

- `jsonb_object_agg` + **左连映射表**：未命中映射的键（已是英文的 `github`、
  `instagram` 或自定义键）原样保留
- `where exists` 只更新有中文键的行，避免全表覆盖
- 验证正则 `[\u4e00-\u9fa5]` 列残留中文键——顺带能发现映射表漏掉的键，
  补一行重跑即可
- **执行顺序**：先 SQL（数据先行）再部署前端；中间窗口旧前端图标暂时回退
  默认链接图标，不影响功能，部署后恢复

### 第二步：新增贡献者 DesYeah（add-contributor-desyeah）

一次性插入完整贡献者记录（id `ct_desyeah`，QQ 2631498442，「歌词提交」标签，
sort 动态取 max+1 排最后）。此时表上还有 `contact_types` 列（`{qq}`）——
第三步删列后此字段自然消失，历史文档不改写。

### 第三步：删冗余列 contact_types（drop-contact-types）

**问题**：`contact_types`（text[]）与 `contact_value`（jsonb）双字段存同一信息，
双写不同步有隐患——实际踩过：contact_value 有 5 个键但 contact_types 为空，
后台编辑弹窗不显示联系方式。`contact_value` 的**键**即联系方式类型，
`contact_types` 完全冗余。

前端先全链路改造为仅读写 `contact_value`（ContributorsView 编辑弹窗改动态行
「类型下拉 + 值输入」直接编辑键值；SubmitView / api.ts 不再提交 contact_types；
types.ts 删字段），然后两表删列彻底消除双字段不一致：

```sql
alter table public.contributors drop column if exists contact_types;
alter table public.submissions drop column if exists contact_types;
```

### 第四步：友链附加链接 extra_links（phase6-friends-extra-links）

**出发点**：`friends` 表只有 `url` 一个链接字段，AMLL-TTML-TOOL 等工具站需要
同时展示「工具主页 + GitHub 源码页」，单链接不够。

```sql
alter table friends add column if not exists extra_links jsonb;
-- [{label, url}]：label 为平台英文键（与 AppIcon ICON_MAP 对齐）
-- 仅校验顶层结构（null 或 array）；元素级校验由应用层保证（FriendsView 保存时滤空）
```

前端：后台弹窗「附加链接」动态行（label 下拉预设 github/bilibili/blog/twitter/
weibo/homepage，url 输入，可增删行）；前台卡片底部小图标行（仅 extra_links
非空时显示，`@click.stop` 阻止冒泡触发外层卡片跳转）。匹配不到的 label 走
AppIcon 兜底（iconLink 通用链接图标），不报错。

## 踩过的坑

| 坑 | 教训 |
|---|---|
| 双字段（contact_types + contact_value）双写不同步，后台弹窗显示不出联系方式 | 冗余字段必须有维护点，否则迟早漂移——最终删除，键即类型 |
| 键名中英混杂，代码/数据库两边映射对不齐 | 全库统一英文键 + 正则验证残留；显示中文交给展示层 |
| jsonb 键替换担心丢自定义键 | 左连映射表聚合，未命中原样保留 |

## 执行记录

| 步 | 结果 | 备注 |
|---|---|---|
| 键名英文迁移（三表五列） | ✅ | 残留中文键验证 0 行 |
| 新增贡献者 DesYeah | ✅ | /contributors 页卡片正常 |
| 删 contact_types 两表列 | ✅ | 先部署前端再执行 SQL，前后端均不依赖该列 |
| 友链 extra_links | ✅ | 老数据无 extra_links 不显示图标行，向后兼容 |
