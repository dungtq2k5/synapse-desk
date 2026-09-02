import {
  addressIsDenied,
  deniedLiteral,
  privateTargetsAllowed,
} from './webhook-target.guard';

/**
 * The deny decision, address by address — no DNS, no network.
 *
 * The guard's whole reason for exporting `addressIsDenied` is that its
 * property is decidable without depending on what any hostname resolves to on
 * the machine running the suite. This is that decision.
 *
 * **The tables are driven by BYTE-VALUE equivalence classes, not by
 * spellings** — every way of writing the same sixteen bytes must answer the
 * same, because the two producers disagree on notation: `getaddrinfo` prints
 * embedded IPv4 dotted (`::127.0.0.1`) while the WHATWG URL parser prints
 * pure hex (`::7f00:1`). Two loopback spellings slipped a notation-by-
 * notation list; this axis is the one both misses fell on.
 */
describe('webhook target guard', () => {
  it('**refuses every private, loopback and link-local range**', () => {
    for (const address of [
      '0.0.0.0',
      '10.1.2.3',
      '127.0.0.1',
      '169.254.169.254', // the cloud metadata endpoint
      '172.16.5.5',
      '192.168.1.1',
      '100.100.0.1', // CGNAT
      'fd00::1', // fc00::/7
      'fe80::1', // link-local
    ]) {
      expect([address, addressIsDenied(address)]).toEqual([address, true]);
    }
  });

  it('**refuses loopback in EVERY spelling the two producers emit**', () => {
    // One address — sixteen bytes ending 0x7f000001 — through every prefix
    // that embeds an IPv4 address, in both the resolver's dotted notation and
    // the URL parser's hex. The class, not the string, is what is denied.
    for (const address of [
      '::ffff:127.0.0.1', // mapped, dotted (resolver)
      '::ffff:7f00:1', // mapped, hex (URL parser)
      '0:0:0:0:0:ffff:7f00:1', // mapped, uncompressed — no producer emits it;
      // the numeric parse refuses it structurally rather than by argument
      '::127.0.0.1', // deprecated "compatible", dotted (resolver)
      '::7f00:1', // compatible, hex — what `new URL('https://[::127.0.0.1]/')`
      // actually produces, the spelling a dotted-only pattern missed
      '64:ff9b::127.0.0.1', // NAT64 well-known prefix, dotted
      '64:ff9b::7f00:1', // NAT64, hex — open under the notation list
    ]) {
      expect([address, addressIsDenied(address)]).toEqual([address, true]);
    }
  });

  it('**refuses the unspecified and loopback v6 addresses with no special case**', () => {
    // `::` and `::1` need no arm of their own: all of `::/96` sits outside
    // `2000::/3`, so the inversion denies the whole deprecated "compatible"
    // block wholesale. `::2` rides along — allowed under the old string list,
    // denied here.
    for (const address of ['::', '::1', '::2']) {
      expect([address, addressIsDenied(address)]).toEqual([address, true]);
    }
  });

  it('**denies IPv6 outside global unicast `2000::/3`** — the inversion', () => {
    // An allow-list over a space with this many notations cannot be defeated
    // by one nobody wrote down; anything not recognisably public is refused.
    for (const address of ['4000::1', 'ff02::1', '100::1']) {
      expect([address, addressIsDenied(address)]).toEqual([address, true]);
    }
  });

  it('**allows public addresses** — the control, per class', () => {
    // Without these, a guard that refused everything would pass every test
    // above and refuse every legitimate receiver in silence. One control per
    // arm: plain v4, plain v6 global unicast, and the embedded-v4 prefixes
    // carrying a PUBLIC address — NAT64 especially, since in a DNS64 pod
    // every v4-only receiver resolves through it.
    for (const address of [
      '203.0.113.7',
      '8.8.8.8',
      '2606:4700::1111',
      '2001:4860:4860::8888',
      '::ffff:8.8.8.8', // mapped-public
      '64:ff9b::8.8.8.8', // NAT64 to a public v4
      '2001:db8::1', // documentation range: inside 2000::/3, never routed —
      // admitted deliberately, it connects nowhere
    ]) {
      expect([address, addressIsDenied(address)]).toEqual([address, false]);
    }
  });

  it('refuses a non-address outright — fail-closed, not decoded', () => {
    // `0177.0.0.1` is octal loopback to inet_aton but NOT an IP to `isIP`
    // (which is 0 for it) — it is refused for being unrecognizable, not for
    // being loopback. Where octal spelling actually matters is the URL path,
    // and there `new URL()` canonicalizes it to dotted decimal before any
    // check runs — pinned in `deniedLiteral`'s tests below.
    for (const address of ['not-an-ip', '0177.0.0.1', 'fe80::1%eth0']) {
      expect([address, addressIsDenied(address)]).toEqual([address, true]);
    }
  });

  describe('deniedLiteral — the host that never reaches a resolver', () => {
    it('**judges an IP-literal hostname, brackets stripped**', () => {
      // `new URL(...).hostname` keeps IPv6 brackets — `"[::1]"` — under which
      // `isIP` sees no address at all. The strip is load-bearing: without it
      // the check silently covers IPv4 only.
      expect(deniedLiteral('127.0.0.1')).toBe('127.0.0.1');
      expect(deniedLiteral('169.254.169.254')).toBe('169.254.169.254');
      expect(deniedLiteral('[::1]')).toBe('::1');
      expect(deniedLiteral('[::ffff:7f00:1]')).toBe('::ffff:7f00:1');
      expect(deniedLiteral('[::7f00:1]')).toBe('::7f00:1');
    });

    it('**passes hostnames and public literals through** — the control', () => {
      // A hostname is not this check's business — it reaches the guarded
      // `lookup`, which is the control for everything that resolves.
      expect(deniedLiteral('hooks.example.com')).toBeNull();
      expect(deniedLiteral('localhost')).toBeNull();
      expect(deniedLiteral('8.8.8.8')).toBeNull();
      expect(deniedLiteral('[2606:4700::1111]')).toBeNull();
    });

    it('**the URL parser canonicalises spelling games before the check**', () => {
      // Octal and single-integer IPv4 forms never reach `deniedLiteral` as
      // written: `new URL()` canonicalizes them first, which is exactly why
      // the check must take the PARSED hostname and never the raw string.
      expect(new URL('https://0177.0.0.1/').hostname).toBe('127.0.0.1');
      expect(new URL('https://2130706433/').hostname).toBe('127.0.0.1');
      expect(new URL('https://[::127.0.0.1]/').hostname).toBe('[::7f00:1]');

      for (const url of [
        'https://0177.0.0.1/',
        'https://2130706433/',
        'https://[::127.0.0.1]/',
      ]) {
        expect([url, deniedLiteral(new URL(url).hostname)]).not.toEqual([
          url,
          null,
        ]);
      }
    });
  });

  it('**the escape hatch needs BOTH halves, and honours development only**', () => {
    // Off by default, and — the load-bearing half — ignored outside
    // development no matter what the variable says, so a copied .env cannot
    // carry it into production.
    expect(privateTargetsAllowed({})).toBe(false);
    expect(
      privateTargetsAllowed({ WEBHOOK_ALLOW_PRIVATE_TARGETS: 'true' }),
    ).toBe(false);
    expect(
      privateTargetsAllowed({
        NODE_ENV: 'production',
        WEBHOOK_ALLOW_PRIVATE_TARGETS: 'true',
      }),
    ).toBe(false);
    expect(
      privateTargetsAllowed({
        NODE_ENV: 'development',
        WEBHOOK_ALLOW_PRIVATE_TARGETS: 'true',
      }),
    ).toBe(true);
  });
});
