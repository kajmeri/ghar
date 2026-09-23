'use client'

import { deleteManualAccount, deleteManualValue, deleteNetWorthHistory } from '@ghar/contracts'
import { formatCalendarDate, type CalendarDate } from '@ghar/core/dates'
import { DeleteButton } from '@/app/(app)/_components/ui/delete-button'
import { api } from '@/lib/api/client'
import { NET_WORTH_PATH } from '@/lib/networth/display'

export function DeleteManualAccount({ manualAccountId, name }: { manualAccountId: string; name: string }) {
  return (
    <DeleteButton
      label='Delete account'
      title={`Delete ${name}?`}
      description='Its value history goes too, and past net worth days stop counting it. To keep the history, archive it instead.'
      redirectTo={NET_WORTH_PATH}
      onDelete={() => api.request(deleteManualAccount, { params: { manualAccountId } })}
    />
  )
}

export function DeleteManualValue({ manualAccountId, valueId, asOf }: { manualAccountId: string; valueId: string; asOf: CalendarDate }) {
  const date = formatCalendarDate(asOf)
  return (
    <DeleteButton
      label='Delete'
      accessibleLabel={`Delete the value from ${date}`}
      title={`Delete the value from ${date}?`}
      description='For a value entered by mistake. Net worth days already recorded keep what they counted.'
      onDelete={() => api.request(deleteManualValue, { params: { manualAccountId, valueId } })}
    />
  )
}

export function DeleteHistoryEntry({ entryId, asOf }: { entryId: string; asOf: CalendarDate }) {
  const date = formatCalendarDate(asOf)
  return (
    <DeleteButton
      label='Delete'
      accessibleLabel={`Delete the figures for ${date}`}
      title={`Delete the figures for ${date}?`}
      description='The chart stops reaching back to that day.'
      onDelete={() => api.request(deleteNetWorthHistory, { params: { entryId } })}
    />
  )
}
