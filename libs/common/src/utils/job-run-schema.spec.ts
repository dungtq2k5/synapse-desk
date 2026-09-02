import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * **The drift guard.**
 *
 * `model JobRun` is declared three times — `postgres_auth`, `postgres_ticket`,
 * `postgres_ingestion` — and that is deliberate: writing the heartbeat into the
 * same failure domain as the work it describes is the only thing that makes it
 * mean anything. A remote heartbeat can succeed while the job's own database is
 * unreachable, reporting healthy for a job writing nothing.
 *
 * The cost is a shape three files must agree on with no compiler checking it:
 * Prisma has no cross-package schema imports.
 *
 * **It compares FIELDS, not comments.** A divergent explanation is a
 * readability problem; a divergent column is `JobRunStore` lying to one of its
 * three bindings.
 */
describe('model JobRun is identical across the three schemas', () => {
  const SERVICES = [
    'auth-service',
    'ticket-service',
    'ingestion-service',
    // The fourth copy — outbound webhooks made notification-service a
    // scheduled-jobs service, and the docblock in all four schemas states the
    // count. Added HERE in the same change, because a block outside this list
    // can drift exactly the way the spec exists to prevent.
    'notification-service',
  ];

  /**
   * The field lines of `model JobRun`, normalised.
   *
   * Comments (`///` and `//`) are dropped, and runs of whitespace collapse to
   * one space — so `lastError String?` and `lastError  String?` compare equal.
   * Prisma treats the alignment as insignificant and so must this, or the test
   * fails on a formatter rather than on a schema change.
   */
  const fieldsOf = (service: string): string[] => {
    const schema = readFileSync(
      join(__dirname, '../../../../apps', service, 'prisma/schema.prisma'),
      'utf8',
    );

    const block = /model JobRun \{([\s\S]*?)\n\}/.exec(schema);
    if (!block) {
      throw new Error(`${service} has no 'model JobRun'`);
    }

    return block[1]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('//'))
      .map((line) => line.replace(/\s+/g, ' '));
  };

  it('1. **every service declares the same fields, types and modifiers**', () => {
    // Compared each-against-the-first rather than destructured by name, so the
    // fifth copy is covered by arriving in SERVICES rather than by somebody
    // extending a pattern of pairwise expects.
    const [reference, ...rest] = SERVICES.map(fieldsOf);

    for (const fields of rest) {
      expect(fields).toEqual(reference);
    }

    expect(rest.length).toBeGreaterThanOrEqual(3);
  });

  it('2. the block carries every column `JobRunStore` writes', () => {
    // The interface in `libs/common` is hand-written — it cannot depend on
    // Prisma's generated delegate types, which differ per service by client
    // path. So nothing else checks that the shared writer's columns exist.
    const required = [
      'jobName',
      'lastStartedAt',
      'lastSucceededAt',
      'lastDurationMs',
      'lastError',
      'consecutiveFailures',
    ];

    for (const service of SERVICES) {
      const names = fieldsOf(service).map((line) => line.split(' ')[0]);

      for (const field of required) {
        expect(names).toContain(field);
      }
    }
  });

  it('3. **`lastSucceededAt` stays NULLABLE in all three**', () => {
    // The one modifier with teeth. It is null until the first success, which is
    // how `checkStaleness` distinguishes "never ran" from "stale" — the exact
    // distinction seven uncalled jobs needed somebody to be able to make.
    // Making it required would force a lie at insert time.
    for (const service of SERVICES) {
      const line = fieldsOf(service).find((field) =>
        field.startsWith('lastSucceededAt '),
      );

      expect(line).toContain('DateTime?');
    }
  });

  it('4. all three map to the same table and column names', () => {
    // The services share no database, so a divergent `@map` would not collide —
    // it would just make one service's rows unreadable by a query written
    // against another's, and every runbook subtly wrong for one of the three.
    for (const service of SERVICES) {
      const fields = fieldsOf(service);

      expect(fields).toContain('jobName String @id @map("job_name")');
      expect(fields.join('\n')).toContain('@map("last_succeeded_at")');
    }
  });
});
