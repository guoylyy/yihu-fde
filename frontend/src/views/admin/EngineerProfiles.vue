<template>
  <div class="profiles-page">
    <div class="page-header">
      <div><h2 class="page-title">{{ $t('common.engineer_skill_matrix') }}</h2><p class="hint">{{ $t('engineerProfiles.delivery_hours_for_last_three_months') }}</p></div>
      <el-button :loading="loading" @click="load">{{ $t('common.refresh') }}</el-button>
    </div>
    <el-card shadow="never">
      <el-table :data="profiles" v-loading="loading" stripe>
        <el-table-column :label="$t('common.engineers')" min-width="150"><template #default="{ row }"><strong>{{ row.name }}</strong></template></el-table-column>
        <el-table-column :label="$t('engineerProfiles.level')" width="110" align="center"><template #default="{ row }"><el-tag :type="levelType(row.level)">{{ row.level }}</el-tag><div class="score">{{ $t('engineerProfiles.pts', { p0: row.score }) }}</div></template></el-table-column>
        <el-table-column :label="$t('engineerProfiles.delivery_completion')" width="150"><template #default="{ row }"><el-progress v-if="row.dimensions.delivery != null" :percentage="row.dimensions.delivery" :stroke-width="8" /><span v-else class="muted">{{ $t('engineerProfiles.no_task_records') }}</span><div class="muted">{{ $t('engineerProfiles.tasks_all_time', { p0: row.tasks }) }}</div></template></el-table-column>
        <el-table-column :label="$t('engineerProfiles.hours_last_3_months')" width="120" align="right"><template #default="{ row }">{{ row.approvedHours3m }}h<div class="muted">{{ $t('engineerProfiles.utilization', { p0: row.dimensions.capacity }) }}</div></template></el-table-column>
        <el-table-column :label="$t('engineerProfiles.independent_delivery_recommendation')" width="150"><template #default="{ row }"><el-tag :type="row.independence?.eligible ? 'success' : 'info'">{{ $t('common.p0', { p0: row.independence?.eligible ? $t('engineerProfiles.meets_recommended_bar') : $t('engineerProfiles.keep_mentoring') }) }}</el-tag><div v-if="row.independence?.reasons?.length" class="muted">{{ row.independence.reasons[0] }}</div></template></el-table-column>
        <el-table-column :label="$t('engineerProfiles.project_type_role')" min-width="220"><template #default="{ row }"><el-tag v-for="item in row.projectTypes" :key="item" size="small" effect="plain">{{ item }}</el-tag><div class="muted">{{ $t('common.p0', { p0: (row.roles || []).join($t('common.list_sep')) || $t('engineerProfiles.no_role_records') }) }}</div></template></el-table-column>
      </el-table>
    </el-card>
  </div>
</template>
<script setup>
import { onMounted, ref } from 'vue'
import { fde } from '@/api/index.js'
const profiles = ref([]); const loading = ref(false)
async function load () { loading.value = true; try { const data = await fde.engineerProfiles.list({ limit: 200 }); profiles.value = data.list || [] } finally { loading.value = false } }
function levelType (level) { return ({ EXPERT: 'danger', SENIOR: 'warning', MIDDLE: 'success', JUNIOR: 'info' })[level] || 'info' }
onMounted(load)
</script>
<style scoped>.profiles-page{padding:0}.page-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px}.hint{color:#78716c;margin:4px 0 0}.muted{font-size:12px;color:#909399;margin-top:3px}.score{font-size:12px;color:#606266;margin-top:3px}.el-tag{margin:0 4px 4px 0}</style>
