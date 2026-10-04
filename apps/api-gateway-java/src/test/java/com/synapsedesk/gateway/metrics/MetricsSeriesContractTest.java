package com.synapsedesk.gateway.metrics;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.HttpProbe;
import com.synapsedesk.gateway.config.SharedEnvironmentInitializer;
import com.synapsedesk.gateway.platformjobs.JobMetricsCollector;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ContextConfiguration;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * The series this gateway publishes are exactly the series the registry
 * {@code test/fixtures/metrics/series.json} declares, family by family and label by
 * label.
 *
 * <p><b>A registry, not a list kept here.</b> Alerts and dashboards select these names,
 * so a name that differs by a suffix makes every alert selecting it match nothing, and
 * a dashboard of empty panels reads as a quiet system rather than a broken one. The
 * registry was frozen from the Node gateway's own registry, its last word, when this
 * gateway matched it; a list derived from this gateway's code would agree with itself
 * forever. Changing a series is an edit to it, made on purpose.
 *
 * <p>The scrape is read from the MANAGEMENT port, which is where the endpoint
 * actually is; a test that read it from the public port would pass against a
 * gateway that exposed metrics to the internet.
 */
// **`management.server.port=0` on purpose.** The scrape listener is a CHILD
// context, and it does not see property sources an
// `ApplicationContextInitializer` added to the parent — in production
// `METRICS_PORT` is a real environment variable, which the child does
// inherit, so this is a gap in the test's synthetic environment rather than
// in the configuration. A fixed port would also collide between suites.
@SpringBootTest(
  webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
  properties = { "management.server.port=0", "realtime.port=0" }
)
@ContextConfiguration(initializers = SharedEnvironmentInitializer.class)
class MetricsSeriesContractTest {

  /** The series registry: family to its label names. */
  private static final Path REGISTRY = Path.of(
    "..",
    "..",
    "test",
    "fixtures",
    "metrics",
    "series.json"
  );

  @Autowired
  private GatewayMetrics metrics;

  /**
   * A scrape refreshes the job gauge from the owning services' heartbeats, which
   * this test cannot reach, and the refresh REPLACES the gauge: left alone it would
   * rightly empty the sample recorded below. This test compares names and labels,
   * not heartbeats (see {@code JobMetricsCollectorTest} and the contract rows), so
   * the refresh is stood down and the test keeps recording its own sample.
   */
  @MockitoBean
  private JobMetricsCollector jobs;

  @Value("${local.management.port}")
  private int managementPort;

  @BeforeEach
  void recordOneOfEach() {
    // Micrometer registers a labelled meter on first use, so a scrape before
    // this would show no series at all and the comparison would be vacuous.
    metrics.httpRequest("/api/v1/tickets", "GET", 200, Duration.ofMillis(12));
    metrics.grpcCall("auth-service", "OK", Duration.ofMillis(3));
    metrics.websocketEvent("ticket.created");
    metrics.inboundEmail("accepted");
    metrics.replaceJobSuccesses(
      java.util.List.of(
        new GatewayMetrics.JobSuccess(
          "digest",
          "notification-service",
          1_700_000_000d
        )
      )
    );
    metrics.socketOpened();
  }

  @Test
  void publishesExactlyTheSeriesTheRegistryDeclares() throws IOException {
    Map<String, Set<String>> registry = registry();
    Map<String, Set<String>> java = scraped();

    // Names first, because a missing or extra FAMILY is the failure that
    // silences an alert; the label comparison below is the one that silences
    // a selector inside a family that exists.
    assertThat(java.keySet()).isEqualTo(registry.keySet());

    for (String series : new TreeSet<>(registry.keySet())) {
      assertThat(java.get(series))
        .as("labels of %s", series)
        .isEqualTo(registry.get(series));
    }
  }

  @Test
  void theDeclaredLabelsAreTheRegistrysLabels() throws IOException {
    // `PublishedSeries.LABELS` drives the allowlist, so it is real
    // configuration — but the scrape comparison above cannot see it, because
    // the tags a meter actually carries are written at the call site. Without
    // this row the declaration could name `job`/`service` (the scraper-
    // colliding pair) and every other row would stay green.
    Map<String, Set<String>> registry = registry();
    Map<String, Set<String>> declared = new LinkedHashMap<>();

    PublishedSeries.LABELS.forEach((series, labels) ->
      declared.put(series, new TreeSet<>(labels))
    );

    assertThat(declared).isEqualTo(registry);
  }

  @Test
  void publishesNothingActuatorAddedOnItsOwn() {
    // Without the allowlist this is several dozen families — `jvm_*`,
    // `executor_*`, `disk_*`, `tomcat_*`, and Actuator's own
    // `http_server_requests_seconds`, which measures the same requests as
    // `http_request_duration_seconds` under a second name.
    String scrape = scrape();

    assertThat(scrape).doesNotContain("jvm_");
    assertThat(scrape).doesNotContain("http_server_requests");
    assertThat(scrape).doesNotContain("tomcat_");
  }

  @Test
  void histogramsCarryNodesBucketBoundaries() {
    // A summary — `_count` and `_sum` with no `_bucket` — is what Micrometer
    // emits for a Timer left alone, and every `histogram_quantile()` over it
    // returns nothing while the series still exists.
    String scrape = scrape();

    for (double boundary : PublishedSeries.BUCKETS.get(
      PublishedSeries.HTTP_DURATION
    )) {
      assertThat(scrape)
        .as("bucket le=%s", boundary)
        .containsPattern(
          "http_request_duration_seconds_bucket\\{[^}]*le=\"" + boundary + "\""
        );
    }
  }

  @Test
  void theRegistryIsARealOneRatherThanAnEmptyFile() throws IOException {
    // A path that stopped resolving would compare an empty set to an empty set
    // and report agreement.
    assertThat(Files.exists(REGISTRY)).isTrue();
    assertThat(registry()).hasSize(7);
  }

  private String scrape() {
    return HttpProbe.get(managementPort, "/metrics").body();
  }

  /** family -> label names, as the scrape actually renders them. */
  private Map<String, Set<String>> scraped() {
    Map<String, Set<String>> found = new LinkedHashMap<>();
    Pattern sample = Pattern.compile("^([a-z_]+)(\\{([^}]*)})?\\s");

    for (String line : scrape().split("\n")) {
      if (line.startsWith("#") || line.isBlank()) {
        continue;
      }

      Matcher matcher = sample.matcher(line);
      if (!matcher.find()) {
        continue;
      }

      String family = family(matcher.group(1));
      Set<String> labels = new TreeSet<>();

      for (String pair : matcher.group(3) == null
        ? new String[0]
        : matcher.group(3).split(",")) {
        String label = pair.split("=")[0].trim();
        // `le` is the histogram's own bucket label, not one this gateway
        // declares — Node's registry does not list it either.
        if (!label.isEmpty() && !label.equals("le")) {
          labels.add(label);
        }
      }

      found
        .computeIfAbsent(family, key -> new LinkedHashSet<>())
        .addAll(labels);
    }

    return found;
  }

  /**
   * Strips the suffixes a histogram's own samples carry.
   *
   * <p>`_bucket`, `_sum` and `_count` belong to the Prometheus histogram
   * format; `_max` is Micrometer's extra gauge per Timer, which Node has no
   * equivalent of — it is folded into the family here rather than treated as
   * a ninth series. It is a known difference, not a parity break.
   */
  private String family(String name) {
    for (String suffix : List.of("_bucket", "_sum", "_count", "_max")) {
      if (
        name.endsWith(suffix) &&
        PublishedSeries.LABELS.containsKey(trim(name, suffix))
      ) {
        return trim(name, suffix);
      }
    }

    return name;
  }

  private String trim(String name, String suffix) {
    return name.substring(0, name.length() - suffix.length());
  }

  /** series -> label names, as the registry declares them. */
  private Map<String, Set<String>> registry() throws IOException {
    JsonNode root = JsonMapper.builder()
      .build()
      .readTree(Files.readString(REGISTRY));
    Map<String, Set<String>> declared = new LinkedHashMap<>();
    root.properties().forEach(series -> {
      Set<String> labels = new TreeSet<>();
      series.getValue().forEach(label -> labels.add(label.asString()));
      declared.put(series.getKey(), labels);
    });

    return declared;
  }
}
