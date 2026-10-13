import { $t } from '../i18n/index.js'
// 2026-07-07 P2-2: 把后端 error.code + HTTP status 转成对人友好的提示
// 后端常见 code: 1001 未登录, 1002 Token 失效, 1003 权限不足, 1004 资源不存在, 9xxx 服务器
// 前端 fetch 失败: TypeError 'Failed to fetch', 'NetworkError when fetching'

const CODE_LABELS = {
  1001: $t('common.not_signed_in_please_sign_in'),
  1002: $t('common.session_expired_please_sign_in_again'),
  1003: $t('common.no_access_this_data_contact_administrator'),
  1004: $t('error.data_doesnt_exist_or_was_deleted'),
  9001: $t('common.internal_server_error_please_try_again'),
  9002: $t('common.invalid_request_parameters'),
  9003: $t('common.you_dont_have_permission_for_this'),
  9004: $t('common.resource_doesnt_exist_or_was_deleted')
}

// 把任意 error 转成对人友好的提示
// err: Error { code?, message?, data? } 或 TypeError（fetch 失败）
export function explainError(err, fallback = $t('common.action_failed')) {
  if (!err) return fallback
  if (err.code && CODE_LABELS[err.code]) {
    return CODE_LABELS[err.code]
  }
  // fetch 失败（断网/CORS/超时）
  if (err.name === 'TypeError' && /fetch|network/i.test(err.message || '')) {
    return $t('common.network_error_check_your_connection_try')
  }
  // 后端直接给 message（如 "无权操作此任务"）保留
  if (err.message && err.message.length < 80 && !/Error:|at\s/.test(err.message)) {
    return err.message
  }
  return fallback
}

// catch 用法：catch (e) { ElMessage.error(explainError(e, '加载失败')) }
// 为保留原行为，"加载失败" 默认 fallback → 改成 "操作失败" 让它更通用
export function loadError(err) {
  return explainError(err, $t('error.failed_load_please_try_again_later'))
}
export function saveError(err) {
  return explainError(err, $t('error.save_failed_please_try_again_later'))
}
export function deleteError(err) {
  return explainError(err, $t('error.delete_failed_please_try_again_later'))
}
