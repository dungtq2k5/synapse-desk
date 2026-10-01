package com.synapsedesk.gateway.graphql;

/**
 * `Version`, the GraphQL twin of the REST version response —
 * three fields, matched to the schema type by record-component name, the
 * same way `OpsController` builds the REST response from {@code runtime}.
 */
public record VersionGqlDto(String version, String sha, String builtAt) {}
