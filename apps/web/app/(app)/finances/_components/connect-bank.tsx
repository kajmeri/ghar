'use client'

import { createBankConnection, createBankLinkToken, reconnectBankConnection, type BankLinkProviderValue } from '@ghar/contracts'
import { useRouter } from 'next/navigation'
import { useState, useTransition, type ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { FormError } from '@/components/ui/form-error'
import { api, errorMessage } from '@/lib/api/client'

// Opening Plaid Link, for a new bank and for repairing one that stopped working.
//
// Link runs in the browser. Ghar asks its own API for a link token, Plaid's script takes the
// person through their bank's sign-in, and hands back a public token. That public token goes
// straight to the server, which trades it for the access token it keeps sealed. Nothing secret
// lives in this file: a link token is useless without finishing the flow, and a public token is
// spent the moment the server exchanges it.
//
// Without Plaid keys the deployment is on the in-memory stand-in, which has no browser flow at
// all: its link token goes back as the public token and a sample bank appears.

const PLAID_SCRIPT = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js'

interface PlaidHandler {
  open: () => void
  destroy: () => void
}

interface PlaidLink {
  create: (options: { token: string; onSuccess: (publicToken: string) => void; onExit: () => void }) => PlaidHandler
}

declare global {
  interface Window {
    Plaid?: PlaidLink
  }
}

const SCRIPT_FAILED = 'Your bank’s sign-in didn’t load. Check your connection and try again.'

/** Plaid's script, loaded the first time somebody connects rather than on every page. */
function loadPlaid(): Promise<PlaidLink> {
  if (window.Plaid) return Promise.resolve(window.Plaid)
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${PLAID_SCRIPT}"]`)
    const script = existing instanceof HTMLScriptElement ? existing : document.createElement('script')
    script.addEventListener('load', () => {
      if (window.Plaid) resolve(window.Plaid)
      else reject(new Error(SCRIPT_FAILED))
    })
    script.addEventListener('error', () => {
      reject(new Error(SCRIPT_FAILED))
    })
    if (existing === null) {
      script.src = PLAID_SCRIPT
      script.async = true
      document.head.append(script)
    }
  })
}

/**
 * Connects a bank, or reopens Link on `connectionId` to repair that one. Repairing keeps the
 * connection and everything already synced; connecting again would make a second one.
 */
export function ConnectBank({
  provider,
  connectionId,
  variant = 'default',
  children,
}: {
  provider: BankLinkProviderValue
  connectionId?: string
  variant?: 'default' | 'outline'
  children: ReactNode
}) {
  const router = useRouter()
  const [working, setWorking] = useState(false)
  const [refreshing, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const pending = working || refreshing

  async function finish(publicToken: string): Promise<void> {
    // Update mode repairs the connection Ghar already has, so it needs no token back.
    if (connectionId === undefined) await api.request(createBankConnection, { body: { publicToken } })
    else await api.request(reconnectBankConnection, { params: { itemId: connectionId } })
    startTransition(() => {
      router.refresh()
    })
  }

  async function start(): Promise<void> {
    setError(null)
    setWorking(true)
    try {
      const { linkToken } = await api.request(createBankLinkToken, {
        body: connectionId === undefined ? {} : { itemId: connectionId },
      })
      if (provider === 'fake') {
        await finish(linkToken)
        setWorking(false)
        return
      }
      const plaid = await loadPlaid()
      const handler = plaid.create({
        token: linkToken,
        onSuccess: publicToken => {
          void finish(publicToken)
            .catch((caught: unknown) => {
              setError(errorMessage(caught))
            })
            .finally(() => {
              setWorking(false)
              handler.destroy()
            })
        },
        onExit: () => {
          // Closed without finishing, which isn't a failure: the button goes back to how it was.
          setWorking(false)
          handler.destroy()
        },
      })
      // Link is open now; the button stays busy until onSuccess or onExit says otherwise.
      handler.open()
    } catch (caught) {
      setError(caught instanceof Error && caught.message === SCRIPT_FAILED ? SCRIPT_FAILED : errorMessage(caught))
      setWorking(false)
    }
  }

  return (
    <div className='flex flex-col items-start gap-1'>
      <Button
        type='button'
        variant={variant}
        disabled={pending}
        onClick={() => {
          void start()
        }}
      >
        {pending ? 'Connecting…' : children}
      </Button>
      <FormError>{error}</FormError>
    </div>
  )
}
