package com.synapsedesk.gateway.messages;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.security.RequirePermission;
import java.lang.reflect.Method;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * `MessagesApi` — 7 of its 8 routes are deliberately ungated (the thread is
 * how an end user talks to support; gating reads or replies would make the
 * product's core interaction staff-only), and exactly one, {@code redact},
 * is moderation and carries {@code ticket.message.moderate}. This is
 * precisely the shape a one-sided guard bug hides in: the property under
 * test is BOTH directions at once — the one gated method must stay gated,
 * and none of the seven ungated ones may quietly acquire a permission (which
 * would 403 ordinary users out of their own conversation) or lose it to the
 * wrong one (which {@code permission-coverage.contract-spec.ts} would also
 * catch, but a compile-time list here fails faster and names every route by
 * hand rather than trusting a regex over Node source).
 */
class MessagesControllerTest {

  private static final List<String> UNGATED_METHODS = List.of(
    "messagesControllerListV1",
    "messagesControllerCreateV1",
    "messagesControllerUpdateV1",
    "messagesControllerPresignNewAttachmentV1",
    "messagesControllerPresignAttachmentV1",
    "messagesControllerConfirmAttachmentV1",
    "messagesControllerListAttachmentsV1"
  );

  private static final String GATED_METHOD = "messagesControllerRedactV1";

  @Test
  void exactlyRedactCarriesARequirePermissionAnnotation() {
    List<Method> gated = java.util.Arrays.stream(
      MessagesController.class.getDeclaredMethods()
    )
      .filter(m -> m.isAnnotationPresent(RequirePermission.class))
      .toList();

    assertThat(gated).hasSize(1);
    assertThat(gated.get(0).getName()).isEqualTo(GATED_METHOD);
  }

  @Test
  void redactRequiresTicketMessageModerate() throws NoSuchMethodException {
    Method redact = java.util.Arrays.stream(
      MessagesController.class.getDeclaredMethods()
    )
      .filter(m -> m.getName().equals(GATED_METHOD))
      .findFirst()
      .orElseThrow();

    RequirePermission annotation = redact.getAnnotation(
      RequirePermission.class
    );
    assertThat(annotation).isNotNull();
    assertThat(annotation.value()).containsExactly(
      com.synapsedesk.gateway.model.CurrentUserResponseDto.PermissionCodesEnum.TICKET_MESSAGE_MODERATE
    );
  }

  @Test
  void noneOfTheSevenOrdinaryRoutesCarryAPermissionRequirement() {
    for (String name : UNGATED_METHODS) {
      boolean anyGated = java.util.Arrays.stream(
        MessagesController.class.getDeclaredMethods()
      )
        .filter(m -> m.getName().equals(name))
        .anyMatch(m -> m.isAnnotationPresent(RequirePermission.class));

      assertThat(anyGated)
        .as("%s must carry no @RequirePermission", name)
        .isFalse();
    }
  }
}
