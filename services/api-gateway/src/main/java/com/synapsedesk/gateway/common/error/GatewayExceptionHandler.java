package com.synapsedesk.gateway.common.error;

import io.grpc.StatusRuntimeException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.ConstraintViolationException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.ErrorResponse;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.resource.NoResourceFoundException;
import tools.jackson.databind.DatabindException;

/**
 * Every failure leaves as one {@link ErrorEnvelope}: status, `path` and one
 * message ending in `!`. The envelope and the text written here are the
 * published contract, and a client may show that text to its user.
 *
 * <p><b>Which rows are byte-equal and which are not is decided by where the
 * string is authored</b>, not by how important the row looks:
 *
 * <ul>
 *   <li><b>Exact</b> — 404's `Cannot GET <path>!`, the fixed transport
 *       message (gap 38), and the joining and trailing `!` of a validation
 *       400. All written here.
 *   <li><b>Opaque</b> — a malformed body and an unsupported content type.
 *       Their text belongs to the JSON parser and to the framework, and a
 *       parser can word three malformed bodies three different ways. The
 *       contract is the status, the envelope shape and `path`.
 *   <li><b>Split</b> — a validation 400 is one string containing both kinds:
 *       ours in the `, ` separator and the trailing `!`, the library's in each
 *       constraint's phrasing. Field NAMES are promised; the wording after
 *       them is not.
 * </ul>
 */
@RestControllerAdvice
public class GatewayExceptionHandler {

  /** A failed `@Valid` body: one message per broken rule, joined by {@link ErrorMessages#format}. */
  @ExceptionHandler(MethodArgumentNotValidException.class)
  public ResponseEntity<ErrorEnvelope> onValidationFailure(
    MethodArgumentNotValidException exception,
    HttpServletRequest request
  ) {
    // `field message` — the shape class-validator produces, so the FIELD
    // NAME is present and first. The phrasing after it is Bean Validation's
    // and is matched loosely.
    List<String> messages = exception
      .getBindingResult()
      .getFieldErrors()
      .stream()
      .map(error -> error.getField() + " " + error.getDefaultMessage())
      .collect(Collectors.toCollection(ArrayList::new));

    exception
      .getBindingResult()
      .getGlobalErrors()
      .forEach(error -> messages.add(error.getDefaultMessage()));

    return envelope(
      HttpStatus.BAD_REQUEST,
      request,
      ErrorMessages.format(messages)
    );
  }

  /**
   * A failed `@RequestParam`/`@PathVariable` constraint — `page=0` against
   * `@DecimalMin("1")`, for instance. A DIFFERENT exception from a failed
   * `@Valid` body: the generated `*Api` interfaces carry their constraints
   * on the INTERFACE method's parameters, so Spring validates them through
   * Bean Validation's own `MethodValidationInterceptor` (an AOP proxy around
   * the whole method call) rather than through the per-argument MVC pipeline
   * that throws {@link org.springframework.web.bind.MethodArgumentNotValidException}.
   * Uncaught, this fell through to the catch-all below as a plain
   * {@code Exception} and answered 500 — swallowing the field name and the
   * reason, on every route with a constrained query parameter, until the
   * first row that actually sent an out-of-bounds one.
   */
  @ExceptionHandler(ConstraintViolationException.class)
  public ResponseEntity<ErrorEnvelope> onConstraintViolation(
    ConstraintViolationException exception,
    HttpServletRequest request
  ) {
    List<String> messages = new ArrayList<>();

    for (ConstraintViolation<?> violation : exception.getConstraintViolations()) {
      // The path is `<method>.<parameter>` (e.g. `rolesControllerListV1.page`)
      // — the method name is an implementation detail nobody asked for; the
      // PARAMETER name is the field class-validator would have named too.
      String path = violation.getPropertyPath().toString();
      int lastDot = path.lastIndexOf('.');
      String field = lastDot < 0 ? path : path.substring(lastDot + 1);
      messages.add(field + " " + violation.getMessage());
    }

    return envelope(
      HttpStatus.BAD_REQUEST,
      request,
      ErrorMessages.format(messages)
    );
  }

  /**
   * A request parameter that does not convert to the type the handler declares:
   * an enum value outside its set ({@code sortOrder=sideways}), a non-numeric
   * number, a malformed UUID. Uncaught, it fell through to the catch-all below
   * as a 500, which a client reads as the gateway failing rather than as its own
   * mistake. The enum message uses class-validator's wording, so the field
   * name and the allowed values are what the client reads.
   */
  @ExceptionHandler(MethodArgumentTypeMismatchException.class)
  public ResponseEntity<ErrorEnvelope> onParameterTypeMismatch(
    MethodArgumentTypeMismatchException exception,
    HttpServletRequest request
  ) {
    Class<?> type = exception.getRequiredType();
    String message =
      type != null && type.isEnum()
        ? exception.getName() +
          " must be one of the following values: " +
          Arrays.stream(type.getEnumConstants())
            .map(Object::toString)
            .collect(Collectors.joining(", "))
        : exception.getName() +
          " must be a valid " +
          (type == null ? "value" : type.getSimpleName());

    return envelope(
      HttpStatus.BAD_REQUEST,
      request,
      ErrorMessages.format(message)
    );
  }

  /**
   * A body that could not be read. Malformed JSON is **opaque by decision**: that
   * message is the parser's and is not part of the contract. A body that parsed but does not
   * fit the class (an unknown key, a wrong type) is answered in our own words, naming
   * the field: Jackson's text for it names Java types, which are not the caller's
   * business.
   */
  @ExceptionHandler(HttpMessageNotReadableException.class)
  public ResponseEntity<ErrorEnvelope> onUnreadableBody(
    HttpMessageNotReadableException exception,
    HttpServletRequest request
  ) {
    // Searched for, not taken as the most specific cause: an enum's own refusal sits
    // BELOW the binding exception that knows which field it was.
    for (
      Throwable cause = exception.getCause();
      cause != null;
      cause = cause.getCause()
    ) {
      if (cause instanceof DatabindException binding) {
        return envelope(
          HttpStatus.BAD_REQUEST,
          request,
          ErrorMessages.format(BodyBindingMessage.of(binding))
        );
      }
    }
    String detail = exception.getMostSpecificCause().getMessage();

    return envelope(
      HttpStatus.BAD_REQUEST,
      request,
      ErrorMessages.format(
        detail == null ? "Malformed request body" : firstLine(detail)
      )
    );
  }

  /** No route. The message IS ours, so it is exact: `Cannot GET /api/v1/x!`. */
  @ExceptionHandler(NoResourceFoundException.class)
  public ResponseEntity<ErrorEnvelope> onNoRoute(HttpServletRequest request) {
    return envelope(
      HttpStatus.NOT_FOUND,
      request,
      ErrorMessages.format(
        "Cannot " + request.getMethod() + " " + request.getRequestURI()
      )
    );
  }

  /** A peer's failure, through the gap-38 rule. */
  @ExceptionHandler(StatusRuntimeException.class)
  public ResponseEntity<ErrorEnvelope> onPeerFailure(
    StatusRuntimeException exception,
    HttpServletRequest request
  ) {
    GrpcStatusMapping.ClientSafe safe = GrpcStatusMapping.resolve(
      exception.getStatus().getCode(),
      exception.getStatus().getDescription()
    );

    return envelope(safe.status(), request, safe.message());
  }

  /** Anything raised with a status already chosen. */
  @ExceptionHandler(ResponseStatusException.class)
  public ResponseEntity<ErrorEnvelope> onStatusException(
    ResponseStatusException exception,
    HttpServletRequest request
  ) {
    HttpStatus status = HttpStatus.valueOf(exception.getStatusCode().value());
    String reason = exception.getReason();

    return envelope(
      status,
      request,
      ErrorMessages.format(reason == null ? status.getReasonPhrase() : reason)
    );
  }

  /**
   * Everything else — and the framework's own refusals keep THEIR status.
   *
   * <p><b>Measured: a catch-all on `Exception` swallows them.</b> An
   * unsupported `Content-Type` answered 500 instead of 415 until this checked
   * for {@link ErrorResponse}, because `HttpMediaTypeNotSupportedException`
   * is an ordinary exception that Spring would otherwise have mapped itself.
   * Every framework refusal — 405, 406, 413, 415 — carries its status on that
   * interface, and its MESSAGE is the framework's, so the reason phrase is
   * used rather than its internal detail: opaque, by the same rule as a
   * malformed body.
   *
   * <p>The 500 text is fixed in every environment. The cause is logged, never
   * sent, so a development build needs no different text to show a stack.
   */
  @ExceptionHandler(Exception.class)
  public ResponseEntity<ErrorEnvelope> onAnythingElse(
    Exception exception,
    HttpServletRequest request
  ) {
    if (exception instanceof ErrorResponse refusal) {
      HttpStatus status = HttpStatus.valueOf(refusal.getStatusCode().value());

      return envelope(
        status,
        request,
        ErrorMessages.format(status.getReasonPhrase())
      );
    }

    return envelope(
      HttpStatus.INTERNAL_SERVER_ERROR,
      request,
      ErrorMessages.format("Internal server error")
    );
  }

  private ResponseEntity<ErrorEnvelope> envelope(
    HttpStatus status,
    HttpServletRequest request,
    String message
  ) {
    return ResponseEntity.status(status).body(
      ErrorEnvelope.of(status.value(), request.getRequestURI(), message)
    );
  }

  /** Jackson's detail carries a location suffix over several lines; one line is enough. */
  private String firstLine(String detail) {
    int newline = detail.indexOf('\n');

    return newline < 0 ? detail : detail.substring(0, newline);
  }
}
