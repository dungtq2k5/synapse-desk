package com.synapsedesk.gateway.realtime;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import com.corundumstudio.socketio.SocketIOServer;
import com.synapsedesk.gateway.config.RealtimeProperties;
import org.junit.jupiter.api.Test;
import org.redisson.api.RedissonClient;

/** The realtime server's listening socket, as {@link RealtimeServerConfig} configures it. */
class RealtimeServerConfigTest {

  @Test
  void theRealtimePortCanBeReboundWhileAnEarlierProcessesConnectionsAreInTimeWait() {
    SocketIOServer server = new RealtimeServerConfig().socketIOServer(
      new RealtimeProperties(0),
      mock(RedissonClient.class)
    );

    assertThat(
      server.getConfiguration().getSocketConfig().isReuseAddress()
    ).isTrue();
  }
}
