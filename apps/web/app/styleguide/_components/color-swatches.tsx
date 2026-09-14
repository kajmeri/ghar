import { colorTokens } from '@ghar/tokens'

export function ColorSwatches() {
  return (
    <ul className='grid grid-cols-2 gap-3 sm:grid-cols-4'>
      {colorTokens.map(token => (
        <li key={token.name} className='overflow-hidden rounded-card border border-line bg-surface'>
          <div className='h-20 border-b border-line' style={{ backgroundColor: `var(${token.cssVariable})` }} />
          <div className='p-3'>
            <p className='text-sm font-medium'>{token.cssVariable}</p>
            <p className='text-xs text-ink-muted'>{token.value}</p>
            <p className='mt-1 text-xs text-ink-muted'>{token.description}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}
