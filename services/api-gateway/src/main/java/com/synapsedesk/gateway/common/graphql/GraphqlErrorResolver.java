package com.synapsedesk.gateway.common.graphql;

import graphql.GraphQLError;
import graphql.GraphqlErrorBuilder;
import graphql.schema.DataFetchingEnvironment;
import org.springframework.graphql.execution.DataFetcherExceptionResolverAdapter;
import org.springframework.graphql.execution.ErrorType;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Maps a {@link ResponseStatusException} — the SAME exception {@code
 * CurrentUser.require}, {@link com.synapsedesk.gateway.common.security.PermissionChecker}
 * and every resolver's own guard throw — to a proper GraphQL error instead
 * of the generic `INTERNAL_ERROR` Spring for GraphQL gives an unrecognized
 * exception.
 *
 * <p><b>Found, not assumed.</b> `PermissionChecker` throwing this exception
 * is exactly what makes it the ONE checker `PermissionInterceptor` (REST)
 * and `GraphqlPermissionAspect` (GraphQL) share — but Spring MVC and Spring
 * for GraphQL disagree on what an unhandled `ResponseStatusException` means:
 * MVC turns it into the right HTTP status by itself; GraphQL has no
 * equivalent and answers 403 the same way it answers a NullPointerException,
 * measured directly against a running instance. Without this resolver, a
 * refused GraphQL field looks identical to a crash.
 */
@Component
public class GraphqlErrorResolver extends DataFetcherExceptionResolverAdapter {

  @Override
  protected GraphQLError resolveToSingleError(
    Throwable exception,
    DataFetchingEnvironment environment
  ) {
    if (!(exception instanceof ResponseStatusException statusException)) {
      return null;
    }

    ErrorType errorType = errorTypeFor(statusException.getStatusCode());
    String message =
      statusException.getReason() != null
        ? statusException.getReason()
        : statusException.getMessage();

    return GraphqlErrorBuilder.newError(environment)
      .message(message)
      .errorType(errorType)
      .build();
  }

  private static ErrorType errorTypeFor(
    org.springframework.http.HttpStatusCode status
  ) {
    if (status.equals(HttpStatus.FORBIDDEN)) {
      return ErrorType.FORBIDDEN;
    }
    if (status.equals(HttpStatus.UNAUTHORIZED)) {
      return ErrorType.UNAUTHORIZED;
    }
    if (status.equals(HttpStatus.NOT_FOUND)) {
      return ErrorType.NOT_FOUND;
    }
    if (status.equals(HttpStatus.BAD_REQUEST)) {
      return ErrorType.BAD_REQUEST;
    }

    return ErrorType.INTERNAL_ERROR;
  }
}
