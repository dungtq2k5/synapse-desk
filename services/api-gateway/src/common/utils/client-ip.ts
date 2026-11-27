import type { IncomingHttpHeaders } from 'node:http';
import type { Request } from 'express';
import type { Socket } from 'socket.io';

/**
 * The caller's IP, one rule for every reader: the HTTP throttle bucket, the
 * request origin (device sessions, the audit trail, IP lockout, the gRPC
 * caller metadata) and the socket handshake.
 *
 * The rightmost non-blank `X-Forwarded-For` entry, else the connection's
 * peer. Exactly one proxy hop is trusted (the Ingress, as `trust proxy` 1
 * says), and it appends the address it saw as the last entry; anything to
 * its left is whatever the client wrote.
 *
 * @example clientIp('198.51.100.7, 203.0.113.9', '10.0.0.5') // '203.0.113.9'
 */
export function clientIp(
  forwardedFor: IncomingHttpHeaders['x-forwarded-for'],
  peer: string | undefined,
): string {
  const hops = (
    Array.isArray(forwardedFor) ? forwardedFor.join(',') : (forwardedFor ?? '')
  ).split(',');
  for (let index = hops.length - 1; index >= 0; index--) {
    const hop = hops[index].trim();
    if (hop) return hop;
  }

  return peer ?? '';
}

/** {@link clientIp} for an HTTP request. */
export const requestIp = (request: Request): string =>
  clientIp(request.headers['x-forwarded-for'], request.socket.remoteAddress);

/**
 * {@link clientIp} for a socket handshake. `handshake.address` is the TCP peer
 * (socket.io reads neither `trust proxy` nor `X-Forwarded-For`), which behind
 * the Ingress is the Ingress for every user.
 */
export const socketIp = (client: Socket): string =>
  clientIp(
    client.handshake.headers['x-forwarded-for'],
    client.handshake.address,
  );
