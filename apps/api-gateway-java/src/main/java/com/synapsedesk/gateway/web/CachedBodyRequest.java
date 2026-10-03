package com.synapsedesk.gateway.web;

import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import java.io.BufferedReader;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Enumeration;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * A request whose body can be read twice.
 *
 * <p>A servlet body is a one-shot stream, so a filter that reads it to check
 * anything has consumed it — the handler then binds an empty body and answers
 * a validation error about fields the caller did send. Spring's
 * {@code ContentCachingRequestWrapper} caches what the HANDLER reads, which is
 * the wrong direction for a filter that needs the bytes FIRST.
 */
public class CachedBodyRequest extends HttpServletRequestWrapper {

  private static final String CONTENT_TYPE = "Content-Type";
  private static final String JSON = "application/json";

  private final byte[] body;
  private final boolean presentedAsJson;

  public CachedBodyRequest(HttpServletRequest request, byte[] body) {
    this(request, body, false);
  }

  /**
   * {@code presentedAsJson} makes the request say so everywhere Spring looks: the
   * content type, the header, and the length. Used for a request that arrived with
   * NO body, which the filter replaces with an empty JSON object (see
   * {@link JsonBodyFilter}); a declared {@code text/plain} must not survive, since
   * the body no longer is.
   */
  public CachedBodyRequest(
    HttpServletRequest request,
    byte[] body,
    boolean presentedAsJson
  ) {
    super(request);
    this.body = body;
    this.presentedAsJson = presentedAsJson;
  }

  @Override
  public String getContentType() {
    return presentedAsJson ? JSON : super.getContentType();
  }

  @Override
  public String getHeader(String name) {
    return presentedAsJson && CONTENT_TYPE.equalsIgnoreCase(name)
      ? JSON
      : super.getHeader(name);
  }

  @Override
  public Enumeration<String> getHeaders(String name) {
    return presentedAsJson && CONTENT_TYPE.equalsIgnoreCase(name)
      ? Collections.enumeration(List.of(JSON))
      : super.getHeaders(name);
  }

  @Override
  public Enumeration<String> getHeaderNames() {
    if (!presentedAsJson) return super.getHeaderNames();
    Set<String> names = new LinkedHashSet<>(
      Collections.list(super.getHeaderNames())
    );
    if (names.stream().noneMatch(CONTENT_TYPE::equalsIgnoreCase)) {
      names.add(CONTENT_TYPE);
    }

    return Collections.enumeration(names);
  }

  @Override
  public int getContentLength() {
    return presentedAsJson ? body.length : super.getContentLength();
  }

  @Override
  public long getContentLengthLong() {
    return presentedAsJson ? body.length : super.getContentLengthLong();
  }

  /** The bytes the filter already read, for anything that wants them again. */
  public byte[] body() {
    return body;
  }

  @Override
  public ServletInputStream getInputStream() {
    ByteArrayInputStream replay = new ByteArrayInputStream(body);

    return new ServletInputStream() {
      @Override
      public boolean isFinished() {
        return replay.available() == 0;
      }

      @Override
      public boolean isReady() {
        return true;
      }

      @Override
      public void setReadListener(ReadListener listener) {
        // Blocking reads only: Spring MVC's argument resolution is blocking,
        // and an async listener on a byte array would have nothing to wait for.
        throw new UnsupportedOperationException(
          "async reads are not supported"
        );
      }

      @Override
      public int read() {
        return replay.read();
      }
    };
  }

  @Override
  public BufferedReader getReader() throws IOException {
    return new BufferedReader(
      new InputStreamReader(getInputStream(), StandardCharsets.UTF_8)
    );
  }
}
