'use client'

import { Public_Sans } from 'next/font/google'
import { type BoundaryError, ErrorView } from './_components/error-view'
import './globals.css'

// The real 500 page. It replaces the root layout when that layout throws, so it brings its own
// document, styles and font, and relies on nothing a layout or provider sets up.

const publicSans = Public_Sans({
  subsets: ['latin'],
  variable: '--font-public-sans',
  display: 'swap',
})

export default function GlobalError({ error, retry }: { error: BoundaryError; retry: () => void }) {
  return (
    <html lang='en' className={publicSans.variable}>
      <body className='bg-paper font-sans text-ink antialiased'>
        <ErrorView
          layout='page'
          boundary='global'
          title='Ghar didn’t load'
          description='Something went wrong on our side. Try again, and if it keeps happening, check back in a few minutes.'
          error={error}
          retry={retry}
          link={{ href: '/', label: 'Go home', reload: true }}
        />
      </body>
    </html>
  )
}
