import { NextResponse, type NextRequest } from 'next/server';
import {
  firebaseOrigins,
  firebaseWebConfig,
  storageOrigin,
} from '@/lib/firebase-config';

/**
 * The Content-Security-Policy, with a fresh script nonce per request.
 *
 * The App Router writes three inline scripts into every page (Turbopack's chunk
 * loader and the server-component payload), so `script-src 'self'` alone would
 * block the app. Next reads the nonce from this request's policy and puts it on
 * its own scripts; `'strict-dynamic'` lets those load their chunks.
 *
 * **No authentication here**, not even "no cookie, so redirect": the gateway's
 * 401 is the only answer to "is this person signed in".
 */
export function proxy(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const policy = contentSecurityPolicy(
    nonce,
    process.env.NODE_ENV === 'development',
    firebaseOrigins(firebaseWebConfig()),
    storageOrigin(),
  );

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

/**
 * The policy for one nonce. Development adds what the dev server needs: eval
 * for React's refresh, and its own WebSocket for hot reload. `firebase` is
 * where Google sign-in talks to and the frame it opens (none when it isn't
 * configured); `storage` is where a photo is uploaded to and read from.
 *
 * @example contentSecurityPolicy('abc', false) // "default-src 'self'; script-src 'self' 'nonce-abc' …"
 */
export function contentSecurityPolicy(
  nonce: string,
  development: boolean,
  firebase: { connect: string[]; frame: string[] } = {
    connect: [],
    frame: [],
  },
  storage?: string,
): string {
  const media = storage ? [storage] : [];
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ''}`,
    // Component libraries position popovers with style attributes.
    "style-src 'self' 'unsafe-inline'",
    ["img-src 'self' data: blob:", ...media].join(' '),
    "font-src 'self'",
    [
      "connect-src 'self'",
      ...firebase.connect,
      ...media,
      ...(development ? ['ws:'] : []),
    ].join(' '),
    ["frame-src 'self'", ...firebase.frame].join(' '),
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join('; ');
}

export const config = {
  // Pages only: static files, images, the API and the socket don't need a
  // page's policy.
  matcher: [
    {
      source:
        '/((?!api|graphql|socket.io|_next/static|_next/image|favicon.svg|.*\\.svg$).*)',
      missing: [{ type: 'header', key: 'next-router-prefetch' }],
    },
  ],
};
