/**
 * @file **A caller whose email address is not verified is refused with 403 on the routes
 * that send mail on the tenant's behalf, before the body is read.**
 *
 * Node puts `EmailVerifiedGuard` on two routes, creating an invitation and resending
 * one, because an unverified inviter could spray invitations from an unproven address.
 * It runs after the session and ahead of the validation pipe, so an unverified caller who
 * also sends an invalid body is told to verify, not what is wrong with the body. Java
 * checked the claim inside the handler, after the body was bound, so the creating route
 * answered 400 where Node answers 403 (found by sending `{}` as an unverified member to
 * every secured route that takes a required body field: 51 routes, 1 differed).
 *
 * **The route set is found in the Java gateway's source, then named.** A scan of its
 * sources for a method annotated `@RequireVerifiedEmail` (the interceptor reads it from
 * the method, never the class) must find exactly the two routes named here, so a third
 * guarded route fails until it is given rows.
 *
 * **Controls make each refusal mean something.** The creating route is also sent the same
 * invalid body by a VERIFIED caller, which must be a 400: that shows the body really is
 * invalid and the 403 is about the email. The resend route has no body, so its control is
 * a verified caller, who must not be refused with 403. A refusal must ask no peer; the
 * wording is not asserted (the parity rule). A super admin is exempt, which these rows do
 * not send; it is held by the interceptor's unit test.
 */

import { globSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { type Gateway, REPO_ROOT, startGateway } from './gateway';
import { type Peers, startPeers } from './peers';
import { rowFor } from './pending';
import {
  allOperations,
  bodySender,
  freshSubject,
  minimalValue,
} from './request-bodies';
import { readRunState } from './run-state';

const CREATE = 'POST /api/v1/users/invitations';
const RESEND = 'POST /api/v1/users/invitations/{id}/resend';

describe('the routes that need a verified email', () => {
  it('are exactly the two named here', () => {
    const guarded = globSync('apps/api-gateway-java/src/main/java/**/*.java', {
      cwd: REPO_ROOT,
    }).flatMap((file) =>
      readFileSync(join(REPO_ROOT, file), 'utf8')
        .split('\n')
        .filter((line) => /^\s*@RequireVerifiedEmail\s*$/u.test(line)),
    );

    expect(guarded).toHaveLength(2);
    expect(
      allOperations()
        .map((operation) => `${operation.method} ${operation.path}`)
        .filter((key) => key === CREATE || key === RESEND),
    ).toHaveLength(2);
  });
});

describe('an unverified caller', () => {
  let gateway: Gateway;
  let peers: Peers;

  beforeAll(async () => {
    const { redisUrl, natsUrl } = readRunState();
    peers = await startPeers();
    gateway = await startGateway({
      ...peers.env,
      REDIS_URL: redisUrl,
      NATS_URL: natsUrl,
    });
  }, 90_000);

  afterAll(async () => {
    await gateway.stop();
    await peers.stop();
  });

  const send = bodySender(
    () => gateway,
    () => peers,
  );

  const create = allOperations().find(
    (operation) => `${operation.method} ${operation.path}` === CREATE,
  )!;

  const request = (path: string, unverified: boolean) => ({
    method: 'POST',
    path,
    public: false,
    unverified,
  });

  rowFor('Ops')(
    `**\`${CREATE}\` refuses an unverified caller with 403, before reading the body**`,
    async () => {
      const valid = await send(
        request(create.path, true),
        minimalValue(create.body!),
        freshSubject(),
      );
      expect(valid.status).toBe(403);
      expect(valid.asked).toEqual([]);

      const invalid = await send(
        request(create.path, true),
        {},
        freshSubject(),
      );
      expect(invalid.status).toBe(403);
      expect(invalid.asked).toEqual([]);
    },
  );

  rowFor('Ops')(
    `**\`${CREATE}\`: the same invalid body from a verified caller is a 400, so the 403 above is about the email**`,
    async () => {
      const verified = await send(
        request(create.path, false),
        {},
        freshSubject(),
      );

      expect(verified.status).toBe(400);
      expect(verified.asked).toEqual([]);
    },
  );

  rowFor('Ops')(
    `**\`${RESEND}\` refuses an unverified caller with 403 and a verified one is not refused**`,
    async () => {
      const unverified = await send(
        request(RESEND.replace('POST ', ''), true),
        undefined,
        freshSubject(),
      );
      expect(unverified.status).toBe(403);
      expect(unverified.asked).toEqual([]);

      const verified = await send(
        request(RESEND.replace('POST ', ''), false),
        undefined,
        freshSubject(),
      );
      expect(verified.status).not.toBe(403);
    },
  );
});
