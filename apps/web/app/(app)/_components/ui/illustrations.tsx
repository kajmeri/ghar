import type { ReactNode } from 'react'

/*
 * Spot illustrations for empty states. Line drawings in the interface's own monochrome, sized
 * 120 by 96, sitting on a soft ground shadow. Colors come from token utilities only.
 */

function Illustration({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      focusable='false'
      viewBox='0 0 120 96'
      strokeWidth={2}
      strokeLinecap='round'
      strokeLinejoin='round'
      className='h-24 w-30 fill-none stroke-ink-muted'
    >
      <ellipse cx='60' cy='86' rx='40' ry='4' className='fill-line/70 stroke-none' />
      {children}
    </svg>
  )
}

const DETAIL = 'stroke-ink-muted/40'
const DOT = 'fill-ink-muted stroke-none'

export function WalletIllustration() {
  return (
    <Illustration>
      <rect x='34' y='14' width='48' height='30' rx='4' transform='rotate(-8 58 29)' className='fill-paper' />
      <path d='M42 24h20' transform='rotate(-8 58 29)' className={DETAIL} />
      <rect x='22' y='30' width='76' height='52' rx='8' className='fill-surface' />
      <path d='M22 42h40' className={DETAIL} />
      <rect x='72' y='46' width='26' height='20' rx='6' className='fill-paper' />
      <circle cx='82' cy='56' r='3' className={DOT} />
    </Illustration>
  )
}

export function CalendarIllustration() {
  const days = [36, 50, 64, 78].flatMap(x => [48, 60, 72].map(y => ({ x, y })))
  return (
    <Illustration>
      <rect x='24' y='20' width='72' height='62' rx='8' className='fill-surface' />
      <path d='M24 36h72' />
      <path d='M42 14v12M78 14v12' />
      {days.map(({ x, y }) =>
        x === 64 && y === 60 ? (
          <rect key={`${x}-${y}`} x={x - 1} y={y - 1} width='8' height='8' rx='2' className={DOT} />
        ) : (
          <rect key={`${x}-${y}`} x={x} y={y} width='6' height='6' rx='1.5' className={DETAIL} />
        )
      )}
    </Illustration>
  )
}

export function SuitcaseIllustration() {
  return (
    <Illustration>
      <path d='M10 34C28 8 84 2 110 20' strokeDasharray='2 6' className={DETAIL} />
      <circle cx='110' cy='20' r='3' className={DOT} />
      <path d='M48 38v-8a4 4 0 0 1 4-4h16a4 4 0 0 1 4 4v8' />
      <rect x='26' y='38' width='68' height='44' rx='8' className='fill-surface' />
      <path d='M44 38v44M76 38v44' className={DETAIL} />
    </Illustration>
  )
}

export function DocumentIllustration() {
  return (
    <Illustration>
      <path d='M38 10h32l18 18v50a4 4 0 0 1-4 4H38a4 4 0 0 1-4-4V14a4 4 0 0 1 4-4Z' className='fill-surface' />
      <path d='M70 10v14a4 4 0 0 0 4 4h14' />
      <path d='M44 44h34M44 54h34M44 64h20' className={DETAIL} />
    </Illustration>
  )
}

export function HouseIllustration() {
  return (
    <Illustration>
      <path d='M34 44 60 21l26 23v34a4 4 0 0 1-4 4H38a4 4 0 0 1-4-4Z' className='fill-surface' />
      <path d='M26 50 60 20l34 30' />
      <path d='M52 82V64a4 4 0 0 1 4-4h8a4 4 0 0 1 4 4v18' className='fill-paper' />
      <rect x='40' y='50' width='8' height='8' rx='2' className={DETAIL} />
      <rect x='72' y='50' width='8' height='8' rx='2' className={DETAIL} />
    </Illustration>
  )
}

export function PeopleIllustration() {
  return (
    <Illustration>
      <path d='M58 82v-8a18 18 0 0 1 36 0v8Z' className='fill-paper' />
      <circle cx='76' cy='40' r='10' className='fill-paper' />
      <path d='M24 82v-8a22 22 0 0 1 44 0v8Z' className='fill-surface' />
      <circle cx='46' cy='36' r='12' className='fill-surface' />
      <circle cx='98' cy='22' r='10' strokeDasharray='3 4' className={DETAIL} />
      <path d='M98 18v8M94 22h8' />
    </Illustration>
  )
}

export function LockIllustration() {
  return (
    <Illustration>
      <path d='M44 44V32a16 16 0 0 1 32 0v12' />
      <rect x='32' y='44' width='56' height='38' rx='8' className='fill-surface' />
      <circle cx='60' cy='60' r='4' className={DOT} />
      <path d='M60 64v8' />
    </Illustration>
  )
}

export function ChecklistIllustration() {
  const rows = [
    { y: 36, done: true },
    { y: 50, done: true },
    { y: 64, done: false },
  ]
  return (
    <Illustration>
      <rect x='30' y='16' width='60' height='66' rx='8' className='fill-surface' />
      <rect x='46' y='10' width='28' height='12' rx='4' className='fill-paper' />
      {rows.map(({ y, done }) => (
        <g key={y}>
          <rect x='40' y={y} width='9' height='9' rx='2' className={done ? undefined : DETAIL} />
          {done ? <path d={`M42 ${y + 4.5}l2 2 3.5-4`} /> : null}
          <path d={`M56 ${y + 4.5}h${done ? 24 : 18}`} className={DETAIL} />
        </g>
      ))}
    </Illustration>
  )
}
