package com.synapsedesk.gateway;

import tools.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.util.Map;

/**
 * A GET over real HTTP, for the rows that must not go through MockMvc.
 *
 * <p>Plain {@code java.net.http} rather than a test client: what these rows
 * assert is what a probe and a scraper see on the wire — a status LINE, a
 * body, a port. Boot 4 moved {@code TestRestTemplate}, and a helper this small
 * is not worth a dependency that moves.
 */
public record HttpProbe(int status, String body) {

  private static final HttpClient CLIENT = HttpClient.newHttpClient();
  private static final ObjectMapper JSON = new ObjectMapper();

  public static HttpProbe get(int port, String path) {
    try {
      HttpResponse<String> response =
          CLIENT.send(
              HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path)).build(),
              HttpResponse.BodyHandlers.ofString());

      return new HttpProbe(response.statusCode(), response.body());
    } catch (IOException | InterruptedException cause) {
      throw new IllegalStateException("GET " + path + " failed", cause);
    }
  }

  /** A POST with a JSON body, for the rows that need a handler to reach. */
  public static HttpProbe post(int port, String path, String body) {
    return post(port, path, body, "application/json");
  }

  /**
   * A POST that sets NO `Content-Type` at all.
   *
   * <p>`java.net.http` adds none of its own, which is what makes this
   * expressible — the row it serves is the one where a caller sends bytes
   * without saying what they are.
   */
  public static HttpProbe postWithoutContentType(int port, String path, String body) {
    try {
      HttpResponse<String> response =
          CLIENT.send(
              HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                  .POST(HttpRequest.BodyPublishers.ofString(body))
                  .build(),
              HttpResponse.BodyHandlers.ofString());

      return new HttpProbe(response.statusCode(), response.body());
    } catch (IOException | InterruptedException cause) {
      throw new IllegalStateException("POST " + path + " failed", cause);
    }
  }

  /** A POST with a chosen content type — the unsupported-media-type row. */
  public static HttpProbe post(int port, String path, String body, String contentType) {
    try {
      HttpResponse<String> response =
          CLIENT.send(
              HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + path))
                  .header("Content-Type", contentType)
                  .POST(HttpRequest.BodyPublishers.ofString(body))
                  .build(),
              HttpResponse.BodyHandlers.ofString());

      return new HttpProbe(response.statusCode(), response.body());
    } catch (IOException | InterruptedException cause) {
      throw new IllegalStateException("POST " + path + " failed", cause);
    }
  }

  /**
   * The response body as a map, for the envelope assertions.
   *
   * <p>Jackson 3 — {@code tools.jackson}, not {@code com.fasterxml} — is what
   * Boot 4 brings, and its read throws an unchecked exception rather than
   * {@code IOException}.
   */
  @SuppressWarnings("unchecked")
  public Map<String, Object> json() {
    return JSON.readValue(body, Map.class);
  }

  /** The envelope's `data` object. */
  @SuppressWarnings("unchecked")
  public Map<String, Object> data() {
    return (Map<String, Object>) json().get("data");
  }
}
