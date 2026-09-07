/**
 * @file The response-header policy, in one object both bootstraps read.
 *
 * **Written against exactly one HTML page.** Everything this gateway serves is
 * JSON — REST under the global prefix, `/health*`, `/version`, and `/graphql`
 * with `playground: false` — except the Swagger UI at `${GLOBAL_PREFIX}/docs`,
 * which Nest renders from its own template plus `swagger-ui-dist`. So the CSP
 * below is a policy for that page; on every other route the headers cost
 * nothing and say the right thing anyway.
 *
 * **In `main.ts` rather than an ingress `configuration-snippet`.** The policy
 * describes what a page this repository serves is allowed to load, and it moves
 * when that page moves — a Swagger version that adds a CDN script changes it.
 * Versioned with the code that decides it, it survives a change of ingress
 * controller; in the Ingress it is one annotation away from being lost with the
 * controller.
 */

import type { HelmetOptions } from 'helmet';

export const SECURITY_HEADERS: HelmetOptions = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],

      /**
       * **No `'unsafe-inline'`, and no nonce, because the page has no inline
       * script.** Nest's template ends with `<% customJs %>` and
       * `<% customJsStr %>`; both render `''` when unset, and `swagger.config.ts`
       * sets neither. Every `<script src>` it emits is `<% baseUrl %>`-relative,
       * so `'self'` covers them.
       *
       * Setting either option would emit an inline `<script>` and break the
       * page under this directive — silently, in a browser, not in any test.
       * `security-headers.e2e-spec.ts` test 3 is the assertion that fires then.
       */
      scriptSrc: ["'self'"],

      /**
       * **`'unsafe-inline'` is required by the template's `<head>` reset, not
       * by the `customCss` slot.** The template carries two `<style>` elements:
       * an unconditional `html { box-sizing: … }` block in `<head>`, and
       * `<style><% customCss %><% explorerCss %></style>` at the end of `<body>`.
       * Only the second is a slot, and it is unset.
       *
       * So the obvious tightening — "drop `'unsafe-inline'`, `customCss` is
       * empty" — breaks the page on the other block. Swagger UI also injects
       * styles at runtime, which is the second reason.
       */
      styleSrc: ["'self'", "'unsafe-inline'"],

      /** `swagger-ui.css` carries one `data:` image URI. */
      imgSrc: ["'self'", 'data:'],

      /** "Try it out" posts back to this origin. */
      connectSrc: ["'self'"],

      frameAncestors: ["'none'"],
      objectSrc: ["'none'"],
    },
  },

  /** Belt and braces with `frameAncestors` above, for older browsers. */
  frameguard: { action: 'deny' },

  /**
   * Off, which is helmet v8's own default — stated rather than inherited.
   * COEP breaks any cross-origin subresource that does not opt in, and this
   * page loads none; turning it on would buy nothing and could break the docs.
   */
  crossOriginEmbedderPolicy: false,
};
