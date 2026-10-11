package com.synapsedesk.gateway.common.error;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.common.web.SortDirection;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

/**
 * A request parameter that does not convert is the client's mistake: 400, naming
 * the field, and for an enum the values it may take, in class-validator's wording.
 * Without the handler it would fall through to the catch-all and answer 500.
 */
class ParameterTypeMismatchTest {

  private final GatewayExceptionHandler handler = new GatewayExceptionHandler();

  private ResponseEntity<ErrorEnvelope> answer(
    Object value,
    Class<?> type,
    String name
  ) {
    MockHttpServletRequest request = new MockHttpServletRequest(
      "GET",
      "/api/v1/departments"
    );

    return handler.onParameterTypeMismatch(
      new MethodArgumentTypeMismatchException(
        value,
        type,
        name,
        null,
        new IllegalArgumentException("no conversion")
      ),
      request
    );
  }

  @Test
  void anEnumValueOutsideItsSetIsA400ThatListsTheSet() {
    ResponseEntity<ErrorEnvelope> response = answer(
      "sideways",
      SortDirection.class,
      "sortOrder"
    );

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(response.getBody().error()).isEqualTo(
      "sortOrder must be one of the following values: ASC, DESC!"
    );
  }

  @Test
  void aCaseVariantOfAnEnumValueIsRefusedToo() {
    // `desc` is not `DESC`: the document's enum is exact.
    assertThat(
      answer("desc", SortDirection.class, "sortOrder").getStatusCode()
    ).isEqualTo(HttpStatus.BAD_REQUEST);
  }

  @Test
  void anyOtherUnconvertibleParameterIsA400NamingTheField() {
    ResponseEntity<ErrorEnvelope> response = answer(
      "not-a-uuid",
      UUID.class,
      "ticketId"
    );

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
    assertThat(response.getBody().error()).isEqualTo(
      "ticketId must be a valid UUID!"
    );
  }
}
