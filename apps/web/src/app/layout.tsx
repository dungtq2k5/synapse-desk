import type { Metadata } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import { connection } from 'next/server';
import type { ReactNode } from 'react';
import { Providers } from './providers';
import '@/styles/globals.css';

// Self-hosted at build time. The variables are the design tokens' own names,
// so the font family the tokens declare is the one that loaded.
const sans = Inter({ subsets: ['latin'], variable: '--font-family-sans' });
const mono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-family-mono',
});

export const metadata: Metadata = {
  title: 'SynapseDesk',
  icons: { icon: '/favicon.svg' },
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Read per request, so every page renders per request: a page prerendered at
  // build time has no nonce on its scripts, and the policy would block them.
  await connection();

  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
