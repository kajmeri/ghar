import type { PGlite } from '@electric-sql/pglite';
import type { RequestContext } from '@ghar/contracts';
import type { BankTransaction } from '@ghar/core/banking';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '@ghar/core/errors';
import { categorizeDeterministic, DEFAULT_CATEGORIES } from '@ghar/core/finances';
import { invitationExpiresAt } from '@ghar/core/invitations';
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';
import { categories } from '../src/schema';
import {
  applyTransactionSync,
  countReviewQueue,
  createBankItem,
  getTransaction,
  listAccounts,
  listTransactions,
  updateTransaction,
} from '../src/queries/banking';
import {
  applyCategoryAssignments,
  applyModelOutcomes,
  closeBudgetPeriod,
  copyPreviousBudget,
  createCategory,
  createCategoryRule,
  createGoal,
  deleteBudgetLine,
  deleteCategoryRule,
  deleteGoal,
  ensureDefaultCategories,
  findRuleSuggestion,
  getBudgetPeriod,
  listCategories,
  listCategoryRules,
  listGoals,
  listMonthlyCategorySpend,
  listTopMerchants,
  loadCategorizationInput,
  setBudgetLine,
  setCategoryArchived,
  updateCategory,
  type CategoryRow,
} from '../src/queries/finances';
import { createInvitation } from '../src/queries/invitations';
import { acceptInvitation, createHousehold } from '../src/queries/session';
import type { Db, SystemContext } from '../src/queries/types';
import { createAuthUser, createTestDatabase, queryAs } from './support/database';

const now = new Date('2026-09-13T15:00:00Z');
const today = '2026-09-13';

let client: PGlite;
let db: Db;
const users = { ownerA: '', memberA: '', ownerB: '' };
let a: RequestContext;
let b: RequestContext;
let system: SystemContext;
let ids: Record<string, string>;

function bankTransaction(
  plaidTransactionId: string,
  fields: Pick<BankTransaction, 'amountCents' | 'date' | 'name'> & Partial<BankTransaction>,
): BankTransaction {
  return {
    plaidTransactionId,
    plaidAccountId: 'acct-checking',
    pendingTransactionId: null,
    isoCurrency: 'USD',
    authorizedDate: null,
    merchantName: null,
    paymentChannel: 'in store',
    categoryPrimary: null,
    categoryDetailed: null,
    categoryConfidence: null,
    isPending: false,
    ...fields,
  };
}

async function categoryByKey(ctx: RequestContext, key: string): Promise<CategoryRow> {
  const category = (await listCategories(ctx, db)).find((row) => row.systemKey === key);
  if (!category) throw new Error(`No ${key} category`);
  return category;
}

beforeAll(async () => {
  ({ client, db } = await createTestDatabase());
  users.ownerA = await createAuthUser(client, 'owner-a@example.com');
  users.memberA = await createAuthUser(client, 'member-a@example.com');
  users.ownerB = await createAuthUser(client, 'owner-b@example.com');

  const householdA = await createHousehold(
    { userId: users.ownerA, email: 'owner-a@example.com' },
    db,
    { name: 'Household A', timezone: 'America/Chicago', currency: 'USD' },
  );
  a = { userId: users.ownerA, householdId: householdA.household.id, role: 'owner' };
  system = { householdId: a.householdId, userId: null };

  const householdB = await createHousehold(
    { userId: users.ownerB, email: 'owner-b@example.com' },
    db,
    { name: 'Household B', timezone: 'UTC', currency: 'USD' },
  );
  b = { userId: users.ownerB, householdId: householdB.household.id, role: 'owner' };

  await createInvitation(a, db, {
    email: 'member-a@example.com',
    role: 'member',
    tokenHash: 'hash-member-a',
    expiresAt: invitationExpiresAt(now),
  });
  await acceptInvitation({ userId: users.memberA, email: 'member-a@example.com' }, db, {
    tokenHash: 'hash-member-a',
    now,
  });

  const item = await createBankItem(a, db, {
    environment: 'fake',
    plaidItemId: 'item-a',
    institutionId: null,
    institutionName: 'Test Bank',
    accessTokenEncrypted: 'v1:test:test:test',
  });
  await applyTransactionSync(system, db, {
    itemId: item.id,
    expectedCursor: null,
    nextCursor: 'cursor-1',
    now,
    accounts: [
      {
        plaidAccountId: 'acct-checking',
        name: 'Checking',
        officialName: null,
        mask: '0001',
        type: 'depository',
        subtype: 'checking',
        currentBalanceCents: 250_000,
        availableBalanceCents: 250_000,
        isoCurrency: 'USD',
      },
    ],
    pages: [
      {
        added: [
          bankTransaction('tj-1', {
            amountCents: -4520,
            date: '2026-08-03',
            name: 'TRADER JOES 552 AUSTIN',
            merchantName: "Trader Joe's",
          }),
          bankTransaction('coffee', {
            amountCents: -650,
            date: '2026-08-05',
            name: 'BLUE BOTTLE',
            merchantName: 'Blue Bottle',
            categoryPrimary: 'FOOD_AND_DRINK',
            categoryDetailed: 'FOOD_AND_DRINK_COFFEE',
            categoryConfidence: 'VERY_HIGH',
          }),
          bankTransaction('mystery', {
            amountCents: -12_000,
            date: '2026-08-10',
            name: 'POS 88213',
          }),
          bankTransaction('paycheck', {
            amountCents: 500_000,
            date: '2026-08-15',
            name: 'ACME PAYROLL',
            categoryPrimary: 'INCOME',
            categoryDetailed: 'INCOME_WAGES',
            categoryConfidence: 'VERY_HIGH',
          }),
          bankTransaction('hardware', {
            amountCents: -3000,
            date: '2026-08-18',
            name: 'ACE HARDWARE',
            merchantName: 'Ace Hardware',
          }),
          bankTransaction('tj-2', {
            amountCents: -3010,
            date: '2026-08-20',
            name: 'TRADER JOES 552 AUSTIN',
            merchantName: "Trader Joe's",
          }),
          bankTransaction('tj-3', {
            amountCents: -2000,
            date: '2026-09-02',
            name: 'TRADER JOES 552 AUSTIN',
            merchantName: "Trader Joe's",
          }),
        ],
        modified: [],
        removed: [],
      },
    ],
  });

  ids = {};
  const rows = await db.query.transactions.findMany({
    columns: { id: true, plaidTransactionId: true },
  });
  for (const row of rows) if (row.plaidTransactionId) ids[row.plaidTransactionId] = row.id;
}, 60_000);

describe('default categories', () => {
  it('seeds the tree when a household is created, separately per household', async () => {
    const seeded = await listCategories(a, db);
    expect(seeded.map((row) => row.systemKey).sort()).toEqual(
      DEFAULT_CATEGORIES.map((category) => category.key).sort(),
    );
    const food = seeded.find((row) => row.systemKey === 'food');
    const groceries = seeded.find((row) => row.systemKey === 'groceries');
    expect(groceries?.parentId).toBe(food?.id);

    const theirs = await listCategories(b, db);
    expect(theirs).toHaveLength(seeded.length);
    const mine = new Set(seeded.map((row) => row.id));
    expect(theirs.some((row) => mine.has(row.id))).toBe(false);
  });

  it('backfills only what is missing, and steps around names the household already uses', async () => {
    expect(await ensureDefaultCategories(system, db)).toEqual({ inserted: 0 });

    const games = await categoryByKey(a, 'games');
    const pets = await categoryByKey(a, 'pets');
    await db.delete(categories).where(eq(categories.id, games.id));
    await db.delete(categories).where(eq(categories.id, pets.id));
    await createCategory(a, db, {
      name: 'pets',
      parentId: null,
      kind: 'expense',
      icon: 'paw-print',
      colorToken: 'ink-muted',
    });

    expect(await ensureDefaultCategories(a, db)).toEqual({ inserted: 1 });
    expect((await categoryByKey(a, 'games')).parentId).toBe(
      (await categoryByKey(a, 'entertainment')).id,
    );
    const named = (await listCategories(a, db)).filter((row) => row.name.toLowerCase() === 'pets');
    expect(named).toEqual([expect.objectContaining({ name: 'pets', systemKey: null })]);
  });
});

describe('categories', () => {
  it('creates a child category with a tidy name at the end of its siblings', async () => {
    const entertainment = await categoryByKey(a, 'entertainment');
    const created = await createCategory(a, db, {
      name: '  Date   nights ',
      parentId: entertainment.id,
      kind: 'expense',
      icon: 'party-popper',
      colorToken: 'ink-muted',
    });
    expect(created).toMatchObject({ name: 'Date nights', parentId: entertainment.id });
    const siblings = (await listCategories(a, db)).filter(
      (row) => row.parentId === entertainment.id && row.id !== created.id,
    );
    expect(siblings.every((row) => row.sortOrder < created.sortOrder)).toBe(true);
  });

  it('refuses duplicate names, deep trees, mixed kinds and parents from other households', async () => {
    const input = { icon: 'gift', colorToken: 'ink-muted', kind: 'expense' } as const;
    await expect(
      createCategory(a, db, { ...input, name: 'GROCERIES', parentId: null }),
    ).rejects.toBeInstanceOf(ConflictError);
    const groceries = await categoryByKey(a, 'groceries');
    await expect(
      createCategory(a, db, { ...input, name: 'Snacks', parentId: groceries.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    const income = await categoryByKey(a, 'income');
    await expect(
      createCategory(a, db, { ...input, name: 'Bonus', parentId: income.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createCategory(b, db, {
        ...input,
        name: 'Snacks',
        parentId: (await categoryByKey(a, 'food')).id,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('renames within the household only', async () => {
    const coffee = await categoryByKey(a, 'coffee');
    await expect(
      updateCategory(a, db, { categoryId: coffee.id, name: 'groceries' }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      updateCategory(b, db, { categoryId: coffee.id, name: 'Mine now' }),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(
      await updateCategory(a, db, { categoryId: coffee.id, name: 'Coffee shops' }),
    ).toMatchObject({ name: 'Coffee shops', systemKey: 'coffee' });
  });

  it('archives a parent with its children and restores only what is asked', async () => {
    const entertainment = await categoryByKey(a, 'entertainment');
    const events = await categoryByKey(a, 'events');
    await setCategoryArchived(a, db, { categoryId: entertainment.id, isArchived: true });
    const children = (await listCategories(a, db)).filter(
      (row) => row.parentId === entertainment.id,
    );
    expect(children.length).toBeGreaterThan(0);
    expect(children.every((row) => row.isArchived)).toBe(true);

    await expect(
      setCategoryArchived(a, db, { categoryId: events.id, isArchived: false }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      createCategoryRule(a, db, {
        matcherType: 'merchant_contains',
        matcherValue: 'cinema',
        categoryId: events.id,
      }),
    ).rejects.toBeInstanceOf(ValidationError);

    await setCategoryArchived(a, db, { categoryId: entertainment.id, isArchived: false });
    expect((await categoryByKey(a, 'entertainment')).isArchived).toBe(false);
    expect((await categoryByKey(a, 'events')).isArchived).toBe(true);
    await setCategoryArchived(a, db, { categoryId: events.id, isArchived: false });
  });
});

describe('categorization', () => {
  it("applies Plaid's categories and leaves the rest for the model", async () => {
    const input = await loadCategorizationInput(system, db);
    expect(input.candidates).toHaveLength(7);
    const { assigned, unmatched } = categorizeDeterministic(input.candidates, input);
    expect(unmatched.map((row) => row.id).sort()).toEqual(
      [ids['tj-1'], ids['tj-2'], ids['tj-3'], ids.mystery, ids.hardware].sort(),
    );
    expect(await applyCategoryAssignments(system, db, assigned)).toEqual({ byRule: 0, byPfc: 2 });

    const coffee = await getTransaction(a, db, { transactionId: ids.coffee ?? '' });
    expect(coffee).toMatchObject({
      categoryId: (await categoryByKey(a, 'coffee')).id,
      categorySource: 'pfc',
    });
    expect(
      (await getTransaction(a, db, { transactionId: ids.paycheck ?? '' })).categorySource,
    ).toBe('pfc');

    // Running again finds nothing new to do.
    const again = await loadCategorizationInput(system, db);
    expect(again.candidates).toHaveLength(5);
    const rerun = categorizeDeterministic(again.candidates, again);
    expect(await applyCategoryAssignments(system, db, rerun.assigned)).toEqual({
      byRule: 0,
      byPfc: 0,
    });
  });

  it('offers a rule after a person picks a category', async () => {
    const groceries = await categoryByKey(a, 'groceries');
    const edited = await updateTransaction(a, db, {
      transactionId: ids['tj-1'] ?? '',
      categoryId: groceries.id,
    });
    expect(edited).toMatchObject({ categorySource: 'user', needsReview: false });

    expect(await findRuleSuggestion(a, db, { transactionId: ids['tj-1'] ?? '' })).toMatchObject({
      matcherType: 'merchant_exact',
      categoryId: groceries.id,
      merchantLabel: "Trader Joe's",
      matchingCount: 2,
    });
    expect(await findRuleSuggestion(a, db, { transactionId: ids.coffee ?? '' })).toBeNull();
  });

  it("stores the model's answers without overriding a person or guessing below the bar", async () => {
    const restaurants = await categoryByKey(a, 'restaurants');
    const groceries = await categoryByKey(a, 'groceries');
    const repairs = await categoryByKey(a, 'home_maintenance');
    const counts = await applyModelOutcomes(system, db, [
      {
        transactionId: ids['tj-1'] ?? '',
        kind: 'assigned',
        categoryId: restaurants.id,
        confidencePercent: 95,
      },
      {
        transactionId: ids.hardware ?? '',
        kind: 'assigned',
        categoryId: repairs.id,
        confidencePercent: 91,
      },
      {
        transactionId: ids.mystery ?? '',
        kind: 'flagged',
        suggestedCategoryId: groceries.id,
        confidencePercent: 55,
      },
      {
        transactionId: ids['tj-3'] ?? '',
        kind: 'flagged',
        suggestedCategoryId: null,
        confidencePercent: null,
      },
    ]);
    expect(counts).toEqual({ byLlm: 1, flagged: 2 });

    expect(await getTransaction(a, db, { transactionId: ids['tj-1'] ?? '' })).toMatchObject({
      categoryId: groceries.id,
      categorySource: 'user',
    });
    expect(await getTransaction(a, db, { transactionId: ids.hardware ?? '' })).toMatchObject({
      categoryId: repairs.id,
      categorySource: 'llm',
      categoryConfidence: 91,
    });
    expect(await getTransaction(a, db, { transactionId: ids.mystery ?? '' })).toMatchObject({
      categoryId: null,
      categorySource: null,
      suggestedCategoryId: groceries.id,
      categoryConfidence: 55,
      needsReview: true,
    });
    expect(
      await applyCategoryAssignments(system, db, [
        { transactionId: ids['tj-1'] ?? '', categoryId: restaurants.id, source: 'pfc' },
      ]),
    ).toEqual({ byRule: 0, byPfc: 0 });

    expect(await countReviewQueue(a, db)).toBe(3);
    const queue = await listTransactions(a, db, { review: true, limit: 10 });
    expect(queue.transactions.map((row) => row.id).sort()).toEqual(
      [ids['tj-2'], ids['tj-3'], ids.mystery].sort(),
    );
    // Flagged rows aren't sent to the model a second time.
    expect((await loadCategorizationInput(system, db)).candidates.map((row) => row.id)).toEqual([
      ids['tj-2'],
    ]);
  });

  it('applies a new rule to past uncategorized transactions, flagged ones included', async () => {
    const groceries = await categoryByKey(a, 'groceries');
    const { rule, applied } = await createCategoryRule(a, db, {
      matcherType: 'merchant_exact',
      matcherValue: "  Trader Joe's ",
      categoryId: groceries.id,
    });
    expect(applied).toBe(2);
    expect(rule).toMatchObject({
      categoryName: 'Groceries',
      hitCount: 2,
      createdByUserId: users.ownerA,
    });

    for (const key of ['tj-2', 'tj-3']) {
      expect(await getTransaction(a, db, { transactionId: ids[key] ?? '' })).toMatchObject({
        categoryId: groceries.id,
        categorySource: 'rule',
        categoryRuleId: rule.id,
        needsReview: false,
      });
    }
    expect((await getTransaction(a, db, { transactionId: ids['tj-1'] ?? '' })).categorySource).toBe(
      'user',
    );
    expect(await findRuleSuggestion(a, db, { transactionId: ids['tj-1'] ?? '' })).toBeNull();
    expect(await countReviewQueue(a, db)).toBe(1);

    const saved = await createCategoryRule(a, db, {
      matcherType: 'merchant_exact',
      matcherValue: "TRADER JOE'S",
      categoryId: groceries.id,
    });
    expect(saved.rule.id).toBe(rule.id);
    expect(saved.applied).toBe(0);
    expect(await listCategoryRules(a, db)).toHaveLength(1);
    expect(await listCategoryRules(b, db)).toEqual([]);
    await expect(deleteCategoryRule(b, db, { ruleId: rule.id })).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('deletes one rule and leaves the rest', async () => {
    const temporary = await createCategoryRule(a, db, {
      matcherType: 'name_regex',
      matcherValue: '^ACE',
      categoryId: (await categoryByKey(a, 'home_maintenance')).id,
    });
    expect(temporary.applied).toBe(0);
    await deleteCategoryRule(a, db, { ruleId: temporary.rule.id });
    expect(await listCategoryRules(a, db)).toHaveLength(1);
  });
});

describe('insights', () => {
  it('sums spending by month and category, leaving income out of uncategorized', async () => {
    const rows = await listMonthlyCategorySpend(a, db, { from: '2026-08-01', to: '2026-10-01' });
    const groceries = await categoryByKey(a, 'groceries');
    const find = (month: string, categoryId: string | null) =>
      rows.find((row) => row.month === month && row.categoryId === categoryId)?.spentCents;
    expect(find('2026-08-01', groceries.id)).toBe(7530);
    expect(find('2026-09-01', groceries.id)).toBe(2000);
    expect(find('2026-08-01', null)).toBe(12_000);
    expect(find('2026-08-01', (await categoryByKey(a, 'paychecks')).id)).toBe(-500_000);
    expect(await listMonthlyCategorySpend(b, db, { from: '2026-08-01', to: '2026-10-01' })).toEqual(
      [],
    );
  });

  it('ranks merchants by money out', async () => {
    const merchants = await listTopMerchants(a, db, {
      from: '2026-08-01',
      to: '2026-09-01',
      limit: 3,
    });
    expect(merchants).toEqual([
      { merchant: 'POS 88213', spentCents: 12_000, transactionCount: 1 },
      { merchant: "Trader Joe's", spentCents: 7530, transactionCount: 2 },
      { merchant: 'Ace Hardware', spentCents: 3000, transactionCount: 1 },
    ]);
  });
});

describe('budgets', () => {
  it('shows spending for a month nobody has planned', async () => {
    const period = await getBudgetPeriod(a, db, { periodStart: '2026-08-01', today });
    expect(period).toMatchObject({ budget: null, lines: [], previousHasLines: false });
    expect(period.summary.uncategorizedCents).toBe(12_000);
  });

  it('plans expense categories only, from the household', async () => {
    const groceries = await categoryByKey(a, 'groceries');
    const coffee = await categoryByKey(a, 'coffee');
    await setBudgetLine(a, db, {
      periodStart: '2026-08-01',
      categoryId: groceries.id,
      plannedCents: 10_000,
      rolloverEnabled: true,
    });
    await setBudgetLine(a, db, {
      periodStart: '2026-08-01',
      categoryId: coffee.id,
      plannedCents: 1000,
      rolloverEnabled: false,
    });

    const line = { periodStart: '2026-08-01', plannedCents: 100, rolloverEnabled: false };
    await expect(
      setBudgetLine(a, db, { ...line, categoryId: (await categoryByKey(a, 'paychecks')).id }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      setBudgetLine(b, db, { ...line, categoryId: groceries.id }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      setBudgetLine(a, db, { ...line, periodStart: '2026-08-02', categoryId: groceries.id }),
    ).rejects.toBeInstanceOf(ValidationError);

    const period = await getBudgetPeriod(a, db, { periodStart: '2026-08-01', today });
    const actual = (categoryId: string) =>
      period.summary.lines.find((row) => row.categoryId === categoryId)?.actualCents;
    expect(actual(groceries.id)).toBe(7530);
    expect(actual(coffee.id)).toBe(650);
    expect(period.summary.unbudgetedCents).toBe(3000);
    expect((await getBudgetPeriod(b, db, { periodStart: '2026-08-01', today })).budget).toBeNull();
  });

  it('copies last month, then closes it and carries rollovers forward', async () => {
    const groceries = await categoryByKey(a, 'groceries');
    const coffee = await categoryByKey(a, 'coffee');
    expect(await copyPreviousBudget(a, db, { periodStart: '2026-09-01' })).toEqual({ copied: 2 });
    expect(await copyPreviousBudget(a, db, { periodStart: '2026-09-01' })).toEqual({ copied: 0 });
    await expect(copyPreviousBudget(a, db, { periodStart: '2026-08-01' })).rejects.toBeInstanceOf(
      NotFoundError,
    );

    await expect(
      closeBudgetPeriod(a, db, { periodStart: '2026-09-01', today, now }),
    ).rejects.toBeInstanceOf(ConflictError);

    const before = await getBudgetPeriod(a, db, { periodStart: '2026-08-01', today });
    const closed = await closeBudgetPeriod(a, db, { periodStart: '2026-08-01', today, now });
    expect(closed.budget).toMatchObject({
      unbudgetedCents: before.summary.unbudgetedCents,
      uncategorizedCents: 12_000,
    });
    expect(closed.budget?.closedAt).not.toBeNull();
    expect(closed.lines.find((row) => row.categoryId === groceries.id)?.actualCents).toBe(7530);

    const september = await getBudgetPeriod(a, db, { periodStart: '2026-09-01', today });
    const rolloverIn = (categoryId: string) =>
      september.lines.find((row) => row.categoryId === categoryId)?.rolloverInCents;
    expect(rolloverIn(groceries.id)).toBe(2470);
    expect(rolloverIn(coffee.id)).toBe(0);
    expect(september.previousHasLines).toBe(true);

    await expect(
      closeBudgetPeriod(a, db, { periodStart: '2026-08-01', today, now }),
    ).rejects.toBeInstanceOf(ConflictError);
    await expect(
      setBudgetLine(a, db, {
        periodStart: '2026-08-01',
        categoryId: groceries.id,
        plannedCents: 1,
        rolloverEnabled: true,
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('keeps a closed month as it was when bank data changes later', async () => {
    await updateTransaction(a, db, { transactionId: ids.mystery ?? '', isExcluded: true });
    const august = await getBudgetPeriod(a, db, { periodStart: '2026-08-01', today });
    expect(august.summary.uncategorizedCents).toBe(12_000);
    expect(august.summary.elapsedShare).toBe(1);
  });

  it('gives a line planned after the close the rollover it is owed', async () => {
    const groceries = await categoryByKey(a, 'groceries');
    const september = await getBudgetPeriod(a, db, { periodStart: '2026-09-01', today });
    const line = september.lines.find((row) => row.categoryId === groceries.id);
    await deleteBudgetLine(a, db, { lineId: line?.id ?? '' });
    await expect(deleteBudgetLine(b, db, { lineId: line?.id ?? '' })).rejects.toBeInstanceOf(
      NotFoundError,
    );

    const replanned = await setBudgetLine(a, db, {
      periodStart: '2026-09-01',
      categoryId: groceries.id,
      plannedCents: 12_000,
      rolloverEnabled: true,
    });
    expect(replanned).toMatchObject({ plannedCents: 12_000, rolloverInCents: 2470 });
    const updated = await setBudgetLine(a, db, {
      periodStart: '2026-09-01',
      categoryId: groceries.id,
      plannedCents: 11_000,
      rolloverEnabled: false,
    });
    expect(updated).toMatchObject({
      id: replanned.id,
      plannedCents: 11_000,
      rolloverInCents: 2470,
    });
  });
});

describe('goals', () => {
  it('links a goal to one of the household accounts', async () => {
    const [checking] = await listAccounts(a, db);
    const goal = await createGoal(a, db, {
      name: ' Emergency fund ',
      targetCents: 1_000_000,
      targetDate: '2027-06-30',
      notes: '  ',
      linkedAccountId: checking?.id ?? null,
    });
    expect(goal).toMatchObject({
      name: 'Emergency fund',
      notes: null,
      linkedAccount: { id: checking?.id, type: 'depository', currentBalanceCents: 250_000 },
    });

    await expect(
      createGoal(b, db, {
        name: 'Not yours',
        targetCents: 100,
        targetDate: null,
        notes: null,
        linkedAccountId: checking?.id ?? null,
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(await listGoals(b, db)).toEqual([]);
    await expect(deleteGoal(b, db, { goalId: goal.id })).rejects.toBeInstanceOf(NotFoundError);
    expect(await listGoals(a, db)).toHaveLength(1);
  });
});

describe('access', () => {
  it('keeps finances from members in the data access layer', async () => {
    const member: RequestContext = {
      userId: users.memberA,
      householdId: a.householdId,
      role: 'member',
    };
    await expect(listCategories(member, db)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listGoals(member, db)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      getBudgetPeriod(member, db, { periodStart: '2026-08-01', today }),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });

  it('shows the authenticated role only its own household, and members nothing', async () => {
    for (const table of ['categories', 'category_rules', 'budgets', 'budget_lines', 'goals']) {
      const mine = await queryAs<{ household_id?: string }>(
        client,
        users.ownerA,
        `select 1 from ${table}`,
      );
      expect(mine.length, table).toBeGreaterThan(0);
      expect(await queryAs(client, users.memberA, `select 1 from ${table}`), table).toEqual([]);
      expect(await queryAs(client, null, `select 1 from ${table}`), table).toEqual([]);
    }
    const theirs = await queryAs<{ household_id: string }>(
      client,
      users.ownerB,
      'select household_id from categories',
    );
    expect(theirs.every((row) => row.household_id === b.householdId)).toBe(true);
    expect(await queryAs(client, users.ownerB, 'select 1 from budget_lines')).toEqual([]);
  });

  it('lets no API role write', async () => {
    await expect(
      queryAs(
        client,
        users.ownerA,
        `insert into categories (household_id, name, kind, icon) values ('${a.householdId}', 'Sneaky', 'expense', 'gift')`,
      ),
    ).rejects.toThrow(/row-level security/);
    expect(
      await queryAs(
        client,
        users.ownerA,
        `update categories set name = 'Renamed' where household_id = '${a.householdId}' returning 1`,
      ),
    ).toEqual([]);
    const [row] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.householdId, a.householdId), eq(categories.name, 'Renamed')));
    expect(row).toBeUndefined();
  });
});
