import { TooltipProvider } from '@shipcode/ui';
import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { homeDiscoveryMetadata, SITE_ORIGIN } from './site';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'ShipCode — Autonomous AI Coding Pipeline',
  description:
    'Desktop app + CLI for turning GitHub issues into reviewed pull requests with a real plan, review, execute, verify pipeline.',
  metadataBase: new URL(SITE_ORIGIN),
  alternates: homeDiscoveryMetadata.alternates,
  openGraph: {
    title: 'ShipCode — Autonomous AI Coding Pipeline',
    description: 'From issue queue to reviewed PR. Install from the ShipCode Homebrew tap.',
    url: homeDiscoveryMetadata.openGraph.url,
    siteName: 'ShipCode',
    type: 'website',
    images: [
      {
        url: '/og.png',
        width: 1200,
        height: 630,
        alt: 'ShipCode — From issue queue to reviewed PR',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ShipCode — Autonomous AI Coding Pipeline',
    description: 'From issue queue to reviewed PR. Install from the ShipCode Homebrew tap.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="bg-primary text-primary antialiased">
        <TooltipProvider delayDuration={400}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
