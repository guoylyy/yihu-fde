<template>
  <!-- 一行: [‹ 2026 第 47 周 [待提交] ›] 居中成组, 历史/团队文字链接靠右(都在页面内容宽度内, 不贴 1440 的边)
       状态标签贴在周次右侧, 不再单独掉在左箭头下面; 到窗口边界的箭头置灰 -->
  <header class="okr-weekbar">
    <div class="okr-wb-group" data-test="okr-weekbar-group">
      <button type="button" class="okr-wb-arrow" data-test="okr-week-prev" :aria-label="$t('okr.prev_week')" :disabled="prevDisabled" @click="$emit('shift', -1)">‹</button>
      <div class="okr-wb-title">
        <span class="okr-wb-line">
          <strong>{{ $t('okr.week_title', { p0: year, p1: weekNo }) }}</strong>
          <el-tag v-if="tagText" :type="tagType" size="small" effect="dark" class="okr-wb-tag" data-test="okr-week-tag">{{ tagText }}</el-tag>
          <el-tag v-if="extraTag" type="warning" size="small" class="okr-wb-tag" data-test="okr-week-extra-tag">{{ extraTag }}</el-tag>
        </span>
        <span v-if="range" class="okr-wb-range">{{ range }}</span>
      </div>
      <button type="button" class="okr-wb-arrow" data-test="okr-week-next" :aria-label="$t('okr.next_week')" :disabled="nextDisabled" @click="$emit('shift', 1)">›</button>
    </div>
    <!-- 本页之外的去处用文字链接(当前页不再占一个可点元素) -->
    <nav v-if="!hideLinks" class="okr-wb-links">
      <router-link v-if="active !== 'mine'" :to="{ path: '/admin/okr', query: weekQuery }">{{ $t('okr.tab_mine') }}</router-link>
      <router-link v-if="active !== 'history'" :to="{ path: '/admin/okr/history' }">{{ $t('okr.tab_history') }}</router-link>
      <router-link v-if="showTeam && active !== 'team'" :to="{ path: '/admin/okr/team', query: weekQuery }">{{ $t('okr.tab_team') }}</router-link>
    </nav>
  </header>
</template>

<script setup>
import { computed } from 'vue'
import { shDate } from '@/views/okr/okrUtils.js'

const props = defineProps({
  year: Number,
  weekNo: Number,
  start: String,
  end: String,
  tagText: String,
  tagType: { type: String, default: 'info' },
  extraTag: String,
  active: String,
  showTeam: Boolean,
  hideLinks: Boolean,
  weekKey: String,
  prevDisabled: Boolean,
  nextDisabled: Boolean
})
defineEmits(['shift'])

const range = computed(() => (props.start && props.end ? `${shDate(props.start)} → ${shDate(props.end)}` : ''))
const weekQuery = computed(() => (props.weekKey ? { week: props.weekKey } : {}))
</script>

<style scoped>
/* 三栏: 左空 | 居中的周次组 | 右侧链接 —— 周次组按内容宽度收敛, 永远在正中 */
.okr-weekbar { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 8px; margin-bottom: 12px; }
.okr-wb-group { grid-column: 2; display: flex; align-items: center; gap: 8px; min-width: 0; }
.okr-wb-arrow { width: 32px; height: 32px; flex: none; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; background: var(--el-bg-color); font-size: 18px; line-height: 1; cursor: pointer; color: var(--el-text-color-regular); }
.okr-wb-arrow:disabled { cursor: not-allowed; opacity: .35; }
.okr-wb-title { min-width: 0; display: flex; flex-direction: column; align-items: center; line-height: 1.3; }
.okr-wb-line { display: inline-flex; align-items: center; justify-content: center; flex-wrap: wrap; gap: 4px 6px; }
.okr-wb-title strong { font-size: 15px; white-space: nowrap; }
.okr-wb-tag { flex: none; }
.okr-wb-range { font-size: 12px; color: var(--el-text-color-secondary); }
.okr-wb-links { grid-column: 3; justify-self: end; display: flex; gap: 16px; }
.okr-wb-links a { font-size: 13px; color: var(--el-color-primary); text-decoration: none; padding: 2px 0; white-space: nowrap; }
@media (max-width: 640px) {
  /* 手机: 同样一行, 去掉左侧空栏, 周次组在左栏里居中; 控件 ≥ 44px */
  .okr-weekbar { grid-template-columns: minmax(0, 1fr) auto; gap: 4px; }
  .okr-wb-group { grid-column: 1; justify-self: center; gap: 2px; }
  .okr-wb-links { grid-column: 2; gap: 12px; }
  .okr-wb-arrow { width: 44px; height: 44px; min-width: 44px; min-height: 44px; }
  .okr-wb-links a { display: inline-flex; align-items: center; min-height: 44px; }
}
</style>
