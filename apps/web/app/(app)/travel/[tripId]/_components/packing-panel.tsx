'use client';

import {
  applyPackingTemplate,
  createPackingItem,
  createPackingTemplate,
  deletePackingItem,
  listPackingTemplates,
  updatePackingItem,
  type PackingItem,
  type PackingTemplate,
} from '@casa/contracts';
import { byAssignee, byCategory, packingProgress } from '@casa/core/packing';
import { useEffect, useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input, Select } from '@/components/ui/field';
import { FormError } from '@/components/ui/form-error';
import { Meter } from '@/components/ui/meter';
import { useMutation } from '@/hooks/use-mutation';
import { api, errorMessage } from '@/lib/api/client';
import { formText } from '@/lib/form';

/**
 * One shared list. Group it by person to see what you are carrying, or by category to see
 * what is still in the cupboard. Both views are the same rows, sorted by @casa/core.
 */
export function PackingPanel({
  tripId,
  items,
  memberUserIds,
  currentUserId,
}: {
  tripId: string;
  items: PackingItem[];
  memberUserIds: string[];
  currentUserId: string;
}) {
  const [grouping, setGrouping] = useState<'person' | 'category'>('person');
  const progress = packingProgress(items);
  const groups = grouping === 'person' ? byAssignee(items) : byCategory(items);

  const toggle = useMutation((input: { itemId: string; isPacked: boolean }) =>
    api.request(updatePackingItem, {
      params: { tripId, itemId: input.itemId },
      body: { isPacked: input.isPacked },
    }),
  );
  const assign = useMutation((input: { itemId: string; assignedUserId: string | null }) =>
    api.request(updatePackingItem, {
      params: { tripId, itemId: input.itemId },
      body: { assignedUserId: input.assignedUserId },
    }),
  );
  const remove = useMutation((itemId: string) =>
    api.request(deletePackingItem, { params: { tripId, itemId } }),
  );

  return (
    <div className="flex flex-col gap-5">
      <Card className="flex flex-col gap-3 p-4 md:p-5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="amount text-2xl">
            {progress.packed}
            <span className="text-base font-regular text-ink-muted"> of {progress.total}</span>
          </p>
          <p className="text-sm text-ink-muted">
            {progress.total === 0
              ? 'Nothing on the list'
              : progress.remaining === 0
                ? 'Everything is packed'
                : `${progress.remaining} still to pack`}
          </p>
        </div>
        <Meter
          ratio={progress.ratio}
          tone={progress.total > 0 && progress.remaining === 0 ? 'positive' : 'neutral'}
          label="Packing progress"
        />
      </Card>

      <AddItemForm tripId={tripId} memberUserIds={memberUserIds} currentUserId={currentUserId} />
      <TemplateBar tripId={tripId} hasItems={items.length > 0} />

      <FormError>{toggle.error ?? assign.error ?? remove.error}</FormError>

      {items.length === 0 ? (
        <EmptyState title="The list is empty">
          Add what you need, or start from a template you saved on an earlier trip.
        </EmptyState>
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-ink-muted">Group by</span>
            {(['person', 'category'] as const).map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={grouping === value}
                onClick={() => {
                  setGrouping(value);
                }}
                className={
                  grouping === value
                    ? 'rounded-pill border border-ink px-3 py-1'
                    : 'rounded-pill border border-line px-3 py-1 text-ink-muted'
                }
              >
                {value === 'person' ? 'Person' : 'Category'}
              </button>
            ))}
          </div>

          <ul className="flex flex-col gap-5">
            {groups.map((group) => (
              <li key={group.key ?? 'none'} className="flex flex-col gap-2">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="text-sm font-medium">
                    {grouping === 'person'
                      ? group.key === null
                        ? 'Nobody yet'
                        : personLabel(group.key, currentUserId)
                      : (group.key ?? 'Uncategorised')}
                  </h3>
                  <p className="text-xs text-ink-muted">
                    {group.progress.packed} of {group.progress.total}
                  </p>
                </div>

                <ul className="flex flex-col rounded-card border border-line bg-surface">
                  {group.items.map((item, index) => (
                    <li key={item.id} className={index === 0 ? '' : 'border-t border-line'}>
                      <div className="flex items-center gap-3 px-3 py-2">
                        <label className="flex min-h-tap flex-1 items-center gap-3">
                          <input
                            type="checkbox"
                            checked={item.isPacked}
                            disabled={toggle.pending}
                            onChange={(event) => {
                              toggle.mutate({
                                itemId: item.id,
                                isPacked: event.target.checked,
                              });
                            }}
                            className="size-5 shrink-0 accent-ink"
                          />
                          <span className={item.isPacked ? 'text-ink-muted line-through' : ''}>
                            {item.label}
                          </span>
                        </label>

                        <Select
                          aria-label={`Who is packing ${item.label}`}
                          value={item.assignedUserId ?? ''}
                          disabled={assign.pending}
                          onChange={(event) => {
                            assign.mutate({
                              itemId: item.id,
                              assignedUserId: event.target.value || null,
                            });
                          }}
                          className="h-9 w-32 shrink-0 text-sm"
                        >
                          <option value="">Nobody</option>
                          {memberUserIds.map((userId) => (
                            <option key={userId} value={userId}>
                              {personLabel(userId, currentUserId)}
                            </option>
                          ))}
                        </Select>

                        <button
                          type="button"
                          aria-label={`Remove ${item.label}`}
                          className="shrink-0 px-2 text-sm text-ink-muted underline underline-offset-4"
                          disabled={remove.pending}
                          onClick={() => {
                            remove.mutate(item.id);
                          }}
                        >
                          Remove
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

/**
 * Household members are user ids here. Names live in Supabase auth, which this feature has
 * no reason to read, so the person looking sees "You" and everyone else sees a short id.
 */
function personLabel(userId: string, currentUserId: string): string {
  return userId === currentUserId ? 'You' : userId.slice(0, 8);
}

function AddItemForm({
  tripId,
  memberUserIds,
  currentUserId,
}: {
  tripId: string;
  memberUserIds: string[];
  currentUserId: string;
}) {
  const { mutate, pending, error } = useMutation(async (form: HTMLFormElement) => {
    const data = new FormData(form);
    await api.request(createPackingItem, {
      params: { tripId },
      body: {
        label: formText(data, 'label'),
        category: formText(data, 'category') || null,
        assignedUserId: formText(data, 'assignedUserId') || null,
      },
    });
    form.reset();
  });

  return (
    <form
      className="flex flex-col gap-2 md:flex-row"
      onSubmit={(event: SyntheticEvent<HTMLFormElement>) => {
        event.preventDefault();
        mutate(event.currentTarget);
      }}
    >
      <Input name="label" required maxLength={200} placeholder="Passport" className="md:flex-1" />
      <Input name="category" maxLength={200} placeholder="Documents" className="md:w-40" />
      <Select name="assignedUserId" aria-label="Who packs it" className="md:w-36">
        <option value="">Nobody</option>
        {memberUserIds.map((userId) => (
          <option key={userId} value={userId}>
            {personLabel(userId, currentUserId)}
          </option>
        ))}
      </Select>
      <Button type="submit" variant="outline" disabled={pending}>
        Add
      </Button>
      <FormError>{error}</FormError>
    </form>
  );
}

/** Templates are the whole point of packing the same six things every trip. */
function TemplateBar({ tripId, hasItems }: { tripId: string; hasItems: boolean }) {
  const [templates, setTemplates] = useState<PackingTemplate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .request(listPackingTemplates)
      .then(({ templates: found }) => {
        if (!cancelled) setTemplates(found);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setLoadError(errorMessage(cause));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const apply = useMutation((templateId: string) =>
    api.request(applyPackingTemplate, { params: { tripId }, body: { templateId } }),
  );
  const save = useMutation(async (name: string) => {
    const { template } = await api.request(createPackingTemplate, {
      body: { name, fromTripId: tripId },
    });
    setTemplates((current) => [...(current ?? []), template]);
    setSaving(false);
  });

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {templates === null ? (
          <p className="text-sm text-ink-muted">Looking for your templates…</p>
        ) : templates.length === 0 ? (
          <p className="text-sm text-ink-muted">No templates saved yet.</p>
        ) : (
          <>
            <span className="text-sm text-ink-muted">Start from</span>
            {templates.map((template) => (
              <Button
                key={template.id}
                variant="outline"
                disabled={apply.pending}
                onClick={() => {
                  apply.mutate(template.id);
                }}
              >
                {template.name}
              </Button>
            ))}
          </>
        )}

        {hasItems && !saving ? (
          <button
            type="button"
            className="text-sm text-ink-muted underline underline-offset-4"
            onClick={() => {
              setSaving(true);
            }}
          >
            Save this list as a template
          </button>
        ) : null}
      </div>

      {saving ? (
        <form
          className="flex flex-col gap-2 md:flex-row"
          onSubmit={(event: SyntheticEvent<HTMLFormElement>) => {
            event.preventDefault();
            const name = formText(new FormData(event.currentTarget), 'name');
            if (name !== '') save.mutate(name);
          }}
        >
          <Input
            name="name"
            required
            maxLength={200}
            placeholder="Beach week"
            className="md:w-64"
          />
          <Button type="submit" variant="outline" disabled={save.pending}>
            {save.pending ? 'Saving…' : 'Save template'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setSaving(false);
            }}
          >
            Cancel
          </Button>
        </form>
      ) : null}

      <FormError>{loadError ?? apply.error ?? save.error}</FormError>
    </div>
  );
}
