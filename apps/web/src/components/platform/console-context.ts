'use client';

import { createContext, use } from 'react';

/** True inside the platform console: the header and menu dress for it. */
export const ConsoleContext = createContext(false);

export function useInConsole(): boolean {
  return use(ConsoleContext);
}
