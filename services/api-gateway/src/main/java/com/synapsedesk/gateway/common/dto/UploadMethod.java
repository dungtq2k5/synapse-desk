package com.synapsedesk.gateway.common.dto;

import com.fasterxml.jackson.annotation.JsonValue;

/**
 * How to send the bytes to a presigned {@code uploadUrl}, with the declared
 * {@code Content-Type}: {@code PUT} to a signed URL, or {@code POST} to the
 * local Storage emulator, which doesn't implement signed URLs.
 */
public enum UploadMethod {
  POST("POST"),
  PUT("PUT");

  private final String value;

  UploadMethod(String value) {
    this.value = value;
  }

  @JsonValue
  public String getValue() {
    return value;
  }

  /**
   * storage-service's {@code upload_method}, relayed. An empty one comes from a
   * storage-service that predates it, which always meant a PUT.
   */
  public static UploadMethod of(String wire) {
    return "POST".equals(wire) ? POST : PUT;
  }

  @Override
  public String toString() {
    return value;
  }
}
