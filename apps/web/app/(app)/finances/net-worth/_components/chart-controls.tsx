import type { NetWorthRangeValue } from '@ghar/contracts'
import { SegmentedLinks } from '@/app/(app)/_components/ui/segmented-links'
import { netWorthHref, RANGE_OPTIONS, VIEW_OPTIONS, type NetWorthView } from '@/lib/networth/display'

export function ChartControls({ range, view }: { range: NetWorthRangeValue; view: NetWorthView }) {
  return (
    <div className='flex flex-wrap items-center justify-between gap-3'>
      <SegmentedLinks
        label='Chart view'
        options={VIEW_OPTIONS.map(option => ({
          key: option.value,
          label: option.label,
          href: netWorthHref({ range, view: option.value }),
          current: option.value === view,
        }))}
      />
      <SegmentedLinks
        label='Date range'
        options={RANGE_OPTIONS.map(option => ({
          key: option.value,
          label: option.label,
          name: option.name,
          href: netWorthHref({ range: option.value, view }),
          current: option.value === range,
        }))}
      />
    </div>
  )
}
