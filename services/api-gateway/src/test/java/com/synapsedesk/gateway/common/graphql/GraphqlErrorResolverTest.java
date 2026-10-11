package com.synapsedesk.gateway.common.graphql;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import graphql.GraphQLError;
import graphql.language.Field;
import graphql.language.SourceLocation;
import graphql.schema.DataFetchingEnvironment;
import org.junit.jupiter.api.Test;
import org.springframework.graphql.execution.ErrorType;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/** Every `ResponseStatusException` this gateway's shared checks throw, mapped to a real GraphQL error. */
class GraphqlErrorResolverTest {

  private final GraphqlErrorResolver resolver = new GraphqlErrorResolver();
  private final DataFetchingEnvironment environment = mock(
    DataFetchingEnvironment.class
  );

  {
    Field field = mock(Field.class);
    when(field.getSourceLocation()).thenReturn(new SourceLocation(1, 1));
    when(environment.getField()).thenReturn(field);
    when(environment.getExecutionStepInfo()).thenReturn(
      mock(graphql.execution.ExecutionStepInfo.class)
    );
  }

  @Test
  void forbiddenMapsToTheForbiddenErrorType() {
    GraphQLError error = resolveSingle(
      new ResponseStatusException(
        HttpStatus.FORBIDDEN,
        "Requires one of: department.read"
      )
    );

    assertThat(error.getErrorType()).isEqualTo(ErrorType.FORBIDDEN);
    assertThat(error.getMessage()).isEqualTo(
      "Requires one of: department.read"
    );
  }

  @Test
  void unauthorizedMapsToTheUnauthorizedErrorType() {
    GraphQLError error = resolveSingle(
      new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Unauthorized")
    );

    assertThat(error.getErrorType()).isEqualTo(ErrorType.UNAUTHORIZED);
  }

  @Test
  void anUnrelatedExceptionIsLeftForTheDefaultHandling() {
    assertThat(
      resolver.resolveToSingleError(
        new IllegalStateException("boom"),
        environment
      )
    ).isNull();
  }

  private GraphQLError resolveSingle(ResponseStatusException exception) {
    return resolver.resolveToSingleError(exception, environment);
  }
}
