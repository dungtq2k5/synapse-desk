package com.synapsedesk.gateway.web;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.HttpProbe;
import com.synapsedesk.gateway.config.SharedEnvironmentInitializer;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * A malformed or wrongly-typed body is refused BEFORE authentication.
 *
 * <p><b>The stand-in auth filter is what makes this testable today.</b> The
 * real one arrives with `AuthApi`; without something refusing unauthenticated
 * requests, every row here would pass for the wrong reason — there would be
 * no 401 for the body checks to beat. It is ordered immediately after
 * {@link JsonBodyFilter}, which is where the real one goes.
 *
 * <p>The statuses are the Node gateway's, measured with no cookie at all:
 * `text/plain` is 415, malformed JSON is 400, and a request with NO body
 * reaches the guard and is 401. Spring would answer 401 to all three, because
 * it resolves arguments after the security filters.
 */
@SpringBootTest(
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
    properties = "management.server.port=0")
@ContextConfiguration(initializers = SharedEnvironmentInitializer.class)
@Import(BodyBeforeAuthTest.StandInAuth.class)
class BodyBeforeAuthTest {

  @Value("${local.server.port}")
  private int port;

  /** Refuses everything, so the rows below have a 401 to beat. */
  @TestConfiguration
  @RestController
  static class StandInAuth {

    /**
     * **Registered through a {@link FilterRegistrationBean}, because `@Order`
     * on a `@Bean` METHOD is not honoured for servlet filter order.**
     *
     * <p>Measured, in two steps. With this stand-in on `@Bean @Order(+20)`,
     * moving {@link JsonBodyFilter} from `+10` to `+30` changed nothing — the
     * rows passed either way, so they were not testing the ordering they
     * claimed. With the registration's explicit `setOrder(+20)`, the same move
     * turns them red. So `@Order` on a `@Component` filter CLASS works — that
     * is what places `JsonBodyFilter` — and on a `@Bean` method it is ignored,
     * leaving the filter at the default lowest precedence, which is why it ran
     * last and could never be beaten.
     *
     * <p>The real auth filter is a `@Component` like `JsonBodyFilter`, so it
     * is ordered by the annotation; this stand-in is the one that needs the
     * registration.
     */
    @Bean
    FilterRegistrationBean<OncePerRequestFilter> refuseEveryRequest() {
      FilterRegistrationBean<OncePerRequestFilter> registration =
          new FilterRegistrationBean<>(standIn());
      registration.setOrder(Ordered.HIGHEST_PRECEDENCE + 20);

      return registration;
    }

    private OncePerRequestFilter standIn() {
      return new OncePerRequestFilter() {
        @Override
        protected void doFilterInternal(
            HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
          if (request.getRequestURI().startsWith("/probe/guarded")) {
            response.setStatus(HttpStatus.UNAUTHORIZED.value());
            response.setContentType("application/json");
            response.getWriter().write("{\"success\":false,\"statusCode\":401}");

            return;
          }

          chain.doFilter(request, response);
        }
      };
    }

    record Body(String name) {}

    @PostMapping("/probe/guarded")
    String guarded(@RequestBody Body body) {
      return body.name();
    }

    /** Unguarded, so the body genuinely reaches a handler. */
    @PostMapping("/probe/open")
    String open(@RequestBody Body body) {
      return body.name();
    }
  }

  @Test
  void aWrongContentTypeIsRefusedBeforeAuth() {
    HttpProbe response =
        HttpProbe.post(port, "/probe/guarded", "{\"name\":\"x\"}", "text/plain");

    assertThat(response.status()).isEqualTo(HttpStatus.UNSUPPORTED_MEDIA_TYPE.value());
    assertThat(response.json()).containsEntry("path", "/probe/guarded");
  }

  @Test
  void aBodyWithNoContentTypeAtAllIsRefused() {
    // The gap sabotage found: `declared == null` and `!isJson(declared)` are
    // two different refusals, and only the second had a row. A client that
    // sends bytes without saying what they are is not sending JSON, and
    // letting it through would hand an unparsed body to the handler.
    HttpProbe response = HttpProbe.postWithoutContentType(port, "/probe/guarded", "{\"name\":\"x\"}");

    assertThat(response.status()).isEqualTo(HttpStatus.UNSUPPORTED_MEDIA_TYPE.value());
  }

  @Test
  void aMalformedBodyIsRefusedBeforeAuth() {
    HttpProbe response = HttpProbe.post(port, "/probe/guarded", "{");

    assertThat(response.status()).isEqualTo(HttpStatus.BAD_REQUEST.value());
    assertThat(response.json()).containsEntry("success", false);
  }

  @Test
  void aRequestWithNoBodyReachesTheGuardAndIs401() {
    // The other side of the ordering: nothing to refuse, so auth answers —
    // which is what the Node gateway does, and why the filter checks for a
    // body before it checks anything about it.
    HttpProbe response = HttpProbe.post(port, "/probe/guarded", "");

    assertThat(response.status()).isEqualTo(HttpStatus.UNAUTHORIZED.value());
  }

  @Test
  void aValidBodyStillReachesTheHandler() {
    // The wrapper's real job: a filter that read the stream without replaying
    // it would leave the handler binding an empty body, and the symptom would
    // be a validation error about fields the caller did send.
    Map<String, Object> ignored = Map.of();
    HttpProbe response =
        HttpProbe.post(port, "/probe/open", "{\"name\":\"kept\"}");

    assertThat(ignored).isEmpty();
    assertThat(response.status()).isEqualTo(HttpStatus.OK.value());
    assertThat(response.body()).isEqualTo("kept");
  }
}
