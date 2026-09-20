package com.synapsedesk.gateway.error;

import io.grpc.StatusRuntimeException;
import jakarta.servlet.http.HttpServletRequest;
import java.util.ArrayList;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.ErrorResponse;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.servlet.resource.NoResourceFoundException;

/**
 * Every failure leaves as one {@link ErrorEnvelope} — the Node gateway's
 * `AllHttpExceptionFilter`, reproduced against the re-taken P3 capture.
 *
 * <p><b>Which rows are byte-equal and which are not is decided by where the
 * string is authored</b>, not by how important the row looks:
 *
 * <ul>
 *   <li><b>Exact</b> — 404's `Cannot GET <path>!`, the fixed transport
 *       message (gap 38), and the joining and trailing `!` of a validation
 *       400. All written here.
 *   <li><b>Opaque</b> — a malformed body and an unsupported content type.
 *       Their text belongs to the JSON parser and to the framework, and V8
 *       alone produced three different strings for three malformed bodies. The
 *       contract is the status, the envelope shape and `path`.
 *   <li><b>Split</b> — a validation 400 is one string containing both kinds:
 *       ours in the `, ` separator and the trailing `!`, the library's in each
 *       constraint's phrasing. Field NAMES are promised; the wording after
 *       them is not.
 * </ul>
 */
@RestControllerAdvice
public class GatewayExceptionHandler {

  /** A failed `@Valid` body: one message per broken rule, joined as Node joins them. */
  @ExceptionHandler(MethodArgumentNotValidException.class)
  public ResponseEntity<ErrorEnvelope> onValidationFailure(
      MethodArgumentNotValidException exception, HttpServletRequest request) {
    List<String> messages = new ArrayList<>();

    for (var error : exception.getBindingResult().getFieldErrors()) {
      // `field message` — the shape class-validator produces, so the FIELD
      // NAME is present and first. The phrasing after it is Bean Validation's
      // and is matched loosely.
      messages.add(error.getField() + " " + error.getDefaultMessage());
    }

    for (var error : exception.getBindingResult().getGlobalErrors()) {
      messages.add(error.getDefaultMessage());
    }

    return envelope(HttpStatus.BAD_REQUEST, request, ErrorMessages.format(messages));
  }

  /**
   * A body the parser refused. **Opaque by decision**: this message is
   * Jackson's, as the Node one is V8's.
   */
  @ExceptionHandler(HttpMessageNotReadableException.class)
  public ResponseEntity<ErrorEnvelope> onUnreadableBody(
      HttpMessageNotReadableException exception, HttpServletRequest request) {
    String detail = exception.getMostSpecificCause().getMessage();

    return envelope(
        HttpStatus.BAD_REQUEST,
        request,
        ErrorMessages.format(detail == null ? "Malformed request body" : firstLine(detail)));
  }

  /** No route. The message IS ours, so it is exact: `Cannot GET /api/v1/x!`. */
  @ExceptionHandler(NoResourceFoundException.class)
  public ResponseEntity<ErrorEnvelope> onNoRoute(HttpServletRequest request) {
    return envelope(
        HttpStatus.NOT_FOUND,
        request,
        ErrorMessages.format("Cannot " + request.getMethod() + " " + request.getRequestURI()));
  }

  /** A peer's failure, through the gap-38 rule. */
  @ExceptionHandler(StatusRuntimeException.class)
  public ResponseEntity<ErrorEnvelope> onPeerFailure(
      StatusRuntimeException exception, HttpServletRequest request) {
    GrpcStatusMapping.ClientSafe safe =
        GrpcStatusMapping.resolve(
            exception.getStatus().getCode(), exception.getStatus().getDescription());

    return envelope(safe.status(), request, safe.message());
  }

  /** Anything raised with a status already chosen. */
  @ExceptionHandler(ResponseStatusException.class)
  public ResponseEntity<ErrorEnvelope> onStatusException(
      ResponseStatusException exception, HttpServletRequest request) {
    HttpStatus status = HttpStatus.valueOf(exception.getStatusCode().value());
    String reason = exception.getReason();

    return envelope(
        status, request, ErrorMessages.format(reason == null ? status.getReasonPhrase() : reason));
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
   * <p>The 500 text is fixed in every environment. The Node side varies only
   * this one string by `isProduction`; here it does not vary at all, because
   * what the variation bought was reading a stack in development, and this
   * side logs that instead of sending it.
   */
  @ExceptionHandler(Exception.class)
  public ResponseEntity<ErrorEnvelope> onAnythingElse(
      Exception exception, HttpServletRequest request) {
    if (exception instanceof ErrorResponse refusal) {
      HttpStatus status = HttpStatus.valueOf(refusal.getStatusCode().value());

      return envelope(status, request, ErrorMessages.format(status.getReasonPhrase()));
    }

    return envelope(
        HttpStatus.INTERNAL_SERVER_ERROR, request, ErrorMessages.format("Internal server error"));
  }

  private ResponseEntity<ErrorEnvelope> envelope(
      HttpStatus status, HttpServletRequest request, String message) {
    return ResponseEntity.status(status)
        .body(ErrorEnvelope.of(status.value(), request.getRequestURI(), message));
  }

  /** Jackson's detail carries a location suffix over several lines; one line is enough. */
  private String firstLine(String detail) {
    int newline = detail.indexOf('\n');

    return newline < 0 ? detail : detail.substring(0, newline);
  }
}
