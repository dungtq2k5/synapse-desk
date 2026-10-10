package com.synapsedesk.gateway.web;

import java.util.Locale;
import org.springframework.format.FormatterRegistry;

/**
 * The two enum parameters Spring's by-constant-name conversion cannot read: the
 * document-file-type filter, which is read in any case, and the notification
 * type, whose wire values are dotted. A value that does not convert throws, which
 * the gateway answers as a 400 naming the parameter.
 */
public final class EnumParameterConverters {

  private EnumParameterConverters() {}

  public static void register(FormatterRegistry registry) {
    registry.addConverter(String.class, DocumentFileTypeFilter.class, value ->
      DocumentFileTypeFilter.valueOf(value.toLowerCase(Locale.ROOT))
    );
    registry.addConverter(String.class, NotificationTypeFilter.class, value -> {
      for (NotificationTypeFilter type : NotificationTypeFilter.values()) {
        if (type.wire().equals(value)) return type;
      }
      throw new IllegalArgumentException("unknown notification type");
    });
  }
}
