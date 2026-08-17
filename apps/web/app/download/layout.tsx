import type { Metadata } from 'next';
import { SITE_ORIGIN } from '../site';

export const metadata: Metadata = {
  alternates: {
    canonical: `${SITE_ORIGIN}/download`,
  },
  openGraph: {
    url: `${SITE_ORIGIN}/download`,
  },
};

export default function DownloadLayout({ children }: { children: React.ReactNode }) {
  return children;
}
