/** 拼音首字母分组工具（艺术家库 / 专辑库通用） */
import { pinyin } from 'pinyin-pro'

export interface AlphaGroup<T> {
  /** 分组字母（A-Z，无法识别的归 #） */
  letter: string
  items: T[]
}

/** 取名字首字母：英文直接取，中文转拼音首字母，其余（数字/假名/符号）归 # */
export function getInitialLetter(name: string): string {
  const n = (name || '').trim()
  if (!n) return '#'
  const first = n[0]
  if (/[a-zA-Z]/.test(first)) return first.toUpperCase()
  if (/[0-9]/.test(first)) return '#'
  const py = pinyin(first, { toneType: 'none', type: 'array' })
  const head = Array.isArray(py) ? py[0] : String(py)
  return head && /[a-zA-Z]/.test(head[0]) ? head[0].toUpperCase() : '#'
}

/**
 * 按拼音首字母分组，组内按中文拼音顺序排序，# 组排在最后
 * getInitial 可返回人工覆盖的首字母（多音字兜底，如「盛宇」→ C），空/未提供时自动计算
 */
export function groupByInitial<T>(
  items: T[],
  getName: (item: T) => string,
  getInitial?: (item: T) => string | null | undefined
): AlphaGroup<T>[] {
  const map = new Map<string, T[]>()
  for (const item of items) {
    const override = (getInitial?.(item) || '').trim().toUpperCase()
    const letter = override ? override[0] : getInitialLetter(getName(item))
    if (!map.has(letter)) map.set(letter, [])
    map.get(letter)!.push(item)
  }
  return [...map.entries()]
    .sort(([a], [b]) => {
      if (a === '#') return 1
      if (b === '#') return -1
      return a.localeCompare(b)
    })
    .map(([letter, list]) => ({
      letter,
      items: [...list].sort((x, y) => getName(x).localeCompare(getName(y), 'zh')),
    }))
}
