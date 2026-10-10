package com.synapsedesk.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/**
 * Every failsafe class that boots a full Spring context closes it again.
 *
 * <p>Spring caches a booted context for the rest of the JVM. A full gateway
 * context starts its {@code RuntimeParticipants}, which subscribes a
 * {@code CacheInvalidationConsumer} on the shared NATS broker — so a cached
 * one stays subscribed and silently evicts keys for every later class in the
 * run. {@code CacheInvalidationConsumerIT} asserts a key SURVIVES after
 * {@code deactivate()}, so it fails with a {@code ConditionTimeout} that reads
 * as environmental: it passes alone and fails in {@code verify}. It was
 * misfiled as a load flake for exactly that reason before it was bisected, by
 * pairing it with each other IT, and found to be deterministic.
 * {@code @DirtiesContext(classMode = AFTER_CLASS)} closes the context, which
 * stops the participants and closes the subscription.
 *
 * <p><b>Scope is the failsafe classes, by the same names failsafe uses</b> —
 * {@code IT*}, {@code *IT}, {@code *ITCase}. The {@code @SpringBootTest}
 * classes named {@code *Test} run under surefire, in a JVM that has exited
 * before failsafe starts, so what they leave cached cannot reach it.
 *
 * <p><b>Annotations are matched at the start of a line</b>, which is where
 * this codebase's formatter puts a class-level annotation and where no comment
 * ever starts one. A bare substring match would let a comment that merely
 * mentions {@code @DirtiesContext} satisfy the rule while the annotation is
 * absent, and let a comment mentioning {@code @SpringBootTest} fail it.
 */
class IntegrationTestHygieneTest {

  private static final Path TEST_SOURCES = Path.of("src", "test", "java");

  private static final Pattern FAILSAFE_CLASS = Pattern.compile(
    "(?:IT.*|.*IT|.*ITCase)\\.java"
  );
  private static final Pattern BOOTS_A_FULL_CONTEXT = Pattern.compile(
    "(?m)^@SpringBootTest\\b"
  );
  private static final Pattern CLOSES_ITS_CONTEXT = Pattern.compile(
    "(?m)^@DirtiesContext\\b"
  );

  static boolean opensAContextItNeverCloses(String source) {
    return (
      BOOTS_A_FULL_CONTEXT.matcher(source).find() &&
      !CLOSES_ITS_CONTEXT.matcher(source).find()
    );
  }

  private static List<Path> failsafeClasses() {
    try (Stream<Path> files = Files.walk(TEST_SOURCES)) {
      return files
        .filter(Files::isRegularFile)
        .filter(file ->
          FAILSAFE_CLASS.matcher(file.getFileName().toString()).matches()
        )
        .toList();
    } catch (IOException failure) {
      throw new UncheckedIOException(failure);
    }
  }

  private static String read(Path file) {
    try {
      return Files.readString(file);
    } catch (IOException failure) {
      throw new UncheckedIOException(failure);
    }
  }

  @Test
  void everyFullContextItClosesItsContext() {
    List<String> offenders = failsafeClasses()
      .stream()
      .filter(file -> opensAContextItNeverCloses(read(file)))
      .map(Path::toString)
      .toList();

    assertThat(offenders)
      .as(
        "failsafe classes that boot a full context without @DirtiesContext — " +
          "each leaves a subscribed consumer cached for the rest of the run"
      )
      .isEmpty();
  }

  @Test
  void theScanReachesRealClassesAndSeesTheAnnotationItLooksFor() {
    // Without this a changed layout or a reformatted annotation would leave
    // the rule above passing over nothing and reporting compliance it never
    // checked.
    List<Path> classes = failsafeClasses();

    assertThat(classes).hasSizeGreaterThanOrEqualTo(5);
    assertThat(classes).anyMatch(file ->
      BOOTS_A_FULL_CONTEXT.matcher(read(file)).find()
    );
  }

  @Test
  void aFullContextWithoutTheAnnotationIsCaught() {
    assertThat(
      opensAContextItNeverCloses(
        "@SpringBootTest(webEnvironment = RANDOM_PORT)\nclass FooIT {}\n"
      )
    ).isTrue();
  }

  @Test
  void aFullContextThatClosesItIsNotReported() {
    assertThat(
      opensAContextItNeverCloses(
        "@SpringBootTest\n@DirtiesContext(classMode = AFTER_CLASS)\nclass FooIT {}\n"
      )
    ).isFalse();
  }

  @Test
  void aCommentMentioningTheAnnotationDoesNotSatisfyTheRule() {
    assertThat(
      opensAContextItNeverCloses(
        "/**\n * Uses {@code @DirtiesContext}, or will.\n */\n" +
          "@SpringBootTest\nclass FooIT {}\n"
      )
    ).isTrue();
  }

  @Test
  void aCommentMentioningSpringBootTestIsNotAFullContext() {
    assertThat(
      opensAContextItNeverCloses(
        "// not a @SpringBootTest, just talks to Redis\nclass FooIT {}\n"
      )
    ).isFalse();
  }
}
