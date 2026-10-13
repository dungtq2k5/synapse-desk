/**
 * Swagger UI over the committed API document, in development only (the
 * `docs` profile in docker-compose.yml).
 *
 * The document names no `servers`, so "Try it out" would call this page's own
 * origin. Calls under /api/ go to the gateway instead, carrying its cookies
 * (`withCredentials`, from WITH_CREDENTIALS): sign in with POST
 * /api/v1/auth/login here and the other calls are signed in too.
 *
 * At start the image's configurator replaces the block between the markers
 * with a `SwaggerUIBundle({...})` call built from the container's
 * environment; the wrapper above it adds the rewrite to whatever that builds.
 */
const GATEWAY = 'http://localhost:3000';

window.onload = function () {
  const toGateway = (request) => {
    const url = new URL(request.url, window.location.href);
    if (
      url.origin === window.location.origin &&
      url.pathname.startsWith('/api/')
    ) {
      request.url = GATEWAY + url.pathname + url.search;
    }
    return request;
  };
  // eslint-disable-next-line no-unused-vars -- called by the configured block
  const SwaggerUIBundle = Object.assign(
    (options) =>
      window.SwaggerUIBundle({ ...options, requestInterceptor: toGateway }),
    window.SwaggerUIBundle,
  );

  //<editor-fold desc="Changeable Configuration Block">
  window.ui = SwaggerUIBundle({
    url: './openapi.json',
    dom_id: '#swagger-ui',
  });
  //</editor-fold>
};
