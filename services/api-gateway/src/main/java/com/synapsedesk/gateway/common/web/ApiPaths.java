package com.synapsedesk.gateway.common.web;

/**
 * The global prefix, {@code api}, combined with the one version URI
 * versioning currently serves. Not runtime config: there is nothing to
 * bind, since the prefix has no other legal value.
 *
 * <p><b>A constant, not a context-path.</b> Every route still declares its
 * own full path at compile time ({@code @RequestMapping(ApiPaths.V1)} at the
 * class level, the route's own segment on each method) rather than moving
 * the prefix into {@code server.servlet.context-path}: springdoc folds a
 * context-path out of {@code paths} and into {@code servers}, which would
 * rewrite all 230 path entries in the committed document
 * ({@code docs/reference/openapi.json}). This way springdoc sees exactly the
 * literal paths it always has.
 *
 * <p><b>No version-resolution mechanism.</b> A future breaking route is a
 * {@code v2} beside the original, never an edit in place — ADR 0045. Today
 * there is one legal version, held as this constant; adding a real
 * {@code v2} route means introducing a resolution mechanism, not flipping
 * this constant. Filed as a gap.
 */
public final class ApiPaths {

  public static final String V1 = "/api/v1";

  private ApiPaths() {}
}
