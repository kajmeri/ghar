import { cva, type VariantProps } from 'class-variance-authority'
import { Slot } from 'radix-ui'
import type * as React from 'react'

import { cn } from '@/lib/utils'

/**
 * shadcn/ui button, restyled for Ghar: ink primary, hairline outline, 8px radius, 44px tall.
 * There are no small sizes because nothing tappable may be under 44px, and no shadows.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-control text-base font-medium whitespace-nowrap transition-colors outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-paper disabled:pointer-events-none disabled:opacity-40 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-5",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/85 active:bg-primary/75',
        outline: 'border border-border bg-surface text-ink hover:bg-paper active:bg-ink/10',
        // A tint of ink, so the hover shows on paper and on a card alike.
        ghost: 'text-ink hover:bg-ink/5 active:bg-ink/10',
        // Only for actions that destroy something. Neutral actions stay monochrome.
        destructive: 'bg-destructive text-surface hover:bg-destructive/85 active:bg-destructive/75',
        link: 'text-ink underline underline-offset-4 hover:text-ink-muted active:text-ink-muted',
      },
      size: {
        default: 'h-tap px-5 has-[>svg]:px-4',
        icon: 'size-tap',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
)

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : 'button'

  return (
    <Comp
      data-slot='button'
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
