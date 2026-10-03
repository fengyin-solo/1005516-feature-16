import { listRows, resetRows, saveRows } from './local-store'
import { SEED_ROWS } from './seed'
import type { ActionResult, EntryRow } from './types'

// 供应商审计专用台账口径：
// - 审计按物料类别排期（类别排期表决定下一次计划审计日期）
// - 缺陷项数由审计组核定（核定台账为唯一口径，与审计方式不一致时按台账统一）
// - 整改期限只允许从这里写入，几个入口共用同一份值，每次改动留档
// - 状态只能往下逐档流转，跳级/回退一律拒收
// - 同一份审计重复复核只算一次（复核台账去重）
// - 审计结论要求培训的，落到人员培训台账

export const AUDIT_KEY = 'supplieraudit'
export const TRAINING_KEY = 'training'

export const AUDIT_METHODS = ['现场审计', '书面审计', '远程审计'] as const

// 按台账口径，非现场审计方式的缺陷项数上限（现场审计不设上限）
const METHOD_DEFECT_CAP: Record<string, number | null> = {
  现场审计: null,
  书面审计: 5,
  远程审计: 3,
}

// 物料类别排期表：审计周期（月）。审计排期 = 同类别最近一次审计日期 + 周期
export const MATERIAL_CATEGORIES = ['原料药', '辅料', '包装材料', '耗材'] as const
const CATEGORY_CYCLE_MONTHS: Record<string, number> = {
  原料药: 12,
  辅料: 6,
  包装材料: 12,
  耗材: 24,
}

export const AUDIT_STATUSES = ['待审计', '审计中', '已通过', '需整改', '复核通过'] as const
const TERMINAL_STATUSES = ['已通过', '复核通过']

// 允许的动作与目标状态
const ACTION_TARGETS: Record<string, string> = {
  提交审计: '审计中',
  判定通过: '已通过',
  要求整改: '需整改',
  复核通过: '复核通过',
}

// 状态机：只能往下逐档流转
const FORWARD_EDGES: Record<string, string[]> = {
  待审计: ['审计中'],
  审计中: ['已通过', '需整改'],
  需整改: ['复核通过'],
  已通过: [],
  复核通过: [],
}
const STATUS_RANK: Record<string, number> = {
  待审计: 0,
  审计中: 1,
  已通过: 2,
  需整改: 2,
  复核通过: 3,
}

// ---------- 日期工具 ----------

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

/** 严格校验 YYYY-MM-DD：格式要对、日子要真实存在（2 月 30 日这种直接判非法）。 */
export function parseDate(value: string): Date | null {
  const text = value.trim()
  const matched = DATE_PATTERN.exec(text)
  if (!matched) {
    return null
  }
  const year = Number(matched[1])
  const month = Number(matched[2])
  const day = Number(matched[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null
  }
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null
  }
  return date
}

export function isValidDateString(value: string): boolean {
  return parseDate(value) !== null
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function toDateString(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

function addMonths(value: string, months: number): string {
  const date = parseDate(value)
  if (!date) {
    return value
  }
  const target = new Date(date)
  const originalDay = target.getDate()
  target.setDate(1)
  target.setMonth(target.getMonth() + months)
  // 月末溢出时收回到该月最后一天
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate()
  target.setDate(Math.min(originalDay, lastDay))
  return toDateString(target)
}

function todayString(): string {
  return toDateString(new Date())
}

function nowStamp(): string {
  const now = new Date()
  return `${toDateString(now)} ${pad2(now.getHours())}:${pad2(now.getMinutes())}`
}

// ---------- 台账存储（追加型，只增不改不删） ----------

export type VerifyEntry = {
  审计编号: string
  审计方式: string
  核定缺陷项数: number
  核定人: string
  核定时间: string
  备注: string
}

export type ReviewEntry = {
  审计编号: string
  复核人: string
  复核时间: string
  复核结论: string
}

export type DeadlineArchiveEntry = {
  审计编号: string
  原整改期限: string
  整改期限: string
  入口: string
  操作人: string
  时间: string
}

const VERIFY_KEY = 'pharma-cleanroom:audit-verify-ledger'
const REVIEW_KEY = 'pharma-cleanroom:audit-review-ledger'
const DEADLINE_KEY = 'pharma-cleanroom:audit-deadline-ledger'

// 核定台账种子：SUPP-0003 申报 6 项与书面审计口径不符，核定为 4 项
const SEED_VERIFY: VerifyEntry[] = [
  { 审计编号: 'SUPP-0002', 审计方式: '现场审计', 核定缺陷项数: 3, 核定人: '审计组-周岚', 核定时间: '2026-09-25 14:20', 备注: '现场清点核定' },
  { 审计编号: 'SUPP-0003', 审计方式: '书面审计', 核定缺陷项数: 4, 核定人: '审计组-周岚', 核定时间: '2026-09-30 16:05', 备注: '申报 6 项与书面审计口径不符，核定为 4 项' },
  { 审计编号: 'SUPP-0005', 审计方式: '现场审计', 核定缺陷项数: 5, 核定人: '审计组-高远', 核定时间: '2026-09-12 15:40', 备注: '含称量与更衣管理缺陷' },
  { 审计编号: 'SUPP-0007', 审计方式: '现场审计', 核定缺陷项数: 1, 核定人: '审计组-高远', 核定时间: '2026-07-18 11:12', 备注: '仓储记录缺陷' },
]

// 复核台账种子
const SEED_REVIEW: ReviewEntry[] = [
  { 审计编号: 'SUPP-0007', 复核人: '质量部-复核组', 复核时间: '2026-08-20 10:30', 复核结论: '整改证据齐全，培训记录已归档，复核通过' },
]

// 整改期限留档种子：同一份期限在多个入口被读写，每次改动都留痕
const SEED_DEADLINE: DeadlineArchiveEntry[] = [
  { 审计编号: 'SUPP-0004', 原整改期限: '', 整改期限: '2026-09-30', 入口: '审计报告入口', 操作人: '审计组-高远', 时间: '2026-08-20 09:30' },
  { 审计编号: 'SUPP-0004', 原整改期限: '2026-09-30', 整改期限: '2026-09-20', 入口: '整改跟踪入口', 操作人: 'QA-李倩', 时间: '2026-08-25 13:10' },
  { 审计编号: 'SUPP-0007', 原整改期限: '', 整改期限: '2026-08-31', 入口: '审计报告入口', 操作人: '审计组-高远', 时间: '2026-07-18 17:00' },
  { 审计编号: 'SUPP-0007', 原整改期限: '2026-08-31', 整改期限: '2026-08-18', 入口: '整改跟踪入口', 操作人: 'QA-李倩', 时间: '2026-07-22 10:05' },
  { 审计编号: 'SUPP-0005', 原整改期限: '', 整改期限: '2026-10-08', 入口: '审计报告入口', 操作人: '审计组-高远', 时间: '2026-09-12 18:00' },
  { 审计编号: 'SUPP-0006', 原整改期限: '', 整改期限: '2026-10-06', 入口: '审计报告入口', 操作人: '审计组-周岚', 时间: '2026-09-22 16:40' },
]

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

type LedgerCache = { verify: VerifyEntry[] | null; review: ReviewEntry[] | null; deadline: DeadlineArchiveEntry[] | null }
const ledgerCache: LedgerCache = { verify: null, review: null, deadline: null }

function readLedger<T>(key: string, seed: T[]): T[] {
  if (typeof window === 'undefined' || !window.localStorage) {
    return clone(seed)
  }
  const raw = window.localStorage.getItem(key)
  if (!raw) {
    window.localStorage.setItem(key, JSON.stringify(seed))
    return clone(seed)
  }
  try {
    return JSON.parse(raw) as T[]
  } catch {
    window.localStorage.setItem(key, JSON.stringify(seed))
    return clone(seed)
  }
}

function writeLedger<T>(key: string, rows: T[]): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(key, JSON.stringify(rows))
  }
}

export function getVerifyLedger(): VerifyEntry[] {
  if (!ledgerCache.verify) {
    ledgerCache.verify = readLedger(VERIFY_KEY, SEED_VERIFY)
  }
  return ledgerCache.verify
}

export function getReviewLedger(): ReviewEntry[] {
  if (!ledgerCache.review) {
    ledgerCache.review = readLedger(REVIEW_KEY, SEED_REVIEW)
  }
  return ledgerCache.review
}

export function getDeadlineLedger(): DeadlineArchiveEntry[] {
  if (!ledgerCache.deadline) {
    ledgerCache.deadline = readLedger(DEADLINE_KEY, SEED_DEADLINE)
  }
  return ledgerCache.deadline
}

/** 已复核（去重后）的审计编号集合：同一份审计复核几次都只算一次。 */
export function reviewedAuditCodes(): Set<string> {
  return new Set(getReviewLedger().map((entry) => entry.审计编号))
}

// ---------- 核定台账口径统一 ----------

export type ReconcileNote = { 审计编号: string; message: string }

/**
 * 缺陷项数 / 审计方式以审计组核定台账为准：
 * 台账有记录而审计单上不一致的，按台账口径统一并标注。
 */
function reconcileWithVerifyLedger(rows: EntryRow[]): { rows: EntryRow[]; notes: ReconcileNote[]; changed: boolean } {
  const latest = new Map<string, VerifyEntry>()
  for (const entry of getVerifyLedger()) {
    latest.set(entry.审计编号, entry)
  }
  const notes: ReconcileNote[] = []
  let changed = false
  const next = rows.map((row) => {
    const code = String(row.审计编号 ?? '')
    const ledger = latest.get(code)
    if (!ledger) {
      return row
    }
    let updated = row
    const messageParts: string[] = []
    if (String(row.审计方式 ?? '') !== ledger.审计方式) {
      updated = { ...updated, 审计方式: ledger.审计方式 }
      messageParts.push(`审计方式按核定台账统一为「${ledger.审计方式}」`)
    }
    if (Number(row.缺陷项数) !== ledger.核定缺陷项数) {
      updated = { ...updated, 缺陷项数: ledger.核定缺陷项数 }
      messageParts.push(`缺陷项数按审计组核定口径统一为 ${ledger.核定缺陷项数} 项`)
    }
    if (messageParts.length > 0) {
      changed = true
      notes.push({ 审计编号: code, message: messageParts.join('，') })
    }
    return updated
  })
  return { rows: next, notes, changed }
}

// ---------- 查询筛选 ----------

export type AuditSort = '默认' | '期限升序' | '期限降序'

export type AuditQuery = {
  审计编号: string
  审计方式: string
  缺陷下限: string
  缺陷上限: string
  整改起始: string
  整改截止: string
  排序: AuditSort
}

export type ColumnBlock = Partial<Record<'审计编号' | '审计方式' | '缺陷项数' | '整改期限', string>>
export type ColumnBlocks = ColumnBlock

export type AuditQueryResult = {
  items: EntryRow[]
  total: number
  blocks: ColumnBlocks // 条件本身不合法被打回
  zeroReasons: ColumnBlock // 合法但查不到时，逐栏说明卡在哪
  notes: ReconcileNote[]
}

function isNonNegativeInteger(value: string): boolean {
  return /^\d+$/.test(value.trim())
}

export function queryAudits(query: AuditQuery): AuditQueryResult {
  const blocks: ColumnBlocks = {}
  const zeroReasons: ColumnBlock = {}

  // 1. 先校验条件本身：缺陷上下限、期限起止
  let minDefect: number | null = null
  let maxDefect: number | null = null
  if (query.缺陷下限.trim() !== '') {
    if (!isNonNegativeInteger(query.缺陷下限)) {
      blocks.缺陷项数 = `缺陷项数下限「${query.缺陷下限.trim()}」不是非负整数，请重新填写`
    } else {
      minDefect = Number(query.缺陷下限.trim())
    }
  }
  if (query.缺陷上限.trim() !== '') {
    if (!isNonNegativeInteger(query.缺陷上限)) {
      blocks.缺陷项数 = `缺陷项数上限「${query.缺陷上限.trim()}」不是非负整数，请重新填写`
    } else {
      maxDefect = Number(query.缺陷上限.trim())
    }
  }
  if (blocks.缺陷项数 === undefined && minDefect !== null && maxDefect !== null && minDefect > maxDefect) {
    blocks.缺陷项数 = `缺陷项数下限（${minDefect}）不能大于上限（${maxDefect}），请重新填写`
  }

  let startDate: Date | null = null
  let endDate: Date | null = null
  if (query.整改起始.trim() !== '') {
    startDate = parseDate(query.整改起始)
    if (!startDate) {
      blocks.整改期限 = `整改期限起始「${query.整改起始.trim()}」不是合法日期（要求 YYYY-MM-DD 且真实存在），已打回重填`
    }
  }
  if (query.整改截止.trim() !== '') {
    endDate = parseDate(query.整改截止)
    if (!endDate) {
      blocks.整改期限 = `整改期限截止「${query.整改截止.trim()}」不是合法日期（要求 YYYY-MM-DD 且真实存在），已打回重填`
    }
  }
  if (blocks.整改期限 === undefined && startDate && endDate && startDate > endDate) {
    blocks.整改期限 = `整改期限起始（${query.整改起始.trim()}）不能晚于截止（${query.整改截止.trim()}），请重新填写`
  }

  if (Object.keys(blocks).length > 0) {
    return { items: [], total: 0, blocks, zeroReasons: {}, notes: [] }
  }

  // 2. 口径统一（核定台账优先），有回写就落盘
  const reconciled = reconcileWithVerifyLedger(listRows(AUDIT_KEY))
  if (reconciled.changed) {
    saveRows(AUDIT_KEY, reconciled.rows)
  }
  const all = reconciled.rows

  // 3. 各栏独立过滤，既用于求交集也用于「查不到时讲清卡在哪一栏」
  const codeText = query.审计编号.trim()
  const methodText = query.审计方式.trim()
  const defectActive = minDefect !== null || maxDefect !== null
  const dateActive = startDate !== null || endDate !== null

  const matchCode = (row: EntryRow) => String(row.审计编号 ?? '').includes(codeText)
  const matchMethod = (row: EntryRow) => String(row.审计方式 ?? '').includes(methodText)
  const matchDefect = (row: EntryRow) => {
    const value = Number(row.缺陷项数)
    if (!Number.isFinite(value)) {
      return false
    }
    if (minDefect !== null && value < minDefect) {
      return false
    }
    if (maxDefect !== null && value > maxDefect) {
      return false
    }
    return true
  }
  const matchDate = (row: EntryRow) => {
    const date = parseDate(String(row.整改期限 ?? ''))
    if (!date) {
      return false // 没填期限 / 期限非法的记录，不进入区间结果
    }
    if (startDate && date < startDate) {
      return false
    }
    if (endDate && date > endDate) {
      return false
    }
    return true
  }

  let items = all
  if (codeText !== '') {
    const column = all.filter(matchCode)
    if (column.length === 0) {
      zeroReasons.审计编号 = `审计编号含「${codeText}」的记录为 0 条，本栏已把结果卡死`
    }
    items = items.filter(matchCode)
  }
  if (methodText !== '') {
    const column = all.filter(matchMethod)
    if (column.length === 0) {
      zeroReasons.审计方式 = `审计方式为「${methodText}」的记录为 0 条，本栏已把结果卡死`
    }
    items = items.filter(matchMethod)
  }
  if (defectActive) {
    const column = all.filter(matchDefect)
    const rangeText = `${minDefect ?? 0} ~ ${maxDefect ?? '不限'}`
    if (column.length === 0) {
      zeroReasons.缺陷项数 = `缺陷项数落在 ${rangeText} 项区间内的记录为 0 条，本栏已把结果卡死（未核定的记录不计入）`
    }
    items = items.filter(matchDefect)
  }
  if (dateActive) {
    const column = all.filter(matchDate)
    const rangeText = `${query.整改起始.trim() || '不限'} ~ ${query.整改截止.trim() || '不限'}`
    if (column.length === 0) {
      zeroReasons.整改期限 = `整改期限落在 ${rangeText} 的记录为 0 条，本栏已把结果卡死（未填整改期限的记录不计入）`
    }
    items = items.filter(matchDate)
  }

  // 4. 整改期限排序（非法/未填的沉底）
  if (query.排序 !== '默认') {
    items = [...items].sort((a, b) => {
      const da = parseDate(String(a.整改期限 ?? ''))
      const db = parseDate(String(b.整改期限 ?? ''))
      if (!da && !db) {
        return Number(a.id) - Number(b.id)
      }
      if (!da) {
        return 1
      }
      if (!db) {
        return -1
      }
      const diff = da.getTime() - db.getTime()
      return query.排序 === '期限升序' ? diff : -diff
    })
  }

  return { items, total: items.length, blocks, zeroReasons, notes: reconciled.notes }
}

// ---------- 状态流转 ----------

function findAudit(rows: EntryRow[], id: number): EntryRow | undefined {
  return rows.find((row) => Number(row.id) === id)
}

/** 结论要求培训的，落到人员培训台账；同一审计只落一次。 */
function landTraining(row: EntryRow): { added: boolean; code: string } {
  const code = String(row.审计编号 ?? '')
  const trainingRows = listRows(TRAINING_KEY)
  const existed = trainingRows.some((item) => String(item.来源审计编号 ?? '') === code)
  if (existed) {
    return { added: false, code }
  }
  const nextId = trainingRows.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1
  const today = todayString()
  const entry: EntryRow = {
    id: nextId,
    status: '待培训',
    pending: true,
    abnormal: false,
    培训编号: `TRAI-${code}`,
    培训主题: `供应商审计 ${code} 结论要求：人员专项培训`,
    受训岗位: '供应商相关岗位（供应商侧）',
    培训方式: '专项培训',
    考核成绩: '',
    培训日期: today,
    有效期至: addMonths(today, 12),
    培训状态: '由审计结论要求',
    来源审计编号: code,
  }
  saveRows(TRAINING_KEY, [...trainingRows, entry])
  return { added: true, code }
}

export function advanceAudit(id: number, action: string): ActionResult {
  const target = ACTION_TARGETS[action]
  if (!target) {
    return { ok: false, message: `供应商审计没有登记「${action}」这个动作` }
  }
  const rows = listRows(AUDIT_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的供应商审计记录` }
  }
  const current = String(rows[index].status)
  const code = String(rows[index].审计编号 ?? '')

  // 复核去重：同一份审计重复复核只算一次，台账已有就拒收（优先于状态提示）
  if (action === '复核通过' && reviewedAuditCodes().has(code)) {
    return { ok: false, message: `审计 ${code} 已复核过并计入复核台账，重复复核只算一次，已拒收` }
  }

  if (current === target) {
    return { ok: false, message: `审计 ${code} 已经是「${target}」，不用重复操作` }
  }

  const allowed = FORWARD_EDGES[current] ?? []
  if (!allowed.includes(target)) {
    const hint = allowed.length > 0 ? `允许的下一状态：${allowed.join('、')}` : '该状态已到终态，不能再流转'
    if (STATUS_RANK[target] <= STATUS_RANK[current]) {
      return { ok: false, message: `状态只能往下流转，不能从「${current}」退回「${target}」，已拒收。${hint}` }
    }
    return { ok: false, message: `状态只能逐档往下流转，不能从「${current}」跳级到「${target}」，已拒收。${hint}` }
  }

  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: !TERMINAL_STATUSES.includes(target),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(AUDIT_KEY, next)

  const parts = [`审计 ${code} 已${action}，当前状态「${target}」`]

  // 复核留台账（追加型）
  if (action === '复核通过') {
    const review: ReviewEntry = {
      审计编号: code,
      复核人: '质量部-复核组',
      复核时间: nowStamp(),
      复核结论: '整改证据复核通过',
    }
    const ledger = [...getReviewLedger(), review]
    ledgerCache.review = ledger
    writeLedger(REVIEW_KEY, ledger)
    parts.push('已计入复核台账（重复复核不再重复计入）')
  }

  // 结论落到人员培训台账
  if (String(updated.审计结论 ?? '').includes('培训')) {
    const landed = landTraining(updated)
    parts.push(
      landed.added
        ? `审计结论含培训要求，已落到人员培训台账（培训编号 TRAI-${landed.code}）`
        : `审计结论含培训要求，人员培训台账已存在 ${landed.code} 的培训记录，不重复登记`,
    )
  }

  return { ok: true, message: parts.join('；') }
}

// ---------- 整改期限：共用一份 + 留档 + 非法打回 ----------

/**
 * 整改期限唯一写入入口：登记弹窗、整改跟踪、列表行内动作都走这里，
 * 保证几个入口拿到的是共用一份值；每次改动追加留档。
 */
export function setAuditDeadline(
  id: number,
  deadline: string,
  entry: string,
  operator = '值班管理员',
): ActionResult {
  const rows = listRows(AUDIT_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的供应商审计记录` }
  }
  const code = String(rows[index].审计编号 ?? '')
  const value = deadline.trim()

  const date = parseDate(value)
  if (!date) {
    return {
      ok: false,
      message: `整改期限「${deadline}」不是合法日期（要求 YYYY-MM-DD 且真实存在，如 2026-10-31），已打回重填`,
    }
  }

  const auditDate = String(rows[index].审计日期 ?? '')
  const plannedDate = String(rows[index].计划审计日期 ?? '')
  const base = parseDate(auditDate) ?? parseDate(plannedDate)
  const baseLabel = parseDate(auditDate) ? '审计日期' : '计划审计日期'
  if (base && date < base) {
    return {
      ok: false,
      message: `整改期限（${value}）不能早于${baseLabel}（${baseLabel === '审计日期' ? auditDate : plannedDate}），已打回重填`,
    }
  }

  const previous = String(rows[index].整改期限 ?? '')
  const updated: EntryRow = { ...rows[index], 整改期限: value }
  const next = [...rows]
  next[index] = updated
  saveRows(AUDIT_KEY, next)

  const archiveEntry: DeadlineArchiveEntry = {
    审计编号: code,
    原整改期限: previous,
    整改期限: value,
    入口: entry,
    操作人: operator,
    时间: nowStamp(),
  }
  const ledger = [...getDeadlineLedger(), archiveEntry]
  ledgerCache.deadline = ledger
  writeLedger(DEADLINE_KEY, ledger)

  const actionText = previous === '' ? '登记' : `由 ${previous} 更新`
  return {
    ok: true,
    message: `审计 ${code} 整改期限已${actionText}为 ${value}（入口：${entry}），各入口共用同一份值，本次改动已留档（第 ${ledger.length} 条）`,
  }
}

// ---------- 缺陷项数核定 ----------

export function verifyDefects(
  id: number,
  countInput: string,
  method: string,
  operator = '审计组',
  remark = '',
): ActionResult {
  const rows = listRows(AUDIT_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的供应商审计记录` }
  }
  const code = String(rows[index].审计编号 ?? '')
  const status = String(rows[index].status)

  if (status !== '审计中' && status !== '需整改') {
    return { ok: false, message: `审计 ${code} 当前状态为「${status}」，缺陷项数只能在「审计中 / 需整改」阶段由审计组核定` }
  }
  if (!(AUDIT_METHODS as readonly string[]).includes(method)) {
    return { ok: false, message: `审计方式「${method}」不在台账允许范围内（${AUDIT_METHODS.join('、')}）` }
  }
  const text = countInput.trim()
  if (!isNonNegativeInteger(text)) {
    return { ok: false, message: `核定缺陷项数「${countInput}」不是非负整数，已打回重填` }
  }
  const count = Number(text)
  const cap = METHOD_DEFECT_CAP[method]
  if (cap !== null && count > cap) {
    return {
      ok: false,
      message: `按台账口径「${method}」缺陷项数上限为 ${cap} 项，核定 ${count} 项与审计方式不一致，请核对审计方式或缺陷项数后重新核定`,
    }
  }

  const entry: VerifyEntry = {
    审计编号: code,
    审计方式: method,
    核定缺陷项数: count,
    核定人: operator,
    核定时间: nowStamp(),
    备注: remark,
  }
  const ledger = [...getVerifyLedger(), entry]
  ledgerCache.verify = ledger
  writeLedger(VERIFY_KEY, ledger)

  // 立即按台账口径统一
  const updated: EntryRow = {
    ...rows[index],
    审计方式: method,
    缺陷项数: count,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(AUDIT_KEY, next)

  return { ok: true, message: `审计 ${code} 缺陷项数已由审计组核定为 ${count} 项（${method}），台账口径已统一` }
}

// ---------- 登记 + 物料类别排期 ----------

export type AuditDraft = {
  审计编号: string
  供应商名称: string
  物料类别: string
  审计方式: string
  申报缺陷项数: string
  整改期限: string
}

/** 按物料类别排期：同类别最近一次审计日期 + 类别周期；该类别从没审过（只有待审计计划）时自登记日起 1 个月。 */
export function nextPlannedDate(category: string, fromDate: string = todayString()): string {
  const months = CATEGORY_CYCLE_MONTHS[category]
  if (!months) {
    return ''
  }
  const rows = listRows(AUDIT_KEY).filter((row) => String(row.物料类别 ?? '') === category)
  // 排期只从「已经实际审计过」的记录的审计日期起算；只有计划日期、还没审的记录不参与，
  // 避免给同类别再登记时排出一个尚未到来的新周期起点。
  const audited = rows
    .map((row) => parseDate(String(row.审计日期 ?? '')))
    .filter((date): date is Date => date !== null)
  let base = ''
  if (audited.length > 0) {
    const latest = audited.reduce((max, date) => (date > max ? date : max))
    base = toDateString(latest)
  } else {
    base = fromDate
  }
  return addMonths(base, months)
}

export function createAudit(draft: AuditDraft): ActionResult & { id?: number } {
  const supplier = draft.供应商名称.trim()
  if (!supplier) {
    return { ok: false, message: '供应商名称不能为空' }
  }
  const category = draft.物料类别.trim()
  if (!MATERIAL_CATEGORIES.includes(category as (typeof MATERIAL_CATEGORIES)[number])) {
    return { ok: false, message: `物料类别「${draft.物料类别}」不在排期表内（${MATERIAL_CATEGORIES.join('、')}）` }
  }
  const method = draft.审计方式.trim()
  if (!(AUDIT_METHODS as readonly string[]).includes(method)) {
    return { ok: false, message: `审计方式「${draft.审计方式}」不在台账允许范围内（${AUDIT_METHODS.join('、')}）` }
  }
  if (draft.申报缺陷项数.trim() !== '' && !isNonNegativeInteger(draft.申报缺陷项数)) {
    return { ok: false, message: `申报缺陷项数「${draft.申报缺陷项数}」不是非负整数，已打回重填` }
  }

  const rows = listRows(AUDIT_KEY)
  let code = draft.审计编号.trim()
  if (!code) {
    const nextSeq = rows.reduce((max, row) => {
      const matched = /^SUPP-(\d+)$/.exec(String(row.审计编号 ?? ''))
      return matched ? Math.max(max, Number(matched[1])) : max
    }, 0) + 1
    code = `SUPP-${String(nextSeq).padStart(4, '0')}`
  } else if (!/^SUPP-\d{4}$/.test(code)) {
    return { ok: false, message: `审计编号「${code}」格式不符，要求形如 SUPP-0009；留空则自动编号` }
  } else if (rows.some((row) => String(row.审计编号 ?? '') === code)) {
    return { ok: false, message: `审计编号 ${code} 已存在，不能重复登记` }
  }

  const planned = nextPlannedDate(category)
  const deadline = draft.整改期限.trim()
  if (deadline) {
    if (!isValidDateString(deadline)) {
      return { ok: false, message: `整改期限「${deadline}」不是合法日期（要求 YYYY-MM-DD 且真实存在），已打回重填` }
    }
    const plannedDate = parseDate(planned)
    const deadlineDate = parseDate(deadline)
    if (plannedDate && deadlineDate && deadlineDate < plannedDate) {
      return { ok: false, message: `整改期限（${deadline}）不能早于按物料类别排期的计划审计日期（${planned}），已打回重填` }
    }
  }

  const id = rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
  const entry: EntryRow = {
    id,
    status: '待审计',
    pending: true,
    abnormal: false,
    审计编号: code,
    供应商名称: supplier,
    物料类别: category,
    审计方式: method,
    缺陷项数: draft.申报缺陷项数.trim() === '' ? 0 : Number(draft.申报缺陷项数.trim()),
    审计结论: '待审计',
    计划审计日期: planned,
    审计日期: '',
    整改期限: deadline,
  }
  saveRows(AUDIT_KEY, [...rows, entry])

  if (deadline) {
    // 登记入口与其他入口共用同一份期限值，同样留档
    const archiveEntry: DeadlineArchiveEntry = {
      审计编号: code,
      原整改期限: '',
      整改期限: deadline,
      入口: '登记入口',
      操作人: '值班管理员',
      时间: nowStamp(),
    }
    const ledger = [...getDeadlineLedger(), archiveEntry]
    ledgerCache.deadline = ledger
    writeLedger(DEADLINE_KEY, ledger)
  }

  return { ok: true, message: `审计 ${code} 已登记，按「${category}」排期，计划审计日期 ${planned}`, id }
}

// ---------- 统计 ----------

export type AuditStat = { label: string; value: number; tone?: 'overdue' | 'soon' }

export function auditStats(rows: EntryRow[]): AuditStat[] {
  const countByStatus = (status: string) => rows.filter((row) => String(row.status) === status).length
  const today = parseDate(todayString()) as Date
  const rectifiable = rows.filter((row) => String(row.status) === '需整改')
  const overdue = rectifiable.filter((row) => {
    const date = parseDate(String(row.整改期限 ?? ''))
    return date !== null && date < today
  }).length
  const soon = rectifiable.filter((row) => {
    const date = parseDate(String(row.整改期限 ?? ''))
    if (!date || date < today) {
      return false
    }
    const days = (date.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)
    return days <= 14
  }).length
  return [
    { label: '待审计供应商', value: countByStatus('待审计') },
    { label: '审计中供应商', value: countByStatus('审计中') },
    { label: '需整改供应商数', value: rectifiable.length },
    { label: '已复核供应商数', value: reviewedAuditCodes().size },
    { label: '14 天内到期', value: soon, tone: 'soon' },
    { label: '已逾期', value: overdue, tone: 'overdue' },
  ]
}

// ---------- 培训台账中由审计落地的记录 ----------

export function auditTrainingRows(): EntryRow[] {
  return listRows(TRAINING_KEY).filter((row) => String(row.来源审计编号 ?? '') !== '')
}

// ---------- 重置（连带台账） ----------

export function resetAuditModule(): void {
  resetRows(AUDIT_KEY)
  ledgerCache.verify = clone(SEED_VERIFY)
  ledgerCache.review = clone(SEED_REVIEW)
  ledgerCache.deadline = clone(SEED_DEADLINE)
  writeLedger(VERIFY_KEY, ledgerCache.verify)
  writeLedger(REVIEW_KEY, ledgerCache.review)
  writeLedger(DEADLINE_KEY, ledgerCache.deadline)
  // 培训台账回到种子（清掉运行期由审计结论落地的记录）
  saveRows(TRAINING_KEY, clone(SEED_ROWS[TRAINING_KEY] ?? []))
}
