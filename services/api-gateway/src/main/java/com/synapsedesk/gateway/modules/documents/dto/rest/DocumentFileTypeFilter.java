package com.synapsedesk.gateway.modules.documents.dto.rest;

import com.synapsedesk.gateway.modules.documents.DocumentFileTypeFilterConverter;

/**
 * The {@code fileType} filter of the document and chunk lists, exactly as the
 * published contract's enum lists it: {@code bin}, {@code docx}, {@code md},
 * {@code pdf}, {@code txt}.
 *
 * <p><b>Read in any case.</b> The stored values are lowercase, so
 * {@link DocumentFileTypeFilterConverter} lowercases the parameter before validating it
 * ({@code ?fileType=PDF} works). The constants are the lowercase wire values, so
 * the document publishes them in lowercase.
 */
public enum DocumentFileTypeFilter {
  bin,
  docx,
  md,
  pdf,
  txt,
}
