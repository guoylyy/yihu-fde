<template>
  <el-container class="admin-layout">
    <!-- v2.8.1(#1148): 侧栏可收缩成 64px 纯图标(记 localStorage), 给项目规划/内容留空间 -->
    <!-- H5(#1250): 手机上侧栏改抽屉, 加 mobile-hidden 只在桌面显示 -->
    <el-aside :width="sidebarCollapsed ? '64px' : '220px'" class="sidebar mobile-hidden" :class="{ collapsed: sidebarCollapsed }">
      <div class="logo" :title="sidebarCollapsed ? brand.name : ''">
        <BrandMark :size="24" />
        <span v-if="!sidebarCollapsed" class="logo-name">{{ brand.name }}</span>
        <span v-if="!sidebarCollapsed" class="logo-badge">{{ $t('common.console') }}</span>
      </div>
      <el-menu
        :default-active="route.path"
        :default-openeds="[]"
        router
        :collapse="sidebarCollapsed"
        :collapse-transition="false"
        :unique-opened="true"
        class="menu"
      >
        <!-- v2.6.0(#959) 我的工作台: 个人要做/要交/要批/要报的事都在这一页 -->
        <el-menu-item index="/admin/workbench">
          <BrandMark :size="16" :dark="route.path === '/admin/workbench'" class="menu-claw" />
          <span>{{ $t('common.my_workbench') }}</span>
        </el-menu-item>

        <!-- #1273 文档中心: 使用文档/上手教程的入口, 全员可见 -->
        <el-menu-item index="/docs">
          <el-icon><Reading /></el-icon>
          <span>{{ $t('layout.docs') }}</span>
        </el-menu-item>

        <!-- v2.10.0(#1180) 创意中心: 生产流程最前端, 想法从这里进来再分到项目 -->
        <el-menu-item v-if="can('idea.view')" index="/admin/ideas">
          <el-icon><Opportunity /></el-icon>
          <span>{{ $t('common.ideas') }}</span>
        </el-menu-item>

        <!-- 项目交付 (2026-07-31 主人拍板: 提到仅次于仪表盘, 交付是主业) -->
        <el-sub-menu index="biz">
          <template #title>
            <BrandMark :size="16" class="menu-claw" />
            <span>{{ $t('layout.delivery') }}</span>
          </template>
          <el-menu-item v-if="can('projects')" index="/admin/projects">
            <el-icon><Document /></el-icon>
            <span>{{ $t('common.projects') }}</span>
          </el-menu-item>
          <el-menu-item v-if="can('project.view') || user?.role === 'FDE_ENGINEER'" index="/admin/tasks">
            <el-icon><List /></el-icon>
            <span>{{ $t('common.tasks') }}</span>
          </el-menu-item>
          <el-menu-item v-if="can('timesheets')" index="/admin/timesheets">
            <el-icon><Clock /></el-icon>
            <span>{{ $t('common.hours') }}</span>
          </el-menu-item>
          <!-- v2.0.8(#433): 客户管理从经营销售组移入 -->
          <el-menu-item v-if="can('customers')" index="/admin/customers">
            <el-icon><User /></el-icon>
            <span>{{ $t('common.customers') }}</span>
          </el-menu-item>
          <el-menu-item v-if="can('knowledge')" index="/admin/knowledge">
            <el-icon><Reading /></el-icon>
            <span>{{ $t('common.knowledge_base') }}</span>
          </el-menu-item>
          <!-- v2.7(#1140): 项目资产库 —— 做过的东西下一个项目直接拿来用 -->
          <el-menu-item v-if="can('asset.view')" index="/admin/assets">
            <el-icon><Files /></el-icon>
            <span>{{ $t('common.asset_library') }}</span>
          </el-menu-item>
          <!-- v2.0.9(#429): Skills 能力包 -->
          <el-menu-item v-if="can('skillPackage.view')" index="/admin/skill-packages">
            <el-icon><MagicStick /></el-icon>
            <span>Skills</span>
          </el-menu-item>
          <!-- v2.0.0 开发上手中心(#367): 全员可见, 2026-10-02 从顶级菜单移入交付组 -->
          <el-menu-item index="/admin/onboarding">
            <el-icon><Guide /></el-icon>
            <span>{{ $t('common.developer_onboarding') }}</span>
          </el-menu-item>
        </el-sub-menu>


        <!-- 基础配置 (2026-07-20) -->
        <el-sub-menu v-if="can('engineers') || can('users') || can('rolePermission.manage') || can('team.manage')" index="base-config">
          <template #title>
            <BrandMark :size="16" class="menu-claw" />
            <span>{{ $t('layout.settings') }}</span>
          </template>
          <el-menu-item v-if="can('engineers')" index="/admin/engineers">
            <el-icon><Avatar /></el-icon>
            <span>{{ $t('layout.engineer_management') }}</span>
          </el-menu-item>
          <el-menu-item v-if="can('engineers')" index="/admin/engineer-profiles">
            <el-icon><DataAnalysis /></el-icon>
            <span>{{ $t('layout.skill_matrix') }}</span>
          </el-menu-item>
          <el-menu-item v-if="can('users')" index="/admin/users">
            <el-icon><UserFilled /></el-icon>
            <span>{{ $t('common.users') }}</span>
          </el-menu-item>
          <el-menu-item v-if="can('role.manage')" index="/admin/roles">
            <el-icon><UserFilled /></el-icon>
            <span>{{ $t('common.roles') }}</span>
          </el-menu-item>
          <!-- v1.5.6 团队管理 (一人可属多团队, 即时消息通知按团队定位); v1.8.0 改名「公司团队管理」与小组管理区分 -->
          <el-menu-item v-if="can('team.manage')" index="/admin/teams">
            <el-icon><Avatar /></el-icon>
            <span>{{ $t('common.team_management') }}</span>
          </el-menu-item>
          <el-menu-item v-if="can('rolePermission.manage')" index="/admin/role-permissions">
            <el-icon><Key /></el-icon>
            <span>{{ $t('common.role_permissions') }}</span>
          </el-menu-item>
          <!-- 2026-07-31 大模型配置 (基础模块, 仅 ADMIN) -->
          <el-menu-item v-if="can('llmConfig.manage')" index="/admin/llm-configs">
            <el-icon><Cpu /></el-icon>
            <span>{{ $t('common.llm_settings') }}</span>
          </el-menu-item>
        </el-sub-menu>


        <!-- v1.6.4: Agent 协作入口挪至右上角个人头像下拉菜单 -->

        <!-- v2.1.1(#457) 意见与 Bug 反馈下线: 问题反馈已改走会议链路, 菜单摘除, 组件与后端保留可逆 -->

        <!-- 系统 -->
      </el-menu>
    </el-aside>
    <!-- sidebar 为 fixed 脱离文档流, content-wrap 用 margin-left 让位 -->
    <el-container class="content-wrap" :class="{ 'is-collapsed': sidebarCollapsed }">
      <el-header class="header">
        <div class="header-left">
          <el-tooltip :content="sidebarCollapsed ? $t('layout.expand_menu') : $t('layout.collapse_menu')" placement="bottom">
            <el-button text class="collapse-btn" @click="toggleSidebar">
              <el-icon :size="18"><component :is="sidebarCollapsed ? Expand : Fold" /></el-icon>
            </el-button>
          </el-tooltip>
          <div class="breadcrumb">{{ pageTitle }}</div>
        </div>
        <div class="header-right">
          <el-popover v-model:visible="notifVisible" placement="bottom" :width="380" trigger="click" @show="loadNotifs">
            <template #reference>
              <el-badge :value="unreadCount" :hidden="unreadCount === 0" :max="99" class="todo-bell">
                <el-button text class="bell-btn">
                  <el-icon :size="20"><Bell /></el-icon>
                </el-button>
              </el-badge>
            </template>
            <div class="notif-popover">
              <div class="notif-head">
                <span class="notif-title">{{ $t('layout.notifications') }}</span>
                <div class="notif-actions">
                  <el-button v-if="unreadCount > 0" link size="small" type="primary" @click="markAllRead">{{ $t('layout.mark_all_read') }}</el-button>
                </div>
              </div>
              <div class="notif-list">
                <el-empty v-if="!notifList.length" :image-size="60" :description="$t('common.no_notifications')" />
                <div v-for="n in notifList" :key="n.id" :class="['notif-item', !n.readAt && 'unread']" @click="handleNotif(n)">
                  <div class="notif-row">
                    <strong>{{ n.title }}</strong>
                    <span class="notif-time">{{ relativeTime(n.createdAt) }}</span>
                  </div>
                  <div v-if="n.body" class="notif-body">{{ n.body }}</div>
                  <div class="notif-foot">
                    <el-tag size="small" effect="plain">{{ n.type }}</el-tag>
                    <el-button v-if="!n.readAt" link size="small" type="primary" @click.stop="markRead(n)">{{ $t('common.mark_read') }}</el-button>
                  </div>
                </div>
              </div>
              <div class="notif-foot-bar">
                <el-button link size="small" @click="goNotif">{{ $t('layout.view_all') }}</el-button>
              </div>
            </div>
          </el-popover>
          <LangSwitch compact />
          <span v-if="user" class="role-tag">{{ roleLabel }}</span>
          <el-dropdown @command="onCommand">
            <span class="user-name">
              <el-avatar :size="26" :src="user?.avatarUrl || undefined" style="margin-right: 2px; background: #f0eee9; color: #1c1917; font-size: 13px;">
                {{ (user?.name || user?.username || '?').slice(0, 1) }}
              </el-avatar>
              {{ user?.name || user?.username }}
              <el-icon><ArrowDown /></el-icon>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <!-- v1.2.8: 个人中心 -->
                <el-dropdown-item command="profile">
                  <el-icon><UserFilled /></el-icon>{{ $t('layout.profile') }}
                </el-dropdown-item>
                <!-- v1.6.4: Agent 协作从侧边栏挪进个人菜单(个人配置属性, 主人拍板) -->
                <el-dropdown-item command="agents" :divided="true">
                  <el-icon><Connection /></el-icon>{{ $t('common.agents') }}
                </el-dropdown-item>
                <el-dropdown-item v-if="can('apiKey.manage')" command="api-keys">
                  <el-icon><Key /></el-icon>{{ $t('common.api_keys') }}
                </el-dropdown-item>
                <el-dropdown-item v-if="can('audit.list')" command="audit-logs">
                  <el-icon><List /></el-icon>{{ $t('common.audit_log') }}
                </el-dropdown-item>
                <el-dropdown-item command="logout" :divided="true">{{ $t('common.sign_out') }}</el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>
      <el-main class="main">
        <router-view />
      </el-main>
    </el-container>
    <!-- H5(#1250): 手机抽屉菜单, 桌面隐藏; 菜单项与桌面侧栏同一份 -->
    <el-drawer v-model="mobileMenuVisible" :with-header="false" size="260px" direction="ltr"
      class="mobile-menu-drawer mobile-only" :modal="true">
      <div class="mobile-menu">
        <div class="logo">
          <BrandMark :size="24" />
          <span class="logo-name">{{ brand.name }}</span>
        </div>
        <el-menu
          :default-active="route.path"
          router
          :collapse-transition="false"
          :unique-opened="true"
          class="menu"
          @select="mobileMenuVisible = false"
        >
          <el-menu-item index="/admin/workbench">
            <BrandMark :size="16" :dark="route.path === '/admin/workbench'" class="menu-claw" />
            <span>{{ $t('common.my_workbench') }}</span>
          </el-menu-item>
          <el-menu-item index="/docs">
            <el-icon><Reading /></el-icon><span>{{ $t('layout.docs') }}</span>
          </el-menu-item>
          <el-menu-item v-if="can('idea.view')" index="/admin/ideas">
            <el-icon><Opportunity /></el-icon><span>{{ $t('common.ideas') }}</span>
          </el-menu-item>
          <el-sub-menu index="biz">
            <template #title>
              <BrandMark :size="16" class="menu-claw" /><span>{{ $t('layout.delivery') }}</span>
            </template>
            <el-menu-item v-if="can('projects')" index="/admin/projects">
              <el-icon><Document /></el-icon><span>{{ $t('common.projects') }}</span>
            </el-menu-item>
            <el-menu-item v-if="can('project.view') || user?.role === 'FDE_ENGINEER'" index="/admin/tasks">
              <el-icon><List /></el-icon><span>{{ $t('common.tasks') }}</span>
            </el-menu-item>
            <el-menu-item v-if="can('timesheets')" index="/admin/timesheets">
              <el-icon><Clock /></el-icon><span>{{ $t('common.hours') }}</span>
            </el-menu-item>
            <el-menu-item v-if="can('customers')" index="/admin/customers">
              <el-icon><User /></el-icon><span>{{ $t('common.customers') }}</span>
            </el-menu-item>
            <el-menu-item v-if="can('knowledge')" index="/admin/knowledge">
              <el-icon><Reading /></el-icon><span>{{ $t('common.knowledge_base') }}</span>
            </el-menu-item>
            <el-menu-item v-if="can('asset.view')" index="/admin/assets">
              <el-icon><Files /></el-icon><span>{{ $t('common.asset_library') }}</span>
            </el-menu-item>
            <el-menu-item v-if="can('skillPackage.view')" index="/admin/skill-packages">
              <el-icon><MagicStick /></el-icon><span>Skills</span>
            </el-menu-item>
            <el-menu-item index="/admin/onboarding">
              <el-icon><Guide /></el-icon><span>{{ $t('common.developer_onboarding') }}</span>
            </el-menu-item>
          </el-sub-menu>
          <el-sub-menu v-if="can('engineers') || can('users') || can('rolePermission.manage') || can('team.manage')" index="base-config">
            <template #title>
              <BrandMark :size="16" class="menu-claw" /><span>{{ $t('layout.settings') }}</span>
            </template>
            <el-menu-item v-if="can('engineers')" index="/admin/engineers">
              <el-icon><Avatar /></el-icon><span>{{ $t('layout.engineer_management') }}</span>
            </el-menu-item>
            <el-menu-item v-if="can('engineers')" index="/admin/engineer-profiles">
              <el-icon><DataAnalysis /></el-icon><span>{{ $t('layout.skill_matrix') }}</span>
            </el-menu-item>
            <el-menu-item v-if="can('users')" index="/admin/users">
              <el-icon><UserFilled /></el-icon><span>{{ $t('common.users') }}</span>
            </el-menu-item>
            <el-menu-item v-if="can('team.manage')" index="/admin/teams">
              <el-icon><OfficeBuilding /></el-icon><span>{{ $t('common.teams') }}</span>
            </el-menu-item>
            <el-menu-item v-if="can('rolePermission.manage')" index="/admin/roles">
              <el-icon><Checked /></el-icon><span>{{ $t('common.roles') }}</span>
            </el-menu-item>
            <el-menu-item v-if="can('rolePermission.manage')" index="/admin/role-permissions">
              <el-icon><Key /></el-icon><span>{{ $t('common.role_permissions') }}</span>
            </el-menu-item>
            <el-menu-item v-if="can('llmConfig.manage')" index="/admin/llm-configs">
              <el-icon><Cpu /></el-icon><span>{{ $t('common.llm_settings') }}</span>
            </el-menu-item>
          </el-sub-menu>
        </el-menu>
      </div>
    </el-drawer>
  </el-container>
</template>

<script setup>
import { $t } from '@/i18n'
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowDown, Bell, User, Document, Avatar, Clock, UserFilled, List, DataAnalysis, Reading, Key, Cpu, Connection, Checked, MagicStick, Guide, Files, Fold, Expand, Opportunity, OfficeBuilding } from '@element-plus/icons-vue'
import { fde } from '@/api/index.js'
import LangSwitch from '@/components/common/LangSwitch.vue'
import { can as permCan, refreshMyPermissions, clearMyPermissions } from '@/api/permissions.js'
// v2.7.0 多实例: 顶栏与页面标题跟随实例品牌
import { getBrand } from '@/api/edition.js'
const brand = getBrand()
import BrandMark from '@/components/common/BrandMark.vue'
import { openLink } from '@/utils/links.js'
import { ElMessage } from 'element-plus'
import { useResponsive } from '@/composables/useResponsive.js'

const { isMobile } = useResponsive()
// H5(#1250): 手机抽屉菜单
const mobileMenuVisible = ref(false)

const route = useRoute()
const router = useRouter()
// v1.2.9: user 改响应式, 个人中心改头像后顶栏即时刷新
const user = ref(JSON.parse(localStorage.getItem('fde_internal_user') || 'null'))
// v2.8.1(#1148): 全局侧栏收缩态(本机记忆); 项目详情三栏布局下收起它能多出 156px 给内容
const SIDEBAR_KEY = 'fde_sidebar_collapsed'
const sidebarCollapsed = ref(localStorage.getItem(SIDEBAR_KEY) === '1')
function toggleSidebar() {
  // H5(#1250): 手机上同一按钮打开抽屉
  if (isMobile.value) { mobileMenuVisible.value = true; return }
  sidebarCollapsed.value = !sidebarCollapsed.value
  localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed.value ? '1' : '0')
  window.dispatchEvent(new CustomEvent('fde:sidebar-toggle', { detail: { collapsed: sidebarCollapsed.value } }))
}
function onUserUpdated(e) { user.value = e.detail || JSON.parse(localStorage.getItem('fde_internal_user') || 'null') }
window.addEventListener('yh-user-updated', onUserUpdated)

const pendingCount = ref(0)
const unreadCount = ref(0)
const notifVisible = ref(false)
const notifList = ref([])

const titles = {
  '/admin/onboarding': $t('common.developer_onboarding'),
  '/admin/agents': $t('common.agents'),
  '/admin/customers': $t('common.customers'),
  '/admin/projects': $t('common.projects'),
  '/admin/engineers': $t('common.engineers'),
  '/admin/engineer-profiles': $t('common.engineer_skill_matrix'),
  '/admin/timesheets': $t('common.hours'),
  '/admin/users': $t('common.users'),
  '/admin/api-keys': $t('common.api_keys'),
  '/admin/llm-configs': $t('common.llm_settings'),
  '/admin/teams': $t('common.team_management'),
  '/admin/audit-logs': $t('common.audit_log'),
  '/admin/my': $t('common.my_workbench'),
  '/admin/skills': $t('common.skills_2'),
  '/admin/tasks': $t('common.tasks'),
  '/admin/ideas': $t('common.ideas'),
  '/admin/activities': $t('layout.team_activity'),
  '/admin/roles': $t('common.roles'),
  '/admin/role-permissions': $t('common.role_permissions'),
  '/admin/profile': $t('layout.profile')
}
const pageTitle = computed(() => titles[route.path] || $t('layout.console', { p0: brand.name }))

// ── 菜单 -> 权限字符串映射 ──
// 委托给 permissions.js 与后端 PERMISSIONS 保持单一事实源
const MENU_TO_PERM = {
  // 仪表盘此前误映射到 user.view(仅 ADMIN), 且菜单指到 /admin(重定向去我的主页),
  // 导致所有角色都进不了仪表盘页
  customers:   'customer.view',
  projects:    'project.view',
  engineers:   'engineer.view',
  timesheets:  'timesheet.view',
  knowledge:   'knowledge.view',
  users:       'user.view',
  my:          'me.view',
  skills:      'skill.manage',
  tasks:       'task.view',
  activities:  'project.view',
}
// can(permOrMenu):
//   - 如果传的是已知的菜单 key → 取 MENU_TO_PERM 映射的权限
//   - 否则直接当成权限字符串交给 permissions.js (这样 can('lead.view') 也能用)
// permVersion: 服务端生效权限刷新后 +1, 触发菜单重算 (can 在渲染中被调用, 读它即建立依赖)
const permVersion = ref(0)
function can(permOrMenu) {
  permVersion.value // eslint-disable-line no-unused-expressions
  if (MENU_TO_PERM[permOrMenu] !== undefined) {
    return permCan(MENU_TO_PERM[permOrMenu])
  }
  return permCan(permOrMenu)
}

// v1.3.2: 角色名动态取自 roles 表
import { roleLabel as dynRoleLabel, refreshRoles } from '@/api/roles.js'
const roleLabel = computed(() => user.value?.role ? dynRoleLabel(user.value.role) : '')

async function loadPending() {
  if (!can('timesheets')) { pendingCount.value = 0; return }
  try {
    const data = await fde.timesheets.pending({ page: 1, page_size: 1 })
    pendingCount.value = data.total
  } catch (e) { /* 静默失败，不打扰用户 */ }
}

async function loadUnread() {
  if (!user.value) { unreadCount.value = 0; return }
  try {
    const data = await fde.notifications.unreadCount()
    unreadCount.value = data.count
  } catch (e) { unreadCount.value = 0 }
}

async function loadNotifs() {
  try {
    const data = await fde.notifications.list({ page_size: 10 })
    notifList.value = data.list
    unreadCount.value = data.unreadCount
  } catch (e) { /* ignore */ }
}

async function markRead(n) {
  try {
    await fde.notifications.markRead(n.id)
    n.readAt = new Date().toISOString()
    unreadCount.value = Math.max(0, unreadCount.value - 1)
  } catch (e) { ElMessage.error(e.message) }
}

async function markAllRead() {
  try {
    await fde.notifications.readAll()
    notifList.value.forEach(n => { n.readAt = new Date().toISOString() })
    unreadCount.value = 0
  } catch (e) { ElMessage.error(e.message) }
}

function handleNotif(n) {
  if (!n.readAt) markRead(n)
  notifVisible.value = false
  openLink(router, n.link)
}

function goNotif() {
  notifVisible.value = false
  router.push('/admin/notifications')
}

function relativeTime(iso) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return $t('common.just_now')
  if (m < 60) return $t('common.min_ago', { p0: m })
  const h = Math.floor(m / 60)
  if (h < 24) return $t('common.hours_ago', { p0: h })
  const d = Math.floor(h / 24)
  if (d < 30) return $t('common.days_ago', { p0: d })
  return iso.slice(0, 10)
}


let timer = null
onMounted(() => {
  loadPending()
  loadUnread()
  // 刷新服务端生效权限 (管理员可能刚改过角色权限配置), 拉到后触发菜单重算
  refreshMyPermissions().then(r => { if (r) permVersion.value++ })
  // v1.3.2: 刷新角色清单缓存 (角色名/下拉/矩阵列动态化)
  refreshRoles()
  timer = setInterval(() => { loadPending(); loadUnread() }, 60000)
})
onUnmounted(() => { if (timer) clearInterval(timer); window.removeEventListener('yh-user-updated', onUserUpdated) })

function onCommand(cmd) {
  if (cmd === 'logout') {
    localStorage.removeItem('fde_internal_token')
    localStorage.removeItem('fde_internal_user')
    clearMyPermissions()
    router.push('/admin/login')
  } else if (cmd === 'profile') {
    router.push('/admin/profile')
  } else if (cmd === 'agents') {
    router.push('/admin/agents')
  } else if (cmd === 'api-keys') {
    router.push('/admin/api-keys')
  } else if (cmd === 'audit-logs') {
    router.push('/admin/audit-logs')
  }
}
</script>

<style scoped>
/* VI v1.0 控制台版式: 米白侧边栏 + 细描边 + 激活项墨底白字 */
.admin-layout { min-height: 100vh; }
.sidebar {
  /* 固定在视口左侧, 主区滚动时菜单不动; 菜单超长由 .menu 自身滚动 */
  position: fixed;
  top: 0;
  left: 0;
  height: 100vh;
  width: 220px;
  z-index: 100;
  overflow: hidden;
  background: #faf9f7;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #eae7e2;
}
/* sidebar 脱离文档流后, 右侧整体让出 220px */
.content-wrap {
  margin-left: 220px;
  min-height: 100vh;
  transition: margin-left .15s;
}
.content-wrap.is-collapsed { margin-left: 64px; }
/* v2.8.1(#1148) 收缩态: 只留图标; Element 的 collapse 会把 span 藏掉, 爪痕(BrandMark 是 span)要单独救回来 */
.sidebar.collapsed { width: 64px; }   /* .sidebar 的 220px 是固定定位写死的, el-aside 的内联宽度盖不过它 */
.sidebar.collapsed .logo { justify-content: center; padding: 0; }
.sidebar.collapsed .menu { padding: 6px 6px; }
.sidebar.collapsed .menu :deep(.el-menu-item),
.sidebar.collapsed .menu :deep(.el-sub-menu__title) { padding: 0 !important; justify-content: center; }
.sidebar.collapsed .menu :deep(.el-menu-item > .menu-claw),
.sidebar.collapsed .menu :deep(.el-sub-menu__title > .menu-claw) { width: 16px !important; height: 16px !important; visibility: visible !important; margin: 0 !important; }
.sidebar.collapsed .menu :deep(.el-sub-menu__icon-arrow) { display: none; }
.header-left { display: flex; align-items: center; gap: 8px; }
.collapse-btn { padding: 6px 8px; color: #5c574f; }
.collapse-btn:hover { background: #f0eee9; }
.logo {
  height: 60px;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 20px;
  border-bottom: 1px solid #eae7e2;
}
.logo-name {
  font-size: 15px;
  font-weight: 700;
  color: #1c1917;
}
.logo-badge {
  font-family: 'Manrope', sans-serif;
  font-size: 9px;
  font-weight: 600;
  color: #8f8a82;
  letter-spacing: 0.1em;
  border: 1px solid #ddd9d2;
  border-radius: 4px;
  padding: 2px 6px;
}
.menu {
  background: transparent;
  border-right: none;
  flex: 1;
  padding: 6px 10px;
  /* logo 固定在顶部, 菜单项超长时仅菜单区滚动 */
  overflow-y: auto;
}
.menu :deep(.el-menu) {
  background: transparent;
  border-right: none;
}
.menu :deep(.el-menu-item),
.menu :deep(.el-sub-menu__title) {
  border-radius: 8px;
  margin: 1px 0;
  height: 42px;
  line-height: 42px;
}
.menu :deep(.el-menu-item) {
  color: #5c574f;
  font-weight: 500;
}
.menu :deep(.el-menu-item:hover) {
  background: #f0eee9;
  color: #1c1917;
}
.menu :deep(.el-menu-item.is-active) {
  background: #1c1917;
  color: #faf9f7;
}
.menu :deep(.el-sub-menu__title) {
  color: #1c1917;
  font-weight: 500;
  background: transparent;
}
.menu :deep(.el-sub-menu__title:hover) {
  background: #f0eee9;
  color: #1c1917;
}
.menu :deep(.el-sub-menu.is-active > .el-sub-menu__title) {
  color: #1c1917;
  font-weight: 700;
}
.menu :deep(.el-sub-menu .el-menu-item) {
  height: 38px;
  line-height: 38px;
}
/* VI: 一级模块用爪痕替代功能图标; 对齐 el-icon 默认右距 */
.menu-claw {
  margin-right: 10px;
  margin-left: 3px;
  vertical-align: middle;
}
.header {
  /* 吸顶: 半透明+blur 的视觉本就是为悬浮设计的 */
  position: sticky;
  top: 0;
  z-index: 90;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(10px);
  border-bottom: 1px solid #eae7e2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
}
.breadcrumb {
  font-size: 16px;
  font-weight: 700;
  color: #1c1917;
}
.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}
.todo-bell :deep(.el-badge__content) {
  font-size: 11px;
  height: 16px;
  line-height: 16px;
  padding: 0 5px;
}
.bell-btn {
  padding: 6px 8px;
}
.bell-btn:hover {
  background: #f0eee9;
}
.notif-popover { max-height: 500px; }
.notif-head { display: flex; justify-content: space-between; align-items: center; padding-bottom: 8px; border-bottom: 1px solid #ebeef5; }
.notif-title { font-weight: 600; }
.notif-list { max-height: 360px; overflow-y: auto; margin-top: 8px; }
.notif-item {
  padding: 10px;
  border-radius: 6px;
  cursor: pointer;
  margin-bottom: 4px;
  border-left: 3px solid transparent;
}
.notif-item:hover { background: #faf9f7; }
.notif-item.unread { background: #fdf3ee; border-left-color: #d2521e; }
.notif-row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 4px; }
.notif-time { font-size: 11px; color: #909399; }
.notif-body { font-size: 12px; color: #606266; line-height: 1.5; margin-bottom: 4px; }
.notif-foot { display: flex; justify-content: space-between; align-items: center; }
.notif-foot-bar { text-align: center; padding-top: 8px; border-top: 1px solid #ebeef5; }
/* VI: 角色用虎橙强调文字, 不用色块 tag */
.role-tag {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.05em;
  color: #d2521e;
}
.user-name {
  display: flex;
  align-items: center;
  gap: 4px;
  cursor: pointer;
  font-size: 14px;
}
.main {
  background: #faf9f7;
  padding: 24px;
}

/* ===== H5 适配 (#1250) ===== */
/* 手机: 桌面侧栏隐藏, 内容区不留 margin, main 收紧 padding */
@media (max-width: 767px) {
  .content-wrap, .content-wrap.is-collapsed { margin-left: 0; }
  .main { padding: 12px; }
  .header { padding: 0 10px; }
  .role-tag { display: none; }
  .user-name { max-width: 110px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .header-right { gap: 8px; }
}
/* 抽屉内部: 复用侧栏视觉; drawer 被 teleport 到 body, 要穿透 scoped 边界 */
.mobile-menu { display: flex; flex-direction: column; height: 100%; background: #faf9f7; }
.mobile-menu .logo {
  height: 60px; display: flex; align-items: center; gap: 9px; padding: 0 20px;
  border-bottom: 1px solid #eae7e2;
}
.mobile-menu .menu { flex: 1; overflow-y: auto; padding: 6px 10px; background: transparent; border-right: none; }
:deep(.mobile-menu-drawer) { background: #faf9f7; }
:deep(.mobile-menu-drawer .el-drawer__body) { padding: 0; }
</style>
