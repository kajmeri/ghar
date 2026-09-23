import 'server-only'
import type { Account, Category, CategoryBody, CategoryChanges, PageQuery } from '@ghar/contracts'
import * as queries from '@ghar/db/queries'
import type { AccountRow, CategoryRow } from '@ghar/db/queries'
import type { Session } from '@/lib/api/authed'
import { pageRequest, pageResponse, type PageResult } from '@/lib/api/cursor'
import { getDb } from '@/lib/db'

// Accounts and categories as /api/v1/accounts and /api/v1/categories list them, for a client picking
// where a bill is paid from or how a charge is filed. Who sees what matches the bill form: visible
// accounts, and every category, archived ones included.

/** An account's name in a picker, with its last digits when the bank sent them. */
export function accountLabel(account: Pick<AccountRow, 'name' | 'mask'>): string {
  return account.mask ? `${account.name} ••${account.mask}` : account.name
}

export function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    label: accountLabel(row),
    name: row.name,
    mask: row.mask,
    institutionName: row.institutionName,
    type: row.type,
    subtype: row.subtype,
  }
}

export function toCategory(row: CategoryRow): Category {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    kind: row.kind,
    icon: row.icon,
    colorToken: row.colorToken,
    systemKey: row.systemKey,
    sortOrder: row.sortOrder,
    isArchived: row.isArchived,
  }
}

/** Visible accounts, by bank connection in the order they were linked, then by name. */
export async function listAccountsPage(session: Session, query: PageQuery): Promise<PageResult<Account>> {
  const scope = { sort: 'accounts:linked-name' }
  const page = await queries.listAccountsPage(session.context, getDb(), { includeHidden: false }, pageRequest(query, scope))
  return pageResponse(page, scope, toAccount)
}

/**
 * The accounts a filter or a form offers, in the order they were linked. Hidden accounts are left
 * out, as they are from the list they filter.
 */
export async function listAccountOptions(session: Session): Promise<Account[]> {
  const rows = await queries.listAccounts(session.context, getDb())
  return rows.filter(row => !row.isHidden).map(toAccount)
}

/**
 * The categories a picker offers: the household's own order, and archived ones left out because
 * nothing new should be filed under one. A charge already filed under an archived category still
 * shows its name, which comes with the charge.
 */
export async function listCategoryOptions(session: Session): Promise<Category[]> {
  const rows = await queries.listCategories(session.context, getDb())
  return rows.filter(row => !row.isArchived).map(toCategory)
}

/** Every category in the household's order, archived ones included so what's filed under one keeps its name. */
export async function listCategoriesPage(session: Session, query: PageQuery): Promise<PageResult<Category>> {
  const scope = { sort: 'categories:sort-order' }
  const page = await queries.listCategoriesPage(session.context, getDb(), pageRequest(query, scope))
  return pageResponse(page, scope, toCategory)
}

/** Every category the household has, the archived ones included, for the screen that keeps them. */
export async function listAllCategories(session: Session): Promise<Category[]> {
  const rows = await queries.listCategories(session.context, getDb())
  return rows.map(toCategory)
}

export async function addCategory(session: Session, body: CategoryBody): Promise<Category> {
  return toCategory(await queries.createCategory(session.context, getDb(), body))
}

export async function saveCategory(session: Session, input: CategoryChanges & { categoryId: string }): Promise<Category> {
  return toCategory(await queries.updateCategory(session.context, getDb(), input))
}

/** Archiving a parent takes its children with it; the categories themselves are never deleted. */
export async function archiveCategory(session: Session, input: { categoryId: string; isArchived: boolean }): Promise<Category> {
  return toCategory(await queries.setCategoryArchived(session.context, getDb(), input))
}
