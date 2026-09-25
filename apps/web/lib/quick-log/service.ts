import 'server-only'
import type { QuickLogApplyBody, QuickLogProposal, QuickLogUndo } from '@ghar/contracts'
import { can } from '@ghar/core/auth'
import { todayInTimeZone } from '@ghar/core/dates'
import { ConflictError, ForbiddenError, ValidationError } from '@ghar/core/errors'
import {
  buildQuickLogPrompt,
  interpretQuickLog,
  QUICK_LOG_NOTHING_TO_LOG,
  QUICK_LOG_UNREADABLE,
  quickLogDoneMessage,
  type QuickLogItems,
} from '@ghar/core/quick-log'
import type { Session } from '@/lib/api/authed'
import * as bills from '@/lib/bills/service'
import * as home from '@/lib/home/service'
import { getQuickLogReader, QuickLogError } from '@/lib/providers/quick-log'

// The quick log for one household member: a sentence becomes a suggestion (nothing is written),
// and a suggestion they confirm is recorded through the bills and house services, with what it
// takes to undo it. Only what the caller could mark themselves goes to the model.

/** Whether the caller can log anything at all, so the box only shows for someone it can help. */
export function canQuickLog(session: Session): boolean {
  const { role } = session.context
  return can(role, 'finances.manage') || can(role, 'home.manage')
}

async function loggableItems(session: Session): Promise<QuickLogItems> {
  const { role } = session.context
  const [billList, tasks] = await Promise.all([
    can(role, 'finances.manage') ? bills.listBillsWithOccurrences(session) : [],
    can(role, 'home.manage') ? home.listMaintenance(session) : [],
  ])
  return {
    bills: billList,
    tasks: tasks.map(task => ({ id: task.id, title: task.title, assetName: task.assetName, nextDueOn: task.nextDueOn })),
  }
}

export async function parseQuickLog(session: Session, text: string): Promise<{ choices: QuickLogProposal[]; problem: string | null }> {
  if (!canQuickLog(session)) throw new ForbiddenError("Your role in this household doesn't allow this.")
  const items = await loggableItems(session)
  if (items.bills.length === 0 && items.tasks.length === 0) return { choices: [], problem: QUICK_LOG_NOTHING_TO_LOG }

  const today = todayInTimeZone(session.household.timeZone)
  const prompt = buildQuickLogPrompt(text, { today, items })
  let answer
  try {
    answer = await getQuickLogReader().read(prompt)
  } catch (error) {
    if (!(error instanceof QuickLogError)) throw error
    // The message is always ours, never the sentence.
    console.warn(`Reading a quick log failed: ${error.message}`)
    return { choices: [], problem: QUICK_LOG_UNREADABLE }
  }
  return interpretQuickLog(prompt, answer, { today, items })
}

/** Records what they confirmed, and says how to take it back. */
export async function applyQuickLog(session: Session, body: QuickLogApplyBody): Promise<{ message: string; undo: QuickLogUndo }> {
  if (body.action === 'bill_paid') {
    const { bill, occurrences } = await bills.getBillDetail(session, body.billId)
    const occurrence = occurrences.find(candidate => candidate.dueOn === body.dueOn)
    if (!occurrence) throw new ValidationError('That bill isn’t due on that date.')
    // Marking it again would change nothing, and its undo would take back the first mark.
    if (occurrence.status === 'paid') throw new ConflictError(`${bill.name} is already marked paid for that date.`)
    await bills.markBillPaid(session, body.billId, { dueOn: body.dueOn, paidOn: body.paidOn })
    return {
      message: quickLogDoneMessage({ ...body, billName: bill.name }),
      undo: { action: 'bill_paid', billId: body.billId, dueOn: body.dueOn },
    }
  }

  const { task, entry } = await home.completeMaintenanceTask(session, body.taskId, {
    completedOn: body.completedOn,
    costCents: body.costCents,
    notes: null,
    documentId: null,
  })
  return {
    message: quickLogDoneMessage({ ...body, taskTitle: task.title, assetName: task.assetName }),
    undo: { action: 'task_done', taskId: task.id, entryId: entry.id },
  }
}
