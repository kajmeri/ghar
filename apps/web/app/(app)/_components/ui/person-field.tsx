import { Field } from '@/components/ui/field'
import { NativeSelect } from '@/components/ui/native-select'

export interface PersonOption {
  id: string
  label: string
}

/** Whose a document or renewal is. Sends `personId`, empty for the household as a whole. */
export function PersonField({ people, defaultValue, hint }: { people: PersonOption[]; defaultValue: string | null; hint?: string }) {
  return (
    <Field label='Whose it is' hint={hint}>
      <NativeSelect name='personId' defaultValue={defaultValue ?? ''}>
        <option value=''>The whole household</option>
        {people.map(person => (
          <option key={person.id} value={person.id}>
            {person.label}
          </option>
        ))}
      </NativeSelect>
    </Field>
  )
}
