# 13 · 歌曲分享平台收窄为三家 + 专辑曲目快照

> 状态：**已上线**

## 一句话现状

音乐分享平台从最初设计的 9 家收窄为最终 3 家：**网易云 / YouTube / SoundCloud**。QQ 音乐、酷狗、酷我因免登录取链接口失效不引入；B站、Spotify、Apple Music、Deezer、Tidal、Bandcamp 六家下架。同时新增 `tracks` jsonb 列存储专辑曲目快照，播放时展开为队列。

## 一、最终保留三家

| 平台 | 播放方式 | 专辑处理 |
|------|---------|---------|
| 网易云 | Netlify 函数实时换 mp3 直链 + 原生 `<audio>` | Meting 接口取曲目列表 |
| YouTube | 官方 IFrame Player API | 播放列表 ID，声明制 + 人工审核 |
| SoundCloud | 官方 Widget API | sets 永久链接，声明制 + 人工审核 |

三家全部支持播放结束自动联播（网易云通过 `<audio>` 的 `ended` 事件）。

## 二、变更内容

1. **清理已下架平台残留行**：删除 `platform NOT IN ('netease','youtube','soundcloud')` 的全部行（功能未上线无生产数据）。
2. **新增 `tracks` jsonb 列**：专辑曲目快照，结构 `[{id,title,artist,duration,cover_url}]`，单曲为 NULL。播放时展开为队列。
3. **platform CHECK 收窄**：`CHECK (platform IN ('netease','youtube','soundcloud'))`。
4. **anon INSERT 白名单加入 tracks**：投稿人可填写曲目快照。
5. **查重 RPC 白名单同步收窄**：`check_music_share_dup` 的平台枚举收窄为三家。

## 三、相关文件

- 迁移脚本：[`sql/13-music-shares-platform-v2.sql`](./13-music-shares-platform-v2.sql)
- 上游：[`sql/12-music-shares-evolution.md`](./12-music-shares-evolution.md)
