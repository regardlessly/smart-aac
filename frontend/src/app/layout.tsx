import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Smart AAC Dashboard | CaritaHub',
  description: 'Satellite Centre Management Dashboard',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  )
}
