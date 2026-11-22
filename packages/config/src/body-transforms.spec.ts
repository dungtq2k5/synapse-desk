import { readListed, repoFiles } from '@synapsedesk/testing/repo-files';

/**
 * A JSON body field is validated as the type it arrived as: nothing on a body
 * class converts it first.
 *
 * The gateway's pipe transforms before it validates, so a body field's
 * `@Type(() => Number)` read `true` as `1` and `@Type(() => Boolean)` read
 * `"false"` as `true`, and the type check then passed. A query string is text,
 * so query classes keep their transforms; a body is JSON, so its classes carry
 * none. Allowed on a body class: `@Type` naming a class (how a nested body
 * object is built) and the string normalizers, which leave a non-string alone.
 *
 * The scan starts from the code: every `@Body()` parameter in a controller, and
 * every object validated by hand with the pipe's options, then each class they
 * nest or extend.
 */
describe('a gateway body class', () => {
  const PRIMITIVE =
    /@Type\(\s*\(\)\s*=>\s*(?:Number|Boolean|Date|String)\s*\)|@ToBoolean\(|@Transform\((?!\s*(?:trimIfString|lowerIfString|normalizeStringArray)\s*\))/g;

  const gatewayFiles = () =>
    repoFiles('services/api-gateway/src').filter(
      (file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'),
    );

  /** The source without its comments, so a comment naming a decorator isn't one. */
  const code = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

  /** Each class's body, by name. */
  function classesIn(text: string): Map<string, string> {
    const found = new Map<string, string>();
    const source = code(text);
    for (const match of source.matchAll(/\bclass (\w+)([^{]*)\{/g)) {
      let depth = 1;
      let at = match.index + match[0].length;
      while (depth > 0 && at < source.length) {
        if (source[at] === '{') depth++;
        else if (source[at] === '}') depth--;
        at++;
      }
      // The heritage clause too: `extends PartialType(CreateFooDto)` brings
      // CreateFooDto's decorators with it.
      found.set(
        match[1],
        `${match[2]}{${source.slice(match.index + match[0].length, at)}`,
      );
    }
    return found;
  }

  /** The classes the code validates as a JSON body. */
  function bodyRoots(files: { text: string }[]): {
    bodies: Set<string>;
    queries: Set<string>;
  } {
    const bodies = new Set<string>();
    const queries = new Set<string>();
    for (const { text } of files) {
      const source = code(text);
      for (const [, name] of source.matchAll(
        /@Body\([^)]*\)\s*\w+\s*:\s*(\w+)/g,
      )) {
        bodies.add(name);
      }
      for (const [, name] of source.matchAll(
        /@Query\([^)]*\)\s*\w+\s*:\s*(\w+)/g,
      )) {
        queries.add(name);
      }
      // Validated by hand with the pipe's options: `const dto =
      // plainToInstance(X, …)` then `validate(dto, VALIDATION_PIPE_OPTIONS)`.
      for (const [, variable] of source.matchAll(
        /validate\(\s*(\w+)\s*,\s*VALIDATION_PIPE_OPTIONS/g,
      )) {
        const built = new RegExp(
          `\\b${variable}\\s*=\\s*plainToInstance\\(\\s*(\\w+)`,
        ).exec(source);
        bodies.add(built ? built[1] : `<unresolved: ${variable}>`);
      }
    }
    return { bodies, queries };
  }

  /** The roots and every class they nest (`@Type(() => X)`) or extend. */
  function reachable(
    roots: Set<string>,
    classes: Map<string, string>,
  ): Set<string> {
    const seen = new Set<string>();
    const visit = (name: string) => {
      if (seen.has(name)) return;
      seen.add(name);
      const body = classes.get(name);
      if (!body) return;
      for (const [, nested] of body.matchAll(
        /@Type\(\s*\(\)\s*=>\s*(\w+)\s*\)/g,
      )) {
        visit(nested);
      }
      const heritage = body.slice(0, body.indexOf('{'));
      for (const [, parent] of heritage.matchAll(/\b([A-Z]\w*Dto)\b/g)) {
        visit(parent);
      }
    };
    roots.forEach(visit);
    return seen;
  }

  /** `Class: transform` for each primitive transform on a body class. */
  function findings(files: { text: string }[]): string[] {
    const classes = new Map<string, string>();
    for (const { text } of files) {
      for (const [name, body] of classesIn(text)) classes.set(name, body);
    }
    const { bodies } = bodyRoots(files);
    return [...reachable(bodies, classes)].flatMap((name) => {
      if (name.startsWith('<unresolved')) return [`${name}: not found`];
      const body = classes.get(name) ?? '';
      return [...body.matchAll(PRIMITIVE)].map(([hit]) => `${name}: ${hit}`);
    });
  }

  it('**1. carries no primitive transform**', () => {
    expect(findings(readListed(gatewayFiles()))).toEqual([]);
  });

  it('**2. is never also a query class**', () => {
    const { bodies, queries } = bodyRoots(readListed(gatewayFiles()));
    expect([...bodies].filter((name) => queries.has(name))).toEqual([]);
  });

  it('**3. the scan reaches real bodies, and sees each kind of finding**', () => {
    const { bodies } = bodyRoots(readListed(gatewayFiles()));
    expect(bodies.size).toBeGreaterThan(50);
    // The hand-validated inbound mail is a root, found from its `validate` call.
    expect(bodies).toContain('InboundEmailDto');

    const fixture = [
      {
        text: [
          'class C { @Post() a(@Body() dto: CreateDto) {} @Get() b(@Query() q: ListDto) {} }',
          'class CreateDto {',
          '  // @ToBoolean() in a comment is not a decorator',
          '  @Type(() => ItemDto) readonly items!: ItemDto[];',
          '  @Transform(trimIfString) readonly name!: string;',
          '}',
          'class ItemDto { @Type(() => Number) readonly size!: number; }',
          'class UpdateDto extends PartialType(BaseDto) {}',
          'class BaseDto { @ToBoolean() readonly on?: boolean; }',
          'class ListDto { @Type(() => Number) readonly page?: number; }',
          'class S { async run() { const dto = plainToInstance(UpdateDto, x);',
          '  await validate(dto, VALIDATION_PIPE_OPTIONS); } }',
          'class OtherDto { @Transform(({ value }) => Number(value)) readonly n!: number; }',
          'class D { a(@Body() other: OtherDto) {} }',
        ].join('\n'),
      },
    ];
    expect(findings(fixture).sort()).toEqual(
      [
        'BaseDto: @ToBoolean(',
        'ItemDto: @Type(() => Number)',
        'OtherDto: @Transform(',
      ].sort(),
    );
  });
});
