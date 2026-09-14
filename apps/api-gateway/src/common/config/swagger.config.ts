import { Logger, type INestApplication } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';
import {
  apiBasePath,
  resolveGlobalPrefix,
} from '../../modules/health/ops-routes';

/**
 * The security-scheme KEYS routes reference.
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
 * The staleness contract, published.
 *
 * **Written before any response cache exists, deliberately.** A limit stated up
 * front is a contract; the same limit discovered by a client is a bug report.
 * And writing it down is what has kept the cached list short: every entry below
 * had to survive being described to the people who will be surprised by it.
 *
 * Rendered at `/docs`, so it reaches the people the caching actually affects
 * rather than living in a design document only this team reads.
 */
const CACHING_CONTRACT = [
  '## Caching and staleness',
  '',
  'Some reads are served from a shared cache. An operation that is cached ' +
    'says so in its `x-cache` extension: `{ scope, ttlSeconds, varyBy }`. ' +
    'Everything else is computed per request.',
  '',
  '**A cached read can be stale for at most its TTL, and usually far less.** ' +
    'Cache entries are keyed by `(tenant, scope, parameters)` rather than by ' +
    'URL, so a write CAN find and evict them — a mutation drops its whole ' +
    'scope for that tenant before it answers, and changes that originate ' +
    'elsewhere in the system (a WebSocket message, a background job, another ' +
    'service) evict through domain events. The TTL is the backstop for a ' +
    'writer nobody has enumerated, not the mechanism.',
  '',
  '`varyBy` says what the entry depends on. `tenant` means every member of ' +
    'your organization shares one answer. `caller` means the answer is ' +
    'filtered by what you can see — `GET /documents` is scoped to your ' +
    'departments — so it is shared only with people whose visibility matches ' +
    'yours.',
  '',
  '**The one entry with no eviction is `GET /permissions`.** The permission ' +
    'catalogue is seeded and changes on deploy, so there is no request that ' +
    'could invalidate it; its one-hour TTL is the whole story.',
  '',
  '**Tickets, messages and notifications are never cached**, and neither is ' +
    '`GET /notifications/unread-count` — the WebSocket pushes that ' +
    'authoritatively, so polling it is the thing to remove rather than the ' +
    'thing to speed up.',
  '',
  '### GraphQL',
  '',
  'There is **no response cache** on `/graphql`. A GraphQL response key would ' +
    'be a hash of the query document, and nothing in such a key says which ' +
    'entities the answer contains — so no write could ever find it, and a ' +
    'cached response would be stale for its full TTL no matter what changed. ' +
    'What is cached instead are the individual entities behind edges ' +
    '(`assignee`, `author`, `sender`, `actor`, `department`), keyed one per ' +
    'entity and evicted precisely when that entity changes.',
  '',
  '### Your half',
  '',
  'After a mutation, refetch or update your own store rather than trusting ' +
    'the next query to be fresh. A mutation returns fresh data to its own ' +
    "caller; another tab holding a rendered list is the server's problem only " +
    'up to the eviction it just performed. Apollo Client does this by default ' +
    'with normalized cache updates.',
].join('\n');

/**
 * Builds the OpenAPI document.
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
        'not just its payload.\n\n' +
        CACHING_CONTRACT,
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
    // **`TENANT_SELECTION_NAME` is deliberately absent**. It carries
    // a half-finished multi-tenant login between its two legs; it is not a
    // credential, and documenting it as a security scheme invites a client to
    // treat it as one and send it where an access token belongs.
    .build();

  return SwaggerModule.createDocument(app, config);
}

/**
 * Mounts `/api/v1/docs` and `/api/v1/docs-json` when config allows.
 *
 * **Under the version, not beside it.** The mount is built from the same
 * `API_VERSION` the routes use, so the page and the version it documents move
 * together. `docs-json` is the URL client SDKs are generated from, which makes
 * its address part of the contract.
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
  const basePath = apiBasePath(
    resolveGlobalPrefix(configService.getOrThrow<string>('GLOBAL_PREFIX')),
  );

  const document = buildOpenApiDocument(app, configService);

  // **Under the global prefix**, matching the reference and — more importantly —
  // matching whatever a production proxy is configured to block. A `/docs`
  // disabled in the app but reachable through a stale proxy rule is config
  // drift nobody tests for; keeping the path predictable is half of not having
  // that problem. Note this is the opposite choice from `OPS_ROUTES`, and for
  // the opposite reason: a probe must be findable by an orchestrator that knows
  // no prefix, while docs are read by API consumers who already use one.
  SwaggerModule.setup(`${basePath}/docs`, app, document, {
    // `/docs-json` is the more valuable half: it generates client SDKs and it is
    // what the contract test reads.
    jsonDocumentUrl: `${basePath}/docs-json`,
    swaggerOptions: {
      // Sends the auth cookies from "Try it out".
      withCredentials: true,
      // Survives a page reload, so exploring the API is not a re-login per route.
      persistAuthorization: true,
    },
  });

  logger?.log(
    `📑 [API Gateway] Swagger docs available at http://localhost:${port}${basePath}/docs`,
  );
}
