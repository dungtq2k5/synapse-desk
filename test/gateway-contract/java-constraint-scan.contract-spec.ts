/**
 * @file The Java constraint scan, held to a hostile fixture and to a floor.
 *
 * `scanJava` reads the Java gateway's sources to find what each request field is
 * constrained to. A scan over source goes blind quietly: a docblock that mentions an
 * annotation, a regex argument full of parentheses, an annotation spread over three
 * lines. Each of those is a case below, and each asserts what MUST be found and what
 * must NOT. The real sources then have to yield at least the number of constrained
 * request fields measured when this was written: fewer is a finding about the scan,
 * not a tidier number.
 */

import { join } from 'node:path';
import { REPO_ROOT } from './gateway';
import { scanJava, scanJavaDirectory } from './java-constraint-scan';

const HOSTILE = String.raw`
/**
 * A docblock naming {@code @StrictIso8601} and @StrongPassword is not a use of either.
 */
public class Probe {

  // @NumberString in a line comment is not one either.

  @NotNull
  @Matches(
    regex = "^[a-z]([a-z0-9-]*\")?(\\.[a-z]+)+$"
  )
  @JsonProperty("domain")
  public String getDomain() {
    return domain;
  }

  @Matches(regex = "^[^)]+$")
  @JsonProperty("code")
  public String getCode() {
    return code;
  }

  @StrictIso8601
  @FutureDate
  @JsonProperty("lockedUntil")
  public @Nullable String getLockedUntil() {
    return lockedUntil;
  }

  @JsonProperty("readAt")
  public @Nullable OffsetDateTime getReadAt() {
    return readAt;
  }

  @JsonProperty("note")
  public String getNote() {
    return note;
  }

  public ResponseEntity<Void> list(
    @NotNull @StrictIso8601 @Valid @RequestParam(
      value = "from",
      required = true
    ) String from
  ) {
    return null;
  }
}

record Second(@NotNull @ValidPhoneNumber String phoneNumber, String other) {}
`;

describe('scanJava on a hostile fixture', () => {
  const found = scanJava(HOSTILE);
  const keys = found.map(
    (c) => `${c.on} ${c.className}.${c.property} ${c.kind}`,
  );

  it('finds exactly the declared constraints, in source order, and nothing a comment names', () => {
    expect(keys).toEqual([
      'property Probe.domain Matches',
      'property Probe.code Matches',
      'property Probe.lockedUntil StrictIso8601',
      'property Probe.lockedUntil FutureDate',
      'parameter Probe.from StrictIso8601',
      'property Second.phoneNumber ValidPhoneNumber',
      'property Probe.readAt OffsetDateTime',
    ]);
  });

  it('keeps a multi-line annotation whose regex holds parentheses and a quote with its property', () => {
    expect(keys).toContain('property Probe.domain Matches');
  });

  it('skips a regex argument holding an UNBALANCED `)`, which a count of brackets alone would stop at', () => {
    expect(keys).toContain('property Probe.code Matches');
  });

  it('reads a date-typed getter as a constraint, and a plain string getter as none', () => {
    expect(found.some((c) => c.property === 'note')).toBe(false);
  });
});

describe('the real Java sources', () => {
  it('yield at least the 23 constrained request fields measured when this was written', () => {
    const found = scanJavaDirectory(
      join(REPO_ROOT, 'apps/api-gateway-java/src/main/java'),
    );
    const requestFields = new Set(
      found
        .filter(
          (c) =>
            c.on === 'property' &&
            !c.className.endsWith('ResponseDto') &&
            c.className !== 'InboundEmail',
        )
        .filter(
          (c) =>
            c.kind !== 'OffsetDateTime' || c.className === 'MarkTicketReadDto',
        )
        .map((c) => `${c.className}.${c.property}`),
    );

    expect(requestFields.size).toBeGreaterThanOrEqual(23);
  });
});
