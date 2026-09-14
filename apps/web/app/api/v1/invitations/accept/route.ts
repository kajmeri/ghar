import { acceptInvitation } from '@ghar/contracts';
import { route } from '@/lib/api/handler';
import { requireSession } from '@/lib/auth/context';
import * as households from '@/lib/households/service';

export const POST = route(acceptInvitation, async ({ body }) =>
  households.acceptInvitation(await requireSession(), body.token),
);
