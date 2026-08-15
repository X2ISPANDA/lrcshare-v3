import { inject, onMounted, onServerPrefetch, ref, shallowRef } from 'vue'
import type { Ref } from 'vue'

/**
 * SSG 数据预取：服务端（构建预渲染）时执行 fetcher 并写入 initialState
 * （vite-ssg 会序列化进 HTML），客户端水合时直接复用、零二次请求；
 * SPA 客户端导航（无预取状态）时在 onMounted 拉取。
 * shallowRef：数据为一次性整体替换，无需深层响应。
 */
export function useSSGData<T>(key: string, fetcher: () => Promise<T>): { data: Ref<T | null>; loading: Ref<boolean> } {
  const state = inject<Record<string, unknown>>('initialState', {})
  const data = shallowRef<T | null>((state[key] as T) ?? null) as Ref<T | null>
  const loading = ref(data.value === null)

  async function load() {
    try {
      data.value = await fetcher()
      state[key] = data.value
    } catch (e) {
      console.error(`[useSSGData:${key}]`, e)
    } finally {
      loading.value = false
    }
  }

  if (import.meta.env.SSR) {
    onServerPrefetch(load)
  } else if (data.value === null) {
    onMounted(load)
  } else {
    loading.value = false
  }

  return { data, loading }
}
