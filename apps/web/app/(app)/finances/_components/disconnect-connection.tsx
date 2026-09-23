'use client'

import { deleteBankConnectionHistory, disconnectBankConnection, type BankConnection } from '@ghar/contracts'
import { PowerOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { useMutation } from '@/hooks/use-mutation'
import { api } from '@/lib/api/client'
import { connectionName, keptText } from '@/lib/banking/display'
import { ConfirmDialog } from '../../_components/ui/confirm-dialog'
import { DeleteButton } from '../../_components/ui/delete-button'

/**
 * Turning a bank off. Ghar stops syncing it and gives the access token back to the bank; what it
 * already brought in is not touched, so the dialog says so rather than leaving a person to guess.
 */
export function DisconnectConnection({ connection }: { connection: BankConnection }) {
  const name = connectionName(connection)
  const { mutate, pending, error } = useMutation<[]>(async () => {
    await api.request(disconnectBankConnection, { params: { itemId: connection.id } })
  })

  return (
    <div className='flex flex-col items-start gap-1'>
      <ConfirmDialog
        trigger={
          <Button type='button' variant='outline' disabled={pending} aria-label={pending ? undefined : `Turn off ${name}`}>
            <PowerOff aria-hidden />
            {pending ? 'Turning off…' : 'Turn off'}
          </Button>
        }
        title={`Turn off ${name}?`}
        description={`Ghar stops syncing this bank and hands the connection back. The ${keptText(connection)} it has already brought in stay exactly as they are, with their categories, notes and trip tags. Connect the bank again whenever you like.`}
        confirmLabel='Turn it off'
        onConfirm={() => {
          mutate()
        }}
      />
      <FormError>{error}</FormError>
    </div>
  )
}

/** The only thing in Ghar that removes a synced account, and it has to be asked for by name. */
export function DeleteConnectionHistory({ connection }: { connection: BankConnection }) {
  const name = connectionName(connection)
  return (
    <DeleteButton
      label='Delete history'
      accessibleLabel={`Delete what ${name} brought in`}
      title={`Delete what ${name} brought in?`}
      description={`This removes ${keptText(connection)}, along with the balances they contributed to net worth. Spending and budgets for those months will change. It can’t be undone.`}
      onDelete={() => api.request(deleteBankConnectionHistory, { params: { itemId: connection.id } })}
    />
  )
}
