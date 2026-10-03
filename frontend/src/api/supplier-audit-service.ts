import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, DeadlineArchive, EntryRow } from '@/data/types'

// 供应商审计的业务口径都收在这一个文件里：页面只管展示，规则改台账不用翻页面。

export const AUDIT_STATUSES = ['待审计', '审计中', '需整改', '整改中', '复核通过', '已通过'] as const

// 状态只能往下流转：每个状态只放行台账登记过的下家，跳级、回退、重复操作一律拒收。
// 「复核退回」是审计业务里明示的拒收动作，单独放行到需整改，不算跳级。
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  待审计: ['审计中'],
  审计中: ['需整改', '复核通过'],
  需整改: ['整改中'],
  整改中: ['复核通过'],
  复核通过: ['已通过', '需整改'],
  已通过: [],
}

export const AUDIT_METHODS = ['现场审计', '远程审计', '问卷调查'] as const

// 审计方式与缺陷项数的台账口径：核定结果落在哪一档，就按这一档的上限统一。
// 核定为非负整数；低于下限取 0，超出该审计方式上限的按上限收口。
const DEFECT_LIMIT_BY_METHOD: Record<string, number> = {
  现场审计: 15,
  远程审计: 8,
  问卷调查: 5,
}

export const MATERIAL_CATEGORIES = ['原料药', '辅料', '包装材料', '试剂耗材'] as const

// 审计按物料类别排期：不同类别有各自的审计周期与排期月，新建审计时据此建议排期。
// 排期月/排期日均为自然月日（直接展示用），内部换算日期时再减 1。
const CATEGORY_SCHEDULE: Record<string, { 周期年限: number; 排期月: number; 排期日: number }> = {
  原料药: { 周期年限: 1, 排期月: 3, 排期日: 15 },
  辅料: { 周期年限: 2, 排期月: 6, 排期日: 20 },
  包装材料: { 周期年限: 2, 排期月: 9, 排期日: 10 },
  试剂耗材: { 周期年限: 1, 排期月: 10, 排期日: 25 },
}

export const DEADLINE_ENTRY_POINTS = ['要求整改时登记', '整改期限栏维护', '复核前核对'] as const

const MODULE_KEY = 'supplieraudit'
const TRAINING_KEY = 'training'
const NEAR_DUE_DAYS = 7

export type AuditRow = EntryRow & {
  审计编号: string
  供应商名称: string
  物料类别: string
  审计方式: string
  排期日期: string
  缺陷项数: number
  审计结论: string
  整改期限: string
  复核人?: string
  复核日期?: string
  期限留档?: DeadlineArchive[]
  复核次数?: number
}

export type AuditFilters = {
  审计编号: string
  审计方式: string
  缺陷项数下限: string
  缺陷项数上限: string
  整改期限起: string
  整改期限止: string
  期限排序: '' | 'asc' | 'desc'
}

export type Blocker = { 栏名: string; 条件: string; 单栏命中: number }

export type AuditQueryResult = {
  items: AuditRow[]
  total: number
  blockers: Blocker[]
  activeConditions: number
}

export type AuditStats = {
  待审计: number
  审计中: number
  需整改: number
  临期整改: number
}

export type CreateAuditInput = {
  供应商名称: string
  物料类别: string
  审计方式: string
  排期日期: string
  缺陷项数: string
  整改期限: string
  操作人: string
}

function auditRows(): AuditRow[] {
  return listRows(MODULE_KEY) as unknown as AuditRow[]
}

function persist(rows: AuditRow[]): void {
  saveRows(MODULE_KEY, rows as unknown as EntryRow[])
}

function todayIso(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

// 留档时间按本地时钟记，不用 toISOString()，否则东八区的白天会被 UTC 拨到前一天。
function localTimestamp(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  const hour = String(now.getHours()).padStart(2, '0')
  const minute = String(now.getMinutes()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day} ${hour}:${minute}`
}

// 严格校验日期：必须是 yyyy-mm-dd、真实日历日（2026-13-40、2026-02-31 一律打回）。
export function isValidIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false
  }
  const [yearText, monthText, dayText] = value.split('-')
  const year = Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  if (month < 1 || month > 12 || day < 1) {
    return false
  }
  const probe = new Date(year, month - 1, day)
  return probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day
}

function parseDate(value: string): Date | null {
  if (!isValidIsoDate(value)) {
    return null
  }
  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

export function methodDefectLimit(method: string): number {
  return DEFECT_LIMIT_BY_METHOD[method] ?? DEFECT_LIMIT_BY_METHOD.现场审计
}

// 缺陷项数与审计方式不一致时按台账口径统一：非数字/负数归零，超档收口到该方式上限。
export function normalizeDefectCount(raw: string | number, method: string): { value: number; adjusted: boolean; reason: string } {
  const limit = methodDefectLimit(method)
  const parsed = typeof raw === 'number' ? raw : Number(String(raw).trim())
  if (!Number.isFinite(parsed)) {
    return { value: 0, adjusted: true, reason: `核定值无法识别，按台账口径记 0（${method}上限 ${limit} 项）` }
  }
  const rounded = Math.trunc(parsed)
  if (rounded < 0) {
    return { value: 0, adjusted: true, reason: `核定值为负数，按台账口径记 0（${method}上限 ${limit} 项）` }
  }
  if (rounded > limit) {
    return { value: limit, adjusted: true, reason: `核定值 ${rounded} 项超出${method}台账上限 ${limit} 项，已按台账口径统一为 ${limit} 项` }
  }
  return { value: rounded, adjusted: false, reason: `核定值 ${rounded} 项符合${method}台账口径（上限 ${limit} 项）` }
}

export function categorySchedule(category: string) {
  return CATEGORY_SCHEDULE[category] ?? CATEGORY_SCHEDULE.原料药
}

// 计算某物料类别从今天起的下一次审计排期日。
export function nextScheduleDate(category: string, from = todayIso()): string {
  const rule = categorySchedule(category)
  const base = parseDate(from) ?? new Date()
  let year = base.getFullYear()
  let candidate = new Date(year, rule.排期月 - 1, rule.排期日)
  if (candidate.getTime() < base.getTime()) {
    year += rule.周期年限
    candidate = new Date(year, rule.排期月 - 1, rule.排期日)
  }
  const month = String(candidate.getMonth() + 1).padStart(2, '0')
  const day = String(candidate.getDate()).padStart(2, '0')
  return `${candidate.getFullYear()}-${month}-${day}`
}

function isOverdueOrNear(row: AuditRow, today = todayIso()): '' | 'overdue' | 'near' {
  const deadline = parseDate(String(row.整改期限 ?? ''))
  const now = parseDate(today)
  if (!deadline || !now) {
    return ''
  }
  if (deadline.getTime() < now.getTime()) {
    return 'overdue'
  }
  const gap = Math.round((deadline.getTime() - now.getTime()) / 86400000)
  return gap <= NEAR_DUE_DAYS ? 'near' : ''
}

export function deadlineUrgency(row: AuditRow): '' | 'overdue' | 'near' {
  if (row.status === '已通过' || row.status === '复核通过') {
    return ''
  }
  return isOverdueOrNear(row)
}

function nextAuditNumber(rows: AuditRow[]): string {
  let max = 0
  for (const row of rows) {
    const matched = /^SUPP-(\d+)$/.exec(String(row.审计编号 ?? ''))
    if (matched) {
      max = Math.max(max, Number(matched[1]))
    }
  }
  return `SUPP-${String(max + 1).padStart(4, '0')}`
}

function nextTrainingNumber(rows: EntryRow[]): string {
  let max = 0
  for (const row of rows) {
    const matched = /^TRAI-(\d+)$/.exec(String(row.培训编号 ?? ''))
    if (matched) {
      max = Math.max(max, Number(matched[1]))
    }
  }
  return `TRAI-${String(max + 1).padStart(4, '0')}`
}

function asText(value: unknown): string {
  return String(value ?? '').trim()
}

function asNumber(value: unknown): number | null {
  const text = asText(value)
  if (text === '') {
    return null
  }
  const parsed = Number(text)
  return Number.isInteger(parsed) ? parsed : null
}

// 审计列表：编号/方式是单栏条件，缺陷项数上下限、整改期限起止是卡口；
// 返回 blockers 把每个条件单独再跑一遍，查不到时能讲清是哪一栏把结果卡成了 0。
export function queryAudits(input: AuditFilters): AuditQueryResult {
  const rows = auditRows()

  const auditId = input.审计编号.trim()
  const method = input.审计方式.trim()
  const defectMin = asNumber(input.缺陷项数下限)
  const defectMax = asNumber(input.缺陷项数上限)
  const dateFrom = input.整改期限起.trim()
  const dateTo = input.整改期限止.trim()

  const matchId = (row: AuditRow) => asText(row.审计编号).toLowerCase().includes(auditId.toLowerCase())
  const matchMethod = (row: AuditRow) => method === '' || asText(row.审计方式) === method
  const matchDefect = (row: AuditRow) =>
    (defectMin === null || Number(row.缺陷项数) >= defectMin) &&
    (defectMax === null || Number(row.缺陷项数) <= defectMax)
  const matchDeadline = (row: AuditRow) => {
    const value = asText(row.整改期限)
    return (dateFrom === '' || value >= dateFrom) && (dateTo === '' || value <= dateTo)
  }

  const items = rows.filter(
    (row) => matchId(row) && matchMethod(row) && matchDefect(row) && matchDeadline(row),
  )

  const sorted = [...items].sort((a, b) => {
    if (input.期限排序 === '') {
      return 0
    }
    const left = asText(a.整改期限)
    const right = asText(b.整改期限)
    if (!left && !right) return 0
    if (!left) return 1
    if (!right) return -1
    return input.期限排序 === 'asc' ? left.localeCompare(right) : right.localeCompare(left)
  })

  const blockers: Blocker[] = []
  if (sorted.length === 0) {
    if (auditId !== '') {
      blockers.push({ 栏名: '审计编号', 条件: `包含「${auditId}」`, 单栏命中: rows.filter(matchId).length })
    }
    if (method !== '') {
      blockers.push({ 栏名: '审计方式', 条件: `等于「${method}」`, 单栏命中: rows.filter(matchMethod).length })
    }
    if (defectMin !== null || defectMax !== null) {
      const 条件 = defectMin === null
        ? `缺陷项数 ≤ ${defectMax}`
        : defectMax === null
          ? `缺陷项数 ≥ ${defectMin}`
          : `缺陷项数 ${defectMin} ~ ${defectMax}`
      blockers.push({ 栏名: '缺陷项数', 条件, 单栏命中: rows.filter(matchDefect).length })
    }
    if (dateFrom !== '' || dateTo !== '') {
      const 条件 = `整改期限 ${dateFrom || '不限'} 至 ${dateTo || '不限'}`
      blockers.push({ 栏名: '整改期限', 条件, 单栏命中: rows.filter(matchDeadline).length })
    }
  }

  return {
    items: sorted,
    total: sorted.length,
    blockers,
    activeConditions: blockers.length,
  }
}

function validateTransition(action: string, target: string, current: string): ActionResult | null {
  if (current === target) {
    return { ok: false, message: `当前已经是「${target}」，重复操作不生效` }
  }
  const allowed = ALLOWED_TRANSITIONS[current] ?? []
  if (!allowed.includes(target)) {
    return {
      ok: false,
      message: `状态只能向下流转：「${current}」不能直接${action}跳到「${target}」，跳级操作已拒收`,
    }
  }
  return null
}

function withArchive(row: AuditRow, deadline: string, entry: string, operator: string): AuditRow {
  const record: DeadlineArchive = {
    期限: deadline,
    入口: entry,
    操作人: operator,
    留档时间: localTimestamp(),
  }
  return { ...row, 整改期限: deadline, 期限留档: [...(row.期限留档 ?? []), record] }
}

// 整改期限填成非法值打回重填；校验通过才允许落库，并追加一条留档。
export function updateDeadline(
  id: number,
  deadline: string,
  entry: string,
  operator: string,
): ActionResult {
  const value = deadline.trim()
  if (!isValidIsoDate(value)) {
    return { ok: false, message: `整改期限「${deadline}」为非法日期（格式须为 yyyy-mm-dd 且为真实日历日），已打回重填` }
  }
  const rows = auditRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的供应商审计记录` }
  }
  rows[index] = withArchive(rows[index], value, entry, operator)
  persist(rows)
  return { ok: true, message: `整改期限已更新为 ${value}，本次变更已留档（入口：${entry}）` }
}

// 缺陷项数由审计组核定：登记时按审计方式做台账口径统一，返回是否被调整。
export function confirmDefectCount(id: number, raw: string, operator: string): ActionResult {
  const rows = auditRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的供应商审计记录` }
  }
  const row = rows[index]
  const result = normalizeDefectCount(raw, String(row.审计方式))
  rows[index] = { ...row, 缺陷项数: result.value, 核定人: operator }
  persist(rows)
  return {
    ok: true,
    message: result.adjusted
      ? `审计组核定完成：${result.reason}`
      : `审计组核定完成：${result.reason}`,
  }
}

// 审计结论落到人员培训台账：结论要求培训的，生成一条培训记录，同一审计不重复落账。
function appendTrainingLedger(
  row: AuditRow,
  conclusion: string,
  operator: string,
): { created: boolean; message: string } {
  const needTraining = /培训|宣贯|再教育/.test(conclusion)
  if (!needTraining) {
    return { created: false, message: '审计结论未提出培训要求，无需写入人员培训台账' }
  }
  const trainingRows = listRows(TRAINING_KEY)
  const sourceId = `supplieraudit:${row.id}`
  if (trainingRows.some((item) => String(item.来源审计 ?? '') === sourceId)) {
    return { created: false, message: '该审计的培训要求已在人员培训台账中，不重复落账' }
  }
  const next: EntryRow = {
    id: trainingRows.length ? Math.max(...trainingRows.map((item) => Number(item.id))) + 1 : 1,
    status: '待培训',
    pending: true,
    abnormal: false,
    培训编号: nextTrainingNumber(trainingRows),
    培训主题: `供应商审计整改培训：${asText(row.供应商名称)}（${asText(row.审计编号)}）`,
    受训岗位: '采购与质量相关岗位',
    培训方式: '集中培训',
    考核成绩: '',
    培训日期: todayIso(),
    有效期至: '',
    培训状态: '待培训',
    来源审计: sourceId,
    建档人: operator,
  }
  saveRows(TRAINING_KEY, [...trainingRows, next])
  return { created: true, message: `审计结论要求培训，已落入人员培训台账（培训编号 ${next.培训编号}）` }
}

export type AdvanceInput = {
  action: string
  整改期限?: string
  审计结论?: string
  复核人?: string
  操作人: string
}

export function advanceAudit(id: number, input: AdvanceInput): ActionResult {
  const targetMap: Record<string, string> = {
    提交审计: '审计中',
    要求整改: '需整改',
    提交整改: '整改中',
    送交复核: '复核通过',
    判定通过: '已通过',
    复核退回: '需整改',
  }
  const target = targetMap[input.action]
  if (!target) {
    return { ok: false, message: `供应商审计没有登记「${input.action}」这个动作` }
  }

  const rows = auditRows()
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的供应商审计记录` }
  }
  const row = rows[index]
  const blocked = validateTransition(input.action, target, String(row.status))
  if (blocked) {
    return blocked
  }

  let updated: AuditRow = { ...row }

  // 要求整改必须给出合法整改期限；几个入口拿到的是同一份，这里统一收口并留档。
  if (input.action === '要求整改') {
    const deadline = (input.整改期限 ?? '').trim()
    if (!isValidIsoDate(deadline)) {
      return { ok: false, message: `整改期限「${input.整改期限 ?? ''}」为非法日期（yyyy-mm-dd 且为真实日历日），已打回重填` }
    }
    updated = withArchive(updated, deadline, '要求整改时登记', input.操作人)
  }

  // 送交复核即审计组复核：同一份审计重复复核只算一次，再次送交直接拒收。
  if (input.action === '送交复核') {
    if (Number(row.复核次数 ?? 0) > 0 || row.复核日期) {
      return { ok: false, message: `审计 ${row.审计编号} 已完成过复核（${row.复核日期} ${row.复核人 ?? ''}），同一份审计重复复核只算一次` }
    }
    updated = {
      ...updated,
      复核人: input.操作人,
      复核日期: todayIso(),
      复核次数: 1,
    }
  }

  // 判定通过即审计关闭：审计结论在此收口径，需要培训的同步落到人员培训台账。
  let trainingMessage = ''
  if (input.action === '判定通过') {
    const conclusion = (input.审计结论 ?? '').trim()
    if (!conclusion) {
      return { ok: false, message: '判定通过前必须填写审计结论' }
    }
    updated.审计结论 = conclusion
    const ledger = appendTrainingLedger(updated, conclusion, input.操作人)
    trainingMessage = ledger.message
  }

  if (input.action === '复核退回') {
    // 复核退回是业务拒收动作：清掉本次复核痕迹，允许整改后重新复核一次。
    updated = { ...updated, 复核人: '', 复核日期: '', 复核次数: 0, abnormal: true }
  }

  updated.status = target
  updated.pending = target !== '已通过'
  if (input.action !== '复核退回') {
    updated.abnormal = Boolean(updated.abnormal) || isOverdueOrNear(updated) === 'overdue'
  }

  rows[index] = updated
  persist(rows)
  const notes: string[] = []
  if (input.action === '要求整改') {
    notes.push(`整改期限 ${updated.整改期限} 已按「要求整改时登记」入口留档`)
  }
  if (trainingMessage) {
    notes.push(trainingMessage)
  }
  const suffix = notes.length ? `，${notes.join('；')}` : ''
  return { ok: true, message: `审计 ${updated.审计编号} 已${input.action}，当前状态「${target}」${suffix}` }
}

export function auditStats(): AuditStats {
  const rows = auditRows()
  return {
    待审计: rows.filter((row) => row.status === '待审计').length,
    审计中: rows.filter((row) => row.status === '审计中').length,
    需整改: rows.filter((row) => row.status === '需整改' || row.status === '整改中').length,
    临期整改: rows.filter((row) => deadlineUrgency(row) !== '').length,
  }
}

export function createAudit(input: CreateAuditInput): ActionResult & { id?: number } {
  const supplier = input.供应商名称.trim()
  if (!supplier) {
    return { ok: false, message: '供应商名称不能为空' }
  }
  if (!MATERIAL_CATEGORIES.includes(input.物料类别 as (typeof MATERIAL_CATEGORIES)[number])) {
    return { ok: false, message: `物料类别必须是：${MATERIAL_CATEGORIES.join('、')}` }
  }
  if (!AUDIT_METHODS.includes(input.审计方式 as (typeof AUDIT_METHODS)[number])) {
    return { ok: false, message: `审计方式必须是：${AUDIT_METHODS.join('、')}` }
  }
  if (!isValidIsoDate(input.排期日期)) {
    return { ok: false, message: `排期日期「${input.排期日期}」不是合法日期，已打回重填` }
  }
  let deadline = ''
  if (input.整改期限.trim() !== '') {
    if (!isValidIsoDate(input.整改期限.trim())) {
      return { ok: false, message: `整改期限「${input.整改期限}」为非法日期（yyyy-mm-dd 且为真实日历日），已打回重填` }
    }
    deadline = input.整改期限.trim()
  }

  const rows = auditRows()
  const defect = normalizeDefectCount(input.缺陷项数, input.审计方式)
  const number = nextAuditNumber(rows)
  const created: AuditRow = {
    id: rows.length ? Math.max(...rows.map((row) => Number(row.id))) + 1 : 1,
    status: '待审计',
    pending: true,
    abnormal: false,
    审计编号: number,
    供应商名称: supplier,
    物料类别: input.物料类别,
    审计方式: input.审计方式,
    排期日期: input.排期日期,
    缺陷项数: defect.value,
    审计结论: '',
    整改期限: deadline,
    复核人: '',
    复核日期: '',
    复核次数: 0,
    期限留档: deadline
      ? [{ 期限: deadline, 入口: '登记审计时预填', 操作人: input.操作人, 留档时间: localTimestamp() }]
      : [],
  }
  persist([...rows, created])
  const adjustNote = defect.adjusted ? `；${defect.reason}` : ''
  return { ok: true, message: `审计 ${number} 已登记，按「${input.物料类别}」排入 ${input.排期日期}${adjustNote}`, id: Number(created.id) }
}
