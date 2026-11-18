package com.synapsedesk.gateway.common.grpc;

import static org.assertj.core.api.Assertions.assertThat;

import com.synapsedesk.gateway.common.auth.RequestContext;
import com.synapsedesk.gateway.common.auth.RequestOrigin;
import com.synapsedesk.gateway.common.contracts.GrpcMetadata;
import io.grpc.Metadata;
import java.util.List;
import org.junit.jupiter.api.Test;

/** The system flag: only {@link CallerMetadata#system} sets it. */
class CallerMetadataTest {

  private static final Metadata.Key<String> IS_SYSTEM = key(
    GrpcMetadata.GRPC_CONTEXT_METADATA_IS_SYSTEM
  );
  private static final Metadata.Key<String> ORGANIZATION_ID = key(
    GrpcMetadata.GRPC_CONTEXT_METADATA_ORGANIZATION_ID
  );
  private static final Metadata.Key<String> USER_ID = key(
    GrpcMetadata.GRPC_CONTEXT_METADATA_USER_ID
  );

  private static Metadata.Key<String> key(String name) {
    return Metadata.Key.of(name, Metadata.ASCII_STRING_MARSHALLER);
  }

  private static RequestContext user(boolean isSuperAdmin, String org) {
    return new RequestContext(
      "u1",
      org,
      isSuperAdmin,
      List.of(),
      List.of("ticket.read.all"),
      true,
      "",
      ""
    );
  }

  @Test
  void aSystemCallerNamesTheSystemAndTheTenantAndNoUser() {
    Metadata metadata = CallerMetadata.system(new RequestOrigin("", ""), "o1");

    assertThat(metadata.get(IS_SYSTEM)).isEqualTo("true");
    assertThat(metadata.get(ORGANIZATION_ID)).isEqualTo("o1");
    assertThat(metadata.containsKey(USER_ID)).isFalse();
  }

  @Test
  void aUsersContextNeverPacksTheSystemFlag() {
    assertThat(
      CallerMetadata.of(user(false, "o1")).containsKey(IS_SYSTEM)
    ).isFalse();
    // Not a Super Admin either: the one caller with no tenant.
    assertThat(
      CallerMetadata.of(user(true, null)).containsKey(IS_SYSTEM)
    ).isFalse();
    assertThat(
      CallerMetadata.of(new RequestOrigin("", ""), "u1").containsKey(IS_SYSTEM)
    ).isFalse();
  }
}
