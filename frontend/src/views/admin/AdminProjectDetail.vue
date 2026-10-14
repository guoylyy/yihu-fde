<template>
  <div class="admin-project-detail">
    <el-page-header v-if="loading || !project" :icon="ArrowLeft" @back="goBack" style="margin-bottom: 16px;" />

    <el-skeleton v-if="loading" :rows="10" animated />

    <el-empty v-else-if="!project" :description="$t('projectDetail.project_doesnt_exist_or_you_cant')" :image-size="120">
      <el-button type="primary" @click="goBack">{{ $t('common.back') }}</el-button>
    </el-empty>

    <template v-else>
      <!-- ============ v2.8.1(#1148) 三栏布局: [全局侧栏] + 项目侧栏(信息/进展/栏目) + 内容栏 ============ -->
      <!-- 返回入口单独放在页顶一行(主人反馈: 和侧栏栏目挨着容易误触) -->
      <div class="pd-topbar">
        <el-button link class="pd-back" @click="goBack"><el-icon><ArrowLeft /></el-icon> {{ $t('projectDetail.back_projects') }}</el-button>
        <span class="pd-topbar-sep">/</span>
        <span class="pd-topbar-name">{{ project.name }}</span>
        <!-- H5(#1251): 手机上项目信息/导航栏收进侧边抽屉, 这里是唤出按钮 -->
        <el-button class="pd-side-open mobile-only" size="small" @click="pdSideOpen = true">
          <el-icon><Menu /></el-icon> {{ $t('projectDetail.project_sidebar') }}
        </el-button>
      </div>
      <!-- v2.12.0(#1259) 首屏总览条 -->
      <ProjectOverviewBar :project="project" :refresh-tick="overviewTick" @drill="onOverviewDrill" />
      <div class="pd-layout" :class="{ 'side-collapsed': pdSideCollapsed && !isMobile, 'pd-side-open': pdSideOpen }">
        <!-- 手机上点遮罩关闭 -->
        <div class="pd-side-mask mobile-only" @click="pdSideOpen = false"></div>
        <aside class="pd-side">
          <div class="pd-side-top">
            <code v-if="sideExpanded" class="pd-code">{{ project.code }}</code>
            <el-tooltip :content="pdSideCollapsed ? $t('projectDetail.expand_project_sidebar') : $t('projectDetail.collapse_project_sidebar')" placement="right">
              <el-button link class="pd-toggle" @click="togglePdSide"><el-icon><component :is="pdSideCollapsed ? Expand : Fold" /></el-icon></el-button>
            </el-tooltip>
          </div>

          <!-- 项目基本信息: 名称常驻; 标签/进度/指标默认折叠(主人反馈没必要一直占位), 点「详情」展开, 状态本机记忆 -->
          <div v-if="sideExpanded" class="pd-info">
            <h2 class="pd-name" :title="project.name">{{ project.name }}</h2>
            <div class="pd-brief">
              <el-tag :type="statusType(project.status)" effect="light" size="small">{{ statusLabel(project.status) }}</el-tag>
              <span class="pd-brief-text">{{ $t('projectDetail.progress_milestones_tasks', { p0: project.progress || 0, p1: milestoneDone, p2: project.milestones?.length || 0, p3: taskDone, p4: activeTasks.length }) }}</span>
              <el-button link size="small" class="pd-brief-toggle" @click="togglePdInfo">{{ $t('common.p0', { p0: pdInfoOpen ? $t('common.collapse') : $t('common.details') }) }} <el-icon><component :is="pdInfoOpen ? ArrowUp : ArrowDown" /></el-icon></el-button>
            </div>
            <div v-show="pdInfoOpen" class="pd-info-detail">
            <div class="pd-tags">
              <!-- v1.3.0: 交付健康度自动红绿灯(四信号), 非进行中项目回落手动标记 -->
              <el-tooltip v-if="project.autoHealth" placement="right" :disabled="!project.autoHealth.signals.length">
                <template #content>
                  <div v-for="sg in project.autoHealth.signals" :key="sg.key" style="max-width: 340px; line-height: 1.7;">
                    {{ sg.level === 'RED' ? '🔴' : '🟡' }} {{ sg.label }}: {{ sg.detail }}
                  </div>
                </template>
                <el-tag effect="plain" size="small">{{ healthIcon(project.autoHealth.light) }} {{ healthLabel(project.autoHealth.light) }}{{ project.autoHealth.signals.length ? ` · ${project.autoHealth.signals.length}` : '' }}</el-tag>
              </el-tooltip>
              <el-tag v-else effect="plain" size="small">{{ healthIcon(project.health) }} {{ healthLabel(project.health) }}</el-tag>
              <!-- 热度(活跃度评分), 悬停看计算明细(与项目列表同口径) -->
              <el-tooltip placement="right">
                <template #content>
                  <div style="line-height: 1.8;">
                    {{ $t('common.score_100_code_business', { p0: project.activityScore, p1: project.activityMeta?.codeScore ?? '—', p2: project.activityMeta?.bizScore ?? '—' }) }}<br>
                    {{ $t('common.repositories_commits_in_7d_in_30d', { p0: project.activityMeta?.repoCount ?? 0, p1: project.activityMeta?.commits7 ?? 0, p2: project.activityMeta?.commits30 ?? 0, p3: project.activityMeta?.lastCommitAt ? String(project.activityMeta.lastCommitAt).slice(0, 10) : $t('common.none') }) }}<br>
                    {{ $t('common.last_30_days_task_updates_milestones', { p0: project.activityMeta?.tasks30 ?? 0, p1: project.activityMeta?.milestones30 ?? 0, p2: project.activityMeta?.issues30 ?? 0, p3: project.activityMeta?.timesheetDays30 ?? 0, p4: project.activityMeta?.delivFb30 ?? 0 }) }}
                  </div>
                </template>
                <el-tag :type="activityTag(project.activityScore).type" size="small" effect="light" style="cursor: help;">{{ activityTag(project.activityScore).label }} {{ project.activityScore }}</el-tag>
              </el-tooltip>
              <el-tag effect="plain" size="small" type="info">{{ typeLabel(project.type) }}</el-tag>
            </div>
            <div v-if="project.manager?.name" class="pd-manager">{{ $t('common.owner') }} <b>{{ project.manager.name }}</b></div>
            <div class="pd-actions">
              <el-tooltip :content="$t('projectDetail.project_overview')" placement="top"><el-button size="small" circle :icon="DataBoard" @click="overviewVisible = true" /></el-tooltip>
              <el-tooltip :content="$t('projectDetail.project_members')" placement="top"><el-button size="small" circle :icon="User" @click="membersVisible = true" /></el-tooltip>
              <span class="pd-members-hint">{{ $t('projectDetail.active_members', { p0: activeMemberCount }) }}</span>
            </div>
            <div class="pd-progress">
              <div class="pd-progress-head"><span>{{ $t('common.project_progress') }}</span><b>{{ project.progress || 0 }}%</b></div>
              <el-progress :percentage="project.progress || 0" :stroke-width="8" :status="progressStatus" :show-text="false" />
            </div>
            <div class="pd-stats">
              <div class="pd-stat" @click="activeTab = 'milestones'"><div class="pd-stat-num">{{ milestoneDone }}/{{ project.milestones?.length || 0 }}</div><div class="pd-stat-label">{{ $t('common.milestone_2') }}</div></div>
              <div class="pd-stat" @click="activeTab = 'board'"><div class="pd-stat-num">{{ taskDone }}/{{ activeTasks.length }}</div><div class="pd-stat-label">{{ $t('projectDetail.task_completed') }}</div></div>
                <div class="pd-stat" @click="activeTab = 'records'"><div class="pd-stat-num">{{ rec.total }}</div><div class="pd-stat-label">{{ $t('projectDetail.meeting_records') }}</div></div>
            </div>
            </div>
          </div>

          <!-- 栏目(替代原顶部 Tab) -->
          <nav class="pd-nav">
            <div v-for="it in pdNavItems" :key="it.name" class="pd-nav-item" :class="{ active: activeTab === it.name }" :title="it.label" @click="activeTab = it.name">
              <el-icon><component :is="it.icon" /></el-icon>
              <span v-if="sideExpanded" class="pd-nav-label">{{ it.label }}</span>
              <span v-if="!pdSideCollapsed && it.count !== undefined && it.count !== ''" class="pd-nav-count">{{ it.count }}</span>
            </div>
          </nav>

          <!-- v2.0.0(#368) 交付工作流流水线: 开会→需求→任务→验收 -->
          <div v-if="wf && !pdSideCollapsed" class="pd-wf">
            <div class="pd-block-title">{{ $t('projectDetail.delivery_pipeline') }}</div>
            <div class="pd-wf-row" @click="activeTab = 'records'" :title="wf.meeting.latest ? $t('projectDetail.latest', { p0: wf.meeting.latest.title }) : $t('projectDetail.no_meeting_records_yet')"><span>{{ $t('projectDetail.meet') }}</span><b>{{ wf.meeting.count }}</b></div>
            <div class="pd-wf-row" @click="openReqPanel()"><span>{{ $t('projectDetail.requirements') }}</span><b>{{ wf.requirement.total }}<i>{{ $t('projectDetail.confirmed', { p0: wf.requirement.confirmed }) }}</i></b></div>
            <div class="pd-wf-row" @click="activeTab = 'board'"><span>{{ $t('projectDetail.build') }}</span><b>{{ wf.task.todo + wf.task.queued }}</b></div>
            <div class="pd-wf-row" @click="activeTab = 'board'"><span>{{ $t('projectDetail.in_progress') }}</span><b>{{ wf.task.inProgress }}</b></div>
            <div class="pd-wf-row" @click="activeTab = 'board'"><span>{{ $t('projectDetail.accept') }}</span><b>{{ wf.task.done }}</b></div>
            <div class="pd-wf-row" @click="activeTab = 'board'"><span>{{ $t('projectDetail.accepted') }}</span><b class="done">{{ wf.task.verified }}</b></div>
            <div v-if="wfWarnings.length" class="pd-wf-warn">
              <el-tag v-for="w in wfWarnings" :key="w.text" :type="w.type" effect="light" size="small" style="cursor: pointer; height: auto; white-space: normal; line-height: 1.4; padding: 3px 6px;" @click="w.go()">{{ w.text }}</el-tag>
            </div>
          </div>

          <!-- v2.1.6(#489) 客户联系卡 -->
          <div v-if="project.customer && !pdSideCollapsed" class="pd-contact">
            <div class="pd-block-title">📇 {{ project.customer.name }}</div>
            <template v-if="project.customer.contacts?.length">
              <div v-for="c in project.customer.contacts" :key="c.id" class="pd-contact-row">
                <b>{{ c.name }}</b><span v-if="c.isPrimary" class="contact-primary">{{ $t('common.primary') }}</span>
                <span v-if="c.title" class="contact-sub">{{ c.title }}</span>
                <span v-if="c.phone && c.phone !== '-'" class="contact-sub">📱{{ c.phone }}</span>
              </div>
            </template>
            <div v-else class="contact-empty">{{ $t('projectDetail.no_contacts') }}</div>
            <el-button v-if="can('customer.edit')" size="small" link type="primary" @click="openContactMgr">{{ $t('projectDetail.manage_contacts') }}</el-button>
          </div>
        </aside>

        <main class="pd-content">
          <el-alert v-if="isArchived" type="info" :closable="false" show-icon style="margin-bottom: 12px;">
            <template #title>
          {{ $t('projectDetail.this_project_was_archived', { p0: project.status === 'CANCELLED' ? $t('common.cancel') : $t('common.close') }) }}
          <template v-if="project.closedAt"> ({{ formatDate(project.closedAt) }}<template v-if="project.closedByName"> · {{ project.closedByName }}</template>)</template>
          <template v-if="project.closeReason">: {{ project.closeReason }}</template>
          {{ $t('projectDetail.it_no_longer_appears_in_default') }}
          <el-button v-if="can('project.edit')" link type="primary" :loading="archiving" @click="reopenProject" style="margin-left: 8px;">{{ $t('projectDetail.restore_as_active_project') }}</el-button>
            </template>
          </el-alert>
          <!-- 栏目内容: 仍用 el-tabs 承载(保留各 pane 的 lazy/keep-alive 行为), 只是把页签头藏掉, 由左侧 pd-nav 驱动 activeTab -->
          <el-tabs v-model="activeTab" class="pd-tabs">

          <!-- ---- v2.8.0(#1144) 规划: 里程碑路径图(默认首屏) —— 里程碑轨 + 任务 DAG + 侧栏; 看板/里程碑两个旧 Tab 保留一个版本周期 ---- -->
          <el-tab-pane name="roadmap">
            <template #label><el-icon><Guide /></el-icon> {{ $t('projectDetail.planning') }}</template>
            <RoadmapView
              ref="roadmapRef" :project-id="pid()" :can-edit="can('task.edit')" :can-change-status="can('task.changeStatus')" :can-ai="can('task.create')"
              :initial-milestone-id="String(route.query.milestone || '')"
              @open-task="id => openTaskDetail({ id })" @create-task="openTaskFromRoadmap" @edit-milestone="openMilestone" @create-milestone="openMilestone()"
              @go-board="goBoardFromRoadmap" @change-status="quickChange"
            />
          </el-tab-pane>

          <!-- ---- v1.4.x 项目记录(过程资料) ---- -->
          <el-tab-pane name="records">
            <!-- v1.9.6(#348): 主人拍板改名「会议记录」—— 所有项目需求的起点是会议 -->
            <template #label><el-icon><Notebook /></el-icon> {{ $t('projectDetail.meeting_records_2', { p0: rec.total }) }}</template>
            <!-- v2.0.1(#390): 去分类统一「会议记录」—— 移除类型筛选, 所有记录一条时间线 -->
            <div class="section-head">
              <span></span>
              <div style="display: flex; gap: 8px; align-items: center;">
                <el-button size="small" :icon="Refresh" @click="loadRecords()">{{ $t('common.refresh') }}</el-button>
                <!-- v1.9.8(#350): 需求清单入口(会议纪要梳理出的需求, badge=待确认数) -->
                <el-badge :value="reqPanel.draftCount" :hidden="!reqPanel.draftCount" class="req-badge">
                  <el-button size="small" plain @click="openReqPanel()">{{ $t('projectDetail.requirements_2') }}</el-button>
                </el-badge>
                <template v-if="can('projectRecord.create')">
                  <!-- v2.0.1(#388): 导入合并为一个入口, 点击弹上传窗(纪要文档/聊天记录导出都走 AI 识别) -->
                  <el-button size="small" type="primary" :icon="MagicStick" @click="importDialog.visible = true">{{ $t('projectDetail.ai_import_notes') }}</el-button>
                  <el-button size="small" type="primary" plain :icon="Plus" @click="openRecord()">{{ $t('projectDetail.add_record') }}</el-button>
                </template>
              </div>
            </div>
            <div v-loading="rec.loading">
              <el-timeline v-if="rec.list.length" style="padding-left: 4px; margin-top: 8px;">
                <el-timeline-item v-for="r in rec.list" :key="r.id" :timestamp="fmtRecTime(r.occurredAt)" placement="top"
                  :type="{ MEETING: 'primary', COMM: 'warning', SITE: 'success', FILE: 'info', CHAT: 'warning', RESEARCH: 'primary' }[r.type] || 'info'">
                  <div class="rec-item">
                    <div class="rec-head">
                      <!-- v2.0.1(#402): 去掉行首类型 Tag(全是「会议纪要」无区分意义, 详情弹窗仍显示) -->
                      <!-- v2.0.1(#400): 简洁列表, 点标题弹窗看全文/录音 -->
                      <strong class="rec-title-link" @click="openRecView(r)">{{ r.title }}</strong>
                      <!-- v1.6.0: Agent 沉淀的记录标注来源 -->
                      <el-tag v-if="r.agentName" size="small" type="warning" effect="light">🤖 {{ r.agentName }}</el-tag>
                      <span class="muted">{{ r.creatorName }}</span>
                      <span class="row-ops">
                        <!-- v1.9.8(#350): 有正文才能做 LLM 需求梳理 -->
                        <!-- v2.0.1(#384): 已梳理过的不再重复梳理, 改为直达该会议的需求清单 -->
                        <el-button v-if="r.content && can('projectRecord.create') && !r.requirements?.length" link size="small" type="primary" :loading="reqPanel.extractingId === r.id" @click="extractRecordRequirements(r)">{{ $t('projectDetail.extract_requirements') }}</el-button>
                        <el-button v-else-if="r.requirements?.length" link size="small" type="primary" @click="openReqPanel(r.id)">{{ $t('projectDetail.view_requirements') }}</el-button>
                        <el-button link size="small" @click="openRecView(r)">{{ $t('common.view') }}</el-button>
                        <el-button v-if="can('projectRecord.create')" link size="small" @click="openRecord(r)">{{ $t('common.edit') }}</el-button>
                        <el-popconfirm :title="$t('projectDetail.delete_this_record')" @confirm="removeRecord(r)">
                          <template #reference><el-button link size="small" type="danger">{{ $t('common.delete_2') }}</el-button></template>
                        </el-popconfirm>
                      </span>
                    </div>
                    <div v-if="r.attendees" class="muted" style="margin-top: 2px;">👥 {{ r.attendees }}</div>
                    <!-- v1.9.11(#360): 该纪要梳理出的需求/任务关联展示, 点摘要行展开明细 -->
                    <div v-if="r.requirements?.length" class="rec-reqs">
                      <div class="rec-reqs-summary" @click="toggleRecReqs(r.id)">
                        {{ $t('projectDetail.requirements_confirmed', { p0: r.requirements.length, p1: recReqConfirmed(r) }) }}
                        <template v-if="recReqTasks(r)">{{ $t('projectDetail.tasks', { p0: recReqTasks(r) }) }}</template>
                        <span class="muted" style="margin-left: 6px;">{{ $t('common.p0', { p0: expandedRecReqs.has(String(r.id)) ? $t('projectDetail.collapse') : $t('projectDetail.expand') }) }}</span>
                      </div>
                      <div v-if="expandedRecReqs.has(String(r.id))" class="rec-reqs-list">
                        <div v-for="q in r.requirements" :key="q.id" class="rec-req-row" :class="{ rejected: q.status === 'REJECTED' }">
                          <el-tag :type="reqStatusType(q.status)" size="small" effect="light">{{ reqStatusLabel(q.status) }}</el-tag>
                          <el-tag :type="priorityType(q.priority)" size="small" effect="plain">{{ priorityLabel(q.priority) }}</el-tag>
                          <span class="rec-req-title">{{ q.title }}</span>
                          <el-tag v-if="q.taskId" size="small" type="success" effect="plain" style="cursor: pointer;" @click.stop="openTaskDetail({ id: q.taskId })">{{ $t('projectDetail.task', { p0: q.taskId }) }}</el-tag>
                          <el-tag v-if="q.milestoneId" size="small" type="warning" effect="plain" style="cursor: pointer;" @click.stop="activeTab = 'milestones'">{{ $t('projectDetail.milestones') }}</el-tag>
                        </div>
                      </div>
                    </div>
                    <!-- v2.0.1(#400): 正文与附件不再全文平铺, 一行摘要提示, 详情进弹窗 -->
                    <div v-if="r.content || r.attachments?.length" class="rec-brief muted" @click="openRecView(r)">
                      <template v-if="r.content">📄 {{ recBrief(r) }}</template>
                      <template v-if="r.attachments?.length"> {{ $t('projectDetail.attachments', { p0: r.attachments.length }) }}</template>
                    </div>
                  </div>
                </el-timeline-item>
              </el-timeline>
              <el-alert v-else-if="rec.error" type="warning" show-icon :closable="false"
                        :title="rec.error" :description="$t('projectDetail.records_couldnt_load_whats_shown_above')" />
              <el-empty v-else :description="$t('projectDetail.no_records_yet_meeting_minutes_communication')" :image-size="80" />
              <div v-if="rec.list.length < rec.total" style="text-align: center; margin-top: 8px;">
                <el-button size="small" text @click="loadRecords(true)">{{ $t('common.load_more', { p0: rec.list.length, p1: rec.total }) }}</el-button>
              </div>
            </div>
          </el-tab-pane>


          <!-- ---- 里程碑 ---- -->
          <el-tab-pane name="milestones">
            <template #label><el-icon><Flag /></el-icon> {{ $t('common.milestones', { p0: project.milestones?.length || 0 }) }}</template>
            <div class="section-head">
              <!-- v2.1.2(#465): 里程碑搜索 —— 按标题/描述即时过滤(未完成与已完成区都生效) -->
              <el-input v-model="msKeyword" clearable :placeholder="$t('projectDetail.search_milestones_title_description')" style="width: 260px;" size="small">
                <template #prefix><el-icon><Search /></el-icon></template>
              </el-input>
              <div>
                <el-button size="small" :icon="Refresh" @click="load">{{ $t('common.refresh') }}</el-button>
                <el-button v-if="can('milestone.manage')" size="small" type="primary" plain :icon="Plus" @click="openMilestone()">{{ $t('projectDetail.add_milestone') }}</el-button>
              </div>
            </div>
            <!-- v1.9.4: 顶部任务全貌 —— 整体进度 + 未挂里程碑任务, 一眼看清任务归属 -->
            <div class="ms-overview">
              <div class="ms-ov-item">
                <span class="ms-ov-label">{{ $t('projectDetail.all_tasks') }}</span>
                <el-progress :percentage="overallTaskStats.total ? Math.round(overallTaskStats.done / overallTaskStats.total * 100) : 0" :stroke-width="10" style="flex: 1;" color="#d2521e" />
                <span class="ms-ov-num">{{ overallTaskStats.done }}/{{ overallTaskStats.total }}</span>
              </div>
              <div class="ms-ov-item">
                <span class="ms-ov-label">{{ $t('common.no_milestone') }}</span>
                <el-progress :percentage="orphanTaskStats.total ? Math.round(orphanTaskStats.done / orphanTaskStats.total * 100) : 0" :stroke-width="10" style="flex: 1;" color="#909399" />
                <el-link type="primary" :underline="false" style="font-size: 12px; min-width: 48px;" @click="viewOrphanTasks">
                  {{ orphanTaskStats.done }}/{{ orphanTaskStats.total }} →
                </el-link>
              </div>
            </div>
            <!-- v1.9.4: 未完成里程碑按计划时间倒序(最新在上); 已完成沉底折叠 -->
            <el-timeline v-if="activeMilestones.length">
              <el-timeline-item v-for="m in activeMilestones" :key="m.id" :timestamp="formatDate(m.plannedDate)" :type="milestoneColor(m.status)" size="large">
                <div class="ms-item">
                  <strong>{{ m.name }}</strong>
                  <el-tag size="small" :type="milestoneColor(m.status)" effect="plain">{{ milestoneStatusLabel(m.status) }}</el-tag>
                  <!-- v2.12.0(#1257) 逾期标红 -->
                  <el-tag v-if="milestoneTaskStats(m).overdueDays > 0" size="small" type="danger" effect="dark">
                    {{ $t('projectDetail.days_overdue', { p0: milestoneTaskStats(m).overdueDays }) }}
                  </el-tag>
                  <!-- v1.9.3: 负责人(名字+头像) -->
                  <span v-if="m.owner" class="ms-owner">
                    <el-avatar :size="20" :src="m.owner.avatarUrl || undefined" style="background: #d2521e; vertical-align: middle;">{{ m.owner.name?.slice(0, 1) }}</el-avatar>
                    <span class="ms-owner-name">{{ m.owner.name }}</span>
                  </span>
                  <span v-if="m.actualDate" class="ms-done">{{ $t('projectDetail.completed', { p0: formatDate(m.actualDate) }) }}</span>
                  <span v-if="can('milestone.manage')" class="row-ops">
                    <!-- v1.9.3: 快捷完成, 不用再进编辑弹窗多步操作 -->
                    <el-popconfirm v-if="m.status !== 'COMPLETED'" :title="$t('projectDetail.mark_this_milestone_as_done_actual')" @confirm="quickCompleteMilestone(m)">
                      <template #reference><el-button link size="small" type="success">{{ $t('projectDetail.complete_milestone') }}</el-button></template>
                    </el-popconfirm>
                    <el-button link size="small" @click="openMilestone(m)">{{ $t('common.edit') }}</el-button>
                    <el-popconfirm :title="$t('projectDetail.delete_this_milestone')" @confirm="removeMilestone(m)"><template #reference><el-button link size="small" type="danger">{{ $t('common.delete_2') }}</el-button></template></el-popconfirm>
                  </span>
                </div>
                <!-- v1.9.3: 按任务数计算完成进度, 点任务数直达看板(自动带上该里程碑筛选) -->
                <div v-if="milestoneTaskStats(m).total > 0" class="ms-progress">
                  <el-progress
                    :percentage="Math.round(milestoneTaskStats(m).done / milestoneTaskStats(m).total * 100)"
                    :stroke-width="8" style="flex: 1; max-width: 320px;"
                    :color="milestoneTaskStats(m).done === milestoneTaskStats(m).total ? '#2e7d4f' : '#d2521e'"
                  />
                  <el-link type="primary" :underline="false" style="font-size: 12px;" @click="viewMilestoneTasks(m)">
                    {{ $t('projectDetail.tasks_2', { p0: milestoneTaskStats(m).done, p1: milestoneTaskStats(m).total }) }}
                  </el-link>
                  <!-- v2.12.0(#1257) 状态计数 chips -->
                  <span class="ms-chips">
                    <el-tag v-if="milestoneTaskStats(m).developing" size="small" type="warning" effect="plain">{{ $t('projectDetail.developing', { p0: milestoneTaskStats(m).developing }) }}</el-tag>
                    <el-tag v-if="milestoneTaskStats(m).ready" size="small" type="success" effect="plain">{{ $t('projectDetail.ready', { p0: milestoneTaskStats(m).ready }) }}</el-tag>
                    <el-tag v-if="milestoneTaskStats(m).blocked" size="small" type="info" effect="plain">{{ $t('projectDetail.blocked', { p0: milestoneTaskStats(m).blocked }) }}</el-tag>
                  </span>
                </div>
                <div v-else class="ms-progress muted-hint">
                  {{ $t('projectDetail.no_linked_tasks') }} <el-link type="primary" :underline="false" style="font-size: 12px;" @click="viewMilestoneTasks(m)">{{ $t('projectDetail.add_on_board') }}</el-link>
                </div>
                <p v-if="m.description" class="ms-desc">{{ m.description }}</p>
              </el-timeline-item>
            </el-timeline>
            <el-empty v-else-if="!completedMilestones.length" :description="msKeyword ? $t('projectDetail.no_milestone_matches', { p0: msKeyword }) : $t('common.no_milestones')" :image-size="80" />
            <!-- v1.9.4: 已完成里程碑折叠区(默认收起, 不占顶部空间) -->
            <el-collapse v-if="completedMilestones.length" class="ms-completed">
              <el-collapse-item :title="$t('projectDetail.completed_milestones', { p0: completedMilestones.length })" name="done">
                <div v-for="m in completedMilestones" :key="m.id" class="ms-item" style="padding: 6px 0;">
                  <strong>{{ m.name }}</strong>
                  <span v-if="m.owner" class="ms-owner">
                    <el-avatar :size="18" :src="m.owner.avatarUrl || undefined" style="background: #d2521e; vertical-align: middle;">{{ m.owner.name?.slice(0, 1) }}</el-avatar>
                    <span class="ms-owner-name">{{ m.owner.name }}</span>
                  </span>
                  <span class="ms-done">{{ $t('projectDetail.completed', { p0: formatDate(m.actualDate) || '—' }) }}</span>
                  <el-link v-if="milestoneTaskStats(m).total" type="primary" :underline="false" style="font-size: 12px;" @click="viewMilestoneTasks(m)">
                    {{ $t('projectDetail.tasks_2', { p0: milestoneTaskStats(m).done, p1: milestoneTaskStats(m).total }) }}
                  </el-link>
                  <span v-if="can('milestone.manage')" class="row-ops">
                    <el-button link size="small" @click="openMilestone(m)">{{ $t('common.edit') }}</el-button>
                  </span>
                </div>
              </el-collapse-item>
            </el-collapse>
          </el-tab-pane>

          <!-- ---- 进展（工时 + 问题/风险 + 动态; 2026-07-29 起为默认首屏; 2026-07-31 任务拆到独立看板 tab） ---- -->

          <!-- ---- 任务看板（2026-07-31: 自进展模块拆出成独立 tab, 交互对齐任务管理页看板） ---- -->
          <el-tab-pane name="board">
            <!-- v2.0.9(#434): 巡检 agent 可见性 —— 展示当前正在巡检本项目的 agent(心跳30分钟内) -->
            <div v-if="patrollingAgents.length" class="patrol-banner">
              <span class="patrol-dot"></span>
              <template v-if="patrollingAgents.length === 1">
                🤖 <strong>{{ patrollingAgents[0].agentName }}</strong> {{ $t('projectDetail.patrolling_this_project') }}
              </template>
              <template v-else>
                {{ $t('projectDetail.agents_patrolling_this_project', { p0: patrollingAgents.length }) }}<strong>{{ patrollingAgents.map(a => a.agentName).join($t('common.list_sep')) }}</strong>
              </template>
              <span class="patrol-activity" v-if="patrollingAgents.some(a => a.activity)">
                {{ patrollingAgents.find(a => a.activity)?.activity }}
              </span>
            </div>
            <template #label><el-icon><Grid /></el-icon> {{ $t('projectDetail.task_board', { p0: taskDone, p1: activeTasks.length }) }}</template>

            <div class="section-head">
              <h4 class="block-title" style="margin: 0;">{{ $t('projectDetail.task_board_2') }}</h4>
              <!-- 2026-07-31: 仅看我的 / 归档 对齐任务管理页(主人反馈: 项目看板同样需要) -->
              <div class="board-controls">
                <!-- v1.9.3: 里程碑筛选 + 手动刷新, 用看板管理里程碑内的任务 -->
                <!-- v2.5.5(#916): 已完成的里程碑不再出现在筛选项里(已选中的保留到清空为止) -->
                <el-select v-model="boardMilestoneId" clearable :placeholder="$t('projectDetail.all_milestones')" size="small" style="width: 170px;" @change="loadBoard">
                  <el-option v-for="m in boardMilestoneOptions" :key="m.id" :value="String(m.id)" :label="m.name + (m.status === 'COMPLETED' ? $t('projectDetail.done') : '')" />
                  <el-option value="none" :label="$t('common.no_milestone')" />
                </el-select>
                <el-checkbox v-model="boardMineOnly" @change="onBoardMineChange">{{ $t('projectDetail.mine_only') }}</el-checkbox>
                <el-checkbox v-model="boardArchived" @change="loadBoard">{{ $t('common.view_archived') }}</el-checkbox>
                <!-- v2.0.1(#396): 默认精简(只看编号+标题), 需要细节再展开 -->
                <el-checkbox v-model="boardCompact" @change="onBoardCompactChange">{{ $t('common.compact_cards') }}</el-checkbox>
                <el-button size="small" :icon="Refresh" :loading="boardLoading" @click="loadBoard">{{ $t('common.refresh') }}</el-button>
                <el-button v-if="can('task.delete') && !boardArchived && boardVerifiedCount > 0" size="small" type="warning" plain @click="archiveVerified">
                  {{ $t('common.archive_accepted', { p0: boardVerifiedCount }) }}
                </el-button>
                <el-button v-if="can('task.create') && !boardArchived" size="small" type="primary" plain :icon="Plus" @click="openTask">{{ $t('projectDetail.add_task') }}</el-button>
              </div>
            </div>

            <!-- 归档视图: 只读列表 + 恢复 -->
            <template v-if="boardArchived">
              <el-table v-loading="boardLoading" :data="boardTasks" size="small" border>
                <el-table-column prop="title" :label="$t('common.task')" min-width="200" show-overflow-tooltip />
                <el-table-column :label="$t('common.milestone')" width="150" show-overflow-tooltip>
                  <template #default="{ row }">{{ row.milestone?.name || '—' }}</template>
                </el-table-column>
                <el-table-column :label="$t('common.owner')" width="110">
                  <template #default="{ row }">{{ row.assignee?.name || '—' }}</template>
                </el-table-column>
                <el-table-column :label="$t('common.completed_at')" width="110">
                  <template #default="{ row }">{{ formatDate(row.completedAt) || '—' }}</template>
                </el-table-column>
                <el-table-column :label="$t('common.archived_at')" width="110">
                  <template #default="{ row }">{{ formatDate(row.archivedAt) }}</template>
                </el-table-column>
                <el-table-column v-if="can('task.delete')" :label="$t('common.actions')" width="80" align="center">
                  <template #default="{ row }">
                    <el-button link type="primary" size="small" @click="unarchiveTask(row)">{{ $t('common.recovered_2') }}</el-button>
                  </template>
                </el-table-column>
              </el-table>
              <el-empty v-if="!boardTasks.length && !boardLoading" :description="$t('common.no_archived_tasks_yet')" :image-size="80" />
            </template>

            <div v-else v-loading="boardLoading" class="kanban">
              <div v-for="col in boardColumns" :key="col.status" class="kanban-col">
                <div class="col-head" :style="{ borderTopColor: col.color }">
                  <span class="col-title">{{ col.label }}</span>
                  <span class="col-count">{{ boardGroups[col.status]?.length || 0 }}</span>
                </div>
                <div class="col-body">
                  <div v-for="t in boardGroups[col.status]" :key="t.id" class="task-card" @click="openTaskDetail(t)">
                    <div class="task-head">
                      <!-- v1.9.13(#366): 卡片带任务编号, 方便沟通中快速定位 -->
                      <div class="head-left">
                        <el-tag :type="priorityType(t.priority)" size="small" effect="dark">{{ priorityLabel(t.priority) }}</el-tag>
                        <span class="task-no">#{{ t.id }}</span>
                      </div>
                      <span v-if="t.milestone" class="task-milestone" :title="t.milestone.name">{{ t.milestone.name }}</span>
                    </div>
                    <div class="task-title-row">
                      <div class="task-title">{{ t.title }}</div>
                      <!-- v2.12.0(#1255) 谁在做徽标 -->
                      <ActiveWorkBadge :active-work="t.activeWork" :task-id="t.id" :task-title="t.title" />
                    </div>
                    <!-- v2.8.0(#1144) 路径图: 阻塞角标(未完成的硬依赖前置) -->
                    <el-tooltip v-if="t.blockedBy?.length" placement="top" :content="$t('projectDetail.blocked_2') + t.blockedBy.map(b => '#' + b.id + ' ' + b.title).join($t('common.list_sep'))">
                      <div class="task-blocked">{{ $t('projectDetail.blocked_waiting_on_prerequisites', { p0: t.blockedBy.length }) }}</div>
                    </el-tooltip>
                    <!-- v2.0.1(#396): 精简模式只留编号+标题, 一屏看更多任务; 细节点卡片进详情 -->
                    <div v-if="!boardCompact && t.description" class="task-desc">{{ t.description }}</div>
                    <div v-if="!boardCompact" class="task-foot">
                      <div class="task-assignee">
                        <el-avatar v-if="t.assignee" :size="20" style="background: #d2521e;">{{ t.assignee.name?.slice(0, 1) }}</el-avatar>
                        <span v-if="t.assignee" class="aname">{{ t.assignee.name }}</span>
                        <span v-else class="aname muted">{{ $t('common.unassigned') }}</span>
                      </div>
                      <span v-if="t.dueDate" class="task-due" :class="boardDueClass(t)">{{ formatDate(t.dueDate) }}</span>
                    </div>
                    <!-- v1.9.7(#353): 等候生产卡片显示计划起止 -->
                    <div v-if="!boardCompact && t.status === 'QUEUED' && (t.plannedStartAt || t.plannedEndAt)" class="task-planned">📅 {{ plannedRange(t) }}</div>
                    <div v-if="!boardCompact && t.subtaskStats && t.subtaskStats.total > 0" class="task-progress">
                      <el-progress
                        :percentage="Math.round(t.subtaskStats.done / t.subtaskStats.total * 100)"
                        :stroke-width="4" :show-text="false"
                        :color="t.subtaskStats.done === t.subtaskStats.total ? '#2e7d4f' : '#d2521e'"
                      />
                      <span class="prog-text">✓ {{ t.subtaskStats.done }}/{{ t.subtaskStats.total }}</span>
                    </div>
                    <div v-if="!boardCompact && t.status !== 'VERIFIED' && can('task.changeStatus')" class="task-actions">
                      <el-button v-for="act in nextActions(t.status)" :key="act.to" size="small" link :type="act.type" @click.stop="quickChange(t, act.to)">
                        {{ act.label }}
                      </el-button>
                    </div>
                  </div>
                  <el-empty v-if="!boardGroups[col.status]?.length" :image-size="60" :description="$t('common.no_tasks')" />
                </div>
              </div>
            </div>
          </el-tab-pane>

          <el-tab-pane name="progress" lazy>
            <template #label><el-icon><TrendCharts /></el-icon> {{ $t('projectDetail.progress_stats') }}</template>
            <!-- v2.0.5(#406/#407/#408/#409): 进展驾驶舱(KPI条/里程碑泳道/五态/工时/代码/投屏), 替代 v1.9.4 统计块 -->
            <ProgressDashboard ref="progressDashRef" :project-id="pid()" />

            <!-- v2.0.8(#426): 底部 panel(最近动态/代码更新/最近工时)默认隐藏 —— 驾驶舱已覆盖高频信息, 需要时手动展开 -->
            <el-collapse v-model="bottomPanelOpen" class="bottom-panel">
              <el-collapse-item name="open">
                <template #title>
                  <span class="bp-title">{{ $t('projectDetail.activity_details') }}</span>
                  <span class="muted bp-summary">{{ $t('projectDetail.task_updates_commits', { p0: recentActivity.length, p1: acts.total }) }}<template v-if="project.timesheets?.length"> {{ $t('projectDetail.hour_entries', { p0: project.timesheets.length }) }}</template>{{ $t('projectDetail.click_expand') }}</span>
                </template>
            <el-row :gutter="16" style="margin-top: 8px;">
              <el-col :span="10">
                <h4 class="block-title" style="margin-top: 0;">{{ $t('projectDetail.recent_activity') }}</h4>
                <el-timeline v-if="recentActivity.length">
                  <el-timeline-item v-for="(a, i) in recentActivity" :key="i" :timestamp="formatDate(a.date)" :type="a.type" size="normal">
                    <span class="act-tag">{{ a.kind }}</span> {{ a.text }}
                  </el-timeline-item>
                </el-timeline>
                <el-empty v-else :description="$t('common.no_activity')" :image-size="60" />
              </el-col>

              <el-col :span="14">
                <!-- 代码更新动态（仓库提交，跨分支最新） -->
                <div class="block-head">
                  <h4 class="block-title" style="margin: 0;"><el-icon style="vertical-align: -2px;"><Clock /></el-icon> {{ $t('projectDetail.code_activity') }}</h4>
                  <div class="block-head-right">
                    <span class="muted">{{ $t('projectDetail.syncs_automatically_every_20_minutes') }}</span>
                    <el-button v-if="can('project.edit')" size="small" plain :icon="Refresh" :loading="acts.syncing" @click="syncActivities">{{ $t('projectDetail.sync_now') }}</el-button>
                  </div>
                </div>
                <div v-loading="acts.loading">
                  <el-timeline v-if="acts.items.length" style="padding-left: 4px; margin-top: 12px;">
                    <el-timeline-item
                      v-for="a in acts.items" :key="a.id"
                      :timestamp="formatDateTime(a.happenedAt)"
                      placement="top" type="primary" :hollow="true">
                      <div class="act-item">
                        <div class="act-title">{{ a.title }}</div>
                        <div class="act-meta">
                          <el-tag size="small" effect="plain" type="danger">{{ $t('common.p0', { p0: a.repository?.name || $t('projectDetail.repository') }) }}</el-tag>
                          <span v-if="a.refName" class="act-branch">{{ a.refName }}</span>
                          <span class="act-author"><el-icon><User /></el-icon>{{ $t('common.p0', { p0: a.author || $t('common.unknown') }) }}</span>
                          <el-link v-if="a.url" :href="a.url" target="_blank" type="info" underline="never" class="act-sha">{{ (a.sha || '').slice(0, 8) }}</el-link>
                          <span v-else class="act-sha">{{ (a.sha || '').slice(0, 8) }}</span>
                        </div>
                      </div>
                    </el-timeline-item>
                  </el-timeline>
                  <el-empty v-else-if="!acts.loading" :description="$t('projectDetail.no_commits_make_sure_repository_configured')" :image-size="80" />
                  <div v-if="acts.items.length < acts.total" style="text-align: center; margin-top: 8px;">
                    <el-button size="small" text :loading="acts.loading" @click="loadActivities(true)">{{ $t('common.load_more', { p0: acts.items.length, p1: acts.total }) }}</el-button>
                  </div>
                </div>
              </el-col>
            </el-row>

            <!-- v2.0.1(#393): 最近工时下移淡化(重要性低) -->
            <div class="timesheet-muted">
              <div class="section-head">
                <h4 class="block-title muted" style="margin: 0; font-size: 13px;">{{ $t('projectDetail.recent_hours') }}</h4>
                <el-button v-if="can('timesheet.create')" size="small" text :icon="Plus" @click="openTimesheet">{{ $t('projectDetail.log_hours') }}</el-button>
              </div>
              <el-table v-if="project.timesheets?.length" :data="project.timesheets" size="small">
                <el-table-column :label="$t('common.date')" width="110"><template #default="{ row }">{{ formatDate(row.workDate) }}</template></el-table-column>
                <el-table-column :label="$t('common.engineers')" width="100"><template #default="{ row }">{{ row.engineer?.user?.name || '—' }}</template></el-table-column>
                <el-table-column :label="$t('common.hours')" width="70" align="right"><template #default="{ row }">{{ row.hours }}h</template></el-table-column>
                <el-table-column prop="workContent" :label="$t('common.work_done')" show-overflow-tooltip />
              </el-table>
              <el-empty v-else :description="$t('projectDetail.no_hour_entries')" :image-size="50" />
            </div>
            </el-collapse-item>
            </el-collapse>
          </el-tab-pane>

          <!-- ---- 代码仓库 ---- -->
          <el-tab-pane name="repositories">
            <template #label><el-icon><FolderOpened /></el-icon> {{ $t('projectDetail.code_repositories', { p0: project.repositories?.length || 0 }) }}</template>
            <div class="section-head">
              <span></span>
              <div>
                <el-button size="small" :icon="Refresh" @click="load">{{ $t('common.refresh') }}</el-button>
                <el-button v-if="can('project.edit')" size="small" type="primary" plain :icon="Plus" @click="openRepo()">{{ $t('projectDetail.add_repository') }}</el-button>
              </div>
            </div>
            <el-table v-if="project.repositories?.length" :data="project.repositories" size="default" border>
              <el-table-column :label="$t('projectDetail.repository_name')" min-width="160" show-overflow-tooltip>
                <template #default="{ row }">
                  <el-icon style="vertical-align: middle; margin-right: 4px;"><Link /></el-icon>{{ row.name }}
                </template>
              </el-table-column>
              <el-table-column :label="$t('common.platform')" width="90">
                <template #default="{ row }"><el-tag size="small" effect="plain" :type="repoProviderType(row.provider)">{{ repoProviderLabel(row.provider) }}</el-tag></template>
              </el-table-column>
              <el-table-column :label="$t('projectDetail.repository_url')" min-width="260" show-overflow-tooltip>
                <template #default="{ row }"><el-link type="primary" :href="row.url" target="_blank" underline="never">{{ row.url }}</el-link></template>
              </el-table-column>
              <el-table-column :label="$t('projectDetail.default_branch')" width="110">
                <template #default="{ row }">{{ row.defaultBranch || '—' }}</template>
              </el-table-column>
              <el-table-column :label="$t('common.notes_2')" min-width="140" show-overflow-tooltip>
                <template #default="{ row }">{{ row.description || '—' }}</template>
              </el-table-column>
              <el-table-column :label="$t('common.actions')" width="180" fixed="right">
                <template #default="{ row }">
                  <!-- v2.0.1(#392): 单仓库更新记录弹窗, 多仓库项目不再混看 -->
                  <el-button link size="small" type="primary" @click="openRepoActs(row)">{{ $t('projectDetail.change_history') }}</el-button>
                  <template v-if="can('project.edit')">
                    <el-button link size="small" @click="openRepo(row)">{{ $t('common.edit') }}</el-button>
                    <el-popconfirm :title="$t('projectDetail.remove_this_repository_link')" @confirm="removeRepo(row)">
                      <template #reference><el-button link size="small" type="danger">{{ $t('common.delete_2') }}</el-button></template>
                    </el-popconfirm>
                  </template>
                </template>
              </el-table-column>
            </el-table>
            <el-empty v-else :description="$t('projectDetail.no_linked_repositories')" :image-size="80" />
          </el-tab-pane>

          <!-- ---- v2.0.1(#397/#398): 知识库独立成 Tab(原挂在已移除的文档 Tab 下) + Markdown 批量导入 ---- -->
          <el-tab-pane name="knowledge">
            <template #label><el-icon><Collection /></el-icon> {{ $t('projectDetail.knowledge', { p0: kb.list.length }) }}</template>
            <div class="section-head">
              <span></span>
              <div style="display: flex; gap: 8px;">
                <el-button size="small" :icon="Refresh" @click="loadKb">{{ $t('common.refresh') }}</el-button>
                <!-- #397: md 文件批量导入, 项目过程文档一键沉淀 -->
                <el-upload v-if="can('knowledge.create')" :http-request="importKbMd" :show-file-list="false" multiple accept=".md,.markdown,.txt">
                  <el-button size="small" type="primary" :loading="kbImporting > 0">{{ $t('projectDetail.import_markdown', { p0: kbImporting > 0 ? $t('projectDetail.processing', { p0: kbImporting }) : '' }) }}</el-button>
                </el-upload>
                <el-button v-if="can('knowledge.edit')" size="small" plain :icon="Link" @click="openKbLink">{{ $t('projectDetail.link_existing_article') }}</el-button>
                <el-button v-if="can('knowledge.create')" size="small" type="primary" plain :icon="Plus" @click="goNewKb">{{ $t('common.new_article') }}</el-button>
              </div>
            </div>
            <el-table v-if="kb.list.length" v-loading="kb.loading" :data="kb.list" size="small" border @row-click="viewKb" style="cursor: pointer;">
              <el-table-column :label="$t('common.title')" min-width="220" show-overflow-tooltip>
                <template #default="{ row }"><el-icon style="vertical-align: middle; margin-right: 4px;"><Collection /></el-icon>{{ row.title }}</template>
              </el-table-column>
              <el-table-column :label="$t('common.category')" width="130">
                <template #default="{ row }">{{ row.category || '—' }}</template>
              </el-table-column>
              <el-table-column :label="$t('common.tags')" min-width="160">
                <template #default="{ row }">
                  <template v-if="kbTags(row).length">
                    <el-tag v-for="t in kbTags(row).slice(0, 3)" :key="t" size="small" effect="plain" style="margin-right: 4px;">{{ t }}</el-tag>
                  </template>
                  <span v-else style="color: #ccc;">—</span>
                </template>
              </el-table-column>
              <el-table-column :label="$t('projectDetail.author')" width="100">
                <template #default="{ row }">{{ row.author?.name || '—' }}</template>
              </el-table-column>
              <el-table-column prop="viewCount" :label="$t('projectDetail.views')" width="70" align="center" />
              <el-table-column :label="$t('projectDetail.update')" width="110">
                <template #default="{ row }">{{ formatDate(row.updatedAt) }}</template>
              </el-table-column>
              <el-table-column v-if="can('knowledge.edit')" :label="$t('common.actions')" width="100" fixed="right">
                <template #default="{ row }">
                  <el-popconfirm :title="$t('projectDetail.unlink_from_this_project_article_stays')" @confirm="unlinkKb(row)">
                    <template #reference><el-button link size="small" type="danger" @click.stop>{{ $t('projectDetail.unlink') }}</el-button></template>
                  </el-popconfirm>
                </template>
              </el-table-column>
            </el-table>
            <el-empty v-else :description="$t('projectDetail.no_knowledge_yet_drag_in_or')" :image-size="60" />
          </el-tab-pane>


          <!-- v2.7(#1140): 资产 —— 本项目沉淀了什么 / 复用了什么; 懒加载 -->
          <el-tab-pane v-if="can('asset.view')" name="assets" lazy>
            <template #label><el-icon><Files /></el-icon> {{ $t('common.assets') }}</template>
            <ProjectAssetsPanel :project-id="pid()" :project="project" />
          </el-tab-pane>


          <!-- v2.0.8(#421): 成员已从 tab 收拢至右上角图标弹窗 -->

          </el-tabs>
        </main>
      </div>
    </template>

    <!-- ============ v2.12.0(#1259) 「谁正在巡检」列表抽屉 ============ -->
    <el-drawer v-model="agentsDrawerVisible" class="patrol-drawer" :title="$t('projectDetail.live_agent_activity')" size="380px" direction="rtl">
      <div v-if="patrolList.length" class="patrol-list">
        <div v-for="a in patrolList" :key="a.agentProfileId" class="patrol-card" :class="{ offline: a.stale }">
          <div class="patrol-head">
            <span class="patrol-name">{{ $t('common.p0', { p0: a.agentName || $t('projectDetail.unnamed_agent') }) }}</span>
            <el-tag size="small" :type="a.stale ? 'info' : a.taskId ? 'success' : 'warning'">
              {{ $t('common.p0', { p0: a.stale ? $t('projectDetail.left') : a.taskId ? $t('common.developing') : $t('projectDetail.idle') }) }}
            </el-tag>
          </div>
          <div v-if="!a.stale && a.activity" class="patrol-activity">{{ a.activity }}</div>
          <div v-if="a.taskTitle" class="patrol-task">📌 {{ a.taskTitle }}</div>
          <div class="patrol-beat">{{ $t('projectDetail.heartbeat', { p0: beatAgo(a.heartbeatAt) }) }}</div>
        </div>
      </div>
      <el-empty v-else :description="$t('projectDetail.no_agents_patrolling_right_now')" :image-size="80" />
    </el-drawer>

    <!-- ============ 成员弹窗 (右上角图标触发, 同概览) ============ -->
    <el-dialog v-model="membersVisible" :title="$t('projectDetail.project_members_2', { p0: activeMemberCount })" width="880px">
      <template v-if="project">
        <div class="section-head">
          <span></span>
          <div>
            <el-button size="small" :icon="Refresh" @click="load">{{ $t('common.refresh') }}</el-button>
            <el-button v-if="can('project.manageMembers')" size="small" type="primary" plain :icon="Plus" @click="openMember">{{ $t('projectDetail.add_member') }}</el-button>
          </div>
        </div>
        <el-table v-if="project.members?.length" :data="project.members" size="default" border max-height="480">
          <el-table-column :label="$t('common.name_2')" min-width="140">
            <template #default="{ row }">
              <el-avatar :size="26" style="background: #d2521e; vertical-align: middle;">{{ memberName(row).slice(0, 1) }}</el-avatar>
              <span style="margin-left: 8px;">{{ memberName(row) }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="$t('projectDetail.system_role')" width="120"><template #default="{ row }">{{ roleLabel(memberRole(row)) }}</template></el-table-column>
          <!-- v1.5.6 所属团队 (即时消息通知按团队定位) -->
          <el-table-column :label="$t('common.team')" min-width="130">
            <template #default="{ row }">
              <template v-if="memberTeams(row).length">
                <el-tag v-for="t in memberTeams(row)" :key="t.id" size="small" effect="plain" style="margin-right: 4px;">{{ t.name }}</el-tag>
              </template>
              <span v-else style="opacity: 0.4;">{{ $t('common.not_set_2') }}</span>
            </template>
          </el-table-column>
          <el-table-column :label="$t('projectDetail.project_role')" width="110">
            <template #default="{ row }"><el-tag :type="roleType(row.roleInProject)" size="small" effect="dark">{{ roleInProjectLabel(row.roleInProject) }}</el-tag></template>
          </el-table-column>
          <el-table-column :label="$t('projectDetail.contact')" min-width="180"><template #default="{ row }">{{ memberContact(row) }}</template></el-table-column>
          <el-table-column :label="$t('projectDetail.join_date')" width="120"><template #default="{ row }">{{ formatDate(row.joinDate) || '—' }}</template></el-table-column>
          <el-table-column :label="$t('common.status')" width="110">
            <template #default="{ row }">
              <el-tag v-if="row.leaveDate" type="info" size="small">{{ $t('projectDetail.left_2', { p0: formatDate(row.leaveDate) }) }}</el-tag>
              <el-tag v-else type="success" size="small">{{ $t('projectDetail.active') }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column v-if="can('project.manageMembers')" :label="$t('common.actions')" width="80" fixed="right">
            <template #default="{ row }">
              <el-popconfirm v-if="!row.leaveDate" :title="$t('projectDetail.remove_this_member')" @confirm="removeMember(row)">
                <template #reference><el-button link size="small" type="danger">{{ $t('common.remove') }}</el-button></template>
              </el-popconfirm>
            </template>
          </el-table-column>
        </el-table>
        <el-empty v-else :description="$t('common.no_members')" :image-size="80" />
      </template>
      <template #footer><el-button type="primary" @click="membersVisible = false">{{ $t('common.close') }}</el-button></template>
    </el-dialog>

    <!-- ============ 项目概览弹窗 (2026-07-29: 原概览 tab 收拢至此, 右上角图标触发) ============ -->

    <!-- ============ 项目概览弹窗 (2026-07-29: 原概览 tab 收拢至此, 右上角图标触发) ============ -->
    <el-dialog v-model="overviewVisible" :title="$t('projectDetail.project_overview')" width="720px">
      <template v-if="project">
        <el-descriptions :title="$t('projectDetail.basics')" :column="2" border>
          <el-descriptions-item :label="$t('common.customer')">{{ project.customer?.name || '—' }}</el-descriptions-item>
          <el-descriptions-item :label="$t('common.project_owner')">{{ project.manager?.name || '—' }}</el-descriptions-item>
          <el-descriptions-item :label="$t('common.sub_group')">{{ $t('common.p0', { p0: project.subGroup ? (project.subGroup.team?.name ? project.subGroup.team.name + ' / ' : '') + project.subGroup.name : $t('common.not_set_2') }) }}</el-descriptions-item>
          <el-descriptions-item :label="$t('common.start_date')">{{ formatDate(project.startDate) || '—' }}</el-descriptions-item>
          <el-descriptions-item :label="$t('common.end_date')">{{ formatDate(project.endDate) || '—' }}</el-descriptions-item>
          <el-descriptions-item :label="$t('common.project_description')" :span="2">{{ project.description || '—' }}</el-descriptions-item>
        </el-descriptions>

        <!-- v2.5.5(#915): 关闭归档(可恢复) 与 删除(不可恢复) 分开; 已结束/停摆项目用关闭, 别删 -->
        <template v-if="can('project.edit')">
          <h4 class="block-title">{{ $t('projectDetail.close_archive') }}</h4>
          <div class="danger-zone" v-if="!isArchived">
            <span class="danger-hint">{{ $t('projectDetail.close_archive_when_project_finished_or') }}</span>
            <el-button type="warning" plain @click="openCloseDialog">{{ $t('projectDetail.close_project') }}</el-button>
          </div>
          <div class="danger-zone" v-else>
            <span class="danger-hint">{{ $t('projectDetail.archived_on', { p0: formatDate(project.closedAt) || '—' }) }}<template v-if="project.closeReason">{{ $t('projectDetail.reason', { p0: project.closeReason }) }}</template></span>
            <el-button type="primary" plain :loading="archiving" @click="reopenProject">{{ $t('projectDetail.restore_active') }}</el-button>
          </div>
        </template>

        <!-- 2026-07-31: 删除项目属敏感操作, 唯一入口收在此处(原列表页删除按钮下线), 需输入 delete 确认 -->
        <template v-if="can('project.delete')">
          <h4 class="block-title" style="color: #c2362b;">{{ $t('projectDetail.danger_zone') }}</h4>
          <div class="danger-zone">
            <span class="danger-hint">{{ $t('projectDetail.after_deleting_project_its_tasks_hours') }}</span>
            <el-button type="danger" plain @click="confirmDeleteProject">{{ $t('projectDetail.delete_project') }}</el-button>
          </div>
        </template>
      </template>
      <template #footer><el-button type="primary" @click="overviewVisible = false">{{ $t('common.close') }}</el-button></template>
    </el-dialog>

    <!-- v2.5.5(#915) 关闭项目: 原因可选, 便于复盘 -->
    <el-dialog v-model="closeDialog.visible" :title="$t('projectDetail.close_archive_project')" width="480px" destroy-on-close>
      <p class="muted-sm" style="margin: 0 0 12px;">{{ $t('projectDetail.closed_project_marked_closed_no_longer') }}</p>
      <el-input v-model="closeDialog.reason" type="textarea" :rows="3" maxlength="500" show-word-limit :placeholder="$t('projectDetail.reason_optional_e_g_customer_paused')" />
      <!-- v2.7(#1140) 收尾检查: 归档前把可复用的东西沉淀成资产草稿 -->
      <div v-if="can('asset.create')" class="close-asset">
        <el-checkbox v-model="closeDialog.draftAssets">{{ $t('projectDetail.also_draft_reusable_assets_from_this') }}</el-checkbox>
        <div class="muted-sm">{{ $t('projectDetail.ai_picks_capabilities_from_finished_tasks') }}</div>
      </div>
      <template #footer>
        <el-button @click="closeDialog.visible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="warning" :loading="archiving" @click="closeProject">{{ $t('projectDetail.confirm_close') }}</el-button>
      </template>
    </el-dialog>

    <!-- ============ 知识库文章阅读弹窗 (2026-07-31: 项目主页直接读, 不跳知识库) ============ -->
    <el-dialog v-model="kbReader.visible" :title="kbReader.article?.title || $t('projectDetail.loading')" width="760px" top="6vh">
      <div v-loading="kbReader.loading" style="min-height: 200px;">
        <template v-if="kbReader.article">
          <div class="kb-reader-meta">
            <el-tag v-if="kbReader.article.category" size="small" effect="plain">{{ kbReader.article.category }}</el-tag>
            <el-tag v-for="t in kbTags(kbReader.article)" :key="t" size="small" type="info" effect="plain">{{ t }}</el-tag>
            <span class="kb-reader-info">
              {{ $t('projectDetail.updated_views', { p0: kbReader.article.author?.name || '—', p1: formatDate(kbReader.article.updatedAt), p2: kbReader.article.viewCount || 0 }) }}
            </span>
          </div>
          <div class="kb-reader-body" v-html="kbReaderHtml"></div>
        </template>
      </div>
      <template #footer>
        <el-button v-if="can('knowledge.edit')" @click="editKbInKnowledge">{{ $t('projectDetail.edit_in_knowledge_base') }}</el-button>
        <el-button type="primary" @click="kbReader.visible = false">{{ $t('common.close') }}</el-button>
      </template>
    </el-dialog>

    <!-- ============ 关联知识库文章 (2026-07-31) ============ -->
    <el-dialog v-model="kbLink.visible" :title="$t('projectDetail.linked_knowledge_articles')" width="560px">
      <el-select
        v-model="kbLink.selected" filterable remote clearable
        :remote-method="searchKbArticles" :loading="kbLink.loading"
        :placeholder="$t('projectDetail.search_knowledge_base_by_title')" style="width: 100%;"
      >
        <el-option v-for="a in kbLink.options" :key="a.id" :value="a.id" :label="a.title">
          <span>{{ a.title }}</span>
          <span style="float: right; color: #a8a29e; font-size: 12px;">
            {{ $t('common.p0', { p0: a.project ? $t('projectDetail.belongs', { p0: a.project.name }) : (a.category || $t('common.uncategorized')) }) }}
          </span>
        </el-option>
      </el-select>
      <p style="font-size: 12px; color: #a8a29e; margin: 10px 0 0; line-height: 1.6;">
        {{ $t('projectDetail.if_article_linked_another_project_confirming') }}
      </p>
      <template #footer>
        <el-button @click="kbLink.visible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :disabled="!kbLink.selected" :loading="kbLink.saving" @click="confirmKbLink">{{ $t('common.link') }}</el-button>
      </template>
    </el-dialog>

    <!-- ============ 添加成员 ============ -->
    <el-dialog v-model="memberDialog.visible" :title="$t('projectDetail.add_project_member')" width="480px">
      <el-form :model="memberDialog.form" label-width="90px">
        <el-form-item :label="$t('common.user')" required>
          <el-select v-model="memberDialog.form.userId" filterable remote :remote-method="searchUsers" :loading="memberDialog.usersLoading" :placeholder="$t('common.search_name_username')" style="width: 100%;">
            <el-option v-for="u in memberDialog.users" :key="u.id" :label="`${u.name} (${roleLabel(u.role)})`" :value="String(u.id)" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('projectDetail.project_role')" required>
          <el-select v-model="memberDialog.form.roleInProject" style="width: 100%;">
            <el-option v-for="r in ['PM','ARCHITECT','DEV','QA','OBSERVER','FDE','CLIENT']" :key="r" :label="roleInProjectLabel(r)" :value="r" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('projectDetail.join_date')">
          <el-date-picker v-model="memberDialog.form.joinDate" type="date" value-format="YYYY-MM-DD" style="width: 100%;" />
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="memberDialog.visible = false">{{ $t('common.cancel') }}</el-button><el-button type="primary" :loading="saving" @click="submitMember">{{ $t('common.add') }}</el-button></template>
    </el-dialog>

    <!-- ============ 录入工时 ============ -->
    <el-dialog v-model="timesheetDialog.visible" :title="$t('projectDetail.log_hours')" width="480px">
      <el-form :model="timesheetDialog.form" label-width="90px">
        <el-form-item :label="$t('common.recorded_by')" required>
          <el-select v-model="timesheetDialog.form.engineerId" :placeholder="$t('common.choose_recorder')" style="width: 100%;">
            <el-option v-for="t in timesheetTargets" :key="t.value" :label="t.label" :value="t.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('common.date')" required><el-date-picker v-model="timesheetDialog.form.workDate" type="date" value-format="YYYY-MM-DD" style="width: 100%;" /></el-form-item>
        <el-form-item :label="$t('common.hours_h')" required><el-input-number v-model="timesheetDialog.form.hours" :min="0.5" :max="24" :step="0.5" style="width: 100%;" /></el-form-item>
        <el-form-item :label="$t('common.work_done')" required><el-input v-model="timesheetDialog.form.workContent" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="timesheetDialog.visible = false">{{ $t('common.cancel') }}</el-button><el-button type="primary" :loading="saving" @click="submitTimesheet">{{ $t('common.save') }}</el-button></template>
    </el-dialog>

    <!-- ============ 任务详情 (1.2.6: 与任务管理一致的详情弹窗) ============ -->
    <!-- v2.1.13(#650): 弹窗内验收/流转/子任务操作后只后台刷新看板与统计, 不再整页 load() 重载全部板块 -->
    <TaskDetailDialog v-model="taskDetail.visible" :task-id="taskDetail.taskId" @changed="reload" @edit="t => { taskDetail.visible = false; openTaskEdit(t) }" />


    <!-- v1.9.8(#350): 需求清单抽屉 —— 会议纪要经 LLM 梳理出的需求, 在此确认/驳回/编辑 -->
    <!-- v2.0.1(#400): 会议记录详情弹窗 —— 列表只留摘要, 全文/录音/附件都在这 -->
    <el-dialog v-model="recView.visible" :title="recView.record?.title || $t('projectDetail.record_details')" width="760px" top="5vh">
      <template v-if="recView.record">
        <div class="muted" style="margin-bottom: 10px;">
          <el-tag size="small" effect="plain">{{ REC_TYPES[recView.record.type] || recView.record.type }}</el-tag>
          {{ fmtRecTime(recView.record.occurredAt) }}
          <template v-if="recView.record.attendees"> · 👥 {{ recView.record.attendees }}</template>
          <template v-if="recView.record.creatorName"> · {{ recView.record.creatorName }}</template>
        </div>
        <div v-if="recView.record.content" class="rec-content md-like" v-html="renderMd(recView.record.content)"></div>
        <el-empty v-else :description="$t('projectDetail.no_content')" :image-size="50" />
        <div v-if="recView.record.attachments?.length" class="rec-atts" style="margin-top: 12px;">
          <template v-for="a in recView.record.attachments" :key="a.id">
            <el-image v-if="a.kind === 'IMAGE'" :src="a.fileUrl" :preview-src-list="imageUrls(recView.record)" fit="cover" class="rec-img" preview-teleported />
            <div v-else-if="/\.(webm|mp3|m4a|wav|aac|ogg)$/i.test(a.filename || '')" class="rec-audio">
              🎙️ <span class="muted small">{{ a.filename }}</span>
              <span class="muted small">{{ audioDur(a.id) ? '⏱ ' + audioDur(a.id) + ' · ' : '' }}{{ fmtRecSize(a.fileSize) }}</span>
              <audio :src="a.fileUrl" controls preload="metadata" style="height: 32px; vertical-align: middle;"
                @loadedmetadata="e => setAudioDur(a.id, e.target.duration)"></audio>
            </div>
            <video v-else-if="a.kind === 'VIDEO'" :src="a.fileUrl" controls preload="metadata" class="rec-video"></video>
            <div v-else class="rec-file">
              📎 <el-link :href="a.fileUrl" target="_blank" type="primary">{{ a.filename }}</el-link>
              <span class="muted">{{ fmtRecSize(a.fileSize) }}</span>
            </div>
          </template>
        </div>
      </template>
      <template #footer>
        <el-button v-if="recView.record?.content && can('projectRecord.create') && !recView.record?.requirements?.length" type="primary" plain :loading="reqPanel.extractingId === recView.record?.id" @click="extractRecordRequirements(recView.record)">{{ $t('projectDetail.extract_requirements') }}</el-button>
        <el-button v-else-if="recView.record?.requirements?.length" type="primary" plain @click="recView.visible = false; openReqPanel(recView.record.id)">{{ $t('projectDetail.view_requirements') }}</el-button>
        <el-button @click="recView.visible = false">{{ $t('common.close') }}</el-button>
      </template>
    </el-dialog>

    <!-- v2.0.1(#392): 单仓库更新记录弹窗 -->
    <el-dialog v-model="repoActs.visible" :title="$t('projectDetail.change_history_2', { p0: repoActs.repo?.name || '' })" width="680px">
      <div v-loading="repoActs.loading">
        <el-timeline v-if="repoActs.list.length" style="padding-left: 4px;">
          <el-timeline-item v-for="a in repoActs.list" :key="a.id" :timestamp="formatDateTime(a.happenedAt)" placement="top" type="primary" :hollow="true">
            <div class="act-item">
              <div class="act-title">{{ a.title }}</div>
              <div class="act-meta">
                <span v-if="a.refName" class="act-branch">{{ a.refName }}</span>
                <span class="act-author"><el-icon><User /></el-icon>{{ $t('common.p0', { p0: a.author || $t('common.unknown') }) }}</span>
                <el-link v-if="a.url" :href="a.url" target="_blank" type="info" underline="never" class="act-sha">{{ (a.sha || '').slice(0, 8) }}</el-link>
              </div>
            </div>
          </el-timeline-item>
        </el-timeline>
        <el-empty v-else-if="!repoActs.loading" :description="$t('projectDetail.no_commits_synced_from_this_repository')" :image-size="70" />
        <div v-if="repoActs.list.length < repoActs.total" style="text-align: center; margin-top: 8px;">
          <el-button size="small" text :loading="repoActs.loading" @click="loadRepoActs(true)">{{ $t('common.load_more', { p0: repoActs.list.length, p1: repoActs.total }) }}</el-button>
        </div>
      </div>
    </el-dialog>

    <!-- v2.0.1(#372/#375): 专家讨论回放抽屉 -->

    <el-drawer v-model="reqPanel.visible" :title="$t('projectDetail.requirements_2')" size="640px">
      <!-- v2.0.8(#424): 语音速录 —— 说几句话 AI 补全为一条需求, 确认后入库 -->
      <div v-if="can('projectRecord.create')" class="voice-quick-bar">
        <span class="muted" style="font-size: 12px;">{{ $t('projectDetail.say_few_words_ai_turns_them') }}</span>
      </div>
      <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap; margin-bottom: 12px;">
        <el-radio-group v-model="reqPanel.statusFilter" size="small" @change="loadRequirements">
          <el-radio-button value="">{{ $t('common.all') }}</el-radio-button>
          <el-radio-button value="DRAFT">{{ $t('projectDetail.confirm') }}</el-radio-button>
          <el-radio-button value="CONFIRMED">{{ $t('projectDetail.confirmed_2') }}</el-radio-button>
          <el-radio-button value="REJECTED">{{ $t('common.rejected') }}</el-radio-button>
        </el-radio-group>
        <!-- v2.0.1(#389): 按会议筛选, 聚焦单次会议产生的需求 -->
        <el-select v-model="reqPanel.recordFilter" size="small" clearable filterable :placeholder="$t('projectDetail.all_meetings')"
          style="width: 220px;" @change="loadRequirements">
          <el-option v-for="o in reqPanel.meetingOptions" :key="o.id" :label="o.title" :value="String(o.id)" />
        </el-select>
        <!-- v2.6.1: 落地筛选 —— 已生成任务/里程碑的需求单独挑出来, 避免在「已确认」里误操作重复生成 -->
        <el-select v-model="reqPanel.landedFilter" size="small" :placeholder="$t('projectDetail.all_delivery_status')"
          style="width: 190px;" @change="loadRequirements">
          <el-option :label="$t('projectDetail.all_delivery_status')" value="" />
          <el-option :label="$t('projectDetail.no_tasks_milestones_generated')" value="0" />
          <el-option :label="$t('projectDetail.tasks_milestones_generated')" value="1" />
        </el-select>
      </div>
      <!-- v2.0.1(#399): 批量操作 —— 勾选后批量确认/驳回/生成任务 -->
      <div v-if="can('projectRecord.create')" class="req-batch-bar">
        <el-checkbox :model-value="reqAllChecked" :indeterminate="reqSel.size > 0 && !reqAllChecked" @change="toggleReqAll">{{ $t('common.select_all') }}</el-checkbox>
        <span class="muted" style="font-size: 12px;">{{ $t('projectDetail.selected', { p0: reqSel.size }) }}</span>
        <el-button size="small" type="success" plain :disabled="!reqSel.size" :loading="reqBatch.running === 'confirm'" @click="reqBatchRun('confirm')">{{ $t('projectDetail.confirm_selected') }}</el-button>
        <el-button size="small" type="danger" plain :disabled="!reqSel.size" :loading="reqBatch.running === 'reject'" @click="reqBatchRun('reject')">{{ $t('projectDetail.reject_selected') }}</el-button>
        <el-button size="small" type="primary" plain :disabled="!reqSel.size" :loading="reqBatch.running === 'toTask'" @click="openReqBatchGen">{{ $t('projectDetail.generate_tasks_in_bulk') }}</el-button>
      </div>
      <div v-loading="reqPanel.loading">
        <!-- v2.1.13(#560): 草稿期无责任人高亮, 确认前必须指认(后端拦截双保险) -->
        <div v-for="q in reqPanel.list" :key="q.id" class="req-item" :class="{ rejected: q.status === 'REJECTED', unowned: q.status === 'DRAFT' && !q.ownerId, landed: !!(q.taskId || q.milestoneId) }">
          <div class="req-head">
            <el-checkbox v-if="can('projectRecord.create')" :model-value="reqSel.has(String(q.id))" @change="toggleReqSel(q)" style="margin-right: 2px;" />
            <el-tag :type="priorityType(q.priority)" size="small" effect="dark">{{ priorityLabel(q.priority) }}</el-tag>
            <strong class="req-title">{{ q.title }}</strong>
            <el-tag :type="reqStatusType(q.status)" size="small" effect="light">{{ reqStatusLabel(q.status) }}</el-tag>
          </div>
          <div v-if="q.detail" class="req-detail">{{ q.detail }}</div>
          <div class="req-meta">
            <!-- v2.1.13(#560) 责任人: 未指认高亮⚠️ + 纪要提及姓名提示; 已驳回不用再指认 -->
            <span v-if="q.status !== 'REJECTED'" class="req-owner">
              <el-select v-if="can('projectRecord.create')" :model-value="q.ownerId ? String(q.ownerId) : ''"
                size="small" clearable filterable :placeholder="q.ownerName ? $t('projectDetail.notes_mention_owner_be_assigned', { p0: q.ownerName }) : $t('projectDetail.assign_owner')"
                :class="{ 'owner-missing': !q.ownerId }" style="width: 175px;" @change="v => setReqOwner(q, v)">
                <el-option v-for="o in ownerOptions" :key="o.userId" :label="o.name" :value="String(o.userId)" />
              </el-select>
              <span v-else class="muted">{{ $t('projectDetail.p0', { p0: q.owner?.name || $t('projectDetail.no_owner_assigned') }) }}</span>
            </span>
            <span v-if="q.record" class="muted">{{ $t('projectDetail.source', { p0: q.record.title }) }}</span>
            <span v-if="q.status === 'CONFIRMED' && q.confirmedAt" class="muted">{{ $t('projectDetail.confirmed_on', { p0: fmtRecTime(q.confirmedAt) }) }}</span>
            <!-- v1.9.9(#351): 已生成回链 -->
            <el-tag v-if="q.taskId" size="small" type="success" effect="plain" style="cursor: pointer;" @click="openTaskDetail({ id: q.taskId })">{{ $t('projectDetail.task', { p0: q.taskId }) }}</el-tag>
            <el-tag v-if="q.milestoneId" size="small" type="warning" effect="plain">{{ $t('projectDetail.milestone_generated') }}</el-tag>
            <span v-if="q.status === 'DRAFT' && can('projectRecord.create')" class="row-ops">
              <el-button link size="small" type="success" @click="setReqStatus(q, 'CONFIRMED')">{{ $t('projectDetail.confirm_2') }}</el-button>
              <el-button link size="small" type="danger" @click="setReqStatus(q, 'REJECTED')">{{ $t('projectDetail.reject') }}</el-button>
              <el-button link size="small" @click="openReqEdit(q)">{{ $t('common.edit') }}</el-button>
            </span>
            <!-- v1.9.9(#351): 已确认需求一键落成任务/里程碑(权限点与后端接口对齐) -->
            <span v-else-if="q.status === 'CONFIRMED'" class="row-ops">
              <el-button v-if="!q.taskId && can('task.create')" link size="small" type="primary" @click="openReqGen(q, 'task')">{{ $t('projectDetail.generate_task') }}</el-button>
              <el-button v-if="!q.milestoneId && can('milestone.manage')" link size="small" type="warning" @click="openReqGen(q, 'milestone')">{{ $t('projectDetail.generate_milestone') }}</el-button>
            </span>
          </div>
        </div>
        <el-empty v-if="!reqPanel.list.length && !reqPanel.loading" :description="$t('projectDetail.no_requirements_yet_click_extract_requirements')" :image-size="80" />
      </div>
    </el-drawer>

    <!-- v1.9.8(#350): 需求编辑(改标题/详情/优先级) -->
    <el-dialog v-model="reqEdit.visible" :title="$t('projectDetail.edit_requirement')" width="480px" append-to-body>
      <el-form label-width="70px">
        <el-form-item :label="$t('common.title')" required><el-input v-model="reqEdit.form.title" maxlength="100" /></el-form-item>
        <el-form-item :label="$t('common.details')"><el-input v-model="reqEdit.form.detail" type="textarea" :rows="4" /></el-form-item>
        <el-form-item :label="$t('common.priority')">
          <el-radio-group v-model="reqEdit.form.priority">
            <el-radio-button v-for="p in ['LOW','MEDIUM','HIGH','URGENT']" :key="p" :value="p">{{ priorityLabel(p) }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reqEdit.visible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="reqEdit.submitting" @click="saveReqEdit">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>

    <!-- v2.0.8(#424): 语音速录需求 —— 录音→ASR→LLM 补全为一条草稿, 用户编辑确认后落库 -->

    <!-- v1.9.9(#351): 需求→生成任务/里程碑 -->
    <el-dialog v-model="reqGen.visible" :title="reqGen.mode === 'task' ? $t('projectDetail.generate_task_from_requirement') : $t('projectDetail.generate_milestone_from_requirement')" width="400px" append-to-body>
      <div class="muted" style="margin-bottom: 12px; font-size: 13px;">"{{ reqGen.req?.title }}"</div>
      <el-form label-width="80px">
        <el-form-item v-if="reqGen.mode === 'task'" :label="$t('projectDetail.milestone')">
          <el-select v-model="reqGen.milestoneId" clearable :placeholder="$t('projectDetail.optional_no_milestone')" style="width: 100%;">
            <el-option v-for="m in openMilestones" :key="m.id" :label="m.name" :value="String(m.id)" />
          </el-select>
        </el-form-item>
        <!-- v2.0.7(#420): 生成时直接指派负责人, 免看板二次指派 -->
        <el-form-item v-if="reqGen.mode === 'task'" :label="$t('common.owner')">
          <el-select v-model="reqGen.assignee" clearable filterable :placeholder="$t('projectDetail.pick_from_project_members')" style="width: 100%;">
            <el-option v-for="o in assigneeOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item v-else :label="$t('projectDetail.planned_date')">
          <el-date-picker v-model="reqGen.plannedDate" type="date" value-format="YYYY-MM-DD" :placeholder="$t('common.optional')" style="width: 100%;" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reqGen.visible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="reqGen.submitting" @click="confirmReqGen">{{ $t('projectDetail.generate') }}</el-button>
      </template>
    </el-dialog>

    <!-- v2.6.1: 批量生成任务 —— 统一挂一个里程碑, 负责人按每条需求各自的责任人自动带入 -->
    <el-dialog v-model="reqBatchGen.visible" :title="$t('projectDetail.generate_tasks_in_bulk_2')" width="400px" append-to-body>
      <div class="muted" style="margin-bottom: 12px; font-size: 13px;">{{ $t('projectDetail.requirements_confirmed_but_have_no_task', { p0: reqBatchGen.count }) }}</div>
      <el-form label-width="80px">
        <el-form-item :label="$t('projectDetail.milestone')">
          <el-select v-model="reqBatchGen.milestoneId" clearable :placeholder="$t('projectDetail.optional_no_milestone')" style="width: 100%;">
            <el-option v-for="m in openMilestones" :key="m.id" :label="m.name" :value="String(m.id)" />
          </el-select>
        </el-form-item>
      </el-form>
      <div class="muted" style="font-size: 12px;">{{ $t('projectDetail.owners_come_from_each_requirements_assigned') }}</div>
      <template #footer>
        <el-button @click="reqBatchGen.visible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="reqBatch.running === 'toTask'" @click="reqBatchRun('toTask', { milestoneId: reqBatchGen.milestoneId })">{{ $t('projectDetail.generate') }}</el-button>
      </template>
    </el-dialog>

    <!-- v2.0.1(#388): AI 导入纪要弹窗(合并原「导入聊天记录」入口, 文档与聊天导出都走 AI 识别) -->
    <el-dialog v-model="importDialog.visible" :title="$t('projectDetail.ai_import_notes_2')" width="480px">
      <el-upload drag :http-request="importMeetingDoc" :show-file-list="false"
        accept=".md,.markdown,.txt,.docx,.pdf" :disabled="importingDoc">
        <div style="padding: 22px 0;">
          <div style="font-size: 32px;">{{ importingDoc ? '🤖' : '📄' }}</div>
          <div style="margin-top: 8px; font-size: 14px; color: #1c1917;">{{ $t('common.p0', { p0: importingDoc ? $t('projectDetail.ai_recognizing_please_wait') : $t('projectDetail.click_or_drag_files_here_upload') }) }}</div>
          <div class="muted" style="margin-top: 6px; font-size: 12px;">{{ $t('projectDetail.md_docx_pdf_txt_supported_tencent') }}<br />{{ $t('projectDetail.ai_fills_in_record_fields_confirm') }}</div>
        </div>
      </el-upload>
    </el-dialog>

    <!-- v1.9.11(#359): 会议模式 —— 会前填标题/参与人 → 会中计时+录音+速记 → 结束自动 上传录音→建纪要→转写 -->

    <!-- ============ 添加/编辑任务 ============ -->
    <el-dialog v-model="taskDialog.visible" :title="taskDialog.form.id ? $t('common.edit_task') : $t('projectDetail.add_task')" width="480px">
      <el-form :model="taskDialog.form" label-width="90px">
        <el-form-item :label="$t('common.title')" required><el-input v-model="taskDialog.form.title" :placeholder="$t('projectDetail.task_title')" /></el-form-item>
        <el-form-item :label="$t('common.description')"><el-input v-model="taskDialog.form.description" type="textarea" :rows="8" :placeholder="$t('projectDetail.markdown_supported_heading_list_code_block')" /></el-form-item>
        <el-form-item :label="$t('common.milestone')">
          <!-- v2.0.0(#376): 只列未完成里程碑(已完成的太长); 编辑时若原挂在已完成里程碑上, 兜底带出保证回显 -->
          <el-select v-model="taskDialog.form.milestoneId" clearable :placeholder="$t('common.optional')" style="width: 100%;">
            <el-option v-for="m in taskMilestoneOptions" :key="m.id" :label="m.name" :value="String(m.id)" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('common.assignee')">
          <el-select v-model="taskDialog.form.assigneeId" clearable :placeholder="$t('projectDetail.optional_active_project_members')" style="width: 100%;">
            <el-option v-for="o in assigneeOptions" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('common.priority')">
          <el-select v-model="taskDialog.form.priority" style="width: 100%;">
            <el-option v-for="p in ['LOW','MEDIUM','HIGH','URGENT']" :key="p" :label="priorityLabel(p)" :value="p" />
          </el-select>
        </el-form-item>
        <el-form-item v-if="taskDialog.form.id" :label="$t('common.status')">
          <el-select v-model="taskDialog.form.status" style="width: 100%;">
            <!-- v1.9.7(#353): 五态 -->
            <el-option v-for="s in ['TODO','QUEUED','IN_PROGRESS','DONE','VERIFIED']" :key="s" :label="taskStatusLabel(s)" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('common.due_date')"><el-date-picker v-model="taskDialog.form.dueDate" type="date" value-format="YYYY-MM-DD" style="width: 100%;" /></el-form-item>
        <!-- v2.8.0(#1144) 从路径图「+ 后继任务」进来时带前置 -->
        <el-form-item v-if="!taskDialog.form.id && taskDialog.form.dependsOn?.length" :label="$t('projectDetail.prerequisites')">
          <el-tag closable type="warning" effect="plain" @close="taskDialog.form.dependsOn = []; taskDialog.form.dependsOnHint = ''">{{ taskDialog.form.dependsOnHint || taskDialog.form.dependsOn.map(x => '#' + x).join(' ') }}</el-tag>
          <span style="font-size: 12px; color: #909399; margin-left: 8px;">{{ $t('projectDetail.hard_dependencies_created_on_save') }}</span>
        </el-form-item>
      </el-form>
      <template #footer><el-button @click="taskDialog.visible = false">{{ $t('common.cancel') }}</el-button><el-button type="primary" :loading="saving" @click="submitTask">{{ $t('common.save') }}</el-button></template>
    </el-dialog>

    <!-- ============ 里程碑 新增/编辑 ============ -->
    <el-dialog v-model="milestoneDialog.visible" :title="milestoneDialog.form.id ? $t('common.edit_milestone') : $t('projectDetail.add_milestone')" width="480px">
      <el-form :model="milestoneDialog.form" label-width="90px">
        <el-form-item :label="$t('common.name')" required><el-input v-model="milestoneDialog.form.name" /></el-form-item>
        <!-- v1.9.3: 里程碑负责人(项目成员里选) -->
        <el-form-item :label="$t('common.owner')">
          <el-select v-model="milestoneDialog.form.ownerId" filterable clearable :placeholder="$t('projectDetail.optional_pick_from_project_members')" style="width: 100%;">
            <el-option v-for="u in memberUserOptions" :key="String(u.id)" :value="String(u.id)" :label="u.name" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('projectDetail.planned_date')"><el-date-picker v-model="milestoneDialog.form.plannedDate" type="date" value-format="YYYY-MM-DD" style="width: 100%;" /></el-form-item>
        <el-form-item :label="$t('common.status')">
          <el-select v-model="milestoneDialog.form.status" style="width: 100%;">
            <el-option v-for="s in ['PENDING','IN_PROGRESS','COMPLETED','DELAYED']" :key="s" :label="milestoneStatusLabel(s)" :value="s" />
          </el-select>
        </el-form-item>
        <!-- v2.8.0(#1144) 完成定义: 路径图终点节点上展示 -->
        <el-form-item :label="$t('common.definition_done')"><el-input v-model="milestoneDialog.form.goal" type="textarea" :rows="2" maxlength="2000" :placeholder="$t('projectDetail.in_one_sentence_what_counts_as')" /></el-form-item>
        <el-form-item :label="$t('common.description')"><el-input v-model="milestoneDialog.form.description" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="milestoneDialog.visible = false">{{ $t('common.cancel') }}</el-button><el-button type="primary" :loading="saving" @click="submitMilestone">{{ $t('common.save') }}</el-button></template>
    </el-dialog>


    <!-- ============ 问题 新增/编辑 ============ -->
    <el-dialog v-model="issueDialog.visible" :title="issueDialog.form.id ? $t('projectDetail.edit_issue') : $t('projectDetail.log_issue')" width="480px">
      <el-form :model="issueDialog.form" label-width="90px">
        <el-form-item :label="$t('common.title')" required><el-input v-model="issueDialog.form.title" /></el-form-item>
        <el-form-item :label="$t('projectDetail.severity')">
          <el-select v-model="issueDialog.form.severity" style="width: 100%;">
            <el-option v-for="s in ['LOW','MEDIUM','HIGH','CRITICAL']" :key="s" :label="severityLabel(s)" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('common.status')">
          <el-select v-model="issueDialog.form.status" style="width: 100%;">
            <el-option v-for="s in ['OPEN','IN_PROGRESS','RESOLVED','CLOSED']" :key="s" :label="issueStatusLabel(s)" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('common.description')"><el-input v-model="issueDialog.form.description" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="issueDialog.visible = false">{{ $t('common.cancel') }}</el-button><el-button type="primary" :loading="saving" @click="submitIssue">{{ $t('common.save') }}</el-button></template>
    </el-dialog>

    <!-- ============ 风险 新增/编辑 ============ -->
    <el-dialog v-model="riskDialog.visible" :title="riskDialog.form.id ? $t('projectDetail.edit_risk') : $t('projectDetail.log_risk')" width="480px">
      <el-form :model="riskDialog.form" label-width="90px">
        <el-form-item :label="$t('common.title')" required><el-input v-model="riskDialog.form.title" /></el-form-item>
        <el-form-item :label="$t('projectDetail.probability')">
          <el-select v-model="riskDialog.form.probability" style="width: 100%;">
            <el-option v-for="s in ['LOW','MEDIUM','HIGH']" :key="s" :label="levelLabel(s)" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('projectDetail.impact')">
          <el-select v-model="riskDialog.form.impact" style="width: 100%;">
            <el-option v-for="s in ['LOW','MEDIUM','HIGH']" :key="s" :label="levelLabel(s)" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('common.status')">
          <el-select v-model="riskDialog.form.status" style="width: 100%;">
            <el-option v-for="s in ['IDENTIFIED','MONITORING','MITIGATED','CLOSED']" :key="s" :label="riskStatusLabel(s)" :value="s" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('projectDetail.mitigation')"><el-input v-model="riskDialog.form.mitigation" type="textarea" :rows="2" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="riskDialog.visible = false">{{ $t('common.cancel') }}</el-button><el-button type="primary" :loading="saving" @click="submitRisk">{{ $t('common.save') }}</el-button></template>
    </el-dialog>

    <!-- ============ 代码仓库 新增/编辑 ============ -->
    <el-dialog v-model="repoDialog.visible" :title="repoDialog.form.id ? $t('projectDetail.edit_code_repository') : $t('projectDetail.add_code_repository')" width="520px">
      <el-form :model="repoDialog.form" label-width="90px">
        <el-form-item :label="$t('projectDetail.repository_url')" required>
          <el-input v-model="repoDialog.form.url" placeholder="https://github.com/owner/repo.git" @keyup.enter="parseRepo">
            <template #append>
              <el-button :loading="repoDialog.parsing" @click="parseRepo">{{ $t('projectDetail.parse') }}</el-button>
            </template>
          </el-input>
          <div class="form-tip">{{ $t('projectDetail.paste_github_gitee_gitlab_url_click') }}</div>
        </el-form-item>
        <el-form-item :label="$t('projectDetail.repository_name')" required><el-input v-model="repoDialog.form.name" :placeholder="$t('projectDetail.e_g_backend_service_mobile_app')" /></el-form-item>
        <el-form-item :label="$t('common.platform')">
          <el-select v-model="repoDialog.form.provider" style="width: 100%;">
            <el-option v-for="p in ['GITHUB','GITLAB','GITEE','OTHER']" :key="p" :label="repoProviderLabel(p)" :value="p" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('projectDetail.default_branch')"><el-input v-model="repoDialog.form.defaultBranch" :placeholder="$t('projectDetail.e_g_master_main_optional')" /></el-form-item>
        <el-form-item :label="$t('common.notes_2')"><el-input v-model="repoDialog.form.description" type="textarea" :rows="2" :placeholder="$t('common.optional')" /></el-form-item>
      </el-form>
      <template #footer><el-button @click="repoDialog.visible = false">{{ $t('common.cancel') }}</el-button><el-button type="primary" :loading="saving" @click="submitRepo">{{ $t('common.save') }}</el-button></template>
    </el-dialog>

    <!-- ============ v1.4.x 项目记录 录入/编辑 ============ -->
    <el-dialog v-model="recDialog.visible" :title="recDialog.form.id ? $t('projectDetail.edit_record') : $t('projectDetail.add_record')" width="640px">
      <el-form :model="recDialog.form" label-width="80px">
        <el-form-item :label="$t('common.type')">
          <el-radio-group v-model="recDialog.form.type">
            <el-radio-button value="MEETING">{{ $t('projectDetail.meeting_minutes') }}</el-radio-button>
            <el-radio-button value="COMM">{{ $t('projectDetail.communication') }}</el-radio-button>
            <el-radio-button value="SITE">{{ $t('projectDetail.site_records') }}</el-radio-button>
            <el-radio-button value="FILE">{{ $t('projectDetail.archive') }}</el-radio-button>
            <el-radio-button value="CHAT">{{ $t('projectDetail.chat_logs') }}</el-radio-button>
            <el-radio-button value="RESEARCH">{{ $t('projectDetail.research_notes') }}</el-radio-button>
            <el-radio-button value="OTHER">{{ $t('projectDetail.other') }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
        <el-form-item :label="$t('common.title')" required>
          <el-input v-model="recDialog.form.title" maxlength="100" show-word-limit :placeholder="$t('projectDetail.e_g_0724_customer_requirements_review')" />
        </el-form-item>
        <el-form-item :label="$t('common.occurred_at')">
          <el-date-picker v-model="recDialog.form.occurredAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" style="width: 100%;" />
        </el-form-item>
        <el-form-item :label="$t('projectDetail.attendees')">
          <el-input v-model="recDialog.form.attendees" :placeholder="$t('projectDetail.e_g_us_sam_lee_customer')" />
        </el-form-item>
        <el-form-item :label="$t('common.content')">
          <el-input v-model="recDialog.form.content" type="textarea" :rows="8" class="md-input"
            :placeholder="$t('projectDetail.markdown_supported_topic_conclusion_dos_can')" />
        </el-form-item>
        <el-form-item :label="$t('common.attachments')">
          <div style="width: 100%;">
            <div v-for="(a, i) in recDialog.form.attachments" :key="i" class="att-row">
              📎 <el-link :href="a.fileUrl" target="_blank" type="primary">{{ a.filename }}</el-link>
              <el-button link type="danger" size="small" @click="recDialog.form.attachments.splice(i, 1)">{{ $t('common.remove') }}</el-button>
            </div>
            <el-upload :http-request="uploadRecordAtt" :show-file-list="false" multiple>
              <el-button size="small" :loading="recDialog.uploading">{{ $t('projectDetail.upload_attachment_image_video_document_200mb') }}</el-button>
            </el-upload>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="recDialog.visible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="recDialog.saving" @click="saveRecord">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>

    <!-- ============ v1.6.1 聊天记录导入(微信/飞书, 规则解析) ============ -->
    <el-dialog v-model="chatImport.visible" :title="$t('projectDetail.import_chat')" width="720px" @closed="resetChatImport">
      <template v-if="!chatImport.result">
        <el-radio-group v-model="chatImport.mode" size="small" style="margin-bottom: 10px;">
          <el-radio-button value="paste">{{ $t('projectDetail.paste_text') }}</el-radio-button>
          <el-radio-button value="file">{{ $t('projectDetail.upload_export_file') }}</el-radio-button>
        </el-radio-group>
        <el-input v-if="chatImport.mode === 'paste'" v-model="chatImport.text" type="textarea" :rows="12"
          :placeholder="$t('projectDetail.paste_chat_copied_or_exported_from')"
          style="font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px;" />
        <el-upload v-else drag :http-request="parseChatFile" :show-file-list="false" accept=".txt,.md,.docx" :disabled="chatImport.parsing">
          <el-icon style="font-size: 40px; color: #c0c4cc;"><UploadFilled /></el-icon>
          <div class="el-upload__text">{{ $t('projectDetail.drop_chat_export_file_here_or') }} <em>{{ $t('projectDetail.click_upload') }}</em>{{ $t('projectDetail.txt_docx_original_file_kept_as') }}</div>
        </el-upload>
        <div style="text-align: right; margin-top: 10px;">
          <el-button v-if="chatImport.mode === 'paste'" type="primary" :loading="chatImport.parsing"
            :disabled="!chatImport.text.trim()" @click="parseChatText">{{ $t('projectDetail.parse_preview') }}</el-button>
        </div>
      </template>
      <template v-else>
        <el-alert v-if="chatImport.result.parsed" type="success" :closable="false" show-icon style="margin-bottom: 10px;"
          :title="$t('projectDetail.found_messages_participants', { p0: chatImport.result.messages.length, p1: chatImport.result.speakers.join($t('common.list_sep')) })" />
        <el-alert v-else type="warning" :closable="false" show-icon style="margin-bottom: 10px;"
          :title="$t('projectDetail.chat_format_not_recognized_itll_be')" />
        <div class="conv-msgs" style="max-height: 40vh; border: 1px solid #ebeef5; border-radius: 8px; padding: 10px;">
          <template v-if="chatImport.result.parsed">
            <div v-for="(m, i) in chatImport.result.messages.slice(0, 100)" :key="i" class="conv-msg">
              <div class="conv-role">{{ m.speaker }} <span class="muted">{{ m.time }}</span></div>
              <div class="conv-bubble">{{ m.text }}</div>
            </div>
            <div v-if="chatImport.result.messages.length > 100" class="muted" style="text-align: center;">
              {{ $t('projectDetail.previewing_first_100_saving_unaffected', { p0: chatImport.result.messages.length }) }}
            </div>
          </template>
          <pre v-else style="white-space: pre-wrap; font-size: 12px; margin: 0;">{{ chatImport.result.markdown.slice(0, 3000) }}</pre>
        </div>
        <el-form label-width="80px" style="margin-top: 12px;">
          <el-form-item :label="$t('common.title')" required>
            <el-input v-model="chatImport.form.title" maxlength="100" show-word-limit />
          </el-form-item>
          <el-form-item :label="$t('common.occurred_at')">
            <el-date-picker v-model="chatImport.form.occurredAt" type="datetime" value-format="YYYY-MM-DDTHH:mm:ss" style="width: 100%;" />
          </el-form-item>
        </el-form>
      </template>
      <template #footer>
        <el-button @click="chatImport.visible = false">{{ $t('common.cancel') }}</el-button>
        <el-button v-if="chatImport.result" @click="chatImport.result = null">{{ $t('projectDetail.parse_again') }}</el-button>
        <el-button v-if="chatImport.result" type="primary" :loading="chatImport.saving" @click="saveChatImport">{{ $t('projectDetail.save_as_chat_record') }}</el-button>
      </template>
    </el-dialog>

    <!-- ============ v1.6.0 Agent 对话查看 ============ -->
    <el-dialog v-model="convView.visible" :title="convView.title || $t('common.agent_conversations')" width="680px">
      <div v-loading="convView.loading" class="conv-msgs">
        <div v-for="m in convView.messages" :key="m.id" class="conv-msg" :class="m.role === 'USER' ? 'from-user' : 'from-agent'">
          <div class="conv-role">{{ $t('common.p0', { p0: m.role === 'USER' ? $t('projectDetail.user') : '🤖 Agent' }) }} <span class="muted">{{ fmtRecTime(m.ts) }}</span></div>
          <div class="conv-bubble md-like" v-html="renderMd(m.text)"></div>
        </div>
        <el-empty v-if="!convView.loading && !convView.messages.length" :description="$t('projectDetail.no_messages')" :image-size="60" />
      </div>
    </el-dialog>

  </div>

    <!-- v2.1.6(#489) 联系人维护弹窗 -->
    <el-dialog v-model="contactMgr.visible" :title="$t('projectDetail.manage_contacts_2', { p0: project?.customer?.name || '' })" width="640px">
      <el-table :data="project?.customer?.contacts || []" size="small">
        <el-table-column :label="$t('common.name_2')" width="110">
          <template #default="{ row }">{{ row.name }}<el-tag v-if="row.isPrimary" size="small" type="warning" style="margin-left:4px;">{{ $t('common.primary') }}</el-tag></template>
        </el-table-column>
        <el-table-column :label="$t('common.title_2')" prop="title" width="100" />
        <el-table-column :label="$t('common.phone_2')" prop="phone" width="130" />
        <el-table-column :label="$t('common.email')" prop="email" min-width="150" show-overflow-tooltip />
        <el-table-column :label="$t('common.actions')" width="110" align="center">
          <template #default="{ row }">
            <el-button size="small" link type="primary" @click="editContact(row)">{{ $t('common.edit') }}</el-button>
            <el-button size="small" link type="danger" @click="removeContact(row)">{{ $t('common.delete_2') }}</el-button>
          </template>
        </el-table-column>
      </el-table>
      <el-divider style="margin: 12px 0;" />
      <el-form :model="contactMgr.form" label-width="70px" size="small">
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap: 0 12px;">
          <el-form-item :label="$t('common.name_2')" required><el-input v-model="contactMgr.form.name" :placeholder="$t('common.required')" /></el-form-item>
          <el-form-item :label="$t('common.title_2')"><el-input v-model="contactMgr.form.title" /></el-form-item>
          <el-form-item :label="$t('common.phone_2')"><el-input v-model="contactMgr.form.phone" :placeholder="$t('projectDetail.at_least_one_phone_or_email')" /></el-form-item>
          <el-form-item :label="$t('common.email')"><el-input v-model="contactMgr.form.email" /></el-form-item>
        </div>
        <el-form-item :label="$t('common.primary_contact')"><el-switch v-model="contactMgr.form.isPrimary" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button v-if="contactMgr.form.id" @click="resetContactForm">{{ $t('projectDetail.cancel_editing') }}</el-button>
        <el-button type="primary" :loading="contactMgr.saving" :disabled="!contactMgr.form.name" @click="saveContact">
          {{ $t('common.p0', { p0: contactMgr.form.id ? $t('common.save_changes') : $t('projectDetail.add_contact') }) }}
        </el-button>
      </template>
    </el-dialog>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, computed, onMounted, onUnmounted, watch, nextTick, defineAsyncComponent } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, DataBoard, TrendCharts, Flag, User, Plus, UploadFilled, FolderOpened, Link, Clock, Refresh, Notebook, Grid, MagicStick, Collection, Search, Files, Guide, Fold, Expand, ArrowUp, ArrowDown, Menu } from '@element-plus/icons-vue'
import { useIsMobile } from '@/composables/useResponsive.js'
import ActiveWorkBadge from '@/components/common/ActiveWorkBadge.vue'   // v2.12.0(#1255)
import ProjectOverviewBar from '@/components/admin/ProjectOverviewBar.vue'   // v2.12.0(#1259)
import { renderSafeMarkdown } from '@/utils/safeMarkdown.js'
import { fde, formatDate } from '@/api/index.js'
import { can } from '@/api/permissions.js'
import TaskDetailDialog from '@/components/admin/TaskDetailDialog.vue'
// 非首屏 Tab 的组件按需加载(进展含图表库), 打开对应 Tab 时才下载
const ProgressDashboard = defineAsyncComponent(() => import('@/components/admin/ProgressDashboard.vue'))   // v2.0.5(#406-409)
const ProjectAssetsPanel = defineAsyncComponent(() => import('@/components/admin/assets/ProjectAssetsPanel.vue'))
import RoadmapView from '@/components/admin/roadmap/RoadmapView.vue'   // v2.8.0(#1144) 里程碑路径图

const route = useRoute()
const router = useRouter()
const loading = ref(true)
const saving = ref(false)
const project = ref(null)
// 2026-07-29: 「进展」为默认首屏(动态/任务/工时是大家最关心的), 原概览收进右上角图标弹窗
const activeTab = ref('roadmap')   // v2.8.0(#1144): 规划(路径图)成为默认首屏; v2.0.1(#401) 之前是会议记录第一
// H5(#1251): 手机上项目侧栏收进抽屉, 默认隐藏
const pdSideOpen = ref(false)
watch(activeTab, () => { pdSideOpen.value = false })
// H5(#1251): 手机抽屉里信息一律展开, 无视桌面的 collapsed 本机记忆
const isMobile = useIsMobile()
const sideExpanded = computed(() => isMobile.value || !pdSideCollapsed.value)
// v2.8.1(#1148) 三栏布局: 项目侧栏收缩态(本机记忆) + 栏目清单(替代顶部 Tab, 计数与原页签一致)
const PD_SIDE_KEY = 'fde_pd_side_collapsed'
const pdSideCollapsed = ref(localStorage.getItem(PD_SIDE_KEY) === '1')
const PD_INFO_KEY = 'fde_pd_info_open'
const pdInfoOpen = ref(localStorage.getItem(PD_INFO_KEY) === '1')   // 默认折叠
function togglePdInfo() { pdInfoOpen.value = !pdInfoOpen.value; localStorage.setItem(PD_INFO_KEY, pdInfoOpen.value ? '1' : '0') }
function togglePdSide() { pdSideCollapsed.value = !pdSideCollapsed.value; localStorage.setItem(PD_SIDE_KEY, pdSideCollapsed.value ? '1' : '0'); nextTick(() => roadmapRef.value?.refit?.()) }
const pdNavItems = computed(() => [
  { name: 'roadmap', label: $t('projectDetail.planning'), icon: Guide },
  { name: 'records', label: $t('projectDetail.meeting_records'), icon: Notebook, count: rec.total },
  { name: 'milestones', label: $t('common.milestone_2'), icon: Flag, count: project.value?.milestones?.length || 0 },
  { name: 'board', label: $t('projectDetail.task_board_2'), icon: Grid, count: `${taskDone.value}/${activeTasks.value.length}` },
  { name: 'progress', label: $t('projectDetail.progress_stats'), icon: TrendCharts },
  { name: 'repositories', label: $t('projectDetail.code_repositories_2'), icon: FolderOpened, count: project.value?.repositories?.length || 0 },
  { name: 'knowledge', label: $t('common.knowledge_base'), icon: Collection, count: kb.list.length },
  ...(can('asset.view') ? [{ name: 'assets', label: $t('common.assets'), icon: Files }] : []),
])
// 全局侧栏收缩时画布宽度变了, 让路径图重新 fit
function onGlobalSidebarToggle() { nextTick(() => setTimeout(() => roadmapRef.value?.refit?.(), 200)) }
onMounted(() => window.addEventListener('fde:sidebar-toggle', onGlobalSidebarToggle))
onUnmounted(() => window.removeEventListener('fde:sidebar-toggle', onGlobalSidebarToggle))

// v2.12.0(#1256) board 徽标 15s 自动刷新: 页面可见才轮询, 切后台暂停
const AW_REFRESH_MS = 15000
let awTimer = null
// v2.12.0(#1259) 总览条随页面可见时刷新
const overviewTick = ref(0)
function awStart() { awStop(); awTimer = setInterval(() => { loadBoard(true); overviewTick.value++ }, AW_REFRESH_MS) }
function awStop() { if (awTimer) { clearInterval(awTimer); awTimer = null } }
function onAwVisibility() {
  if (document.hidden) { awStop(); return }
  loadBoard(true); overviewTick.value++; awStart()
}
// v2.12.0(#1259) 总览条点击下钻: 切到对应 Tab; agents 展开巡检 agent 抽屉
function onOverviewDrill(target) {
  if (target === 'agents') { agentsDrawerVisible.value = true; return }
  const map = { progress: 'progress', board: 'board', milestones: 'milestones' }
  if (map[target]) activeTab.value = map[target]
}
const agentsDrawerVisible = ref(false)
// E1: 当前项目的巡检实况列表（含离线: activeOnly=false）
const patrolList = ref([])
async function loadPatrolList() {
  try {
    const r = await fde.agentPresence.list({ projectId: pid(), activeOnly: false })
    patrolList.value = r.list || []
  } catch { patrolList.value = [] }
}
watch(agentsDrawerVisible, v => { if (v) loadPatrolList() })
function beatAgo(t) {
  if (!t) return '—'
  const s = Math.floor((Date.now() - new Date(t).getTime()) / 1000)
  if (s < 60) return $t('projectDetail.s_ago', { p0: s })
  if (s < 3600) return $t('common.min_ago_2', { p0: Math.round(s / 60) })
  return $t('common.hours_ago_2', { p0: Math.round(s / 3600) })
}
onMounted(() => { awStart(); document.addEventListener('visibilitychange', onAwVisibility) })
onUnmounted(() => { awStop(); document.removeEventListener('visibilitychange', onAwVisibility) })
const roadmapRef = ref(null)
watch(activeTab, (v) => { if (v === 'roadmap') nextTick(() => roadmapRef.value?.refit?.()) })
// v2.0.5(#406): 驾驶舱在隐藏 Tab 中挂载时图表容器宽度为0, 切到该 Tab 时重渲染
const progressDashRef = ref(null)
watch(activeTab, (v) => { if (v === 'progress') nextTick(() => progressDashRef.value?.rerenderChart?.()) })
const overviewVisible = ref(false)
const membersVisible = ref(false)   // v2.0.8(#421): 成员弹窗(原成员 tab 收拢)
const bottomPanelOpen = ref([])   // v2.0.8(#426): 进展Tab底部panel默认收起, 手动展开
const pid = () => Number(route.params.id)


// ---------- 状态 / 标签 helper ----------
function statusType(s) { return ({ ACTIVE: 'success', IN_PROGRESS: 'success', COMPLETED: 'info', ARCHIVED: 'info', ON_HOLD: 'warning', DELAYED: 'danger' }[s] || 'info') }
function statusLabel(s) { return ({ DRAFT: $t('common.draft'), NEW: $t('projectDetail.new'), ACTIVE: $t('common.in_progress'), IN_PROGRESS: $t('common.in_progress'), COMPLETED: $t('common.done_3'), ARCHIVED: $t('common.archive'), SUSPENDED: $t('common.pause'), ON_HOLD: $t('common.pause'), DELAYED: $t('common.delayed') }[s] || s) }
function healthIcon(h) { return ({ GREEN: '🟢', YELLOW: '🟡', RED: '🔴' }[h] || '⚪') }
function healthLabel(h) { return ({ GREEN: $t('common.healthy'), YELLOW: $t('common.note'), RED: $t('common.risks') }[h] || '—') }
// v1.4.x 热度(活跃度)档位, 与项目列表页同口径: ≥60 活跃 / 30-59 一般 / 1-29 低频 / 0 沉寂
function activityTag(score) {
  if (score >= 60) return { label: '🔥', type: 'danger' }
  if (score >= 30) return { label: '⚙️', type: 'warning' }
  if (score >= 1) return { label: '🐢', type: 'info' }
  return { label: '💤', type: 'info' }
}
function typeLabel(t) { return ({ NEW: $t('common.new'), UPGRADE: $t('common.upgrade'), MAINTENANCE: $t('common.ops'), TRAINING: $t('common.training') }[t] || t || '—') }

function roleInProjectLabel(r) { return ({ PM: 'PM', ARCHITECT: $t('projectDetail.architect'), DEV: $t('projectDetail.development'), QA: $t('projectDetail.testing'), OBSERVER: $t('projectDetail.observer'), FDE: $t('common.engineers'), CLIENT: $t('common.customer') }[r] || r || $t('common.members')) }
function roleType(r) { return ({ PM: 'danger', ARCHITECT: 'warning', DEV: 'primary', QA: 'success', OBSERVER: 'info', FDE: 'info', CLIENT: 'info' }[r] || 'info') }
import { roleLabel as dynRoleLabel } from '@/api/roles.js'  // v1.3.2 动态角色
function roleLabel(r) { return r ? dynRoleLabel(r) : '—' }
function memberName(row) { return row.engineer?.user?.name || row.user?.name || '—' }
function memberRole(row) { return row.engineer?.user?.role || row.user?.role || '—' }
function memberContact(row) { const u = row.engineer?.user || row.user || {}; return [u.phone, u.email].filter(Boolean).join(' · ') || '—' }
// v1.5.6 成员所属团队 (双轨: engineer.user / user)
function memberTeams(row) { return row.engineer?.user?.teams || row.user?.teams || [] }

function milestoneColor(s) { return ({ COMPLETED: 'success', IN_PROGRESS: 'primary', DELAYED: 'danger', PENDING: 'info' }[s] || 'info') }
function milestoneStatusLabel(s) { return ({ PENDING: $t('common.not_started'), IN_PROGRESS: $t('common.in_progress'), COMPLETED: $t('common.done_3'), DELAYED: $t('common.delayed') }[s] || s) }

// v1.9.7(#353): 任务状态五态化
function taskStatusLabel(s) { return ({ TODO: $t('common.inbox'), QUEUED: $t('common.queued'), IN_PROGRESS: $t('common.in_progress_2'), DONE: $t('common.built'), VERIFIED: $t('common.accepted'), BLOCKED: $t('common.blocked'), CANCELLED: $t('common.cancel') }[s] || s) }
function priorityType(p) { return ({ LOW: 'info', MEDIUM: 'primary', HIGH: 'warning', URGENT: 'danger' }[p] || 'info') }
function priorityLabel(p) { return ({ LOW: $t('common.low'), MEDIUM: $t('common.medium'), HIGH: $t('common.high'), URGENT: $t('common.urgent') }[p] || p) }

function severityLabel(s) { return ({ LOW: $t('common.low'), MEDIUM: $t('common.medium'), HIGH: $t('common.high'), CRITICAL: $t('projectDetail.critical') }[s] || s) }
function issueStatusLabel(s) { return ({ OPEN: $t('projectDetail.do'), IN_PROGRESS: $t('projectDetail.in_progress_2'), RESOLVED: $t('projectDetail.resolved'), CLOSED: $t('common.closed') }[s] || s) }
function levelLabel(s) { return ({ LOW: $t('common.low'), MEDIUM: $t('common.medium'), HIGH: $t('common.high') }[s] || s) }
function riskStatusLabel(s) { return ({ IDENTIFIED: $t('projectDetail.recognized'), MONITORING: $t('projectDetail.monitoring'), MITIGATED: $t('projectDetail.mitigated'), CLOSED: $t('common.closed') }[s] || s) }





// ---------- 计算指标 ----------
const activeMemberCount = computed(() => (project.value?.members || []).filter(m => !m.leaveDate).length)
const milestoneDone = computed(() => (project.value?.milestones || []).filter(m => m.status === 'COMPLETED').length)
// 2026-07-31: 统计口径排除已验收——分母用 activeTasks(非 VERIFIED), 否则已验收在分母不在分子, 进度被低估
const taskDone = computed(() => (project.value?.tasks || []).filter(t => t.status === 'DONE').length)
// 2026-07-30: 任务列表默认只展示未验收, 已验收单独一档(避免验收件越积越长)
const activeTasks = computed(() => (project.value?.tasks || []).filter(t => t.status !== 'VERIFIED'))

// 项目成员中的工程师（用于工时录入）
const engineerMembers = computed(() => (project.value?.members || [])
  .filter(m => !m.leaveDate && m.engineer)
  .map(m => ({ engineerId: m.engineer.id, name: m.engineer.user?.name || $t('common.engineers'), userId: m.engineer.user?.id })))

const progressStatus = computed(() => {
  const p = project.value?.progress || 0
  if (p >= 100) return 'success'
  if (project.value?.health === 'RED') return 'exception'
  if (project.value?.health === 'YELLOW') return 'warning'
  return ''
})

const recentActivity = computed(() => {
  if (!project.value) return []
  const acts = []
  for (const m of project.value.milestones || []) if (m.status === 'COMPLETED' && m.actualDate) acts.push({ date: m.actualDate, type: 'success', kind: $t('common.milestone_2'), text: $t('projectDetail.complete', { p0: m.name }) })
  for (const t of (project.value.timesheets || []).slice(0, 5)) acts.push({ date: t.workDate, type: 'info', kind: $t('common.hours'), text: $t('projectDetail.logged_h', { p0: t.engineer?.user?.name || $t('common.engineers'), p1: t.hours }) })
  // v2.0.1(#393): 完成任务进最新动态(看板数据源, 取最近完成的)
  for (const t of (boardTasks.value || [])) {
    if (t.completedAt) acts.push({ date: t.completedAt, type: 'success', kind: $t('common.task'), text: $t('projectDetail.complete_2', { p0: t.id, p1: t.title }) })
  }
  return acts.filter(a => a.date).sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 10)
})


// ---------- 加载 ----------
// v2.0.0(#368) 交付工作流流水线
const wf = ref(null)
function loadWorkflow() {
  const askedFor = pid()   // 切项目竞态守卫: 旧项目的迟到响应直接丢弃(同 loadRecords)
  fde.projectRecords.workflow(askedFor).then(data => { if (askedFor !== pid()) return; wf.value = data }).catch(() => {})
}
const wfWarnings = computed(() => {
  if (!wf.value) return []
  const { requirement: r, task: t, stallDays } = wf.value
  const list = []
  if (r.stalledDraft > 0) list.push({ type: 'warning', text: $t('projectDetail.requirements_unconfirmed_for_over_days', { p0: r.stalledDraft, p1: stallDays }), go: () => openReqPanel() })
  if (t.unassigned > 0) list.push({ type: 'warning', text: $t('projectDetail.tasks_unassigned', { p0: t.unassigned }), go: () => { activeTab.value = 'board' } })
  if (t.staleDone > 0) list.push({ type: 'danger', text: $t('projectDetail.built_over_days_ago_not_accepted', { p0: t.staleDone, p1: stallDays }), go: () => { activeTab.value = 'board' } })
  return list
})




// ============ v2.1.6(#489) 客户联系人维护 ============
const contactMgr = reactive({ visible: false, saving: false, form: { id: null, name: '', title: '', phone: '', email: '', isPrimary: false } })
function openContactMgr() { resetContactForm(); contactMgr.visible = true }
function resetContactForm() { contactMgr.form = { id: null, name: '', title: '', phone: '', email: '', isPrimary: false } }
function editContact(row) {
  contactMgr.form = { id: row.id, name: row.name, title: row.title || '', phone: row.phone === '-' ? '' : (row.phone || ''), email: row.email === '-' ? '' : (row.email || ''), isPrimary: !!row.isPrimary }
}
async function saveContact() {
  contactMgr.saving = true
  try {
    const body = { name: contactMgr.form.name, title: contactMgr.form.title, phone: contactMgr.form.phone, email: contactMgr.form.email, isPrimary: contactMgr.form.isPrimary ? 1 : 0 }
    if (contactMgr.form.id) await fde.customers.updateContact(project.value.customer.id, contactMgr.form.id, body)
    else await fde.customers.addContact(project.value.customer.id, body)
    ElMessage.success(contactMgr.form.id ? $t('common.saved') : $t('projectDetail.added'))
    resetContactForm()
    await load()
  } catch (e) { ElMessage.error(e.message) } finally { contactMgr.saving = false }
}
async function removeContact(row) {
  try { await ElMessageBox.confirm($t('projectDetail.delete_contact', { p0: row.name }), $t('projectDetail.confirm_deletion'), { type: 'warning' }) } catch { return }
  try {
    await fde.customers.removeContact(project.value.customer.id, row.id)
    ElMessage.success($t('common.deleted'))
    await load()
  } catch (e) { ElMessage.error(e.message) }
}

async function load() {
  loading.value = true
  try {
    project.value = await fde.projects.detail(pid())
    loadWorkflow()          // v2.0.0(#368) 工作流流水线(不阻塞主渲染)
    loadActivities(false)   // 概览默认展示代码更新动态, 随页面加载(不阻塞主渲染)
    loadRecords()           // v1.4.x 项目记录(不阻塞主渲染)
    refreshReqDraftCount()  // v1.9.8(#350) 需求清单待确认数(不阻塞主渲染)
    loadBoard()             // 2026-07-31 任务看板(不阻塞主渲染)
    loadKb()                // 2026-07-31 知识库内容(不阻塞主渲染)
  }
  catch (e) { ElMessage.error(e.message) }
  finally { loading.value = false }
}

// ---------- 知识库内容 (2026-07-31 主人反馈: 项目文档要能引用知识库) ----------
// 知识库文章自带 projectId, 这里就是按项目过滤展示 + 关联/解除关联(不动文章本身)
const kb = reactive({ list: [], loading: false })
// v2.0.1(#397): Markdown 文件(批量)导入知识库 —— 浏览器读文本, 标题=文件名, 关联本项目
const kbImporting = ref(0)
async function importKbMd({ file }) {
  kbImporting.value++
  try {
    const text = await file.text()
    if (!text.trim()) throw new Error($t('projectDetail.file_empty'))
    // 首个一级标题作为文章标题, 没有则用文件名
    const h1 = text.match(/^#\s+(.+)$/m)
    const title = (h1 ? h1[1] : file.name.replace(/\.(md|markdown|txt)$/i, '')).slice(0, 100)
    await fde.knowledge.create({ title, content: text, projectId: pid(), category: $t('projectDetail.project_docs') })
    ElMessage.success($t('projectDetail.imported', { p0: title }))
    loadKb()
  } catch (e) { ElMessage.error($t('projectDetail.import_failed', { p0: file.name, p1: e.message })) }
  finally { kbImporting.value-- }
}

// v2.0.1(#392): 单仓库更新记录弹窗
const repoActs = reactive({ visible: false, loading: false, repo: null, list: [], total: 0, page: 1 })
async function openRepoActs(row) {
  repoActs.repo = row
  repoActs.visible = true
  repoActs.page = 1
  repoActs.list = []
  loadRepoActs()
}
async function loadRepoActs(more = false) {
  repoActs.loading = true
  try {
    if (more) repoActs.page++
    const d = await fde.projects.activities(pid(), { repositoryId: repoActs.repo.id, page: repoActs.page, pageSize: 20 })
    // v2.0.1(#403): 该接口返回字段是 items 不是 list, 之前读错导致总数正确但列表恒空
    repoActs.list = more ? [...repoActs.list, ...(d.items || [])] : (d.items || [])
    repoActs.total = d.total || 0
  } catch (e) { ElMessage.error(e.message) }
  finally { repoActs.loading = false }
}

async function loadKb() {
  const askedFor = pid()   // 切项目竞态守卫
  kb.loading = true
  try {
    const r = await fde.knowledge.list({ project_id: askedFor, page_size: 100 })
    if (askedFor !== pid()) return
    kb.list = r.list
  } catch (e) { /* knowledge.access 无权限时静默 */ }
  finally { if (askedFor === pid()) kb.loading = false }
}
function kbTags(row) {
  if (Array.isArray(row.tags)) return row.tags
  try { const t = JSON.parse(row.tags || '[]'); return Array.isArray(t) ? t : [] } catch { return [] }
}
// 2026-07-31 主人反馈: 关联的文章在项目主页直接读, 不用跳知识库
const kbReader = reactive({ visible: false, loading: false, article: null })
const kbReaderHtml = computed(() => kbReader.article ? renderSafeMarkdown(kbReader.article.content || '') : '')
async function viewKb(row) {
  kbReader.visible = true
  kbReader.loading = true
  kbReader.article = null
  try {
    kbReader.article = await fde.knowledge.detail(row.id)
    // 浏览 +1(不阻塞)
    fde.knowledge.view(row.id).then(r => {
      const inList = kb.list.find(a => String(a.id) === String(row.id))
      if (inList && r?.viewCount !== undefined) inList.viewCount = r.viewCount
    }).catch(() => {})
  } catch (e) {
    ElMessage.error($t('projectDetail.failed_load_article') + e.message)
    kbReader.visible = false
  } finally { kbReader.loading = false }
}
function editKbInKnowledge() {
  if (kbReader.article) router.push(`/admin/knowledge/edit/${kbReader.article.id}`)
}
function goNewKb() { router.push({ path: '/admin/knowledge/edit/new', query: { projectId: String(pid()) } }) }

const kbLink = reactive({ visible: false, loading: false, saving: false, options: [], selected: null })
function openKbLink() {
  kbLink.selected = null
  kbLink.visible = true
  searchKbArticles('')
}
async function searchKbArticles(kw) {
  kbLink.loading = true
  try {
    const r = await fde.knowledge.list({ keyword: kw || '', page_size: 50 })
    // 已在本项目下的不出现在候选里
    kbLink.options = r.list.filter(a => String(a.projectId || '') !== String(pid()))
  } catch (e) { /* ignore */ }
  finally { kbLink.loading = false }
}
async function confirmKbLink() {
  if (!kbLink.selected) return
  kbLink.saving = true
  try {
    await fde.knowledge.update(kbLink.selected, { projectId: pid() })
    ElMessage.success($t('projectDetail.linked_this_project'))
    kbLink.visible = false
    loadKb()
  } catch (e) { ElMessage.error(e.message || $t('common.link_failed')) }
  finally { kbLink.saving = false }
}
async function unlinkKb(row) {
  try {
    await fde.knowledge.update(row.id, { projectId: null })
    ElMessage.success($t('projectDetail.link_removed_article_stays_in_knowledge'))
    loadKb()
  } catch (e) { ElMessage.error(e.message) }
}

// ---------- v1.4.x 项目记录(过程资料) ----------
// v1.6.0 Agent 协作: +CHAT 聊天记录/+RESEARCH 研究记录
const REC_TYPES = { MEETING: $t('projectDetail.meeting_minutes_2'), COMM: $t('projectDetail.communication_2'), SITE: $t('projectDetail.site_record'), FILE: $t('projectDetail.archive_2'), CHAT: $t('projectDetail.chat_log'), RESEARCH: $t('projectDetail.research_notes_2'), OTHER: $t('common.other') }
const rec = reactive({ list: [], total: 0, loading: false, typeFilter: '', page: 1, error: '', convs: [], convLoading: false })
// v2.0.1(#390): 类型筛选已移除(统一「会议记录」时间线), typeFilter 恒为空串; Agent 对话在 Agent 协作模块查看
async function loadProjectConvs() {
  rec.convLoading = true
  const askedFor = pid()
  try {
    const d = await fde.agentConversations.byProject(askedFor)
    if (askedFor !== pid()) return
    rec.convs = d || []
  } catch (e) {
    if (askedFor !== pid()) return
    rec.convs = []
    ElMessage.error($t('projectDetail.failed_load_agent_conversations') + e.message)
  } finally { rec.convLoading = false }
}
const convView = reactive({ visible: false, loading: false, title: '', messages: [] })
async function viewConv(c) {
  convView.title = c.title || $t('common.agent_conversations')
  convView.messages = []
  convView.visible = true
  convView.loading = true
  try { convView.messages = await fde.agentConversations.messages(c.id) }
  catch (e) { ElMessage.error(e.message) }
  finally { convView.loading = false }
}
const recDialog = reactive({ visible: false, saving: false, uploading: false, form: { id: null, type: 'MEETING', title: '', content: '', occurredAt: '', attendees: '', attachments: [] } })

// v1.6.1 研究记录轻结构化: 新建时切到 RESEARCH 且正文为空 → 预填模板
const RESEARCH_TPL = $t('projectDetail.topic_conclusion_evidence_links')
watch(() => recDialog.form.type, (t) => {
  if (t === 'RESEARCH' && !recDialog.form.id && !recDialog.form.content?.trim()) {
    recDialog.form.content = RESEARCH_TPL
  } else if (t !== 'RESEARCH' && recDialog.form.content === RESEARCH_TPL) {
    recDialog.form.content = '' // 没动过模板就切走 → 清掉, 别把模板存进会议纪要
  }
})

// v1.6.1 聊天记录导入(微信/飞书, 规则解析)
const chatImport = reactive({
  visible: false, parsing: false, saving: false, mode: 'paste', text: '',
  result: null, // { parsed, messages, speakers, occurredAt, markdown, attachment }
  form: { title: '', occurredAt: '' }
})
function openChatImport() { chatImport.visible = true }
function resetChatImport() {
  Object.assign(chatImport, { parsing: false, saving: false, mode: 'paste', text: '', result: null })
  Object.assign(chatImport.form, { title: '', occurredAt: '' })
}
function fillChatForm(d, fallbackTitle) {
  chatImport.result = d
  const others = (d.speakers || []).filter(s => s !== (JSON.parse(localStorage.getItem('fde_internal_user') || '{}').name))
  chatImport.form.title = fallbackTitle || (others.length ? $t('projectDetail.chat_with', { p0: others.slice(0, 2).join($t('common.list_sep')) }) : $t('projectDetail.chat_log'))
  // 服务端给的是 UTC ISO, 转本地时间填 datetime picker
  if (d.occurredAt) {
    const dt = new Date(d.occurredAt)
    const p = (n) => String(n).padStart(2, '0')
    chatImport.form.occurredAt = `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}T${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`
  } else {
    chatImport.form.occurredAt = ''
  }
}
async function parseChatText() {
  chatImport.parsing = true
  try {
    const d = await fde.projectRecords.parseChat(pid(), chatImport.text)
    fillChatForm(d)
  } catch (e) { ElMessage.error(e.message || $t('common.parse_failed')) }
  finally { chatImport.parsing = false }
}
async function parseChatFile({ file }) {
  chatImport.parsing = true
  try {
    const fd = new FormData()
    fd.append('file', file)
    const d = await fde.projectRecords.parseChatFile(pid(), fd)
    fillChatForm(d, file.name.replace(/\.[^.]+$/, ''))
  } catch (e) { ElMessage.error(e.message || $t('common.parse_failed')) }
  finally { chatImport.parsing = false }
}
async function saveChatImport() {
  if (!chatImport.form.title.trim()) return ElMessage.warning($t('common.enter_title'))
  chatImport.saving = true
  try {
    const d = chatImport.result
    await fde.projectRecords.create(pid(), {
      type: 'CHAT',
      title: chatImport.form.title.trim(),
      content: d.markdown,
      occurredAt: chatImport.form.occurredAt || undefined,
      attendees: (d.speakers || []).join($t('common.list_sep')) || undefined,
      attachments: d.attachment ? [d.attachment] : []
    })
    ElMessage.success($t('projectDetail.chat_log_saved'))
    chatImport.visible = false
    loadRecords()
  } catch (e) { ElMessage.error(e.message || $t('common.save_failed')) }
  finally { chatImport.saving = false }
}

function fmtRecTime(v) { return v ? String(v).slice(0, 16).replace('T', ' ') : '' }
function fmtRecSize(s) { if (!s) return ''; const n = Number(s); return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.ceil(n / 1024) + ' KB' }
function imageUrls(r) { return (r.attachments || []).filter(a => a.kind === 'IMAGE').map(a => a.fileUrl) }
async function loadRecords(more = false) {
  rec.loading = true
  const askedFor = pid()
  try {
    rec.page = more === true ? rec.page + 1 : 1
    const d = await fde.projectRecords.list(askedFor, { type: rec.typeFilter || undefined, page: rec.page, page_size: 10 })
    // 切项目时旧请求可能后回来, 迟到的响应直接丢弃, 否则会把别的项目的记录盖上来
    if (askedFor !== pid()) return
    rec.list = more === true ? [...rec.list, ...d.list] : d.list
    rec.total = d.total
    rec.error = ''
  } catch (e) {
    // 原来这里是静默 catch, 于是"没权限"和"加载失败"都表现为一片空白,
    // 更糟的是失败时 rec.list 保留着上一个项目的记录 —— 员工反馈的
    // 「不同账号看到的记录不一样」「每个项目都是同一条记录」都是从这儿来的。
    // 现在: 失败一律清空并把原因显示出来。
    if (askedFor !== pid()) return
    rec.list = []
    rec.total = 0
    rec.error = e?.message || $t('projectDetail.failed_load_records')
  }
  finally { rec.loading = false }
}
// 2026-07-31 AI 导入会议纪要: 上传文档 → 后端解析+大模型抽取 → 预填记录弹窗, 用户确认后走普通保存
const importDialog = reactive({ visible: false })   // v2.0.1(#388) AI 导入上传窗
const importingDoc = ref(false)
async function importMeetingDoc({ file }) {
  importingDoc.value = true
  try {
    const fd = new FormData()
    fd.append('file', file)
    const data = await fde.projectRecords.extract(pid(), fd)
    const d = data.draft
    // 抽取时间归一化到弹窗的 YYYY-MM-DDTHH:mm:ss; 抽不到就用当前时间
    let occurred = d.occurredAt ? String(d.occurredAt).replace(' ', 'T') : null
    if (occurred && occurred.length === 10) occurred += 'T00:00:00'
    if (occurred && occurred.length === 16) occurred += ':00'
    recDialog.form = {
      id: null,
      type: d.type || 'MEETING',
      title: d.title || '',
      content: d.content || '',
      occurredAt: occurred || new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19),
      attendees: d.attendees || '',
      attachments: data.attachment ? [data.attachment] : []
    }
    importDialog.visible = false   // v2.0.1(#388): 识别完成关上传窗, 转入确认弹窗
    recDialog.visible = true
    ElMessage.success(data.truncated ? $t('projectDetail.recognized_document_was_too_long_was') : $t('projectDetail.recognized_check_content_before_saving'))
  } catch (e) {
    ElMessage.error(e.message || $t('common.recognition_failed'))
  } finally {
    importingDoc.value = false
  }
}

// ---------- v1.9.8(#350) 会议纪要→需求梳理 ----------
const reqPanel = reactive({ visible: false, loading: false, list: [], statusFilter: '', draftCount: 0, extractingId: null, recordFilter: '', meetingOptions: [], landedFilter: '' })
function reqStatusLabel(s) { return ({ DRAFT: $t('projectDetail.confirm'), CONFIRMED: $t('projectDetail.confirmed_2'), REJECTED: $t('common.rejected') }[s] || s) }
function reqStatusType(s) { return ({ DRAFT: 'warning', CONFIRMED: 'success', REJECTED: 'info' }[s] || 'info') }
async function loadRequirements() {
  reqPanel.loading = true
  try {
    const params = {}
    if (reqPanel.statusFilter) params.status = reqPanel.statusFilter
    if (reqPanel.recordFilter) params.record_id = reqPanel.recordFilter   // v2.0.1(#389) 会议维度
    if (reqPanel.landedFilter) params.landed = reqPanel.landedFilter     // v2.6.1 已/未生成任务·里程碑
    const d = await fde.projectRecords.requirements(pid(), params)
    reqPanel.list = d.list || []
    if (!reqPanel.statusFilter && !reqPanel.recordFilter && !reqPanel.landedFilter) {
      reqPanel.draftCount = reqPanel.list.filter(x => x.status === 'DRAFT').length
      // v2.0.1(#389): 会议筛选选项 = 全量需求里出现过的来源会议(按需求生成时间倒序自然排)
      const seen = new Map()
      for (const q of reqPanel.list) { if (q.record && !seen.has(String(q.record.id))) seen.set(String(q.record.id), q.record) }
      reqPanel.meetingOptions = [...seen.values()]
    }
  } catch (e) { reqPanel.list = [] } // 需求加载失败不阻塞记录列表
  finally { reqPanel.loading = false }
}
// badge 待确认数: 随页面加载静默拉一次, 失败不打扰
async function refreshReqDraftCount() {
  const askedFor = pid()   // 切项目竞态守卫
  try {
    const d = await fde.projectRecords.requirements(askedFor, { status: 'DRAFT' })
    if (askedFor !== pid()) return
    reqPanel.draftCount = (d.list || []).length
  } catch { /* 静默 */ }
}
function openReqPanel(recordId = null) {
  // v2.0.1(#384/#389): 从记录卡片「查看需求」进来时定向到该会议
  reqPanel.recordFilter = recordId ? String(recordId) : ''
  reqPanel.landedFilter = ''   // v2.6.1: 每次打开回到全量, 免得上次的落地筛选让人以为需求丢了
  reqPanel.visible = true
  if (recordId && !reqPanel.meetingOptions.length) {
    // 定向打开时选项列表还没建过, 先拉一次全量把下拉选项补上
    const keep = reqPanel.recordFilter
    reqPanel.recordFilter = ''
    loadRequirements().then(() => { reqPanel.recordFilter = keep; loadRequirements() })
    return
  }
  loadRequirements()
}
async function extractRecordRequirements(r) {
  reqPanel.extractingId = r.id
  try {
    const d = await fde.projectRecords.extractRequirements(pid(), r.id)
    // v2.1.13(#560): 无责任人待办醒目提示, 引导逐条指认(确认前后端会拦截)
    if (d.unowned) ElMessage.warning($t('projectDetail.found_requirements_without_owner_assign_owners', { p0: d.count, p1: d.unowned }))
    else ElMessage.success($t('projectDetail.found_requirements', { p0: d.count }))
    refreshReqDraftCount()
    openReqPanel()
  } catch (e) { ElMessage.error(e.message || $t('projectDetail.extraction_failed')) }
  finally { reqPanel.extractingId = null }
}
// v2.1.13(#560): 责任人指认候选 = 在职项目成员(userId 口径, 与后端校验一致)
const ownerOptions = computed(() => {
  const out = []
  for (const m of (project.value?.members || [])) {
    if (m.leaveDate) continue
    const u = m.user || m.engineer?.user
    if (u?.name && !out.some(x => String(x.userId) === String(u.id))) out.push({ userId: u.id, name: u.name })
  }
  return out
})
async function setReqOwner(q, v) {
  try {
    await fde.projectRecords.updateRequirement(pid(), q.id, { ownerId: v || null })
    ElMessage.success(v ? $t('projectDetail.owner_assigned') : $t('projectDetail.owner_cleared'))
    loadRequirements()
  } catch (e) { ElMessage.error(e.message) }
}
// v2.0.1(#399): 批量操作 —— 复用单条接口顺序执行, 全程留痕
const reqSel = ref(new Set())
const reqBatch = reactive({ running: '' })
const reqAllChecked = computed(() => reqPanel.list.length > 0 && reqPanel.list.every(q => reqSel.value.has(String(q.id))))
function toggleReqSel(q) {
  const s = new Set(reqSel.value)
  const k = String(q.id)
  s.has(k) ? s.delete(k) : s.add(k)
  reqSel.value = s
}
function toggleReqAll() {
  reqSel.value = reqAllChecked.value ? new Set() : new Set(reqPanel.list.map(q => String(q.id)))
}
// v2.6.1: 批量生成任务前先确认挂哪个里程碑(默认最新未完成), 否则批量生成的任务全是无里程碑的散任务
const reqBatchGen = reactive({ visible: false, milestoneId: '', count: 0 })
function openReqBatchGen() {
  const targets = reqPanel.list.filter(q => reqSel.value.has(String(q.id)) && q.status === 'CONFIRMED' && !q.taskId)
  if (!targets.length) return ElMessage.warning($t('projectDetail.none_selected_requirements_confirmed_without_tas'))
  reqBatchGen.count = targets.length
  reqBatchGen.milestoneId = latestOpenMilestoneId()
  reqBatchGen.visible = true
}
async function reqBatchRun(kind, opts = {}) {
  const picked = reqPanel.list.filter(q => reqSel.value.has(String(q.id)))
  // 按操作过滤合法对象: 确认/驳回只对 DRAFT; 生成任务只对 已确认且未生成 的
  const targets = kind === 'toTask'
    ? picked.filter(q => q.status === 'CONFIRMED' && !q.taskId)
    : picked.filter(q => q.status === 'DRAFT')
  const skipped = picked.length - targets.length
  if (!targets.length) return ElMessage.warning(kind === 'toTask' ? $t('projectDetail.none_selected_requirements_confirmed_without_tas') : $t('projectDetail.none_selected_requirements_waiting_for_confirmat'))
  reqBatch.running = kind
  let ok = 0, fail = 0, firstErr = ''
  for (const q of targets) {
    try {
      if (kind === 'confirm') await fde.projectRecords.updateRequirement(pid(), q.id, { status: 'CONFIRMED' })
      else if (kind === 'reject') await fde.projectRecords.updateRequirement(pid(), q.id, { status: 'REJECTED' })
      // v2.6.1: 里程碑用弹窗里选的; 负责人不传 —— 后端默认落到该需求自己的责任人(#560)
      else await fde.projectRecords.reqToTask(pid(), q.id, opts.milestoneId ? { milestoneId: opts.milestoneId } : {})
      ok++
    } catch (e) { fail++; if (!firstErr) firstErr = e.message || '' }   // v2.1.13(#560): 带出首个失败原因(如无责任人拦截)
  }
  reqBatch.running = ''
  reqBatchGen.visible = false
  reqSel.value = new Set()
  ElMessage[fail ? 'warning' : 'success']($t('projectDetail.succeeded', { p0: { confirm: $t('projectDetail.confirm_selected_2'), reject: $t('projectDetail.reject_selected_2'), toTask: $t('projectDetail.generate_tasks_in_bulk_2') }[kind], p1: ok, p2: fail ? $t('projectDetail.failed', { p0: fail, p1: firstErr ? ` (${firstErr})` : '' }) : '', p3: skipped ? $t('projectDetail.skipped_as_not_applicable', { p0: skipped }) : '' }))
  loadRequirements()
  refreshReqDraftCount()
  if (kind === 'toTask') loadBoard(true)
}

async function setReqStatus(q, status) {
  try {
    await fde.projectRecords.updateRequirement(pid(), q.id, { status })
    ElMessage.success(status === 'CONFIRMED' ? $t('projectDetail.confirmed_2') : $t('common.rejected'))
    loadRequirements()
    refreshReqDraftCount()
  } catch (e) { ElMessage.error(e.message) }
}
const reqEdit = reactive({ visible: false, submitting: false, id: null, form: { title: '', detail: '', priority: 'MEDIUM' } })

function openReqEdit(q) {
  reqEdit.id = q.id
  reqEdit.form = { title: q.title, detail: q.detail || '', priority: q.priority || 'MEDIUM' }
  reqEdit.visible = true
}
async function saveReqEdit() {
  if (!reqEdit.form.title.trim()) return ElMessage.warning($t('projectDetail.title_required'))
  reqEdit.submitting = true
  try {
    await fde.projectRecords.updateRequirement(pid(), reqEdit.id, { ...reqEdit.form })
    ElMessage.success($t('common.saved'))
    reqEdit.visible = false
    loadRequirements()
  } catch (e) { ElMessage.error(e.message) }
  finally { reqEdit.submitting = false }
}
// ---------- v1.9.9(#351) 已确认需求 → 生成任务/里程碑 ----------
const reqGen = reactive({ visible: false, mode: 'task', req: null, milestoneId: '', plannedDate: '', assignee: '', submitting: false })
// 挂里程碑候选: 只列未完成的(已完成里程碑没有再挂新任务的意义)
const openMilestones = computed(() => (project.value?.milestones || []).filter(m => m.status !== 'COMPLETED'))
// v2.5.5(#916) 任务看板里程碑筛选: 只列未完成的; 若当前选中的恰好已完成, 仍保留该项直到用户清空, 避免筛选条件凭空消失
const boardMilestoneOptions = computed(() => {
  const cur = boardMilestoneId.value
  if (cur && cur !== 'none' && !openMilestones.value.some(m => String(m.id) === String(cur))) {
    const m = (project.value?.milestones || []).find(x => String(x.id) === String(cur))
    if (m) return [m, ...openMilestones.value]
  }
  return openMilestones.value
})
// v2.0.0(#376): 任务弹窗的里程碑选项 = 未完成里程碑 + (编辑回显兜底)已选中的已完成里程碑
const taskMilestoneOptions = computed(() => {
  const cur = taskDialog.form.milestoneId
  if (cur && !openMilestones.value.some(m => String(m.id) === String(cur))) {
    const m = (project.value?.milestones || []).find(x => String(x.id) === String(cur))
    if (m) return [m, ...openMilestones.value]
  }
  return openMilestones.value
})
function openReqGen(q, mode) {
  reqGen.mode = mode
  reqGen.req = q
  // v2.6.1: 里程碑默认值 —— 该需求自己生成过里程碑就挂它, 否则挂最新的未完成里程碑; 不想挂再清空
  reqGen.milestoneId = q.milestoneId ? String(q.milestoneId) : latestOpenMilestoneId()
  reqGen.plannedDate = ''
  // v2.6.1: 负责人优先带入需求上已指认的责任人(纪要→需求→任务一路承接);
  //         需求没有责任人时再退回预填当前登录人(v2.0.7#420 的老行为), 可改可清
  reqGen.assignee = memberAssigneeValue(q.ownerId) || memberAssigneeValue(currentUser?.id)
  reqGen.visible = true
}
// 把 userId 映射成负责人下拉的取值(有工程师档案走 e:, 否则 u:); 不是在职成员返回空
function memberAssigneeValue(userId) {
  if (!userId) return ''
  const m = (project.value?.members || []).find(x => !x.leaveDate && String(x.user?.id ?? x.userId) === String(userId))
  if (!m) return ''
  return m.engineer ? 'e:' + m.engineer.id : 'u:' + (m.user?.id ?? m.userId)
}
// 最新的未完成里程碑 = id 最大的那个(新建的排最后), 没有就空
function latestOpenMilestoneId() {
  const list = openMilestones.value
  if (!list.length) return ''
  return String(list.reduce((a, b) => (BigInt(a.id) > BigInt(b.id) ? a : b)).id)
}
async function confirmReqGen() {
  // v2.0.7(#420): 负责人为空明确提示(仍允许生成, 但避免无感漏指派)
  if (reqGen.mode === 'task' && !reqGen.assignee) {
    const go = await ElMessageBox.confirm($t('projectDetail.no_owner_selected_youll_need_assign'), $t('projectDetail.note'), { confirmButtonText: $t('projectDetail.generate_anyway'), cancelButtonText: $t('projectDetail.back_choose'), type: 'warning' }).then(() => true).catch(() => false)
    if (!go) return
  }
  reqGen.submitting = true
  try {
    if (reqGen.mode === 'task') {
      const payload = {}
      if (reqGen.milestoneId) payload.milestoneId = reqGen.milestoneId
      if (reqGen.assignee.startsWith('e:')) payload.assigneeId = reqGen.assignee.slice(2)
      else if (reqGen.assignee.startsWith('u:')) payload.assigneeUserId = reqGen.assignee.slice(2)
      const d = await fde.projectRecords.reqToTask(pid(), reqGen.req.id, payload)
      ElMessage.success($t('projectDetail.generated_task', { p0: d.task?.id }))
      loadBoard()
    } else {
      const d = await fde.projectRecords.reqToMilestone(pid(), reqGen.req.id, reqGen.plannedDate ? { plannedDate: reqGen.plannedDate } : {})
      ElMessage.success($t('projectDetail.generated_milestone', { p0: d.milestone?.name || reqGen.req.title }))
      reload()   // 里程碑 Tab 随项目详情一起刷新
    }
    reqGen.visible = false
    loadRequirements()
  } catch (e) { ElMessage.error(e.message) }
  finally { reqGen.submitting = false }
}

// ---------- v1.9.11(#360) 纪要关联展示: 记录卡片上的需求/任务摘要行 ----------
const expandedRecReqs = reactive(new Set())
function toggleRecReqs(id) {
  const k = String(id)
  expandedRecReqs.has(k) ? expandedRecReqs.delete(k) : expandedRecReqs.add(k)
}
function recReqConfirmed(r) { return (r.requirements || []).filter(q => q.status === 'CONFIRMED').length }
function recReqTasks(r) { return (r.requirements || []).filter(q => q.taskId).length }

// ---------- v2.0.1(#400) 记录详情弹窗: 列表简洁化, 全文/附件进弹窗 ----------
const recView = reactive({ visible: false, record: null })
function openRecView(r) { recView.record = r; recView.visible = true }

// ---------- v2.0.5(#412) 说话人时间线 ----------
// 连续同说话人句子合并成块
// 列表摘要: 正文首个非标题文本行, 截 60 字
function recBrief(r) {
  const line = (r.content || '').split('\n').map(s => s.trim()).find(s => s && !s.startsWith('#') && !s.startsWith('---'))
  return (line || $t('projectDetail.view_full_text')).replace(/[*`>]/g, '').slice(0, 60) + ((line || '').length > 60 ? '…' : '')
}

// ---------- v2.0.1(#384/#385/#386) 记录卡片小件 ----------
// #386: 录音时长从 <audio> 元数据读取(附件表未存时长, 不动表)
const audioDurs = ref(new Map())
function setAudioDur(id, seconds) {
  if (!isFinite(seconds)) return
  const s = Math.round(seconds)
  const text = s >= 60 ? $t('projectDetail.m_s', { p0: Math.floor(s / 60), p1: s % 60 }) : $t('projectDetail.s', { p0: s })
  audioDurs.value = new Map(audioDurs.value).set(String(id), text)
}
function audioDur(id) { return audioDurs.value.get(String(id)) || '' }

function openRecord(r = null) {
  recDialog.form = r
    ? { id: r.id, type: r.type, title: r.title, content: r.content || '', occurredAt: String(r.occurredAt).slice(0, 19), attendees: r.attendees || '', attachments: (r.attachments || []).map(a => ({ filename: a.filename, fileUrl: a.fileUrl, fileSize: a.fileSize })) }
    : { id: null, type: 'MEETING', title: '', content: '', occurredAt: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 19), attendees: '', attachments: [] }
  recDialog.visible = true
}
async function uploadRecordAtt({ file }) {
  recDialog.uploading = true
  try {
    const fd = new FormData()
    fd.append('file', file)
    const r = await fde.uploads.upload(fd)
    if (r.code !== 0) throw new Error(r.message || $t('common.upload_failed'))
    recDialog.form.attachments.push({ filename: file.name, fileUrl: r.data.url, fileSize: file.size })
  } catch (e) { ElMessage.error(e.message || $t('common.upload_failed')) }
  finally { recDialog.uploading = false }
}
async function saveRecord() {
  if (!recDialog.form.title.trim()) return ElMessage.warning($t('common.enter_title'))
  recDialog.saving = true
  try {
    const payload = {
      type: recDialog.form.type, title: recDialog.form.title.trim(), content: recDialog.form.content,
      occurredAt: recDialog.form.occurredAt, attendees: recDialog.form.attendees,
      attachments: recDialog.form.attachments
    }
    if (recDialog.form.id) await fde.projectRecords.update(recDialog.form.id, payload)
    else await fde.projectRecords.create(pid(), payload)
    ElMessage.success($t('common.saved'))
    recDialog.visible = false
    loadRecords()
  } catch (e) { ElMessage.error(e.message) }
  finally { recDialog.saving = false }
}
async function removeRecord(r) {
  try { await fde.projectRecords.remove(r.id); ElMessage.success($t('common.deleted')); loadRecords() }
  catch (e) { ElMessage.error(e.message) }
}

// v1.7.5+ 下线: 项目周报逻辑(v1.3.0)摘除, renderMd 保留(Agent 会话/过程记录仍在用)
function renderMd(md) { return renderSafeMarkdown(md || '') }

// v2.5.5(#915) 关闭归档 / 恢复
const isArchived = computed(() => ['CLOSED', 'CANCELLED'].includes(project.value?.status))
const archiving = ref(false)
const closeDialog = reactive({ visible: false, reason: '', draftAssets: true })
function openCloseDialog() { closeDialog.reason = ''; closeDialog.draftAssets = true; closeDialog.visible = true }
async function closeProject() {
  archiving.value = true
  try {
    await fde.projects.close(project.value.id, closeDialog.reason)
    closeDialog.visible = false
    overviewVisible.value = false
    ElMessage.success($t('projectDetail.project_closed_archived_find_it_under'))
    // 资产起草失败不影响关闭(已关成功), 只提示
    if (closeDialog.draftAssets && can('asset.create')) {
      fde.assets.draftFromProject(project.value.id)
        .then(r => r.created.length && ElMessage({ type: 'success', message: $t('projectDetail.drafted_assets_from_this_project_review', { p0: r.created.length }), duration: 5000 }))
        .catch(e => ElMessage.warning($t('projectDetail.asset_drafting_failed_draft_manually_later', { p0: e.message || e })))
    }
    await load()
  } catch (e) { ElMessage.error(e.message || $t('projectDetail.close_failed')) } finally { archiving.value = false }
}
async function reopenProject() {
  try {
    await ElMessageBox.confirm($t('projectDetail.project_returns_its_status_before_closing'), $t('projectDetail.restore_project'), { type: 'info' })
  } catch { return }
  archiving.value = true
  try {
    await fde.projects.reopen(project.value.id)
    ElMessage.success($t('projectDetail.project_restored_active'))
    await load()
  } catch (e) { ElMessage.error(e.message || $t('common.reopen_failed')) } finally { archiving.value = false }
}

// 2026-07-31: 删除项目唯一入口(概览弹窗·危险操作), 必须原样输入 delete 才放行
async function confirmDeleteProject() {
  try {
    await ElMessageBox.prompt(
      $t('projectDetail.after_deletion_its_tasks_hours_other', { p0: project.value?.name }),
      $t('projectDetail.delete_project'),
      {
        confirmButtonText: $t('common.confirm_delete'),
        cancelButtonText: $t('common.cancel'),
        confirmButtonClass: 'el-button--danger',
        inputPattern: /^delete$/,
        inputPlaceholder: $t('projectDetail.type_delete_confirm'),
        inputErrorMessage: $t('projectDetail.type_delete_confirm_2'),
        type: 'warning'
      }
    )
  } catch { return }
  try {
    await fde.projects.remove(pid())
    ElMessage.success($t('projectDetail.project_deleted'))
    router.push('/admin/projects')
  } catch (e) { ElMessage.error(e.message || $t('common.delete_failed')) }
}

// 任务增删改后 reload 同时刷看板(任务数据两处消费: project.tasks 统计 + boardTasks 看板)
// v2.1.13(#650) 后台刷新: 数据就地替换, 不闪整页骨架屏/看板 loading(主人反馈频繁验收/保存时整页刷新体验差)
async function reload() { loadBoard(true); roadmapRef.value?.reload?.(); try { project.value = await fde.projects.detail(pid()) } catch (e) { ElMessage.error(e.message) } }

async function withSave(fn, okMsg) {
  saving.value = true
  try { await fn(); if (okMsg) ElMessage.success(okMsg); await reload(); return true }
  catch (e) { ElMessage.error(e.message || $t('common.action_failed')); return false }
  finally { saving.value = false }
}

// ---------- 成员 ----------
const memberDialog = reactive({ visible: false, usersLoading: false, users: [], form: { userId: '', roleInProject: 'DEV', joinDate: '' } })
function openMember() { memberDialog.form = { userId: '', roleInProject: 'DEV', joinDate: '' }; memberDialog.users = []; memberDialog.visible = true; searchUsers('') }
async function searchUsers(keyword) {
  memberDialog.usersLoading = true
  try { memberDialog.users = await fde.projects.availableUsers({ keyword: keyword || '', projectId: pid() }) || [] }
  catch (e) { /* ignore */ }
  finally { memberDialog.usersLoading = false }
}
async function submitMember() {
  if (!memberDialog.form.userId) return ElMessage.warning($t('projectDetail.choose_user'))
  const ok = await withSave(() => fde.projects.addMember(pid(), {
    userId: memberDialog.form.userId, roleInProject: memberDialog.form.roleInProject, joinDate: memberDialog.form.joinDate || undefined
  }), $t('projectDetail.member_added'))
  if (ok) memberDialog.visible = false
}
async function removeMember(row) { await withSave(() => fde.projects.removeMember(pid(), row.id), $t('projectDetail.member_removed')) }

// ---------- 工时 ----------
const currentUser = (() => { try { return JSON.parse(localStorage.getItem('fde_internal_user') || 'null') } catch { return null } })()
// 记录人选项: 「我自己」在最前(任何角色都能记自己的工时, 含项目经理), 再列项目里的工程师成员
const timesheetTargets = computed(() => {
  const others = engineerMembers.value
    .filter(e => String(e.userId || '') !== String(currentUser?.id || ''))
    .map(e => ({ value: String(e.engineerId), label: e.name }))
  return [{ value: '__SELF__', label: $t('common.myself', { p0: currentUser?.name || currentUser?.username || $t('common.me') }) }, ...others]
})
const timesheetDialog = reactive({ visible: false, form: { engineerId: '__SELF__', workDate: '', hours: 8, workContent: '' } })
function openTimesheet() {
  timesheetDialog.form = { engineerId: '__SELF__', workDate: '', hours: 8, workContent: '' }
  timesheetDialog.visible = true
}
async function submitTimesheet() {
  const f = timesheetDialog.form
  if (!f.engineerId || !f.workDate || !f.hours || !f.workContent) return ElMessage.warning($t('projectDetail.please_fill_in_everything'))
  const ok = await withSave(() => fde.timesheets.create({
    projectId: pid(),
    // __SELF__ 不传 engineerId, 后端按当前登录人记账(无工程师档案会自动补建)
    engineerId: f.engineerId === '__SELF__' ? undefined : f.engineerId,
    workDate: f.workDate, hours: f.hours, workContent: f.workContent
  }), $t('projectDetail.hours_logged'))
  if (ok) timesheetDialog.visible = false
}

// ---------- 任务 ----------
// 指派候选 = 所有在职成员(不只工程师): 有档案传 e:<engineerId>, 没有传 u:<userId>(后端自动补建档案)
const assigneeOptions = computed(() => (project.value?.members || [])
  .filter(m => !m.leaveDate)
  .map(m => {
    const uid = m.user?.id ?? m.userId
    if (m.engineer) return { value: 'e:' + m.engineer.id, label: memberName(m) }
    if (uid) return { value: 'u:' + uid, label: memberName(m) }
    return null
  })
  .filter(Boolean))
const taskDialog = reactive({ visible: false, form: { id: null, title: '', description: '', milestoneId: '', assigneeId: '', priority: 'MEDIUM', status: 'TODO', dueDate: '', dependsOn: [], dependsOnHint: '' } })
// v2.8.0(#1144) 从路径图建任务: 带上里程碑, 可带前置(「+ 后继任务」)
function openTaskFromRoadmap({ milestoneId = '', dependsOn = [], hint = '' } = {}) {
  openTask()
  taskDialog.form.milestoneId = milestoneId ? String(milestoneId) : ''
  taskDialog.form.dependsOn = dependsOn.map(String)
  taskDialog.form.dependsOnHint = hint
}
function goBoardFromRoadmap(milestoneId) {
  boardMilestoneId.value = milestoneId && milestoneId !== '' ? String(milestoneId) : ''
  activeTab.value = 'board'
  loadBoard()
}

function openTask() {
  taskDialog.form = { id: null, title: '', description: '', milestoneId: '', assigneeId: '', priority: 'MEDIUM', status: 'TODO', dueDate: '', dependsOn: [], dependsOnHint: '' }
  taskDialog.visible = true
}
// 2026-07-31: 任务看板(自进展 tab 拆出) —— 数据走任务管理同款列表接口(带 assignee/milestone/子项进度, 默认排除归档)
// v1.9.7(#353): 任务状态流重构为五态, 新增 QUEUED(等候生产)
const boardColumns = [
  { status: 'TODO', label: $t('common.inbox'), color: '#909399' },
  { status: 'QUEUED', label: $t('common.queued'), color: '#b3771e' },
  { status: 'IN_PROGRESS', label: $t('common.in_progress_2'), color: '#1c1917' },
  { status: 'DONE', label: $t('common.built'), color: '#2e7d4f' },
  { status: 'VERIFIED', label: $t('common.accepted'), color: '#85ce61' }
]
const boardTasks = ref([])
const boardLoading = ref(false)
const boardGroups = computed(() => {
  const g = {}
  for (const c of boardColumns) g[c.status] = boardTasks.value.filter(t => t.status === c.status)
  return g
})
// v2.0.1(#396): 精简卡片(默认开, 全局共享 key, 任务管理页同用)
const BOARD_COMPACT_KEY = 'fde_board_compact'
const boardCompact = ref(localStorage.getItem(BOARD_COMPACT_KEY) !== '0')
function onBoardCompactChange() { localStorage.setItem(BOARD_COMPACT_KEY, boardCompact.value ? '1' : '0') }

// 仅看我的 勾选状态本地缓存(与任务管理页同套路, 各自独立 key)
const BOARD_MINE_KEY = 'fde_project_board_mine_only'
const boardMineOnly = ref(localStorage.getItem(BOARD_MINE_KEY) === '1')
const boardArchived = ref(false)
// v1.9.3: 看板按里程碑筛选(默认全部; 'none'=未挂里程碑), 用任务看板管理里程碑
const boardMilestoneId = ref('')
const boardVerifiedCount = computed(() => boardGroups.value.VERIFIED?.length || 0)
function onBoardMineChange() {
  localStorage.setItem(BOARD_MINE_KEY, boardMineOnly.value ? '1' : '0')
  loadBoard()
}
// v2.0.9(#434): 正在巡检本项目的 agent(心跳30分钟内), 随看板刷新
const patrollingAgents = ref([])
async function loadPatrollingAgents() {
  const askedFor = pid()   // 切项目竞态守卫
  try {
    const d = await fde.agentPresence.active()
    if (askedFor !== pid()) return
    patrollingAgents.value = (d.list || []).filter(a => a.projectId === String(askedFor) && a.status === 'PATROLLING')
  } catch { if (askedFor === pid()) patrollingAgents.value = [] }
}

async function loadBoard(silent = false) {
  // v2.0.0(#376): 自动刷新传 silent=true 不闪 loading; 模板 @click 会传 MouseEvent, 故严格判等
  if (silent !== true) boardLoading.value = true
  const askedFor = pid()   // 切项目竞态守卫: 旧项目的任务列表不得盖到新项目看板上
  try {
    const params = { projectId: askedFor, page_size: 100 }
    if (boardMineOnly.value) params.mine = 'true'
    if (boardArchived.value) params.archived = 'true'
    if (boardMilestoneId.value) params.milestone_id = boardMilestoneId.value   // v1.9.3
    const data = await fde.tasks.list(params)
    if (askedFor !== pid()) return
    boardTasks.value = data.list
  } catch (e) { /* 无 task.view 权限时静默, 看板留空 */ }
  finally { if (askedFor === pid()) boardLoading.value = false }
  loadPatrollingAgents()   // #434: 不阻塞看板, 失败静默
}
async function archiveVerified() {
  try {
    await ElMessageBox.confirm($t('projectDetail.archive_accepted_tasks_restore_them_under', { p0: boardVerifiedCount.value }), $t('common.archive_all'), { type: 'info' })
  } catch { return }
  try {
    const r = await fde.tasks.archiveVerified(pid())
    ElMessage.success($t('common.archived_tasks', { p0: r.archived }))
    reload()
  } catch (e) { ElMessage.error(e.message) }
}
async function unarchiveTask(row) {
  try {
    await fde.tasks.unarchive(row.id)
    ElMessage.success($t('common.recovered'))
    reload()
  } catch (e) { ElMessage.error(e.message) }
}
// v1.9.7(#353): 五态快捷流转 TODO→QUEUED→IN_PROGRESS→DONE→VERIFIED
function nextActions(s) {
  return ({
    TODO: [{ to: 'QUEUED', label: $t('common.move_queue'), type: 'warning' }],
    QUEUED: [{ to: 'IN_PROGRESS', label: $t('common.start_work'), type: 'primary' }],
    IN_PROGRESS: [{ to: 'DONE', label: $t('common.built'), type: 'success' }],
    DONE: [{ to: 'VERIFIED', label: $t('common.accept'), type: 'success' }]
  }[s]) || []
}
// v2.0.1(#391): 转等候生产不再强制填计划起止(主人反馈这步多余), 直接流转
async function quickChange(t, status) {
  // v2.8.0(#1144) 路径图: 阻塞是提醒不是锁 —— 前置没完成就要开工, 弹确认并把原因写进任务评论
  const blockedBy = Array.isArray(t.blockedBy) ? t.blockedBy : []
  if (status === 'IN_PROGRESS' && blockedBy.length) {
    const names = blockedBy.map(b => typeof b === 'object' ? `#${b.id} ${b.title || ''}`.trim() : `#${b}`).join($t('common.list_sep'))
    let reason
    try {
      const r = await ElMessageBox.prompt($t('projectDetail.this_task_still_has_unfinished_prerequisites', { p0: blockedBy.length, p1: names }), $t('projectDetail.prerequisites_unfinished'), {
        confirmButtonText: $t('projectDetail.start_anyway'), cancelButtonText: $t('projectDetail.not_yet'), inputPlaceholder: $t('projectDetail.e_g_only_wrap_up_left'), inputValidator: v => (v && v.trim().length >= 2) || $t('projectDetail.write_short_reason')
      })
      reason = r.value.trim()
    } catch { return }
    try { await fde.comments.create({ entity: 'task', entityId: t.id, content: $t('projectDetail.started_before_prerequisites_were_done_reason', { p0: names, p1: reason }) }) } catch { /* 评论失败不拦流转 */ }
  }
  try {
    await fde.tasks.changeStatus(t.id, status)
    ElMessage.success($t('common.updated'))
    reload()
  } catch (e) { ElMessage.error(e.message) }
}
function boardDueClass(t) {
  if (!t.dueDate) return ''
  return (t.status === 'TODO' || t.status === 'QUEUED' || t.status === 'IN_PROGRESS') && new Date(t.dueDate) < new Date() ? 'overdue' : ''
}
// v1.9.7(#353): QUEUED 卡片显示计划起止(MM-DD)
function plannedRange(t) {
  const f = (v) => (v ? String(v).slice(5, 10) : '?')
  return `${f(t.plannedStartAt)} ~ ${f(t.plannedEndAt)}`
}
// 1.2.6: 卡片点击弹任务详情(与任务管理同款组件)
const taskDetail = reactive({ visible: false, taskId: null })
function openTaskDetail(row) {
  taskDetail.taskId = row.id
  taskDetail.visible = true
}
function openTaskEdit(row) {
  taskDialog.form = {
    id: row.id,
    title: row.title,
    description: row.description || '',
    milestoneId: row.milestoneId ? String(row.milestoneId) : '',
    assigneeId: row.assigneeId ? 'e:' + row.assigneeId : '',
    priority: row.priority || 'MEDIUM',
    status: row.status || 'TODO',
    dueDate: row.dueDate ? String(row.dueDate).slice(0, 10) : ''
  }
  taskDialog.visible = true
}
async function submitTask() {
  const f = taskDialog.form
  if (!f.title?.trim()) return ElMessage.warning($t('projectDetail.enter_task_title'))
  const a = f.assigneeId || ''
  if (f.id) {
    // 编辑: PUT /api/fde/tasks/:id, 空值显式传 null 以支持清除
    const ok = await withSave(() => fde.tasks.update(f.id, {
      title: f.title, description: f.description || null,
      milestoneId: f.milestoneId || null,
      // u: 前缀走 assigneeUserId(后端自动补建工程师档案), 此时 assigneeId 必须保持 undefined
      assigneeId: a.startsWith('e:') ? a.slice(2) : (a.startsWith('u:') ? undefined : null),
      assigneeUserId: a.startsWith('u:') ? a.slice(2) : undefined,
      priority: f.priority, status: f.status, dueDate: f.dueDate || null
    }), $t('projectDetail.task_updated'))
    if (ok) taskDialog.visible = false
    return
  }
  const ok = await withSave(() => fde.tasks.create({
    projectId: pid(), title: f.title, description: f.description || undefined,
    milestoneId: f.milestoneId || undefined,
    assigneeId: a.startsWith('e:') ? a.slice(2) : undefined,
    assigneeUserId: a.startsWith('u:') ? a.slice(2) : undefined,
    priority: f.priority, dueDate: f.dueDate || undefined,
    dependsOn: f.dependsOn?.length ? f.dependsOn : undefined   // v2.8.0(#1144) 路径图「+ 后继任务」带前置
  }), $t('projectDetail.task_added'))
  if (ok) taskDialog.visible = false
}

// ---------- 里程碑 ----------
const milestoneDialog = reactive({ visible: false, form: { id: null, name: '', plannedDate: '', status: 'PENDING', description: '', ownerId: '', goal: '' } })
function openMilestone(m) {
  milestoneDialog.form = m
    ? { id: m.id, name: m.name, plannedDate: m.plannedDate ? String(m.plannedDate).slice(0, 10) : '', status: m.status, description: m.description || '', ownerId: m.owner ? String(m.owner.id) : '', goal: m.goal || '' }
    : { id: null, name: '', plannedDate: '', status: 'PENDING', description: '', ownerId: '', goal: '' }
  milestoneDialog.visible = true
}
async function submitMilestone() {
  const f = milestoneDialog.form
  if (!f.name?.trim()) return ElMessage.warning($t('projectDetail.enter_name'))
  const payload = { name: f.name, plannedDate: f.plannedDate || null, status: f.status, description: f.description || null, ownerId: f.ownerId || null, goal: f.goal || null }
  const ok = await withSave(() => f.id ? fde.projects.updateMilestone(pid(), f.id, payload) : fde.projects.createMilestone(pid(), payload), $t('projectDetail.milestone_saved'))
  if (ok) milestoneDialog.visible = false
}
// v1.9.3: 快捷完成(状态置 COMPLETED, 后端自动填实际完成日期)
async function quickCompleteMilestone(m) {
  await withSave(() => fde.projects.updateMilestone(pid(), m.id, { status: 'COMPLETED' }), $t('projectDetail.milestone_completed', { p0: m.name }))
}
// v1.9.3: 里程碑任务进度(详情接口的 tasks 自带 milestone.id, 前端聚合零请求)
function milestoneTaskStats(m) {
  const tasks = (project.value?.tasks || []).filter(t => String(t.milestone?.id) === String(m.id))
  const done = tasks.filter(t => t.status === 'DONE' || t.status === 'VERIFIED').length
  // 被未完成硬依赖挡住 / 前置齐了可开工（ready 判定与后端 roadmap 口径一致, 用任务自带 blockedBy）
  const blocked = tasks.filter(t => t.blockedBy?.length).length
  const ready = tasks.filter(t => !t.blockedBy?.length && ['TODO', 'QUEUED'].includes(t.status)).length
  // 正被 Agent 自动开发（派工或巡检, 且未失联）
  const developing = tasks.filter(t => {
    const w = t.activeWork
    return w && !w.stale && ['DEVELOPING', 'PATROLLING'].includes(w.status)
  }).length

  // 逾期: 严格“今天晚于计划日且未完成”才算; 计划日=今天只算当天到期, 不逾期
  let overdueDays = 0
  if (m.status !== 'COMPLETED' && m.plannedDate) {
    const planned = new Date(m.plannedDate)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const day = new Date(planned); day.setHours(0, 0, 0, 0)
    const diff = Math.round((today - day) / 86400000)
    if (diff > 0) overdueDays = diff
  }
  return { total: tasks.length, done, blocked, ready, developing, overdueDays }
}
// v1.9.3: 点任务数 → 跳看板并带上该里程碑筛选
function viewMilestoneTasks(m) {
  boardMilestoneId.value = String(m.id)
  activeTab.value = 'board'
  loadBoard()
}
// v2.1.2(#465): 里程碑搜索 —— 标题/描述包含关键词(不区分大小写), 输入即时过滤
const msKeyword = ref('')
const msMatch = m => {
  const kw = msKeyword.value.trim().toLowerCase()
  if (!kw) return true
  return (m.name || '').toLowerCase().includes(kw) || (m.description || '').toLowerCase().includes(kw)
}
// v1.9.4: 未完成里程碑按计划时间倒序(最新在上, 无日期垫底); 已完成沉底折叠
const activeMilestones = computed(() =>
  (project.value?.milestones || [])
    .filter(m => m.status !== 'COMPLETED')
    .filter(msMatch)
    .slice()
    .sort((a, b) => {
      if (!a.plannedDate && !b.plannedDate) return 0
      if (!a.plannedDate) return 1
      if (!b.plannedDate) return -1
      return new Date(b.plannedDate) - new Date(a.plannedDate)
    })
)
const completedMilestones = computed(() =>
  (project.value?.milestones || [])
    .filter(m => m.status === 'COMPLETED')
    .filter(msMatch)
    .slice()
    .sort((a, b) => new Date(b.actualDate || b.plannedDate || 0) - new Date(a.actualDate || a.plannedDate || 0))
)
// v1.9.4: 任务全貌 —— 整体 + 未挂里程碑
const overallTaskStats = computed(() => {
  const ts = project.value?.tasks || []
  return { total: ts.length, done: ts.filter(t => t.status === 'DONE' || t.status === 'VERIFIED').length }
})
const orphanTaskStats = computed(() => {
  const ts = (project.value?.tasks || []).filter(t => !t.milestone)
  return { total: ts.length, done: ts.filter(t => t.status === 'DONE' || t.status === 'VERIFIED').length }
})
function viewOrphanTasks() {
  boardMilestoneId.value = 'none'
  activeTab.value = 'board'
  loadBoard()
}

// v1.9.3: 负责人选项 = 项目成员(按 userId; 双轨: user 直挂 / engineer.user)
const memberUserOptions = computed(() =>
  (project.value?.members || [])
    .map(mm => ({ id: mm.user?.id || mm.engineer?.user?.id, name: memberName(mm) }))
    .filter(o => o.id)
)
async function removeMilestone(m) { await withSave(() => fde.projects.removeMilestone(pid(), m.id), $t('projectDetail.milestone_deleted')) }

// ---------- 问题 ----------
const issueDialog = reactive({ visible: false, form: { id: null, title: '', severity: 'MEDIUM', status: 'OPEN', description: '' } })
function openIssue(it) {
  issueDialog.form = it ? { id: it.id, title: it.title, severity: it.severity, status: it.status, description: it.description || '' }
    : { id: null, title: '', severity: 'MEDIUM', status: 'OPEN', description: '' }
  issueDialog.visible = true
}
async function submitIssue() {
  const f = issueDialog.form
  if (!f.title?.trim()) return ElMessage.warning($t('common.enter_title'))
  const payload = { title: f.title, severity: f.severity, status: f.status, description: f.description || null }
  const ok = await withSave(() => f.id ? fde.projects.updateIssue(pid(), f.id, payload) : fde.projects.createIssue(pid(), payload), $t('projectDetail.issue_saved'))
  if (ok) issueDialog.visible = false
}
async function removeIssue(it) { await withSave(() => fde.projects.removeIssue(pid(), it.id), $t('projectDetail.issue_deleted')) }

// ---------- 风险 ----------
const riskDialog = reactive({ visible: false, form: { id: null, title: '', probability: 'MEDIUM', impact: 'MEDIUM', status: 'IDENTIFIED', mitigation: '' } })
function openRisk(rk) {
  riskDialog.form = rk ? { id: rk.id, title: rk.title, probability: rk.probability, impact: rk.impact, status: rk.status, mitigation: rk.mitigation || '' }
    : { id: null, title: '', probability: 'MEDIUM', impact: 'MEDIUM', status: 'IDENTIFIED', mitigation: '' }
  riskDialog.visible = true
}
async function submitRisk() {
  const f = riskDialog.form
  if (!f.title?.trim()) return ElMessage.warning($t('common.enter_title'))
  const payload = { title: f.title, probability: f.probability, impact: f.impact, status: f.status, mitigation: f.mitigation || null }
  const ok = await withSave(() => f.id ? fde.projects.updateRisk(pid(), f.id, payload) : fde.projects.createRisk(pid(), payload), $t('projectDetail.risk_saved'))
  if (ok) riskDialog.visible = false
}
async function removeRisk(rk) { await withSave(() => fde.projects.removeRisk(pid(), rk.id), $t('projectDetail.risk_deleted')) }

// ---------- 代码仓库 ----------
function repoProviderLabel(p) { return ({ GITEE: 'Gitee', GITHUB: 'GitHub', GITLAB: 'GitLab', OTHER: $t('common.other') }[p] || p) }
function repoProviderType(p) { return ({ GITEE: 'danger', GITHUB: 'info', GITLAB: 'warning', OTHER: 'info' }[p] || 'info') }
const repoDialog = reactive({ visible: false, parsing: false, form: { id: null, name: '', url: '', provider: 'GITHUB', defaultBranch: '', description: '' } })
async function parseRepo() {
  const url = repoDialog.form.url?.trim()
  if (!url) return ElMessage.warning($t('projectDetail.enter_repository_url_first'))
  repoDialog.parsing = true
  try {
    const d = await fde.projects.parseRepo(url)
    const f = repoDialog.form
    if (d.provider) f.provider = d.provider
    if (d.name) f.name = d.name
    if (d.defaultBranch) f.defaultBranch = d.defaultBranch
    if (d.description && !f.description) f.description = d.description
    if (d.apiOk) ElMessage.success($t('projectDetail.parsed', { p0: d.name, p1: d.defaultBranch ? ' · ' + d.defaultBranch : '' }))
    else ElMessage.warning(d.note || $t('projectDetail.repository_name_filled_from_url_enter'))
  } catch (e) {
    ElMessage.error(e.message || $t('common.parse_failed'))
  } finally {
    repoDialog.parsing = false
  }
}
function openRepo(r) {
  repoDialog.form = r
    ? { id: r.id, name: r.name, url: r.url, provider: r.provider || 'OTHER', defaultBranch: r.defaultBranch || '', description: r.description || '' }
    : { id: null, name: '', url: '', provider: 'GITHUB', defaultBranch: '', description: '' }
  repoDialog.visible = true
}
async function submitRepo() {
  const f = repoDialog.form
  if (!f.name?.trim()) return ElMessage.warning($t('projectDetail.enter_repository_name'))
  if (!f.url?.trim()) return ElMessage.warning($t('projectDetail.enter_repository_url'))
  const payload = { name: f.name, url: f.url, provider: f.provider, defaultBranch: f.defaultBranch || null, description: f.description || null }
  const ok = await withSave(() => f.id ? fde.projects.updateRepo(pid(), f.id, payload) : fde.projects.createRepo(pid(), payload), $t('projectDetail.repository_saved'))
  if (ok) repoDialog.visible = false
}
async function removeRepo(r) { await withSave(() => fde.projects.removeRepo(pid(), r.id), $t('projectDetail.repository_link_removed')) }

// ---------- 更新动态（仓库提交） ----------
const PAGE_SIZE = 20
const acts = reactive({ items: [], total: 0, page: 0, loading: false, syncing: false, loaded: false })
function formatDateTime(d) {
  if (!d) return '—'
  const dt = new Date(d)
  const p = n => String(n).padStart(2, '0')
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}`
}
async function loadActivities(more = false) {
  if (acts.loading) return
  acts.loading = true
  const askedFor = pid()   // 切项目竞态守卫
  const nextPage = more ? acts.page + 1 : 1
  try {
    const r = await fde.projects.activities(askedFor, { page: nextPage, pageSize: PAGE_SIZE })
    if (askedFor !== pid()) return
    acts.items = more ? [...acts.items, ...(r.items || [])] : (r.items || [])
    acts.total = r.total || 0
    acts.page = nextPage
    acts.loaded = true
  } catch (e) {
    if (askedFor === pid()) ElMessage.error(e.message || $t('projectDetail.failed_load_activity'))
  } finally {
    if (askedFor === pid()) acts.loading = false
  }
}
async function syncActivities() {
  acts.syncing = true
  try {
    const r = await fde.projects.syncRepos(pid())
    const added = r?.added || 0
    const failed = r?.failed || 0
    if (failed) ElMessage.warning($t('projectDetail.synced_new_repositories_failed_check_url', { p0: added, p1: failed }))
    else ElMessage.success($t('projectDetail.synced_new_commits', { p0: added }))
    await loadActivities(false)
  } catch (e) {
    ElMessage.error(e.message || $t('projectDetail.sync_failed'))
  } finally {
    acts.syncing = false
  }
}

// 1.2.7: 返回来源页(仪表盘/任务/项目列表都可能进来), 无历史时兜底项目列表
function goBack() {
  if (window.history.state?.back) router.back()
  else router.push('/admin/projects')
}

// v2.0.0(#376): 任务/里程碑/工作流 2 分钟自动刷新 —— Agent 在平台上持续干活, 页面挂着就能看到最新进展。
// 静默刷(不动 loading 不闪屏); 后台标签页与弹窗编辑中跳过, 不打扰也不浪费请求
const AUTO_REFRESH_MS = 2 * 60 * 1000
let autoRefreshTimer = null
function autoRefresh() {
  if (document.hidden) return
  if (taskDialog.visible || milestoneDialog.visible) return
  fde.projects.detail(pid()).then(p => { project.value = p }).catch(() => {})
  loadBoard(true)
  loadWorkflow()
}
onMounted(() => {
  load()
  autoRefreshTimer = setInterval(autoRefresh, AUTO_REFRESH_MS)
})
onUnmounted(() => clearInterval(autoRefreshTimer))
// router-view 没有 :key, 路由参数变化时 vue-router 会复用本组件, onMounted 不再触发 ——
// 直接从一个项目的地址跳到另一个项目(改地址栏/前进后退)会整页停留在上一个项目的数据。
// 这里补上重新加载, 并把各面板的分页/筛选状态一并归零。
watch(() => route.params.id, (id, old) => {
  if (!id || id === old) return
  activeTab.value = 'progress'
  Object.assign(rec, { list: [], total: 0, typeFilter: '', page: 1, error: '' })
  load()
})
</script>

<style scoped>
.close-asset { margin-top: 12px; padding: 10px 12px; border-radius: 8px; background: var(--el-fill-color-light); }
.close-asset .muted-sm { font-size: 12px; color: var(--el-text-color-secondary); margin-top: 2px; }
.admin-project-detail { padding: 12px 16px; }
/* v2.8.1(#1148) 三栏布局: 项目侧栏 + 内容栏 */
.pd-layout { display: grid; grid-template-columns: 284px minmax(0, 1fr); gap: 16px; align-items: start; }
.pd-layout.side-collapsed { grid-template-columns: 56px minmax(0, 1fr); }
/* sticky 的滚动容器是 el-main(顶栏之下, 自带 24px padding): top 以其内容盒起算, 72px 会把侧栏压到自然位置之下 26px(内容栏高于侧栏时才显形)。
   取 -12px = 顶栏下 12px 处开始吸附, 与自然位置(页内 12px + 顶行 34px)不冲突 */
.pd-side { position: sticky; top: -12px; max-height: calc(100vh - 88px); overflow-y: auto; overflow-x: hidden; background: #fff; border: 1px solid #eae7e2; border-radius: 12px; padding: 16px 12px 14px; display: flex; flex-direction: column; gap: 10px; box-sizing: border-box; }
.side-collapsed .pd-side { padding: 10px 6px; align-items: center; }
.pd-side-top { display: flex; justify-content: space-between; align-items: center; width: 100%; height: 24px; } /* 与右侧内容栏第一行(24px 小按钮工具栏)对齐 */
.side-collapsed .pd-side-top { flex-direction: column; gap: 6px; }
.pd-topbar { display: flex; align-items: center; gap: 8px; height: 24px; margin-bottom: 10px; font-size: 13px; }
.pd-back { font-size: 13px; color: #57534e; padding: 0; }
.pd-back:hover { color: #d2521e; }
.pd-topbar-sep { color: #d6d3d1; }
.pd-topbar-name { color: #a8a29e; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pd-toggle { color: #a8a29e; padding: 0; }
.pd-code { font-size: 11px; color: #a8a29e; font-family: ui-monospace, Menlo, monospace; }
.pd-name { font-size: 16px; font-weight: 700; margin: 0 0 6px; color: #1c1917; line-height: 1.35; }
.pd-brief { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #78716c; flex-wrap: wrap; }
.pd-brief-text { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pd-brief-toggle { font-size: 12px; padding: 0; color: #a8a29e; }
.pd-info-detail { margin-top: 8px; }
.pd-tags { display: flex; flex-wrap: wrap; gap: 4px; }
.pd-manager { font-size: 12px; color: #78716c; margin-top: 8px; }
.pd-manager b { color: #1c1917; }
.pd-actions { display: flex; align-items: center; gap: 6px; margin-top: 8px; }
.pd-members-hint { font-size: 11px; color: #a8a29e; margin-left: 2px; }
.pd-progress { margin-top: 12px; }
.pd-progress-head { display: flex; justify-content: space-between; font-size: 12px; color: #78716c; margin-bottom: 4px; }
.pd-progress-head b { color: #1c1917; }
.pd-stats { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-top: 10px; }
.pd-stat { background: #faf9f7; border: 1px solid #f0ede8; border-radius: 8px; padding: 6px 8px; text-align: center; cursor: pointer; }
.pd-stat:hover { border-color: #d2521e; }
.pd-stat-num { font-size: 16px; font-weight: 700; color: #1c1917; }
.pd-stat-label { font-size: 11px; color: #909399; }
.pd-nav { display: flex; flex-direction: column; gap: 2px; border-top: 1px solid #f0ede8; padding-top: 8px; width: 100%; }
.pd-nav-item { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; cursor: pointer; font-size: 13px; color: #5c574f; transition: background .15s; }
.pd-nav-item:hover { background: #f0eee9; color: #1c1917; }
.pd-nav-item.active { background: #1c1917; color: #faf9f7; }
.pd-nav-count { margin-left: auto; font-size: 11px; opacity: .7; font-family: ui-monospace, Menlo, monospace; }
.side-collapsed .pd-nav-item { justify-content: center; padding: 10px 0; }
.pd-block-title { font-size: 12px; font-weight: 700; color: #1c1917; margin-bottom: 6px; }
.pd-wf { border-top: 1px solid #f0ede8; padding-top: 10px; }
.pd-wf-row { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #5c574f; padding: 3px 6px; border-radius: 6px; cursor: pointer; }
.pd-wf-row:hover { background: #f7f4ef; }
.pd-wf-row b { color: #1c1917; font-size: 13px; }
.pd-wf-row b i { font-style: normal; font-size: 10px; color: #909399; font-weight: 400; margin-left: 4px; }
.pd-wf-row b.done { color: #2e7d4f; }
.pd-wf-warn { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; }
.pd-contact { border-top: 1px solid #f0ede8; padding-top: 10px; font-size: 12px; }
.pd-contact-row { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; padding: 2px 0; }
.pd-content { min-width: 0; }
.pd-tabs :deep(.el-tabs__header) { display: none; }
.pd-tabs :deep(.el-tabs__content) { background: #fff; border: 1px solid #eae7e2; border-radius: 12px; padding: 16px; }
@media (max-width: 1000px) { .pd-layout, .pd-layout.side-collapsed { grid-template-columns: 1fr; } .pd-side { position: static; max-height: none; } }

.hero-card { margin-bottom: 16px; }
.hero-head { display: flex; justify-content: space-between; align-items: flex-start; }
.hero-actions { display: flex; align-items: center; gap: 10px; }
.hero-title .code { font-size: 12px; color: #999; }
.hero-title h2 { margin: 6px 0 8px; }
.hero-title .tags { display: flex; gap: 8px; flex-wrap: wrap; }

.hero-progress { display: flex; align-items: center; gap: 12px; margin: 20px 0 4px; }
.hero-progress .label { font-size: 13px; color: #666; white-space: nowrap; }
.hero-progress :deep(.el-progress) { flex: 1; }

.stat-row { display: flex; gap: 12px; margin-top: 20px; flex-wrap: wrap; }
.stat { flex: 1; min-width: 100px; background: #fafafa; border: 1px solid #f0f0f0; border-radius: 8px; padding: 12px 16px; text-align: center; }
.stat-num { font-size: 22px; font-weight: 600; color: #303133; }
.stat-num.money { font-size: 18px; color: #d2521e; }
.stat-label { font-size: 12px; color: #909399; margin-top: 4px; }

.tabs-card :deep(.el-tabs__item) { font-size: 14px; }

/* v2.0.1(#375) 专家圆桌 */
.roundtable { display: flex; gap: 16px; align-items: stretch; }
.rt-left { flex: 1.3; min-width: 0; display: flex; flex-direction: column; border: 1px solid #eae7e2; border-radius: 10px; background: #fbfaf8; }
.rt-right { flex: 1; min-width: 0; }
.rt-stream { flex: 1; overflow-y: auto; padding: 12px; max-height: 46vh; min-height: 320px; }
.rt-msg { background: #fff; border: 1px solid #f0ede8; border-radius: 10px; padding: 8px 12px; margin-bottom: 10px; }
.rt-msg.mine { background: #fdf3ee; border-color: #f5ddce; }
.rt-msg-head { font-size: 12px; font-weight: 700; color: #5c574f; margin-bottom: 4px; }
.rt-msg-body { font-size: 13px; }
.rt-msg-body.typing { color: #909399; }
.rt-msg-body.typing .dots { animation: rt-blink 1s infinite; }
@keyframes rt-blink { 50% { opacity: 0.2; } }
.rt-input { border-top: 1px dashed #eae7e2; padding: 10px 12px; }
.rt-suggests { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; margin-bottom: 8px; } /* v2.0.1(#382) */
.rt-actions { display: flex; align-items: center; gap: 6px; margin-top: 8px; flex-wrap: wrap; }

/* v2.0.0(#368) 交付工作流流水线 */
.wf-card { border-radius: 12px; }
.wf-card :deep(.el-card__body) { padding: 12px 16px; }
.wf-pipeline { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.wf-stage { text-align: center; padding: 4px 12px; border-radius: 8px; cursor: pointer; transition: background 0.2s; min-width: 68px; }
.wf-stage:hover { background: #f7f4ef; }
.wf-num { font-size: 20px; font-weight: 700; color: #1c1917; line-height: 1.2; }
.wf-num.done { color: #2e7d4f; }
.wf-sub { font-size: 11px; color: #909399; font-weight: 400; margin-left: 4px; }
.wf-label { font-size: 12px; color: #868580; margin-top: 2px; white-space: nowrap; }
.wf-arrow { color: #d8d3cb; font-size: 16px; }
.wf-warnings { display: flex; gap: 8px; flex-wrap: wrap; margin-left: auto; }
.block-title { margin: 24px 0 12px; font-size: 14px; color: #303133; border-left: 3px solid #d2521e; padding-left: 8px; }
.section-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }

.finance-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
.finance-item { display: flex; justify-content: space-between; align-items: center; background: #fafafa; border-radius: 6px; padding: 12px 16px; }
.fi-label { font-size: 13px; color: #909399; }
.fi-value { font-size: 16px; font-weight: 600; color: #303133; }
.fi-value.success { color: #2e7d4f; }
.fi-value.warning { color: #b3450f; }

.act-tag { display: inline-block; font-size: 11px; color: #d2521e; margin-right: 4px; }

.ms-item { display: flex; align-items: center; gap: 8px; }
.ms-done { font-size: 12px; color: #2e7d4f; }
.ms-desc { margin: 4px 0 0; font-size: 12px; color: #909399; }
/* v1.9.3 里程碑负责人 + 任务进度 */
.ms-owner { display: inline-flex; align-items: center; gap: 4px; }
.ms-owner-name { font-size: 12px; color: #57534e; }
.ms-progress { display: flex; align-items: center; gap: 10px; margin-top: 6px; flex-wrap: wrap; }
.ms-chips { display: inline-flex; gap: 6px; flex-wrap: wrap; }
.muted-hint { font-size: 12px; color: #909399; }
/* v1.9.4 里程碑全貌 + 进展统计 */
.ms-overview { background: #faf9f7; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; display: flex; flex-direction: column; gap: 8px; }
.ms-ov-item { display: flex; align-items: center; gap: 12px; }
.ms-ov-label { font-size: 13px; color: #57534e; width: 82px; }
.ms-ov-num { font-size: 12px; color: #868580; min-width: 48px; }
.ms-completed { margin-top: 12px; }
.stats-section { margin-bottom: 20px; }
.stats-tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 14px; }
.stat-tile { background: #faf9f7; border-radius: 8px; padding: 12px; text-align: center; }
.stat-tile-num { font-size: 20px; font-weight: 700; color: #1c1917; }
.stat-tile-label { font-size: 12px; color: #868580; margin-top: 2px; }
.charts-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
.chart-box { background: #fff; border: 1px solid #f0efec; border-radius: 8px; padding: 10px 12px; }
.chart-title { font-size: 13px; font-weight: 600; color: #1c1917; margin-bottom: 4px; }
.chart-el { height: 220px; }
/* v1.9.6 会议录音 */
.rec-timer { font-size: 13px; color: #c02b2b; font-variant-numeric: tabular-nums; }
.rec-audio { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
.row-ops { margin-left: auto; }

.issue-row { display: flex; align-items: center; gap: 8px; padding: 8px 0; border-bottom: 1px solid #f5f5f5; }
.issue-title { flex: 1; font-size: 13px; }
.form-tip { font-size: 12px; color: #909399; margin-top: 4px; line-height: 1.4; }

.block-head { display: flex; justify-content: space-between; align-items: center; }
.block-head-right { display: flex; align-items: center; gap: 12px; }
.muted { font-size: 12px; color: #909399; }
.act-item { padding-bottom: 2px; }
.act-title { font-size: 14px; color: #303133; line-height: 1.5; word-break: break-word; }
.act-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; margin-top: 6px; font-size: 12px; color: #909399; }
.act-meta .act-author { display: inline-flex; align-items: center; gap: 3px; }
.act-branch { color: #b3450f; background: #fbeee7; border-radius: 4px; padding: 1px 6px; font-family: monospace; }
.act-sha { font-family: monospace; color: #909399; }

/* v1.4.0 客户意见 */
.fb-content { font-size: 13px; color: #303133; line-height: 1.7; white-space: pre-wrap; margin-bottom: 8px; }
.fb-reply { background: #f8f9fa; border-radius: 8px; padding: 8px 12px; margin-top: 8px; font-size: 13px; line-height: 1.6; }
.fb-reply.internal { background: #fdf3ee; }
.fb-actions { display: flex; gap: 8px; margin-top: 10px; align-items: center; }

/* v1.3.0 周报正文 */

/* 知识库阅读弹窗 (2026-07-31) */
.kb-reader-meta { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px dashed #ebeef5; }
.kb-reader-info { font-size: 12px; color: #a8a29e; margin-left: auto; }
.kb-reader-body { max-height: 62vh; overflow-y: auto; line-height: 1.8; font-size: 14px; color: #1c1917; }
.kb-reader-body :deep(h1) { font-size: 20px; margin: 16px 0 10px; }
.kb-reader-body :deep(h2) { font-size: 17px; margin: 14px 0 8px; }
.kb-reader-body :deep(h3) { font-size: 15px; margin: 12px 0 6px; }
.kb-reader-body :deep(p) { margin: 8px 0; }
.kb-reader-body :deep(ul), .kb-reader-body :deep(ol) { padding-left: 22px; margin: 6px 0; }
.kb-reader-body :deep(li) { margin: 3px 0; }
.kb-reader-body :deep(code) { background: #f5f5f4; padding: 1px 6px; border-radius: 4px; font-size: 13px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.kb-reader-body :deep(pre) { background: #1c1917; color: #e7e5e4; padding: 12px 14px; border-radius: 8px; overflow-x: auto; }
.kb-reader-body :deep(pre code) { background: none; color: inherit; padding: 0; }
.kb-reader-body :deep(blockquote) { border-left: 3px solid #d2521e; margin: 8px 0; padding: 4px 12px; color: #57534e; background: #faf9f7; }
.kb-reader-body :deep(table) { border-collapse: collapse; margin: 10px 0; }
.kb-reader-body :deep(th), .kb-reader-body :deep(td) { border: 1px solid #e7e5e4; padding: 6px 10px; font-size: 13px; }
.kb-reader-body :deep(img) { max-width: 100%; }

/* 概览弹窗: 危险操作区 */
.danger-zone {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  border: 1px solid rgba(194, 54, 43, 0.35);
  border-radius: 8px;
  background: rgba(194, 54, 43, 0.04);
}
.danger-hint { font-size: 13px; color: #57534e; line-height: 1.6; }

/* 任务看板 (2026-07-31 自进展拆出, 样式与任务管理页看板同款) */
.board-controls { display: flex; align-items: center; gap: 12px; }
/* v1.9.13(#363): 列最小宽度兜底, 空列/窄屏不再被压瘪, 放不下时横向滚动 */
.kanban { display: grid; grid-template-columns: repeat(5, minmax(200px, 1fr)); gap: 12px; overflow-x: auto; }
.kanban-col { background: #f8f9fa; border-radius: 10px; padding: 8px; min-height: 400px; }
.col-head {
  background: white;
  padding: 10px 14px;
  border-radius: 6px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  border-top: 3px solid #909399;
  font-weight: 600;
}
.col-title { font-size: 14px; }
.col-count {
  background: #f0f0f0;
  color: #606266;
  font-size: 12px;
  padding: 1px 8px;
  border-radius: 10px;
}
.col-body { display: flex; flex-direction: column; gap: 8px; }
.task-card {
  background: white;
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  border: 1px solid transparent;
  transition: all 0.2s;
}
.task-card:hover { border-color: #d2521e; box-shadow: 0 4px 12px rgba(210, 82, 30, 0.1); }
.task-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
.head-left { display: flex; align-items: center; gap: 6px; } /* v1.9.13(#366) */
.task-no { font-size: 11px; color: #909399; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.task-milestone { font-size: 11px; color: #909399; max-width: 60%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.task-title { font-weight: 600; font-size: 14px; color: #1c1917; margin-bottom: 4px; line-height: 1.4; }
/* v2.12.0(#1255): 标题+徽标, 窄屏堆叠 */
.task-title-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 4px; }
.task-title-row .task-title { margin-bottom: 0; }
.table-title-cell { margin-bottom: 4px; }
.task-desc { font-size: 12px; color: #868580; line-height: 1.5; max-height: 36px; overflow: hidden; margin-bottom: 8px; }
.task-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
.task-assignee { display: flex; align-items: center; gap: 6px; }
.aname { font-size: 12px; }
.aname.muted { color: #c0c4cc; }
.task-due { font-size: 11px; color: #606266; }
.task-due.overdue { color: #c2362b; font-weight: 600; }
.task-planned { font-size: 11px; color: #b3771e; margin-top: 6px; } /* v1.9.7(#353): 计划起止 */
.task-blocked { font-size: 11px; color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 4px; padding: 1px 6px; display: inline-block; margin: 2px 0 4px; } /* v2.8.0(#1144) */

/* v1.9.8(#350): 需求清单抽屉 */
.req-badge :deep(.el-badge__content) { background: #d2521e; }
.req-batch-bar { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; padding: 8px 10px; background: #faf9f7; border: 1px dashed #eae7e2; border-radius: 8px; } /* v2.0.1(#399) */

/* v2.0.8(#424): 语音速录 */
.voice-quick-bar { display: flex; align-items: center; gap: 8px; margin-bottom: 12px; padding: 8px 10px; background: #fffbeb; border: 1px dashed #f5deb3; border-radius: 8px; }
.voice-stage { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 16px 0 6px; }
.voice-hint { font-size: 13px; color: #78716c; }
/* v2.1.1(#456) 录音中的停止按钮: 红色呼吸脉冲提示可点击停止 */
.voice-stop-btn { animation: voice-pulse 1.2s ease-in-out infinite; }
@keyframes voice-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(220, 38, 38, 0.5); }
  50% { box-shadow: 0 0 0 10px rgba(220, 38, 38, 0); }
}
.voice-raw { font-size: 12px; color: #a8a29e; line-height: 1.7; white-space: pre-wrap; }

/* v2.0.8(#426): 进展Tab底部panel默认收起 */
.bottom-panel { border-top: 1px dashed #eae7e2; border-bottom: none; margin-top: 16px; }
.bottom-panel :deep(.el-collapse-item__header) { background: #faf9f7; padding: 0 10px; border-radius: 8px; }
.bp-title { font-weight: 600; font-size: 13px; margin-right: 10px; }
.bp-summary { font-size: 12px; }

/* v2.0.9(#434): 巡检 agent 可见性横幅 */
.patrol-banner { display: flex; align-items: center; gap: 8px; padding: 7px 12px; margin-bottom: 12px; background: #fffbeb; border: 1px dashed #f5deb3; border-radius: 8px; font-size: 13px; }
.patrol-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; animation: patrol-pulse 1.6s ease-in-out infinite; flex: none; }
.patrol-activity { color: #a8a29e; font-size: 12px; margin-left: 4px; }
@keyframes patrol-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }

/* v2.0.8(#437): 顶部信息卡默认收起 */
.hero-collapse { margin-bottom: 16px; border: none; }
.hero-collapse :deep(.el-collapse-item__header) { height: auto; padding: 10px 14px; background: #faf9f7; border-radius: 10px; border: 1px solid #f0ede8; }
.hero-collapse :deep(.el-collapse-item__wrap) { border: none; }
.hero-brief { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; min-width: 0; }
.hero-brief-name { font-size: 16px; font-weight: 700; margin: 0; color: #1c1917; }
.hero-brief-hint { font-size: 12px; color: #a8a29e; margin-left: auto; }
.req-item { background: #faf9f7; border: 1px solid #eae7e2; border-radius: 8px; padding: 12px; margin-bottom: 10px; }
.req-item.rejected { opacity: 0.55; }
/* v2.6.1: 已生成任务/里程碑的需求淡化+绿边, 与待落地的一眼区分, 减少误操作 */
.req-item.landed { border-left: 3px solid #67c23a; background: #f6faf4; }
/* v2.1.13(#560): 草稿期无责任人高亮 —— 确认前必须指认 */
.req-item.unowned { border-left: 3px solid #e6a23c; background: #fdf8ef; }
.req-owner :deep(.owner-missing .el-select__wrapper) { box-shadow: 0 0 0 1px #e6a23c inset; }
.req-owner :deep(.owner-missing .el-select__placeholder) { color: #b3771e; }
.req-head { display: flex; align-items: center; gap: 8px; }
.req-title { flex: 1; font-size: 14px; color: #1c1917; }
.req-detail { font-size: 13px; color: #5c574f; line-height: 1.6; margin-top: 6px; white-space: pre-wrap; }
.req-meta { display: flex; align-items: center; gap: 12px; margin-top: 8px; font-size: 12px; }
.req-meta .row-ops { margin-left: auto; display: flex; gap: 4px; }

/* v1.9.11(#360): 记录卡片上的需求/任务关联摘要 */
/* v2.0.0(#370) 记录正文 Markdown 排版: 推文风格 —— 层次分明、留白充足
   (此前 .md-like 无任何样式, 正文按浏览器默认渲染挤成一团) */
.md-like { line-height: 1.85; font-size: 14px; color: #3f3b36; }
.md-like :deep(h1), .md-like :deep(h2) { font-size: 16px; font-weight: 700; color: #1c1917; margin: 18px 0 10px; padding-left: 9px; border-left: 3px solid #d2521e; }
.md-like :deep(h3), .md-like :deep(h4) { font-size: 14px; font-weight: 700; color: #1c1917; margin: 14px 0 8px; }
.md-like :deep(p) { margin: 10px 0; }
.md-like :deep(ul), .md-like :deep(ol) { padding-left: 22px; margin: 10px 0; }
.md-like :deep(li) { margin: 6px 0; }
.md-like :deep(li > ul), .md-like :deep(li > ol) { margin: 4px 0; }
.md-like :deep(strong) { color: #b3450f; }
.md-like :deep(code) { background: #f0eee9; padding: 1px 6px; border-radius: 4px; font-size: 12.5px; }
.md-like :deep(pre) { background: #1c1917; color: #faf9f7; padding: 12px 14px; border-radius: 8px; overflow-x: auto; margin: 12px 0; }
.md-like :deep(pre code) { background: transparent; color: inherit; padding: 0; }
.md-like :deep(blockquote) { border-left: 3px solid #e8c4a0; background: #fdf8f2; margin: 12px 0; padding: 8px 14px; color: #6b6459; border-radius: 0 6px 6px 0; }
.md-like :deep(hr) { border: none; border-top: 1px dashed #e5e1da; margin: 16px 0; }
.md-like :deep(table) { border-collapse: collapse; margin: 12px 0; }
.md-like :deep(th), .md-like :deep(td) { border: 1px solid #eae7e2; padding: 6px 12px; font-size: 13px; }
.md-like :deep(th) { background: #faf8f5; }
.md-like :deep(*:first-child) { margin-top: 0; }
.md-like :deep(*:last-child) { margin-bottom: 0; }

/* v2.0.5(#412) 说话人时间线 */
.spk-section { border: 1px solid #eae7e2; border-radius: 10px; margin-bottom: 12px; background: #fbfaf8; }
.spk-head { padding: 10px 14px; font-weight: 600; font-size: 13px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; }
.spk-blocks { padding: 0 14px 10px; display: flex; flex-direction: column; gap: 8px; max-height: 320px; overflow-y: auto; }
.spk-block { background: #fff; border: 1px solid #f0ede8; border-radius: 8px; padding: 8px 12px; }
.spk-block-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.spk-block-text { font-size: 13px; line-height: 1.7; color: #3f3b36; }

/* v2.0.1(#400) 简洁列表 */
.rec-title-link { cursor: pointer; }
.rec-title-link:hover { color: #d2521e; }
.rec-brief { margin-top: 4px; font-size: 12px; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rec-brief:hover { color: #d2521e; }

.rec-reqs { margin-top: 8px; background: #faf9f7; border: 1px dashed #eae7e2; border-radius: 8px; padding: 8px 10px; font-size: 13px; }
.rec-reqs-summary { cursor: pointer; user-select: none; color: #5c574f; }
.rec-reqs-summary:hover { color: #d2521e; }
.rec-reqs-list { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }
.rec-req-row { display: flex; align-items: center; gap: 6px; }
.rec-req-row.rejected { opacity: 0.55; }
.rec-req-title { flex: 1; color: #1c1917; }

/* v1.9.11(#359): 会议模式 */
/* v2.0.1(#383): 会前排版重设计 —— 居中卡片 */
.prep-card { background: #fff; border: 1px solid #eae7e2; border-radius: 16px; padding: 28px 32px; box-shadow: 0 6px 24px rgba(28, 25, 23, 0.05); }
.prep-head { text-align: center; margin-bottom: 20px; }
.prep-title { font-size: 20px; font-weight: 700; color: #1c1917; }
.prep-title::before { content: '🎙️ '; }
.prep-sub { font-size: 13px; color: #868580; margin-top: 6px; }
.prep-actions { display: flex; justify-content: center; gap: 12px; margin-top: 6px; }
.task-progress { display: flex; align-items: center; gap: 6px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #f0f0f0; }
.task-progress :deep(.el-progress) { flex: 1; }
.prog-text { font-size: 10px; color: #909399; }
.task-actions { display: flex; gap: 8px; margin-top: 8px; padding-top: 8px; border-top: 1px dashed #ebeef5; }

/* v1.6.0 Agent 对话查看 */
.conv-msgs { max-height: 60vh; overflow-y: auto; padding: 4px 2px; }
.conv-msg { margin-bottom: 14px; }
.conv-role { font-size: 12px; color: #909399; margin-bottom: 4px; }
.conv-bubble { background: #f7f7f4; border-radius: 8px; padding: 10px 12px; font-size: 13px; line-height: 1.6; }
.conv-msg.from-user .conv-bubble { background: rgba(210, 82, 30, 0.06); }
/* v2.1.6(#489) 客户联系卡 */
.contact-card { margin-bottom: 12px; }
.contact-card :deep(.el-card__body) { padding: 10px 16px; }
.contact-line { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; font-size: 13px; }
.contact-customer { font-weight: 600; color: #3b322c; }
.contact-chip { display: inline-flex; align-items: center; gap: 6px; background: #faf6f0; border: 1px solid #eee3d6; border-radius: 8px; padding: 3px 10px; }
.contact-primary { background: #d2521e; color: #fff; border-radius: 4px; font-size: 10px; padding: 0 4px; }
.contact-sub { color: #98897e; font-size: 12px; }
.contact-empty { color: #b8a99b; font-size: 12px; }
/* v2.1.6(#490) 客户评价页签 */

/* ===== H5 适配 (#1250) ===== */
/* 已有的 @media(1000px) 把 pd-layout 主框架单栏化, 这里处理其余多栏/宽组件 */
@media (max-width: 767px) {
  .admin-project-detail { padding: 4px; }
  /* #1251: 项目侧栏改抽屉 —— 默认固定在屏幕左侧之外, 内容独占整宽;
     打开时滑入并盖在内容之上, 遮罩可点关。覆盖 @media(1000px) 的 static 堆叠 */
  .pd-layout, .pd-layout.side-collapsed { grid-template-columns: minmax(0, 1fr); position: relative; }
  .pd-side {
    position: fixed; top: 0; left: 0; z-index: 1200;
    height: 100vh; max-height: none; width: 270px;
    border-radius: 0; transform: translateX(-100%);
    transition: transform .2s ease; overflow-y: auto;
  }
  .pd-layout.pd-side-open .pd-side { transform: translateX(0); }
  .pd-side-mask {
    position: fixed; inset: 0; z-index: 1100;
    background: rgba(28, 25, 23, 0.4);
    opacity: 0; pointer-events: none; transition: opacity .2s;
  }
  .pd-layout.pd-side-open .pd-side-mask { opacity: 1; pointer-events: auto; }
  /* 手机上侧栏不再有 collapsed 态的窄条, 信息一律展开 */
  .pd-side .pd-toggle { display: none; }
  /* 顶栏唤出按钮紧贴右侧 */
  .pd-side-open { margin-left: auto; }
  /* 内容卡里的两/四列网格一律单栏, 图表(echarts 会自适应容器) */
  .stats-tiles { grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .charts-row, .finance-grid { grid-template-columns: 1fr; gap: 10px; }
  .chart-box { padding: 8px; }
  .chart-el { height: 190px; }
  /* Tab 内容卡收紧 padding */
  .pd-tabs :deep(.el-tabs__content) { padding: 10px; border-radius: 10px; }
  /* 专家圆桌左右栏堆叠, 聊天区限高放宽 */
  .roundtable { flex-direction: column; gap: 10px; }
  .rt-stream { min-height: 220px; max-height: 52vh; }
  /* 页面内看板五列横向滑动, 惯性滚动, 列宽露半列提示可滑 */
  .kanban { grid-template-columns: repeat(5, minmax(170px, 72vw)); -webkit-overflow-scrolling: touch; }
  .kanban-col { min-height: 300px; }
  /* 信息行允许换行, 不被 ellipsis 截断 */
  .pd-brief-text { white-space: normal; }
  .contact-line { gap: 8px; }
  /* 会前/会中卡片: 大字号计时器与 padding 收缩 */
  .prep-card { padding: 20px 18px; }
  /* 危险操作区允许堆叠 */
  .danger-zone { flex-direction: column; align-items: stretch; gap: 8px; }
  /* 统计数字行在窄屏可横向滚动而不是把卡片压瘪 */
  .stat-row { flex-wrap: nowrap; overflow-x: auto; }
  .stat { min-width: 104px; flex: 0 0 auto; }
  /* 交付流水线换行即可(已是 flex-wrap) */
  .wf-warnings { margin-left: 0; }
}

/* v2.12.0(#1259) 巡检 agent 抽屉 */
.patrol-list { display: flex; flex-direction: column; gap: 10px; }
.patrol-card { border: 1px solid #eae7e2; border-radius: 10px; padding: 10px 12px; background: #fff; }
.patrol-card.offline { opacity: .65; background: #faf9f7; }
.patrol-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.patrol-name { font-weight: 600; font-size: 13px; }
.patrol-activity { font-size: 12px; color: #57534e; margin-top: 6px; }
.patrol-task { font-size: 12px; color: #2e7d4f; margin-top: 4px; }
.patrol-beat { font-size: 11px; color: #a8a29e; margin-top: 6px; }
</style>
