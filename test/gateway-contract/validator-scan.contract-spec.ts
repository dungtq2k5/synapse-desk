/**
 * @file The validator scan, held to a hostile fixture and to a floor.
 *
 * `scanClasses` reads Node's DTO sources to find constraints the published document
 * does not express. A scan over source goes blind quietly: a decorator written across
 * two lines, a comment that mentions a validator, a property whose decorator sits above
 * a docblock. Each of those is a case below, and each asserts what MUST be found and
 * what must NOT be. The real sources then have to yield at least the number of
 * unpublished-validator fields measured when this was written: a result of 19 is a
 * finding about the scan, not a tidier number.
 */

import { join } from 'node:path';
import { REPO_ROOT } from './gateway';
import {
  blank,
  dtoFiles,
  scanClasses,
  scanDtoDirectory,
} from './validator-scan';

const HOSTILE = `
import { IsStrongPassword } from 'class-validator';
// @IsPhoneNumber() is mentioned in a comment and must not count
/* @IsNumberString() neither in a block comment */
export class Probe extends Base implements Shape {
  /** a docblock that mentions @IsEmail() */
  @IsStrongPassword({
    minLength: 8,
    minNumbers: 1,
  })
  // a line comment between a decorator and its property
  readonly password!: string;

  @Matches(/^[a-z0-9-"']+$/, { message: 'slug: "bad" // not a comment, and not @IsUrl()' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  readonly slug?: string;

  @IsOptional()

  /** a docblock between the decorator and the property */
  @IsPhoneNumber()
  phoneNumber: string = 'default;with;semicolons';

  get computed(): string {
    const ratio = 4 / 2;
    return 'x' + ratio;
  }

  method(@IsIgnored() argument: string): void {}
}

class Second { @IsISO8601() readonly at!: string; }
`;

describe('blank', () => {
  it('removes comments and the content of strings, and keeps structure', () => {
    const out = blank("@A('x // y') // @B()\n/* @C() */ f()");

    expect(out).not.toMatch(/@B|@C|x \/\/ y/u);
    expect(out).toContain('@A(');
    expect(out).toContain('f()');
    expect(out).toHaveLength("@A('x // y') // @B()\n/* @C() */ f()".length);
  });

  it('does not read a division as a regular expression', () => {
    expect(blank('const a = b / c; @D()')).toContain('@D()');
  });

  it('does not let a quote inside a regular expression open a string', () => {
    expect(blank('@M(/^["\']+$/) @E()')).toContain('@E()');
  });
});

describe('scanClasses on a hostile fixture', () => {
  const classes = scanClasses(HOSTILE);
  const probe = classes.find((c) => c.name === 'Probe');

  it('finds both classes, including one declared on a single line', () => {
    expect(classes.map((c) => c.name)).toEqual(['Probe', 'Second']);
  });

  it('reads a decorator spread over several lines as one, and keeps it with its property across a comment', () => {
    expect(
      probe?.properties.find((p) => p.name === 'password')?.decorators,
    ).toEqual(['IsStrongPassword']);
  });

  it('reads a pattern, a message with // in it, and an arrow function as decorators of one property', () => {
    expect(
      probe?.properties.find((p) => p.name === 'slug')?.decorators,
    ).toEqual(['Matches', 'Transform']);
  });

  it('keeps a decorator with a property that a docblock separates it from, and survives a semicolon in a default', () => {
    expect(
      probe?.properties.find((p) => p.name === 'phoneNumber')?.decorators,
    ).toEqual(['IsOptional', 'IsPhoneNumber']);
  });

  it('does not count a validator that only a comment mentions', () => {
    const all = (probe?.properties ?? []).flatMap((p) => p.decorators);

    expect(all).not.toContain('IsEmail');
    expect(all).not.toContain('IsNumberString');
    expect(all).not.toContain('IsUrl');
  });

  it('ignores accessors, methods and parameter decorators', () => {
    expect(probe?.properties.map((p) => p.name)).toEqual([
      'password',
      'slug',
      'phoneNumber',
    ]);
    expect(
      (probe?.properties ?? []).flatMap((p) => p.decorators),
    ).not.toContain('IsIgnored');
  });

  it('reads the second class', () => {
    expect(classes[1].properties).toEqual([
      { name: 'at', decorators: ['IsISO8601'] },
    ]);
  });
});

describe('the real DTO sources', () => {
  const root = join(REPO_ROOT, 'apps/api-gateway/src/modules');
  const files = dtoFiles(root);
  const properties = scanDtoDirectory(root).flatMap((c) => c.properties);

  it('finds the DTO files and a believable number of validated properties', () => {
    // Measured when this was written: 81 request DTO classes, 220 properties.
    expect(files.length).toBeGreaterThan(30);
    expect(properties.length).toBeGreaterThan(300);
  });

  it.each([
    'IsStrongPassword',
    'IsPhoneNumber',
    'IsNumberString',
    'IsFutureDate',
    'IsISO8601',
    'Matches',
    'IsEmail',
    'IsUUID',
  ])('still finds %s somewhere', (decorator) => {
    expect(properties.flatMap((p) => p.decorators)).toContain(decorator);
  });
});
