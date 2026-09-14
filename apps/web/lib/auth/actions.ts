'use server';

import { safeRedirectPath } from '@ghar/core/redirects';
import { redirect } from 'next/navigation';
import { createSupabaseServerClient } from '@/lib/supabase/server';

/** Signs out on this device. A `next` field sends the person back there after signing in again. */
export async function signOut(formData: FormData): Promise<void> {
  const supabase = await createSupabaseServerClient();
  await supabase.auth.signOut({ scope: 'local' });

  const next = formData.get('next');
  const path = safeRedirectPath(typeof next === 'string' ? next : null);
  redirect(path === '/' ? '/login' : `/login?next=${encodeURIComponent(path)}`);
}
