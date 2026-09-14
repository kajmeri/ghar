'use client';

import { useActionState } from 'react';
import { Button } from '@/components/ui/button';
import { describedBy, Field, FormMessage } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { fieldError, IDLE, submittedValue } from '@/lib/actions/state';
import { requestSignInLink } from '../actions';

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction, pending] = useActionState(requestSignInLink, IDLE);
  const emailError = fieldError(state, 'email');

  return (
    <form action={formAction} noValidate className="flex flex-col gap-4">
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Field id="email" label="Email" error={emailError}>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          defaultValue={submittedValue(state, 'email')}
          aria-invalid={Boolean(emailError)}
          aria-describedby={describedBy('email', emailError)}
        />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending ? 'Sending…' : 'Email me a sign-in link'}
      </Button>
      <FormMessage state={state} />
    </form>
  );
}
