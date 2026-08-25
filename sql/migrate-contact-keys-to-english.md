# 联系方式/平台键名统一英文迁移

## 背景

图标键名体系原为中英混杂（`'微信'`、`'邮箱'`、`'官网'`、`'网易音乐人'`…），2026-08-25 起代码与数据库统一英文键：

| 中文键（旧） | 英文键（新） |
| --- | --- |
| QQ | qq |
| 微信 | wechat |
| 邮箱 | email |
| B站 | bilibili |
| GitHub | github（不变） |
| 博客 | blog |
| 抖音 | douyin |
| 微博 | weibo |
| Twitter | twitter |
| X | x |
| 小红书 | xiaohongshu |
| 网易音乐人 | netease |
| QQ音乐 | qqmusic |
| 个人主页 | homepage |
| 官网 | official |
| 电话 | phone |
| 手机 | mobile |

## 涉及数据

| 表 | 列 | 说明 |
| --- | --- | --- |
| `contributors` | `contact_types`（text[]）、`contact_value`（jsonb） | 贡献者联系方式 |
| `artists` | `urls`（jsonb） | 艺术家社交链接 |
| `submissions` | `contact_types`（text[]）、`contact_value`（jsonb） | 历史投稿（含待审核） |

## SQL（Supabase SQL Editor 执行）

```sql
-- ============ 1. 建通用映射临时表 ============
create temp table if not exists tmp_key_map(k_old text primary key, k_new text not null);
truncate tmp_key_map;
insert into tmp_key_map values
  ('QQ', 'qq'), ('微信', 'wechat'), ('邮箱', 'email'), ('B站', 'bilibili'),
  ('哔哩哔哩', 'bilibili'), ('博客', 'blog'), ('抖音', 'douyin'), ('微博', 'weibo'),
  ('Twitter', 'twitter'), ('X', 'x'), ('小红书', 'xiaohongshu'),
  ('网易音乐人', 'netease'), ('QQ音乐', 'qqmusic'), ('个人主页', 'homepage'),
  ('官网', 'official'), ('电话', 'phone'), ('手机', 'mobile');

-- ============ 2. contributors：contact_value（jsonb 键替换） ============
update contributors c
set contact_value = (
  select coalesce(jsonb_object_agg(
    coalesce(m.k_new, t.key),
    t.value
  ), '{}'::jsonb)
  from jsonb_each(c.contact_value) t(key, value)
  left join tmp_key_map m on m.k_old = t.key
)
where exists (
  select 1 from jsonb_object_keys(c.contact_value) k
  join tmp_key_map m on m.k_old = k
);

-- ============ 3. contributors / submissions：contact_types（数组元素替换） ============
update contributors c
set contact_types = (
  select coalesce(array_agg(coalesce(m.k_new, t)), '{}')
  from unnest(c.contact_types) t
  left join tmp_key_map m on m.k_old = t
)
where exists (
  select 1 from unnest(c.contact_types) t join tmp_key_map m on m.k_old = t
);

update submissions s
set contact_value = (
  select coalesce(jsonb_object_agg(
    coalesce(m.k_new, t.key),
    t.value
  ), '{}'::jsonb)
  from jsonb_each(s.contact_value) t(key, value)
  left join tmp_key_map m on m.k_old = t.key
)
where exists (
  select 1 from jsonb_object_keys(s.contact_value) k
  join tmp_key_map m on m.k_old = k
);

update submissions s
set contact_types = (
  select coalesce(array_agg(coalesce(m.k_new, t)), '{}')
  from unnest(s.contact_types) t
  left join tmp_key_map m on m.k_old = t
)
where exists (
  select 1 from unnest(s.contact_types) t join tmp_key_map m on m.k_old = t
);

-- ============ 4. artists：urls（jsonb 键替换） ============
update artists a
set urls = (
  select coalesce(jsonb_object_agg(
    coalesce(m.k_new, t.key),
    t.value
  ), '{}'::jsonb)
  from jsonb_each(a.urls) t(key, value)
  left join tmp_key_map m on m.k_old = t.key
)
where exists (
  select 1 from jsonb_object_keys(a.urls) k
  join tmp_key_map m on m.k_old = k
);

-- ============ 5. 验证 ============
-- 应返回 0 行（无残留中文键）
select 'contributors.contact_value' src, c.id, k
from contributors c, jsonb_object_keys(c.contact_value) k
where k ~ '[\u4e00-\u9fa5]'
union all
select 'artists.urls', a.id, k
from artists a, jsonb_object_keys(a.urls) k
where k ~ '[\u4e00-\u9fa5]';
```

## 说明

- `jsonb_object_agg` + 左连映射表：未命中映射的键（如已是英文的 `github`、`instagram` 或自定义键）原样保留，不丢数据
- `where exists` 只更新有中文键的行，避免全表覆盖
- 正则 `[\u4e00-\u9fa5]` 用于验证：任何残留中文键都会被列出（顺带能发现映射表漏掉的键，发现后往 `tmp_key_map` 补一行重跑即可）
- 幂等：重复执行无副作用（第二次 `where exists` 均不命中）

## 执行顺序

1. **先执行本 SQL**（数据先行）
2. **再部署前端**（键名英文化的代码已就绪）

中间短暂窗口内（SQL 已跑、前端未部署）：旧前端的中文图标映射查不到英文键，部分图标暂时回退为默认链接图标——不影响功能，部署后恢复。
