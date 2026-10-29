# 14 · 贡献者合并/删除纳入歌曲分享 + 推荐理由强制非空

> 状态：**已上线**

## 一句话现状

12 号脚本新建 `music_shares` 表后，11 号「贡献者合并」RPC 只处理了 `songs` / `lyric_versions` / `submissions` 三表，遗漏了 `music_shares`。本迁移补全：合并 RPC 纳入 `music_shares` 引用置换，新增删除贡献者时级联删除其歌曲分享的触发器；同时把推荐理由 `reason` 收紧为必填（1~200 字）。

## 一、合并 RPC 纳入 music_shares

`admin_merge_contributors` 全量重定义：

- 引用置换从 3 张表扩展到 4 张，新增 `music_shares`（全部状态 pending/approved/rejected 整单转给保留账号）。
- 守卫 4 的已知表白名单加入 `music_shares`。
- 返回值新增 `music_shares_moved` 字段。

## 二、删除贡献者 → 级联删歌曲分享

新增 `contributors_delete_music_shares` BEFORE DELETE 触发器：删除贡献者时，物理删除其名下全部 `music_shares` 行（含 pending/approved/rejected）。

**设计理由**：歌曲分享是用户投稿内容而非本站既有财产，删账号即删干净。对照 `songs` / `lyric_versions` / `submissions` 仍维持 `ON DELETE SET NULL`（歌词等既有内容删账号后保留、仅解除署名）。

合并 RPC 在 DELETE 源账号前已转走分享，触发器实际删 0 行，互不影响。

## 三、推荐理由必填

`reason` 列从可空改为 NOT NULL，长度 1~200 字（纯空白也拒绝）。功能未上线无生产数据，历史空行统一补录为「（历史投稿，理由补录中）」。

## 四、相关文件

- 迁移脚本：[`sql/14-contributor-merge-music-shares.sql`](./14-contributor-merge-music-shares.sql)
- 上游：[`sql/11-contributor-merge.md`](./11-contributor-merge.md)、[`sql/12-music-shares-evolution.md`](./12-music-shares-evolution.md)
