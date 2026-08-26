import { defineConfig } from 'vitepress'

export default defineConfig({
  lang: 'zh-CN',
  // 部署在 https://api.lrcshare.com/docs/（Worker 剥前缀反代 Pages 源站）
  base: '/docs/',
  title: 'LrcShare API',
  description: 'LrcShare 开放 API 文档 — 歌词、专辑、艺术家元数据',
  head: [
    ['link', { rel: 'icon', href: 'https://i0.hdslb.com/bfs/article/a2323ad6e33924c39061b35ae29f9fd937977624.png' }],
    // B站图床防盗链：不发送 Referer 才放行外链图片
    ['meta', { name: 'referrer', content: 'no-referrer' }],
  ],
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
        text: '客户端集成',
        items: [
          { text: '在 Lyrico 中使用', link: '/guide/lyrico' },
        ],
      },
      {
        text: 'API 端点',
        items: [
          { text: '搜索', link: '/api/search' },
          { text: '目录快照', link: '/api/catalog' },
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
