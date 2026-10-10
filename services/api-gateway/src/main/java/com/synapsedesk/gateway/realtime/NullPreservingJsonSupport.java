package com.synapsedesk.gateway.realtime;

import com.corundumstudio.socketio.protocol.JacksonJsonSupport;
import com.fasterxml.jackson.annotation.JsonInclude.Include;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * netty-socketio's own {@code JacksonJsonSupport.init} sets {@code NON_NULL},
 * which silently drops every null field an emitted payload carries — measured
 * (P1): a `body: null` or `actionUrl: null` a client expects to see would
 * simply vanish. Overriding {@code init} to widen the inclusion to
 * {@code ALWAYS} is the only change this needs.
 *
 * <p><b>A separate Jackson.</b> netty-socketio is compiled against classic
 * {@code com.fasterxml.jackson}, not the {@code tools.jackson} (Jackson 3)
 * this gateway otherwise uses. Both live on the classpath under different
 * package names — nothing here reaches the app's own {@code ObjectMapper}, and
 * nothing the app's own code does reaches this one.
 */
public class NullPreservingJsonSupport extends JacksonJsonSupport {

  @Override
  protected void init(ObjectMapper objectMapper) {
    super.init(objectMapper);
    objectMapper.setDefaultPropertyInclusion(Include.ALWAYS);
  }
}
