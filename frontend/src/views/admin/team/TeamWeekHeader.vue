<template>
  <!-- 负载 / 承诺 vs 交付 共用的页头: 页内切换(承诺只给 team.view.all) + 周切换(上一周/本周/下一周)。
       选中的周放在 ?week=YYYY-MM-DD, 两页之间切换时周不丢 -->
  <div class="week-header">
    <nav v-if="showTabs" class="tabs">
      <router-link :to="{ path: '/admin/team/load', query: $route.query }" class="tab" :class="{ on: $route.path === '/admin/team/load' }">{{ $t('nav.team_load') }}</router-link>
      <router-link :to="{ path: '/admin/team/promise', query: $route.query }" class="tab" :class="{ on: $route.path === '/admin/team/promise' }">{{ $t('nav.team_promise') }}</router-link>
    </nav>
    <div class="week">
      <el-button-group>
        <el-button size="small" data-test="week-prev" @click="go(-1)">‹ {{ $t('team.week.prev') }}</el-button>
        <el-button size="small" data-test="week-this" :disabled="!date" @click="setDate('')">{{ $t('team.week.this') }}</el-button>
        <el-button size="small" data-test="week-next" @click="go(1)">{{ $t('team.week.next') }} ›</el-button>
      </el-button-group>
      <span v-if="week" class="label" data-test="week-label">{{ $t('team.week.label', { year: week.year, n: week.weekNo }) }} · {{ weekRangeText(week) }}</span>
    </div>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { can } from '@/api/permissions.js'
import { shiftWeek, weekRangeText } from './teamUtils.js'

defineProps({ week: { type: Object, default: null } })
const route = useRoute()
const router = useRouter()
const showTabs = can('team.view.all')
const date = computed(() => (/^\d{4}-\d{2}-\d{2}$/.test(String(route.query.week || '')) ? String(route.query.week) : ''))

function setDate(d) { router.replace({ query: { ...route.query, week: d || undefined } }) }
function go(n) {
  const d = shiftWeek(date.value, n)
  // 挪回本周就去掉参数, 地址干净
  setDate(shiftWeek('', 0) === d ? '' : d)
}
</script>

<style scoped>
.week-header { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; margin-bottom: 12px; }
.tabs { display: inline-flex; background: #f0eee9; border-radius: 999px; padding: 3px; }
.tab { font-size: 13px; padding: 4px 14px; border-radius: 999px; color: var(--text-secondary); text-decoration: none; white-space: nowrap; }
.tab.on { background: var(--surface); color: var(--text); font-weight: 600; box-shadow: 0 1px 2px rgba(0,0,0,.06); }
.week { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.label { font-size: 13px; color: var(--text-muted); }
</style>
