import type { BankConnection, BankLinkProviderValue } from '@ghar/contracts'
import type { TimeZone } from '@ghar/core/dates'
import { TriangleAlert } from 'lucide-react'
import { ATTENTION_TEXT, connectionName, keptText, syncedText } from '@/lib/banking/display'
import { EmptyState } from '../../_components/ui/empty-state'
import { WalletIllustration } from '../../_components/ui/illustrations'
import { SectionHeader } from '../../_components/ui/section-header'
import { ConnectBank } from './connect-bank'
import { DeleteConnectionHistory, DisconnectConnection } from './disconnect-connection'
import { SyncConnection } from './sync-connection'

// The household's banks: what each one is doing, and what a person can do about it. Turning one off
// keeps everything it brought in; deleting that history is a separate, destructive thing, and it is
// only offered once the connection is already off.

export function BankConnections({
  connections,
  provider,
  canConnect,
  timeZone,
}: {
  connections: BankConnection[]
  provider: BankLinkProviderValue
  /** False when this deployment can't make another connection, so the button would only fail. */
  canConnect: boolean
  timeZone: TimeZone
}) {
  if (connections.length === 0) {
    return canConnect ? (
      <EmptyState
        illustration={<WalletIllustration />}
        title='Connect a bank to see your money'
        description='Link your checking and credit card accounts and Ghar keeps balances, spending and budgets up to date on its own.'
        action={<ConnectBank provider={provider}>Connect a bank account</ConnectBank>}
      />
    ) : (
      <EmptyState
        illustration={<WalletIllustration />}
        title='Ghar can’t connect a bank right now'
        description='Its connection to Plaid isn’t set up, so balances and spending have to wait.'
      />
    )
  }

  return (
    <section aria-labelledby='connections-heading'>
      <SectionHeader
        id='connections-heading'
        title='Banks'
        description='Balances and transactions arrive every morning, and whenever your bank says there’s something new.'
        action={
          canConnect ? (
            <ConnectBank provider={provider} variant='outline'>
              Connect another bank
            </ConnectBank>
          ) : undefined
        }
      />
      <ul className='divide-y divide-line rounded-card border border-line bg-surface'>
        {connections.map(connection => (
          <li key={connection.id} className='flex flex-col gap-3 px-4 py-3 md:flex-row md:items-center md:justify-between'>
            <div className='min-w-0'>
              <p className='font-medium break-words'>{connectionName(connection)}</p>
              <ConnectionStatus connection={connection} timeZone={timeZone} />
            </div>
            <div className='flex shrink-0 flex-col gap-2 md:flex-row'>
              {connection.status === 'disconnected' ? (
                <DeleteConnectionHistory connection={connection} />
              ) : (
                <>
                  {connection.canReconnect ? (
                    <ConnectBank provider={provider} connectionId={connection.id}>
                      Reconnect
                    </ConnectBank>
                  ) : null}
                  {connection.attention === 'revoked' ? null : (
                    <SyncConnection connectionId={connection.id} name={connectionName(connection)} />
                  )}
                  <DisconnectConnection connection={connection} />
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function ConnectionStatus({ connection, timeZone }: { connection: BankConnection; timeZone: TimeZone }) {
  const synced = syncedText(connection, timeZone)
  if (connection.status === 'disconnected') {
    return (
      <p className='text-sm text-ink-muted'>
        {synced}. Its {keptText(connection)} are still here, and connecting the bank again picks up from there.
      </p>
    )
  }
  if (connection.attention === null) {
    return <p className='text-sm text-ink-muted'>{synced}</p>
  }
  return (
    <p className='flex items-start gap-1.5 text-sm text-ink'>
      <TriangleAlert aria-hidden className='mt-0.5 size-4 shrink-0 text-caution-ink' />
      <span className='min-w-0'>
        {ATTENTION_TEXT[connection.attention]} <span className='text-ink-muted'>{synced}.</span>
      </span>
    </p>
  )
}
