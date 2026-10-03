package com.synapsedesk.gateway.model;

import com.fasterxml.jackson.annotation.JsonCreator;
import com.fasterxml.jackson.annotation.JsonProperty;
import com.fasterxml.jackson.annotation.JsonValue;
import com.synapsedesk.gateway.model.AiSuggestionResponseDto;
import com.synapsedesk.gateway.model.SuggestedArticleResponseDto;
import jakarta.validation.Valid;
import jakarta.validation.constraints.*;
import java.net.URI;
import java.time.OffsetDateTime;
import java.util.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import org.jspecify.annotations.Nullable;

/**
 * AiSuggestionsResponseDto
 */

public class AiSuggestionsResponseDto {

  private List<@Valid AiSuggestionResponseDto> nextSteps = new ArrayList<>();

  private List<@Valid SuggestedArticleResponseDto> articles = new ArrayList<>();

  /**
   * `LEXICAL_ONLY` when the budget could not confirm room for a generation — the workspace is at its AI allowance, or the quota counter was unreadable. Then `nextSteps` is empty because the model was never called, and `articles` came from keyword search. `null` on a normal answer, where an empty `nextSteps` means the model had nothing to add.  Read it before rendering an empty `nextSteps`: without it, a client shows \"no suggestions\" where the truth is \"allowance used\".
   */
  public enum DegradedEnum {
    LEXICAL_ONLY("LEXICAL_ONLY");

    private final String value;

    DegradedEnum(String value) {
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
    public static DegradedEnum fromValue(String value) {
      for (DegradedEnum b : DegradedEnum.values()) {
        if (b.value.equals(value)) {
          return b;
        }
      }
      return null;
    }
  }

  private DegradedEnum degraded = null;

  public AiSuggestionsResponseDto() {
    super();
  }

  /**
   * Constructor with only required parameters
   */
  public AiSuggestionsResponseDto(
    List<@Valid AiSuggestionResponseDto> nextSteps,
    List<@Valid SuggestedArticleResponseDto> articles,
    DegradedEnum degraded
  ) {
    this.nextSteps = nextSteps;
    this.articles = articles;
    this.degraded = degraded;
  }

  public AiSuggestionsResponseDto nextSteps(
    List<@Valid AiSuggestionResponseDto> nextSteps
  ) {
    this.nextSteps = nextSteps;
    return this;
  }

  public AiSuggestionsResponseDto addNextStepsItem(
    AiSuggestionResponseDto nextStepsItem
  ) {
    if (this.nextSteps == null) {
      this.nextSteps = new ArrayList<>();
    }
    this.nextSteps.add(nextStepsItem);
    return this;
  }

  /**
   * Get nextSteps
   * @return nextSteps
   */
  @NotNull
  @Valid
  @JsonProperty("nextSteps")
  public List<@Valid AiSuggestionResponseDto> getNextSteps() {
    return nextSteps;
  }

  @JsonProperty("nextSteps")
  public void setNextSteps(List<@Valid AiSuggestionResponseDto> nextSteps) {
    this.nextSteps = nextSteps;
  }

  public AiSuggestionsResponseDto articles(
    List<@Valid SuggestedArticleResponseDto> articles
  ) {
    this.articles = articles;
    return this;
  }

  public AiSuggestionsResponseDto addArticlesItem(
    SuggestedArticleResponseDto articlesItem
  ) {
    if (this.articles == null) {
      this.articles = new ArrayList<>();
    }
    this.articles.add(articlesItem);
    return this;
  }

  /**
   * Get articles
   * @return articles
   */
  @NotNull
  @Valid
  @JsonProperty("articles")
  public List<@Valid SuggestedArticleResponseDto> getArticles() {
    return articles;
  }

  @JsonProperty("articles")
  public void setArticles(List<@Valid SuggestedArticleResponseDto> articles) {
    this.articles = articles;
  }

  public AiSuggestionsResponseDto degraded(DegradedEnum degraded) {
    this.degraded = degraded;
    return this;
  }

  /**
   * `LEXICAL_ONLY` when the budget could not confirm room for a generation — the workspace is at its AI allowance, or the quota counter was unreadable. Then `nextSteps` is empty because the model was never called, and `articles` came from keyword search. `null` on a normal answer, where an empty `nextSteps` means the model had nothing to add.  Read it before rendering an empty `nextSteps`: without it, a client shows \"no suggestions\" where the truth is \"allowance used\".
   * @return degraded
   */

  @JsonProperty("degraded")
  public DegradedEnum getDegraded() {
    return degraded;
  }

  @JsonProperty("degraded")
  public void setDegraded(DegradedEnum degraded) {
    this.degraded = degraded;
  }

  @Override
  public boolean equals(Object o) {
    if (this == o) {
      return true;
    }
    if (o == null || getClass() != o.getClass()) {
      return false;
    }
    AiSuggestionsResponseDto aiSuggestionsResponseDto =
      (AiSuggestionsResponseDto) o;
    return (
      Objects.equals(this.nextSteps, aiSuggestionsResponseDto.nextSteps) &&
      Objects.equals(this.articles, aiSuggestionsResponseDto.articles) &&
      Objects.equals(this.degraded, aiSuggestionsResponseDto.degraded)
    );
  }

  @Override
  public int hashCode() {
    return Objects.hash(nextSteps, articles, degraded);
  }

  @Override
  public String toString() {
    StringBuilder sb = new StringBuilder();
    sb.append("class AiSuggestionsResponseDto {\n");
    sb.append("    nextSteps: ")
      .append(toIndentedString(nextSteps))
      .append("\n");
    sb.append("    articles: ").append(toIndentedString(articles)).append("\n");
    sb.append("    degraded: ").append(toIndentedString(degraded)).append("\n");
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
