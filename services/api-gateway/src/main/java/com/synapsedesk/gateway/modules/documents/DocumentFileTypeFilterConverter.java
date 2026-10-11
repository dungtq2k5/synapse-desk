package com.synapsedesk.gateway.modules.documents;

import com.synapsedesk.gateway.modules.documents.dto.rest.DocumentFileTypeFilter;
import java.util.Locale;
import org.springframework.core.convert.converter.Converter;
import org.springframework.stereotype.Component;

/**
 * The `fileType` query parameter: case-insensitive, unlike Spring's default enum
 * conversion. A `Converter` bean, so Spring Boot registers it with MVC.
 */
@Component
public class DocumentFileTypeFilterConverter
  implements Converter<String, DocumentFileTypeFilter>
{

  @Override
  public DocumentFileTypeFilter convert(String value) {
    return DocumentFileTypeFilter.valueOf(value.toLowerCase(Locale.ROOT));
  }
}
