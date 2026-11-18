<template>
  <!-- 0.5.0 经验库与资产库同属「经验」: 页顶切换, 两页路径各自不变(/admin/experience、/admin/assets) -->
  <el-radio-group :model-value="current" size="small" class="exp-tabs" data-test="experience-tabs" @change="go">
    <el-radio-button value="/admin/experience">{{ $t('experience.tab_entries') }}</el-radio-button>
    <el-radio-button v-if="can('asset.view')" value="/admin/assets">{{ $t('common.asset_library') }}</el-radio-button>
  </el-radio-group>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { can } from '@/api/permissions.js'

const route = useRoute()
const router = useRouter()
const current = computed(() => (route.path.startsWith('/admin/assets') ? '/admin/assets' : '/admin/experience'))
function go(path) { if (path !== route.path) router.push(path) }
</script>

<style scoped>
.exp-tabs { margin-bottom: 12px; }
</style>
