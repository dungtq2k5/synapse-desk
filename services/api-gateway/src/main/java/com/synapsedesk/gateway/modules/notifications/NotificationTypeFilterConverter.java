package com.synapsedesk.gateway.modules.notifications;

import com.synapsedesk.gateway.modules.notifications.dto.rest.NotificationTypeFilter;
import org.springframework.core.convert.converter.Converter;
import org.springframework.stereotype.Component;

/**
 * The `type` query parameter: matched on the wire name, not the constant's. A
 * `Converter` bean, so Spring Boot registers it with MVC.
 */
@Component
public class NotificationTypeFilterConverter
  implements Converter<String, NotificationTypeFilter>
{

  @Override
  public NotificationTypeFilter convert(String value) {
    for (NotificationTypeFilter type : NotificationTypeFilter.values()) {
      if (type.wire().equals(value)) return type;
    }
    throw new IllegalArgumentException("unknown notification type");
  }
}
