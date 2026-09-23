import 'server-only'
import type {
  Asset,
  AssetBody,
  AssetListItem,
  CompleteMaintenanceBody,
  HouseholdDocument,
  MaintenanceBody,
  MaintenanceLogEntry,
  MaintenanceTask,
  PageQuery,
} from '@ghar/contracts'
import { todayInTimeZone, type CalendarDate } from '@ghar/core/dates'
import { expiryState } from '@ghar/core/documents'
import { cadenceLabel, maintenanceState, searchAssets } from '@ghar/core/home'
import * as queries from '@ghar/db/queries'
import type { AssetRow, MaintenanceLogEntryRow, MaintenanceTaskRow, PageRequest } from '@ghar/db/queries'
import type { Session } from '@/lib/api/authed'
import { collectPage, pageRequest, pageResponse, type PageResult } from '@/lib/api/cursor'
import { getDb } from '@/lib/db'
import { toDocument } from '@/lib/documents/service'

// What the /api/v1/assets and /api/v1/maintenance routes and the house pages call. The queries own
// permissions and the schedule arithmetic; this file joins an asset to its jobs, papers and history.

export function toAsset(row: AssetRow, today: CalendarDate): Asset {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    make: row.make,
    model: row.model,
    serialNumber: row.serialNumber,
    purchasedOn: row.purchasedOn,
    purchasePriceCents: row.purchasePriceCents,
    warrantyExpiresOn: row.warrantyExpiresOn,
    warrantyState: row.warrantyExpiresOn === null ? null : expiryState(row.warrantyExpiresOn, today),
    location: row.location,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toMaintenanceTask(row: MaintenanceTaskRow, today: CalendarDate): MaintenanceTask {
  return {
    id: row.id,
    assetId: row.assetId,
    assetName: row.assetName,
    title: row.title,
    cadenceMonths: row.cadenceMonths,
    cadenceMiles: row.cadenceMiles,
    cadence: cadenceLabel(row.cadenceMonths, row.cadenceMiles),
    lastDoneOn: row.lastDoneOn,
    nextDueOn: row.nextDueOn,
    state: maintenanceState(row.nextDueOn, today),
    assignedUserId: row.assignedUserId,
    instructions: row.instructions,
    vendor: row.vendor,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export function toLogEntry(row: MaintenanceLogEntryRow): MaintenanceLogEntry {
  return {
    id: row.id,
    maintenanceId: row.maintenanceId,
    taskTitle: row.taskTitle,
    completedOn: row.completedOn,
    completedBy: row.completedBy,
    costCents: row.costCents,
    notes: row.notes,
    documentId: row.documentId,
    createdAt: row.createdAt.toISOString(),
  }
}

const householdToday = (session: Session) => todayInTimeZone(session.household.timeZone)

// Assets

/** Turns an asset row into a list item: the asset, its next job, and how many documents are filed under it. */
function toAssetListItem(
  tasks: readonly MaintenanceTaskRow[],
  documentCounts: ReadonlyMap<string, number>,
  today: CalendarDate
): (row: AssetRow) => AssetListItem {
  // Jobs arrive soonest due first, so the first one seen for an asset is its next.
  const nextTask = new Map<string, MaintenanceTaskRow>()
  for (const task of tasks) {
    if (task.assetId !== null && !nextTask.has(task.assetId)) nextTask.set(task.assetId, task)
  }

  return row => {
    const task = nextTask.get(row.id)
    return {
      ...toAsset(row, today),
      nextTask: task ? { id: task.id, title: task.title, nextDueOn: task.nextDueOn, state: maintenanceState(task.nextDueOn, today) } : null,
      documentCount: documentCounts.get(row.id) ?? 0,
    }
  }
}

export async function listAssets(session: Session, query: { q?: string } = {}): Promise<AssetListItem[]> {
  const { context } = session
  const db = getDb()
  const [assets, tasks, documentCounts] = await Promise.all([
    queries.listAssets(context, db),
    queries.listMaintenanceTasks(context, db),
    queries.countDocumentsByAsset(context, db),
  ])
  const q = query.q?.trim()
  return (q ? searchAssets(assets, q) : assets).map(toAssetListItem(tasks, documentCounts, householdToday(session)))
}

/** Just names, for the pickers that file a job or a document under a thing. One query. */
export async function listAssetOptions(session: Session): Promise<{ id: string; name: string }[]> {
  const rows = await queries.listAssets(session.context, getDb())
  return rows.map(row => ({ id: row.id, name: row.name }))
}

/**
 * The house page: every thing with its next job, and every job. The jobs are read once and feed
 * both, where listAssets and listMaintenance would each read them.
 */
export async function getHouseOverview(session: Session): Promise<{ assets: AssetListItem[]; tasks: MaintenanceTask[] }> {
  const { context } = session
  const db = getDb()
  const [assets, tasks, documentCounts] = await Promise.all([
    queries.listAssets(context, db),
    queries.listMaintenanceTasks(context, db),
    queries.countDocumentsByAsset(context, db),
  ])
  const today = householdToday(session)
  return {
    assets: assets.map(toAssetListItem(tasks, documentCounts, today)),
    tasks: tasks.map(task => toMaintenanceTask(task, today)),
  }
}

/** A page of assets for the API, by name. With `q`, only the assets matching every word. */
export async function listAssetsPage(session: Session, query: PageQuery & { q?: string }): Promise<PageResult<AssetListItem>> {
  const { context } = session
  const db = getDb()
  const q = query.q?.trim() || undefined
  const scope = { sort: 'assets:name', filters: { q } }
  const fetchPage = (request: PageRequest) => queries.listAssetsPage(context, db, request)
  const request = pageRequest(query, scope)
  const [page, tasks, documentCounts] = await Promise.all([
    q ? collectPage(fetchPage, request, row => searchAssets([row], q).length > 0) : fetchPage(request),
    queries.listMaintenanceTasks(context, db),
    queries.countDocumentsByAsset(context, db),
  ])
  return pageResponse(page, scope, toAssetListItem(tasks, documentCounts, householdToday(session)))
}

export interface AssetDetail {
  asset: Asset
  tasks: MaintenanceTask[]
  documents: HouseholdDocument[]
  history: MaintenanceLogEntry[]
}

export async function getAssetDetail(session: Session, assetId: string): Promise<AssetDetail> {
  const { context } = session
  const db = getDb()
  const [asset, tasks, documents, history] = await Promise.all([
    queries.getAsset(context, db, assetId),
    queries.listMaintenanceTasks(context, db, { assetId }),
    queries.listDocuments(context, db, { assetId }),
    queries.listMaintenanceHistory(context, db, { assetId }),
  ])
  const today = householdToday(session)
  return {
    asset: toAsset(asset, today),
    tasks: tasks.map(task => toMaintenanceTask(task, today)),
    documents: documents.map(document => toDocument(document, today)),
    history: history.map(toLogEntry),
  }
}

export async function createAsset(session: Session, body: AssetBody): Promise<Asset> {
  return toAsset(await queries.createAsset(session.context, getDb(), body), householdToday(session))
}

export async function updateAsset(session: Session, assetId: string, body: AssetBody): Promise<Asset> {
  return toAsset(await queries.updateAsset(session.context, getDb(), assetId, body), householdToday(session))
}

export async function deleteAsset(session: Session, assetId: string): Promise<{ assetId: string }> {
  await queries.deleteAsset(session.context, getDb(), assetId)
  return { assetId }
}

// Maintenance

export async function listMaintenance(session: Session): Promise<MaintenanceTask[]> {
  const today = householdToday(session)
  const tasks = await queries.listMaintenanceTasks(session.context, getDb())
  return tasks.map(task => toMaintenanceTask(task, today))
}

/** A page of jobs for the API, soonest due first as on the house page. */
export async function listMaintenancePage(session: Session, query: PageQuery): Promise<PageResult<MaintenanceTask>> {
  const today = householdToday(session)
  const scope = { sort: 'maintenance:next-due' }
  const page = await queries.listMaintenanceTasksPage(session.context, getDb(), pageRequest(query, scope))
  return pageResponse(page, scope, task => toMaintenanceTask(task, today))
}

export async function getMaintenanceDetail(
  session: Session,
  taskId: string
): Promise<{ task: MaintenanceTask; history: MaintenanceLogEntry[] }> {
  const { context } = session
  const db = getDb()
  const [task, history] = await Promise.all([
    queries.getMaintenanceTask(context, db, taskId),
    queries.listMaintenanceHistory(context, db, { taskId }),
  ])
  return { task: toMaintenanceTask(task, householdToday(session)), history: history.map(toLogEntry) }
}

export async function createMaintenanceTask(session: Session, body: MaintenanceBody): Promise<MaintenanceTask> {
  return toMaintenanceTask(await queries.createMaintenanceTask(session.context, getDb(), body), householdToday(session))
}

export async function updateMaintenanceTask(session: Session, taskId: string, body: MaintenanceBody): Promise<MaintenanceTask> {
  return toMaintenanceTask(await queries.updateMaintenanceTask(session.context, getDb(), taskId, body), householdToday(session))
}

export async function deleteMaintenanceTask(session: Session, taskId: string): Promise<{ taskId: string }> {
  await queries.deleteMaintenanceTask(session.context, getDb(), taskId)
  return { taskId }
}

/** Mark done. With no date it was done today, in the household's zone. */
export async function completeMaintenanceTask(
  session: Session,
  taskId: string,
  body: CompleteMaintenanceBody
): Promise<{ task: MaintenanceTask; entry: MaintenanceLogEntry }> {
  const today = householdToday(session)
  const { task, entry } = await queries.completeMaintenanceTask(session.context, getDb(), taskId, {
    completedOn: body.completedOn ?? today,
    costCents: body.costCents,
    notes: body.notes,
    documentId: body.documentId,
    today,
  })
  return { task: toMaintenanceTask(task, today), entry: toLogEntry(entry) }
}

export async function deleteMaintenanceCompletion(session: Session, taskId: string, entryId: string): Promise<{ task: MaintenanceTask }> {
  const task = await queries.deleteMaintenanceCompletion(session.context, getDb(), taskId, entryId)
  return { task: toMaintenanceTask(task, householdToday(session)) }
}
