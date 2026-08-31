# 友链附加链接（extra_links）

> 状态：待确认
> 日期：2026-08-31
> 目的：支持单条友链挂多个链接（工具主页 + GitHub 源码 + 文档站等），卡片底部用小图标行展示

## 背景

现有 `friends` 表只有 `url` 一个链接字段。AMLL-TTML-TOOL 等工具站需要同时展示「工具主页」与「GitHub 源码页」，单链接无法满足。

## 数据库变更

### 1. 新增列

```sql
alter table friends add column if not exists extra_links jsonb;
comment on column friends.extra_links is '附加链接数组：[{label, url}]，label 为平台英文键（与 AppIcon ICON_MAP 对齐）';
```

### 2. 数据结构

```jsonc
[
  { "label": "github",  "url": "https://github.com/.../AMLL-TTML-TOOL" },
  { "label": "bilibili", "url": "https://space.bilibili.com/..." }
]
```

`label` 取值范围（与 [AppIcon.vue ICON_MAP](../src/components/common/AppIcon.vue) 键名一致）：

| label | 图标 | 说明 |
| ----- | ---- | ---- |
| github | GitHub logo | 源码页 |
| bilibili | 哔哩哔哩 | 视频主页 |
| blog | 博客 | 博客站 |
| twitter / x | X logo | 社交 |
| homepage | 通用链接 | 官网 / 其他 |
| ... | 见 ICON_MAP 其余键 | 全部支持 |

匹配不到的 label 走 AppIcon 兜底（`iconLink` 通用链接图标），不报错。

### 3. 约束（顶层结构校验）

> 注：PostgreSQL CHECK 约束不允许子查询，无法在校验内遍历 JSONB 数组元素。
> 元素级校验（label / url 非空）由应用层保证（FriendsView save 时 filter 空 url 行）。

```sql
-- 仅校验顶层结构：null 或合法 jsonb array
alter table friends add constraint friends_extra_links_chk
check (
  extra_links is null
  or jsonb_typeof(extra_links) = 'array'
);
```

## 前端变更（数据库确认后执行）

### 类型 `src/lib/types.ts`

`Friend` 接口新增：

```ts
extra_links: { label: string; url: string }[] | null
```

### API `src/lib/api.ts`

无需改动。`getFriends()` 用 `select('*')`（L535），新列自动返回。

### 管理后台 `src/views/admin/FriendsView.vue`

弹窗（L114-L138）在「描述」下方加「附加链接」动态行：

- label 用 `el-select` 下拉选预设（github / bilibili / blog / twitter / homepage 等常用，与 AppIcon 键名一致）
- url 用 `el-input`
- 支持增删行
- 保存时写 `extra_links`（空数组 → null），编辑时回填

预设选项（与 [ContributorsView CONTACT_TYPES](../src/views/admin/ContributorsView.vue#L162) 对齐，取交集里适合做「站点链接」的）：

```
github / bilibili / blog / twitter / weibo / homepage
```

### 前台 `src/views/LinksView.vue`

卡片（L21-L34）改动：

1. **整卡包 `el-tooltip`**：content = `item.name + '\n' + (item.descr || '')`，解决截断不可见
2. **卡片内底部加小图标行**（仅 `item.extra_links?.length` 时显示）：
   - 遍历 `extra_links`，每个 `<a target="_blank" @click.stop>` 内放 `<AppIcon :name="link.label" />`
   - `@click.stop` 阻止冒泡触发外层卡片跳转
   - 外层 `<a>` 仍指 `item.url`（工具主页）
   - 主 url 不在图标行重复显示

## 回滚

```sql
alter table friends drop constraint if exists friends_extra_links_chk;
alter table friends drop column if exists extra_links;
```

## 影响面

- 前台友链页（LinksView）：展示增强，向后兼容（无 extra_links 的老数据不显示图标行）
- 后台友链管理（FriendsView）：弹窗加动态行，向后兼容
- API：无改动
- 类型：加可选字段，向后兼容
