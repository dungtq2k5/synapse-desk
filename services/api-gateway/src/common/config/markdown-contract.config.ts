/**
 * The contract for every free-text field that accepts markdown.
 *
 * **Written once because it is a PROMISE, not a description.** Nine fields carry
 * it — `description` on tickets, departments, roles and organizations, and
 * `content` on messages — and nine copies of a promise drift into nine slightly
 * different promises, one of which eventually says something the API does not do.
 *
 * The promise has two halves and the second is the load-bearing one:
 *
 * 1. **Stored verbatim.** Nothing sanitizes, escapes or transforms these fields
 *    beyond trimming. Markdown round-trips byte for byte, and always has — this
 *    records an existing property rather than announcing a new one.
 * 2. **Renderers must disable raw HTML.** Markdown permits inline HTML by
 *    specification and nothing here strips it, so a `<script>` in a ticket
 *    description is stored and returned exactly as sent. That is correct for a
 *    JSON API — a browser does not execute a JSON response body — and it means
 *    the ENTIRE obligation sits with whoever renders it.
 *
 * A renderer with HTML passthrough enabled turns all nine into stored XSS, and
 * nothing on this side would indicate it. That is why this reaches the frontend
 * through Swagger rather than living only in a docblock the client never sees.
 */
export const MARKDOWN_FIELD_CONTRACT =
  'Markdown is accepted and preserved unmodified — this field is never ' +
  'sanitized, escaped or transformed beyond trimming. Renderers MUST disable ' +
  'raw HTML: markdown permits inline HTML, none is stripped here, and a ' +
  'renderer that passes it through turns this field into stored XSS.';
