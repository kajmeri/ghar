/** What went wrong, in a sentence, where the person was looking when it happened. */
export function FormError({ children }: { children: string | null }) {
  if (!children) return null
  return (
    <p role='alert' className='text-sm text-negative'>
      {children}
    </p>
  )
}
