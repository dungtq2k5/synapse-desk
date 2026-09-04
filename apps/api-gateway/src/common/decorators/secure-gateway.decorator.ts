import { applyDecorators, UseFilters } from '@nestjs/common';
import { GatewayMetadata, WebSocketGateway } from '@nestjs/websockets';
import { AllWsExceptionsFilter } from '../filters/ws-exception.filter';
import { corsOrigins } from '../config/cors.config';

/**
 * `@WebSocketGateway` plus the three things every gateway must have, two of
 * which are easy to forget.
 *
 * Same reasoning as registering `SmartThrottlerGuard` with `APP_GUARD` rather
 * than per controller: the gateway someone adds later and forgets to wire is
 * reliably the interesting one. Composing them here means a new gateway is
 * secured by DEFAULT, and opting out is a visible edit rather than an omission.
 *
 * CORS is not optional for a browser client — a socket handshake is subject to
 * the same origin rules as any other request, and the default (`*` off, no
 * credentials) refuses the cookie the handshake authenticates with.
 *
 * The transport pin is the third, and it is the one that is invisible until
 * there are two replicas — see the comment on `transports` below.
 */
export function SecureGateway(
  namespace: string,
  options?: Omit<GatewayMetadata, 'namespace'>,
) {
  return applyDecorators(
    WebSocketGateway({
      namespace,
      cors: {
        /**
         * Resolved per handshake, from the SAME `CORS` var the HTTP side
         * validates through Joi at boot.
         *
         * Deliberately not a second `SOCKET_CORS` variable: two lists is two
         * chances for a deployment to allow an origin over HTTP and refuse it
         * over WebSocket, which presents to a user as "the app loads but never
         * updates" — the hardest kind of misconfiguration to attribute.
         *
         * Read from `process.env` because a decorator is evaluated at class
         * definition time, before any DI container exists. `envValidationSchema`
         * has already made the variable's presence a boot-time failure, so the
         * fallback below is unreachable in a running app; it exists so a unit
         * test importing the class does not need an environment.
         */
        origin: (
          origin: string | undefined,
          callback: (error: Error | null, allow?: boolean) => void,
        ) => {
          // The SAME normalization the HTTP side uses — see `cors.config.ts`.
          // Splitting here and there was one value read two ways, and the
          // untrimmed split additionally refused an origin whose only fault was
          // a space after the comma.
          const allowed = corsOrigins(process.env.CORS ?? '*');

          // A missing Origin header is a non-browser client (a CLI, a server,
          // our own e2e suite) — there is no origin to refuse, and refusing it
          // would block exactly the callers CORS was never about.
          if (!origin || allowed === '*' || allowed.includes(origin)) {
            callback(null, true);
            return;
          }

          callback(new Error(`Origin ${origin} is not allowed`));
        },
        // Required for the handshake to carry the HttpOnly access-token cookie
        // at all. Without it the browser sends no cookie and every connection
        // is anonymous.
        credentials: true,
      },
      ...options,

      // **WebSocket only, and this is a deployment constraint rather than a
      // preference.** Socket.IO's default `['polling', 'websocket']` starts
      // with an HTTP handshake that must reach the SAME replica —
      // `@socket.io/redis-adapter` shares broadcasts, not handshake state — so
      // polling across more than one gateway pod produces `Session ID unknown`
      // and a reconnect loop. Pinning here makes a polling client fail its
      // handshake immediately and visibly, instead of working on one replica
      // and failing on the next. `docs/websocket-api.md` already tells clients
      // the same thing; this is what makes it true rather than advisory.
      //
      // **After `...options`, deliberately.** `cors` above is a default a
      // caller may replace; this is not one. A constraint a caller can unset
      // by passing `transports` is a constraint that fails on the pod nobody
      // tested, which is the failure this line exists to remove.
      transports: ['websocket'],
    }),

    UseFilters(new AllWsExceptionsFilter()),
  );
}
