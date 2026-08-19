import type { Metadata } from 'next';
import { discoveryMetadata } from '../site';

export const metadata: Metadata = discoveryMetadata('/download');

export default function DownloadLayout({ children }: { children: React.ReactNode }) {
  return children;
}
