import { previewInvitation } from '@ghar/contracts';
import { route } from '@/lib/api/handler';
import { requireSession } from '@/lib/auth/context';
import * as households from '@/lib/households/service';

export const POST = route(previewInvitation, async ({ body }) => ({
  invitation: await households.previewInvitation(await requireSession(), body.token),
}));
