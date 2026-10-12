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
];

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
  headers: () =>
    Promise.resolve([{ source: '/:path*', headers: SECURITY_HEADERS }]),
};

export default nextConfig;
