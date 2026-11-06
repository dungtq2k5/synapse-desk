/**
 * A Node service's health, for Compose: the standard gRPC health check
 * (`grpc.health.v1.Health/Check`, the call the cluster's `grpc:` probe makes),
 * over the service's own `@grpc/grpc-js`.
 *
 * Exits 0 when the service answers SERVING, 1 otherwise. No proto file: an
 * empty request encodes to no bytes, and SERVING is field 1 set to 1, which
 * encodes to `08 01`.
 *
 * Run inside the service's container with its modules on the path:
 *   NODE_PATH=/app/node_modules node /healthcheck/grpc-health.cjs 5001
 */
const grpc = require('@grpc/grpc-js');

const port = process.argv[2];
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
