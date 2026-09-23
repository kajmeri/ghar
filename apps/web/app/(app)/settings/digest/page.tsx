import { DIGEST_SECTION_DESCRIPTIONS, DIGEST_SECTION_TITLES } from '@ghar/core/digest'
import type { Metadata } from 'next'
import { getPageContext } from '@/lib/auth/context'
import * as digest from '@/lib/digest/preferences'
import { BackLink } from '../../_components/ui/back-link'
import { PageHeader } from '../../_components/ui/page-header'
import { SectionHeader } from '../../_components/ui/section-header'
import { DigestPreferencesForm, DigestPreviewForm } from './_components/digest-preferences-form'

export const metadata: Metadata = { title: 'Daily email' }

export default async function DigestSettingsPage() {
  const { ctx, session } = await getPageContext()
  const { preferences, timezone, availableSections } = await digest.getDigestSettings(ctx)
  const sections = availableSections.map(value => ({
    value,
    title: DIGEST_SECTION_TITLES[value],
    description: DIGEST_SECTION_DESCRIPTIONS[value],
  }))

  return (
    <>
      <BackLink href='/settings'>Settings</BackLink>
      <PageHeader title='Daily email' description='What needs doing at home, in one email. Everyone in the household sets their own.' />
      <div className='flex flex-col gap-10'>
        <DigestPreferencesForm
          enabled={preferences.enabled}
          chosen={preferences.sections}
          sendHour={preferences.sendHour}
          timezone={timezone}
          sections={sections}
        />
        <section aria-labelledby='preview-heading'>
          <SectionHeader id='preview-heading' title='See it now' />
          <p className='mb-3 text-sm text-ink-muted'>
            Sends today’s email to {session.email ?? 'your address'} now, with the sections above as last saved, even if it’s off. Its
            links work.
          </p>
          <DigestPreviewForm />
        </section>
      </div>
    </>
  )
}
