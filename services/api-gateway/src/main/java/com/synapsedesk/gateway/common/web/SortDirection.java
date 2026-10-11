package com.synapsedesk.gateway.common.web;

/**
 * The {@code sortOrder} query parameter of every list route: {@code ASC} or
 * {@code DESC}, exactly, as the published contract's enum says. Typed as an enum
 * so a value outside it is refused with a 400 before any handler or peer runs,
 * and so the document publishes the enum from the type; a plain string compared
 * case-insensitively accepted {@code desc} and anything else as {@code ASC}.
 */
public enum SortDirection {
  ASC,
  DESC,
}
