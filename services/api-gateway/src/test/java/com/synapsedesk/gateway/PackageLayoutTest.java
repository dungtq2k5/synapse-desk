package com.synapsedesk.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/**
 * The package layout's three rules: {@code common/} never imports {@code modules/};
 * no string literal names a package below {@code com.synapsedesk.gateway}; and no
 * two published request or response classes share a simple name.
 *
 * <p>Read from the files, so a new class is held without being listed anywhere.
 */
class PackageLayoutTest {

  private static final Path MODULE = Path.of("").toAbsolutePath();
  private static final Path GATEWAY = MODULE.resolve(
    "src/main/java/com/synapsedesk/gateway"
  );

  private static final Pattern BLOCK_COMMENT = Pattern.compile(
    "/\\*.*?\\*/",
    Pattern.DOTALL
  );
  private static final Pattern STRING = Pattern.compile(
    "\"(?:[^\"\\\\\\n]|\\\\.)*\""
  );
  /**
   * A package name below the root: {@code com.synapsedesk.gateway.} then a letter.
   * The root itself, alone or with a trailing dot, and {@code gateway..} (an AspectJ
   * "any depth below") name no package that can move.
   */
  private static final Pattern SUB_PACKAGE = Pattern.compile(
    "com\\.synapsedesk\\.gateway\\.[A-Za-z]"
  );
  private static final Pattern MODULES_REFERENCE = Pattern.compile(
    "com\\.synapsedesk\\.gateway\\.modules\\."
  );

  private static List<Path> javaFiles(Path root) throws IOException {
    if (!Files.isDirectory(root)) return List.of();
    try (Stream<Path> files = Files.walk(root)) {
      return files
        .filter(path -> path.toString().endsWith(".java"))
        .sorted()
        .toList();
    }
  }

  /** The source with block comments removed, and line comments that start a line's code. */
  private static String code(Path file) throws IOException {
    String text = BLOCK_COMMENT.matcher(Files.readString(file)).replaceAll(" ");
    return text
      .lines()
      .map(line -> {
        int comment = line.indexOf("//");
        int quote = line.indexOf('"');
        return comment >= 0 && (quote < 0 || comment < quote)
          ? line.substring(0, comment)
          : line;
      })
      .collect(Collectors.joining("\n"));
  }

  static List<String> subPackageLiterals(String code) {
    List<String> found = new ArrayList<>();
    Matcher literal = STRING.matcher(code);
    while (literal.find()) {
      if (SUB_PACKAGE.matcher(literal.group()).find()) found.add(
        literal.group()
      );
    }
    return found;
  }

  // ------------------------------------------------- common never imports modules

  @Test
  void commonNeverReferencesAModule() throws IOException {
    List<String> offenders = new ArrayList<>();
    for (Path file : javaFiles(GATEWAY.resolve("common"))) {
      if (MODULES_REFERENCE.matcher(code(file)).find()) {
        offenders.add(MODULE.relativize(file).toString());
      }
    }

    assertThat(offenders).isEmpty();
  }

  // --------------------------------------------- no package name in a string

  /**
   * Spring drops an AOP advice whose pointcut names a type that does not resolve,
   * without an error, so a class moved under such a string stops being advised. A
   * name in a string is one the compiler cannot follow; this keeps them out.
   */
  @Test
  void noStringLiteralNamesASubPackage() throws IOException {
    List<String> offenders = new ArrayList<>();
    List<Path> sources = new ArrayList<>(javaFiles(GATEWAY));
    sources.addAll(javaFiles(MODULE.resolve("src/test/java")));
    for (Path file : sources) {
      for (String literal : subPackageLiterals(code(file))) {
        offenders.add(MODULE.relativize(file) + ": " + literal);
      }
    }

    // The floor: the scan reads the sources at all.
    assertThat(sources).hasSizeGreaterThan(500);
    assertThat(offenders).isEmpty();
  }

  @Test
  void theStringScanSeesAPackageAndSparesTheRoot() {
    assertThat(
      subPackageLiterals(
        // Built from two literals, neither of which names a package, so the
        // scan over this file does not find its own sample.
        "x = \"@annotation(" +
          "com.synapsedesk.gateway" +
          ".security.RequirePermission)\";"
      )
    ).hasSize(1);
    assertThat(
      subPackageLiterals(
        "a = \"com.synapsedesk.gateway.\"; b = \"com.synapsedesk.gateway\"; " +
          "c = \"execution(* com.synapsedesk.gateway..*Resolver.*(..))\";"
      )
    ).isEmpty();
  }

  // ------------------------------------------- published classes, unique names

  /**
   * springdoc names a schema by its class's simple name, so two request or response
   * classes with one name would publish as one schema, the second silently replacing
   * the first. Top-level classes only: nested enums are published inline.
   */
  @Test
  void noTwoPublishedClassesShareASimpleName() throws IOException {
    List<Path> published = new ArrayList<>(javaFiles(GATEWAY.resolve("model")));
    published.addAll(javaFiles(GATEWAY.resolve("common/dto")));
    for (Path module : directories(GATEWAY.resolve("modules"))) {
      published.addAll(javaFiles(module.resolve("dto")));
    }

    Map<String, List<String>> byName = published
      .stream()
      .collect(
        Collectors.groupingBy(
          file -> file.getFileName().toString(),
          Collectors.mapping(
            file -> MODULE.relativize(file).toString(),
            Collectors.toList()
          )
        )
      );

    assertThat(published).hasSizeGreaterThan(200);
    assertThat(
      byName
        .entrySet()
        .stream()
        .filter(entry -> entry.getValue().size() > 1)
    ).isEmpty();
  }

  private static List<Path> directories(Path root) throws IOException {
    if (!Files.isDirectory(root)) return List.of();
    try (Stream<Path> entries = Files.list(root)) {
      return entries.filter(Files::isDirectory).sorted().toList();
    }
  }
}
