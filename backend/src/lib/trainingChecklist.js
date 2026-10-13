import crypto from 'node:crypto'

/** Extract actionable markdown task-list items, excluding fenced code examples. */
export function parseChecklist(markdown = '') {
  const items = []
  const occurrences = new Map()
  let fence = null
  let section = ''
  if (String(markdown).length > 256000) throw new RangeError('检查单正文过长')
  for (const line of String(markdown).split(/\r?\n/)) {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/)
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null
      continue
    }
    if (marker) { fence = marker[1]; continue }
    const heading = line.match(/^ {0,3}#{1,6}\s+(.+?)\s*#*$/)
    if (heading) section = heading[1]
    const match = line.match(/^ {0,3}[-+*]\s+\[([ xX])\]\s+(.+?)\s*$/)
    if (!match) continue
    const label = match[2].trim()
    if (label.length > 1000 || items.length >= 500) throw new RangeError('检查单超出500项或单项1000字限制')
    const identity = `${section}\u0000${label}`
    const occurrence = occurrences.get(identity) || 0
    occurrences.set(identity, occurrence + 1)
    const itemKey = crypto.createHash('sha256').update(`${identity}\u0000${occurrence}`).digest('hex').slice(0, 32)
    // An author's pre-ticked checkbox is not evidence that this learner completed it.
    items.push({ itemKey, label, section, defaultChecked: false })
  }
  return items
}
