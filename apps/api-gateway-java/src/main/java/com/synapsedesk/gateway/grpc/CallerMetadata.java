package com.synapsedesk.gateway.grpc;

import com.synapsedesk.gateway.auth.RequestContext;
import com.synapsedesk.gateway.auth.RequestOrigin;
import com.synapsedesk.gateway.contracts.GrpcMetadata;
import io.grpc.Metadata;
import java.util.List;

/**
 * Packs the caller's context onto outbound metadata — `packRequestContext`,
 * reproduced key for key against {@link GrpcMetadata}, the generated registry
 * both sides read.
 *
 * <p>Same omission the Node side makes: `organization_id` is left OFF the
 * metadata entirely for a null tenant (a Super Admin), rather than set to
 * `""` — an empty string would unpack as a tenant whose id IS the empty
 * string, which is not the same fact as "no tenant".
 */
public final class CallerMetadata {

  private static final Metadata.Key<String> IP =
      Metadata.Key.of(GrpcMetadata.GRPC_CONTEXT_METADATA_IP, Metadata.ASCII_STRING_MARSHALLER);
  private static final Metadata.Key<String> USER_AGENT =
      Metadata.Key.of(
          GrpcMetadata.GRPC_CONTEXT_METADATA_USER_AGENT, Metadata.ASCII_STRING_MARSHALLER);
  private static final Metadata.Key<String> USER_ID =
      Metadata.Key.of(GrpcMetadata.GRPC_CONTEXT_METADATA_USER_ID, Metadata.ASCII_STRING_MARSHALLER);
  private static final Metadata.Key<String> ORGANIZATION_ID =
      Metadata.Key.of(
          GrpcMetadata.GRPC_CONTEXT_METADATA_ORGANIZATION_ID, Metadata.ASCII_STRING_MARSHALLER);
  private static final Metadata.Key<String> IS_SUPER_ADMIN =
      Metadata.Key.of(
          GrpcMetadata.GRPC_CONTEXT_METADATA_IS_SUPER_ADMIN, Metadata.ASCII_STRING_MARSHALLER);
  private static final Metadata.Key<String> DEPARTMENT_IDS =
      Metadata.Key.of(
          GrpcMetadata.GRPC_CONTEXT_METADATA_DEPARTMENT_IDS, Metadata.ASCII_STRING_MARSHALLER);
  private static final Metadata.Key<String> PERMISSION_CODES =
      Metadata.Key.of(
          GrpcMetadata.GRPC_CONTEXT_METADATA_PERMISSION_CODES, Metadata.ASCII_STRING_MARSHALLER);
  private static final Metadata.Key<String> IS_EMAIL_VERIFIED =
      Metadata.Key.of(
          GrpcMetadata.GRPC_CONTEXT_METADATA_IS_EMAIL_VERIFIED, Metadata.ASCII_STRING_MARSHALLER);

  private CallerMetadata() {}

  /** An unauthenticated caller: `login`, `register`, password reset. */
  public static Metadata of(RequestOrigin origin) {
    Metadata metadata = new Metadata();
    metadata.put(IP, origin.ip());
    metadata.put(USER_AGENT, origin.userAgent());

    return metadata;
  }

  /** An authenticated caller — the full tenant filter travels with the call. */
  public static Metadata of(RequestContext context) {
    Metadata metadata = of(context.origin());
    metadata.put(USER_ID, context.sub());
    if (context.organizationId() != null && !context.organizationId().isEmpty()) {
      metadata.put(ORGANIZATION_ID, context.organizationId());
    }
    metadata.put(IS_SUPER_ADMIN, String.valueOf(context.isSuperAdmin()));
    metadata.put(DEPARTMENT_IDS, toJsonArray(context.departmentIds()));
    metadata.put(PERMISSION_CODES, toJsonArray(context.permissionCodes()));
    metadata.put(IS_EMAIL_VERIFIED, String.valueOf(context.isEmailVerified()));

    return metadata;
  }

  /** `["a","b"]` — matching `JSON.stringify(string[])`, which `unpackCallerContext` parses. */
  private static String toJsonArray(List<String> values) {
    StringBuilder json = new StringBuilder("[");
    for (int i = 0; i < values.size(); i++) {
      if (i > 0) {
        json.append(',');
      }
      json.append('"').append(values.get(i).replace("\"", "\\\"")).append('"');
    }

    return json.append(']').toString();
  }
}
