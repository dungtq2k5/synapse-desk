import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AiGenerationPurpose, AiGenerationStatus } from './document.config';

/**
 * The TypeScript half of 13-doc §1.2 test 2. The Python half is
 * `apps/rag-service/tests/test_enums.py`.
 *
 * The proto is read as TEXT rather than through the generated module: the
 * generated TS enum is a projection of the same file, so comparing the two
 * would be comparing a file to itself. What must be checked is that the
 * HAND-WRITTEN enum in `document.config.ts` — the one every service actually
 * imports — still matches the declaration both languages generate from.
 */
const PROTO = readFileSync(
  join(
    __dirname,
    '../../../grpc-proto/src/proto/synapsedesk/ingestion/ledger.proto',
  ),
  'utf8',
);

function protoEnumValues(name: string, prefix: string): string[] {
  const block = new RegExp(`enum ${name} \\{([^}]*)\\}`).exec(PROTO);
  expect(block).not.toBeNull();

  return (
    [...block![1].matchAll(/^\s*(\w+)\s*=\s*\d+;/gm)]
      .map((match) => match[1])
      // proto3 requires a zero value meaning "not set", which is not a purpose
      // anything could have been spent on. Offering it would let a caller write
      // a row describing nothing.
      .filter((value) => !value.endsWith('UNSPECIFIED'))
      .map((value) => value.replace(prefix, ''))
  );
}

describe('§1.1 The AI ledger enums (unit)', () => {
  it('1. Matches the proto value for value on PURPOSE', () => {
    // The drift 13-doc §1.1 calls "the one genuinely new drift risk": these
    // values exist in two languages, and a `GREETING_CLASSIFY` that becomes
    // `GREETING_CLASSIFICATION` on one side meters into a purpose nothing
    // queries. Nothing errors — rows are written, the counter increments, and
    // every report grouped by purpose quietly omits them.
    expect(Object.values(AiGenerationPurpose).sort()).toEqual(
      protoEnumValues('AiGenerationPurpose', 'AI_GENERATION_PURPOSE_').sort(),
    );
  });

  it('2. Matches the proto value for value on STATUS', () => {
    expect(Object.values(AiGenerationStatus).sort()).toEqual(
      protoEnumValues('AiGenerationStatus', 'AI_GENERATION_STATUS_').sort(),
    );
  });

  it('3. Uses the BARE name as the stored value', () => {
    // `ai_generations.purpose` is a VARCHAR shared with Python. The
    // `AI_GENERATION_PURPOSE_` prefix is protobuf's uniqueness requirement,
    // not domain vocabulary — storing it would leave every row written by one
    // language unmatched by every query written in the other.
    expect(AiGenerationPurpose.CHAT_ANSWER).toBe('CHAT_ANSWER');
    expect(AiGenerationStatus.CANCELLED).toBe('CANCELLED');
  });

  it('4. Carries REVIEW, so the co-pilot cost is not folded into DRAFT', () => {
    // A draft with two review passes is three generations. Folding them under
    // `DRAFT` makes the per-draft cost look like one call, understating the
    // co-pilot by exactly the factor that makes it worth having.
    expect(AiGenerationPurpose.REVIEW).toBe('REVIEW');
  });
});
