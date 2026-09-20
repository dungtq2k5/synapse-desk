import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../testing/strip-comments';

/**
 * Every transport-class gRPC error a service throws is a DECISION: either the
 * text is written for a user and marked, or it is internal and named here.
 *
 * The gateway sends a fixed message for an unmarked `UNAVAILABLE`,
 * `DEADLINE_EXCEEDED` or `CANCELLED` — grpc-js generates those itself, with the
 * peer's address in the details, and nothing on the error object tells them
 * apart from a service's own. So a service that means its text for the user
 * vouches for it with `withHttpStatus(…)`, and an unmarked one reaches the
 * user as the generic message.
 *
 * **Scanned from the code toward this list**, so a new throw site cannot land
 * without someone deciding which it is: marked, or added below with a reason.
 */
describe('transport-class gRPC errors are marked or named', () => {
  const REPO_ROOT = join(__dirname, '../../../..');

  const gitFiles = (pattern: string): string[] =>
    execFileSync(
      'git',
      ['ls-files', '--cached', '--others', '--exclude-standard', '--', pattern],
      { cwd: REPO_ROOT, encoding: 'utf8' },
    )
      .split('\n')
      .filter(Boolean);

  /**
   * Sites that stay UNMARKED on purpose, by file and the start of the message.
   * The generic message is the right answer for each if it ever surfaces.
   */
  const INTERNAL: Readonly<Record<string, string>> = {
    'apps/ingestion-service/src/modules/auth-client/auth-reference.service.ts|Could not verify the storage quota':
      'a service-to-service check the user cannot act on',
    'apps/ingestion-service/src/modules/auth-client/auth-reference.service.ts|Could not verify the analytics range limit':
      'a service-to-service check the user cannot act on',
    'apps/ingestion-service/src/modules/auth-client/auth-reference.service.ts|Could not verify the document count limit':
      'a service-to-service check the user cannot act on',
    'apps/ingestion-service/src/modules/auth-client/auth-reference.service.ts|Could not verify the document size limit':
      'a service-to-service check the user cannot act on',
    'apps/ingestion-service/src/modules/auth-client/auth-reference.service.ts|Could not verify the AI allowance':
      'a service-to-service check the user cannot act on',
    'apps/ingestion-service/src/modules/auth-client/auth-reference.service.ts|Could not verify the request against the identity service':
      'names an internal service',
    'apps/ticket-service/src/modules/auth-client/auth-reference.service.ts|Could not verify the analytics range limit':
      'a service-to-service check the user cannot act on',
    'apps/ticket-service/src/modules/auth-client/auth-reference.service.ts|Could not verify the attachment limits':
      'a service-to-service check the user cannot act on',
    'apps/ticket-service/src/modules/auth-client/auth-reference.service.ts|Could not verify the request against the identity service':
      'names an internal service',
    'apps/storage-service/src/modules/storage/storage.service.ts|The source could not be stored':
      'storage-service is never the gateway’s direct peer',
    'apps/ticket-service/src/modules/storage-client/storage-reference.service.ts|Ingest did not finish within':
      'exposes an internal deadline',
  };

  const TRANSPORT_CODE =
    /code:\s*(?:status|Status|GrpcStatus)\.(?:UNAVAILABLE|DEADLINE_EXCEEDED|CANCELLED)\b/gu;

  type Site = { file: string; message: string; marked: boolean };

  /** Each transport-class `code:` in a source, with the object literal it sits in. */
  const sitesIn = (file: string, source: string): Site[] =>
    [...source.matchAll(TRANSPORT_CODE)].map((match) => {
      const rest = source.slice(match.index);
      const literal = rest.slice(0, rest.indexOf('}') + 1);
      const text =
        /message:\s*(?:withHttpStatus\(\s*\d{3},\s*)?[`'"]([^`'"]*)/u.exec(
          literal,
        );

      return {
        file,
        message: text?.[1] ?? '(no literal message)',
        marked: literal.includes('withHttpStatus('),
      };
    });

  const sites = gitFiles('apps/*/src/**')
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
    .flatMap((file) =>
      sitesIn(file, stripComments(readFileSync(join(REPO_ROOT, file), 'utf8'))),
    );

  const exemption = (site: Site) =>
    Object.keys(INTERNAL).find((key) => {
      const [file, start] = key.split('|');
      return site.file === file && site.message.startsWith(start);
    });

  it('**every site is marked, or named as internal with a reason**', () => {
    const undecided = sites
      .filter((site) => !site.marked && !exemption(site))
      .map((site) => `${site.file}: ${site.message}`);

    expect(undecided).toEqual([]);
  });

  it('**a named internal site is not also marked** — one decision per site', () => {
    expect(
      sites
        .filter((site) => site.marked && exemption(site))
        .map((site) => `${site.file}: ${site.message}`),
    ).toEqual([]);
  });

  it('every named exemption still matches a site — no carve-out outlives its caller', () => {
    const used = new Set(sites.map(exemption).filter(Boolean));

    expect(Object.keys(INTERNAL).filter((key) => !used.has(key))).toEqual([]);
  });

  it('the corpus floor — the scan finds the 23 known sites', () => {
    expect(sites.length).toBeGreaterThanOrEqual(23);
    expect(sites.filter((site) => site.marked).length).toBeGreaterThanOrEqual(
      12,
    );
  });

  it('the pattern fires on an unmarked and a marked literal', () => {
    const probe = `
      throw new RpcException({ code: status.UNAVAILABLE, message: 'Down' });
      throw new RpcException({
        code: status.UNAVAILABLE,
        message: withHttpStatus(503, 'Billing is not configured'),
      });`;

    expect(sitesIn('probe.ts', probe)).toEqual([
      { file: 'probe.ts', message: 'Down', marked: false },
      { file: 'probe.ts', message: 'Billing is not configured', marked: true },
    ]);
  });
});
