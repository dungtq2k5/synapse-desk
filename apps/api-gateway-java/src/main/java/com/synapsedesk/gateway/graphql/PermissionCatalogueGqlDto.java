package com.synapsedesk.gateway.graphql;

import com.synapsedesk.gateway.roles.PermissionGqlDto;
import java.util.List;

/**
 * The loader's value type for {@link PermissionCatalogueLoaderConfig} — a
 * wrapper, not a bare {@code List<PermissionGqlDto>}, because Spring for
 * GraphQL resolves a controller's {@code DataLoader<K, V>} parameter to a
 * registered loader by {@code V}'s class; a raw {@code List} would collide
 * with every other list-valued loader this gateway ever registers.
 */
public record PermissionCatalogueGqlDto(List<PermissionGqlDto> items) {}
