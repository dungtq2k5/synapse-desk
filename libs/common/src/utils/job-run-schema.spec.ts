import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * **The drift guard** test 1.
 *
 * `model JobRun` is declared three times, in `postgres_auth`, `postgres_ticket`
 * and `postgres_ingestion`. That is correct and deliberate: three tables
 * holding different rows is not duplication of facts — auth's holds auth's
 * jobs, ingestion's holds ingestion's — and writing the heartbeat into the same
 * failure domain as the work it describes is the only thing that makes it mean
 * anything. A remote heartbeat can succeed while the job's own database is
 * unreachable, reporting healthy for a job writing nothing, which is the
 * original bug with extra infrastructure.
 *
 * What that costs is a shape three files have to agree on, with no compiler
 * checking it: Prisma has no cross-package schema imports, and generating the
 * block from a canonical partial adds build machinery for twelve lines.
 *
 * **The drift is not hypothetical — it had already started.** Two of the three
 * carried the full docblock explaining why `lastSucceededAt` survives a
 * failure; auth-service's had a two-line stub. Comments only, so harmless — and
 * the first inch of exactly the movement this test exists to stop.
 *
 * So this compares FIELDS, not comments: a divergent explanation is a
 * readability problem, and a divergent column is `JobRunStore` lying to one of
 * its three bindings.
 */
describe('model JobRun is identical across the three schemas', () => {
  const SERVICES = ['auth-service', 'ticket-service', 'ingestion-service'];

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
      throw new Error(`${service} has no 'model JobRun' — 20-doc §4.1`);
    }

    return block[1]
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('//'))
      .map((line) => line.replace(/\s+/g, ' '));
  };

  it('1. **every service declares the same fields, types and modifiers**', () => {
    const [auth, ticket, ingestion] = SERVICES.map(fieldsOf);

    expect(ticket).toEqual(auth);
    expect(ingestion).toEqual(auth);
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
