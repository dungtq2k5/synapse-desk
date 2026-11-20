import { join } from 'node:path';
import type { NextConfig } from 'next';

/** Development only: one origin for the browser, proxied to the local gateway. */
const DEV_GATEWAY = 'http://localhost:3000';
const DEV_REALTIME = 'http://localhost:3001';

/**
 * The web's own security headers. The gateway's CSP is written for the one page
 * it serves (Swagger); this one is for the app. The script policy, which needs
 * Next's inline scripts, is set per request in `src/proxy.ts`.
 */
const SECURITY_HEADERS = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: permissionsPolicy() },
];

/**
 * Every powerful feature denied, except the one the app uses: writing to the
 * clipboard (the copy buttons, two-step setup's key). No
 * `Strict-Transport-Security` here: it belongs to whatever terminates TLS (the
 * Ingress), because only that knows the request came over HTTPS.
 */
function permissionsPolicy(): string {
  const denied = [
    'accelerometer',
    'autoplay',
    'camera',
    'display-capture',
    'encrypted-media',
    'fullscreen',
    'geolocation',
    'gyroscope',
    'hid',
    'idle-detection',
    'magnetometer',
    'microphone',
    'midi',
    'payment',
    'publickey-credentials-get',
    'screen-wake-lock',
    'serial',
    'usb',
    'xr-spatial-tracking',
  ];
  return [
    ...denied.map((feature) => `${feature}=()`),
    'clipboard-write=(self)',
  ].join(', ');
}

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The image's server: only the files it reaches, traced from the repository
  // root so the workspace packages it imports come along.
  output: 'standalone',
  outputFileTracingRoot: join(import.meta.dirname, '../..'),
  poweredByHeader: false,
  // `next dev` would otherwise write AGENTS.md into the app.
  agentRules: false,
  // Socket.IO's path ends in a slash (`/socket.io/`); Next's trailing-slash
  // redirect would answer it with a 308 before the rewrite to the gateway.
  skipTrailingSlashRedirect: true,
  // The commit the browser reports its errors under (`client-errors.ts`).
  env: { NEXT_PUBLIC_BUILD_ID: process.env.GIT_SHA ?? 'local' },
  rewrites: () =>
    Promise.resolve(
      process.env.NODE_ENV !== 'development'
        ? []
        : [
            { source: '/api/:path*', destination: `${DEV_GATEWAY}/api/:path*` },
            { source: '/graphql', destination: `${DEV_GATEWAY}/graphql` },
            // Kept exact: `:path*` would rewrite `/socket.io/` to `/socket.io`.
            {
              source: '/socket.io/',
              destination: `${DEV_REALTIME}/socket.io/`,
            },
            {
              source: '/socket.io/:path*',
              destination: `${DEV_REALTIME}/socket.io/:path*`,
            },
          ],
    ),
  // A coverage build only (`WEB_COVERAGE=1`): source maps for the browser's
  // chunks and the server's, so the e2e suite's V8 coverage maps back to the
  // sources. The image is built without it.
  ...(process.env.WEB_COVERAGE === '1'
    ? {
        productionBrowserSourceMaps: true,
        experimental: { serverSourceMaps: true },
      }
    : {}),
  headers: () =>
    Promise.resolve([{ source: '/:path*', headers: SECURITY_HEADERS }]),
};

export default nextConfig;
