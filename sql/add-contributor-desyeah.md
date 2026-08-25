# 新增贡献者 DesYeah

在 Supabase SQL Editor 执行以下 SQL，一次性插入完整记录：

```sql
insert into public.contributors
  (id, name, avatar, bio, public_bio, contact_types, contact_value, public_contact, tags, is_owner, sort)
values
  (
    'ct_desyeah',                          -- id：沿用 ct_ 前缀 + 名字小写惯例
    'DesYeah',                             -- 名字
    null,                                  -- 头像：暂无（需站长上传时再补）
    null,                                  -- 简介：暂无
    false,                                 -- 公开简介：无 bio，保持 false
    '{qq}',                                -- 联系方式类型（PG 数组语法：花括号）
    '{"qq": "2631498442"}'::jsonb,         -- 联系方式（jsonb）：QQ 2631498442
    true,                                  -- 公开联系方式：前台展示 QQ 图标
    '{歌词提交}',                            -- 身份标签（PG 数组语法）：歌词提交，紫色系
    false,                                 -- 非站长
    (select coalesce(max(sort), 0) + 1 from public.contributors)  -- 排序：排到最后
  );
```

## 字段说明

| 字段 | 值 | 依据 |
| --- | --- | --- |
| id | `ct_desyeah` | 现有贡献者 id 模式（ct_zmoken、ct_yyy 等） |
| name | `DesYeah` | 你指定的名字，保留大小写 |
| contact_types / contact_value | `["qq"]` / `{"qq": "2631498442"}` | 你指定的联系方式（QQ），前台显示 QQ 单图标 |
| public_contact | `true` | 联系方式公开展示 |
| tags | `["歌词提交"]` | 你指定的 tag，与管理后台预设标签一致，前台显示紫色标签 |
| sort | 动态取 max+1 | 排在现有贡献者之后 |

## 验证

执行后到贡献者名单页（`/contributors`）确认卡片出现：名字 DesYeah、紫色「歌词提交」标签、QQ 联系图标。头像为空显示占位图属正常。

确认无误后无需其他操作，前台页面下次自动构建（最迟 6 小时）即收录。
