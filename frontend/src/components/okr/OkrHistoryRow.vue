<template>
  <!-- 历史页的一周: 周号(进当周详情) + 完成率 / 自评 / 主管分 -->
  <li class="okr-hrow">
    <router-link :to="{ path: '/admin/okr', query: { week: w.key, ...(ownerId ? { ownerId } : {}) } }">{{ w.key }}</router-link>
    <span v-if="!w.status" class="dim">{{ $t('okr.no_record') }}</span>
    <span v-else-if="!w.submitted" class="dim">{{ $t('okr.not_submitted_short') }}</span>
    <span v-else>
      {{ pct(w.completion) }}%
      <template v-if="w.selfScore != null"> · {{ $t('okr.self_short') }}{{ w.selfScore }}</template>
      <template v-if="w.managerScore != null"> · {{ $t('okr.manager_short') }}{{ w.managerScore }}</template>
      <em v-if="w.late">{{ $t('okr.late') }}</em>
    </span>
  </li>
</template>

<script setup>
import { $t } from '@/i18n'
import { pct } from '@/views/okr/okrUtils.js'

defineProps({ w: { type: Object, required: true }, ownerId: { type: String, default: '' } })
</script>

<style scoped>
.okr-hrow { display: flex; justify-content: space-between; gap: 8px; padding: 8px 2px; border-bottom: 1px solid var(--el-border-color-lighter); }
.okr-hrow a { color: var(--el-color-primary); text-decoration: none; }
.dim { color: var(--el-text-color-secondary); }
em { font-style: normal; color: var(--el-color-warning); margin-left: 4px; }
</style>
