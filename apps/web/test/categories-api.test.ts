import type { PGlite } from '@electric-sql/pglite'
import type { Category, RequestContext } from '@ghar/contracts'
import { invitationExpiresAt } from '@ghar/core/invitations'
import { acceptInvitation, createHousehold, createInvitation, type Db } from '@ghar/db/queries'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createAuthUser, createTestDatabase } from '../../../packages/db/test/support/database'
import { PUT as putArchived } from '@/app/api/v1/categories/[categoryId]/archive/route'
import { PATCH as patchCategory } from '@/app/api/v1/categories/[categoryId]/route'
import { GET as listCategories, POST as createCategory } from '@/app/api/v1/categories/route'

// /api/v1/categories against PGlite: the names a household files its spending under. Categories
// are never deleted, only archived, because months of charges and budget lines point at them.

const test = vi.hoisted(() => ({ db: undefined as unknown, session: null as RequestContext | null }))

vi.mock('@/lib/db', () => ({ getDb: () => test.db }))
vi.mock('@/lib/auth/context', async () => {
  const { UnauthorizedError } = await import('@ghar/core/errors')
  const getRequestContext = () =>
    test.session ? Promise.resolve(test.session) : Promise.reject(new UnauthorizedError('Sign in to continue.'))
  return { getRequestContext, getPageContext: getRequestContext }
})

let client: PGlite
let db: Db
let owner: RequestContext
let member: RequestContext

async function readCategories(): Promise<{ status: number; body: { items: Category[] } }> {
  const response = await listCategories(new Request('http://localhost/api/v1/categories?limit=100'), { params: Promise.resolve({}) })
  return { status: response.status, body: (await response.json()) as { items: Category[] } }
}

async function addCategory(body: unknown): Promise<{ status: number; body: { category: Category } }> {
  const response = await createCategory(
    new Request('http://localhost/api/v1/categories', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({}) }
  )
  return { status: response.status, body: (await response.json()) as { category: Category } }
}

async function editCategory(categoryId: string, body: unknown): Promise<{ status: number; body: { category: Category } }> {
  const response = await patchCategory(
    new Request(`http://localhost/api/v1/categories/${categoryId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ categoryId }) }
  )
  return { status: response.status, body: (await response.json()) as { category: Category } }
}

async function setArchived(categoryId: string, isArchived: boolean): Promise<{ status: number; body: { category: Category } }> {
  const response = await putArchived(
    new Request(`http://localhost/api/v1/categories/${categoryId}/archive`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ isArchived }),
    }),
    { params: Promise.resolve({ categoryId }) }
  )
  return { status: response.status, body: (await response.json()) as { category: Category } }
}

async function categoryNamed(name: string): Promise<Category | undefined> {
  return (await readCategories()).body.items.find(category => category.name === name)
}

beforeAll(async () => {
  ;({ client, db } = await createTestDatabase())
  test.db = db

  const ownerId = await createAuthUser(client, 'categories-owner@example.com')
  const { household } = await createHousehold({ userId: ownerId, email: 'categories-owner@example.com' }, db, {
    name: 'The Rao household',
    timezone: 'America/Chicago',
    currency: 'USD',
  })
  owner = { userId: ownerId, householdId: household.id, role: 'owner' }

  const memberId = await createAuthUser(client, 'categories-member@example.com')
  await createInvitation(owner, db, {
    email: 'categories-member@example.com',
    role: 'member',
    tokenHash: 'categories-hash-member',
    expiresAt: invitationExpiresAt(new Date()),
  })
  await acceptInvitation({ userId: memberId, email: 'categories-member@example.com' }, db, {
    tokenHash: 'categories-hash-member',
    now: new Date(),
  })
  member = { userId: memberId, householdId: household.id, role: 'member' }

  test.session = owner
}, 60_000)

afterAll(async () => {
  await client.close()
})

describe('keeping categories', () => {
  it('makes a category, and a second one under it', async () => {
    test.session = owner
    const home = await addCategory({ name: '  Home   care ', kind: 'expense', icon: 'house', colorToken: 'caution' })
    expect(home.status).toBe(201)
    expect(home.body.category).toMatchObject({
      name: 'Home care',
      kind: 'expense',
      parentId: null,
      icon: 'house',
      colorToken: 'caution',
      // A category someone made is nobody's default, whatever the household was seeded with.
      systemKey: null,
      isArchived: false,
    })

    const repairs = await addCategory({ name: 'Repairs', kind: 'expense', parentId: home.body.category.id, icon: 'hammer' })
    expect(repairs.status).toBe(201)
    // Nothing was said about the colour, so it takes the quiet one.
    expect(repairs.body.category).toMatchObject({ parentId: home.body.category.id, colorToken: 'ink-muted' })
  })

  it('keeps the tree two deep, and a child the kind its parent is', async () => {
    test.session = owner
    const repairs = await categoryNamed('Repairs')
    const deeper = await addCategory({ name: 'Plumbing', kind: 'expense', parentId: repairs?.id, icon: 'wrench' })
    expect(deeper.status).toBe(400)

    const home = await categoryNamed('Home care')
    const wrongKind = await addCategory({ name: 'Rent from the flat', kind: 'income', parentId: home?.id, icon: 'banknote' })
    expect(wrongKind.status).toBe(400)
  })

  it('refuses a name the household already uses, whatever the case', async () => {
    test.session = owner
    const clash = await addCategory({ name: 'home care', kind: 'income', icon: 'banknote' })
    expect(clash.status).toBe(409)
  })

  it('refuses an icon it has never heard of', async () => {
    test.session = owner
    expect((await addCategory({ name: 'Espresso', kind: 'expense', icon: 'espresso-machine' })).status).toBe(400)
  })

  it('renames and restyles, and leaves everything else where it is', async () => {
    test.session = owner
    const home = await categoryNamed('Home care')
    const { status, body } = await editCategory(home?.id ?? '', { name: 'The house', colorToken: 'ink' })

    expect(status).toBe(200)
    expect(body.category).toMatchObject({ name: 'The house', colorToken: 'ink', icon: 'house', kind: 'expense', parentId: null })
  })

  it('refuses a change to a category that isn’t there, and a change that says nothing', async () => {
    test.session = owner
    expect((await editCategory(crypto.randomUUID(), { name: 'Anything' })).status).toBe(404)
    const home = await categoryNamed('The house')
    expect((await editCategory(home?.id ?? '', {})).status).toBe(400)
  })

  it('archives a parent with its children, and needs the parent back first', async () => {
    test.session = owner
    const home = await categoryNamed('The house')
    const archived = await setArchived(home?.id ?? '', true)
    expect(archived.status).toBe(200)
    expect(archived.body.category.isArchived).toBe(true)
    expect((await categoryNamed('Repairs'))?.isArchived).toBe(true)

    // The child cannot come back on its own.
    const repairs = await categoryNamed('Repairs')
    expect((await setArchived(repairs?.id ?? '', false)).status).toBe(409)

    expect((await setArchived(home?.id ?? '', false)).body.category.isArchived).toBe(false)
    // Restoring the parent brings back only the parent.
    expect((await categoryNamed('Repairs'))?.isArchived).toBe(true)
    expect((await setArchived(repairs?.id ?? '', false)).status).toBe(200)
  })

  it('lists every category, archived ones included, so what is filed under one keeps its name', async () => {
    test.session = owner
    const gone = await addCategory({ name: 'Old habit', kind: 'expense', icon: 'tag' })
    await setArchived(gone.body.category.id, true)

    const { status, body } = await readCategories()
    expect(status).toBe(200)
    const names = body.items.map(category => category.name)
    // The household's own names, the ones it was started with, and the one nobody uses any more.
    expect(names).toEqual(expect.arrayContaining(['The house', 'Repairs', 'Groceries', 'Old habit']))
    expect(body.items.find(category => category.name === 'Old habit')?.isArchived).toBe(true)
    expect(body.items.find(category => category.name === 'Groceries')?.systemKey).toBe('groceries')
  })

  it('keeps the money side to the adults, and answers nothing at all when signed out', async () => {
    const home = await categoryNamed('The house')

    test.session = member
    expect((await readCategories()).status).toBe(403)
    expect((await addCategory({ name: 'Mine', kind: 'expense', icon: 'tag' })).status).toBe(403)
    expect((await editCategory(home?.id ?? crypto.randomUUID(), { name: 'Ours' })).status).toBe(403)
    expect((await setArchived(home?.id ?? crypto.randomUUID(), true)).status).toBe(403)

    test.session = null
    expect((await readCategories()).status).toBe(401)
  })
})
