import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  title: 'LrcShare API',
  description: 'LrcShare 开放 API 文档 — 歌词、专辑、艺术家元数据',
  head: [['link', { rel: 'icon', href: 'https://i0.hdslb.com/bfs/article/c07c33a93366f960bdef02ff5411c99837977624.png' }]],
  themeConfig: {
    nav: [
      { text: '指南', link: '/guide/quickstart' },
      { text: 'API', link: '/api/search' },
      { text: '主站', link: 'https://lrcshare.com' },
    ],
    sidebar: [
      {
        text: '开始',
        items: [
          { text: '快速开始', link: '/guide/quickstart' },
        ],
      },
      {
        text: 'API 端点',
        items: [
          { text: '搜索', link: '/api/search' },
          { text: '歌曲与歌词', link: '/api/songs' },
          { text: '专辑', link: '/api/albums' },
          { text: '艺术家', link: '/api/artists' },
        ],
      },
      {
        text: '参考',
        items: [
          { text: '数据对象', link: '/api/objects' },
          { text: 'FAQ', link: '/faq' },
          { text: '更新日志', link: '/changelog' },
        ],
      },
    ],
    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一页', next: '下一页' },
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '菜单',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',
    externalLinkIcon: true,
    socialLinks: [{ icon: 'github', link: 'https://github.com/x2ispanda' }],
  },
})
