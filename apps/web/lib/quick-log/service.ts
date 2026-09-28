import 'server-only'
import type { Expiry, QuickLogApplyBody, QuickLogUndo } from '@ghar/contracts'
import { can, type Permission } from '@ghar/core/auth'
import { addCalendarDays, formatCalendarDate, todayInTimeZone, type CalendarDate } from '@ghar/core/dates'
import { ConflictError, ForbiddenError, ValidationError } from '@ghar/core/errors'
import type { ExpirySubjectKind } from '@ghar/core/expiries'
import {
  buildQuickLogPrompt,
  interpretQuickLog,
  QUICK_LOG_DAYS_BACK,
  QUICK_LOG_NOTHING_TO_LOG,
  QUICK_LOG_UNREADABLE,
  quickLogDoneMessage,
  quickLogExpiryName,
  type QuickLogExpiry,
  type QuickLogItems,
  type QuickLogResult,
} from '@ghar/core/quick-log'
import type { Session } from '@/lib/api/authed'
import * as bills from '@/lib/bills/service'
import * as finances from '@/lib/finances/service'
import * as transactions from '@/lib/finances/transactions'
import * as health from '@/lib/health/service'
import * as home from '@/lib/home/service'
import { getQuickLogReader, QuickLogError } from '@/lib/providers/quick-log'
import * as renewals from '@/lib/renewals/service'

// The quick log for one household member: a sentence becomes a suggestion (nothing is written),
// and a suggestion they confirm is recorded through the bills, house, health, money and renewals
// services, with what it takes to undo it. Only what the caller could mark themselves goes to the
// model.

/** Who may renew each kind of thing that runs out, as on the renewals page. */
const EXPIRY_MANAGE: Record<ExpirySubjectKind, Permission> = {
  document: 'documents.manage',
  warranty: 'home.manage',
  renewal: 'documents.manage',
}

const LOGGING: readonly Permission[] = ['finances.manage', 'home.manage', 'health.manage', 'documents.manage']

/** Whether the caller can log anything at all, so the box only shows for someone it can help. */
export function canQuickLog(session: Session): boolean {
  return LOGGING.some(permission => can(session.context.role, permission))
}

/** What a quick log box needs to show, or null for someone it can't help. */
export async function quickLogSetup(
  session: Session
): Promise<{ today: CalendarDate; currency: string; categories: { id: string; name: string }[]; example: string } | null> {
  if (!canQuickLog(session)) return null
  const canLogSpending = can(session.context.role, 'finances.manage')
  // What cash from the quick log can be filed under.
  const categories = canLogSpending ? await finances.listCategoryOptions(session) : []
  return {
    today: todayInTimeZone(session.household.timeZone),
    currency: session.household.currency,
    categories: categories.map(category => ({ id: category.id, name: category.name })),
    // Something this person could actually log, so the hint never suggests a bill to someone who can't pay one.
    example: canLogSpending ? 'Paid the water bill yesterday' : 'Cleaned the gutters yesterday',
  }
}

function expirySubjectId(expiry: Expiry): string {
  switch (expiry.kind) {
    case 'document':
      return expiry.documentId
    case 'warranty':
      return expiry.assetId
    case 'renewal':
      return expiry.renewalId
  }
}

/** What the caller can renew, from a year back on: anything older is renewed from its page. */
async function renewableExpiries(session: Session): Promise<QuickLogExpiry[]> {
  const { role } = session.context
  const kinds = Object.values(EXPIRY_MANAGE)
  if (!can(role, 'documents.view') || !kinds.some(permission => can(role, permission))) return []
  const from = addCalendarDays(todayInTimeZone(session.household.timeZone), -QUICK_LOG_DAYS_BACK)
  const expiries = await renewals.listAllExpiries(session, from)
  return expiries
    .filter(expiry => can(role, EXPIRY_MANAGE[expiry.kind]))
    .map(expiry => ({
      kind: expiry.kind,
      subjectId: expirySubjectId(expiry),
      title: expiry.title,
      expiresOn: expiry.expiresOn,
      notRenewing: expiry.notRenewing,
      suggestedRenewalOn: expiry.suggestedRenewalOn,
    }))
}

async function loggableItems(session: Session): Promise<QuickLogItems> {
  const { role } = session.context
  const spends = can(role, 'finances.manage')
  const [billList, tasks, loggableHealth, categories, expiries] = await Promise.all([
    spends ? bills.listBillsWithOccurrences(session) : [],
    can(role, 'home.manage') ? home.listMaintenance(session) : [],
    health.listLoggableHealth(session),
    spends ? finances.listCategoryOptions(session) : [],
    renewableExpiries(session),
  ])
  return {
    bills: billList,
    tasks: tasks.map(task => ({ id: task.id, title: task.title, assetName: task.assetName, nextDueOn: task.nextDueOn })),
    ...loggableHealth,
    spending: spends ? { categories: categories.map(category => ({ id: category.id, name: category.name })) } : null,
    expiries,
  }
}

function hasNothingToLog(items: QuickLogItems): boolean {
  const { spending, ...lists } = items
  return spending === null && Object.values(lists).every(list => list.length === 0)
}

export async function parseQuickLog(session: Session, text: string): Promise<QuickLogResult> {
  if (!canQuickLog(session)) throw new ForbiddenError("Your role in this household doesn't allow this.")
  const items = await loggableItems(session)
  if (hasNothingToLog(items)) return { entries: [], problem: QUICK_LOG_NOTHING_TO_LOG }

  const today = todayInTimeZone(session.household.timeZone)
  const prompt = buildQuickLogPrompt(text, { today, items })
  let answer
  try {
    answer = await getQuickLogReader().read(prompt)
  } catch (error) {
    if (!(error instanceof QuickLogError)) throw error
    // The message is always ours, never the sentence.
    console.warn(`Reading a quick log failed: ${error.message}`)
    return { entries: [], problem: QUICK_LOG_UNREADABLE }
  }
  return interpretQuickLog(prompt, answer, { today, items })
}

/** Records what they confirmed, and says how to take it back. */
export async function applyQuickLog(session: Session, body: QuickLogApplyBody): Promise<{ message: string; undo: QuickLogUndo }> {
  const { currency } = session.household
  if (body.action === 'bill_paid') {
    const { bill, occurrences } = await bills.getBillDetail(session, body.billId)
    const occurrence = occurrences.find(candidate => candidate.dueOn === body.dueOn)
    if (!occurrence) throw new ValidationError('That bill isn’t due on that date.')
    // Marking it again would change nothing, and its undo would take back the first mark.
    if (occurrence.status === 'paid') throw new ConflictError(`${bill.name} is already marked paid for that date.`)
    await bills.markBillPaid(session, body.billId, { dueOn: body.dueOn, paidOn: body.paidOn })
    return {
      message: quickLogDoneMessage({ ...body, billName: bill.name }, currency),
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
      message: quickLogDoneMessage({ ...body, personName: event.personName }, currency),
      undo: { action: 'health_event', eventId: event.id },
    }
  }

  if (body.action === 'medicine_refilled') {
    const before = await health.getHealthMedicine(session, body.medicineId)
    // Again, it would change nothing, and its undo would take back the first refill.
    if (before.lastRefilledOn === body.refilledOn) throw new ConflictError(`${before.name} is already marked refilled that day.`)
    const medicine = await health.refillHealthMedicine(session, body.medicineId, body.refilledOn)
    const done = quickLogDoneMessage({ ...body, medicineName: medicine.name, personName: medicine.personName }, currency)
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

  if (body.action === 'cash_spent') {
    if (body.spentOn > todayInTimeZone(session.household.timeZone)) {
      const message = 'Pick a day that isn’t in the future.'
      throw new ValidationError(message, { details: { fieldErrors: { spentOn: [message] } } })
    }
    const transaction = await transactions.addCashSpend(session, body)
    const done = quickLogDoneMessage({ ...body, categoryName: transaction.categoryName }, currency)
    return {
      message: transaction.categoryName === null ? done : `${done} Filed under ${transaction.categoryName}.`,
      undo: { action: 'cash_spent', transactionId: transaction.id },
    }
  }

  if (body.action === 'renewed') {
    const params = { kind: body.kind, subjectId: body.subjectId }
    const { expiry, previousExpiresOn, previousIssuedOn } = await renewals.renewExpiryUndoably(session, params, body.expiresOn)
    const name = quickLogExpiryName(expiry)
    return {
      message: quickLogDoneMessage(
        { ...body, name, currentExpiresOn: previousExpiresOn, expiresOn: expiry.expiresOn, suggestedRenewalOn: null },
        currency
      ),
      undo: { ...params, action: 'renewed', renewedTo: expiry.expiresOn, previousExpiresOn, previousIssuedOn },
    }
  }

  if (body.action === 'not_renewing') {
    const params = { kind: body.kind, subjectId: body.subjectId }
    const { expiry: before } = await renewals.getExpiry(session, params)
    // Its undo would take back somebody else's say-so.
    if (before.notRenewing) throw new ConflictError(`${quickLogExpiryName(before)} is already marked as not being renewed.`)
    const { expiry } = await renewals.markNotRenewing(session, params, { expiresOn: body.expiresOn })
    return {
      message: quickLogDoneMessage({ ...body, name: quickLogExpiryName(expiry) }, currency),
      undo: { ...params, action: 'not_renewing' },
    }
  }

  const { task, entry } = await home.completeMaintenanceTask(session, body.taskId, {
    completedOn: body.completedOn,
    costCents: body.costCents,
    notes: null,
    documentId: null,
  })
  return {
    message: quickLogDoneMessage({ ...body, taskTitle: task.title, assetName: task.assetName }, currency),
    undo: { action: 'task_done', taskId: task.id, entryId: entry.id },
  }
}
