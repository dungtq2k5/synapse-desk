import { REALTIME_EVENTS, REALTIME_SOCKET } from '@synapsedesk/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { fail, ok, stubApi } from '@/test/api';
import { lastSocket } from '@/test/socket';
import {
  RealtimeProvider,
  useRealtime,
  useRealtimeEvent,
} from './realtime-provider';

jest.mock('socket.io-client', () => jest.requireActual('@/test/socket'));

function Status() {
  const { ready } = useRealtime();
  return <p>{ready ? 'Live' : 'Offline'}</p>;
}

function Listener({ onTyping }: { onTyping: (frame: unknown) => void }) {
  useRealtimeEvent(REALTIME_EVENTS.typing, onTyping);
  return null;
}

const setup = (children: React.ReactNode = <Status />) => {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
  const tree = (inner: React.ReactNode) => (
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider>{inner}</RealtimeProvider>
    </QueryClientProvider>
  );
  const view = render(tree(children));
  return {
    unmount: view.unmount,
    rerender: (inner: React.ReactNode) => view.rerender(tree(inner)),
    socket: lastSocket(),
    invalidate,
  };
};

describe('the realtime provider', () => {
  beforeEach(() => {
    jest.spyOn(toast, 'info').mockImplementation(() => 'id');
    jest.spyOn(toast, 'dismiss').mockImplementation(() => 'id');
  });
  afterEach(() => jest.restoreAllMocks());

  it('opens one websocket on the gateway namespace, cookie-authenticated', () => {
    const { socket } = setup();

    expect(socket.url).toBe(REALTIME_SOCKET.namespace);
    expect(socket.options).toEqual({
      path: '/socket.io',
      transports: ['websocket'],
      withCredentials: true,
      autoConnect: false,
    });
    expect(socket.connects).toBe(1);
  });

  it('is ready only once the server says so, and pauses on a disconnect', () => {
    const { socket } = setup();
    expect(screen.getByText('Offline')).toBeInTheDocument();

    act(() => socket.receive(REALTIME_EVENTS.connectionReady));
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(toast.dismiss).toHaveBeenCalledWith('realtime-lost');

    act(() => socket.receive('disconnect', 'transport close'));
    expect(screen.getByText('Offline')).toBeInTheDocument();
    expect(toast.info).toHaveBeenCalledWith(
      'Live updates paused',
      expect.objectContaining({ id: 'realtime-lost' }),
    );
  });

  it('says nothing about a pause when it was never live', () => {
    const { socket } = setup();

    act(() => socket.receive('disconnect', 'transport close'));
    expect(toast.info).not.toHaveBeenCalled();
  });

  it('refreshes the session and reconnects when the server closes the socket', async () => {
    const calls = stubApi({ 'GET /api/v1/users/me': ok({}) });
    const { socket } = setup();

    act(() => socket.receive('disconnect', 'io server disconnect'));
    await waitFor(() => expect(socket.connects).toBe(2));
    expect(calls.map((call) => call.url)).toEqual(['/api/v1/users/me']);
  });

  it('refreshes once for a burst of refused handshakes', async () => {
    const calls = stubApi({ 'GET /api/v1/users/me': ok({}) });
    const { socket } = setup();

    act(() => {
      socket.receive('connect_error');
      socket.receive('connect_error');
    });
    await waitFor(() => expect(socket.connects).toBe(2));
    expect(calls).toHaveLength(1);
  });

  it('leaves reconnecting to socket.io when the refresh fails', async () => {
    const calls = stubApi({ 'GET /api/v1/users/me': fail(500, 'Down') });
    const { socket } = setup();

    act(() => socket.receive('connect_error'));
    await waitFor(() => expect(calls).toHaveLength(1));
    // Let the failed refresh settle before checking nothing reconnected.
    await act(() => Promise.resolve());
    expect(socket.connects).toBe(1);
  });

  it.each([
    REALTIME_EVENTS.ticketCreated,
    REALTIME_EVENTS.ticketUpdated,
    REALTIME_EVENTS.ticketAssigned,
    REALTIME_EVENTS.notificationNew,
    REALTIME_EVENTS.notificationUpdated,
  ])('refreshes the ticket lists on %s', (event) => {
    const { socket, invalidate } = setup();

    act(() => socket.receive(event, {}));
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['/api/v1/tickets'] });
  });

  it('hands an event to its subscriber while it is mounted, and not after', () => {
    const onTyping = jest.fn();
    const { socket, rerender } = setup(<Listener onTyping={onTyping} />);

    act(() => socket.receive(REALTIME_EVENTS.typing, { data: 1 }));
    expect(onTyping).toHaveBeenCalledWith({ data: 1 });

    rerender(null);
    onTyping.mockClear();
    act(() => socket.receive(REALTIME_EVENTS.typing, { data: 2 }));
    expect(onTyping).not.toHaveBeenCalled();
  });

  it('closes the socket and drops its listeners on unmount', () => {
    const { socket, unmount } = setup();

    unmount();
    expect(socket.disconnects).toBe(1);
    expect(socket.listeners.size).toBe(0);
  });

  it('gives no socket outside the provider', () => {
    function Bare() {
      const { socket, ready } = useRealtime();
      return <p>{socket === null && !ready ? 'No socket' : 'Socket'}</p>;
    }
    render(<Bare />);
    expect(screen.getByText('No socket')).toBeInTheDocument();
  });
});
