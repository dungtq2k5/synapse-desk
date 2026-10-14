import type { Metadata } from 'next';
import { Inter, JetBrains_Mono, Roboto } from 'next/font/google';
import { headers } from 'next/headers';
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
// Google's sign-in button text, Roboto Medium, as its guidelines ask.
const google = Roboto({
  subsets: ['latin'],
  weight: '500',
  variable: '--font-family-google',
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
  const nonce = (await headers()).get('x-nonce') ?? undefined;

  return (
    // The theme script sets `class` before React hydrates.
    <html
      lang="en"
      className={`${sans.variable} ${mono.variable} ${google.variable}`}
      suppressHydrationWarning
    >
      <body className="bg-background text-foreground antialiased">
        <Providers nonce={nonce}>{children}</Providers>
        {/* What `announce()` says, for screen readers only. */}
        <div id="announcer-polite" className="sr-only" aria-live="polite" />
        <div
          id="announcer-assertive"
          className="sr-only"
          aria-live="assertive"
        />
      </body>
    </html>
  );
}
