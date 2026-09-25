import 'server-only'
import type { QuickLogApplyBody, QuickLogProposal, QuickLogUndo } from '@ghar/contracts'
import { can } from '@ghar/core/auth'
import { formatCalendarDate, todayInTimeZone } from '@ghar/core/dates'
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
import * as health from '@/lib/health/service'
import * as home from '@/lib/home/service'
import { getQuickLogReader, QuickLogError } from '@/lib/providers/quick-log'

// The quick log for one household member: a sentence becomes a suggestion (nothing is written),
// and a suggestion they confirm is recorded through the bills, house and health services, with
// what it takes to undo it. Only what the caller could mark themselves goes to the model.

/** Whether the caller can log anything at all, so the box only shows for someone it can help. */
export function canQuickLog(session: Session): boolean {
  const { role } = session.context
  return can(role, 'finances.manage') || can(role, 'home.manage') || can(role, 'health.manage')
}

async function loggableItems(session: Session): Promise<QuickLogItems> {
  const { role } = session.context
  const [billList, tasks, loggableHealth] = await Promise.all([
    can(role, 'finances.manage') ? bills.listBillsWithOccurrences(session) : [],
    can(role, 'home.manage') ? home.listMaintenance(session) : [],
    health.listLoggableHealth(session),
  ])
  return {
    bills: billList,
    tasks: tasks.map(task => ({ id: task.id, title: task.title, assetName: task.assetName, nextDueOn: task.nextDueOn })),
    ...loggableHealth,
  }
}

export async function parseQuickLog(session: Session, text: string): Promise<{ choices: QuickLogProposal[]; problem: string | null }> {
  if (!canQuickLog(session)) throw new ForbiddenError("Your role in this household doesn't allow this.")
  const items = await loggableItems(session)
  if (Object.values(items).every(list => list.length === 0)) return { choices: [], problem: QUICK_LOG_NOTHING_TO_LOG }

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

  if (body.action === 'health_event') {
    const event = await health.createHealthEvent(session, {
      personId: body.personId,
      kind: body.kind,
      title: body.title,
      occurredOn: body.occurredOn,
      contactId: null,
      documentId: null,
      note: null,
    })
    return {
      message: quickLogDoneMessage({ ...body, personName: event.personName }),
      undo: { action: 'health_event', eventId: event.id },
    }
  }

  if (body.action === 'medicine_refilled') {
    const before = await health.getHealthMedicine(session, body.medicineId)
    // Again, it would change nothing, and its undo would take back the first refill.
    if (before.lastRefilledOn === body.refilledOn) throw new ConflictError(`${before.name} is already marked refilled that day.`)
    const medicine = await health.refillHealthMedicine(session, body.medicineId, body.refilledOn)
    const done = quickLogDoneMessage({ ...body, medicineName: medicine.name, personName: medicine.personName })
    return {
      message: medicine.refillBy === null ? done : `${done} Next refill by ${formatCalendarDate(medicine.refillBy, 'd MMM')}.`,
      undo: {
        action: 'medicine_refilled',
        medicineId: medicine.id,
        refilledOn: body.refilledOn,
        previousRefillBy: before.refillBy,
        previousLastRefilledOn: before.lastRefilledOn,
      },
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
