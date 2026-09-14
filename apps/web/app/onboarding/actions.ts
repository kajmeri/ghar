'use server';

import { createHouseholdBodySchema } from '@ghar/contracts';
import { redirect } from 'next/navigation';
import { parseForm, runAction } from '@/lib/actions/run';
import type { ActionState } from '@/lib/actions/state';
import { requireSession } from '@/lib/auth/context';
import * as households from '@/lib/households/service';

export async function createHouseholdAction(
  _previous: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, async () => {
    const session = await requireSession();
    await households.createHousehold(session, parseForm(createHouseholdBodySchema, formData));
    redirect('/');
  });
}
