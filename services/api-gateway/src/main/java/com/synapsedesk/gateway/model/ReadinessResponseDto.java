package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.synapsedesk.gateway.model.ReadinessDependenciesResponseDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.HashMap;
import java.util.Map;
import java.util.Objects;
import org.jspecify.annotations.Nullable;
import org.springframework.format.annotation.DateTimeFormat;

/**
 * ReadinessResponseDto
 */

public class ReadinessResponseDto {

  private Boolean ready;

  private Boolean draining;

  private ReadinessDependenciesResponseDto dependencies;

  private Map<String, Object> peers = new HashMap<>();

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime timestamp;

  public ReadinessResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public ReadinessResponseDto(
    Boolean ready,
    Boolean draining,
    ReadinessDependenciesResponseDto dependencies,
    Map<String, Object> peers,
    OffsetDateTime timestamp
  ) {
    this.ready = ready;
    this.draining = draining;
    this.dependencies = dependencies;
    this.peers = peers;
    this.timestamp = timestamp;
  }

  public ReadinessResponseDto ready(Boolean ready) {
    this.ready = ready;
    return this;
  }

  /**
   * Get ready
   * @return ready
   */
  @NotNull
  @JsonProperty("ready")
  public Boolean getReady() {
    return ready;
  }

  @JsonProperty("ready")
  public void setReady(Boolean ready) {
    this.ready = ready;
  }

  public ReadinessResponseDto draining(Boolean draining) {
    this.draining = draining;
    return this;
  }

  /**
   * This instance is shutting down. Gates `ready`; see `DrainState`.
   * @return draining
   */
  @NotNull
  @JsonProperty("draining")
  public Boolean getDraining() {
    return draining;
  }

  @JsonProperty("draining")
  public void setDraining(Boolean draining) {
    this.draining = draining;
  }

  public ReadinessResponseDto dependencies(
    ReadinessDependenciesResponseDto dependencies
  ) {
    this.dependencies = dependencies;
    return this;
  }

  /**
   * Get dependencies
   * @return dependencies
   */
  @NotNull
  @Valid
  @JsonProperty("dependencies")
  public ReadinessDependenciesResponseDto getDependencies() {
    return dependencies;
  }

  @JsonProperty("dependencies")
  public void setDependencies(ReadinessDependenciesResponseDto dependencies) {
    this.dependencies = dependencies;
  }

  public ReadinessResponseDto peers(Map<String, Object> peers) {
    this.peers = peers;
    return this;
  }

  public ReadinessResponseDto putPeersItem(String key, Object peersItem) {
    if (this.peers == null) {
      this.peers = new HashMap<>();
    }
    this.peers.put(key, peersItem);
    return this;
  }

  /**
   * Peer connectivity, for humans during an incident. Does NOT gate.
   * @return peers
   */
  @NotNull
  @JsonProperty("peers")
  public Map<String, Object> getPeers() {
    return peers;
  }

  @JsonProperty("peers")
  public void setPeers(Map<String, Object> peers) {
    this.peers = peers;
  }

  public ReadinessResponseDto timestamp(OffsetDateTime timestamp) {
    this.timestamp = timestamp;
    return this;
  }

  /**
   * Get timestamp
   * @return timestamp
   */
  @NotNull
  @Valid
  @JsonProperty("timestamp")
  public OffsetDateTime getTimestamp() {
    return timestamp;
  }

  @JsonProperty("timestamp")
  public void setTimestamp(OffsetDateTime timestamp) {
    this.timestamp = timestamp;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    ReadinessResponseDto readinessResponseDto = (ReadinessResponseDto) o;
    return (
      Objects.equals(this.ready, readinessResponseDto.ready) &&
      Objects.equals(this.draining, readinessResponseDto.draining) &&
      Objects.equals(this.dependencies, readinessResponseDto.dependencies) &&
      Objects.equals(this.peers, readinessResponseDto.peers) &&
      Objects.equals(this.timestamp, readinessResponseDto.timestamp)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(ready, draining, dependencies, peers, timestamp);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class ReadinessResponseDto {\n");
    sb.append("    ready: ").append(toIndentedString(ready)).append("\n");
    sb.append("    draining: ").append(toIndentedString(draining)).append("\n");
    sb.append("    dependencies: ")
      .append(toIndentedString(dependencies))
      .append("\n");
    sb.append("    peers: ").append(toIndentedString(peers)).append("\n");
    sb.append("    timestamp: ")
      .append(toIndentedString(timestamp))
      .append("\n");
    sb.append("}");
    return sb.toString();
  }

  /**
   * Convert the given object to string with each line indented by 4 spaces
   * (except the first line).
   */
  private String toIndentedString(@Nullable Object o) {
    return o == null ? "null" : o.toString().replace("\n", "\n    ");
  }
}
