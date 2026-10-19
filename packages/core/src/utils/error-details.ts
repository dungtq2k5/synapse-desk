/**
 * @file Carrying an error's `details` across the gRPC wire, beside its message.
 *
 * The REST error envelope has an optional `details` object for the refusals a
 * client acts on by data rather than by sentence (the over-limit items, the
 * organization's status). Only `code` and `details` survive a gRPC hop, so a
 * service that refuses with data puts it in the message behind a marker, and
 * the gateway lifts it out — the same carrier as `withHttpStatus`, which may
 * precede it.
 *
 * The object is base64url JSON, so nothing in it can end the marker early.
 *
 * @example withErrorDetails('Frozen', { organizationStatus: 'FROZEN' }) // '[details:eyJvcmdh…] Frozen'
 */

const MARKER = /^\[details:([A-Za-z0-9_-]+)]\s*/;

/** The `details` an error may carry: a plain JSON object. */
export type ErrorDetails = Record<string, unknown>;

/** Prefixes a message with details the gateway puts on the envelope. */
export function withErrorDetails(
  message: string,
  details: ErrorDetails,
): string {
  const encoded = Buffer.from(JSON.stringify(details)).toString('base64url');
  return `[details:${encoded}] ${message}`;
}

/**
 * Splits a possibly-marked message into `{ details, message }`.
 *
 * `details: null` for an unmarked message, and for a marker whose payload is
 * not a JSON object: that text is left as it was rather than half-read.
 */
export function readErrorDetails(message: string): {
  details: ErrorDetails | null;
  message: string;
} {
  const match = MARKER.exec(message);
  if (!match) return { details: null, message };

  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(match[1], 'base64url').toString('utf8'),
    );
    if (
      parsed === null ||
      typeof parsed !== 'object' ||
      Array.isArray(parsed)
    ) {
      return { details: null, message };
    }
    return {
      details: parsed as ErrorDetails,
      message: message.slice(match[0].length),
    };
  } catch {
    return { details: null, message };
  }
}
