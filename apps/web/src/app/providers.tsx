'use client';

import { createQueryClient } from '@synapsedesk/api-client';
import { QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';

/** One `QueryClient` per tab, created once. */
export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
