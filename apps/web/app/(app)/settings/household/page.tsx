import type { Invitation, Member } from '@ghar/contracts'
import { can, HOUSEHOLD_ROLES, INVITABLE_ROLES } from '@ghar/core/auth'
import { formatCalendarDate, formatInstant, todayInTimeZone, type CalendarDate } from '@ghar/core/dates'
import { invitationStatus } from '@ghar/core/invitations'
import { ageLabel, canSetBirthDate } from '@ghar/core/people'
import { TriangleAlert } from 'lucide-react'
import type { Metadata } from 'next'
import { getPageContext } from '@/lib/auth/context'
import { countryLabel, countryOptions, currencyLabel, timeZoneOptions } from '@/lib/households/options'
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/households/roles'
import * as households from '@/lib/households/service'
import * as people from '@/lib/people/service'
import { Avatar } from '../../_components/ui/avatar'
import { PageHeader } from '../../_components/ui/page-header'
import { SectionHeader } from '../../_components/ui/section-header'
import { InvitationControls } from './_components/invitation-controls'
import { InviteForm } from './_components/invite-form'
import { MemberControls } from './_components/member-controls'
import { AddPersonForm, BirthDateControl, PersonControls } from './_components/people-controls'
import { PlaceForm } from './_components/place-form'

export const metadata: Metadata = { title: 'Household' }

const ALL_ROLES = HOUSEHOLD_ROLES.map(value => ({ value, label: ROLE_LABELS[value] }))

export default async function HouseholdSettingsPage() {
  const { ctx, session } = await getPageContext()
  const canInvite = can(ctx.role, 'members.invite')
  const canChangeRole = can(ctx.role, 'members.changeRole')
  const canRemove = can(ctx.role, 'members.remove')
  const canManagePeople = can(ctx.role, 'people.manage')
  const canUpdateHousehold = can(ctx.role, 'household.update')

  const [{ household }, members, invitations, everyone] = await Promise.all([
    households.getMyHousehold(ctx, session),
    households.listMembers(ctx),
    canInvite ? households.listInvitations(ctx) : Promise.resolve<Invitation[]>([]),
    people.listPeople(ctx),
  ])
  // Members are listed above. These are the others: children, and anyone who has left.
  const others = everyone.filter(person => person.userId === null)
  const memberPeople = new Map(everyone.flatMap(person => (person.userId === null ? [] : [[person.userId, person] as const])))
  const today = todayInTimeZone(household.timezone)
  // A zone saved under an older name the list no longer offers stays selectable, so saving the form
  // never swaps it for the first zone in the list.
  const zones = timeZoneOptions()
  const timeZones = zones.includes(household.timezone) ? zones : [household.timezone, ...zones]
  const inviteRoles = INVITABLE_ROLES[ctx.role].map(value => ({
    value,
    label: ROLE_LABELS[value],
    description: ROLE_DESCRIPTIONS[value],
  }))

  return (
    <>
      <PageHeader title='Household' description={`${household.name} · ${household.timezone} · ${household.currency}`} />
      <div className='flex flex-col gap-10'>
        <section aria-labelledby='members-heading'>
          <SectionHeader
            id='members-heading'
            title={
              <>
                Members <span className='font-normal text-ink-muted'>{members.length}</span>
              </>
            }
          />
          <ul className='flex flex-col gap-3'>
            {members.map(member => {
              const isYou = member.userId === ctx.userId
              const name = displayName(member)
              const person = memberPeople.get(member.userId)
              return (
                <li key={member.userId} className='rounded-card border border-line bg-surface p-4'>
                  <div className='flex items-start gap-3'>
                    <Avatar name={name} />
                    <div className='min-w-0 flex-1'>
                      <p className='font-medium break-words'>
                        {name}
                        {isYou ? <span className='font-normal text-ink-muted'> (you)</span> : null}
                      </p>
                      {member.fullName && member.email ? <p className='text-sm break-all text-ink-muted'>{member.email}</p> : null}
                      <p className='text-sm text-ink-muted'>Joined {formatDay(member.joinedAt, household.timezone)}</p>
                      {person?.birthDate ? <p className='text-sm text-ink-muted'>{bornLine(person.birthDate, today)}</p> : null}
                    </div>
                    <span className='shrink-0 rounded-pill border border-line px-2.5 py-0.5 text-sm'>{ROLE_LABELS[member.role]}</span>
                  </div>
                  {person && canSetBirthDate(ctx, member.userId) ? (
                    <div className='mt-4 flex border-t border-line pt-4'>
                      <BirthDateControl personId={person.id} name={isYou ? 'you' : name} birthDate={person.birthDate} today={today} />
                    </div>
                  ) : null}
                  {!isYou && (canChangeRole || canRemove) ? (
                    <MemberControls
                      userId={member.userId}
                      name={name}
                      role={member.role}
                      roles={ALL_ROLES}
                      canChangeRole={canChangeRole}
                      canRemove={canRemove}
                    />
                  ) : null}
                </li>
              )
            })}
          </ul>
          {canInvite && !canRemove ? <p className='mt-3 text-sm text-ink-muted'>Only owners change roles or remove people.</p> : null}
        </section>

        <section id='people' aria-labelledby='people-heading' className='scroll-mt-6'>
          <SectionHeader
            id='people-heading'
            title={
              <>
                Without an account <span className='font-normal text-ink-muted'>{others.length}</span>
              </>
            }
            description='Children, and anyone else whose passport, renewals or trips you keep track of. They can’t sign in.'
          />
          {others.length === 0 ? (
            <p className='mb-3 rounded-card border border-line bg-surface p-4 text-ink-muted'>
              {canManagePeople
                ? 'Add a child here to keep their passport and trips with everyone else’s.'
                : 'Ask an owner or adult to add a child or anyone else without an account.'}
            </p>
          ) : (
            <ul className='mb-3 flex flex-col gap-3'>
              {others.map(person => {
                const name = person.name ?? 'Unnamed'
                return (
                  <li key={person.id} className='rounded-card border border-line bg-surface p-4'>
                    <div className='flex items-center gap-3'>
                      <Avatar name={name} />
                      <div className='min-w-0 flex-1'>
                        <p className='font-medium break-words'>{name}</p>
                        {person.birthDate ? <p className='text-sm text-ink-muted'>{bornLine(person.birthDate, today)}</p> : null}
                      </div>
                    </div>
                    {canManagePeople ? (
                      <PersonControls personId={person.id} name={name} birthDate={person.birthDate} today={today} />
                    ) : null}
                  </li>
                )
              })}
            </ul>
          )}
          {canManagePeople ? <AddPersonForm today={today} /> : null}
        </section>

        {canInvite ? (
          <>
            <section aria-labelledby='invite-heading'>
              <SectionHeader id='invite-heading' title='Invite someone' />
              <InviteForm roles={inviteRoles} />
            </section>

            <section aria-labelledby='invitations-heading'>
              <SectionHeader id='invitations-heading' title='Pending invitations' />
              {invitations.length === 0 ? (
                <p className='rounded-card border border-line bg-surface p-4 text-ink-muted'>
                  No invitations waiting. People you invite show up here until they join.
                </p>
              ) : (
                <ul className='flex flex-col gap-3'>
                  {invitations.map(invitation => (
                    <li
                      key={invitation.id}
                      className='flex flex-col gap-4 rounded-card border border-line bg-surface p-4 md:flex-row md:items-center md:justify-between'
                    >
                      <div className='min-w-0'>
                        <p className='font-medium break-all'>{invitation.email}</p>
                        <p className='flex flex-wrap items-center gap-x-1.5 text-sm text-ink-muted'>
                          <span>{ROLE_LABELS[invitation.role]}</span>
                          <span aria-hidden>·</span>
                          {isExpired(invitation.expiresAt) ? (
                            // Caution is too light for text, so the words stay ink and the icon carries it.
                            <span className='inline-flex items-center gap-1 text-ink'>
                              <TriangleAlert aria-hidden className='size-4 shrink-0 text-caution-ink' />
                              Expired. Resend to get a new link.
                            </span>
                          ) : (
                            <span>Expires {formatDay(invitation.expiresAt, household.timezone)}</span>
                          )}
                        </p>
                      </div>
                      <InvitationControls invitationId={invitation.id} email={invitation.email} role={invitation.role} />
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : (
          <p className='rounded-card border border-line bg-surface p-4 text-ink-muted'>Ask an owner or adult to invite someone.</p>
        )}

        <section aria-labelledby='region-heading'>
          <SectionHeader id='region-heading' title='Time zone, country and currency' />
          <div className='flex flex-col gap-3'>
            {canUpdateHousehold ? (
              <PlaceForm
                timezone={household.timezone}
                timeZones={timeZones}
                homeCountry={household.homeCountry}
                countries={countryOptions()}
              />
            ) : (
              <div className='flex flex-col gap-3 rounded-card border border-line bg-surface p-4'>
                <div>
                  <p className='text-sm font-medium'>Time zone</p>
                  <p className='break-words'>{household.timezone.replaceAll('_', ' ')}</p>
                </div>
                <div>
                  <p className='text-sm font-medium'>Home country</p>
                  <p>{household.homeCountry === null ? 'Not set' : countryLabel(household.homeCountry)}</p>
                </div>
                <p className='text-sm text-ink-muted'>Ask an owner or adult to change them.</p>
              </div>
            )}
            <div className='rounded-card border border-line bg-surface p-4'>
              <p className='text-sm font-medium'>Currency</p>
              <p>{currencyLabel(household.currency)}</p>
              <p className='text-sm text-ink-muted'>Set when the household was made. It can’t change, since every amount is kept in it.</p>
            </div>
          </div>
        </section>
      </div>
    </>
  )
}

function displayName(member: Member): string {
  return member.fullName ?? member.email ?? 'Unnamed member'
}

/** "Born Mar 3, 2022 · 4 years old". */
function bornLine(birthDate: CalendarDate, today: CalendarDate): string {
  return `Born ${formatCalendarDate(birthDate)} · ${ageLabel(birthDate, today)}`
}

function formatDay(iso: string, timeZone: string): string {
  return formatInstant(new Date(iso), timeZone, { dateStyle: 'medium' })
}

function isExpired(expiresAt: string): boolean {
  return invitationStatus({ acceptedAt: null, expiresAt: new Date(expiresAt) }, new Date()) === 'expired'
}
