<template>
  <!-- 0.6.2 计划确认区(周切换下面一行): 灰 = 等员工确认 / 黄 = 等主管确认 / 绿 = 已锁定 / 蓝 = 变更申请待批。
       状态由 okrConfirm.confirmBar 算; 已锁定后不再出确认按钮(确认不能取消) -->
  <div v-if="bar" class="okr-cf-bar" :class="'is-' + bar.tone" role="status" data-test="okr-confirm-bar" :data-kind="bar.kind">
    <span class="okr-cf-text" data-test="okr-confirm-text">{{ text }}</span>
    <el-button
      v-if="bar.kind === 'draft' && bar.canConfirm" type="primary" class="okr-cf-btn" :loading="busy"
      data-test="okr-confirm-owner" @click="$emit('confirm')"
    >{{ otherName ? $t('okr.confirm.confirm_for', { p0: otherName }) : $t('okr.confirm.confirm_mine') }}</el-button>
    <el-button
      v-if="bar.kind === 'awaiting' && bar.canManager" type="primary" class="okr-cf-btn" :loading="busy"
      data-test="okr-confirm-manager" @click="$emit('manager-confirm')"
    >{{ $t('okr.confirm.confirm_manager') }}</el-button>
    <el-button
      v-if="bar.kind === 'pending' && bar.cancellable" class="okr-cf-btn" :loading="busy"
      data-test="okr-change-cancel" @click="$emit('cancel-change', bar.changeId)"
    >{{ $t('okr.confirm.cancel_change') }}</el-button>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { $t } from '@/i18n'

const props = defineProps({
  bar: { type: Object, default: null },
  // 看别人(代管 / 主管)时的人名; 自己的页面为空
  otherName: { type: String, default: '' },
  busy: Boolean
})
defineEmits(['confirm', 'manager-confirm', 'cancel-change'])

const text = computed(() => {
  const b = props.bar
  if (!b) return ''
  const o = props.otherName
  if (b.kind === 'pending') return $t('okr.confirm.bar_pending')
  if (b.kind === 'confirmed') {
    const p = { p0: b.ownerAt, p1: b.manager, p2: b.managerAt, p3: o }
    return o ? $t('okr.confirm.bar_confirmed_other', p) : $t('okr.confirm.bar_confirmed', p)
  }
  if (b.kind === 'awaiting') return o ? $t('okr.confirm.bar_awaiting_other', { p0: b.at, p1: o }) : $t('okr.confirm.bar_awaiting', { p0: b.at })
  return o ? $t('okr.confirm.bar_draft_other', { p0: o }) : $t('okr.confirm.bar_draft')
})
</script>

<style scoped>
.okr-cf-bar { display: flex; align-items: center; flex-wrap: wrap; gap: 8px 12px; margin-bottom: 10px; padding: 10px 12px; border-radius: 8px; font-size: 13px; font-weight: 600; border: 1px solid; }
.okr-cf-text { flex: 1 1 200px; min-width: 0; overflow-wrap: anywhere; }
.okr-cf-btn { flex: none; margin-left: 0; font-weight: 600; }
/* 灰 / 黄 / 绿 / 蓝: 主题的 warning 是焦橙色, 黄条用显式黄; 蓝条用显式蓝(主色不一定是蓝) */
.is-gray { color: var(--el-text-color-regular); background: var(--el-fill-color-light); border-color: var(--el-border-color); }
.is-yellow { color: #6b4e00; background: #fff8db; border-color: #f0d77b; }
.is-green { color: var(--el-color-success-dark-2); background: var(--el-color-success-light-9); border-color: var(--el-color-success-light-5); }
.is-blue { color: #1d4f91; background: #eaf2fd; border-color: #a9c8f2; }
@media (max-width: 640px) {
  .okr-cf-btn { min-height: 44px; flex: 1 1 100%; }
}
</style>
