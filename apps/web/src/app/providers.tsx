'use client';

import { createQueryClient } from '@synapsedesk/api-client';
import { QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from 'next-themes';
import { useState, type ReactNode } from 'react';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

/**
 * One `QueryClient` per tab, created once; the theme (Light, Dark or System,
 * as the class `.dark` the tokens switch on); tooltips; toasts.
 *
 * `nonce` is this request's script nonce: the theme is applied by an inline
 * script before the page paints, and the policy runs only nonced scripts.
 */
export function Providers({
  children,
  nonce,
}: {
  children: ReactNode;
  nonce: string | undefined;
}) {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider
        attribute="class"
        defaultTheme="system"
        enableSystem
        disableTransitionOnChange
        nonce={nonce}
      >
        <TooltipProvider>
          {children}
          <Toaster />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
