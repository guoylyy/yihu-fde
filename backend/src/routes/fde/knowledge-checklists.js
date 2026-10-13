import prisma from '../../lib/prisma.js'
import { createChecklistRouter } from './checklist-router.js'
export function createKnowledgeChecklistRouter({ db = prisma } = {}) { return createChecklistRouter({ db, kind: 'knowledge' }) }
export default createKnowledgeChecklistRouter()
