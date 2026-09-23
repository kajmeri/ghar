import { formatCalendarDate } from '@ghar/core/dates'
import { formatCents } from '@ghar/core/money'
import type { Metadata } from 'next'
import Link from 'next/link'
import { cache } from 'react'
import { AuthScreen } from '@/app/_components/auth-screen'
import { Button } from '@/components/ui/button'
import { viewOneTap, type OneTapView } from '@/lib/digest/one-tap-actions'
import { OneTapForm } from './_components/one-tap-form'

// A one-tap link from the daily email. Works without signing in: the signed link is the credential.
// Opening it only shows what the button will do, so a mail scanner that opens links changes nothing.
// The link is a bearer secret in the URL, so never leak it to another origin through Referer.

// The tab title says what the page says, so a screen reader user switching tabs hears the outcome.
// Metadata and the page both need the view; cache reads the link once per request.
const loadView = cache((token: string) => viewOneTap(token))

const TITLES: Record<Exclude<OneTapView['state'], 'mark_paid'>, string> = {
  invalid: 'This link isn’t valid',
  used: 'This link has been used',
  expired: 'This link has expired',
  not_allowed: 'You can’t make this change',
  gone: 'This no longer exists',
  categorize: 'Choose a category',
}

export async function generateMetadata({ params }: PageProps<'/a/[token]'>): Promise<Metadata> {
  const { token } = await params
  const view = await loadView(token)
  return {
    title: view.state === 'mark_paid' ? `Mark ${view.bill.name} paid?` : TITLES[view.state],
    referrer: 'no-referrer',
    robots: { index: false, follow: false },
  }
}

export default async function OneTapPage({ params }: PageProps<'/a/[token]'>) {
  const { token } = await params
  const view = await loadView(token)

  switch (view.state) {
    case 'invalid':
      return (
        <AuthScreen title={TITLES.invalid} description={<p>Make sure you opened the whole link from the email. You can always make the change in Ghar.</p>}>
          <ContinueLink />
        </AuthScreen>
      )
    case 'used':
      return (
        <AuthScreen title={TITLES.used} description={<p>Each link works once. Whatever it did is already done.</p>}>
          <ContinueLink />
        </AuthScreen>
      )
    case 'expired':
      return (
        <AuthScreen title={TITLES.expired} description={<p>Links in the daily email work for 3 days. You can still make the change in Ghar.</p>}>
          <ContinueLink />
        </AuthScreen>
      )
    case 'not_allowed':
      return (
        <AuthScreen title={TITLES.not_allowed} description={<p>Your role in the household no longer includes changing money.</p>}>
          <ContinueLink />
        </AuthScreen>
      )
    case 'gone':
      return (
        <AuthScreen title={TITLES.gone} description={<p>It was deleted after the email went out.</p>}>
          <ContinueLink />
        </AuthScreen>
      )
    case 'categorize': {
      const { transaction } = view
      const details = [formatCalendarDate(transaction.date), transaction.accountName].filter(Boolean).join(' · ')
      return (
        <AuthScreen
          title={TITLES.categorize}
          description={
            <p>
              <span className='block font-medium text-ink'>{transaction.description}</span>
              <span className='block tabular-nums'>
                {formatCents(transaction.amountCents, { currency: view.currency })} · {details}
              </span>
            </p>
          }
        >
          <OneTapForm
            token={token}
            categories={view.categories}
            currentCategoryId={transaction.categoryId}
            submitLabel='Save category'
            pendingLabel='Saving…'
          />
        </AuthScreen>
      )
    }
    case 'mark_paid': {
      const { bill } = view
      const amount = bill.amountCents === null ? null : formatCents(bill.amountCents, { currency: view.currency })
      return (
        <AuthScreen
          title={`Mark ${bill.name} paid?`}
          description={
            <p className='tabular-nums'>
              {amount ? `${amount}, due` : 'Due'} {formatCalendarDate(bill.dueOn)}. This marks that payment done as of today.
            </p>
          }
        >
          <OneTapForm token={token} submitLabel='Mark paid' pendingLabel='Marking…' />
        </AuthScreen>
      )
    }
  }
}

function ContinueLink() {
  return (
    <Button asChild variant='outline' className='w-full'>
      <Link href='/'>Go to Ghar</Link>
    </Button>
  )
}
