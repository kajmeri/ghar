/** What a form's server action hands back to useActionState. Safe to import from client code. */
export type ActionState =
  | { status: 'idle' }
  | { status: 'success'; message: string }
  | {
      status: 'error';
      message: string;
      fieldErrors: Partial<Record<string, string>>;
      /**
       * What was submitted. React resets a form after its action runs, so fields use these as
       * their defaultValue to keep what the person typed when something needs fixing.
       */
      values: Partial<Record<string, string>>;
    };

export const IDLE: ActionState = { status: 'idle' };

export function fieldError(state: ActionState, field: string): string | undefined {
  return state.status === 'error' ? state.fieldErrors[field] : undefined;
}

export function submittedValue(state: ActionState, field: string): string | undefined {
  return state.status === 'error' ? state.values[field] : undefined;
}
