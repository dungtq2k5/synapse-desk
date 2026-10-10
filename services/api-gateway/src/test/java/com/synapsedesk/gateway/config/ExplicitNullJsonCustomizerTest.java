package com.synapsedesk.gateway.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.model.CreateUserDto;
import com.synapsedesk.gateway.model.KnowledgeSearchDto;
import com.synapsedesk.gateway.model.MarkManyReadDto;
import java.math.BigDecimal;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

/**
 * An explicit null for a list, a number or a boolean leaves the DTO exactly as the key being
 * absent does: the default survives. Without the customizer these requests gave the
 * handler a null list and a 500.
 */
class ExplicitNullJsonCustomizerTest {

  private final JsonMapper mapper = mapper();

  private static JsonMapper mapper() {
    JsonMapper.Builder builder = JsonMapper.builder();
    new ExplicitNullJsonCustomizer().customize(builder);

    return builder.build();
  }

  @Test
  void anExplicitNullListKeepsItsEmptyDefault() throws Exception {
    CreateUserDto explicit = mapper.readValue(
      "{\"email\":\"a@example.com\",\"roleIds\":null,\"departmentIds\":null}",
      CreateUserDto.class
    );
    CreateUserDto absent = mapper.readValue(
      "{\"email\":\"a@example.com\"}",
      CreateUserDto.class
    );

    assertThat(explicit.getRoleIds()).isEmpty();
    assertThat(explicit.getDepartmentIds()).isEmpty();
    assertThat(explicit.getRoleIds()).isEqualTo(absent.getRoleIds());
    assertThat(explicit.getDepartmentIds()).isEqualTo(
      absent.getDepartmentIds()
    );
  }

  @Test
  void anExplicitNullNumberKeepsItsDefault() throws Exception {
    KnowledgeSearchDto explicit = mapper.readValue(
      "{\"query\":\"q\",\"limit\":null}",
      KnowledgeSearchDto.class
    );
    KnowledgeSearchDto absent = mapper.readValue(
      "{\"query\":\"q\"}",
      KnowledgeSearchDto.class
    );

    assertThat(explicit.getLimit()).isNotNull();
    assertThat(explicit.getLimit()).isEqualByComparingTo(absent.getLimit());
  }

  @Test
  void aListThatWasSentIsStillRead() throws Exception {
    MarkManyReadDto sent = mapper.readValue(
      "{\"ids\":[\"aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa\"]}",
      MarkManyReadDto.class
    );

    assertThat(sent.getIds()).hasSize(1);
  }

  @Test
  void aNumberThatWasSentIsStillRead() throws Exception {
    KnowledgeSearchDto sent = mapper.readValue(
      "{\"query\":\"q\",\"limit\":25}",
      KnowledgeSearchDto.class
    );

    assertThat(sent.getLimit()).isEqualByComparingTo(new BigDecimal("25"));
  }

  @Test
  void anExplicitNullBooleanKeepsItsDefault() throws Exception {
    // `true` by default: a null read as false would make the document private.
    com.synapsedesk.gateway.model.ConfirmDocumentDto dto = mapper.readValue(
      "{\"isOrganizationWide\":null}",
      com.synapsedesk.gateway.model.ConfirmDocumentDto.class
    );

    assertThat(dto.getIsOrganizationWide()).isTrue();
  }
}
