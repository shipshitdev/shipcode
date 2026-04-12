import type { Metadata } from 'next';
import { getPageMap } from 'nextra/page-map';
import { Layout } from 'nextra-theme-docs';
import 'nextra-theme-docs/style.css';
import './globals.scss';

import themeConfig from '../theme.config';

export const metadata: Metadata = {
  title: {
    default: 'ShipCode Docs',
    template: '%s | ShipCode Docs',
  },
  description: 'Documentation for ShipCode, the autonomous AI coding pipeline.',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const pageMap = await getPageMap();

  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Layout {...themeConfig} pageMap={pageMap}>
          {children}
        </Layout>
      </body>
    </html>
  );
}
