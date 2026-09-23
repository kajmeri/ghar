import { cn } from '@/lib/utils'

/** The arch from the Ghar logo, drawn in the current text color. The doorway is a cutout, so it sits on any background. */
export function GharMark({ className }: { className?: string }) {
  return (
    <svg aria-hidden viewBox='136 88 240 328' className={cn('h-6 w-auto shrink-0', className)}>
      <path
        fill='currentColor'
        fillRule='evenodd'
        d='M136 416 L136 300 C136 232 178 190 208 162 C222 149 230 126 256 88 C282 126 290 149 304 162 C334 190 376 232 376 300 L376 416 Z M196 416 L196 312 C196 272 222 244 256 196 C290 244 316 272 316 312 L316 416 Z'
      />
    </svg>
  )
}
