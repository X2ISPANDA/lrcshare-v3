# MusicTag 配置指南

[MusicTag](https://www.coolapk.com/apk/kj415j45qx8.music_tag) 是安卓平台流行的音乐标签编辑器，支持自定义音源。本指南将 LrcShare API 配置为 MusicTag 的歌词/元数据源，实现搜索打标一步到位。

## 用到的接口

| 用途 | 接口 |
| --- | --- |
| 搜索歌曲 | `GET /v1/search?keyword={关键词}&type=song` |
| 获取歌词 | `GET /v1/song/{id}/lyric` |
| 获取元数据（封面/流派/词曲编） | `GET /v1/song/{id}` |

## 配置要点

1. **搜索**：地址填 `https://api.lrcshare.com/v1/search?keyword={keyword}&type=song`，响应在 `data.items[]`，每项含 `id`、`title`、`artists`、`album` 等字段
2. **歌词**：地址填 `https://api.lrcshare.com/v1/song/{id}/lyric`，取 `data.lrc`（带时间轴 LRC，末尾自带来源署名行）
3. **封面**：song 对象的 `cover` 字段（单曲封面，缺省时回退专辑封面，直接下载即可）
4. **comment 标签**：song 对象的 `comment` 字段值形如 `本歌词来自于:贡献者名@lrcshare.com`，直接整串写入 comment 标签即为署名

具体配置界面与自定义音源的模板格式以 MusicTag 应用内说明为准（不同版本界面略有差异），以上接口地址与字段路径是稳定的。

## 推荐写入的标签对照

| 音乐文件标签 | API 字段 |
| --- | --- |
| TITLE | `title` |
| ARTIST | `artists` 各项 `name`，分隔符自定 |
| ALBUM | `album.name` |
| ALBUMARTIST | `album` 对应专辑的 `artists`（可经 `/v1/album/{album.id}` 获取） |
| GENRE | `genres` 各项，分隔符自定 |
| LYRICS | `lyric` 接口的 `lrc`（自带来源署名行） |
| COMMENT | `comment` |
| TRACK / DISC | `track` / `disc` |
| 作词 / 作曲 / 编曲 | `lyricist` / `composer` / `arranger` |

> 词曲编署名建议写入 ID3 的自定义帧（如 `LYRICIST`、`COMPOSER`、`ARRANGER`）或合成进 COMMENT，以播放器支持为准。

## 示例：命令行批量打标思路

```bash
# 1. 搜索
curl "https://api.lrcshare.com/v1/search?keyword=歌名&type=song"
# 2. 拿到 id 后取歌词与元数据
curl "https://api.lrcshare.com/v1/song/s_xxx/lyric"
curl "https://api.lrcshare.com/v1/song/s_xxx"
```

返回的 `comment` 与 `lrc` 末尾都自带署名，写入文件后来源可溯。
