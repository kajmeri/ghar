import { colors } from '@ghar/tokens'
import type { Metadata, Viewport } from 'next'
import { Public_Sans } from 'next/font/google'
import type { ReactNode } from 'react'
import { serviceWorkerVersion } from '@/lib/pwa/version'
import { ServiceWorker } from './_components/service-worker'
import './globals.css'

const publicSans = Public_Sans({
  subsets: ['latin'],
  variable: '--font-public-sans',
  display: 'swap',
})

export const metadata: Metadata = {
  title: { default: 'Ghar', template: '%s · Ghar' },
  applicationName: 'Ghar',
  robots: { index: false, follow: false },
  // "default" keeps dark status bar text on the light paper background. "black-translucent" would
  // turn it white, unreadable over a page that has no dark theme.
  appleWebApp: { capable: true, title: 'Ghar', statusBarStyle: 'default' },
  // Amounts and confirmation codes are not phone numbers.
  formatDetection: { telephone: false },
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: colors.paper,
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang='en' className={publicSans.variable}>
      <body className='bg-paper font-sans text-ink antialiased'>
        <ServiceWorker version={serviceWorkerVersion()} />
        {children}
      </body>
    </html>
  )
}
