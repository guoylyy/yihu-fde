// 顶部「人」筛选器的数据: /api/okr/team 的 rows(ADMIN 全部, 其他人本团队; 后端过滤), 自己排第一。
// 拉不到(接口失败)就只有自己, 不打断页面。
import { ref } from 'vue'
import { fde } from '@/api/index.js'
import { currentUser, pickerPeople } from './okrPeople.js'

export function useOkrPeople() {
  const me = currentUser()
  const people = ref(pickerPeople([], me))
  let loaded = null

  async function loadPeople(week) {
    if (loaded === (week || '')) return
    loaded = week || ''
    try {
      const d = await fde.okr.team(week)
      people.value = pickerPeople(d?.rows || [], me)
    } catch {
      people.value = pickerPeople([], me)
    }
  }

  /** 正在看的人不在列表里(如管理员从别处带 userId 进来)就补进去, 筛选器能显示名字 */
  function ensurePerson(u) {
    if (u?.id && !people.value.some(p => String(p.id) === String(u.id))) {
      people.value = [...people.value, { id: String(u.id), name: u.name || u.username || String(u.id), avatarUrl: u.avatarUrl || '', role: u.role || '' }]
    }
  }

  return { me, meId: String(me.id || ''), people, loadPeople, ensurePerson }
}
