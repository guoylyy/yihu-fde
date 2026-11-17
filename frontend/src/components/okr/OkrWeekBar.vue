<template>
  <!-- 顶部一行: ‹ 2026 第 47 周 · 11-16 → 11-22 › + 状态; 下面是本周/历史/团队切换 -->
  <header class="okr-weekbar">
    <div class="okr-wb-main">
      <button type="button" class="okr-wb-arrow" :aria-label="$t('okr.prev_week')" @click="$emit('shift', -1)">‹</button>
      <div class="okr-wb-title">
        <strong>{{ $t('okr.week_title', { p0: year, p1: weekNo }) }}</strong>
        <span v-if="range" class="okr-wb-range">{{ range }}</span>
      </div>
      <button type="button" class="okr-wb-arrow" :aria-label="$t('okr.next_week')" @click="$emit('shift', 1)">›</button>
    </div>
    <!-- 本页之外的去处用文字链接(当前页不再占一个可点元素) -->
    <div class="okr-wb-sub">
      <el-tag v-if="tagText" :type="tagType" size="small" effect="dark">{{ tagText }}</el-tag>
      <nav v-if="!hideLinks" class="okr-wb-links">
        <router-link v-if="active !== 'mine'" :to="{ path: '/admin/okr', query: weekQuery }">{{ $t('okr.tab_mine') }}</router-link>
        <router-link v-if="active !== 'history'" :to="{ path: '/admin/okr/history' }">{{ $t('okr.tab_history') }}</router-link>
        <router-link v-if="showTeam && active !== 'team'" :to="{ path: '/admin/okr/team', query: weekQuery }">{{ $t('okr.tab_team') }}</router-link>
      </nav>
    </div>
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
  active: String,
  showTeam: Boolean,
  hideLinks: Boolean,
  weekKey: String
})
defineEmits(['shift'])

const range = computed(() => (props.start && props.end ? `${shDate(props.start)} → ${shDate(props.end)}` : ''))
const weekQuery = computed(() => (props.weekKey ? { week: props.weekKey } : {}))
</script>

<style scoped>
.okr-weekbar { display: flex; flex-direction: column; gap: 8px; margin-bottom: 12px; }
.okr-wb-main { display: flex; align-items: center; gap: 6px; }
.okr-wb-arrow { width: 32px; height: 32px; flex: none; border: 1px solid var(--el-border-color-lighter); border-radius: 8px; background: var(--el-bg-color); font-size: 18px; line-height: 1; cursor: pointer; color: var(--el-text-color-regular); }
.okr-wb-title { flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: center; line-height: 1.3; }
.okr-wb-title strong { font-size: 15px; }
.okr-wb-range { font-size: 12px; color: var(--el-text-color-secondary); }
.okr-wb-sub { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 24px; }
.okr-wb-links { display: flex; gap: 16px; margin-left: auto; }
.okr-wb-links a { font-size: 13px; color: var(--el-color-primary); text-decoration: none; padding: 2px 0; }
</style>
