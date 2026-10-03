<template>
  <section class="page" data-module="supplieraudit">
    <header class="page-head">
      <div>
        <h2>供应商审计管理</h2>
        <p class="page-desc">按物料类别排期开展审计；支持审计编号、审计方式、缺陷项数上下限、整改期限区间筛选与排序；状态只往下流转，整改期限全程留档。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记供应商审计记录</button>
        <button class="btn" type="button" @click="exportRows">导出供应商审计清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article class="stat-card">
        <span class="stat-label">待审计供应商</span>
        <strong class="stat-value">{{ stats.待审计 }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">审计中供应商</span>
        <strong class="stat-value">{{ stats.审计中 }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">需整改供应商数</span>
        <strong class="stat-value">{{ stats.需整改 }}</strong>
      </article>
      <article class="stat-card">
        <span class="stat-label">临期/逾期整改（7日内）</span>
        <strong class="stat-value" :class="{ 'stat-warn': stats.临期整改 > 0 }">{{ stats.临期整改 }}</strong>
      </article>
    </div>

    <!-- 审计按物料类别排期：各物料类别的审计周期、排期月和下一次排期日都在这里公示。 -->
    <div class="schedule-strip">
      <span class="schedule-title">物料类别审计排期：</span>
      <span v-for="item in scheduleCards" :key="item.类别" class="schedule-chip">
        {{ item.类别 }} · {{ item.周期 }} · 排期月 {{ item.排期月 }}月 · 下次 {{ item.下次排期 }}
      </span>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar audit-filter" @submit.prevent="reload">
      <label class="filter-item">
        <span>审计编号</span>
        <input v-model="filters.审计编号" placeholder="如 SUPP-0003（模糊匹配）" />
      </label>
      <label class="filter-item">
        <span>审计方式</span>
        <select v-model="filters.审计方式">
          <option value="">全部方式</option>
          <option v-for="method in AUDIT_METHODS" :key="method" :value="method">{{ method }}</option>
        </select>
      </label>
      <label class="filter-item range-item">
        <span>缺陷项数（上下限）</span>
        <span class="range-inputs">
          <input v-model="filters.缺陷项数下限" type="number" min="0" placeholder="下限" />
          <em>～</em>
          <input v-model="filters.缺陷项数上限" type="number" min="0" placeholder="上限" />
        </span>
      </label>
      <label class="filter-item range-item">
        <span>整改期限（起止区间）</span>
        <span class="range-inputs">
          <input v-model="filters.整改期限起" type="date" />
          <em>～</em>
          <input v-model="filters.整改期限止" type="date" />
        </span>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>
    <p v-if="rangeError" class="error-text filter-hint">{{ rangeError }}</p>

    <table class="data-table audit-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">
            <span v-if="column === '整改期限'" class="sort-head">
              整改期限
              <button class="link sort-btn" type="button" :title="'点击切换排序'" @click="toggleDeadlineSort">
                {{ sortIndicator }}
              </button>
            </span>
            <template v-else>{{ column }}</template>
          </th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td>{{ row.审计编号 }}</td>
          <td>{{ row.供应商名称 }}</td>
          <td>{{ row.物料类别 }}</td>
          <td>{{ row.审计方式 }}</td>
          <td>{{ row.排期日期 }}</td>
          <td>
            {{ row.缺陷项数 }}
            <button class="link mini" type="button" @click="openDefect(row)">核定</button>
          </td>
          <td>{{ row.审计结论 || '—' }}</td>
          <td :class="deadlineClass(row)">
            {{ row.整改期限 || '—' }}
            <button class="link mini" type="button" @click="openDeadline(row)">维护期限</button>
            <button class="link mini" type="button" @click="openArchive(row)">留档({{ (row.期限留档 ?? []).length }})</button>
          </td>
          <td>{{ row.复核人 || '—' }}<template v-if="row.复核日期"><br />{{ row.复核日期 }}</template></td>
          <td>
            <span :class="['status-tag', statusClass(row.status)]">{{ row.status }}</span>
          </td>
          <td class="row-actions">
            <template v-for="action in allowedActions(row)" :key="action">
              <button class="link" type="button" @click="openAction(action, row)">{{ action }}</button>
            </template>
            <button v-if="row.status === '复核通过'" class="link danger-link" type="button" @click="openAction('复核退回', row)">复核退回</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">
            <template v-if="hasActiveFilters">
              没有查到供应商审计记录。已逐栏核对当前筛选条件：
              <ul class="blocker-list">
                <li v-for="blocker in blockers" :key="blocker.栏名" :class="{ blocker: blocker.单栏命中 === 0 }">
                  【{{ blocker.栏名 }}】{{ blocker.条件 }} —— 单栏命中 {{ blocker.单栏命中 }} 条<template v-if="blocker.单栏命中 === 0">，就是这一栏把结果卡成了 0</template>
                </li>
              </ul>
            </template>
            <template v-else>暂无供应商审计数据，可先登记供应商审计记录</template>
          </td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>
        共 {{ total }} 条供应商审计记录<template v-if="hasActiveFilters">（{{ blockers.length }} 个筛选条件生效）</template>
      </span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
      <span v-else-if="successMessage" class="success-text">{{ successMessage }}</span>
    </footer>

    <!-- 登记新审计 -->
    <div v-if="modal === 'create'" class="modal-mask" @click.self="closeModal">
      <div class="modal">
        <h3>登记供应商审计记录</h3>
        <div class="form-grid">
          <label>
            <span>供应商名称 *</span>
            <input v-model="createForm.供应商名称" placeholder="供应商全称" />
          </label>
          <label>
            <span>物料类别 *（决定审计排期）</span>
            <select v-model="createForm.物料类别" @change="applySuggestedSchedule">
              <option v-for="cat in MATERIAL_CATEGORIES" :key="cat" :value="cat">{{ cat }}</option>
            </select>
          </label>
          <label>
            <span>审计方式 *（决定缺陷项数台账上限）</span>
            <select v-model="createForm.审计方式">
              <option v-for="method in AUDIT_METHODS" :key="method" :value="method">{{ method }}</option>
            </select>
          </label>
          <label>
            <span>排期日期 *</span>
            <input v-model="createForm.排期日期" type="date" />
            <small class="field-hint">建议排期：{{ suggestedSchedule }}</small>
          </label>
          <label>
            <span>缺陷项数（审计组核定）</span>
            <input v-model="createForm.缺陷项数" type="number" min="0" :placeholder="`${createForm.审计方式}台账上限 ${methodLimit} 项，超出自动收口`" />
          </label>
          <label>
            <span>整改期限（可留空，整改时再登记）</span>
            <input v-model="createForm.整改期限" type="date" />
          </label>
        </div>
        <p class="field-hint">登记后状态为「待审计」，只能通过「提交审计」往下流转；整改期限一旦填写即留档。</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="closeModal">取消</button>
          <button class="btn primary" type="button" @click="submitCreate">提交登记</button>
        </div>
      </div>
    </div>

    <!-- 审计组核定缺陷项数 -->
    <div v-else-if="modal === 'defect'" class="modal-mask" @click.self="closeModal">
      <div class="modal">
        <h3>审计组核定缺陷项数 · {{ activeRow?.审计编号 }}</h3>
        <p class="field-hint">审计方式：{{ activeRow?.审计方式 }}，台账口径上限 {{ methodLimit }} 项；核定值为非负整数，超上限按台账口径统一。</p>
        <label class="modal-field">
          <span>核定缺陷项数 *</span>
          <input v-model="defectForm" type="number" min="0" />
        </label>
        <div class="modal-actions">
          <button class="btn" type="button" @click="closeModal">取消</button>
          <button class="btn primary" type="button" @click="submitDefect">确认核定</button>
        </div>
      </div>
    </div>

    <!-- 维护整改期限（与「要求整改」「复核前核对」共用同一份数据，每次修改留档） -->
    <div v-else-if="modal === 'deadline'" class="modal-mask" @click.self="closeModal">
      <div class="modal">
        <h3>维护整改期限 · {{ activeRow?.审计编号 }}</h3>
        <label class="modal-field">
          <span>整改期限 *（yyyy-mm-dd，非法日期打回重填）</span>
          <input v-model="deadlineForm" type="date" />
        </label>
        <p class="field-hint">本入口与「要求整改时登记」「复核前核对」拿到的是同一份整改期限；保存即追加留档。</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="closeModal">取消</button>
          <button class="btn primary" type="button" @click="submitDeadline('整改期限栏维护')">保存并留档</button>
        </div>
      </div>
    </div>

    <!-- 整改期限留档 -->
    <div v-else-if="modal === 'archive'" class="modal-mask" @click.self="closeModal">
      <div class="modal">
        <h3>整改期限留档 · {{ activeRow?.审计编号 }}</h3>
        <table class="data-table archive-table">
          <thead>
            <tr><th>整改期限</th><th>登记入口</th><th>操作人</th><th>留档时间</th></tr>
          </thead>
          <tbody>
            <tr v-for="(item, idx) in activeRow?.期限留档 ?? []" :key="idx">
              <td>{{ item.期限 }}</td>
              <td>{{ item.入口 }}</td>
              <td>{{ item.操作人 }}</td>
              <td>{{ item.留档时间 || '历史迁移' }}</td>
            </tr>
            <tr v-if="!(activeRow?.期限留档 ?? []).length">
              <td colspan="4" class="empty-state">暂无留档记录</td>
            </tr>
          </tbody>
        </table>
        <div class="modal-actions">
          <button class="btn primary" type="button" @click="closeModal">关闭</button>
        </div>
      </div>
    </div>

    <!-- 要求整改：必须给合法整改期限，统一留档 -->
    <div v-else-if="modal === 'action-要求整改'" class="modal-mask" @click.self="closeModal">
      <div class="modal">
        <h3>要求整改 · {{ activeRow?.审计编号 }}</h3>
        <label class="modal-field">
          <span>整改期限 *（非法日期打回重填）</span>
          <input v-model="actionForm.整改期限" type="date" />
        </label>
        <div class="modal-actions">
          <button class="btn" type="button" @click="closeModal">取消</button>
          <button class="btn primary" type="button" @click="submitAdvance('要求整改')">确认要求整改</button>
        </div>
      </div>
    </div>

    <!-- 判定通过：审计结论在此收口，提出培训的自动落入人员培训台账 -->
    <div v-else-if="modal === 'action-判定通过'" class="modal-mask" @click.self="closeModal">
      <div class="modal">
        <h3>判定通过 · {{ activeRow?.审计编号 }}</h3>
        <label class="modal-field">
          <span>审计结论 *（含“培训/宣贯/再教育”时自动落入人员培训台账）</span>
          <textarea v-model="actionForm.审计结论" rows="3" placeholder="如：整改措施有效，相关岗位已完成专项培训"></textarea>
        </label>
        <div class="modal-actions">
          <button class="btn" type="button" @click="closeModal">取消</button>
          <button class="btn primary" type="button" @click="submitAdvance('判定通过')">确认通过并归档</button>
        </div>
      </div>
    </div>

    <!-- 复核退回：审计组复核不通过 -->
    <div v-else-if="modal === 'action-复核退回'" class="modal-mask" @click.self="closeModal">
      <div class="modal">
        <h3>复核退回 · {{ activeRow?.审计编号 }}</h3>
        <p class="field-hint">复核不通过将退回「需整改」，本次复核痕迹作废；整改后可重新复核一次。</p>
        <div class="modal-actions">
          <button class="btn" type="button" @click="closeModal">取消</button>
          <button class="btn primary" type="button" @click="submitAdvance('复核退回')">确认退回</button>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { downloadEntries } from '@/api/local-service'
import {
  advanceAudit,
  auditStats,
  AUDIT_METHODS,
  categorySchedule,
  confirmDefectCount,
  createAudit,
  deadlineUrgency,
  MATERIAL_CATEGORIES,
  methodDefectLimit,
  nextScheduleDate,
  queryAudits,
  updateDeadline,
  type AuditFilters,
  type AuditRow,
  type Blocker,
} from '@/api/supplier-audit-service'
import { useSessionStore } from '@/stores/session'

const session = useSessionStore()

const columns = ['审计编号', '供应商名称', '物料类别', '审计方式', '排期日期', '缺陷项数', '审计结论', '整改期限', '复核人/日期']

const rows = ref<AuditRow[]>([])
const total = ref(0)
const blockers = ref<Blocker[]>([])
const stats = ref(auditStats())
const errorMessage = ref('')
const successMessage = ref('')

const filters = reactive<AuditFilters>({
  审计编号: '',
  审计方式: '',
  缺陷项数下限: '',
  缺陷项数上限: '',
  整改期限起: '',
  整改期限止: '',
  期限排序: '',
})

const hasActiveFilters = computed(
  () =>
    filters.审计编号.trim() !== '' ||
    filters.审计方式 !== '' ||
    filters.缺陷项数下限.trim() !== '' ||
    filters.缺陷项数上限.trim() !== '' ||
    filters.整改期限起 !== '' ||
    filters.整改期限止 !== '',
)

const rangeError = computed(() => {
  const min = Number(filters.缺陷项数下限)
  const max = Number(filters.缺陷项数上限)
  if (filters.缺陷项数下限.trim() !== '' && filters.缺陷项数上限.trim() !== '' && min > max) {
    return '缺陷项数下限不能大于上限，请调整后再查询'
  }
  if (filters.整改期限起 !== '' && filters.整改期限止 !== '' && filters.整改期限起 > filters.整改期限止) {
    return '整改期限起始不能晚于截止，请调整区间后再查询'
  }
  return ''
})

const sortIndicator = computed(() => (filters.期限排序 === 'asc' ? '▲' : filters.期限排序 === 'desc' ? '▼' : '⇅'))

// 状态图例统计全量台账，不受筛选结果影响，避免筛选后图例只剩当前页数据。
const statusSummary = computed(() => {
  const all = queryAudits({
    审计编号: '',
    审计方式: '',
    缺陷项数下限: '',
    缺陷项数上限: '',
    整改期限起: '',
    整改期限止: '',
    期限排序: '',
  }).items
  return ['待审计', '审计中', '需整改', '整改中', '复核通过', '已通过'].map((status) => ({
    status,
    count: all.filter((row) => String(row.status) === status).length,
  }))
})

const scheduleCards = computed(() =>
  MATERIAL_CATEGORIES.map((类别) => {
    const rule = categorySchedule(类别)
    return {
      类别,
      周期: rule.周期年限 === 1 ? '每年1次' : `每${rule.周期年限}年1次`,
      排期月: rule.排期月,
      下次排期: nextScheduleDate(类别),
    }
  }),
)

// 弹窗状态
const modal = ref<'' | 'create' | 'defect' | 'deadline' | 'archive' | `action-${string}`>('')
const activeRow = ref<AuditRow | null>(null)

const createForm = reactive({
  供应商名称: '',
  物料类别: '原料药',
  审计方式: '现场审计',
  排期日期: nextScheduleDate('原料药'),
  缺陷项数: '0',
  整改期限: '',
})
const suggestedSchedule = computed(() => nextScheduleDate(createForm.物料类别))
const methodLimit = computed(() => {
  if (modal.value === 'defect' && activeRow.value) {
    return methodDefectLimit(String(activeRow.value.审计方式))
  }
  return methodDefectLimit(createForm.审计方式)
})
const defectForm = ref('0')
const deadlineForm = ref('')
const actionForm = reactive({ 整改期限: '', 审计结论: '' })

// 状态只能往下流转：页面按台账白名单渲染按钮，跳级的按钮压根不出现。
function allowedActions(row: AuditRow): string[] {
  switch (row.status) {
    case '待审计':
      return ['提交审计']
    case '审计中':
      return ['要求整改', '送交复核']
    case '需整改':
      return ['提交整改']
    case '整改中':
      return ['送交复核']
    case '复核通过':
      return ['判定通过']
    default:
      return []
  }
}

function deadlineClass(row: AuditRow) {
  const urgency = deadlineUrgency(row)
  return urgency === 'overdue' ? 'deadline-overdue' : urgency === 'near' ? 'deadline-near' : ''
}

function statusClass(status: string) {
  return {
    待审计: 'tag-gray',
    审计中: 'tag-blue',
    需整改: 'tag-red',
    整改中: 'tag-orange',
    复核通过: 'tag-cyan',
    已通过: 'tag-green',
  }[status] ?? 'tag-gray'
}

function toggleDeadlineSort() {
  filters.期限排序 = filters.期限排序 === '' ? 'asc' : filters.期限排序 === 'asc' ? 'desc' : ''
  reload()
}

function flash(result: { ok: boolean; message: string }) {
  if (result.ok) {
    successMessage.value = result.message
    errorMessage.value = ''
  } else {
    errorMessage.value = result.message
    successMessage.value = ''
  }
}

function reload() {
  errorMessage.value = ''
  if (rangeError.value) {
    rows.value = []
    total.value = 0
    blockers.value = []
    return
  }
  const result = queryAudits(filters)
  rows.value = result.items
  total.value = result.total
  blockers.value = result.blockers
  stats.value = auditStats()
}

function resetFilters() {
  filters.审计编号 = ''
  filters.审计方式 = ''
  filters.缺陷项数下限 = ''
  filters.缺陷项数上限 = ''
  filters.整改期限起 = ''
  filters.整改期限止 = ''
  filters.期限排序 = ''
  reload()
}

function closeModal() {
  modal.value = ''
  activeRow.value = null
  actionForm.整改期限 = ''
  actionForm.审计结论 = ''
}

function exportRows() {
  downloadEntries('supplieraudit')
}

function applySuggestedSchedule() {
  createForm.排期日期 = nextScheduleDate(createForm.物料类别)
}

function openCreate() {
  Object.assign(createForm, {
    供应商名称: '',
    物料类别: '原料药',
    审计方式: '现场审计',
    排期日期: nextScheduleDate('原料药'),
    缺陷项数: '0',
    整改期限: '',
  })
  modal.value = 'create'
}

function submitCreate() {
  const result = createAudit({ ...createForm, 操作人: session.operator })
  if (!result.ok) {
    flash(result)
    return
  }
  flash(result)
  closeModal()
  reload()
}

function openDefect(row: AuditRow) {
  activeRow.value = row
  defectForm.value = String(row.缺陷项数)
  modal.value = 'defect'
}

function submitDefect() {
  if (!activeRow.value) return
  const result = confirmDefectCount(Number(activeRow.value.id), defectForm.value, session.operator)
  flash(result)
  if (result.ok) {
    closeModal()
    reload()
  }
}

function openDeadline(row: AuditRow) {
  activeRow.value = row
  deadlineForm.value = String(row.整改期限 ?? '')
  modal.value = 'deadline'
}

function submitDeadline(entry: string) {
  if (!activeRow.value) return
  const result = updateDeadline(Number(activeRow.value.id), deadlineForm.value, entry, session.operator)
  flash(result)
  if (result.ok) {
    closeModal()
    reload()
  }
}

function openArchive(row: AuditRow) {
  activeRow.value = row
  modal.value = 'archive'
}

function openAction(action: string, row: AuditRow) {
  activeRow.value = row
  actionForm.整改期限 = String(row.整改期限 ?? '')
  actionForm.审计结论 = String(row.审计结论 ?? '')
  if (['提交审计', '提交整改', '送交复核'].includes(action)) {
    // 无额外表单的动作直接执行；复核幂等、跳级拒收由服务层兜底。
    submitAdvance(action)
    return
  }
  modal.value = `action-${action}`
}

function submitAdvance(action: string) {
  if (!activeRow.value) return
  const result = advanceAudit(Number(activeRow.value.id), {
    action,
    整改期限: actionForm.整改期限,
    审计结论: actionForm.审计结论,
    复核人: session.operator,
    操作人: session.operator,
  })
  flash(result)
  if (result.ok) {
    closeModal()
    reload()
  }
}

onMounted(reload)
</script>
