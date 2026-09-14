import { removeMember, updateMemberRole } from '@ghar/contracts';
import { route } from '@/lib/api/handler';
import { getRequestContext } from '@/lib/auth/context';
import * as households from '@/lib/households/service';

export const PATCH = route(updateMemberRole, async ({ params, body }) => ({
  member: await households.changeMemberRole(await getRequestContext(), {
    userId: params.userId,
    role: body.role,
  }),
}));

export const DELETE = route(removeMember, async ({ params }) =>
  households.removeMember(await getRequestContext(), { userId: params.userId }),
);
