import { requirePermission } from '@ghar/core/auth';
import type { Actor } from './types';

type Permission = Parameters<typeof requirePermission>[1];

/** A system actor has no role to check. Its household came from a stored row. */
export function authorize(actor: Actor, permission: Permission): void {
  if (actor.userId !== null) requirePermission(actor, permission);
}
