import { defineStore } from 'pinia'

/**
 * 全局 UI 状态：搜索弹窗 + 图片预览
 * 取代 v2 的 window.openSearchOverlay / window.openImgPreview 全局函数
 */
export const useUiStore = defineStore('ui', {
  state: () => ({
    /** 搜索弹窗 */
    searchOpen: false,
    /** 打开弹窗时预填的关键词（页面搜索框跳转用） */
    searchKeyword: '',

    /** 图片预览（相册/封面大图查看） */
    previewOpen: false,
    previewImages: [] as string[],
    previewIndex: 0,
  }),

  actions: {
    openSearch(keyword = '') {
      this.searchKeyword = keyword
      this.searchOpen = true
    },
    closeSearch() {
      this.searchOpen = false
    },

    openPreview(images: string[], index = 0) {
      if (!images || images.length === 0) return
      this.previewImages = images
      this.previewIndex = index
      this.previewOpen = true
    },
    closePreview() {
      this.previewOpen = false
    },
    prevImage() {
      if (this.previewIndex > 0) this.previewIndex--
    },
    nextImage() {
      if (this.previewIndex < this.previewImages.length - 1) this.previewIndex++
    },
  },
})
