'use client';

import { updateHouseholdMember, type HouseholdMember } from '@casa/contracts';
import { compareMembers, memberLabel } from '@casa/core/household';
import { useState, type SyntheticEvent } from 'react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/field';
import { FormError } from '@/components/ui/form-error';
import { Pill } from '@/components/ui/pill';
import { useMutation } from '@/hooks/use-mutation';
import { api } from '@/lib/api/client';
import { formText } from '@/lib/form';

/**
 * Naming people. Anyone may rename themselves; renaming somebody else is an owner's call,
 * which is why the button is only there for an owner rather than failing on submit.
 */
export function MemberList({
  members,
  currentUserId,
  canRenameAnyone,
}: {
  members: HouseholdMember[];
  currentUserId: string;
  canRenameAnyone: boolean;
}) {
  const ordered = [...members].sort(compareMembers(currentUserId));

  if (ordered.length === 0) {
    return (
      <EmptyState title="Nobody is in this household yet">
        Members arrive with the invite flow, which is not built yet.
      </EmptyState>
    );
  }

  return (
    <ul className="flex flex-col rounded-card border border-line bg-surface">
      {ordered.map((member, index) => (
        <li key={member.userId} className={index === 0 ? '' : 'border-t border-line'}>
          <MemberRow
            member={member}
            currentUserId={currentUserId}
            canRename={canRenameAnyone || member.userId === currentUserId}
          />
        </li>
      ))}
    </ul>
  );
}

function MemberRow({
  member,
  currentUserId,
  canRename,
}: {
  member: HouseholdMember;
  currentUserId: string;
  canRename: boolean;
}) {
  const [editing, setEditing] = useState(false);

  const save = useMutation(async (form: FormData) => {
    await api.request(updateHouseholdMember, {
      params: { userId: member.userId },
      // An empty name clears it rather than storing a blank.
      body: { displayName: formText(form, 'displayName') || null },
    });
    setEditing(false);
  });

  if (editing) {
    return (
      <form
        className="flex flex-wrap items-center gap-2 px-4 py-3"
        onSubmit={(event: SyntheticEvent<HTMLFormElement>) => {
          event.preventDefault();
          save.mutate(new FormData(event.currentTarget));
        }}
      >
        <Input
          name="displayName"
          maxLength={100}
          autoFocus
          defaultValue={member.displayName ?? ''}
          placeholder="What everyone calls them"
          aria-label={`Name for ${memberLabel(member, currentUserId)}`}
          className="md:w-64"
        />
        <Button type="submit" variant="outline" disabled={save.pending}>
          {save.pending ? 'Saving…' : 'Save'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            setEditing(false);
          }}
        >
          Cancel
        </Button>
        <FormError>{save.error}</FormError>
      </form>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 px-4 py-3">
      {/* Everywhere else you are "You". Here the page is about names, so yours shows too. */}
      <p className="font-medium">{member.displayName ?? memberLabel(member, currentUserId)}</p>
      {member.userId === currentUserId ? <p className="text-sm text-ink-muted">You</p> : null}
      {member.role === 'owner' ? <Pill>Owner</Pill> : null}
      {member.displayName === null ? <p className="text-sm text-ink-muted">No name set</p> : null}

      {canRename ? (
        <button
          type="button"
          className="ml-auto text-sm text-ink-muted underline underline-offset-4"
          onClick={() => {
            setEditing(true);
          }}
        >
          {member.displayName === null ? 'Give them a name' : 'Rename'}
        </button>
      ) : null}
    </div>
  );
}
