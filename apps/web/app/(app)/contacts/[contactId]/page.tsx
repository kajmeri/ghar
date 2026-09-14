import { contactParamsSchema } from '@ghar/contracts'
import { can } from '@ghar/core/auth'
import { phoneHref } from '@ghar/core/contacts'
import { todayInTimeZone } from '@ghar/core/dates'
import { NotFoundError } from '@ghar/core/errors'
import { ExternalLink, Mail, Phone } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import { Pill } from '@/components/ui/pill'
import { getPageSession } from '@/lib/api/authed'
import * as contacts from '@/lib/contacts/service'
import { dueText, MAINTENANCE_TONES } from '@/lib/home/display'
import { BackLink } from '../../_components/ui/back-link'
import { PageHeader } from '../../_components/ui/page-header'
import { ROW_LINK } from '../../_components/ui/row-link'
import { SectionHeader } from '../../_components/ui/section-header'
import { ContactSheet } from '../_components/contact-sheet'
import { DeleteContact } from '../_components/delete-contact'

export const metadata: Metadata = { title: 'Contact' }

const CARD = 'rounded-card border border-line bg-surface p-4 md:p-6'
const EMPTY_CARD = 'rounded-card border border-line bg-surface p-4 text-ink-muted'

export default async function ContactPage({ params }: PageProps<'/contacts/[contactId]'>) {
  const { contactId } = await params
  if (!contactParamsSchema.safeParse({ contactId }).success) notFound()
  const session = await getPageSession()
  const canManage = can(session.context.role, 'contacts.manage')
  const { contact, jobs } = await contacts.getContactDetail(session, contactId).catch((error: unknown) => {
    if (error instanceof NotFoundError) notFound()
    throw error
  })
  const today = todayInTimeZone(session.household.timeZone)
  const tel = contact.phone ? phoneHref(contact.phone) : null
  const hasActions = tel !== null || contact.email !== null || contact.url !== null || canManage

  const rows: { label: string; value: ReactNode }[] = [
    contact.phone ? { label: 'Phone', value: <span className='font-medium tabular-nums select-all'>{contact.phone}</span> } : null,
    contact.email ? { label: 'Email', value: <span className='break-all select-all'>{contact.email}</span> } : null,
    contact.url
      ? {
          label: 'Website',
          value: (
            <a href={contact.url} target='_blank' rel='noopener noreferrer' className='break-all underline underline-offset-4 hover:text-ink-muted'>
              {contact.url.replace(/^https?:\/\//, '')}
            </a>
          ),
        }
      : null,
    contact.tags.length > 0
      ? {
          label: 'Tags',
          value: (
            <span className='flex flex-wrap justify-end gap-1'>
              {contact.tags.map(tag => (
                <Pill key={tag} tone='neutral'>
                  {tag}
                </Pill>
              ))}
            </span>
          ),
        }
      : null,
  ].filter(row => row !== null)

  return (
    <>
      <BackLink href='/contacts'>Contacts</BackLink>
      <PageHeader
        title={contact.name}
        description={contact.role ?? undefined}
        action={
          hasActions ? (
            <>
              {tel ? (
                <Button asChild>
                  <a href={tel}>
                    <Phone aria-hidden />
                    Call
                  </a>
                </Button>
              ) : null}
              {contact.email ? (
                <Button asChild variant='outline'>
                  <a href={`mailto:${contact.email}`}>
                    <Mail aria-hidden />
                    Email
                  </a>
                </Button>
              ) : null}
              {contact.url ? (
                <Button asChild variant='outline'>
                  <a href={contact.url} target='_blank' rel='noopener noreferrer'>
                    <ExternalLink aria-hidden />
                    Website
                  </a>
                </Button>
              ) : null}
              {canManage ? <ContactSheet contact={contact} /> : null}
            </>
          ) : undefined
        }
      />

      <div className='flex flex-col gap-8'>
        {rows.length > 0 ? (
          <dl aria-label='Details' className='divide-y divide-line rounded-card border border-line bg-surface'>
            {rows.map(row => (
              <div key={row.label} className='flex items-start justify-between gap-4 px-4 py-3'>
                <dt className='shrink-0 text-ink-muted'>{row.label}</dt>
                <dd className='min-w-0 text-right'>{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className={EMPTY_CARD}>No phone number or email yet. Edit the details to add how to reach them.</p>
        )}

        <section aria-labelledby='jobs-heading'>
          <SectionHeader id='jobs-heading' title='Jobs they do' />
          {jobs.length > 0 ? (
            <ul aria-label={`Jobs ${contact.name} does`} className='divide-y divide-line overflow-hidden rounded-card border border-line bg-surface'>
              {jobs.map(job => (
                <li key={job.id} className='relative flex items-start justify-between gap-4 px-4 py-3 transition-colors hover:bg-paper'>
                  <div className='min-w-0'>
                    <p className='font-medium break-words'>
                      <Link href={`/home/maintenance/${job.id}`} className={ROW_LINK}>
                        {job.title}
                      </Link>
                    </p>
                    {job.assetName ? <p className='text-sm text-ink-muted'>{job.assetName}</p> : null}
                  </div>
                  {job.state === 'overdue' || job.state === 'due_soon' ? (
                    <Pill tone={MAINTENANCE_TONES[job.state]}>{dueText(job.nextDueOn, today)}</Pill>
                  ) : (
                    <p className='shrink-0 text-sm text-ink-muted'>{dueText(job.nextDueOn, today)}</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className={EMPTY_CARD}>Not linked to any jobs. Pick them under “Who to call” when adding or editing a house job.</p>
          )}
        </section>

        {contact.notes ? (
          <section aria-labelledby='notes-heading'>
            <SectionHeader id='notes-heading' title='Notes' />
            <p className={`${CARD} break-words whitespace-pre-line`}>{contact.notes}</p>
          </section>
        ) : null}

        {canManage ? (
          <div className='border-t border-line pt-6'>
            <DeleteContact contactId={contact.id} name={contact.name} />
          </div>
        ) : null}
      </div>
    </>
  )
}
