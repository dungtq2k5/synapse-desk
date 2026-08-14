import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  MAX_ATTACHMENT_FILE_NAME_LENGTH,
  MAX_TICKET_TITLE_LENGTH,
} from './ticket.config';
import { MAX_DOCUMENT_TITLE_LENGTH } from './document.config';

/**
 * Every DTO bound that MIRRORS a `VarChar` column actually matches it.
 *
 * **The claim is already written down; this is what makes it true.**
 * `MAX_ATTACHMENT_FILE_NAME_LENGTH`'s docblock says it plainly — *"two places
 * have to agree, and if they drift the DTO accepts what the database rejects —
 * a 500 where a 400 belongs, on a request the caller could have fixed."* That
 * is exactly right and nothing checked it: the constant removed the drift
 * BETWEEN the three DTOs that carry it, and left the drift between the constant
 * and the column it exists to mirror.
 *
 * **It is not one constant's problem.** Three bounds pair with a `VarChar(255)`
 * across two services, and all three agree today by coincidence of everyone
 * having typed 255 twice. A `@db.VarChar(200)` in a migration would break the
 * pair silently, and the symptom arrives as a Postgres error surfacing as a 5xx
 * on a request that validated cleanly.
 *
 * **Read out of `schema.prisma` rather than restated**, following
 * `job-run-schema.spec.ts` — the drift guard for a model declared in three
 * databases, and the same shape of problem. A test that hard-coded 255 would
 * agree with a broken schema.
 *
 * A bound with NO column behind it does not belong here: `MAX_OBJECT_PATH_LENGTH`
 * guards a `@db.Text` and its own docblock says so — *"a bound, not a
 * contract"*. Adding it would invent a constraint the database does not have.
 */
type Pairing = {
  readonly constant: number;
  readonly name: string;
  readonly service: string;
  readonly model: string;
  readonly column: string;
};

const PAIRINGS: readonly Pairing[] = [
  {
    constant: MAX_ATTACHMENT_FILE_NAME_LENGTH,
    name: 'MAX_ATTACHMENT_FILE_NAME_LENGTH',
    service: 'ticket-service',
    model: 'MessageAttachment',
    column: 'fileName',
  },
  {
    constant: MAX_TICKET_TITLE_LENGTH,
    name: 'MAX_TICKET_TITLE_LENGTH',
    service: 'ticket-service',
    model: 'Ticket',
    column: 'title',
  },
  {
    constant: MAX_DOCUMENT_TITLE_LENGTH,
    name: 'MAX_DOCUMENT_TITLE_LENGTH',
    service: 'ingestion-service',
    model: 'Document',
    column: 'title',
  },
];

/**
 * The declared width of one column, or a thrown error naming what was not found.
 *
 * Throwing rather than returning `null` on purpose: a renamed model or column
 * must fail this suite by name, not quietly satisfy a `toBe(undefined)` on both
 * sides and report a pairing that no longer exists as verified.
 */
function declaredWidth(pairing: Pairing): number {
  const schema = readFileSync(
    join(
      __dirname,
      '../../../../apps',
      pairing.service,
      'prisma/schema.prisma',
    ),
    'utf8',
  );

  const block = new RegExp(`model ${pairing.model} \\{([\\s\\S]*?)\\n\\}`).exec(
    schema,
  );
  if (!block) {
    throw new Error(
      `${pairing.service} has no 'model ${pairing.model}' — has it been renamed?`,
    );
  }

  const column = new RegExp(
    `\\n\\s+${pairing.column}\\s+String\\??[^\\n]*@db\\.VarChar\\((\\d+)\\)`,
  ).exec(block[1]);
  if (!column) {
    throw new Error(
      `${pairing.model}.${pairing.column} is not a @db.VarChar — either it moved ` +
        `to @db.Text, in which case ${pairing.name} is no longer a contract and ` +
        `belongs out of this table, or it was renamed`,
    );
  }

  return Number(column[1]);
}

describe('DTO bounds match the columns they mirror', () => {
  it('the table is not empty', () => {
    // Guards the guard: `it.each([])` passes silently, and an empty table would
    // report every pairing as verified while checking none.
    expect(PAIRINGS.length).toBeGreaterThanOrEqual(3);
  });

  // The whole pairing is passed through rather than destructured and rebuilt:
  // `declaredWidth`'s errors name the constant, and reconstructing the object
  // with a blank `name` made the most useful half of that message disappear.
  it.each(PAIRINGS)('$name === $model.$column', (pairing: Pairing) => {
    const where = `${pairing.service}:${pairing.model}.${pairing.column}`;

    // Compared as an object so a failure prints WHICH column disagreed rather
    // than `expected 255, received 200` with three candidates in the table.
    expect({ where, width: declaredWidth(pairing) }).toEqual({
      where,
      width: pairing.constant,
    });
  });
});
