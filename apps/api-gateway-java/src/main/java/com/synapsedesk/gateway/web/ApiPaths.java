package com.synapsedesk.gateway.web;

/**
 * The one legal value of Node's {@code GLOBAL_PREFIX} — Joi-pinned to
 * {@code /^\/?api$/}, always {@code api} in every env file and the
 * ConfigMap — combined with the one version URI versioning currently
 * serves. Not runtime config: there is nothing to bind, since the prefix
 * has no other legal value.
 *
 * <p><b>A constant, not a context-path.</b> Every route still declares its
 * own full path at compile time ({@code @RequestMapping(ApiPaths.V1)} at the
 * class level, the route's own segment on each method) rather than moving
 * the prefix into {@code server.servlet.context-path}: springdoc folds a
 * context-path out of {@code paths} and into {@code servers}, which would
 * rewrite all 230 path entries in the generated document and diverge from
 * the committed Node one. This way springdoc sees exactly the literal paths
 * it always has.
 *
 * <p><b>No version-resolution mechanism.</b> Node has one enabled (URI
 * versioning, default {@code 1}) so a future breaking route is a
 * {@code @Version('2')} beside the original, never an edit in place — ADR
 * 0045. Java has the same one legal value today, as a constant instead of a
 * config read, which is the same freedom through a different mechanism.
 * What Java does NOT yet have is Node's actual resolution machinery: adding
 * a real {@code v2} route here means introducing one, not flipping this
 * constant. Filed as a gap, not a divergence from the ADR.
 */
public final class ApiPaths {

  public static final String V1 = "/api/v1";

  private ApiPaths() {}
}
