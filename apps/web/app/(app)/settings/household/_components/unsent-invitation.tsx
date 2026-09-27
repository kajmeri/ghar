import { TriangleAlert } from 'lucide-react'
import { CopyField } from '@/app/_components/copy-field'

/** Shown when an invitation was made but its email didn't go out: the link, to send by hand. */
export function UnsentInvitation({ message, link }: { message: string; link: string }) {
  return (
    <div className='flex w-full flex-col gap-3'>
      <p role='alert' className='flex items-start gap-1.5 text-sm text-ink'>
        <TriangleAlert aria-hidden className='mt-0.5 size-4 shrink-0 text-caution-ink' />
        <span className='min-w-0'>{message}</span>
      </p>
      <CopyField value={link} label='Invitation link' variant='outline' />
    </div>
  )
}
