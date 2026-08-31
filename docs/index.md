---
layout: home

hero:
  name: LrcShare API
  text: 开放音乐元数据接口
  tagline: 歌词 / 专辑封面 / 流派 / 词曲编署名 / 艺术家信息 — 免费、无需注册、无需 API Key
  actions:
    - theme: brand
      text: 快速开始
      link: /guide/quickstart
    - theme: alt
      text: API 端点
      link: /api/search
    - theme: alt
      text: 使用要求
      link: /guide/requirements

features:
  - icon: 🎵
    title: 多格式完整歌词
    details: 原文 / 译文 / 罗马音多语言，LRC / 增强逐字 / TTML 多格式，结构化行直接可用，末尾自带来源署名。
  - icon: 🏷️
    title: 全量音乐标签
    details: 歌名、别名、歌手、专辑、曲目号、碟号、流派、作词、作曲、编曲、封面一站获取。
  - icon: 🔓
    title: 免费开放
    details: 无需 API Key、无需注册，支持跨域，任意客户端可直接调用。请遵守[使用要求](/guide/requirements)（User-Agent、限流、目录预过滤）。
  - icon: ⚡
    title: 边缘缓存
    details: Cloudflare 边缘节点缓存热门内容，详情 1 小时 / 列表 10 分钟，重复查询秒回。
---

## 开源致谢

TTML 歌词的解析与生成采用 [AMLL（Apple Music-like Lyrics）](https://github.com/amll-dev/applemusic-like-lyrics) 官方库 `@applemusic-like-lyrics/ttml`（AGPL-3.0），本 API 遵循其开源协议，特此致谢。
