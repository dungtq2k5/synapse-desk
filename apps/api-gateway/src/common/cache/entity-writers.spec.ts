import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('§31 C5 the entity cache rests on who writes these fields', () => {
  const users = () => readFileSync(USERS_SERVICE, 'utf8');

  /**
   * Who writes a cached entity's fields — 31-doc C5.
   *
   * **28-doc §3.1 rests on a claim that is true today and time-sensitive:** every
   * writer of `fullName` or `avatarUrl` is a gateway mutation, so
   * `@InvalidateCache` is precise invalidation for the entity cache rather than a
   * fallback, and a `user.*` NATS contract would have no publisher.
   *
   * A FIFTH writer — an SCIM sync, a directory import, an admin tool talking to
   * auth-service directly — makes the entity cache stale with nothing to evict
   * it, for `ENTITY_TTL_SECONDS` at a time, silently.
   *
   * `cacheable.spec.ts` checks the opposite direction: a cached scope with no
   * evictor. This is the harder one — *does anything write these columns without
   * evicting?* — and it is answered by pinning the write sites, so a new one
   * fails here and asks the question rather than shipping.
   *
   * **It reads auth-service from the gateway's suite deliberately.** The claim
   * spans the two, and a test living only beside the cache would never see the
   * writer that breaks it.
   */
  const USERS_SERVICE = join(
    __dirname,
    '../../../../auth-service/src/modules/users/users.service.ts',
  );

  const DEPARTMENTS_SERVICE = join(
    __dirname,
    '../../../../auth-service/src/modules/departments/departments.service.ts',
  );

  /** The index just past the `{` at `open`, brace-matched to its close. */
  const matchBrace = (code: string, open: number): number => {
    let depth = 0;

    for (let index = open; index < code.length; index++) {
      if (code[index] === '{') depth++;
      else if (code[index] === '}' && --depth === 0) return index;
    }

    return code.length;
  };

  /**
   * Every `data: { … }` that is the payload of a Prisma WRITE.
   *
   * **Anchored to the call verb, and it took three attempts to get here** — each
   * failure inflating the number this file exists to pin, and an inflated count
   * still looks plausible:
   *
   *   1. `data:` anywhere counted `data: { fullName, headline }` — the payload of
   *      a SECURITY_ALERT **email**.
   *   2. A character window from the call counted `select: { id, name }`, which
   *      is the opposite of a write.
   *   3. This: find `.create(` / `.update(` / `.updateMany(` / `.upsert(`,
   *      brace-match its argument object, and read only the `data:` literal
   *      inside it. `mailer.send({ data: … })` is excluded by the verb;
   *      `select:` and `where:` by not being `data:`.
   */
  const prismaWrites = (code: string): string[] => {
    const out: string[] = [];

    for (const call of code.matchAll(
      /\.(?:create|update|updateMany|upsert)\(\s*\{/g,
    )) {
      // `matchAll` types `index` as optional even though a non-sticky regex
      // always sets it. SKIPPED rather than asserted: a missing index makes
      // `argsOpen` NaN, and `slice(NaN)` quietly returns the whole file —
      // which this scanner would then count writes across, inflating the
      // very number the C5 claim rests on.
      if (call.index === undefined) continue;

      const argsOpen = call.index + call[0].length - 1;
      const args = code.slice(argsOpen, matchBrace(code, argsOpen) + 1);
      const data = /\bdata:\s*\{/.exec(args);

      if (!data) continue;

      const dataOpen = data.index + data[0].length - 1;

      out.push(args.slice(dataOpen, matchBrace(args, dataOpen) + 1));
    }

    return out;
  };

  /**
   * Writes to a column, counted.
   *
   * Two shapes, because Prisma updates are written both ways here: a `data: { … }`
   * literal, and a `Prisma.UserUpdateInput` built up field by field before the
   * call.
   */
  const writesTo = (source: string, field: string): number => {
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      // `metadata: { after: { avatarUrl } }` is an AUDIT payload, not a write.
      .replace(/metadata:\s*\{[\s\S]*?\},/g, '');

    const named = new RegExp(String.raw`\b${field}\b`);

    return (
      prismaWrites(code).filter((literal) => named.test(literal)).length +
      [...code.matchAll(new RegExp(String.raw`\bdata\.${field}\s*=`, 'g'))]
        .length
    );
  };

  it('the scan finds the service at all', () => {
    // Guards the guard: a moved file makes every count below zero, which reads
    // as "nothing writes these fields" — the most reassuring possible failure.
    expect(users()).toContain('listUsersByIds');
    expect(readFileSync(DEPARTMENTS_SERVICE, 'utf8')).toContain('tenantScope');
  });

  it('**`fullName` is written in exactly the two places behind gateway mutations**', () => {
    // `createUser` (a CREATE — nothing is cached yet) and `updateUser` /
    // `updateOwnProfile`'s shared `data.fullName` assignment. Both are reached
    // only through routes carrying `@InvalidateCache(users, entity:user:…)`.
    expect(writesTo(users(), 'fullName')).toBe(2);
  });

  it('**and `avatarUrl` in exactly the two avatar handlers**', () => {
    // `confirmAvatarUpload` sets the path; `deleteAvatar` nulls it.
    expect(writesTo(users(), 'avatarUrl')).toBe(2);
  });

  it('**a department name is written only by create and update**', () => {
    expect(writesTo(readFileSync(DEPARTMENTS_SERVICE, 'utf8'), 'name')).toBe(2);
  });

  it('and the counter can actually see a write, and only a write', () => {
    // The assertions above are worth their line count only if the matcher
    // works, and each negative here is a shape that fooled an earlier version.
    expect(
      writesTo('await x.update({ data: { fullName: v } })', 'fullName'),
    ).toBe(1);
    expect(writesTo('data.fullName = v.trim();', 'fullName')).toBe(1);

    // An email payload — same key, not a write.
    expect(
      writesTo('this.mail.send({ to: a, data: { fullName: b } });', 'fullName'),
    ).toBe(0);
    // A projection — the opposite of a write.
    expect(
      writesTo(
        'await x.update({ where: { id }, select: { name: true } });',
        'name',
      ),
    ).toBe(0);
    // An audit payload.
    expect(
      writesTo('metadata: { after: { avatarUrl: p } },', 'avatarUrl'),
    ).toBe(0);
  });
});
