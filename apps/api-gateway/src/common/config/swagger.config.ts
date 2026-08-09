import { Logger, type INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';

/**
 * The security-scheme KEYS routes reference — 24-doc §3.
 *
 * **This API authenticates with four cookies, not one bearer token**, and three
 * of them are genuine credentials with genuinely different scopes. Naming them
 * here rather than as string literals at 184 call sites is what stops
 * `@ApiCookieAuth('access_cookie')` — underscore, silently matching no defined
 * scheme — from rendering as an unauthenticated route.
 */
export const AUTH_SCHEMES = {
  /** Every `USER` / `perm:` / `SUPER` route. */
  access: 'access-cookie',
  /** The 2FA challenge routes only — proves a password and nothing else. */
  mfa: 'mfa-cookie',
  /** `POST /auth/refresh` alone. */
  refresh: 'refresh-cookie',
} as const;

/**
 * Builds the OpenAPI document — 24-doc §3.
 *
 * Exported and called from BOTH `main.ts` and the spec tests, deliberately. A
 * test that built its own document would assert on a spec no client ever
 * receives, which is the exact failure mode a documentation test exists to
 * prevent.
 */
export function buildOpenApiDocument(
  app: INestApplication,
  configService: ConfigService,
): OpenAPIObject {
  const cookie = (name: string) =>
    ({ type: 'apiKey', in: 'cookie', name }) as const;

  const config = new DocumentBuilder()
    .setTitle('SynapseDesk API')
    .setDescription(
      'The REST surface of the SynapseDesk gateway. Every response is wrapped ' +
        'in the standard envelope — `{ success, statusCode, message, warning, ' +
        'data }` on success and `{ success, statusCode, path, timestamp, error }` ' +
        'on failure — so the schema shown for a route describes the whole body, ' +
        'not just its payload.',
    )
    .setVersion(configService.get<string>('APP_VERSION') ?? '0.0.0')
    // Cookies, not a bearer token. `withCredentials` below is what makes "Try
    // it out" actually send them — without it the browser omits them and every
    // authenticated route in the UI returns 401, which reads as a broken API.
    .addCookieAuth(
      configService.getOrThrow<string>('JWT_ACCESS_NAME'),
      cookie(configService.getOrThrow<string>('JWT_ACCESS_NAME')),
      AUTH_SCHEMES.access,
    )
    .addCookieAuth(
      configService.getOrThrow<string>('JWT_2FA_NAME'),
      cookie(configService.getOrThrow<string>('JWT_2FA_NAME')),
      AUTH_SCHEMES.mfa,
    )
    .addCookieAuth(
      configService.getOrThrow<string>('JWT_REFRESH_NAME'),
      cookie(configService.getOrThrow<string>('JWT_REFRESH_NAME')),
      AUTH_SCHEMES.refresh,
    )
    // **`TENANT_SELECTION_NAME` is deliberately absent** — 24-doc §3. It carries
    // a half-finished multi-tenant login between its two legs; it is not a
    // credential, and documenting it as a security scheme invites a client to
    // treat it as one and send it where an access token belongs.
    .build();

  return SwaggerModule.createDocument(app, config);
}

/**
 * Mounts `/docs` and `/docs-json` when config allows — 24-doc §4.
 *
 * **Gated on `SWAGGER_ENABLED`, not on an inline `NODE_ENV` check.** The plan
 * says "PUBLIC in non-prod", and `NODE_ENV !== 'production'` written at a call
 * site is the condition that gets inverted during a refactor with nobody
 * noticing — because the failure direction is MORE exposure, and more exposure
 * looks like everything working.
 *
 * The default is off, so an environment that never considered the question is
 * closed rather than open.
 */
export function setupSwagger(
  app: INestApplication,
  configService: ConfigService,
  logger?: Logger,
): void {
  if (!configService.get<boolean>('SWAGGER_ENABLED')) return;

  const port = configService.getOrThrow<number>('PORT');
  const globalPrefix = configService.getOrThrow<string>('GLOBAL_PREFIX');

  const document = buildOpenApiDocument(app, configService);

  // **Under the global prefix**, matching the reference and — more importantly —
  // matching whatever a production proxy is configured to block. A `/docs`
  // disabled in the app but reachable through a stale proxy rule is config
  // drift nobody tests for; keeping the path predictable is half of not having
  // that problem. Note this is the opposite choice from `OPS_ROUTES`, and for
  // the opposite reason: a probe must be findable by an orchestrator that knows
  // no prefix, while docs are read by API consumers who already use one.
  SwaggerModule.setup(`${globalPrefix}/docs`, app, document, {
    // `/docs-json` is the more valuable half: it generates client SDKs and it is
    // what the contract test reads.
    jsonDocumentUrl: `${globalPrefix}/docs-json`,
    swaggerOptions: {
      // Sends the auth cookies from "Try it out".
      withCredentials: true,
      // Survives a page reload, so exploring the API is not a re-login per route.
      persistAuthorization: true,
    },
  });

  logger?.log(
    `📑 [API Gateway] Swagger docs available at http://localhost:${port}${globalPrefix}/docs`,
  );
}
