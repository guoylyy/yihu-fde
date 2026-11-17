<!--
  AI 助手抽屉: 右下角气泡 → 抽屉(桌面右侧 420px, 手机全屏)。挂在后台主布局上, 所有页面可用。
  顶部: 当前模型 + 历史 + 新对话; 中间: 消息流(助手产出的草稿单独渲染成卡片); 底部: 输入框(Enter 发送, Shift+Enter 换行)
-->
<template>
  <button v-if="!state.open" type="button" class="ai-fab" :aria-label="$t('assistant.open')" @click="openPanel">
    <el-icon :size="20"><MagicStick /></el-icon>
    <span class="ai-fab-text">AI</span>
  </button>

  <transition name="ai-slide">
    <aside v-if="state.open" class="ai-panel" :class="{ mobile: isMobile }" role="dialog" :aria-label="$t('assistant.title')">
      <header class="ai-head">
        <div class="ai-title">
          <span class="ai-name">{{ $t('assistant.title') }}</span>
          <span class="ai-model" :class="{ off: state.status && !state.status.available }" :title="modelTitle">{{ modelLabel }}</span>
        </div>
        <el-tooltip :content="$t('assistant.history')" placement="bottom" :disabled="isMobile">
          <el-button text class="ai-icon-btn" :class="{ active: state.showHistory }" :aria-label="$t('assistant.history')" @click="toggleHistory">
            <el-icon :size="18"><Clock /></el-icon>
          </el-button>
        </el-tooltip>
        <el-button text class="ai-new" :disabled="state.sending" @click="newChat">
          <el-icon :size="16"><Plus /></el-icon><span>{{ $t('assistant.new_chat') }}</span>
        </el-button>
        <el-button text class="ai-icon-btn" :aria-label="$t('assistant.close')" @click="state.open = false">
          <el-icon :size="18"><Close /></el-icon>
        </el-button>
      </header>
      <div class="ai-hint">{{ $t('assistant.hint') }}</div>

      <!-- 历史会话 -->
      <div v-if="state.showHistory" class="ai-history">
        <div v-if="!state.history.length" class="ai-empty-line">{{ $t('assistant.no_history') }}</div>
        <div v-for="c in state.history" :key="c.id" class="ai-conv" :class="{ current: c.id === state.conversationId }" @click="pick(c)">
          <div class="ai-conv-main">
            <div class="ai-conv-title">{{ c.title || '—' }}</div>
            <div class="ai-conv-time">{{ fmtTime(c.updatedAt) }} · {{ c.messageCount }}</div>
          </div>
          <el-button text class="ai-icon-btn" :aria-label="$t('common.delete')" @click.stop="remove(c)">
            <el-icon><Delete /></el-icon>
          </el-button>
        </div>
      </div>

      <!-- 消息流 -->
      <div v-else ref="listRef" class="ai-messages">
        <div v-if="state.status && !state.status.available" class="ai-unavailable" role="alert">
          {{ $t('assistant.unavailable', { p0: state.status.reason }) }}
        </div>
        <div v-if="!state.messages.length" class="ai-empty">
          <div class="ai-empty-title">{{ $t('assistant.empty_title') }}</div>
          <div class="ai-empty-desc">{{ $t('assistant.empty_desc') }}</div>
          <button v-for="k in ['eg1', 'eg2', 'eg3']" :key="k" type="button" class="ai-eg" @click="useExample($t(`assistant.${k}`))">
            {{ $t(`assistant.${k}`) }}
          </button>
        </div>
        <div v-for="m in state.messages" :key="m.id" class="msg" :class="m.role === 'USER' ? 'user' : 'bot'">
          <div v-if="m.role === 'USER'" class="bubble">{{ m.text }}</div>
          <template v-else>
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div v-if="m.text" class="bubble md" :class="{ error: m.error }" v-html="render(m.text)" />
            <div v-if="m.toolCalls?.length" class="tools-line">
              {{ $t('assistant.tools_used', { p0: m.toolCalls.map((t) => t.name).join('、') }) }}
            </div>
            <AssistantDraftCard v-for="d in m.drafts || []" :key="d.id" :draft="d" @navigate="onNavigate" />
          </template>
        </div>
        <div v-if="state.sending" class="msg bot"><div class="bubble muted">{{ $t('assistant.thinking') }}</div></div>
      </div>

      <footer class="ai-input">
        <el-input
          ref="inputRef" v-model="input" type="textarea" resize="none" :autosize="{ minRows: 1, maxRows: 6 }"
          :placeholder="isMobile ? $t('assistant.placeholder_mobile') : $t('assistant.placeholder')"
          :disabled="state.status && !state.status.available" @keydown="onKeydown"
        />
        <el-button type="primary" class="ai-send" :loading="state.sending" :disabled="!input.trim()" @click="submit">
          {{ $t('assistant.send') }}
        </el-button>
      </footer>
    </aside>
  </transition>
</template>

<script setup>
import { $t } from '@/i18n'
import { computed, nextTick, ref, watch, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { MagicStick, Clock, Plus, Close, Delete } from '@element-plus/icons-vue'
import AssistantDraftCard from './AssistantDraftCard.vue'
import { useAssistant } from '@/composables/useAssistant.js'
import { useResponsive } from '@/composables/useResponsive.js'
import { renderSafeMarkdown } from '@/utils/safeMarkdown.js'

const { state, openPanel, newChat, send, loadHistory, loadConversation, removeConversation, loadStatus } = useAssistant()
const { isMobile } = useResponsive()
const input = ref('')
const listRef = ref(null)
const inputRef = ref(null)

const modelLabel = computed(() => {
  const s = state.status
  if (!s) return '…'
  if (!s.available) return $t('assistant.model_unknown')
  if (s.stub) return $t('assistant.stub')
  return s.model?.model || s.model?.name || '—'
})
const modelTitle = computed(() => state.status?.model?.name || state.status?.reason || '')

const render = (text) => renderSafeMarkdown(text)
const fmtTime = (t) => (t ? new Date(t).toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '')

function scrollToEnd() {
  nextTick(() => { if (listRef.value) listRef.value.scrollTop = listRef.value.scrollHeight })
}
watch(() => [state.messages.length, state.sending, state.open], scrollToEnd)

async function submit() {
  const text = input.value
  if (!text.trim() || state.sending) return
  input.value = ''
  await send(text)
}

function onKeydown(e) {
  // 手机软键盘回车只换行, 点「发送」发; 输入法组字中的回车不算
  if (isMobile.value || e.isComposing || e.keyCode === 229) return
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    submit()
  }
}

function useExample(text) {
  input.value = text
  nextTick(() => inputRef.value?.focus())
}

async function toggleHistory() {
  state.showHistory = !state.showHistory
  if (state.showHistory) await loadHistory()
}
async function pick(c) {
  state.showHistory = false
  state.conversationId = c.id
  await loadConversation(c.id)
}
async function remove(c) {
  try {
    await ElMessageBox.confirm($t('assistant.delete_conv_confirm'), $t('common.delete'), { type: 'warning' })
  } catch { return }
  try {
    await removeConversation(c.id)
    ElMessage.success($t('assistant.deleted'))
  } catch (e) { ElMessage.error(e.message) }
}

// 手机上点「去查看」: 收起全屏抽屉, 让人看到目标页面
function onNavigate() {
  if (isMobile.value) state.open = false
}

onMounted(() => {
  if (state.open) openPanel()
  else loadStatus()
})
</script>

<style scoped>
.ai-fab {
  position: fixed; right: 24px; bottom: 24px; z-index: 1990;
  display: inline-flex; align-items: center; gap: 6px;
  height: 48px; padding: 0 18px; border: none; border-radius: 24px; cursor: pointer;
  background: #1c1917; color: #fff; font-size: 15px; font-weight: 600;
  box-shadow: 0 6px 20px rgba(28, 25, 23, 0.25);
}
.ai-fab:hover { background: #292524; }
.ai-fab:focus-visible { outline: 3px solid #93c5fd; outline-offset: 2px; }

.ai-panel {
  position: fixed; top: 0; right: 0; bottom: 0; z-index: 1990; width: 420px; max-width: 100vw;
  display: flex; flex-direction: column; background: #fff;
  border-left: 1px solid #e7e5e4; box-shadow: -8px 0 28px rgba(28, 25, 23, 0.12);
}
.ai-panel.mobile { width: 100vw; left: 0; border-left: none; box-shadow: none; padding-top: env(safe-area-inset-top); }

.ai-head { display: flex; align-items: center; gap: 2px; height: 56px; padding: 0 8px 0 16px; border-bottom: 1px solid #f0eeeb; flex-shrink: 0; }
.ai-title { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; }
.ai-name { font-weight: 700; font-size: 16px; color: #1c1917; white-space: nowrap; }
.ai-model {
  min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-size: 12px; color: #44403c; background: #f5f5f4; border-radius: 10px; padding: 2px 8px;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}
.ai-model.off { color: #b91c1c; background: #fef2f2; font-family: inherit; }
.ai-icon-btn { width: 36px; height: 36px; padding: 0; margin: 0 !important; }
.ai-icon-btn.active { background: #f5f5f4; }
.ai-new { height: 36px; padding: 0 8px; margin: 0 !important; gap: 2px; }
.ai-hint { font-size: 12px; color: #78716c; padding: 6px 16px; background: #fafaf9; border-bottom: 1px solid #f0eeeb; flex-shrink: 0; }

.ai-messages, .ai-history { flex: 1; overflow-y: auto; padding: 14px 14px 6px; overscroll-behavior: contain; }
.ai-unavailable { font-size: 13px; color: #b91c1c; background: #fef2f2; border: 1px solid #fecaca; border-radius: 8px; padding: 10px 12px; margin-bottom: 12px; line-height: 1.6; }
.ai-empty { padding: 16px 4px; }
.ai-empty-title { font-size: 16px; font-weight: 700; color: #1c1917; }
.ai-empty-desc { font-size: 13px; color: #78716c; margin: 6px 0 10px; }
.ai-eg {
  display: block; width: 100%; text-align: left; margin-bottom: 8px; padding: 10px 12px; cursor: pointer;
  border: 1px solid #e7e5e4; border-radius: 10px; background: #fff; color: #1c1917; font-size: 13px; line-height: 1.5;
}
.ai-eg:hover { border-color: #a8a29e; background: #fafaf9; }
.ai-empty-line { color: #a8a29e; font-size: 13px; padding: 12px 4px; }

.msg { display: flex; flex-direction: column; margin-bottom: 14px; }
.msg.user { align-items: flex-end; }
.bubble { max-width: 92%; padding: 8px 12px; border-radius: 12px; font-size: 14px; line-height: 1.65; word-break: break-word; }
.msg.user .bubble { background: #1c1917; color: #fafaf9; white-space: pre-wrap; border-bottom-right-radius: 4px; }
.msg.bot .bubble { background: #f5f5f4; color: #1c1917; border-bottom-left-radius: 4px; }
.msg.bot .bubble.error { background: #fef2f2; color: #b91c1c; }
.bubble.muted { color: #78716c; }
.bubble.md :deep(p) { margin: 0 0 6px; }
.bubble.md :deep(p:last-child) { margin-bottom: 0; }
.bubble.md :deep(ul), .bubble.md :deep(ol) { margin: 4px 0; padding-left: 20px; }
.bubble.md :deep(h1), .bubble.md :deep(h2), .bubble.md :deep(h3) { font-size: 14px; margin: 8px 0 4px; }
.bubble.md :deep(table) { border-collapse: collapse; font-size: 12px; }
.bubble.md :deep(td), .bubble.md :deep(th) { border: 1px solid #e7e5e4; padding: 2px 6px; }
.tools-line { font-size: 11px; color: #a8a29e; margin-top: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

.ai-conv { display: flex; align-items: center; gap: 6px; padding: 8px 10px; border-radius: 8px; cursor: pointer; }
.ai-conv:hover, .ai-conv.current { background: #f5f5f4; }
.ai-conv-main { flex: 1; min-width: 0; }
.ai-conv-title { font-size: 14px; color: #1c1917; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ai-conv-time { font-size: 12px; color: #a8a29e; margin-top: 2px; }

.ai-input { display: flex; align-items: flex-end; gap: 8px; padding: 10px 12px; border-top: 1px solid #f0eeeb; flex-shrink: 0; }
.ai-input :deep(.el-textarea__inner) { font-size: 14px; line-height: 1.5; padding: 8px 10px; }
.ai-send { height: 38px; }

.ai-slide-enter-active, .ai-slide-leave-active { transition: transform 0.2s ease; }
.ai-slide-enter-from, .ai-slide-leave-to { transform: translateX(100%); }

/* 手机: 气泡贴边、避开底部安全区; 抽屉里的可点元素至少 44px */
@media (max-width: 767px) {
  .ai-fab { right: 16px; bottom: calc(16px + env(safe-area-inset-bottom)); height: 52px; padding: 0 20px; }
  .ai-head { height: 56px; padding: 0 4px 0 14px; }
  .ai-icon-btn { width: 44px; height: 44px; }
  .ai-new { height: 44px; }
  .ai-eg { padding: 12px 14px; font-size: 15px; min-height: 44px; }
  .bubble { font-size: 15px; }
  .ai-conv { min-height: 52px; }
  .ai-input { padding: 8px 10px calc(8px + env(safe-area-inset-bottom)); }
  .ai-input :deep(.el-textarea__inner) { font-size: 16px; min-height: 44px !important; padding: 10px 12px; }
  .ai-send { height: 44px; min-width: 64px; font-size: 15px; }
}
</style>
