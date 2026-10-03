package com.synapsedesk.gateway.openapi;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.Operation;
import io.swagger.v3.oas.models.security.SecurityRequirement;
import io.swagger.v3.oas.models.security.SecurityScheme;
import java.util.List;
import org.springdoc.core.customizers.GlobalOpenApiCustomizer;
import org.springdoc.core.customizers.OperationCustomizer;
import org.springframework.stereotype.Component;
import org.springframework.web.method.HandlerMethod;

/**
 * Publishes the credential each route needs: the three cookie schemes once, and
 * per operation either the default or the one named by {@link RouteSecurity}.
 *
 * <p><b>Secured by default.</b> Authentication is inline in each handler, so
 * nothing in the code says "this route is secured". Measured against Node's
 * document, 214 of 230 operations are secured by the session cookie and 16
 * are not; so the rule is the default plus 16 markers, and a new route is
 * published as secured until someone marks it otherwise (the safe direction).
 * The behaviour that backs the default (a caller with no session is refused with
 * 401 before any peer is asked) is held by the anonymous-caller contract rows.
 */
@Component
public class SecurityOpenApiCustomizer
  implements OperationCustomizer, GlobalOpenApiCustomizer
{

  static final String ACCESS = "access-cookie";
  static final String MFA = "mfa-cookie";
  static final String REFRESH = "refresh-cookie";

  @Override
  public Operation customize(Operation operation, HandlerMethod handlerMethod) {
    RouteSecurity marker = handlerMethod.getMethodAnnotation(
      RouteSecurity.class
    );
    if (marker == null) return operation.security(List.of(requirement(ACCESS)));
    return switch (marker.value()) {
      case NONE -> operation.security(List.of());
      case REFRESH_COOKIE -> operation.security(List.of(requirement(REFRESH)));
      case MFA_COOKIE -> operation.security(List.of(requirement(MFA)));
      case SESSION_OR_CHALLENGE -> operation.security(
        List.of(requirement(ACCESS))
      );
    };
  }

  @Override
  public void customise(OpenAPI openApi) {
    openApi
      .getComponents()
      .addSecuritySchemes(ACCESS, cookie("access_token"))
      .addSecuritySchemes(MFA, cookie("mfa_token"))
      .addSecuritySchemes(REFRESH, cookie("refresh_token"));
  }

  private static SecurityRequirement requirement(String scheme) {
    return new SecurityRequirement().addList(scheme);
  }

  private static SecurityScheme cookie(String name) {
    return new SecurityScheme()
      .type(SecurityScheme.Type.APIKEY)
      .in(SecurityScheme.In.COOKIE)
      .name(name);
  }
}
