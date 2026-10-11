package com.synapsedesk.gateway.graphql;

import com.synapsedesk.gateway.config.RuntimeProperties;
import com.synapsedesk.gateway.lifecycle.OrgAccess;
import com.synapsedesk.gateway.lifecycle.OrgAccessKind;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.stereotype.Controller;

/**
 * `Query.version` — the wiring smoke test: one field, no
 * permission, no peer, so a failure here is the schema/wiring itself, not a
 * resolver's own logic. The GraphQL twin of {@code OpsController}'s
 * `GET /version`, built from the same {@link RuntimeProperties}.
 *
 * <p>
 * Not named `*Resolver`... it is, deliberately, even though it carries no
 * `@RequirePermission` —
 * {@link com.synapsedesk.gateway.security.GraphqlPermissionAspect}
 * only advises methods that carry the annotation, so an unguarded resolver
 * costs nothing extra by matching the pointcut's class-name half.
 */
@Controller
@OrgAccessKind(OrgAccess.AUTH)
public class VersionResolver {

  private final RuntimeProperties runtime;

  public VersionResolver(RuntimeProperties runtime) {
    this.runtime = runtime;
  }

  @QueryMapping
  public VersionGqlDto version() {
    return new VersionGqlDto(
      runtime.appVersion(),
      runtime.buildSha(),
      runtime.buildTime()
    );
  }
}
