<template>
  <!-- 0.5.0 团队 · 能力矩阵: 这个团队会什么、哪项本事只压在一个人身上。
       数据: GET /api/team/skills —— MANUAL = 人工标注(1–5), DERIVED = 近 N 天会话里提到过的候选(没等级);
       写: 点格子标等级 POST /api/team/skills/:engineerId { skillId, level }
           候选「确认」/ 新加一项 POST /api/team/skills/confirm { engineerId, skillName, level } -->
  <div class="team-skills">
    <div class="toolbar">
      <p class="hint">{{ $t('team.skills.hint', { days: meta.derivedWindowDays || 90 }) }}</p>
      <div class="legend">
        <span><i class="dot on" /> {{ $t('team.skills.legend_manual') }}</span>
        <span><i class="dot cand" /> {{ $t('team.skills.legend_candidate') }}</span>
        <el-button size="small" type="primary" data-test="skill-add" :disabled="!members.length" @click="openAdd">{{ $t('team.skills.add') }}</el-button>
      </div>
    </div>

    <div v-if="loading" class="panel pad" data-test="skills-skeleton"><el-skeleton :rows="6" animated /></div>
    <LoadError v-else-if="error" :message="error" @retry="load" />
    <el-empty v-else-if="!matrix.length" :description="members.length ? $t('team.skills.empty') : $t('team.no_members')" />
    <div v-else class="panel scroll" data-test="skills-matrix">
      <table class="matrix">
        <thead>
          <tr>
            <th class="sticky skill-col">{{ $t('team.skills.skill') }}</th>
            <th v-for="m in members" :key="m.engineerId" class="person">
              <router-link :to="`/admin/team/members/${m.engineerId}`">{{ m.name }}</router-link>
            </th>
            <th class="risk-col" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in matrix" :key="row.skill.id" data-test="skill-row">
            <th class="sticky skill-col">
              {{ row.skill.name }}
              <span v-if="row.singlePoint" class="sp-inline">{{ $t('team.skills.single_point') }}</span>
            </th>
            <td v-for="(c, i) in row.cells" :key="members[i].engineerId" class="cell">
              <!-- 候选: 灰点 + 确认 -->
              <span v-if="c && c.source === 'DERIVED'" class="cand-wrap">
                <el-tooltip :content="`${$t('team.skills.candidate')} · ${$t('team.skills.candidate_tip', { n: c.hits || 0, days: meta.derivedWindowDays || 90 })}`" placement="top">
                  <i class="dot cand" data-test="skill-candidate" />
                </el-tooltip>
                <el-button link size="small" type="primary" class="confirm" data-test="skill-confirm" @click="openPick('confirm', row.skill, members[i], null)">{{ $t('team.skills.confirm') }}</el-button>
              </span>
              <!-- 人工标注 / 空格: 点了直接选 1–5 -->
              <button v-else type="button" class="dots" :class="{ empty: !c }" :title="c ? `${c.level} · ${$t('team.skills.level_desc.' + c.level)}` : ''"
                      data-test="skill-cell" @click="openPick('set', row.skill, members[i], c?.level || null)">
                <i v-for="(on, k) in levelDots(c?.level)" :key="k" class="dot" :class="{ on }" />
              </button>
            </td>
            <td class="risk-col">
              <el-tooltip v-if="row.singlePoint" :content="$t('team.skills.single_point_tip')" placement="left">
                <el-tag size="small" type="danger" effect="light" data-test="single-point">{{ $t('team.skills.single_point') }}</el-tag>
              </el-tooltip>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- 选等级: 标注(set) / 确认候选(confirm) 共用 -->
    <el-dialog v-model="pick.visible" :title="pickTitle" width="min(440px, 92vw)" append-to-body>
      <div class="levels">
        <button v-for="n in 5" :key="n" type="button" class="level-btn" :class="{ on: pick.level === n }" :data-test="'level-' + n" @click="pick.level = n">
          <span class="dots small"><i v-for="(on, k) in levelDots(n)" :key="k" class="dot" :class="{ on }" /></span>
          <b>{{ n }}</b><span>{{ $t('team.skills.level_desc.' + n) }}</span>
        </button>
      </div>
      <template #footer>
        <el-button @click="pick.visible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="pick.saving" :disabled="!pick.level" data-test="level-save" @click="savePick">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>

    <!-- 添加标注: 选人 + 技能名(可选已有, 也可新建) + 等级 -->
    <el-dialog v-model="add.visible" :title="$t('team.skills.add_title')" width="min(440px, 92vw)" append-to-body>
      <el-form label-position="top">
        <el-form-item :label="$t('team.skills.member')">
          <el-select v-model="add.engineerId" filterable style="width: 100%" data-test="add-member">
            <el-option v-for="m in members" :key="m.engineerId" :label="m.name" :value="m.engineerId" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('team.skills.skill_name')">
          <el-select v-model="add.skillName" filterable allow-create default-first-option :placeholder="$t('team.skills.skill_name_ph')" style="width: 100%" data-test="add-skill">
            <el-option v-for="s in skills" :key="s.id" :label="s.name" :value="s.name" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('team.skills.level')">
          <el-radio-group v-model="add.level" size="small">
            <el-radio-button v-for="n in 5" :key="n" :value="n">{{ n }} · {{ $t('team.skills.level_desc.' + n) }}</el-radio-button>
          </el-radio-group>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="add.visible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="add.saving" data-test="add-save" @click="saveAdd">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { fde } from '@/api/index.js'
import LoadError from '@/components/common/LoadError.vue'
import { buildSkillMatrix, levelDots } from './teamUtils.js'

const payload = ref(null)
const meta = ref({})
const loading = ref(true)
const error = ref('')
const members = computed(() => payload.value?.members || [])
const skills = computed(() => payload.value?.skills || [])
const matrix = computed(() => buildSkillMatrix(payload.value))

// 保存后静默刷新, 不闪骨架(保留横向滚动位置)
async function load({ silent = false } = {}) {
  if (!silent) loading.value = true
  error.value = ''
  try {
    const r = await fde.team.skills()
    payload.value = r.data
    meta.value = r.meta || {}
  } catch (e) {
    if (silent) ElMessage.error(e.message)
    else error.value = e.message
  } finally {
    loading.value = false
  }
}
onMounted(load)

const pick = reactive({ visible: false, mode: 'set', skill: null, member: null, level: null, saving: false })
const pickTitle = computed(() => !pick.skill ? '' : $t(pick.mode === 'confirm' ? 'team.skills.confirm_title' : 'team.skills.set_title', { name: pick.member?.name, skill: pick.skill.name }))
function openPick(mode, skill, member, level) {
  Object.assign(pick, { visible: true, mode, skill, member, level, saving: false })
}
async function savePick() {
  if (!pick.level) return
  pick.saving = true
  try {
    if (pick.mode === 'confirm') {
      await fde.team.confirmSkill({ engineerId: pick.member.engineerId, skillName: pick.skill.name, level: pick.level })
    } else {
      await fde.team.setSkill(pick.member.engineerId, { skillId: pick.skill.id, level: pick.level })
    }
    ElMessage.success($t('team.skills.saved'))
    pick.visible = false
    await load({ silent: true })
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    pick.saving = false
  }
}

const add = reactive({ visible: false, engineerId: '', skillName: '', level: 3, saving: false })
function openAdd() { Object.assign(add, { visible: true, engineerId: '', skillName: '', level: 3, saving: false }) }
async function saveAdd() {
  const name = String(add.skillName || '').trim()
  if (!add.engineerId || !name || !add.level) { ElMessage.warning($t('team.skills.need_fields')); return }
  add.saving = true
  try {
    await fde.team.confirmSkill({ engineerId: add.engineerId, skillName: name, level: add.level })
    ElMessage.success($t('team.skills.saved'))
    add.visible = false
    await load({ silent: true })
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    add.saving = false
  }
}
</script>

<style scoped>
.team-skills { min-width: 0; }
.toolbar { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
.hint { margin: 0; color: var(--text-muted); font-size: 13px; flex: 1; min-width: 240px; }
.legend { display: flex; align-items: center; gap: 12px; font-size: 12px; color: var(--text-secondary); }
.legend span { display: inline-flex; align-items: center; gap: 5px; }
.panel { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; min-width: 0; }
.pad { padding: 14px; }
.scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
.matrix { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 13px; }
.matrix th, .matrix td { padding: 8px 10px; border-bottom: 1px solid #f3f1ed; text-align: center; white-space: nowrap; }
.matrix thead th { font-size: 12px; font-weight: 500; color: var(--text-muted); }
.matrix tbody tr:last-child th, .matrix tbody tr:last-child td { border-bottom: none; }
.person a { color: var(--text-secondary); text-decoration: none; }
.person a:hover { color: var(--text); text-decoration: underline; }
.sticky { position: sticky; left: 0; background: var(--surface); z-index: 1; }
.skill-col { text-align: left !important; font-weight: 600; color: var(--text); min-width: 110px; box-shadow: 1px 0 0 var(--border); }
.risk-col { text-align: right !important; min-width: 90px; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; border: 1px solid #c9c4bc; background: transparent; }
.dot.on { background: var(--text); border-color: var(--text); }
.dot.cand { background: #c9c4bc; border-color: #c9c4bc; width: 10px; height: 10px; cursor: help; }
.dots { display: inline-flex; gap: 3px; padding: 4px 6px; border: 1px solid transparent; border-radius: 6px; background: none; cursor: pointer; }
.dots:hover { border-color: var(--border-strong); background: #faf9f7; }
/* 0 级 = 空格子: 平时不画点, 悬停才露出可点的 5 个空点 */
.dots.empty .dot { visibility: hidden; }
.dots.empty:hover .dot, .dots.empty:focus-visible .dot { visibility: visible; border-color: #c9c4bc; }
.dots.small { padding: 0; cursor: inherit; }
.cand-wrap { display: inline-flex; align-items: center; gap: 4px; }
.confirm { font-size: 12px; padding: 0; }
.sp-inline { display: none; margin-left: 6px; font-size: 11px; font-weight: 500; color: var(--danger); }
@media (max-width: 640px) {
  .sp-inline { display: inline; }
  .risk-col { display: none; }
}
.levels { display: flex; flex-direction: column; gap: 6px; }
.level-btn { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); cursor: pointer; text-align: left; font-size: 13px; color: var(--text-secondary); }
.level-btn b { color: var(--text); width: 12px; }
.level-btn.on { border-color: var(--text); background: #faf9f7; color: var(--text); }
</style>
