package com.synapsedesk.gateway.webhookendpoints;

import com.synapsedesk.gateway.HttpProbe;
import com.synapsedesk.gateway.config.SharedEnvironmentInitializer;
import com.synapsedesk.gateway.generated.model.CreateWebhookEndpointDto;
import jakarta.validation.Valid;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Import;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@SpringBootTest(
  webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT,
  properties = "management.server.port=0"
)
@org.springframework.test.context.ContextConfiguration(
  initializers = SharedEnvironmentInitializer.class
)
@Import(ScratchHttpTest.Probes.class)
class ScratchHttpTest {

  @Value("${local.server.port}")
  private int port;

  @Validated
  @TestConfiguration
  @RestController
  static class Probes {

    @PostMapping("/probe/webhook-create")
    String create(@Valid @RequestBody CreateWebhookEndpointDto dto) {
      return dto.getUrl().toString();
    }
  }

  @Test
  void reproduce() {
    HttpProbe response = HttpProbe.post(
      port,
      "/probe/webhook-create",
      "{\"url\":\"https://example.com/hook\",\"eventTypes\":[\"ticket.assigned\"]}"
    );
    System.out.println("STATUS: " + response.status());
    System.out.println("BODY: " + response.body());
  }
}
