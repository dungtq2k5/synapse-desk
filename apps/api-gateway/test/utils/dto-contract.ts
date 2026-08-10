import { readFileSync } from 'node:fs';

/**
 * The drift guard that replaced inheritance — 26-doc §2, revised.
 *
 * REST and GraphQL DTOs are now independent classes. That buys separation of
 * concerns and costs duplicated field declarations, and the cost is only
 * acceptable if the duplication cannot drift silently. This is what makes it
 * cannot.
 *
 * **Why a test rather than a shared base class.** The original design was
 * `TicketType extends TicketResponseDto`, defended as making drift a compile
 * error. It did not: inheritance makes a new field present and typed in the
 * subclass, so a field added to the parent reached REST and was absent from the
 * schema with nothing failing. Collapsing to one class fixed that direction and
 * introduced the opposite one — a field added with `@Field()` that should have
 * been REST-only appears in the PUBLIC schema, which is the worse failure.
 *
 * Reading both sources catches both directions, and needs no coupling at all.
 *
 * **Source text rather than metadata.** `TypeMetadataStorage` is empty until a
 * full schema build has run, so a metadata-based check iterates nothing and
 * passes vacuously — asserting a pairing over zero fields, which is the exact
 * failure this guards against one level up.
 */
export type DtoContract = {
  /** The REST class's source file. */
  restPath: string;
  /** The REST class name, e.g. `UserResponseDto`. */
  restClass: string;
  /** The GraphQL class's source file. */
  gqlPath: string;
  /** The GraphQL class name, e.g. `UserResponseGqlDto`. */
  gqlClass: string;
  /**
   * Fields REST serves and the schema deliberately omits.
   *
   * **Declaring them here is the feature.** Under the shared-base design these
   * omissions were implicit in which class a field happened to land on, so
   * "deliberate" and "forgotten" looked identical. An entry here is a decision
   * someone wrote down and a reviewer can question.
   */
  restOnly?: readonly string[];
  /**
   * Fields the schema serves and REST does not — resolved edges, almost always.
   *
   * `Ticket.assignee` is a cross-service resolution the REST response
   * deliberately does not perform, exposing `currentAssigneeId` instead.
   */
  gqlOnly?: readonly string[];
};

/**
 * A property declaration: two spaces, an optional `readonly`, then the name.
 *
 * At module scope so the four readers below share one definition of what
 * counts as a field — three of them had their own copy, and a contract check
 * whose idea of "a property" varies between checks is worth very little.
 */
const PROPERTY = /^ {2}(?:readonly )?(?<name>\w+)!?\??:/;

/** Every property declared directly on `className` in `source`. */
export function declaredFields(source: string, className: string): string[] {
  return classBody(source, className).flatMap((line) => {
    const property = PROPERTY.exec(line);

    return property ? [property.groups!.name] : [];
  });
}

/**
 * Asserts the two declarations agree, and that every `@Field()` is explicit.
 *
 * Returns the findings rather than calling `expect` so the caller decides how to
 * report them — a helper that owns the assertions hides which contract failed.
 */
export function compareContract(contract: DtoContract): {
  missingFromGql: string[];
  missingFromRest: string[];
  undecorated: string[];
  inferredFields: string[];
  nullabilityMismatches: string[];
} {
  const restSource = readFileSync(contract.restPath, 'utf8');
  const gqlSource = readFileSync(contract.gqlPath, 'utf8');

  const rest = declaredFields(restSource, contract.restClass);
  const gql = declaredFields(gqlSource, contract.gqlClass);

  const restOnly = new Set(contract.restOnly ?? []);
  const gqlOnly = new Set(contract.gqlOnly ?? []);

  return {
    // In REST, absent from the schema, and not declared as a deliberate
    // omission — the drift the original inheritance claim missed.
    missingFromGql: rest.filter(
      (name) => !gql.includes(name) && !restOnly.has(name),
    ),

    // In the schema and not in REST — an accidental PUBLIC field unless it is a
    // declared edge. The direction the collapsed single class could not see.
    missingFromRest: gql.filter(
      (name) => !rest.includes(name) && !gqlOnly.has(name),
    ),

    // A property with no `@Field()` is simply absent from the SDL. Nothing
    // errors; the field just never reaches a client.
    undecorated: undecoratedFields(gqlSource, contract.gqlClass),

    // `@Field()` with no explicit type: `number` cannot distinguish `Int` from
    // `Float`, nor `string` an `ID` from a `String`, and both serialise
    // identically — so a wrong inference is invisible until a client generates
    // types from the schema.
    inferredFields: inferredFieldTypes(gqlSource, contract.gqlClass),

    // A field nullable in REST and non-null in the schema. The two drift
    // silently in a way the field-set comparison above cannot see, and the
    // failure is disproportionate: the first null row fails the WHOLE query
    // with a non-null error rather than returning one null field.
    nullabilityMismatches: nullabilityMismatches(
      contract,
      restSource,
      gqlSource,
    ),
  };
}

/**
 * Fields whose nullability disagrees — 26-doc §2 test 2, the second half.
 *
 * Compared on both sides from the SOURCE, for the reason the file note gives:
 * `TypeMetadataStorage` is empty until a schema build has run, so a
 * metadata-based check iterates nothing and passes vacuously.
 *
 * Only fields present on BOTH sides are compared. A declared edge or a declared
 * omission has no counterpart to disagree with, and the field-set comparison
 * above is what judges those.
 */
function nullabilityMismatches(
  contract: DtoContract,
  restSource: string,
  gqlSource: string,
): string[] {
  const rest = nullabilityOf(restSource, contract.restClass, restIsNullable);
  const gql = nullabilityOf(gqlSource, contract.gqlClass, gqlIsNullable);

  return [...rest.entries()]
    .filter(([name, nullable]) => gql.has(name) && gql.get(name) !== nullable)
    .map(([name]) => name);
}

/** Each declared property, mapped to whether `judge` calls it nullable. */
function nullabilityOf(
  source: string,
  className: string,
  judge: (lines: string[], index: number) => boolean,
): Map<string, boolean> {
  const lines = classBody(source, className);
  const nullability = new Map<string, boolean>();

  lines.forEach((line, index) => {
    const property = PROPERTY.exec(line);
    if (property) {
      nullability.set(property.groups!.name, judge(lines, index));
    }
  });

  return nullability;
}

/**
 * REST: a `| null` union, or an optional `?`.
 *
 * Both read to a client as "this key may carry nothing", and the GraphQL side
 * spells both the same way — as a nullable field. Read across the declaration's
 * lines rather than the first one, because a union that wraps is still a union.
 *
 * Not `@IsOptional()`: 24-doc §1 records that the Swagger plugin derives
 * `required` from TypeScript optionality rather than from the validator, and a
 * check that disagreed with the generated document would be checking a third
 * thing nobody serves.
 */
function restIsNullable(lines: string[], index: number): boolean {
  return /\|\s*null|\?\s*:/.test(declarationAt(lines, index));
}

/** GraphQL: `nullable: true` on the `@Field()`, which is the only spelling. */
function gqlIsNullable(lines: string[], index: number): boolean {
  return decoratorsAbove(lines, index).some(
    (decorator) =>
      decorator.startsWith('  @Field(') && /nullable:\s*true/.test(decorator),
  );
}

/** A property declaration, joined across the lines it spans. */
function declarationAt(lines: string[], index: number): string {
  const parts: string[] = [];

  for (let at = index; at < lines.length; at++) {
    parts.push(lines[at]);
    if (lines[at].includes(';')) break;
  }

  return parts.join(' ');
}

/** Properties on the GraphQL class that carry no `@Field()`. */
function undecoratedFields(source: string, className: string): string[] {
  const lines = classBody(source, className);

  return lines.flatMap((line, index) => {
    const property = PROPERTY.exec(line);
    if (!property) return [];

    return decoratorsAbove(lines, index).some((decorator) =>
      decorator.startsWith('  @Field('),
    )
      ? []
      : [property.groups!.name];
  });
}

/** Properties whose `@Field()` omits an explicit GraphQL type. */
function inferredFieldTypes(source: string, className: string): string[] {
  const lines = classBody(source, className);

  return lines.flatMap((line, index) => {
    const property = PROPERTY.exec(line);
    if (!property) return [];

    const field = decoratorsAbove(lines, index).find((decorator) =>
      decorator.startsWith('  @Field('),
    );

    // `@Field(() => X)` is explicit; `@Field()` and `@Field({ … })` are not.
    return field && !/@Field\(\s*\(\)\s*=>/.test(field)
      ? [property.groups!.name]
      : [];
  });
}

/**
 * The lines between `class X {` and the first `}` at column zero.
 *
 * **The single reader of a class body**, and it used to be two: `declaredFields`
 * carried a byte-identical copy of this regex and slicing. Two implementations
 * of "where does the class start" is one more than can be kept in step, and the
 * one that drifts is whichever the next reader does not open.
 *
 * `String.raw` so the pattern reads as a regex rather than as a string that
 * happens to contain one: `\b` and `\{` are what the engine sees, and writing
 * them `\\b` and `\\{` puts a second layer of escaping between the author and
 * the thing being matched.
 */
function classBody(source: string, className: string): string[] {
  const start = new RegExp(
    String.raw`export class ${className}\b[^{]*\{`,
    'm',
  ).exec(source);

  if (!start) {
    throw new Error(`class ${className} not found — did it get renamed?`);
  }

  const body = source.slice(start.index + start[0].length);
  const end = body.search(/^\}/m);

  return body.slice(0, end === -1 ? undefined : end).split('\n');
}

/** The consecutive decorator lines immediately above `index`. */
function decoratorsAbove(lines: string[], index: number): string[] {
  const decorators: string[] = [];

  for (let at = index - 1; at >= 0 && /^ {2}@/.test(lines[at]); at--) {
    decorators.push(lines[at]);
  }

  return decorators;
}
