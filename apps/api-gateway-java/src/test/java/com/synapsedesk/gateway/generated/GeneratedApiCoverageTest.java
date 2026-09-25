package com.synapsedesk.gateway.generated;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.stream.Stream;

import static org.assertj.core.api.Assertions.assertThat;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.test.context.ContextConfiguration;

import com.synapsedesk.gateway.config.SharedEnvironmentInitializer;

/**
 * Every generated `*Api` interface is implemented, or listed as pending.
 *
 * <p><b>This is the half the compiler cannot do.</b> `skipDefaultInterface`
 * makes a generated method abstract, so a path added to a tag that some
 * controller implements fails the BUILD (J3, measured: deleting a method gives
 * *"is not abstract and does not override abstract method"*). A path added
 * under a NEW tag generates a new interface that nothing implements —
 * measured too: the build passes with zero errors and the route 404s. So
 * "a new path fails the build" is true only for tags already implemented, and
 * this row covers the rest.
 *
 * <p><b>The direction is from the generated SOURCES toward the code</b>, never
 * from the OpenAPI document. A test that derived the expected interface names
 * from `openapi.json` would pass if the generator stopped emitting a tag
 * entirely — it would be checking the document against itself. Walking what
 * the generator actually wrote asks the question the other way round.
 *
 * <p>Implemented means <b>a bean in the container implements it</b>, not that
 * a class exists: a controller that is not a component serves nothing, and
 * that is exactly the mistake this would otherwise miss.
 */
@SpringBootTest(properties = "management.server.port=0")
@ContextConfiguration(initializers = SharedEnvironmentInitializer.class)
class GeneratedApiCoverageTest {

  /** Where the plugin writes, as `generate-sources` bound it. */
  private static final Path GENERATED =
      Path.of(
          "target/generated-sources/openapi/src/main/java/com/synapsedesk/gateway/generated/api");

  private static final Path PENDING = Path.of("src/test/resources/pending-apis.txt");

  @Autowired private ApplicationContext context;

  @Test
  void everyGeneratedApiIsImplementedOrPending() throws IOException {
    Set<String> pending = pending();
    List<String> findings = new ArrayList<>();

    for (String name : generated()) {
      if (pending.contains(name)) {
        continue;
      }

      Class<?> api;
      try {
        api = Class.forName("com.synapsedesk.gateway.generated.api." + name);
      } catch (ClassNotFoundException cause) {
        findings.add(name + ": generated but not compiled");
        continue;
      }

      if (context.getBeanNamesForType(api).length == 0) {
        findings.add(name + ": no bean implements it, and it is not listed as pending");
      }
    }

    assertThat(findings).isEmpty();
  }

  @Test
  void thePendingListHasNoStaleEntries() throws IOException {
    // A name left here after its tag was implemented would silently excuse the
    // next regression in that tag.
    Set<String> generated = generated();
    List<String> stale = new ArrayList<>();

    for (String name : pending()) {
      if (!generated.contains(name)) {
        stale.add(name + ": listed as pending, but the generator emits no such interface");
        continue;
      }

      Class<?> api;
      try {
        api = Class.forName("com.synapsedesk.gateway.generated.api." + name);
      } catch (ClassNotFoundException cause) {
        continue;
      }

      if (context.getBeanNamesForType(api).length > 0) {
        stale.add(name + ": implemented — remove it from the list");
      }
    }

    assertThat(stale).isEmpty();
  }

  @Test
  void theListOnlyEverShrinks() throws IOException {
    // 31 tags generated, one implemented. Asserting the size makes both
    // directions deliberate: implementing a tag is an edit here, and so is
    // adding a tag nobody implements — which is the case the compiler cannot
    // see and the reason this file exists.
    assertThat(generated()).hasSize(31);
    assertThat(pending()).hasSize(28);
  }

  @Test
  void theScanReadsRealGeneratedSources() {
    // A path that stopped resolving would compare an empty set to an empty
    // set and report full coverage.
    assertThat(Files.isDirectory(GENERATED))
        .as("%s — run `mvn generate-sources`", GENERATED.toAbsolutePath())
        .isTrue();
  }

  /** Every `*Api` the generator wrote, by simple name. */
  private Set<String> generated() throws IOException {
    try (Stream<Path> files = Files.list(GENERATED)) {
      return files
          .map(path -> path.getFileName().toString())
          .filter(name -> name.endsWith("Api.java"))
          .map(name -> name.substring(0, name.length() - ".java".length()))
          .collect(java.util.stream.Collectors.toCollection(TreeSet::new));
    }
  }

  /** The tracked list, comments and blank lines dropped. */
  private Set<String> pending() throws IOException {
    return Files.readAllLines(PENDING).stream()
        // FIXME Null type safety: parameter 'this' provided via method descriptor Function<String,String>.apply(String) needs unchecked conversion to conform to '@Nonnull String'
        .map(String::trim)
        .filter(line -> !line.isEmpty() && !line.startsWith("#"))
        .collect(java.util.stream.Collectors.toCollection(TreeSet::new));
  }
}
