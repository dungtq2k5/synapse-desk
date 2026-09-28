package com.synapsedesk.gateway.graphql;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.config.SharedEnvironmentInitializer;
import java.io.IOException;
import java.lang.reflect.Method;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.ApplicationContext;
import org.springframework.graphql.data.method.annotation.MutationMapping;
import org.springframework.graphql.data.method.annotation.QueryMapping;
import org.springframework.test.context.ContextConfiguration;

/**
 * Every root `Query`/`Mutation` field in the tracked schema is resolved, or
 * listed as pending — the GraphQL analogue of {@code GeneratedApiCoverageTest}.
 *
 * <p>
 * <b>There is no generated interface here.</b> `schema.gql` generates
 * nothing on the Java side, so this reads the SCHEMA ITSELF — copied to the
 * classpath by `pom.xml`'s `graphql-schema` resources execution — rather than
 * a `target/generated-sources` directory. The direction is the same as the
 * REST coverage test: from the tracked contract toward the code, never from
 * a document about the code.
 *
 * <p>
 * Implemented means <b>a bean exposes a `@QueryMapping`/`@MutationMapping`
 * method for that field name</b>, not that a resolver class exists.
 */
@SpringBootTest(properties = "management.server.port=0")
@ContextConfiguration(initializers = SharedEnvironmentInitializer.class)
class GraphqlFieldCoverageTest {

  private static final Path SCHEMA = Path.of(
    "target/classes/schema/schema.gql"
  );

  private static final Path PENDING = Path.of(
    "src/test/resources/pending-graphql-fields.txt"
  );

  /** A root field line: exactly two leading spaces, then the field name. */
  private static final java.util.regex.Pattern FIELD_LINE =
    java.util.regex.Pattern.compile("^ {2}([A-Za-z_][A-Za-z0-9_]*)\\s*[:(]");

  @Autowired
  private ApplicationContext context;

  @Test
  void everyRootFieldIsResolvedOrPending() throws IOException {
    Set<String> pending = pending();
    List<String> findings = new ArrayList<>();

    for (String field : schemaFields()) {
      if (pending.contains(field) || resolved().contains(field)) {
        continue;
      }

      findings.add(
        field +
          ": no @QueryMapping/@MutationMapping resolves it, and it is not listed as pending"
      );
    }

    assertThat(findings).isEmpty();
  }

  @Test
  void thePendingListHasNoStaleEntries() throws IOException {
    Set<String> schema = schemaFields();
    Set<String> implemented = resolved();
    List<String> stale = new ArrayList<>();

    for (String field : pending()) {
      if (!schema.contains(field)) {
        stale.add(
          field +
            ": listed as pending, but the schema declares no such root field"
        );
        continue;
      }
      if (implemented.contains(field)) {
        stale.add(field + ": resolved — remove it from the list");
      }
    }

    assertThat(stale).isEmpty();
  }

  @Test
  void theListOnlyEverShrinks() throws IOException {
    // 24 root fields — 20 Query + 4 Mutation. All 24 resolved: version,
    // departments, document, documents, ingestionJob, ingestionJobs,
    // notifications, unreadNotificationCount, markNotificationRead, me,
    // role, roles, permissions, user, users, ticket, tickets,
    // analyticsOverview, analyticsAgents, analyticsDocuments,
    // analyticsKnowledgeGaps, assignTicket, escalateTicket,
    // transitionTicketStatus. Nothing pending.
    assertThat(schemaFields()).hasSize(24);
    assertThat(pending()).isEmpty();
  }

  @Test
  void theScanReadsTheRealSchema() {
    assertThat(Files.isRegularFile(SCHEMA))
      .as("%s — run `mvn generate-resources`", SCHEMA.toAbsolutePath())
      .isTrue();
  }

  /** Every root `Query`/`Mutation` field, prefixed, from the tracked schema. */
  private Set<String> schemaFields() throws IOException {
    List<String> lines = Files.readAllLines(SCHEMA);
    Set<String> fields = new TreeSet<>();

    fields.addAll(rootFieldsOf(lines, "type Query {", "Query."));
    fields.addAll(rootFieldsOf(lines, "type Mutation {", "Mutation."));

    return fields;
  }

  private static Set<String> rootFieldsOf(
    List<String> lines,
    String opener,
    String prefix
  ) {
    Set<String> fields = new TreeSet<>();
    int start = lines.indexOf(opener);
    if (start < 0) {
      return fields;
    }

    for (
      int i = start + 1;
      i < lines.size() && !lines.get(i).equals("}");
      i++
    ) {
      var matcher = FIELD_LINE.matcher(lines.get(i));
      if (matcher.find()) {
        fields.add(prefix + matcher.group(1));
      }
    }

    return fields;
  }

  /** Every root field a `@QueryMapping`/`@MutationMapping` bean resolves. */
  private Set<String> resolved() {
    Set<String> fields = new TreeSet<>();

    for (String name : context.getBeanDefinitionNames()) {
      Object bean;
      try {
        bean = context.getBean(name);
      } catch (Exception cause) {
        continue;
      }

      // `AopUtils.getTargetClass`, not `bean.getClass()`: a `*Resolver` bean
      // carrying `@RequirePermission` is CGLIB-proxied by
      // `GraphqlPermissionAspect`, and a proxy's own generated override does
      // not reliably carry the original method's annotations under plain
      // reflection — this scan went blind on `DepartmentsResolver` the day
      // the aspect started proxying it, the same "wrong direction" shape as
      // every other guard bug this project has found.
      Class<?> targetClass =
        org.springframework.aop.support.AopUtils.getTargetClass(bean);

      for (Method method : targetClass.getMethods()) {
        QueryMapping query = method.getAnnotation(QueryMapping.class);
        if (query != null) {
          fields.add(
            "Query." + fieldNameOf(query.name(), query.value(), method)
          );
        }

        MutationMapping mutation = method.getAnnotation(MutationMapping.class);
        if (mutation != null) {
          fields.add(
            "Mutation." + fieldNameOf(mutation.name(), mutation.value(), method)
          );
        }
      }
    }

    return fields;
  }

  private static String fieldNameOf(String name, String value, Method method) {
    if (!name.isEmpty()) {
      return name;
    }
    if (!value.isEmpty()) {
      return value;
    }
    return method.getName();
  }

  /** The tracked list, comments and blank lines dropped. */
  private Set<String> pending() throws IOException {
    return Files.readAllLines(PENDING)
      .stream()
      .map(String::trim)
      .filter(line -> !line.isEmpty() && !line.startsWith("#"))
      .collect(java.util.stream.Collectors.toCollection(TreeSet::new));
  }
}
