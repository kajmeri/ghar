import { beforeEach, describe, expect, it } from 'vitest';
import {
  foldTransactionChanges,
  planTransactionSync,
  transactionIdsToLoad,
  type BankTransaction,
  type StoredTransaction,
  type TransactionChanges,
  type TransactionSyncPlan,
  type TransactionUserFields,
} from '../src/banking';

/** A stored row: what the reconciler reads, plus the bank fields the database would hold. */
type Row = StoredTransaction & { transaction: BankTransaction };

let rowCount = 0;

beforeEach(() => {
  rowCount = 0;
});

function tx(id: string, overrides: Partial<BankTransaction> = {}): BankTransaction {
  return {
    plaidTransactionId: id,
    plaidAccountId: 'account-checking',
    pendingTransactionId: null,
    amountCents: -1250,
    isoCurrency: 'USD',
    date: '2026-09-01',
    authorizedDate: null,
    merchantName: 'Corner Market',
    name: 'CORNER MARKET #12',
    paymentChannel: 'in store',
    categoryPrimary: 'FOOD_AND_DRINK',
    categoryDetailed: 'FOOD_AND_DRINK_GROCERIES',
    categoryConfidence: null,
    isPending: false,
    ...overrides,
  };
}

function pending(id: string, overrides: Partial<BankTransaction> = {}): BankTransaction {
  return tx(id, { isPending: true, ...overrides });
}

function row(transaction: BankTransaction, userFields: Partial<TransactionUserFields> = {}): Row {
  rowCount += 1;
  return {
    id: `row-${rowCount}`,
    plaidTransactionId: transaction.plaidTransactionId,
    isPending: transaction.isPending,
    categoryId: null,
    categorySource: null,
    categoryConfidence: null,
    categoryRuleId: null,
    suggestedCategoryId: null,
    needsReview: false,
    notes: null,
    isExcluded: false,
    transaction,
    ...userFields,
  };
}

function page(changes: Partial<TransactionChanges>): TransactionChanges {
  return { added: [], modified: [], removed: [], ...changes };
}

/**
 * Applies a plan in the order the database does and checks what the database would: every row
 * touched exists, and plaid_transaction_id stays unique after each step.
 */
function apply(rows: readonly Row[], plan: TransactionSyncPlan): Row[] {
  const byId = new Map(rows.map((stored) => [stored.id, stored]));
  const assertFree = (plaidId: string, exceptRowId?: string) => {
    for (const stored of byId.values()) {
      if (stored.plaidTransactionId === plaidId && stored.id !== exceptRowId) {
        throw new Error(`plaid_transaction_id ${plaidId} is already on ${stored.id}`);
      }
    }
  };

  for (const id of plan.deletes) {
    if (!byId.delete(id)) throw new Error(`Deleted a row that does not exist: ${id}`);
  }
  for (const update of plan.updates) {
    const target = byId.get(update.id);
    if (!target) throw new Error(`Updated a row that does not exist: ${update.id}`);
    assertFree(update.transaction.plaidTransactionId, update.id);
    byId.set(update.id, {
      ...target,
      ...update.userFields,
      plaidTransactionId: update.transaction.plaidTransactionId,
      isPending: update.transaction.isPending,
      transaction: update.transaction,
    });
  }
  for (const transaction of plan.inserts) {
    assertFree(transaction.plaidTransactionId);
    const inserted = row(transaction);
    byId.set(inserted.id, inserted);
  }
  return [...byId.values()];
}

/** Plans against only the rows the database would load for these pages, then applies. */
function sync(rows: readonly Row[], pages: readonly TransactionChanges[]) {
  const load = new Set(transactionIdsToLoad(pages));
  const plan = planTransactionSync(
    rows.filter((stored) => load.has(stored.plaidTransactionId)),
    pages,
  );
  return { plan, rows: apply(rows, plan) };
}

function byPlaidId(rows: readonly Row[], plaidId: string): Row | undefined {
  return rows.find((stored) => stored.plaidTransactionId === plaidId);
}

describe('added', () => {
  it('inserts transactions that are not stored', () => {
    const { plan, rows } = sync(
      [],
      [page({ added: [tx('t1'), tx('t2', { amountCents: 420000 })] })],
    );

    expect(plan).toEqual({
      deletes: [],
      updates: [],
      inserts: [tx('t1'), tx('t2', { amountCents: 420000 })],
    });
    expect(rows.map((stored) => stored.plaidTransactionId)).toEqual(['t1', 't2']);
    expect(byPlaidId(rows, 't2')?.transaction.amountCents).toBe(420000);
  });

  it('updates rather than duplicates a transaction that is already stored', () => {
    const stored = row(tx('t1'), { notes: 'Split with Sam' });
    const { plan, rows } = sync([stored], [page({ added: [tx('t1', { name: 'CORNER MKT' })] })]);

    expect(plan.inserts).toEqual([]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: stored.id, notes: 'Split with Sam' });
    expect(rows[0]?.transaction.name).toBe('CORNER MKT');
  });

  it('keeps pending transactions as pending', () => {
    const { rows } = sync([], [page({ added: [pending('p1')] })]);
    expect(byPlaidId(rows, 'p1')?.isPending).toBe(true);
  });
});

describe('modified', () => {
  it('overwrites bank fields and keeps the category, notes and exclusion', () => {
    const stored = row(tx('t1'), {
      categoryId: 'cat-groceries',
      notes: 'Party food',
      isExcluded: true,
    });
    const changed = tx('t1', {
      amountCents: -1999,
      merchantName: 'Corner Market Co',
      date: '2026-09-02',
    });
    const { plan, rows } = sync([stored], [page({ modified: [changed] })]);

    expect(plan).toEqual({
      deletes: [],
      updates: [{ id: stored.id, transaction: changed }],
      inserts: [],
    });
    expect(rows).toEqual([
      {
        ...stored,
        transaction: changed,
      },
    ]);
  });

  it('inserts a modified transaction that was never stored', () => {
    const { plan } = sync([], [page({ modified: [tx('t1')] })]);
    expect(plan.inserts).toEqual([tx('t1')]);
  });

  it('uses the last version when a transaction changes on more than one page', () => {
    const { rows } = sync(
      [],
      [
        page({ added: [tx('t1', { amountCents: -100 })] }),
        page({ modified: [tx('t1', { amountCents: -200 })] }),
        page({ modified: [tx('t1', { amountCents: -300 })] }),
      ],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.transaction.amountCents).toBe(-300);
  });
});

describe('removed', () => {
  it('deletes the stored row', () => {
    const keep = row(tx('t1'));
    const gone = row(tx('t2'));
    const { plan, rows } = sync([keep, gone], [page({ removed: ['t2'] })]);

    expect(plan).toEqual({ deletes: [gone.id], updates: [], inserts: [] });
    expect(rows).toEqual([keep]);
  });

  it('ignores IDs that were never stored', () => {
    const { plan } = sync([row(tx('t1'))], [page({ removed: ['never-seen'] })]);
    expect(plan).toEqual({ deletes: [], updates: [], inserts: [] });
  });

  it('stores nothing for a transaction added and then removed in the same batch', () => {
    const { plan } = sync([], [page({ added: [pending('p1')] }), page({ removed: ['p1'] })]);
    expect(plan).toEqual({ deletes: [], updates: [], inserts: [] });
  });

  it('stores a transaction removed and then added back in the same batch', () => {
    const stored = row(tx('t1'));
    const { rows } = sync(
      [stored],
      [page({ removed: ['t1'] }), page({ added: [tx('t1', { amountCents: -5 })] })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: stored.id });
    expect(rows[0]?.transaction.amountCents).toBe(-5);
  });

  it('applies a removal after an add on the same page', () => {
    const { rows } = sync([], [page({ added: [tx('t1')], removed: ['t1'] })]);
    expect(rows).toEqual([]);
  });
});

describe('pending to posted', () => {
  it('moves the pending row onto the posted ID and keeps its edits', () => {
    const pendingRow = row(pending('p1', { amountCents: -1200 }), {
      categoryId: 'cat-dining',
      categorySource: 'user',
      notes: 'Dinner with the Parks',
      isExcluded: true,
    });
    const posted = tx('t1', { pendingTransactionId: 'p1', amountCents: -1450 });

    const { plan, rows } = sync([pendingRow], [page({ added: [posted], removed: ['p1'] })]);

    expect(plan).toEqual({
      deletes: [],
      updates: [{ id: pendingRow.id, transaction: posted }],
      inserts: [],
    });
    expect(rows).toEqual([
      {
        id: pendingRow.id,
        plaidTransactionId: 't1',
        isPending: false,
        categoryId: 'cat-dining',
        categorySource: 'user',
        categoryConfidence: null,
        categoryRuleId: null,
        suggestedCategoryId: null,
        needsReview: false,
        notes: 'Dinner with the Parks',
        isExcluded: true,
        transaction: posted,
      },
    ]);
  });

  it('keeps an automatic category and its review state through the handoff', () => {
    const pendingRow = row(pending('p1'), {
      categoryId: null,
      categorySource: null,
      categoryConfidence: 62,
      suggestedCategoryId: 'cat-coffee',
      needsReview: true,
    });
    const posted = tx('t1', { pendingTransactionId: 'p1' });

    const { rows } = sync([pendingRow], [page({ added: [posted], removed: ['p1'] })]);

    expect(rows).toEqual([
      { ...pendingRow, plaidTransactionId: 't1', isPending: false, transaction: posted },
    ]);
  });

  it('hands off when the pending removal arrives on a later page', () => {
    const pendingRow = row(pending('p1'), { notes: 'Gas' });
    const posted = tx('t1', { pendingTransactionId: 'p1' });

    const { rows } = sync([pendingRow], [page({ added: [posted] }), page({ removed: ['p1'] })]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: pendingRow.id, plaidTransactionId: 't1', notes: 'Gas' });
  });

  it('hands off when the pending removal comes in a later sync', () => {
    const pendingRow = row(pending('p1'), { notes: 'Gas' });
    const first = sync([pendingRow], [page({ added: [tx('t1', { pendingTransactionId: 'p1' })] })]);
    const second = sync(first.rows, [page({ removed: ['p1'] })]);

    expect(second.plan).toEqual({ deletes: [], updates: [], inserts: [] });
    expect(second.rows).toEqual(first.rows);
  });

  it('stores only the posted transaction when both arrive in one batch', () => {
    const posted = tx('t1', { pendingTransactionId: 'p1' });
    const { plan, rows } = sync(
      [],
      [page({ added: [pending('p1')] }), page({ added: [posted], removed: ['p1'] })],
    );

    expect(plan).toEqual({ deletes: [], updates: [], inserts: [posted] });
    expect(rows.map((stored) => stored.plaidTransactionId)).toEqual(['t1']);
  });

  it('stores only the posted transaction even if Plaid never removes the pending one', () => {
    const posted = tx('t1', { pendingTransactionId: 'p1' });
    const { plan } = sync([], [page({ added: [pending('p1'), posted] })]);
    expect(plan.inserts).toEqual([posted]);
  });

  it('lets the posted version win when the pending one also changed in the batch', () => {
    const pendingRow = row(pending('p1'), { categoryId: 'cat-travel' });
    const posted = tx('t1', { pendingTransactionId: 'p1', amountCents: -8000 });

    const { plan, rows } = sync(
      [pendingRow],
      [
        page({ modified: [pending('p1', { amountCents: -7000 })] }),
        page({ added: [posted], removed: ['p1'] }),
      ],
    );

    expect(plan.updates).toEqual([{ id: pendingRow.id, transaction: posted }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: pendingRow.id,
      plaidTransactionId: 't1',
      categoryId: 'cat-travel',
    });
    expect(rows[0]?.transaction.amountCents).toBe(-8000);
  });

  it('merges into a posted row that is already stored, keeping its own edits first', () => {
    const pendingRow = row(pending('p1'), {
      categoryId: 'cat-dining',
      categorySource: 'user',
      notes: 'Birthday',
      isExcluded: true,
    });
    const postedRow = row(tx('t1'), { categoryId: 'cat-shopping', categorySource: 'user' });
    const posted = tx('t1', { pendingTransactionId: 'p1', amountCents: -3100 });

    const { plan, rows } = sync(
      [pendingRow, postedRow],
      [page({ modified: [posted], removed: ['p1'] })],
    );

    const merged: TransactionUserFields = {
      categoryId: 'cat-shopping',
      categorySource: 'user',
      categoryConfidence: null,
      categoryRuleId: null,
      suggestedCategoryId: null,
      needsReview: false,
      notes: 'Birthday',
      isExcluded: true,
    };
    expect(plan).toEqual({
      deletes: [pendingRow.id],
      updates: [
        {
          id: postedRow.id,
          transaction: posted,
          userFields: merged,
          mergedFromId: pendingRow.id,
        },
      ],
      inserts: [],
    });
    expect(rows).toEqual([
      {
        id: postedRow.id,
        plaidTransactionId: 't1',
        isPending: false,
        ...merged,
        transaction: posted,
      },
    ]);
  });

  describe('merging categorization into a stored posted row', () => {
    function merge(pendingFields: Partial<Row>, postedFields: Partial<Row>) {
      const pendingRow = row(pending('p1'), pendingFields);
      const postedRow = row(tx('t1'), postedFields);
      const posted = tx('t1', { pendingTransactionId: 'p1' });
      const { rows } = sync(
        [pendingRow, postedRow],
        [page({ modified: [posted], removed: ['p1'] })],
      );
      expect(rows).toHaveLength(1);
      return rows[0];
    }

    it("takes a person's category from the pending row over a rule's on the posted row", () => {
      const result = merge(
        { categoryId: 'cat-dining', categorySource: 'user' },
        { categoryId: 'cat-shopping', categorySource: 'rule', categoryRuleId: 'rule-1' },
      );
      expect(result).toMatchObject({
        categoryId: 'cat-dining',
        categorySource: 'user',
        categoryRuleId: null,
      });
    });

    it('keeps the posted row’s automatic category over a pending row waiting for review', () => {
      const result = merge(
        { needsReview: true, suggestedCategoryId: 'cat-coffee', categoryConfidence: 55 },
        { categoryId: 'cat-groceries', categorySource: 'pfc' },
      );
      expect(result).toMatchObject({
        categoryId: 'cat-groceries',
        categorySource: 'pfc',
        categoryConfidence: null,
        suggestedCategoryId: null,
        needsReview: false,
      });
    });

    it('moves a review flag onto a posted row that has no category yet', () => {
      const result = merge(
        { needsReview: true, suggestedCategoryId: 'cat-coffee', categoryConfidence: 55 },
        {},
      );
      expect(result).toMatchObject({
        categoryId: null,
        categorySource: null,
        categoryConfidence: 55,
        suggestedCategoryId: 'cat-coffee',
        needsReview: true,
      });
    });

    it('never mixes the two rows’ categorization fields', () => {
      const result = merge(
        { categoryId: 'cat-travel', categorySource: 'llm', categoryConfidence: 93 },
        { categoryId: 'cat-shopping', categorySource: 'rule', categoryRuleId: 'rule-2' },
      );
      expect(result).toMatchObject({
        categoryId: 'cat-shopping',
        categorySource: 'rule',
        categoryConfidence: null,
        categoryRuleId: 'rule-2',
      });
    });
  });

  it('never replaces a transaction that has already posted', () => {
    const postedRow = row(tx('t0'), { notes: 'Keep me' });
    const { rows } = sync(
      [postedRow],
      [page({ added: [tx('t1', { pendingTransactionId: 't0' })] })],
    );

    expect(rows).toHaveLength(2);
    expect(byPlaidId(rows, 't0')).toMatchObject({ id: postedRow.id, notes: 'Keep me' });
  });

  it('does not replace a pending row the batch reports as posted under its own ID', () => {
    const pendingRow = row(pending('p1'));
    const { rows } = sync(
      [pendingRow],
      [page({ modified: [tx('p1')], added: [tx('t1', { pendingTransactionId: 'p1' })] })],
    );

    expect(rows).toHaveLength(2);
    expect(byPlaidId(rows, 'p1')).toMatchObject({ id: pendingRow.id, isPending: false });
  });

  it('gives a pending row to only one posted transaction', () => {
    const pendingRow = row(pending('p1'), { notes: 'Once' });
    const first = tx('t1', { pendingTransactionId: 'p1' });
    const second = tx('t2', { pendingTransactionId: 'p1' });

    const { plan, rows } = sync([pendingRow], [page({ added: [first, second], removed: ['p1'] })]);

    expect(plan.updates).toEqual([{ id: pendingRow.id, transaction: first }]);
    expect(plan.inserts).toEqual([second]);
    expect(byPlaidId(rows, 't1')).toMatchObject({ id: pendingRow.id, notes: 'Once' });
    expect(byPlaidId(rows, 't2')).toMatchObject({ notes: null });
  });

  it('ignores a pending transaction that points at another pending one', () => {
    const pendingRow = row(pending('p1'));
    const { rows } = sync(
      [pendingRow],
      [page({ added: [pending('p2', { pendingTransactionId: 'p1' })] })],
    );
    expect(rows.map((stored) => stored.plaidTransactionId).sort()).toEqual(['p1', 'p2']);
  });

  it('posts a pending row under the same ID without losing edits', () => {
    const pendingRow = row(pending('p1'), { categoryId: 'cat-health' });
    const { rows } = sync([pendingRow], [page({ modified: [tx('p1')] })]);
    expect(rows).toEqual([{ ...pendingRow, isPending: false, transaction: tx('p1') }]);
  });

  it('inserts a posted transaction whose pending one was never stored', () => {
    const posted = tx('t1', { pendingTransactionId: 'p-unknown' });
    const { plan } = sync([], [page({ added: [posted], removed: ['p-unknown'] })]);
    expect(plan).toEqual({ deletes: [], updates: [], inserts: [posted] });
  });
});

describe('replaying a batch', () => {
  const scenarios: [string, () => { rows: Row[]; pages: TransactionChanges[] }][] = [
    [
      'adds, modifies and removes',
      () => ({
        rows: [row(tx('t1'), { notes: 'Old' }), row(tx('t2'))],
        pages: [
          page({ added: [tx('t3')], modified: [tx('t1', { amountCents: -1 })], removed: ['t2'] }),
        ],
      }),
    ],
    [
      'a pending handoff',
      () => ({
        rows: [row(pending('p1'), { categoryId: 'cat-dining' })],
        pages: [page({ added: [tx('t1', { pendingTransactionId: 'p1' })], removed: ['p1'] })],
      }),
    ],
    [
      'a merge into a stored posted row',
      () => ({
        rows: [row(pending('p1'), { notes: 'Pending note' }), row(tx('t1'))],
        pages: [page({ modified: [tx('t1', { pendingTransactionId: 'p1' })], removed: ['p1'] })],
      }),
    ],
  ];

  it.each(scenarios)('changes nothing the second time: %s', (_name, scenario) => {
    const { rows, pages } = scenario();
    const once = sync(rows, pages);
    const twice = sync(once.rows, pages);

    expect(twice.plan.deletes).toEqual([]);
    expect(twice.plan.inserts).toEqual([]);
    expect(twice.plan.updates.every((update) => update.userFields === undefined)).toBe(true);
    expect(twice.rows).toEqual(once.rows);
  });
});

describe('foldTransactionChanges', () => {
  it('keeps the last event for each ID across pages', () => {
    expect(
      foldTransactionChanges([
        page({ added: [tx('a'), tx('b')], removed: ['c'] }),
        page({ removed: ['a'], added: [tx('c')] }),
      ]),
    ).toEqual({ upserts: [tx('b'), tx('c')], removed: ['a'] });
  });

  it('orders by each ID’s last event, so the latest posted transaction claims a pending one last', () => {
    expect(
      foldTransactionChanges([
        page({ added: [tx('a'), tx('b')] }),
        page({ modified: [tx('a', { amountCents: -1 })] }),
      ]).upserts.map((transaction) => transaction.plaidTransactionId),
    ).toEqual(['b', 'a']);
  });
});

describe('transactionIdsToLoad', () => {
  it('includes changed, removed and replaced pending IDs once each', () => {
    expect(
      transactionIdsToLoad([
        page({ added: [tx('t1', { pendingTransactionId: 'p1' })], removed: ['p1'] }),
        page({ modified: [tx('t2')], removed: ['t3'] }),
      ]),
    ).toEqual(['t1', 'p1', 't2', 't3']);
  });
});
