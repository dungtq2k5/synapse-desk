package com.synapsedesk.gateway.web;

/**
 * The {@code fileType} filter of the document and chunk lists, exactly as the
 * published contract's enum lists it: {@code bin}, {@code docx}, {@code md},
 * {@code pdf}, {@code txt}.
 *
 * <p><b>Read in any case.</b> The stored values are lowercase, so Node lowercases
 * the parameter before validating it ({@code ?fileType=PDF} works there), and
 * {@link EnumParameterConverters} does the same here. The constants are the
 * lowercase wire values, so the document publishes them as Node does.
 */
public enum DocumentFileTypeFilter {
  bin,
  docx,
  md,
  pdf,
  txt,
}
