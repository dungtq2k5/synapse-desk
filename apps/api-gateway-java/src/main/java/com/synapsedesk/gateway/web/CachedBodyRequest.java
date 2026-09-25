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

  private final byte[] body;

  public CachedBodyRequest(HttpServletRequest request, byte[] body) {
    super(request);
    this.body = body;
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
        throw new UnsupportedOperationException("async reads are not supported");
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
        new InputStreamReader(getInputStream(), StandardCharsets.UTF_8));
  }
}
