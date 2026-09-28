import { Field } from '@/components/ui/field'
import { NativeSelect } from '@/components/ui/native-select'

export interface PersonOption {
  id: string
  label: string
  /** The caller's own person. */
  you?: boolean
}

/** Whose a document or renewal is. Sends `personId`, empty for the household as a whole. */
export function PersonField({
  people,
  defaultValue,
  hint,
  onChange,
}: {
  people: PersonOption[]
  defaultValue: string | null
  hint?: string
  /** The person picked, or null for the household. */
  onChange?: (personId: string | null) => void
}) {
  return (
    <Field label='Whose it is' hint={hint}>
      <NativeSelect
        name='personId'
        defaultValue={defaultValue ?? ''}
        onChange={event => {
          onChange?.(event.currentTarget.value || null)
        }}
      >
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
