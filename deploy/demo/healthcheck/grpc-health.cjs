/**
 * A Node service's health, for Compose: the standard gRPC health check
 * (`grpc.health.v1.Health/Check`, the call the cluster's `grpc:` probe makes),
 * over the service's own `@grpc/grpc-js`.
 *
 * Exits 0 when the service answers SERVING, 1 otherwise. No proto file: an
 * empty request encodes to no bytes, and SERVING is field 1 set to 1, which
 * encodes to `08 01`.
 *
 * The port is the service's own `GRPC_PORT`, read from its environment (every
 * Node service's env file sets it); anything but a whole number from 1 to
 * 65535 exits 1 with a message. Run inside the service's container with its
 * modules on the path:
 *   NODE_PATH=/app/node_modules node /healthcheck/grpc-health.cjs
 */
const grpc = require('@grpc/grpc-js');

const raw = process.env.GRPC_PORT ?? '';
const port = /^\d{1,5}$/.test(raw) ? Number(raw) : 0;
if (port < 1 || port > 65535) {
  console.error(`GRPC_PORT must be a port from 1 to 65535, not "${raw}"`);
  process.exit(1);
}

const client = new grpc.Client(
  `127.0.0.1:${port}`,
  grpc.credentials.createInsecure(),
);
const deadline = new Date(Date.now() + 3000);

client.makeUnaryRequest(
  '/grpc.health.v1.Health/Check',
  () => Buffer.alloc(0),
  (bytes) => bytes,
  Buffer.alloc(0),
  { deadline },
  (error, response) => {
    client.close();
    const serving =
      !error &&
      response.length === 2 &&
      response[0] === 0x08 &&
      response[1] === 0x01;
    process.exit(serving ? 0 : 1);
  },
);
