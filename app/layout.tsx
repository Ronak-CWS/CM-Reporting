import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  metadataBase: new URL('https://cm-catchment-9-reporting.lucky-grape-8310.chatgpt.site'),
  title: 'CM Reporting',
  description:
    'Daily operations and customer complaint reporting for Circular Materials Catchment 9.',
  icons: {
    icon: '/collective-waste-solutions.png',
  },
  openGraph: {
    title: 'CM Reporting',
    description:
      'Daily operations and customer complaint reporting for Circular Materials Catchment 9.',
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
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
