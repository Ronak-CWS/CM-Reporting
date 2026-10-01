import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'CM Reporting',
  description:
    'Daily operations and customer complaint reporting for C9 and Wood Buffalo.',
  icons: {
    icon: [{ url: '/collective-icon.png', type: 'image/png', sizes: '360x360' }],
    apple: '/collective-icon.png',
  },
  openGraph: {
    title: 'CM Reporting',
    description:
      'Daily operations and customer complaint reporting for C9 and Wood Buffalo.',
    type: 'website',
    url: '/',
    siteName: 'CM Reporting',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        {children}
      </body>
    </html>
  );
}
