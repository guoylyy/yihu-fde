<template>
  <div class="projects-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">{{ $t('common.projects') }}</h2>
        <p class="hint">{{ $t('projects.active_projects_in_progress_healthy', { p0: stats.total, p1: inProgressCount, p2: greenCount }) }}<template v-if="acceptedCount"> {{ $t('projects.accepted_hidden_by_default_filter_by', { p0: acceptedCount }) }}</template><template v-if="stats.archived"> {{ $t('projects.archived', { p0: stats.archived }) }}</template></p>
      </div>
      <!-- 2026-07-31: 卡片/列表双视图, 默认卡片(封面图提升项目辨识度) -->
      <el-radio-group v-model="viewMode" @change="saveViewMode">
        <el-radio-button value="card">{{ $t('projects.cards') }}</el-radio-button>
        <el-radio-button value="list">{{ $t('common.list') }}</el-radio-button>
      </el-radio-group>
      <el-button v-if="can('project.create')" type="primary" @click="openCreate"><el-icon><Plus /></el-icon>{{ $t('projects.new_project') }}</el-button>
      <el-button type="success" @click="exportExcel"><el-icon><Download /></el-icon>{{ $t('common.export_excel') }}</el-button>
    </div>

    <el-card shadow="never" class="filter-card" :class="{ 'mobile-filter-collapsed': filterCollapsed }">
      <el-button class="filter-toggle mobile-only" text size="small" @click="filterCollapsed = !filterCollapsed">
        {{ $t('common.p0', { p0: filterCollapsed ? $t('common.show_filters') : $t('common.hide_filters') }) }}
      </el-button>
      <el-form :inline="true" @submit.prevent>
        <el-form-item :label="$t('common.search')">
          <el-input v-model="filters.keyword" :placeholder="$t('projects.project_name_code')" clearable @keyup.enter="loadList" />
        </el-form-item>
        <el-form-item :label="$t('common.status')">
          <el-select v-model="filters.status" :placeholder="$t('common.all')" clearable style="width: 130px;" :disabled="showArchived">
            <el-option v-for="s in statusOptions" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
        </el-form-item>
        <!-- v2.5.5(#915): 已关闭/已取消项目默认不进列表, 勾选后只看归档 -->
        <el-form-item>
          <el-checkbox v-model="showArchived" @change="onArchivedChange">{{ $t('projects.view_archived') }}</el-checkbox>
        </el-form-item>
        <el-form-item :label="$t('projects.activity')">
          <el-select v-model="filters.activity" :placeholder="$t('common.all')" clearable style="width: 120px;">
            <el-option :label="$t('projects.active')" value="HIGH" />
            <el-option :label="$t('projects.normal')" value="MEDIUM" />
            <el-option :label="$t('projects.low')" value="LOW" />
            <el-option :label="$t('projects.dormant')" value="IDLE" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('common.health')">
          <el-select v-model="filters.health" :placeholder="$t('common.all')" clearable style="width: 120px;">
            <el-option :label="$t('common.healthy')" value="GREEN" />
            <el-option :label="$t('common.note')" value="YELLOW" />
            <el-option :label="$t('common.risks')" value="RED" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('common.owner')">
          <el-select v-model="filters.manager_id" :placeholder="$t('common.all')" clearable filterable style="width: 150px;">
            <el-option v-for="u in userOptions" :key="u.id" :label="u.name" :value="Number(u.id)" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadList">{{ $t('common.search_2') }}</el-button>
          <el-button @click="resetFilters">{{ $t('common.reset') }}</el-button>
        </el-form-item>
      </el-form>
    </el-card>

    <!-- 卡片视图（默认）: 封面图为背景, 无封面按项目 id 轮换渐变底色; v2.0.8(#422) 置顶项目单独分区置顶 -->
    <div v-if="viewMode === 'card'" v-loading="loading" class="proj-grid-wrap">
      <template v-if="pinnedList.length">
        <div class="pin-section-title">{{ $t('projects.pinned_projects', { p0: pinnedList.length }) }}</div>
        <div class="proj-grid pinned-grid">
          <div v-for="row in pinnedList" :key="'pin-' + row.id" class="proj-card pinned-card" @click="goDetail(row)">
            <div class="card-cover" :style="coverStyle(row)">
              <div class="cover-top">
                <el-tag :type="statusType(row.status)" size="small" effect="dark">{{ statusLabel(row.status) }}</el-tag>
                <span class="cover-badges">
                  <span class="cover-pin" :title="$t('projects.click_unpin')" @click.stop="togglePin(row)">📌</span>
                  <span class="cover-activity">{{ activityTag(row.activityScore).label }} {{ row.activityScore }}</span>
                  <span v-if="row.autoHealth && row.autoHealth.light !== 'GREEN'" class="cover-health">{{ row.autoHealth.light === 'RED' ? '🔴' : '🟡' }}</span>
                </span>
              </div>
              <div class="cover-bottom">
                <div class="cover-name" :title="row.name">{{ row.name }}</div>
                <code class="cover-code">{{ row.code }}</code>
              </div>
            </div>
            <div class="card-body">
              <div class="meta-line">
                <span class="meta-item" :title="row.customer?.name">{{ row.customer?.shortName || row.customer?.name || '—' }}</span>
                <span v-if="row.manager?.name" class="meta-item">{{ $t('projects.owner', { p0: row.manager.name }) }}</span>
              </div>
              <div class="progress-line">
                <el-progress :percentage="row.progress" :stroke-width="6" :show-text="false" style="flex: 1;" />
                <span class="progress-num">{{ row.progress }}%</span>
              </div>
              <div class="card-foot">
                <div class="members-line">
                  <span class="more-members">{{ $t('common.p0', { p0: row.members && row.members.length ? $t('projects.members', { p0: row.members.length }) : $t('common.no_members') }) }}</span>
                </div>
                <div class="card-actions" @click.stop>
                  <el-button v-if="can('project.edit')" size="small" link type="primary" @click="openEdit(row)">{{ $t('common.edit') }}</el-button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
      <div v-if="pinnedList.length" class="pin-section-title rest-title">{{ $t('common.all_projects') }}</div>
      <div class="proj-grid">
        <div v-for="row in restList" :key="row.id" class="proj-card" @click="goDetail(row)">
          <div class="card-cover" :style="coverStyle(row)">
            <div class="cover-top">
              <el-tag :type="statusType(row.status)" size="small" effect="dark">{{ statusLabel(row.status) }}</el-tag>
              <span class="cover-badges">
                <span class="cover-pin cover-pin-dim" :title="$t('common.pin')" @click.stop="togglePin(row)">📍</span>
                <span class="cover-activity">{{ activityTag(row.activityScore).label }} {{ row.activityScore }}</span>
                <span v-if="row.autoHealth && row.autoHealth.light !== 'GREEN'" class="cover-health">{{ row.autoHealth.light === 'RED' ? '🔴' : '🟡' }}</span>
              </span>
            </div>
            <div class="cover-bottom">
              <div class="cover-name" :title="row.name">{{ row.name }}</div>
              <code class="cover-code">{{ row.code }}</code>
            </div>
          </div>
          <div class="card-body">
            <div class="meta-line">
              <span class="meta-item" :title="row.customer?.name">{{ row.customer?.shortName || row.customer?.name || '—' }}</span>
              <span v-if="row.manager?.name" class="meta-item">{{ $t('projects.owner', { p0: row.manager.name }) }}</span>
            </div>
            <div class="progress-line">
              <el-progress :percentage="row.progress" :stroke-width="6" :show-text="false" style="flex: 1;" />
              <span class="progress-num">{{ row.progress }}%</span>
            </div>
            <div class="card-foot">
              <div class="members-line">
                <span class="more-members">{{ $t('common.p0', { p0: row.members && row.members.length ? $t('projects.members', { p0: row.members.length }) : $t('common.no_members') }) }}</span>
              </div>
              <!-- 2026-07-31: 删除属敏感操作, 入口收进项目主页「项目概览」弹窗(需输入 delete 确认) -->
              <div class="card-actions" @click.stop>
                <el-button v-if="can('project.edit')" size="small" link type="primary" @click="openEdit(row)">{{ $t('common.edit') }}</el-button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <el-empty v-if="!list.length && !loading" :description="$t('projects.no_projects')" :image-size="100" />
    </div>

    <el-card v-else shadow="never" class="table-card">
      <div v-if="pinnedList.length" class="pin-section-title">{{ $t('projects.pinned_projects_2', { p0: pinnedList.length, p1: pinnedList.map(p => p.name).join($t('common.list_sep')) }) }}</div>
      <el-table :data="list" v-loading="loading" stripe :row-class-name="pinRowClass" @row-click="goDetail">
        <el-table-column label="" width="44" align="center">
          <template #default="{ row }">
            <span :class="row.pinned ? 'cover-pin' : 'cover-pin cover-pin-dim'" :title="row.pinned ? $t('common.unpin') : $t('common.pin')" @click.stop="togglePin(row)">{{ row.pinned ? '📌' : '📍' }}</span>
          </template>
        </el-table-column>
        <el-table-column prop="code" :label="$t('projects.project_code')" width="160">
          <template #default="{ row }">
            <code style="font-size: 12px; color: rgba(28, 25, 23,0.6);">{{ row.code }}</code>
          </template>
        </el-table-column>
        <el-table-column prop="name" :label="$t('common.project_name')" min-width="220">
          <template #default="{ row }">
            {{ row.name }} <el-tag v-if="row.pinned" size="small" effect="plain" type="warning" style="margin-left: 4px;">{{ $t('common.pin') }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.customer')" min-width="160">
          <template #default="{ row }">{{ row.customer?.shortName || row.customer?.name || '—' }}</template>
        </el-table-column>
        <el-table-column :label="$t('common.project_owner')" min-width="130">
          <template #default="{ row }">
            <span v-if="row.manager?.name">{{ row.manager.name }}</span>
            <span v-else style="color:#bbb;">—</span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.status')" width="110">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)" effect="light" size="small">{{ statusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <!-- v1.4.x: 项目活跃度(Repo 数量+提交频率自动评分, 列表默认按此排序) -->
        <el-table-column :label="$t('projects.activity')" width="100" align="center">
          <template #default="{ row }">
            <el-tooltip placement="top">
              <template #content>
                <div style="line-height: 1.8;">
                  {{ $t('common.score_100_code_business', { p0: row.activityScore, p1: row.activityMeta?.codeScore ?? '—', p2: row.activityMeta?.bizScore ?? '—' }) }}<br>
                  {{ $t('common.repositories_commits_in_7d_in_30d', { p0: row.activityMeta?.repoCount ?? 0, p1: row.activityMeta?.commits7 ?? 0, p2: row.activityMeta?.commits30 ?? 0, p3: row.activityMeta?.lastCommitAt ? String(row.activityMeta.lastCommitAt).slice(0, 10) : $t('common.none') }) }}<br>
                  {{ $t('common.last_30_days_task_updates_milestones', { p0: row.activityMeta?.tasks30 ?? 0, p1: row.activityMeta?.milestones30 ?? 0, p2: row.activityMeta?.issues30 ?? 0, p3: row.activityMeta?.timesheetDays30 ?? 0, p4: row.activityMeta?.delivFb30 ?? 0 }) }}
                </div>
              </template>
              <el-tag :type="activityTag(row.activityScore).type" size="small" effect="light">
                {{ activityTag(row.activityScore).label }} {{ row.activityScore }}
              </el-tag>
            </el-tooltip>
          </template>
        </el-table-column>
        <!-- v1.3.0: 交付健康度自动红绿灯(四信号: 工时超投/里程碑延期/问题积压/长期无提交) -->
        <el-table-column :label="$t('common.health')" width="100" align="center">
          <template #default="{ row }">
            <el-tooltip v-if="row.autoHealth" placement="top" :disabled="!row.autoHealth.signals.length">
              <template #content>
                <div v-for="s in row.autoHealth.signals" :key="s.key" style="max-width: 320px; line-height: 1.6;">
                  {{ s.level === 'RED' ? '🔴' : '🟡' }} {{ s.label }}: {{ s.detail }}
                </div>
              </template>
              <span :style="{ color: healthColor(row.autoHealth.light), cursor: row.autoHealth.signals.length ? 'help' : 'default' }">
                {{ healthIcon(row.autoHealth.light) }}{{ row.autoHealth.signals.length ? ` (${row.autoHealth.signals.length})` : '' }}
              </span>
            </el-tooltip>
            <span v-else style="color:#bbb;">—</span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.progress')" width="160">
          <template #default="{ row }">
            <el-progress :percentage="row.progress" :stroke-width="6" :show-text="false" />
            <span style="font-size: 12px; margin-left: 8px;">{{ row.progress }}%</span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.start_date')" width="110" align="center">
          <template #default="{ row }">{{ row.startDate ? formatDate(row.startDate) : '—' }}</template>
        </el-table-column>
        <el-table-column :label="$t('common.members')" width="80" align="center">
          <template #default="{ row }">
            <span v-if="row.members && row.members.length">{{ $t('projects.people', { p0: row.members.length }) }}</span>
            <span v-else style="color:#bbb;">—</span>
          </template>
        </el-table-column>
        <el-table-column :label="$t('common.actions')" width="90" fixed="right">
          <template #default="{ row }">
            <el-button v-if="can('project.edit')" size="small" link type="primary" @click.stop="openEdit(row)">{{ $t('common.edit') }}</el-button>
          </template>
        </el-table-column>
      </el-table>

    </el-card>

    <el-pagination
      v-model:current-page="pagination.page"
      v-model:page-size="pagination.page_size"
      :total="pagination.total"
      :page-sizes="[10, 20, 50]"
      layout="total, sizes, prev, pager, next, jumper"
      @current-change="loadList"
      @size-change="loadList"
      class="proj-pagination"
      style="margin-top: 16px; justify-content: flex-end;"
    />

    <!-- 新建/编辑弹窗 -->
    <el-dialog v-model="formVisible" :title="formMode === 'create' ? $t('projects.new_project') : $t('projects.edit_project')" width="720px" @closed="resetForm">
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-alert type="info" :closable="false" style="margin-bottom: 16px;">
          {{ $t('projects.project_codes_generated_automatically') }}<strong>{{ $t('projects.prefix_year_sequence') }}</strong>{{ $t('projects.e_g_prj_2026_0001_set') }}
        </el-alert>
        <el-form-item :label="$t('common.project_name')" prop="name">
          <el-input v-model="form.name" :placeholder="$t('projects.e_g_acme_digital_upgrade')" />
        </el-form-item>
        <el-form-item :label="$t('common.customer')" prop="customerId">
          <el-select v-model="form.customerId" :disabled="formMode === 'edit'" :placeholder="$t('projects.choose_customer')" filterable style="width: 100%;">
            <el-option v-for="c in customerOptions" :key="c.id" :label="`${c.name} (${c.shortName || c.industry || '—'})`" :value="Number(c.id)" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('common.project_owner')">
          <el-select v-model="form.managerId" :placeholder="$t('projects.choose_owner')" filterable clearable style="width: 100%;">
            <el-option v-for="u in userOptions" :key="u.id" :label="`${u.name} (${roleLabel(u.role)})`" :value="Number(u.id)" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('common.type')">
          <el-select v-model="form.type" :placeholder="$t('projects.choose_type')" clearable style="width: 100%;">
            <el-option :label="$t('common.new')" value="NEW" />
            <el-option :label="$t('common.upgrade')" value="UPGRADE" />
            <el-option :label="$t('common.ops')" value="MAINTENANCE" />
            <el-option :label="$t('common.training')" value="TRAINING" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('common.status')">
          <el-select v-model="form.status" :placeholder="$t('projects.choose_status')" style="width: 100%;">
            <el-option v-for="s in statusOptions" :key="s.value" :label="s.label" :value="s.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('common.health')">
          <el-radio-group v-model="form.health">
            <el-radio-button label="GREEN">{{ $t('common.healthy') }}</el-radio-button>
            <el-radio-button label="YELLOW">{{ $t('common.note') }}</el-radio-button>
            <el-radio-button label="RED">{{ $t('common.risks') }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="$t('common.progress')">
          <el-slider v-model="form.progress" :min="0" :max="100" show-input :show-input-controls="false" />
        </el-form-item>
        <el-form-item :label="$t('projects.dates')">
          <el-date-picker v-model="form.dateRange" type="daterange" value-format="YYYY-MM-DD" range-separator="~" :start-placeholder="$t('common.start')" :end-placeholder="$t('common.end')" style="width: 100%;" />
        </el-form-item>
        <el-form-item :label="$t('common.project_description')">
          <el-input v-model="form.description" type="textarea" :rows="3" />
        </el-form-item>
        <!-- 2026-07-31: 卡片封面图, 列表卡片视图的背景; 内置 10 张抽象油画风预设, 也可自传图片 -->
        <el-form-item :label="$t('projects.card_cover')">
          <div class="cover-uploader">
            <div class="preset-grid">
              <div
                v-for="p in COVER_PRESETS" :key="p.url"
                class="preset-item" :class="{ active: form.coverImage === p.url }"
                :style="{ backgroundImage: `url('${p.url}')` }" :title="p.name"
                @click="form.coverImage = form.coverImage === p.url ? '' : p.url"
              >
                <span class="preset-name">{{ p.name }}</span>
              </div>
            </div>
            <div v-if="form.coverImage && !isPresetCover(form.coverImage)" class="cover-preview" :style="{ backgroundImage: `url('${form.coverImage}')` }" />
            <div class="cover-upload-actions">
              <el-upload :http-request="handleCoverUpload" :show-file-list="false" accept="image/*">
                <el-button size="small" :loading="coverUploading">{{ $t('projects.upload_custom') }}</el-button>
              </el-upload>
              <el-button v-if="form.coverImage" size="small" type="danger" plain @click="form.coverImage = ''">{{ $t('projects.remove_cover') }}</el-button>
            </div>
            <span class="cover-hint">{{ $t('projects.click_preset_use_it_click_again') }}</span>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="formVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">{{ $t('common.ok') }}</el-button>
      </template>
    </el-dialog>

  </div>
</template>

<script setup>
import { withBase } from '@/utils/base.js'
import { $t } from '@/i18n'
import { ref, reactive, computed, onMounted } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { Plus, Download } from '@element-plus/icons-vue'
import { ElMessage } from 'element-plus'
import { fde, formatMoney, formatDate } from '@/api/index.js'
import { can } from '@/api/permissions.js'

const list = ref([])
// v2.0.8(#422): 置顶项目分组 —— pinned 排前, 同组内保持原排序(活跃度); 卡片视图分区展示, 列表视图标.tag
const pinnedList = computed(() => list.value.filter(p => p.pinned))
const restList = computed(() => list.value.filter(p => !p.pinned))
const stats = ref({ total: 0, byStatus: [], byHealth: [] })
const router = useRouter()
const loading = ref(false)
// H5(#1250): 手机上筛选区默认折叠
const filterCollapsed = ref(true)
const filters = reactive({ keyword: '', status: '', health: '', manager_id: null, activity: '' })
// v2.5.5(#914) 筛选 ↔ URL 双向同步(刷新/返回不丢)
const route = useRoute()
function filtersToQuery() {
  const q = {}
  for (const k of ['keyword', 'status', 'health', 'activity']) if (filters[k]) q[k] = filters[k]
  if (filters.manager_id) q.manager_id = String(filters.manager_id)
  if (showArchived.value) q.archived = '1'
  return q
}
function applyQueryToFilters() {
  const q = route.query
  for (const k of ['keyword', 'status', 'health', 'activity']) if (q[k]) filters[k] = String(q[k])
  if (q.manager_id) filters.manager_id = Number(q.manager_id)
  if (q.archived === '1') showArchived.value = true
}
// v2.5.5(#915) 归档视图开关: 开=只看 CLOSED/CANCELLED(状态筛选禁用), 关=默认在管列表
const showArchived = ref(false)
function onArchivedChange() { if (showArchived.value) filters.status = ''; pagination.page = 1; loadList() }
const pagination = reactive({ page: 1, page_size: 20, total: 0 })
const customerOptions = ref([])
const userOptions = ref([])

import { roleLabel } from '@/api/roles.js'  // v1.3.2 动态角色

const statusOptions = [
  { value: 'PROPOSAL', label: $t('common.proposal') },
  { value: 'APPROVED', label: $t('common.approved') },
  { value: 'IN_PROGRESS', label: $t('common.in_progress') },
  { value: 'ACCEPTED', label: $t('common.accepted') },
  { value: 'CLOSED', label: $t('common.closed') },
  { value: 'CANCELLED', label: $t('common.cancelled') }
]

const inProgressCount = computed(() => stats.value.byStatus.find(s => s.status === 'IN_PROGRESS')?.count || 0)
const acceptedCount = computed(() => stats.value.byStatus.find(s => s.status === 'ACCEPTED')?.count || 0)
const greenCount = computed(() => stats.value.byHealth.find(h => h.health === 'GREEN')?.count || 0)

// 2026-07-31: 卡片/列表双视图, 默认卡片; 选择本地缓存
const VIEW_MODE_KEY = 'fde_projects_view_mode'
const viewMode = ref(localStorage.getItem(VIEW_MODE_KEY) || 'card')
function saveViewMode() { localStorage.setItem(VIEW_MODE_KEY, viewMode.value) }

// 无封面时按项目 id 轮换渐变底色, 保证卡片间也有区分度
const COVER_GRADIENTS = [
  'linear-gradient(135deg, #d2521e, #7c2d12)',
  'linear-gradient(135deg, #2e7d4f, #14532d)',
  'linear-gradient(135deg, #3a5ba0, #1e3a5f)',
  'linear-gradient(135deg, #7c4dab, #4c1d6e)',
  'linear-gradient(135deg, #a03a62, #6b1e3f)',
  'linear-gradient(135deg, #2f6d80, #164e5f)'
]
function coverStyle(row) {
  if (row.coverImage) {
    // 深色渐变遮罩压住图片, 保证白字可读
    return { backgroundImage: `linear-gradient(180deg, rgba(20, 16, 14, 0.25), rgba(20, 16, 14, 0.65)), url('${row.coverImage}')` }
  }
  return { backgroundImage: COVER_GRADIENTS[Number(row.id) % COVER_GRADIENTS.length] }
}

const formVisible = ref(false)
const formMode = ref('create')
const submitting = ref(false)
const formRef = ref()
const form = reactive({
  id: null, name: '', customerId: null, managerId: null, type: 'NEW', status: 'PROPOSAL',
  health: 'GREEN', progress: 0, dateRange: [], budget: 0, description: '', coverImage: ''
})

// 内置抽象油画风预设封面 (frontend/public/covers/, scratchpad gen-covers.mjs 生成)
const COVER_PRESETS = [
  { name: $t('projects.molten_gold'), url: withBase('/covers/preset-01.svg') },
  { name: $t('projects.deep_sea'), url: withBase('/covers/preset-02.svg') },
  { name: $t('projects.ink_hills'), url: withBase('/covers/preset-03.svg') },
  { name: $t('projects.violet_night'), url: withBase('/covers/preset-04.svg') },
  { name: $t('projects.crimson'), url: withBase('/covers/preset-05.svg') },
  { name: $t('projects.tundra'), url: withBase('/covers/preset-06.svg') },
  { name: $t('projects.starry_night'), url: withBase('/covers/preset-07.svg') },
  { name: $t('projects.coral'), url: withBase('/covers/preset-08.svg') },
  { name: $t('projects.jade'), url: withBase('/covers/preset-09.svg') },
  { name: $t('projects.mist'), url: withBase('/covers/preset-10.svg') }
]
function isPresetCover(url) { return COVER_PRESETS.some(p => p.url === url) }

// 封面上传: 走既有七牛上传接口
const coverUploading = ref(false)
async function handleCoverUpload({ file }) {
  coverUploading.value = true
  try {
    const fd = new FormData()
    fd.append('file', file)
    const r = await fde.uploads.upload(fd)
    if (r.code !== 0) throw new Error(r.message || $t('common.upload_failed'))
    form.coverImage = r.data.url
  } catch (e) { ElMessage.error(e.message || $t('common.upload_failed')) }
  finally { coverUploading.value = false }
}
const rules = {
  name: [{ required: true, message: $t('projects.project_name_required'), trigger: 'blur' }],
  customerId: [{ required: true, message: $t('projects.customer_required'), trigger: 'change' }]
}

// v2.0.8(#422): 置顶/取消置顶(本人维度), 成功后就地更新行内 pinned, 不整页重拉
async function togglePin(row) {
  try {
    const data = await fde.projects.pin(row.id)
    row.pinned = !!data.pinned
    ElMessage.success(data.pinned ? $t('projects.pinned_project_shown_at_top') : $t('common.unpinned'))
  } catch (e) { console.warn(e) }
}
// 列表视图置顶行高亮
function pinRowClass({ row }) { return row.pinned ? 'pinned-row' : '' }

async function loadList() {
  loading.value = true
  filterCollapsed.value = true   // H5: 手机查询后自动收起(桌面不受影响)
  try {
    const params = { ...filters, page: pagination.page, page_size: pagination.page_size }
    Object.keys(params).forEach(k => { if (!params[k]) delete params[k] })
    // 未明确筛选状态时默认隐藏已验收项目, 需要时在状态筛选里选「已验收」; 归档态(已关闭/已取消)后端默认排除
    if (showArchived.value) params.archived = 'true'
    else if (!params.status) params.exclude_status = 'ACCEPTED'
    const q = filtersToQuery()
    if (JSON.stringify({ ...route.query }) !== JSON.stringify(q)) router.replace({ path: route.path, query: q })
    const data = await fde.projects.list(params)
    list.value = data.list
    pagination.total = data.total
  } finally { loading.value = false }
}

async function loadStats() {
  try { stats.value = await fde.projects.stats() } catch (e) { console.warn(e) }
}

async function loadCustomers() {
  // v1.6.2: 无权限的角色(工程师)不再硬拉——此前每次进页面必产生一个 403
  if (!can('customer.view')) return
  try {
    const data = await fde.customers.list({ page_size: 100 })
    customerOptions.value = data.list
  } catch (e) { console.warn(e) }
}

async function loadUsers() {
  if (!can('project.manageMembers')) return
  try {
    userOptions.value = await fde.projects.availableUsers()
  } catch (e) { console.warn(e) }
}

// 项目主页（独立页面）
function goDetail(row) {
  router.push(`/admin/projects/${row.id}`)
}

function resetFilters() {
  filters.keyword = ''
  filters.status = ''
  filters.health = ''
  filters.manager_id = null
  filters.activity = ''
  showArchived.value = false
  pagination.page = 1
  loadStats()
  loadList()
}

function resetForm() {
  Object.assign(form, {
    id: null, name: '', customerId: null, managerId: null, templateId: null, type: 'NEW', status: 'PROPOSAL',
    health: 'GREEN', progress: 0, dateRange: [], budget: 0, description: '', coverImage: ''
  })
  formRef.value?.clearValidate()
}

function openCreate() {
  formMode.value = 'create'
  resetForm()
  formVisible.value = true
  if (!customerOptions.value.length) loadCustomers()
  if (!userOptions.value.length) loadUsers()
}

function openEdit(row) {
  formMode.value = 'edit'
  resetForm()
  form.id = row.id
  form.name = row.name
  form.customerId = Number(row.customerId)
  form.managerId = row.manager?.id ? Number(row.manager.id) : null
  form.type = row.type || 'NEW'
  form.status = row.status
  form.health = row.health || 'GREEN'
  form.progress = row.progress
  form.dateRange = row.startDate && row.endDate ? [formatDate(row.startDate), formatDate(row.endDate)] : []
  form.budget = Number(row.budget || 0)
  form.description = row.description || ''
  form.coverImage = row.coverImage || ''
  formVisible.value = true
  if (!customerOptions.value.length) loadCustomers()
  if (!userOptions.value.length) loadUsers()
}

async function handleSubmit() {
  try { await formRef.value.validate() } catch { return }
  submitting.value = true
  try {
    const payload = {
      name: form.name, customerId: form.customerId,
      managerId: form.managerId || null,
      type: form.type, status: form.status, health: form.health, progress: form.progress,
      startDate: form.dateRange?.[0] || null,
      endDate: form.dateRange?.[1] || null,
      budget: form.budget,
      description: form.description || null,
      coverImage: form.coverImage || null
    }
    if (formMode.value === 'create') {
      await fde.projects.create(payload)
      ElMessage.success($t('projects.project_created'))
    } else {
      await fde.projects.update(form.id, payload)
      ElMessage.success($t('projects.project_updated'))
    }
    formVisible.value = false
    loadList()
    loadStats()
  } catch (e) {
    ElMessage.error(e.message || $t('common.save_failed'))
  } finally { submitting.value = false }
}

function statusType(s) { return { DRAFT: 'info', PROPOSAL: 'warning', APPROVED: 'primary', IN_PROGRESS: 'success', ACCEPTED: 'success', CLOSED: 'info', CANCELLED: 'danger' }[s] || 'info' }
function statusLabel(s) { return { DRAFT: $t('common.draft'), PROPOSAL: $t('common.proposal'), APPROVED: $t('common.approved'), IN_PROGRESS: $t('common.in_progress'), ACCEPTED: $t('common.accepted'), CLOSED: $t('common.closed'), CANCELLED: $t('common.cancelled') }[s] || s }
function healthIcon(h) { return { GREEN: $t('common.healthy'), YELLOW: $t('common.note'), RED: $t('common.risks') }[h] || '—' }
// v1.4.x 活跃度档位: ≥60 活跃 / 30-59 一般 / 1-29 低频 / 0 沉寂
function activityTag(score) {
  if (score >= 60) return { label: '🔥', type: 'danger' }
  if (score >= 30) return { label: '⚙️', type: 'warning' }
  if (score >= 1) return { label: '🐢', type: 'info' }
  return { label: '💤', type: 'info' }
}
function healthColor(h) { return { GREEN: '#2e7d4f', YELLOW: '#b3450f', RED: '#c2362b' }[h] || '#909399' }

import { downloadExcel } from '@/api/excel.js'
function exportExcel() {
  const params = { ...filters }
  Object.keys(params).forEach(k => { if (!params[k]) delete params[k] })
  // 与列表视图一致: 未选状态时导出也不含已验收
  if (!params.status) params.exclude_status = 'ACCEPTED'
  downloadExcel(fde.reports.projects(params), $t('projects.projects_xlsx', { p0: new Date().toISOString().slice(0, 10) }))
}

onMounted(() => { applyQueryToFilters(); loadList(); loadStats(); loadCustomers(); loadUsers() })
</script>

<style scoped>
.page-header { display: flex; align-items: flex-end; gap: 12px; margin-bottom: 16px; }
/* v1.2.9: 信息块占满左侧, 新建/导出等按钮统一靠最右 */
.page-header > :first-child { margin-right: auto; }
.page-title { font-size: 22px; font-weight: 700; margin-bottom: 4px; }
.hint { font-size: 13px; color: rgba(28, 25, 23, 0.6); }
.filter-card, .table-card { background: white; border: 1px solid rgba(28, 25, 23, 0.1); margin-bottom: 16px; }
:deep(.el-table__row) { cursor: pointer; }
/* v1.2.8: 行 hover 色收编进全局主题(element-vi.css), 半透明覆盖会让 fixed 列透出下层内容 */

/* 2026-07-31: 卡片视图 —— 封面图背景 + 渐变遮罩, 提升项目辨识度 */
.proj-grid-wrap { min-height: 200px; }
.proj-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 16px; }
.proj-card {
  background: white;
  border: 1px solid rgba(28, 25, 23, 0.1);
  border-radius: 12px;
  overflow: hidden;
  cursor: pointer;
  transition: all 0.2s;
}
.proj-card:hover { border-color: #d2521e; box-shadow: 0 6px 18px rgba(210, 82, 30, 0.12); transform: translateY(-2px); }
.card-cover {
  height: 124px;
  background-size: cover;
  background-position: center;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  color: white;
}
.cover-top { display: flex; justify-content: space-between; align-items: center; }
.cover-badges { display: flex; align-items: center; gap: 6px; }
.cover-activity {
  font-size: 12px;
  background: rgba(0, 0, 0, 0.35);
  padding: 1px 8px;
  border-radius: 10px;
}
.cover-name {
  font-size: 16px;
  font-weight: 700;
  line-height: 1.35;
  text-shadow: 0 1px 4px rgba(0, 0, 0, 0.45);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.cover-code { font-size: 11px; opacity: 0.85; text-shadow: 0 1px 3px rgba(0, 0, 0, 0.45); }
.card-body { padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.meta-line { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; color: #57534e; }
.meta-line .meta-item { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.progress-line { display: flex; align-items: center; gap: 8px; }
.progress-num { font-size: 12px; color: #57534e; width: 36px; text-align: right; }
.card-foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.members-line { display: flex; align-items: center; gap: 4px; overflow: hidden; }
.more-members { font-size: 12px; color: #a8a29e; white-space: nowrap; }
.card-actions { display: flex; align-items: center; flex-shrink: 0; }

/* 编辑弹窗: 封面上传 */
.cover-uploader { display: flex; flex-direction: column; gap: 8px; width: 100%; }
.preset-grid { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; width: 100%; }
.preset-item {
  position: relative;
  aspect-ratio: 16 / 9;
  border-radius: 6px;
  background-size: cover;
  background-position: center;
  cursor: pointer;
  border: 2px solid transparent;
  transition: all 0.15s;
}
.preset-item:hover { transform: scale(1.04); }
.preset-item.active { border-color: #d2521e; box-shadow: 0 0 0 2px rgba(210, 82, 30, 0.25); }
.preset-name {
  position: absolute;
  left: 4px;
  bottom: 3px;
  font-size: 11px;
  color: white;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
}
.preset-item.active::after {
  content: '✓';
  position: absolute;
  right: 4px;
  top: 2px;
  color: white;
  font-size: 12px;
  font-weight: 700;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.6);
}
.cover-preview {
  width: 240px;
  height: 135px;
  border-radius: 8px;
  background-size: cover;
  background-position: center;
  border: 1px solid rgba(28, 25, 23, 0.1);
}
.cover-upload-actions { display: flex; gap: 8px; align-items: center; }
.cover-hint { font-size: 12px; color: #a8a29e; line-height: 1.5; }

/* v2.0.8(#422): 置顶分区与图钉操作 */
.pin-section-title { font-weight: 600; font-size: 13px; color: #b45309; margin: 4px 0 10px; display: flex; align-items: center; gap: 6px; }
.pin-section-title.rest-title { margin-top: 18px; color: #57534e; }
.pinned-grid .proj-card { outline: 2px solid rgba(217, 119, 6, 0.35); }
.cover-pin { cursor: pointer; font-size: 14px; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.4)); user-select: none; }
.cover-pin-dim { opacity: 0.55; transition: opacity 0.15s; }
.cover-pin-dim:hover { opacity: 1; transform: scale(1.15); }
:deep(.pinned-row) { background: #fffbeb !important; }
:deep(.pinned-row td) { background: #fffbeb !important; }

/* ===== H5 适配 (#1250) ===== */
@media (max-width: 767px) {
  /* 页头换行, 统计+操作按钮折成两行 */
  .page-header { flex-wrap: wrap; align-items: center; gap: 8px; }
  .page-header > :first-child { flex-basis: 100%; margin-right: 0; }
  .page-title { font-size: 19px; }
  /* 卡片网格单列(320px 阈值在 390 屏上本就一列, 窄屏防溢出显式收紧) */
  .proj-grid { grid-template-columns: 1fr; gap: 12px; }
  /* 筛选表单默认折叠, 点开才占屏; inline 表单项改占满一行 */
  .filter-card.mobile-filter-collapsed :deep(.el-form) { display: none; }
  .filter-card :deep(.el-form-item) { margin-right: 0; width: 100%; }
  .filter-card :deep(.el-form-item .el-select),
  .filter-card :deep(.el-form-item .el-input) { width: 100%; }
  .filter-toggle { width: 100%; text-align: left; }
  /* 分页精简: 只留页码 */
  .proj-pagination :deep(.el-pagination__sizes),
  .proj-pagination :deep(.el-pagination__jump),
  .proj-pagination :deep(.el-pagination__total) { display: none; }
}
</style>
