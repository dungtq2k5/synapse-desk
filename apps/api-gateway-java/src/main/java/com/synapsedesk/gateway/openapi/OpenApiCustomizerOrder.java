package com.synapsedesk.gateway.openapi;

/**
 * The order the document customizers run in, as one contract.
 *
 * <p>No framework infers it. Two customizers that touch the same output, with no
 * declared order, run in registration order, and the one that runs last wins: measured
 * here when the prose overlay ran before the nullability rules, which then replaced two
 * described properties with an undescribed {@code oneOf} wrapper. So every customizer
 * takes its place from this class, and each place says what it must come after.
 *
 * <p>springdoc applies each kind separately (property and parameter customizers while
 * it builds schemas, operation customizers per handler, document customizers at the end),
 * so the order only matters within a kind, and each kind is listed on its own.
 */
public final class OpenApiCustomizerOrder {

  private OpenApiCustomizerOrder() {}

  // ---- operation customizers, per handler (SecurityOpenApiCustomizer is one too, at
  // SECURITY_SCHEMES below: a class carries one order, and it touches only `security`)
  /** The operation's id. Touches only {@code operationId}. */
  public static final int OPERATION_ID = 20;
  /** The error responses. Adds responses; must not see a half-built set, so it runs last. */
  public static final int ERROR_ENVELOPE = 30;

  // ---- document customizers, at the end
  /** Drops annotation-default bounds. Before anything copies a schema. */
  public static final int DEFAULT_BOUNDS = 10;
  /** What a success body is: no content on a 204, {@code null} data on an acknowledgement. */
  public static final int SUCCESS_BODIES = 20;
  /** Response properties required, nullable where they may be null. May wrap a property. */
  public static final int RESPONSE_SCHEMAS = 30;
  /** Optional request properties nullable, no parameter nullable. May wrap a property. */
  public static final int REQUEST_NULLABILITY = 40;
  /** The cookie schemes, declared once; also each operation's {@code security}. */
  public static final int SECURITY_SCHEMES = 50;
  /** The prose. LAST: it describes the wrappers the two rules above create. */
  public static final int PROSE_OVERLAY = 1_000;
}
