/**
 * @file The walking skeleton: a gateway PROCESS starts, answers, and stops.
 *
 * Every later row depends on these three facts, and none of them is about a
 * route: that the harness can start the implementation under test on ports it
 * chose, reach it over real HTTP, and leave nothing behind. `/version` is the
 * cheapest route that proves the process is serving — it sits outside the
 * global prefix and needs no peer, no cookie and no database.
 */

import { type Gateway, startGateway } from './gateway';
import { Session } from './client';
import { readRunState } from './run-state';
import { rowFor } from './pending';

describe('the gateway under test', () => {
  let gateway: Gateway;

  beforeAll(async () => {
    const { redisUrl, natsUrl } = readRunState();
    gateway = await startGateway({ REDIS_URL: redisUrl, NATS_URL: natsUrl });
  }, 90_000);

  afterAll(async () => {
    await gateway.stop();
  });

  rowFor('Ops')(
    '**serves `/version` outside the prefix**, over real HTTP',
    async () => {
      const response = await new Session(gateway.baseUrl).get<{
        success: boolean;
        data: { version: string; name: string };
      }>('/version');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.version).toMatch(/^\d+\.\d+\.\d+/u);
    },
  );

  rowFor('Ops')(
    'answers `/health/ready` — what the harness waited on',
    async () => {
      const response = await new Session(gateway.baseUrl).get<{
        data: { ready: boolean };
      }>('/health/ready');

      expect(response.status).toBe(200);
      expect(response.body.data.ready).toBe(true);
    },
  );
});
