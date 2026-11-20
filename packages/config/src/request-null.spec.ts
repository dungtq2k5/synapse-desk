import { readListed, repoFiles } from '@synapsedesk/testing/repo-files';

/**
 * An explicit `null` on a gateway request field is refused unless the field
 * says what it means.
 *
 * `class-validator`'s `@IsOptional()` skips every validator on `null`, so a
 * `null` reached the code as a value the field's type said it couldn't hold.
 * The gateway's request fields take `@OptionalNonNull()` (absent allowed,
 * `null` a 400) or `@OptionalNullable()` (`null` means something), and the
 * field's type says which: `| null` exactly when the decorator allows it. The
 * document publishes `nullable` from that type, so the two can't disagree.
 */
describe('a null on a gateway request field', () => {
  const NULLABLE_DECORATORS = [
    '@OptionalNullable()',
    '@IsPresentButNullable()',
  ];
  const PROPERTY = /^\s+(?:readonly\s+)?(\w+)[?!]?:\s*([^=;]+)/;

  const gatewayFiles = () =>
    repoFiles('services/api-gateway/src').filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'),
    );

  /** Request DTOs: REST ones that aren't responses, and GraphQL arguments. */
  const requestFiles = () =>
    gatewayFiles().filter(
      (file) =>
        (file.endsWith('.dto.ts') &&
          !file.endsWith('-response.dto.ts') &&
          !file.endsWith('.gql-dto.ts')) ||
        /args\.gql-dto\.ts$/.test(file),
    );

  /** Each property whose nullable decorator and `| null` type disagree. */
  const mismatches = (source: string): string[] => {
    const found: string[] = [];
    let decorators: string[] = [];
    // Brackets still open in the decorator being read: one may span lines
    // (`@Field(() => Int, {` … `})`), and its inner lines aren't properties.
    let depth = 0;
    const balance = (text: string) =>
      (text.match(/[([{]/g)?.length ?? 0) -
      (text.match(/[)\]}]/g)?.length ?? 0);

    for (const line of source.split('\n')) {
      const trimmed = line.trim();
      if (depth > 0 || trimmed.startsWith('@')) {
        if (depth === 0) decorators.push(trimmed);
        depth += balance(trimmed);
        continue;
      }
      const property = PROPERTY.exec(line);
      if (!property) {
        if (/^(export )?class |^\}/.test(trimmed)) decorators = [];
        continue;
      }
      const [, name, type] = property;
      const decorated = decorators.some((d) => NULLABLE_DECORATORS.includes(d));
      const typed = /\|\s*null\b/.test(type);
      if (decorators.length > 0 && decorated !== typed) {
        found.push(
          `${name}: ${decorated ? 'a nullable decorator without `| null`' : '`| null` without a nullable decorator'}`,
        );
      }
      decorators = [];
    }
    return found;
  };

  it("**1. no gateway file imports class-validator's `IsOptional`**", () => {
    const offenders = readListed(gatewayFiles())
      .filter(({ text }) =>
        /import\s*\{[^}]*\bIsOptional\b[^}]*\}\s*from\s*'class-validator'/.test(
          text,
        ),
      )
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it('**2. a request field is typed `| null` exactly when its decorator allows `null`**', () => {
    const violations = readListed(requestFiles()).flatMap(({ path, text }) =>
      mismatches(text).map((problem) => `${path}: ${problem}`),
    );

    expect(violations).toEqual([]);
  });

  it('**3. the scans reach real files, and can see each kind of violation**', () => {
    expect(requestFiles().length).toBeGreaterThan(30);
    expect(
      mismatches(
        [
          'export class Body {',
          '  @OptionalNullable()',
          '  @Field(() => Int, {',
          '    defaultValue: 1,',
          '  })',
          '  readonly clears?: number | null;',
          '  @OptionalNullable()',
          '  @Field(() => Int, {',
          '    defaultValue: 1,',
          '  })',
          '  readonly spansLines?: number;',
          '  @OptionalNullable()',
          '  readonly untyped?: string;',
          '  @OptionalNonNull()',
          '  readonly typed?: string | null;',
          '  @OptionalNonNull()',
          '  readonly plain?: string;',
          '}',
        ].join('\n'),
      ),
    ).toEqual([
      'spansLines: a nullable decorator without `| null`',
      'untyped: a nullable decorator without `| null`',
      'typed: `| null` without a nullable decorator',
    ]);
  });
});
