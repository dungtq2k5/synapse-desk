import { createServer, Server, Socket } from 'node:net';
import { AddressInfo } from 'node:net';

/**
 * A server that accepts every connection and never answers: the request that
 * nothing ends without a deadline.
 *
 * @example
 * const silent = await silentServer();
 * await expect(client.call(silent.url)).rejects.toThrow();
 * await silent.close();
 */
export async function silentServer(): Promise<{
  url: string;
  close: () => Promise<void>;
}> {
  const sockets = new Set<Socket>();
  const server: Server = createServer((socket) => sockets.add(socket));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise((resolve) => {
        sockets.forEach((socket) => socket.destroy());
        server.close(() => resolve());
      }),
  };
}
