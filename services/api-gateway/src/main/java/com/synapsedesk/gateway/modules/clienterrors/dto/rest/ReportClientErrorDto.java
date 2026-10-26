package com.synapsedesk.gateway.modules.clienterrors.dto.rest;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;

/**
 * `POST /client-errors`: one browser error. The log keeps nothing else.
 */
public class ReportClientErrorDto {

  /** `error` (uncaught), `rejection` (unhandled promise), `boundary` (an error boundary). */
  public enum KindEnum {
    ERROR("error"),

    REJECTION("rejection"),

    BOUNDARY("boundary");

    private final String value;

    KindEnum(String value) {
      this.value = value;
    }

    @JsonValue
    public String getValue() {
      return value;
    }

    @Override
    public String toString() {
      return String.valueOf(value);
    }

    @JsonCreator
    public static KindEnum fromValue(String value) {
      for (KindEnum b : KindEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      return null;
    }
  }

  private KindEnum kind;

  private String message;

  private String stack;

  private String path;

  private String buildId;

  @NotNull
  @JsonProperty("kind")
  public KindEnum getKind() {
    return kind;
  }

  @JsonProperty("kind")
  public void setKind(KindEnum kind) {
    this.kind = kind;
  }

  @NotNull
  @Size(max = 1000)
  @JsonProperty("message")
  public String getMessage() {
    return message;
  }

  @JsonProperty("message")
  public void setMessage(String message) {
    this.message = message;
  }

  /** Kept truncated. */
  @JsonProperty("stack")
  public String getStack() {
    return stack;
  }

  @JsonProperty("stack")
  public void setStack(String stack) {
    this.stack = stack;
  }

  /** The page's path; its query and fragment are dropped before logging. */
  @NotNull
  @Size(max = 2000)
  @JsonProperty("path")
  public String getPath() {
    return path;
  }

  @JsonProperty("path")
  public void setPath(String path) {
    this.path = path;
  }

  /** The web build that reported it (`GIT_SHA`). */
  @Size(max = 64)
  @JsonProperty("buildId")
  public String getBuildId() {
    return buildId;
  }

  @JsonProperty("buildId")
  public void setBuildId(String buildId) {
    this.buildId = buildId;
  }
}
