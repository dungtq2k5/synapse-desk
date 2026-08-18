/**
 * @file The `@nestjs/swagger` CLI plugin, as a ts-jest AST transformer.
 *
 * **Without this, every OpenAPI test in this workspace passes vacuously.** The
 * plugin is a TypeScript transformer that reads existing types and
 * class-validator decorators and emits `@ApiProperty` at compile time. `nest
 * build` runs it because `nest-cli.json` says so; jest compiles the same source
 * through ts-jest, which knows nothing about `nest-cli.json` — so a suite that
 * asserted on `components.schemas` would find them empty and an assertion like
 * "no schema is missing properties" would be true of a spec with no schemas at
 * all.
 *
 * That is the confusing hour this guards against: it works in dev, and the
 * schema is empty in the assertion.
 *
 * **CommonJS on purpose.** ts-jest `require()`s this file directly rather than
 * going through jest's ESM loader, so a `.ts` or `.mjs` module here fails with
 * an unhelpful error about an unexpected token.
 *
 * The options MUST match `nest-cli.json`'s. Two copies is not ideal and is the
 * lesser evil: the alternative is jest parsing a file the Nest CLI owns, and a
 * drift here is caught by `swagger-plugin.e2e-spec.ts`, which asserts the
 * behaviour both configs exist to produce rather than the configs themselves.
 */

const swaggerPlugin = require('@nestjs/swagger/plugin');

module.exports = {
  name: 'nestjs-swagger-plugin',
  version: 1,
  factory(compilerInstance) {
    return swaggerPlugin.before(
      {
        // See `nest-cli.json` — these must stay in step.
        //
        // `.base.ts` used to sit beside `.dto.ts`, because `UserBase` held the
        // fields of the most-used response in the API and matched neither of
        // the plugin's defaults. There are no `.base.ts` files left: REST and
        // GraphQL DTOs are independent classes and every REST one is a
        // `*.dto.ts`, which the default suffix already covers.
        //
        // GraphQL types are `*.gql-dto.ts` — deliberately NOT ending in
        // `.dto.ts`, so the plugin never introspects a type that has no
        // business in the OpenAPI document.
        dtoFileNameSuffix: ['.dto.ts'],
        introspectComments: true,
        classValidatorShim: true,
      },
      compilerInstance.program,
    );
  },
};
