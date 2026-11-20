/**
 * A stand-in for `socket.io-client`: `io()` hands out a fake socket a test
 * drives. `receive` plays a server frame to the listeners; what the client
 * emits is kept in `emitted`; `acks` answers `emitWithAck` per event (an
 * event with no answer rejects, as a timeout would).
 *
 * @example
 * jest.mock('socket.io-client', () => jest.requireActual('@/test/socket'));
 * const socket = lastSocket();
 * act(() => socket.receive(REALTIME_EVENTS.connectionReady, {}));
 */
type Listener = (payload: unknown) => void;

export class FakeSocket {
  readonly listeners = new Map<string, Set<Listener>>();
  readonly emitted: [string, unknown][] = [];
  acks: Record<string, (payload: unknown) => unknown> = {};
  connects = 0;
  disconnects = 0;

  constructor(
    readonly url: string,
    readonly options: unknown,
  ) {}

  on(event: string, listener: Listener) {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
    return this;
  }

  off(event: string, listener: Listener) {
    this.listeners.get(event)?.delete(listener);
    return this;
  }

  removeAllListeners() {
    this.listeners.clear();
    return this;
  }

  emit(event: string, payload?: unknown) {
    this.emitted.push([event, payload]);
    return this;
  }

  timeout() {
    return this;
  }

  emitWithAck(event: string, payload: unknown): Promise<unknown> {
    this.emitted.push([event, payload]);
    const answer = this.acks[event];
    if (!answer) return Promise.reject(new Error('operation has timed out'));
    return Promise.resolve(answer(payload));
  }

  connect() {
    this.connects += 1;
    return this;
  }

  disconnect() {
    this.disconnects += 1;
    return this;
  }

  /** A frame from the server, to every listener of `event`. */
  receive(event: string, payload?: unknown) {
    for (const listener of [...(this.listeners.get(event) ?? [])])
      listener(payload);
  }

  /** The events the client emitted, by name. */
  sent(event: string) {
    return this.emitted
      .filter(([name]) => name === event)
      .map(([, payload]) => payload);
  }
}

const sockets: FakeSocket[] = [];

export function io(url: string, options: unknown): FakeSocket {
  const socket = new FakeSocket(url, options);
  sockets.push(socket);
  return socket;
}

/** The socket the last `io()` call made. */
export function lastSocket(): FakeSocket {
  const socket = sockets.at(-1);
  if (!socket) throw new Error('No socket was opened');
  return socket;
}
