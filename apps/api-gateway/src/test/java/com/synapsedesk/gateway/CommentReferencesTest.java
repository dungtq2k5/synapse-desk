package com.synapsedesk.gateway;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/**
 * What this gateway's comments point at exists.
 *
 * <p>A comment that explains a behaviour by another implementation explains it by
 * something a reader cannot open, and a comment that cites a file that is gone sends
 * them nowhere. So, over comment text only, in the Java sources and
 * {@code application.yaml}:
 *
 * <ul>
 *   <li>the runtime's name, as the {@code NODE} pattern spells it — case-sensitive
 *       and whole, so {@code JsonNode} and {@code NODE_ENV} do not match — does not
 *       appear;
 *   <li>every {@code *.ts} file a comment cites exists in the repository. A rule
 *       shared with a TypeScript service cites that service's file, and this proves
 *       the file is there;
 *   <li>every "gap N" a comment cites is a row of
 *       {@code docs/reference/known-gaps.md}.
 * </ul>
 *
 * <p>Read from the code toward the tree, so a new comment is held without being
 * listed anywhere.
 */
class CommentReferencesTest {

  private static final Path MODULE = Path.of("").toAbsolutePath();
  private static final Path REPO = MODULE.getParent().getParent();

  private static final Pattern BLOCK = Pattern.compile(
    "/\\*.*?\\*/",
    Pattern.DOTALL
  );
  private static final Pattern LINE = Pattern.compile("//[^\\n]*");
  private static final Pattern YAML_COMMENT = Pattern.compile("(?m)#[^\\n]*");
  private static final Pattern NODE = Pattern.compile("\\bNode\\b");
  private static final Pattern CITED_TS = Pattern.compile(
    "([A-Za-z0-9_.-]+)\\.ts\\b"
  );
  private static final Pattern CITED_GAP = Pattern.compile(
    "(?i)\\bgap\\s+#?(\\d+)\\b"
  );
  private static final Pattern GAP_ROW = Pattern.compile(
    "(?m)^\\|\\s*(\\d+)\\s*\\|"
  );
  private static final Set<String> SKIPPED = Set.of(
    "node_modules",
    "dist",
    "target",
    ".git",
    ".turbo",
    ".venv",
    "generated"
  );

  /** Comment text of one source file, with each comment's line number. */
  private record Comment(Path file, int line, String text) {}

  private static List<Comment> comments(Path file) throws IOException {
    String source = Files.readString(file);
    List<Comment> found = new ArrayList<>();
    List<Pattern> patterns = file.toString().endsWith(".java")
      ? List.of(BLOCK, LINE)
      : List.of(YAML_COMMENT);
    for (Pattern pattern : patterns) {
      Matcher matcher = pattern.matcher(source);
      while (matcher.find()) {
        int line =
          (int) source
            .substring(0, matcher.start())
            .chars()
            .filter(c -> c == '\n')
            .count() + 1;
        found.add(new Comment(file, line, matcher.group()));
      }
    }
    return found;
  }

  private static List<Comment> allComments() throws IOException {
    List<Comment> all = new ArrayList<>();
    try (Stream<Path> files = Files.walk(MODULE.resolve("src"))) {
      for (Path file : files
        .filter(
          path ->
            path.toString().endsWith(".java") ||
            path.getFileName().toString().equals("application.yaml")
        )
        .toList()) {
        all.addAll(comments(file));
      }
    }
    return all;
  }

  /** The row numbers of {@code docs/reference/known-gaps.md}. */
  private static Set<String> gapRows() throws IOException {
    return GAP_ROW.matcher(
      Files.readString(REPO.resolve("docs/reference/known-gaps.md"))
    )
      .results()
      .map(row -> row.group(1))
      .collect(Collectors.toSet());
  }

  /** Every {@code *.ts} file name in the repository, outside build output. */
  private static Set<String> typeScriptFiles() throws IOException {
    try (Stream<Path> files = Files.walk(REPO)) {
      return files
        .filter(path -> {
          for (Path part : REPO.relativize(path)) {
            if (SKIPPED.contains(part.toString())) return false;
          }
          return path.toString().endsWith(".ts");
        })
        .map(path -> path.getFileName().toString())
        .collect(Collectors.toSet());
    }
  }

  private static String where(Comment comment) {
    return MODULE.relativize(comment.file()) + ":" + comment.line();
  }

  @Test
  void theCorpusIsNotEmpty() throws IOException {
    // A pattern that matched nothing would agree with everything.
    assertThat(allComments()).hasSizeGreaterThan(1_000);
    assertThat(typeScriptFiles()).contains("realtime.contract.ts");
    assertThat(gapRows()).contains("1", "38");
  }

  @Test
  void noCommentNamesAnotherImplementation() throws IOException {
    List<String> found = new ArrayList<>();
    for (Comment comment : allComments()) {
      if (NODE.matcher(comment.text()).find()) found.add(where(comment));
    }
    assertThat(found).isEmpty();
  }

  @Test
  void everyCitedTypeScriptFileExists() throws IOException {
    Set<String> present = typeScriptFiles();
    List<String> missing = new ArrayList<>();
    for (Comment comment : allComments()) {
      Matcher cited = CITED_TS.matcher(comment.text());
      while (cited.find()) {
        String name = cited.group(1) + ".ts";
        if (!present.contains(name)) missing.add(where(comment) + " " + name);
      }
    }
    assertThat(missing).isEmpty();
  }

  @Test
  void everyCitedGapIsARow() throws IOException {
    Set<String> rows = gapRows();
    List<String> missing = new ArrayList<>();
    for (Comment comment : allComments()) {
      Matcher cited = CITED_GAP.matcher(comment.text());
      while (cited.find()) {
        if (!rows.contains(cited.group(1))) {
          missing.add(where(comment) + " gap " + cited.group(1));
        }
      }
    }
    assertThat(missing).isEmpty();
  }
}
