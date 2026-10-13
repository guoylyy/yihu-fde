<template>
  <div class="skills-page">
    <div class="page-header">
      <div>
        <h2 class="page-title">{{ $t('common.skills_2') }}</h2>
        <p class="hint">{{ $t('skills.skills_categories', { p0: totalSkills, p1: categories.length }) }}</p>
      </div>
      <el-button v-if="can('skill.manage')" type="primary" @click="openCreate">
        <el-icon><Plus /></el-icon>{{ $t('skills.new_skill') }}
      </el-button>
    </div>

    <!-- 推荐器（核心功能） -->
    <el-card shadow="never" class="matcher-card">
      <template #header>
        <div class="block-title">
          <el-icon><Aim /></el-icon>
          <span>{{ $t('skills.engineer_finder') }}</span>
          <span class="hint" style="margin-left: 8px; font-weight: 400;">{{ $t('skills.enter_skills_project_needs_best_matches') }}</span>
        </div>
      </template>
      <div class="matcher-row">
        <el-input
          v-model="matchInput"
          :placeholder="$t('skills.enter_skills_comma_separated_e_g')"
          @keyup.enter="runMatch"
          clearable
        >
          <template #append>
            <el-button type="primary" @click="runMatch" :loading="matching">
              <el-icon><Search /></el-icon>{{ $t('skills.recommend') }}
            </el-button>
          </template>
        </el-input>
      </div>
      <el-empty v-if="matchResults && matchResults.length === 0" :description="$t('skills.no_matching_engineers')" :image-size="80" />
      <div v-else-if="matchResults" class="match-grid">
        <div v-for="m in matchResults" :key="m.id" class="match-item">
          <div class="match-head">
            <strong>{{ m.name }}</strong>
            <el-tag v-if="m.level" :type="levelType(m.level)" size="small" effect="dark">{{ levelLabel(m.level) }}</el-tag>
          </div>
          <div class="match-meta">
            <span>📍 {{ m.city || '—' }}</span>
            <span>{{ $t('skills.day', { p0: m.dailyRate || '—' }) }}</span>
          </div>
          <div class="match-skills">
            <el-tag v-for="s in m.matchedSkills" :key="s" type="success" size="small" effect="light" style="margin: 2px;">{{ s }}</el-tag>
          </div>
          <div class="match-score">
            {{ $t('skills.match') }} <strong>{{ m.matchScore }}</strong> {{ $t('skills.skills_matched', { p0: m.matchCount }) }}
          </div>
        </div>
      </div>
    </el-card>

    <!-- 技能列表 -->
    <el-card shadow="never" class="block-card">
      <template #header>
        <div class="block-title">
          <el-icon><Collection /></el-icon>
          <span>{{ $t('skills.skill_list') }}</span>
        </div>
      </template>
      <el-form :inline="true" @submit.prevent>
        <el-form-item :label="$t('common.category')">
          <el-select v-model="filterCategory" :placeholder="$t('common.all_categories')" clearable style="width: 160px;" @change="loadList">
            <el-option v-for="c in categories" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('common.search')">
          <el-input v-model="filterKeyword" :placeholder="$t('skills.skill_name')" clearable style="width: 200px;" @keyup.enter="loadList" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" @click="loadList">{{ $t('common.search_2') }}</el-button>
        </el-form-item>
      </el-form>

      <div class="skill-categories">
        <div v-for="cat in groupedSkills" :key="cat.name" class="category-block">
          <div class="cat-header">
            <span class="cat-name">{{ cat.name }}</span>
            <span class="cat-count">{{ cat.items.length }}</span>
          </div>
          <div class="cat-items">
            <div v-for="s in cat.items" :key="s.id" class="skill-chip" @click="openEdit(s)">
              <span>{{ s.name }}</span>
              <span class="chip-count" v-if="s._count?.engineers">{{ s._count.engineers }}</span>
            </div>
          </div>
        </div>
      </div>
    </el-card>

    <!-- 新增/编辑对话框 -->
    <el-dialog v-model="editVisible" :title="editing ? $t('skills.edit_skill') : $t('skills.new_skill')" width="480px" @closed="resetForm">
      <el-form :model="form" :rules="formRules" ref="formRef" label-width="80px">
        <el-form-item :label="$t('common.name')" prop="name">
          <el-input v-model="form.name" :disabled="editing" />
        </el-form-item>
        <el-form-item :label="$t('common.category')" prop="category">
          <el-select v-model="form.category" :placeholder="$t('skills.choose_category')" style="width: 100%;">
            <el-option v-for="c in categories" :key="c" :label="c" :value="c" />
          </el-select>
        </el-form-item>
        <el-form-item :label="$t('common.description')">
          <el-input v-model="form.description" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button v-if="editing && can('skill.manage')" type="danger" @click="handleDelete" style="float: left;">{{ $t('common.delete_2') }}</el-button>
        <el-button @click="editVisible = false">{{ $t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="submitting" @click="handleSubmit">{{ $t('common.save') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { $t } from '@/i18n'
import { ref, reactive, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Aim, Search, Collection } from '@element-plus/icons-vue'
import { fde } from '@/api/index.js'
import { can } from '@/api/permissions.js'

const LEVEL_LABELS = { JUNIOR: $t('common.junior'), MIDDLE: $t('common.mid'), SENIOR: $t('common.senior'), EXPERT: $t('common.expert') }
const LEVEL_TYPES = { JUNIOR: 'info', MIDDLE: '', SENIOR: 'primary', EXPERT: 'danger' }
function levelLabel(l) { return LEVEL_LABELS[l] }
function levelType(l) { return LEVEL_TYPES[l] }

const list = ref([])
const categories = ref([])
const filterCategory = ref('')
const filterKeyword = ref('')
const totalSkills = computed(() => list.value.length)

const groupedSkills = computed(() => {
  const groups = {}
  for (const s of list.value) {
    const cat = s.category || 'OTHER'
    if (!groups[cat]) groups[cat] = []
    groups[cat].push(s)
  }
  return Object.keys(groups).sort().map(name => ({ name, items: groups[name] }))
})

async function loadList() {
  const params = {}
  if (filterCategory.value) params.category = filterCategory.value
  if (filterKeyword.value) params.keyword = filterKeyword.value
  try {
    const data = await fde.skills.list(params)
    list.value = data.list
    categories.value = data.categories
  } catch (e) {
    ElMessage.error($t('common.failed_load_2') + e.message)
  }
}

// 匹配
const matchInput = ref('')
const matching = ref(false)
const matchResults = ref(null)
async function runMatch() {
  if (!matchInput.value.trim()) { matchResults.value = null; return }
  matching.value = true
  try {
    const data = await fde.skills.match(matchInput.value)
    matchResults.value = data
    if (!data.length) ElMessage.info($t('skills.no_matching_engineers'))
  } catch (e) {
    ElMessage.error(e.message)
  } finally {
    matching.value = false
  }
}

// 对话框
const editVisible = ref(false)
const editing = ref(false)
const formRef = ref(null)
const submitting = ref(false)
const form = reactive({ id: null, name: '', category: '', description: '' })
const formRules = {
  name: [{ required: true, message: $t('skills.enter_skill_name'), trigger: 'blur' }],
  category: [{ required: true, message: $t('skills.choose_category_2'), trigger: 'change' }]
}

function openCreate() {
  editing.value = false
  Object.assign(form, { id: null, name: '', category: '', description: '' })
  editVisible.value = true
}

function openEdit(s) {
  editing.value = true
  Object.assign(form, { id: s.id, name: s.name, category: s.category, description: s.description || '' })
  editVisible.value = true
}

function resetForm() { formRef.value?.resetFields() }

async function handleSubmit() {
  try { await formRef.value.validate() } catch { return }
  submitting.value = true
  try {
    if (editing.value) {
      await fde.skills.update(form.id, { category: form.category, description: form.description })
      ElMessage.success($t('common.updated'))
    } else {
      await fde.skills.create({ name: form.name, category: form.category, description: form.description })
      ElMessage.success($t('common.created_2'))
    }
    editVisible.value = false
    loadList()
  } catch (e) {
    ElMessage.error(e.message || $t('common.save_failed'))
  } finally {
    submitting.value = false
  }
}

async function handleDelete() {
  try {
    await ElMessageBox.confirm($t('skills.delete_skill', { p0: form.name }), $t('common.confirm'), { type: 'warning' })
  } catch { return }
  try {
    await fde.skills.remove(form.id)
    ElMessage.success($t('common.deleted'))
    editVisible.value = false
    loadList()
  } catch (e) {
    ElMessage.error(e.message)
  }
}

onMounted(loadList)
</script>

<style scoped>
.skills-page { display: flex; flex-direction: column; gap: 16px; }
.page-header { display: flex; align-items: flex-end; justify-content: space-between; }
.page-title { font-size: 22px; font-weight: 700; margin: 0; color: #1c1917; }
.hint { font-size: 13px; color: #868580; margin: 4px 0 0 0; }
.block-card, .matcher-card { border-radius: 12px; }
.matcher-card { background: #fff; border-color: #eae7e2; }
.block-title { display: flex; align-items: center; gap: 6px; font-weight: 600; }

.matcher-row { margin-bottom: 16px; }
.match-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
.match-item {
  padding: 14px;
  background: white;
  border: 1px solid #ebeef5;
  border-radius: 8px;
  transition: all 0.2s;
}
.match-item:hover {
  border-color: #d2521e;
  box-shadow: 0 4px 12px rgba(210, 82, 30,0.1);
}
.match-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
.match-meta { font-size: 12px; color: #868580; display: flex; gap: 12px; margin-bottom: 8px; }
.match-skills { display: flex; flex-wrap: wrap; margin-bottom: 8px; }
.match-score { font-size: 12px; color: #606266; }
.match-score strong { color: #d2521e; font-size: 16px; }

.skill-categories { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 16px; margin-top: 16px; }
.category-block { padding: 12px; background: #fafafa; border-radius: 8px; }
.cat-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; padding-bottom: 6px; border-bottom: 1px solid #ebeef5; }
.cat-name { font-weight: 600; font-size: 13px; color: #1c1917; }
.cat-count { background: #d2521e; color: white; font-size: 11px; padding: 1px 8px; border-radius: 10px; }
.cat-items { display: flex; flex-wrap: wrap; gap: 6px; }
.skill-chip {
  padding: 4px 10px;
  background: white;
  border: 1px solid #dcdfe6;
  border-radius: 16px;
  font-size: 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
  transition: all 0.2s;
}
.skill-chip:hover { border-color: #d2521e; color: #d2521e; }
.chip-count {
  background: #f0f0f0;
  color: #909399;
  font-size: 10px;
  padding: 1px 6px;
  border-radius: 8px;
}
</style>