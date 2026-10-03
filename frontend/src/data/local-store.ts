import { SEED_ROWS } from './seed'
import type { DeadlineArchive, EntryRow } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'pharma-cleanroom:entries'

const AUDIT_METHODS = ['现场审计', '远程审计', '问卷调查']
const AUDIT_STATUSES = ['待审计', '审计中', '需整改', '整改中', '复核通过', '已通过']
const DEFECT_LIMIT: Record<string, number> = { 现场审计: 15, 远程审计: 8, 问卷调查: 5 }

// 老版本浏览器里缓存的供应商审计行是示例文本，读取时就地规整成新台账口径，
// 不动其它模块；规整只影响缺字段/非法值的老数据。
function migrateSupplierAudit(rows: EntryRow[]): EntryRow[] {
  return rows.map((row) => {
    if (AUDIT_STATUSES.includes(String(row.status)) && AUDIT_METHODS.includes(String(row.审计方式 ?? '')) && typeof row.缺陷项数 === 'number' && '排期日期' in row) {
      return row
    }
    const method = AUDIT_METHODS.includes(String(row.审计方式)) ? String(row.审计方式) : '现场审计'
    const parsed = Number(row.缺陷项数)
    const limit = DEFECT_LIMIT[method]
    const defect = Number.isFinite(parsed) ? Math.min(Math.max(Math.trunc(parsed), 0), limit) : 0
    const deadline = /^\d{4}-\d{2}-\d{2}$/.test(String(row.整改期限 ?? '')) ? String(row.整改期限) : ''
    const archive: DeadlineArchive[] = deadline
      ? [{ 期限: deadline, 入口: '历史数据迁移', 操作人: '系统', 留档时间: '' }]
      : []
    return {
      ...row,
      status: AUDIT_STATUSES.includes(String(row.status)) ? String(row.status) : '待审计',
      物料类别: ['原料药', '辅料', '包装材料', '试剂耗材'].includes(String(row.物料类别)) ? String(row.物料类别) : '原料药',
      审计方式: method,
      排期日期: /^\d{4}-\d{2}-\d{2}$/.test(String(row.排期日期)) ? String(row.排期日期) : '2026-12-01',
      缺陷项数: defect,
      整改期限: deadline,
      复核人: '',
      复核日期: '',
      复核次数: 0,
      期限留档: archive,
    }
  })
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function normalize(parsed: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  if (Array.isArray(parsed.supplieraudit)) {
    return { ...parsed, supplieraudit: migrateSupplierAudit(parsed.supplieraudit) }
  }
  return parsed
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = clone(SEED_ROWS)
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return { ...fallback, ...normalize(parsed) }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  const next = { ...allRows(), [key]: rows }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
