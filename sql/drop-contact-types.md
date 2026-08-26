# 删除 contact_types 字段（联系方式统一由 contact_value 管理）

## 背景

`contact_types`（text[]）与 `contact_value`（jsonb）双字段存储同一信息，存在双写不同步隐患（如 contact_value 有 5 个键但 contact_types 为空，导致后台编辑弹窗不显示联系方式）。`contact_value` 的键即联系方式类型，`contact_types` 完全冗余。

前端已全链路改造为仅读写 `contact_value`：

| 文件 | 改动 |
| --- | --- |
| `src/views/admin/ContributorsView.vue` | 编辑弹窗改为动态行（类型下拉 + 值输入），直接编辑 contact_value 的键值 |
| `src/views/SubmitView.vue` | 投稿/资料更新不再提交 contact_types |
| `src/lib/api.ts` | submitSubmissionV2 不再写 contact_types |
| `src/lib/types.ts` | Contributor / Submission 接口删除 contact_types 字段 |

本脚本删除两张表中的 `contact_types` 列，彻底消除双字段不一致问题。

## 执行 SQL

在 Supabase SQL Editor 执行：

```sql
alter table public.contributors drop column if exists contact_types;
alter table public.submissions drop column if exists contact_types;
```

## 验证

1. SQL Editor 执行以下查询，应返回 0 行：

```sql
select table_name, column_name
from information_schema.columns
where table_schema = 'public'
  and table_name in ('contributors', 'submissions')
  and column_name = 'contact_types';
```

2. 后台「贡献者管理」编辑弹窗：contact_value 中已有的联系方式（如 qq/wechat/bilibili 等）逐行显示且值可编辑，保存成功
3. 贡献者主页（`/contributors`、贡献者详情页）联系方式图标正常展示
4. 前台投稿流程正常提交（submissions 不再写 contact_types）

## 说明

- `drop column if exists` 幂等，重复执行无副作用
- contributors / submissions 中 `contact_value` 保留完整信息（键=类型、值=账号），无数据丢失
- 历史文档 `migrate-contact-keys-to-english.md`、`add-contributor-desyeah.md` 为已执行迁移记录，不做回改
- 执行顺序：先部署本次前端代码，再执行本 SQL（代码已不依赖 contact_types，先后顺序均不影响功能）
