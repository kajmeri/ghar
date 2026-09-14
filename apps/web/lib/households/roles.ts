import type { HouseholdRole } from '@ghar/core/auth';

export const ROLE_LABELS: Record<HouseholdRole, string> = {
  owner: 'Owner',
  adult: 'Adult',
  member: 'Member',
  viewer: 'Viewer',
};

/** Plain-language summary of PERMISSIONS in @ghar/core/auth. Update both together. */
export const ROLE_DESCRIPTIONS: Record<HouseholdRole, string> = {
  owner: 'Everything, including bank connections, roles and removing people.',
  adult:
    "Manages household data and invites people. Can't change roles, connect banks or remove people.",
  member: 'Sees and edits everything except finances.',
  viewer: 'Can look but not change anything. No finances.',
};
