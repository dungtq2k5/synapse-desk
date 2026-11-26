type Primitive = string | number | boolean | null;

/**
 * Sorts every primitive `enum` array in an OpenAPI document, in place, and
 * returns the document.
 *
 * **Why.** The swagger plugin derives many enums from TypeScript union types,
 * and a union's member order follows the compiler's internal type ids — which
 * depend on what the compiler created first. `nest build` compiles the whole
 * program, ts-jest compiles file by file, so the same enum comes out in two
 * orders (measured: five arrays). An `enum` is a set, so sorting changes no
 * meaning, and the committed document stops moving when a compiler upgrade or
 * a new import reorders a union.
 *
 * **Only primitive `enum` arrays — never object keys.** Key order is what SDK
 * generators turn into field order, so it is left exactly as the plugin wrote
 * it.
 *
 * Here rather than beside the export script because the gateway's e2e suite
 * applies it too, and a workspace reaches shared code through
 * `@synapsedesk/*`, never by a relative path out of itself.
 *
 * @example canonicalizeEnums({ properties: { type: { enum: ['b', 'a'] } } }) // { properties: { type: { enum: ['a', 'b'] } } }
 */
export function canonicalizeEnums<T>(document: T): T {
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node === null || typeof node !== 'object') return;

    for (const [key, value] of Object.entries(node)) {
      if (key === 'enum' && Array.isArray(value) && value.every(isPrimitive)) {
        value.sort(comparePrimitives);
      } else {
        visit(value);
      }
    }
  };

  visit(document);

  return document;
}

/**
 * Lists `null` in every nullable schema's `enum`, in place. OpenAPI 3.0's
 * `nullable: true` widens the type but not the `enum`, so a validator or a
 * generated client that follows the specification refuses the `null` the
 * gateway sends. The schema says it is nullable; this makes its `enum` agree.
 *
 * @example listNullInNullableEnums({ nullable: true, enum: ['A'] }) // { nullable: true, enum: ['A', null] }
 */
export function listNullInNullableEnums<T>(document: T): T {
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    if (node === null || typeof node !== 'object') return;

    const schema = node as { nullable?: unknown; enum?: unknown };
    if (
      schema.nullable === true &&
      Array.isArray(schema.enum) &&
      !schema.enum.includes(null)
    ) {
      schema.enum.push(null);
    }
    Object.values(node).forEach(visit);
  };

  visit(document);

  return document;
}

function isPrimitive(value: unknown): value is Primitive {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function typeName(value: Primitive): string {
  return value === null ? 'null' : typeof value;
}

/**
 * Type first, then value — a total order, so the result never depends on the
 * input order. Code-unit order for strings, not `localeCompare`, so the output
 * is the same on every machine.
 */
function comparePrimitives(a: Primitive, b: Primitive): number {
  const typeA = typeName(a);
  const typeB = typeName(b);
  if (typeA !== typeB) return typeA < typeB ? -1 : 1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;

  const textA = String(a);
  const textB = String(b);
  if (textA === textB) return 0;
  return textA < textB ? -1 : 1;
}
