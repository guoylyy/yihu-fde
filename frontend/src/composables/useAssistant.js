// AI 助手的全局状态(单例): 抽屉开合、当前会话、消息流、模型状态。
// 抽屉挂在后台主布局上, 切页面不丢对话; 开合与当前会话 id 记在 localStorage, 刷新后能接着聊
import { reactive, watch } from 'vue'
import { fde } from '@/api/index.js'

const KEY = 'fde_assistant_ui'

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null') || {} } catch { return {} }
}

// 右下角药丸(及其首次提示小圆点)已移除, 顺手清掉老版本留下的 key
try { localStorage.removeItem('fde_assistant_seen') } catch { /* 隐私模式 */ }

const saved = load()
const state = reactive({
  open: !!saved.open,
  conversationId: saved.conversationId || null,
  messages: [],          // [{ id, role: 'USER'|'ASSISTANT', text, drafts?, toolCalls?, error? }]
  status: null,          // /assistant/status
  sending: false,
  loadedId: null,        // 已经拉过消息的会话 id
  showHistory: false,
  history: []
})

watch(() => [state.open, state.conversationId], () => {
  localStorage.setItem(KEY, JSON.stringify({ open: state.open, conversationId: state.conversationId }))
})

async function loadStatus() {
  try { state.status = await fde.assistant.status() } catch (e) { state.status = { available: false, fetchError: true, reason: e.message } }
}

async function loadConversation(id) {
  if (!id) return
  try {
    const d = await fde.assistant.conversation(id)
    state.messages = d.messages
    state.loadedId = id
  } catch {
    // 会话被删了 / 不是自己的: 当新对话
    state.conversationId = null
    state.messages = []
  }
}

async function openPanel() {
  state.open = true
  if (!state.status) loadStatus()
  if (state.conversationId && state.loadedId !== state.conversationId) await loadConversation(state.conversationId)
}

function newChat() {
  state.conversationId = null
  state.messages = []
  state.loadedId = null
  state.showHistory = false
}

async function send(text) {
  const message = String(text || '').trim()
  if (!message || state.sending) return
  state.messages.push({ id: `local-${Date.now()}`, role: 'USER', text: message })
  state.sending = true
  try {
    const d = await fde.assistant.chat({ message, ...(state.conversationId ? { conversationId: state.conversationId } : {}) })
    state.conversationId = d.conversationId
    state.loadedId = d.conversationId
    state.messages.push({ ...d.message, toolCalls: d.toolCalls })
  } catch (e) {
    state.messages.push({ id: `err-${Date.now()}`, role: 'ASSISTANT', text: e.message, error: true })
    if (e.code === 4101) loadStatus()
  } finally {
    state.sending = false
  }
}

async function loadHistory() {
  try { state.history = (await fde.assistant.conversations()).list } catch { state.history = [] }
}

async function removeConversation(id) {
  await fde.assistant.removeConversation(id)
  state.history = state.history.filter((c) => c.id !== id)
  if (state.conversationId === id) newChat()
}

export function useAssistant() {
  return { state, openPanel, newChat, send, loadStatus, loadConversation, loadHistory, removeConversation }
}
