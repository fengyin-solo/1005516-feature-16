<template>
  <section class="page audit-page" data-module="supplieraudit">
    <header class="page-head">
      <div>
        <h2>供应商审计管理</h2>
        <p class="page-desc">
          按审计编号、审计方式、缺陷项数上下限、整改期限区间筛选；审计按物料类别排期，缺陷项数以审计组核定台账为准，整改期限全入口共用一份并留档。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记供应商审计记录</button>
        <button class="btn" type="button" @click="exportRows">导出供应商审计清单</button>
        <button class="btn ghost" type="button" @click="resetData">恢复演示数据</button>
      </div>
    </header>

    <div class="stat-row">
      <article
        v-for="item in stats"
        :key="item.label"
        class="stat-card"
        :class="item.tone ? `tone-${item.tone}` : ''"
      >
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar audit-filters" @submit.prevent="reload">
      <label class="filter-item">
        <span>审计编号</span>
        <input v-model="query.审计编号" placeholder="如 SUPP-0005（包含匹配）" />
      </label>
      <label class="filter-item">
        <span>审计方式</span>
        <select v-model="query.审计方式">
          <option value="">全部方式</option>
          <option v-for="method in methods" :key="method" :value="method">{{ method }}</option>
        </select>
      </label>
      <label class="filter-item range-item">
        <span>缺陷项数（下限 ~ 上限）</span>
        <span class="range-inputs">
          <input v-model="query.缺陷下限" inputmode="numeric" placeholder="下限" />
          <em>~</em>
          <input v-model="query.缺陷上限" inputmode="numeric" placeholder="上限" />
        </span>
      </label>
      <label class="filter-item range-item">
        <span>整改期限（起始 ~ 截止）</span>
        <span class="range-inputs">
          <input v-model="query.整改起始" placeholder="YYYY-MM-DD" />
          <em>~</em>
          <input v-model="query.整改截止" placeholder="YYYY-MM-DD" />
        </span>
      </label>
      <label class="filter-item">
        <span>整改期限排序</span>
        <select v-model="query.排序">
          <option value="默认">默认排序</option>
          <option value="期限升序">期限升序（快到期在前）</option>
          <option value="期限降序">期限降序</option>
        </select>
      </label>
      <button class="btn primary" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <div v-if="blockMessages.length" class="result-box blocked-box">
      <p class="result-title">以下筛选栏条件不合法，已打回重填：</p>
      <ul>
        <li v-for="item in blockMessages" :key="item.field">【{{ item.field }}】{{ item.message }}</li>
      </ul>
    </div>
    <div v-else-if="zeroMessages.length" class="result-box zero-box">
      <p class="result-title">查到 0 条，是下面的栏把结果卡住的：</p>
      <ul>
        <li v-for="item in zeroMessages" :key="item.field">【{{ item.field }}】{{ item.message }}</li>
      </ul>
    </div>

    <table class="data-table audit-table">
      <thead>
        <tr>
          <th>审计编号</th>
          <th>供应商名称</th>
          <th>物料类别</th>
          <th>审计方式</th>
          <th>缺陷项数</th>
          <th>审计结论</th>
          <th>计划审计日期</th>
          <th>审计日期</th>
          <th>整改期限</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td>{{ row.审计编号 ?? '—' }}</td>
          <td>{{ row.供应商名称 ?? '—' }}</td>
          <td>{{ row.物料类别 ?? '—' }}</td>
          <td>{{ row.审计方式 ?? '—' }}</td>
          <td>{{ defectCell(row) }}</td>
          <td class="conclusion-cell">{{ row.审计结论 ?? '—' }}</td>
          <td>{{ row.计划审计日期 ?? '—' }}</td>
          <td>{{ row.审计日期 || '—' }}</td>
          <td :class="deadlineClass(row)">
            {{ row.整改期限 || '未填写' }}
          </td>
          <td>
            <span class="status-chip" :class="`s-${String(row.status)}`">{{ row.status }}</span>
          </td>
          <td class="row-actions">
            <template v-for="action in allowedActions(row)" :key="action">
              <button class="link" type="button" @click="runTransition(action, row)">{{ action }}</button>
            </template>
            <button
              class="link"
              type="button"
              :disabled="!canSetDeadline(row)"
              :title="canSetDeadline(row) ? '修改整改期限（与各入口共用一份，自动留档）' : '该状态下不能修改整改期限'"
              @click="openDeadline(row)"
            >
              修改整改期限
            </button>
            <button
              v-if="String(row.status) === '审计中' || String(row.status) === '需整改'"
              class="link"
              type="button"
              @click="openVerify(row)"
            >
              核定缺陷项数
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length && !blockMessages.length">
          <td colspan="11" class="empty-state">
            {{ zeroMessages.length ? '请按上面的提示放宽或修正筛选栏条件' : '暂无供应商审计数据，可先登记供应商审计记录' }}
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条供应商审计记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <!-- 台账区 -->
    <section class="ledger-panel">
      <div class="ledger-tabs" role="tablist">
        <button
          v-for="tab in ledgerTabs"
          :key="tab.key"
          type="button"
          class="ledger-tab"
          :class="{ active: activeLedger === tab.key }"
          @click="activeLedger = tab.key"
        >
          {{ tab.label }}
          <em>{{ tab.count }}</em>
        </button>
      </div>

      <div v-if="activeLedger === 'deadline'" class="ledger-body">
        <p class="ledger-hint">整改期限的登记入口、整改跟踪入口、行内修改入口拿到的都是共用一份值；每次写入在此留档，只增不改。</p>
        <table class="data-table mini-table">
          <thead>
            <tr><th>审计编号</th><th>原整改期限</th><th>整改期限</th><th>写入入口</th><th>操作人</th><th>时间</th></tr>
          </thead>
          <tbody>
            <tr v-for="(item, index) in deadlineLedger" :key="index">
              <td>{{ item.审计编号 }}</td>
              <td>{{ item.原整改期限 || '（空）' }}</td>
              <td>{{ item.整改期限 }}</td>
              <td>{{ item.入口 }}</td>
              <td>{{ item.操作人 }}</td>
              <td>{{ item.时间 }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="activeLedger === 'verify'" class="ledger-body">
        <p class="ledger-hint">缺陷项数由审计组核定，审计单与台账不一致时按本台账口径统一。</p>
        <table class="data-table mini-table">
          <thead>
            <tr><th>审计编号</th><th>审计方式</th><th>核定缺陷项数</th><th>核定人</th><th>核定时间</th><th>备注</th></tr>
          </thead>
          <tbody>
            <tr v-for="(item, index) in verifyLedger" :key="index">
              <td>{{ item.审计编号 }}</td>
              <td>{{ item.审计方式 }}</td>
              <td>{{ item.核定缺陷项数 }}</td>
              <td>{{ item.核定人 }}</td>
              <td>{{ item.核定时间 }}</td>
              <td>{{ item.备注 }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="activeLedger === 'review'" class="ledger-body">
        <p class="ledger-hint">同一份审计重复复核只算一次：台账按审计编号去重，共 {{ reviewedCodes.size }} 份审计完成复核。</p>
        <table class="data-table mini-table">
          <thead>
            <tr><th>审计编号</th><th>复核人</th><th>复核时间</th><th>复核结论</th></tr>
          </thead>
          <tbody>
            <tr v-for="(item, index) in reviewLedger" :key="index">
              <td>{{ item.审计编号 }}</td>
              <td>{{ item.复核人 }}</td>
              <td>{{ item.复核时间 }}</td>
              <td>{{ item.复核结论 }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <div v-if="activeLedger === 'training'" class="ledger-body">
        <p class="ledger-hint">审计结论要求人员培训的，自动落到人员培训台账；同一审计只落一次。</p>
        <table class="data-table mini-table">
          <thead>
            <tr><th>培训编号</th><th>来源审计编号</th><th>培训主题</th><th>受训岗位</th><th>培训日期</th><th>有效期至</th><th>状态</th></tr>
          </thead>
          <tbody>
            <tr v-for="item in trainingRows" :key="String(item.id)">
              <td>{{ item.培训编号 }}</td>
              <td>{{ item.来源审计编号 }}</td>
              <td>{{ item.培训主题 }}</td>
              <td>{{ item.受训岗位 }}</td>
              <td>{{ item.培训日期 }}</td>
              <td>{{ item.有效期至 }}</td>
              <td>{{ item.status }}</td>
            </tr>
            <tr v-if="!trainingRows.length">
              <td colspan="7" class="empty-state">还没有由审计结论落地的培训记录</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- 登记弹窗 -->
    <div v-if="createOpen" class="modal-mask" @click.self="createOpen = false">
      <div class="modal-card">
        <h3>登记供应商审计记录</h3>
        <div class="form-grid">
          <label>
            <span>审计编号</span>
            <input v-model="createForm.审计编号" placeholder="留空自动编号，如 SUPP-0009" />
          </label>
          <label>
            <span>供应商名称 *</span>
            <input v-model="createForm.供应商名称" placeholder="供应商全称" />
          </label>
          <label>
            <span>物料类别 *</span>
            <select v-model="createForm.物料类别" @change="syncPlanned">
              <option value="">请选择（决定排期周期）</option>
              <option v-for="category in categories" :key="category" :value="category">{{ category }}</option>
            </select>
          </label>
          <label>
            <span>审计方式 *</span>
            <select v-model="createForm.审计方式">
              <option value="">请选择</option>
              <option v-for="method in methods" :key="method" :value="method">{{ method }}</option>
            </select>
          </label>
          <label>
            <span>申报缺陷项数</span>
            <input v-model="createForm.申报缺陷项数" inputmode="numeric" placeholder="待审计可填 0，最终以审计组核定为准" />
          </label>
          <label>
            <span>计划审计日期（按物料类别自动排期）</span>
            <input :value="plannedPreview" readonly placeholder="选择物料类别后自动生成" />
          </label>
          <label class="wide-cell">
            <span>整改期限（可后补，非法值会被打回）</span>
            <input v-model="createForm.整改期限" placeholder="YYYY-MM-DD，不能早于计划审计日期" />
          </label>
        </div>
        <p v-if="createError" class="error-text modal-error">{{ createError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="createOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">提交登记</button>
        </div>
      </div>
    </div>

    <!-- 修改整改期限弹窗（所有入口共用的同一份写入） -->
    <div v-if="deadlineOpen" class="modal-mask" @click.self="deadlineOpen = false">
      <div class="modal-card">
        <h3>修改整改期限</h3>
        <p class="modal-sub">
          审计 {{ deadlineTarget?.审计编号 }}（{{ deadlineTarget?.供应商名称 }}）。
          该入口与审计报告入口、整改跟踪入口共用一份期限值，保存后自动留档。
        </p>
        <label class="deadline-input">
          <span>整改期限 *</span>
          <input v-model="deadlineValue" placeholder="YYYY-MM-DD，须晚于审计日期且为真实日期" />
        </label>
        <label class="deadline-input">
          <span>写入入口</span>
          <select v-model="deadlineEntry">
            <option>整改跟踪入口</option>
            <option>审计报告入口</option>
            <option>列表行内入口</option>
          </select>
        </label>
        <p v-if="deadlineError" class="error-text modal-error">{{ deadlineError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="deadlineOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitDeadline">保存并留档</button>
        </div>
      </div>
    </div>

    <!-- 核定缺陷项数弹窗 -->
    <div v-if="verifyOpen" class="modal-mask" @click.self="verifyOpen = false">
      <div class="modal-card">
        <h3>审计组核定缺陷项数</h3>
        <p class="modal-sub">
          审计 {{ verifyTarget?.审计编号 }}（{{ verifyTarget?.供应商名称 }}）。核定结果写入核定台账，
          审计单上的缺陷项数 / 审计方式与台账不一致时，按台账口径统一。
        </p>
        <div class="form-grid">
          <label>
            <span>审计方式 *</span>
            <select v-model="verifyForm.审计方式">
              <option v-for="method in methods" :key="method" :value="method">{{ method }}</option>
            </select>
          </label>
          <label>
            <span>核定缺陷项数 *</span>
            <input v-model="verifyForm.核定缺陷项数" inputmode="numeric" placeholder="非负整数" />
          </label>
          <label class="wide-cell">
            <span>核定人</span>
            <input v-model="verifyForm.核定人" placeholder="审计组成员姓名" />
          </label>
          <label class="wide-cell">
            <span>核定备注</span>
            <input v-model="verifyForm.备注" placeholder="缺陷分布、与申报口径差异说明" />
          </label>
        </div>
        <p class="ledger-hint" v-if="methodCap(verifyForm.审计方式) === null">
          台账口径：现场审计不设缺陷项数上限。
        </p>
        <p class="ledger-hint" v-else>
          台账口径：{{ verifyForm.审计方式 }}缺陷项数上限为 {{ methodCap(verifyForm.审计方式) }} 项，超出将被拒收。
        </p>
        <p v-if="verifyError" class="error-text modal-error">{{ verifyError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="verifyOpen = false">取消</button>
          <button class="btn primary" type="button" @click="submitVerify">写入核定台账</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import { downloadEntries } from '@/api/local-service'
import {
  AUDIT_METHODS,
  MATERIAL_CATEGORIES,
  advanceAudit,
  auditStats,
  auditTrainingRows,
  createAudit,
  getDeadlineLedger,
  getReviewLedger,
  getVerifyLedger,
  isValidDateString,
  nextPlannedDate,
  queryAudits,
  resetAuditModule,
  setAuditDeadline,
  verifyDefects,
  type AuditQuery,
  type AuditSort,
} from '@/data/audit-ledger'
import type { EntryRow } from '@/data/types'

const methods = [...AUDIT_METHODS]
const categories = [...MATERIAL_CATEGORIES]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')

const query = ref<AuditQuery>({
  审计编号: '',
  审计方式: '',
  缺陷下限: '',
  缺陷上限: '',
  整改起始: '',
  整改截止: '',
  排序: '默认',
})

const blockMessages = ref<{ field: string; message: string }[]>([])
const zeroMessages = ref<{ field: string; message: string }[]>([])

const deadlineLedger = ref(getDeadlineLedger())
const verifyLedger = ref(getVerifyLedger())
const reviewLedger = ref(getReviewLedger())
const trainingRows = ref(auditTrainingRows())
const reviewedCodes = ref(new Set(reviewLedger.value.map((item) => item.审计编号)))

const activeLedger = ref<'deadline' | 'verify' | 'review' | 'training'>('deadline')
const ledgerTabs = computed(() => [
  { key: 'deadline' as const, label: '整改期限留档', count: deadlineLedger.value.length },
  { key: 'verify' as const, label: '缺陷核定台账', count: verifyLedger.value.length },
  { key: 'review' as const, label: '复核台账（去重）', count: reviewedCodes.value.size },
  { key: 'training' as const, label: '人员培训台账', count: trainingRows.value.length },
])

const statuses = ['待审计', '审计中', '已通过', '需整改', '复核通过']
const statusSummary = computed(() =>
  statuses.map((status) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)
const stats = computed(() => auditStats(rows.value))

function reload() {
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const result = queryAudits(query.value)
    rows.value = result.items
    total.value = result.total
    blockMessages.value = (Object.entries(result.blocks) as [string, string][]).map(([field, message]) => ({
      field,
      message,
    }))
    zeroMessages.value = (Object.entries(result.zeroReasons) as [string, string][]).map(([field, message]) => ({
      field,
      message,
    }))
    if (result.notes.length > 0) {
      noticeMessage.value = result.notes.map((note) => `${note.审计编号}：${note.message}`).join('；')
    }
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '供应商审计列表读取失败'
  }
}

function resetFilters() {
  query.value = {
    审计编号: '',
    审计方式: '',
    缺陷下限: '',
    缺陷上限: '',
    整改起始: '',
    整改截止: '',
    排序: '默认' as AuditSort,
  }
  reload()
}

function refreshLedgers() {
  deadlineLedger.value = getDeadlineLedger()
  verifyLedger.value = getVerifyLedger()
  reviewLedger.value = getReviewLedger()
  trainingRows.value = auditTrainingRows()
  reviewedCodes.value = new Set(reviewLedger.value.map((item) => item.审计编号))
}

function resetData() {
  resetAuditModule()
  refreshLedgers()
  noticeMessage.value = '已恢复为演示数据（含核定 / 复核 / 期限留档台账）'
  reload()
}

function exportRows() {
  downloadEntries('supplieraudit')
}

// ---------- 状态流转 ----------

const ACTIONS_BY_STATUS: Record<string, string[]> = {
  待审计: ['提交审计'],
  审计中: ['判定通过', '要求整改'],
  需整改: ['复核通过'],
  已通过: [],
  复核通过: [],
}

function allowedActions(row: EntryRow): string[] {
  return ACTIONS_BY_STATUS[String(row.status)] ?? []
}

function runTransition(action: string, row: EntryRow) {
  errorMessage.value = ''
  noticeMessage.value = ''
  const result = advanceAudit(Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  noticeMessage.value = result.message
  refreshLedgers()
  reload()
}

// ---------- 展示辅助 ----------

function canSetDeadline(row: EntryRow): boolean {
  const status = String(row.status)
  return status === '审计中' || status === '需整改' || status === '已通过'
}

function isValidDate(value: unknown): boolean {
  return typeof value === 'string' && isValidDateString(value)
}

function deadlineClass(row: EntryRow): string {
  const raw = String(row.整改期限 ?? '')
  if (!isValidDate(raw)) {
    return 'deadline-missing'
  }
  if (String(row.status) !== '需整改') {
    return ''
  }
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const target = new Date(raw)
  const diff = (target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000)
  if (diff < 0) {
    return 'deadline-overdue'
  }
  if (diff <= 14) {
    return 'deadline-soon'
  }
  return ''
}

function defectCell(row: EntryRow): string {
  const value = Number(row.缺陷项数)
  return Number.isFinite(value) ? String(value) : '待核定'
}

// ---------- 登记弹窗 ----------

const createOpen = ref(false)
const createError = ref('')
const createForm = ref({
  审计编号: '',
  供应商名称: '',
  物料类别: '',
  审计方式: '',
  申报缺陷项数: '',
  整改期限: '',
})

const plannedPreview = computed(() =>
  createForm.value.物料类别 ? nextPlannedDate(createForm.value.物料类别) : '',
)

function openCreate() {
  createForm.value = {
    审计编号: '',
    供应商名称: '',
    物料类别: '',
    审计方式: '',
    申报缺陷项数: '',
    整改期限: '',
  }
  createError.value = ''
  createOpen.value = true
}

function syncPlanned() {
  // 计划审计日期由物料类别排期推导，computed 自动展示，无需额外赋值
}

function submitCreate() {
  createError.value = ''
  const result = createAudit(createForm.value)
  if (!result.ok) {
    createError.value = result.message
    return
  }
  createOpen.value = false
  noticeMessage.value = result.message
  refreshLedgers()
  reload()
}

// ---------- 修改整改期限弹窗 ----------

const deadlineOpen = ref(false)
const deadlineError = ref('')
const deadlineValue = ref('')
const deadlineEntry = ref('整改跟踪入口')
const deadlineTarget = ref<EntryRow | null>(null)

function openDeadline(row: EntryRow) {
  if (!canSetDeadline(row)) {
    errorMessage.value = `审计 ${String(row.审计编号)} 当前状态为「${String(row.status)}」，不能修改整改期限`
    return
  }
  deadlineTarget.value = row
  deadlineValue.value = String(row.整改期限 ?? '')
  deadlineEntry.value = '整改跟踪入口'
  deadlineError.value = ''
  deadlineOpen.value = true
}

function submitDeadline() {
  if (!deadlineTarget.value) {
    return
  }
  deadlineError.value = ''
  const result = setAuditDeadline(
    Number(deadlineTarget.value.id),
    deadlineValue.value,
    deadlineEntry.value,
  )
  if (!result.ok) {
    deadlineError.value = result.message
    return
  }
  deadlineOpen.value = false
  noticeMessage.value = result.message
  refreshLedgers()
  reload()
}

// ---------- 核定缺陷项数弹窗 ----------

const verifyOpen = ref(false)
const verifyError = ref('')
const verifyTarget = ref<EntryRow | null>(null)
const verifyForm = ref({
  审计方式: '现场审计',
  核定缺陷项数: '',
  核定人: '',
  备注: '',
})

const METHOD_CAP_TEXT: Record<string, number | null> = {
  现场审计: null,
  书面审计: 5,
  远程审计: 3,
}

function methodCap(method: string): number | null {
  return METHOD_CAP_TEXT[method] ?? null
}

function openVerify(row: EntryRow) {
  verifyTarget.value = row
  verifyForm.value = {
    审计方式: String(row.审计方式 ?? '现场审计'),
    核定缺陷项数: Number.isFinite(Number(row.缺陷项数)) ? String(row.缺陷项数) : '',
    核定人: '',
    备注: '',
  }
  verifyError.value = ''
  verifyOpen.value = true
}

function submitVerify() {
  if (!verifyTarget.value) {
    return
  }
  verifyError.value = ''
  const result = verifyDefects(
    Number(verifyTarget.value.id),
    verifyForm.value.核定缺陷项数,
    verifyForm.value.审计方式,
    verifyForm.value.核定人.trim() || '审计组',
    verifyForm.value.备注.trim(),
  )
  if (!result.ok) {
    verifyError.value = result.message
    return
  }
  verifyOpen.value = false
  noticeMessage.value = result.message
  refreshLedgers()
  reload()
}

onMounted(reload)
</script>

<style scoped>
.audit-page { display: flex; flex-direction: column; gap: 4px; }
.page-actions { display: flex; gap: 8px; }

.audit-filters { align-items: flex-end; }
.audit-filters .filter-item input,
.audit-filters .filter-item select {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 13px;
  min-width: 150px;
}
.range-inputs { display: inline-flex; align-items: center; gap: 6px; }
.range-inputs input { min-width: 108px; }
.range-inputs em { font-style: normal; color: var(--muted); }

.stat-card.tone-soon { border-color: #d9a306; background: #fffbeb; }
.stat-card.tone-overdue { border-color: #b42318; background: #fef3f2; }
.tone-overdue .stat-value { color: #b42318; }

.result-box {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 14px;
  margin: 8px 0;
  font-size: 13px;
}
.blocked-box { border-color: #b42318; background: #fef3f2; }
.zero-box { border-color: #d9a306; background: #fffbeb; }
.result-title { margin: 0 0 6px; font-weight: 600; }
.result-box ul { margin: 0; padding-left: 18px; }
.result-box li { margin: 2px 0; }

.audit-table td, .audit-table th { vertical-align: top; }
.conclusion-cell { max-width: 240px; }
.deadline-overdue { color: #b42318; font-weight: 600; }
.deadline-soon { color: #b25e09; font-weight: 600; }
.deadline-missing { color: var(--muted); }

.status-chip {
  display: inline-block;
  border-radius: 999px;
  padding: 1px 10px;
  font-size: 12px;
  background: #eef2f7;
  white-space: nowrap;
}
.status-chip.s-需整改 { background: #fef3f2; color: #b42318; }
.status-chip.s-复核通过 { background: #ecfdf3; color: #067647; }
.status-chip.s-已通过 { background: #ecfdf3; color: #067647; }
.status-chip.s-审计中 { background: #eff8ff; color: #175cd3; }

.row-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.link:disabled { color: #a8b3c2; cursor: not-allowed; }

.notice-text { color: #175cd3; }

.ledger-panel {
  margin-top: 18px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
}
.ledger-tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
.ledger-tab {
  border: 1px solid var(--border);
  background: #f8fafc;
  border-radius: 999px;
  padding: 5px 14px;
  cursor: pointer;
  font-size: 13px;
}
.ledger-tab em {
  font-style: normal;
  margin-left: 6px;
  background: #e2e8f0;
  border-radius: 999px;
  padding: 0 7px;
  font-size: 12px;
}
.ledger-tab.active { background: var(--brand); border-color: var(--brand); color: #fff; }
.ledger-tab.active em { background: rgba(255, 255, 255, 0.25); color: #fff; }
.ledger-hint { font-size: 12px; color: var(--muted); margin: 0 0 8px; }
.mini-table th, .mini-table td { font-size: 12px; padding: 6px 8px; }

.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 50;
}
.modal-card {
  background: #fff;
  border-radius: 10px;
  width: 640px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 48px);
  overflow: auto;
  padding: 18px 20px;
  box-shadow: 0 12px 32px rgba(15, 23, 42, 0.2);
}
.modal-card h3 { margin: 0 0 8px; font-size: 16px; }
.modal-sub { font-size: 13px; color: var(--muted); margin: 0 0 12px; }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 14px; }
.form-grid label, .deadline-input { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); }
.form-grid .wide-cell { grid-column: 1 / -1; }
.form-grid input, .form-grid select, .deadline-input input, .deadline-input select {
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 7px 9px;
  font-size: 13px;
  color: #1f2937;
}
.deadline-input { margin-bottom: 10px; }
.modal-error { margin: 10px 0 0; }
.modal-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
</style>
