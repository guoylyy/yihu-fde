<template>
  <!-- 0.6.3「完成本周」两段弹窗(只给 ADMIN, 由主管评分面板打开):
       confirm: 二次确认。面板里还有已交自评、未打主管分的 O 时多一个勾选「仍然归档(跳过 N 个…)」, 默认不勾;
       missing: 后端 8116 → 只列「交了自评、还差你打分」的人 + O, 底部灰字点名没交自评的人(不影响归档)。
       勾选后才带 allowUnscoredSelfScored=true; 没勾时「仍然归档」置灰 -->
  <el-dialog
    :model-value="modelValue" :title="phase === 'missing' ? $t('okr.close.missing_title') : $t('okr.v3.mgr_save_close')"
    :width="mobile ? '94vw' : 'min(92vw, 520px)'" append-to-body class="ocw-dialog" data-test="okr-close-dialog"
    @update:model-value="v => $emit('update:modelValue', v)" @open="force = false"
  >
    <div class="ocw-body">
      <template v-if="phase === 'missing'">
        <p class="ocw-sub" data-test="okr-close-missing-sub">{{ $t('okr.close.missing_sub', { p0: missing.length }) }}</p>
        <ul class="ocw-list" data-test="okr-close-missing">
          <li v-for="g in groupMissing(missing)" :key="g.ownerId" :data-test="'okr-close-missing-' + g.ownerId">
            <b class="ocw-who">{{ g.ownerName }}</b>
            <span v-for="o in g.items" :key="o.objectiveId" class="ocw-o"><i>O{{ o.seq }}</i> {{ o.title }}</span>
          </li>
        </ul>
      </template>
      <p v-else class="ocw-sub">{{ $t('okr.v3.mgr_confirm_close', { p0: week }) }}</p>

      <p v-if="pendingSelf.length" class="ocw-noself" data-test="okr-close-noself">
        {{ $t('okr.close.no_self_line', { p0: pendingSelf.length }) }}<span class="ocw-names">{{ names }}</span>
      </p>

      <div v-if="forceCount" class="ocw-force" data-test="okr-close-force">
        <el-checkbox v-model="force" data-test="okr-close-force-check">{{ $t('okr.close.force_label', { p0: forceCount }) }}</el-checkbox>
        <p class="ocw-warn">{{ $t('okr.close.force_warn') }}</p>
      </div>
    </div>
    <template #footer>
      <div class="ocw-foot">
        <template v-if="phase === 'missing'">
          <el-button data-test="okr-close-go-score" @click="$emit('update:modelValue', false)">{{ $t('okr.close.go_score') }}</el-button>
          <el-button type="danger" :disabled="!force" :loading="busy" data-test="okr-close-force-btn" @click="$emit('submit', true)">{{ $t('okr.close.force_btn') }}</el-button>
        </template>
        <template v-else>
          <el-button @click="$emit('update:modelValue', false)">{{ $t('common.cancel') }}</el-button>
          <el-button type="primary" :loading="busy" data-test="okr-close-submit" @click="$emit('submit', force)">{{ $t('okr.v3.mgr_save_close') }}</el-button>
        </template>
      </div>
    </template>
  </el-dialog>
</template>

<script setup>
import { computed, ref } from 'vue'
import { $t } from '@/i18n'
import { groupMissing, nameList } from '@/views/okr/okrClose.js'

const props = defineProps({
  modelValue: Boolean,
  week: { type: String, default: '' },
  /** confirm = 二次确认; missing = 8116 缺项 */
  phase: { type: String, default: 'confirm' },
  /** 8116 data.missing: [{ objectiveId, ownerId, ownerName, seq, title }] */
  missing: { type: Array, default: () => [] },
  /** 没交自评的人 [{ userId, name, objectiveCount }] */
  pendingSelf: { type: Array, default: () => [] },
  /** confirm 阶段: 保存后仍是已交自评、没有主管分的 O 数 */
  unscoredCount: { type: Number, default: 0 },
  busy: Boolean,
  mobile: Boolean
})
defineEmits(['update:modelValue', 'submit'])

const force = ref(false)
const forceCount = computed(() => (props.phase === 'missing' ? props.missing.length : props.unscoredCount))
const names = computed(() => {
  const n = nameList(props.pendingSelf)
  return n.more ? $t('okr.close.names_more', { p0: n.text, p1: n.total }) : n.text
})
</script>

<style scoped>
.ocw-body { display: flex; flex-direction: column; gap: 10px; max-height: min(60vh, 520px); overflow-y: auto; -webkit-overflow-scrolling: touch; }
.ocw-sub { margin: 0; font-size: 13px; line-height: 1.6; color: var(--el-text-color-regular); }
.ocw-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
.ocw-list li { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border-radius: 8px; background: var(--el-fill-color-light); }
.ocw-who { font-size: 14px; }
.ocw-o { font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.ocw-o i { font-style: normal; font-size: 12px; font-weight: 600; color: var(--el-color-primary); margin-right: 2px; }
.ocw-noself { margin: 0; font-size: 12px; line-height: 1.6; color: var(--el-text-color-secondary); }
.ocw-names { color: var(--el-text-color-regular); }
.ocw-force { padding: 8px 10px; border: 1px dashed var(--el-border-color); border-radius: 8px; }
.ocw-force :deep(.el-checkbox) { height: auto; min-height: 32px; white-space: normal; align-items: flex-start; }
.ocw-force :deep(.el-checkbox__label) { line-height: 1.5; }
.ocw-warn { margin: 4px 0 0 24px; font-size: 12px; line-height: 1.5; color: var(--el-color-danger); }
.ocw-foot { display: flex; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.ocw-foot .el-button { margin-left: 0; }
@media (max-width: 640px) {
  .ocw-foot .el-button { flex: 1 1 0; min-height: 44px; }
  .ocw-force :deep(.el-checkbox) { min-height: 44px; }
}
</style>
