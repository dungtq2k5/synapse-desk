package com.synapsedesk.gateway.generated.model;

import java.net.URI;
import java.util.Objects;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonCreator;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.lang.Nullable;
import java.time.OffsetDateTime;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;


import java.util.*;

/**
 * InvoiceResponseDto
 */

public class InvoiceResponseDto {

  private String id;

  private String number;

  private BigDecimal amountDue;

  private String currency;

  private String status;

  @DateTimeFormat(iso = DateTimeFormat.ISO.DATE_TIME)
  private OffsetDateTime created = null;

  private String hostedInvoiceUrl;

  public InvoiceResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public InvoiceResponseDto(String id, String number, BigDecimal amountDue, String currency, String status, OffsetDateTime created, String hostedInvoiceUrl) {
    this.id = id;
    this.number = number;
    this.amountDue = amountDue;
    this.currency = currency;
    this.status = status;
    this.created = created;
    this.hostedInvoiceUrl = hostedInvoiceUrl;
  }

  public InvoiceResponseDto id(String id) {
    this.id = id;
    return this;
  }

  /**
   * Get id
   * @return id
   */
  @NotNull 
  @JsonProperty("id")
  public String getId() {
    return id;
  }

  @JsonProperty("id")
  public void setId(String id) {
    this.id = id;
  }

  public InvoiceResponseDto number(String number) {
    this.number = number;
    return this;
  }

  /**
   * Get number
   * @return number
   */
  @NotNull 
  @JsonProperty("number")
  public String getNumber() {
    return number;
  }

  @JsonProperty("number")
  public void setNumber(String number) {
    this.number = number;
  }

  public InvoiceResponseDto amountDue(BigDecimal amountDue) {
    this.amountDue = amountDue;
    return this;
  }

  /**
   * Get amountDue
   * @return amountDue
   */
  @NotNull @Valid 
  @JsonProperty("amountDue")
  public BigDecimal getAmountDue() {
    return amountDue;
  }

  @JsonProperty("amountDue")
  public void setAmountDue(BigDecimal amountDue) {
    this.amountDue = amountDue;
  }

  public InvoiceResponseDto currency(String currency) {
    this.currency = currency;
    return this;
  }

  /**
   * Get currency
   * @return currency
   */
  @NotNull 
  @JsonProperty("currency")
  public String getCurrency() {
    return currency;
  }

  @JsonProperty("currency")
  public void setCurrency(String currency) {
    this.currency = currency;
  }

  public InvoiceResponseDto status(String status) {
    this.status = status;
    return this;
  }

  /**
   * **STRIPE's** invoice status — `draft`, `open`, `paid`, `uncollectible`, `void` — passed through from a live API read, so it stays a `string`.  The one status field on this surface that must NOT be narrowed. An enum over a third party's vocabulary turns a value they add into a runtime surprise on a page about money; a foreign literal is stored and forwarded as it arrives, the same rule `SubscriptionPlanPrice.interval` follows. Written here rather than only in the proto because this is the third time the question has been asked about a Stripe status field.
   * @return status
   */
  @NotNull 
  @JsonProperty("status")
  public String getStatus() {
    return status;
  }

  @JsonProperty("status")
  public void setStatus(String status) {
    this.status = status;
  }

  public InvoiceResponseDto created(OffsetDateTime created) {
    this.created = created;
    return this;
  }

  /**
   * Get created
   * @return created
   */
  @Valid 
  @JsonProperty("created")
  public OffsetDateTime getCreated() {
    return created;
  }

  @JsonProperty("created")
  public void setCreated(OffsetDateTime created) {
    this.created = created;
  }

  public InvoiceResponseDto hostedInvoiceUrl(String hostedInvoiceUrl) {
    this.hostedInvoiceUrl = hostedInvoiceUrl;
    return this;
  }

  /**
   * Get hostedInvoiceUrl
   * @return hostedInvoiceUrl
   */
  @NotNull 
  @JsonProperty("hostedInvoiceUrl")
  public String getHostedInvoiceUrl() {
    return hostedInvoiceUrl;
  }

  @JsonProperty("hostedInvoiceUrl")
  public void setHostedInvoiceUrl(String hostedInvoiceUrl) {
    this.hostedInvoiceUrl = hostedInvoiceUrl;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    InvoiceResponseDto invoiceResponseDto = (InvoiceResponseDto) o;
    return Objects.equals(this.id, invoiceResponseDto.id) &&
        Objects.equals(this.number, invoiceResponseDto.number) &&
        Objects.equals(this.amountDue, invoiceResponseDto.amountDue) &&
        Objects.equals(this.currency, invoiceResponseDto.currency) &&
        Objects.equals(this.status, invoiceResponseDto.status) &&
        Objects.equals(this.created, invoiceResponseDto.created) &&
        Objects.equals(this.hostedInvoiceUrl, invoiceResponseDto.hostedInvoiceUrl);
  }

  @Override
  public int hashCode() {
    return Objects.hash(id, number, amountDue, currency, status, created, hostedInvoiceUrl);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class InvoiceResponseDto {\n");
    sb.append("    id: ").append(toIndentedString(id)).append("\n");
    sb.append("    number: ").append(toIndentedString(number)).append("\n");
    sb.append("    amountDue: ").append(toIndentedString(amountDue)).append("\n");
    sb.append("    currency: ").append(toIndentedString(currency)).append("\n");
    sb.append("    status: ").append(toIndentedString(status)).append("\n");
    sb.append("    created: ").append(toIndentedString(created)).append("\n");
    sb.append("    hostedInvoiceUrl: ").append(toIndentedString(hostedInvoiceUrl)).append("\n");
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

