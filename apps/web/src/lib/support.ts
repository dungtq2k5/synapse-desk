'use client';

import { createContext, useContext } from 'react';

/**
 * The support address, from the web server's `SUPPORT_EMAIL` setting: shown
 * as a mail link wherever the deck says "Contact support". Read per request
 * and handed down by the signed-in layout, so one image serves every
 * environment.
 */
export const SupportEmailContext = createContext<string>('');

/** The support address, or '' when the setting is unset. */
export function useSupportEmail(): string {
  return useContext(SupportEmailContext);
}
