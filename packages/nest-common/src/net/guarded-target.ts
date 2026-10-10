/**
 * @file The SSRF control — at connection time, on resolved addresses.
 *
 * A URL somebody else chose, that a server here connects to, is textbook SSRF:
 * into the service mesh, into `169.254.169.254`, into anything the pod can
 * route to. Two paths do that — notification-service POSTs to a tenant's
 * webhook URL, and storage-service fetches an inbound attachment from the URL
 * Resend hands over — and both use THIS file, so the address arithmetic exists
 * once.
 *
 * **Validation when a URL is saved or received is not the control.** A URL is
 * RESOLVED when it is connected to, and DNS can change in between. So the check runs at send time, in two prongs that between them
 * cover every way a host becomes an address:
 *
 * - a HOSTNAME is judged inside the socket's own `lookup`
 *   ({@link buildGuardedLookup}), which also removes the rebinding window —
 *   the address that was checked is the address the socket connects to,
 *   because there is no second resolution;
 * - an IP LITERAL is judged by {@link deniedLiteral} before the request is
 *   built, because Node never invokes `lookup` for a literal — the socket
 *   connects straight to it, and a control that lives only in the resolver
 *   guards a path literals never take.
 */

import { lookup as dnsLookup } from 'node:dns';
import { isIP } from 'node:net';

/**
 * What `https.request` hands its `lookup` option.
 *
 * Two shapes, and honouring the caller's is load-bearing: Node's
 * happy-eyeballs path (`autoSelectFamily`, default ON since v20) invokes the
 * lookup with `all: true` and expects an ARRAY back — answering with the
 * scalar form there produced `Invalid IP address: undefined` on every send,
 * from inside the socket, one frame away from anything named in this file.
 */
export type LookupCallback = (
  error: NodeJS.ErrnoException | null,
  address: string | { address: string; family: number }[],
  family?: number,
) => void;

/**
 * Every range this service must never connect to.
 *
 * Not just RFC1918: loopback, link-local (`169.254.0.0/16` is the cloud
 * metadata endpoint), the IPv6 equivalents — and every IPv6 form that EMBEDS
 * an IPv4 address (mapped, compatible, NAT64), which is why v6 is parsed to
 * bytes and classified numerically rather than string-matched: the same
 * sixteen bytes have more spellings than any list of them stays ahead of.
 */
const DENIED_V4: readonly { base: number; maskBits: number }[] = [
  cidr('0.0.0.0', 8), // "this network"
  cidr('10.0.0.0', 8),
  cidr('100.64.0.0', 10), // CGNAT — cloud-internal in practice
  cidr('127.0.0.0', 8),
  cidr('169.254.0.0', 16),
  cidr('172.16.0.0', 12),
  cidr('192.168.0.0', 16),
];

function cidr(
  base: string,
  maskBits: number,
): { base: number; maskBits: number } {
  return { base: v4ToInt(base), maskBits };
}

function v4ToInt(address: string): number {
  return address
    .split('.')
    .reduce((total, octet) => total * 256 + Number(octet), 0);
}

function v4Denied(address: string): boolean {
  return v4IntDenied(v4ToInt(address));
}

function v4IntDenied(value: number): boolean {
  return DENIED_V4.some(({ base, maskBits }) => {
    const mask = maskBits === 0 ? 0 : (-1 << (32 - maskBits)) >>> 0;
    return (value & mask) >>> 0 === (base & mask) >>> 0;
  });
}

/**
 * An IPv6 address as its eight 16-bit groups — or `null` for text this parser
 * does not recognise, which the caller treats as denied.
 *
 * The reason this exists instead of string patterns: the same sixteen bytes
 * can be spelled compressed (`::7f00:1`), uncompressed
 * (`0:0:0:0:0:0:7f00:1`), or with a dotted tail (`::127.0.0.1`) — and the
 * two producers disagree, `getaddrinfo` printing embedded IPv4 dotted while
 * the WHATWG URL parser prints pure hex. A prefix check over the numbers is
 * true in every spelling at once.
 */
function v6Hextets(address: string): number[] | null {
  let body = address;

  // Fold a trailing dotted quad (`::ffff:127.0.0.1`) into its two hextets so
  // the rest of the parser sees one notation.
  const dotted = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(body);
  if (dotted) {
    const value = v4ToInt(dotted[1]);
    body =
      body.slice(0, -dotted[1].length) +
      `${((value >>> 16) & 0xffff).toString(16)}:${(value & 0xffff).toString(16)}`;
  }

  const halves = body.split('::');
  if (halves.length > 2) return null;

  const left = halves[0] === '' ? [] : halves[0].split(':');
  const right =
    halves.length === 2 && halves[1] !== '' ? halves[1].split(':') : [];
  const groups =
    halves.length === 2
      ? [
          ...left,
          ...new Array<string>(8 - left.length - right.length).fill('0'),
          ...right,
        ]
      : left;

  if (groups.length !== 8) return null;

  const hextets = groups.map((group) => Number.parseInt(group, 16));

  return hextets.some((value) => Number.isNaN(value) || value > 0xffff)
    ? null
    : hextets;
}

/**
 * Whether one resolved address is private, loopback, link-local or otherwise
 * ours.
 *
 * Exported for the guard's own spec: the property has to be testable address
 * by address, without depending on what any hostname resolves to on the
 * machine running the suite.
 */
export function addressIsDenied(address: string): boolean {
  const family = isIP(address);

  if (family === 4) return v4Denied(address);
  if (family !== 6) return true; // not an IP at all — refuse

  const hextets = v6Hextets(address.toLowerCase());
  if (!hextets) return true; // unparseable — refuse, never guess

  const low32 = hextets[6] * 0x1_00_00 + hextets[7];

  // **The two IPv6 prefixes that EMBED an IPv4 address a resolver can
  // legitimately hand out are IPv4 questions** — the answer is the embedded
  // address's:
  //
  // - `::ffff:0:0/96` (mapped) in any spelling, dotted, hex or uncompressed;
  // - `64:ff9b::/96` (NAT64) — in a DNS64 pod EVERY v4-only receiver resolves
  //   through this prefix, so it is judged by its embedded address rather than
  //   allowed or denied wholesale.
  //
  // The deprecated "compatible" `::/96` (`::127.0.0.1`, hex `::7f00:1`, and
  // `::`/`::1` with it) needs NO arm of its own: everything in it falls to the
  // inversion below, and the only distinct behaviour an arm could add —
  // allowing a compatible-PUBLIC form — is one nothing legitimate emits.
  // Sabotage-measured: with such an arm removed, every denial test still
  // passed, so it never existed.
  if (
    hextets.slice(0, 5).every((value) => value === 0) &&
    hextets[5] === 0xffff
  ) {
    return v4IntDenied(low32);
  }
  if (
    hextets[0] === 0x64 &&
    hextets[1] === 0xff9b &&
    hextets.slice(2, 6).every((value) => value === 0)
  ) {
    return v4IntDenied(low32);
  }

  if ((hextets[0] & 0xffc0) === 0xfe80) return true; // link-local fe80::/10
  if ((hextets[0] & 0xfe00) === 0xfc00) return true; // ULA fc00::/7

  // **The inversion — allow only global unicast `2000::/3`, deny the rest.**
  // Two loopback spellings slipped through the previous deny-list shape, and
  // an allow-list over a space with this many notations cannot be defeated by
  // one nobody wrote down. This is also what denies `::/96` wholesale —
  // loopback and unspecified included. What this admits from 2000::/3 that is
  // not routable (2001:db8::/32, the documentation range) connects nowhere.
  return (hextets[0] & 0xe000) !== 0x2000;
}

/**
 * The IP-literal check — for hosts that never reach a resolver.
 *
 * **Node does not call `lookup` when the host is already an IP literal** — it
 * skips resolution and connects — so for a literal the guarded lookup is dead
 * code and this is the control. Measured: `https.request` to `127.0.0.1` with
 * a lookup attached connected without invoking it.
 *
 * Takes the hostname as `new URL()` produced it and NEVER the raw string:
 * the parser strips the spelling games first (`0177.0.0.1` and `2130706433`
 * both canonicalize to `127.0.0.1`, `[::127.0.0.1]` to `[::7f00:1]`), so what
 * arrives here is a canonical literal `addressIsDenied` can judge. The
 * brackets are the trap — `new URL('https://[::1]/').hostname` is `"[::1]"`
 * WITH brackets, under which `isIP` sees no address at all — so they are
 * stripped here, once, rather than at every caller.
 */
export function deniedLiteral(urlHostname: string): string | null {
  const literal = urlHostname.replace(/^\[|\]$/g, '');

  return isIP(literal) !== 0 && addressIsDenied(literal) ? literal : null;
}

/**
 * The development escape hatch — explicit, named, off by default.
 *
 * A localhost server is exactly what a developer testing an integration wants
 * and exactly what the deny list refuses. Gated on BOTH the flag and the
 * environment so a production deployment cannot inherit it from a copied
 * `.env`: outside development the flag is ignored, not honoured.
 *
 * The flag is the caller's own variable, read by the caller —
 * `WEBHOOK_ALLOW_PRIVATE_TARGETS` in notification-service,
 * `INGEST_ALLOW_PRIVATE_SOURCES` in storage-service — so each service's hatch
 * opens only its own path.
 *
 * @example privateTargetsAllowed({ NODE_ENV: 'development', flag: 'true' }) // true
 */
export function privateTargetsAllowed(env: {
  NODE_ENV?: string;
  flag?: string;
}): boolean {
  return env.NODE_ENV === 'development' && env.flag === 'true';
}

/** The refusal a caller records — names the address, never echoes a body. */
export class DeniedTargetError extends Error {
  constructor(hostname: string, address: string) {
    super(
      `Refusing to connect to ${hostname}: it resolves to ${address}, which is not a public address`,
    );
  }
}

/**
 * A `lookup` for `https.request` that resolves, checks EVERY address, and pins.
 *
 * - **every** address, because a multi-A answer only needs one private member
 *   to be an attack — `all: true`, then the whole list is checked;
 * - **pins**, structurally: the address handed back here is the one the socket
 *   connects to, and no second resolution ever happens;
 * - and it is the resolver seam — a spec injects `resolve` and never touches
 *   DNS.
 */
export function buildGuardedLookup(options: {
  allowPrivate: boolean;
  resolve?: typeof dnsLookup;
}): (
  hostname: string,
  lookupOptions: unknown,
  callback: LookupCallback,
) => void {
  const resolve = options.resolve ?? dnsLookup;

  return (hostname, lookupOptions, callback) => {
    resolve(hostname, { all: true }, (error, addresses) => {
      if (error) {
        callback(error, '', 0);
        return;
      }

      const list = Array.isArray(addresses) ? addresses : [];

      if (list.length === 0) {
        callback(
          Object.assign(new Error(`${hostname} resolved to no addresses`), {
            code: 'ENOTFOUND',
          }),
          '',
          0,
        );
        return;
      }

      if (!options.allowPrivate) {
        const denied = list.find((entry) => addressIsDenied(entry.address));

        if (denied) {
          callback(new DeniedTargetError(hostname, denied.address), '', 0);
          return;
        }
      }

      // **Every address handed back has been checked**, whichever shape the
      // caller asked for — the pin is that the socket can only connect to a
      // member of this list, and no second resolution happens.
      if ((lookupOptions as { all?: boolean } | undefined)?.all) {
        callback(
          null,
          list.map((entry) => ({
            address: entry.address,
            family: entry.family,
          })),
        );
        return;
      }

      callback(null, list[0].address, list[0].family);
    });
  };
}
