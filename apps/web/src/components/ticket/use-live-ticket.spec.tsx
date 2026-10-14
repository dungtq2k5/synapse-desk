import { CLIENT_EVENTS, REALTIME_EVENTS } from '@synapsedesk/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import { RealtimeProvider } from '@/components/realtime/realtime-provider';
import { fail, ok, stubApi } from '@/test/api';
import { lastSocket } from '@/test/socket';
import { useLiveTicket } from './use-live-ticket';

jest.mock('socket.io-client', () => jest.requireActual('@/test/socket'));

const frame = (data: unknown) => ({ success: true, message: 'OK', data });

const stored = (id: string) => ({
  message: { id, ticketId: 't1', content: 'Hi' },
  skippedAttachments: [],
});

function setup({
  invokeAi = false,
  ready = true,
  routes = {},
}: {
  invokeAi?: boolean;
  ready?: boolean;
  routes?: Parameters<typeof stubApi>[0];
} = {}) {
  const calls = stubApi({
    'POST /api/v1/tickets/t1/read': ok(null),
    'POST /api/v1/tickets/t1/messages': ok(stored('m1'), 201),
    ...routes,
  });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = jest.spyOn(queryClient, 'invalidateQueries');
  const hook = renderHook(() => useLiveTicket('t1', { invokeAi }), {
    wrapper: ({ children }) => (
      <QueryClientProvider client={queryClient}>
        <RealtimeProvider>{children}</RealtimeProvider>
      </QueryClientProvider>
    ),
  });
  const socket = lastSocket();
  if (ready) act(() => socket.receive(REALTIME_EVENTS.connectionReady));
  // This ticket's own queries; the provider refreshes the lists by itself.
  const keys = () =>
    invalidate.mock.calls
      .map(([filters]) => String(filters?.queryKey?.[0]))
      .filter((key) => key.startsWith('/api/v1/tickets/t1'));
  return { ...hook, socket, calls, invalidate, keys };
}

describe('a live ticket', () => {
  it('marks the ticket read and refreshes the lists when it opens', async () => {
    const { calls, invalidate } = setup();

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ['/api/v1/tickets'],
      }),
    );
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: '/api/v1/tickets/t1/read',
    });
  });

  it('joins the ticket room once ready, and leaves it on unmount', () => {
    const { socket, unmount } = setup({ ready: false });
    expect(socket.sent(CLIENT_EVENTS.ticketJoin)).toEqual([]);

    act(() => socket.receive(REALTIME_EVENTS.connectionReady));
    expect(socket.sent(CLIENT_EVENTS.ticketJoin)).toEqual([{ ticketId: 't1' }]);

    unmount();
    expect(socket.sent(CLIENT_EVENTS.ticketLeave)).toEqual([
      { ticketId: 't1' },
    ]);
  });

  it.each([
    REALTIME_EVENTS.messageNew,
    REALTIME_EVENTS.messageUpdated,
    REALTIME_EVENTS.messageDeleted,
  ])('refetches the thread on %s for this ticket only', (event) => {
    const { socket, keys, invalidate } = setup();
    invalidate.mockClear();

    act(() => socket.receive(event, { ticketId: 'other' }));
    expect(keys()).toEqual([]);

    act(() => socket.receive(event, { ticketId: 't1', pattern: 'x' }));
    expect(keys()).toEqual(['/api/v1/tickets/t1/messages']);
  });

  it('marks a new message read as it arrives', async () => {
    const { socket, calls } = setup();
    await waitFor(() => expect(calls).toHaveLength(1));

    act(() =>
      socket.receive(REALTIME_EVENTS.messageNew, {
        ticketId: 't1',
        pattern: 'ticket.message_created',
      }),
    );
    await waitFor(() => expect(calls).toHaveLength(2));
    expect(calls[1].url).toBe('/api/v1/tickets/t1/read');
  });

  it('refetches the ticket and its history when the ticket changes', () => {
    const { socket, keys, invalidate } = setup();
    invalidate.mockClear();

    act(() => socket.receive(REALTIME_EVENTS.ticketUpdated, { ticketId: 'x' }));
    expect(keys()).toEqual([]);

    act(() =>
      socket.receive(REALTIME_EVENTS.ticketUpdated, { ticketId: 't1' }),
    );
    expect(keys()).toEqual([
      '/api/v1/tickets/t1',
      '/api/v1/tickets/t1/history',
    ]);
  });

  it('shows who is typing, until they stop or their signal expires', () => {
    jest.useFakeTimers();
    try {
      const { socket, result } = setup();
      const typing = (userId: string, isTyping: boolean, ticketId = 't1') =>
        act(() =>
          socket.receive(
            REALTIME_EVENTS.typing,
            frame({ ticketId, userId, isTyping, ttlMs: 5000 }),
          ),
        );

      typing('ana', true, 'other');
      act(() => socket.receive(REALTIME_EVENTS.typing, frame(null)));
      expect(result.current.typingUserIds).toEqual([]);

      typing('ana', true);
      typing('ben', true);
      expect(result.current.typingUserIds).toEqual(['ana', 'ben']);

      typing('ben', false);
      expect(result.current.typingUserIds).toEqual(['ana']);

      act(() => jest.advanceTimersByTime(5100));
      expect(result.current.typingUserIds).toEqual([]);
    } finally {
      jest.useRealTimers();
    }
  });

  it('says "typing" once the room is joined, when the person typed before it was', () => {
    const { socket, result } = setup({ ready: false });

    // A keystroke while the socket is still connecting: nothing can be sent.
    act(() => result.current.signalTyping(true));
    expect(socket.sent(CLIENT_EVENTS.typingStart)).toEqual([]);

    act(() => socket.receive(REALTIME_EVENTS.connectionReady));
    act(() =>
      socket.receive(
        REALTIME_EVENTS.ticketJoined,
        frame({ ticketId: 'other' }),
      ),
    );
    expect(socket.sent(CLIENT_EVENTS.typingStart)).toEqual([]);

    act(() =>
      socket.receive(REALTIME_EVENTS.ticketJoined, frame({ ticketId: 't1' })),
    );
    expect(socket.sent(CLIENT_EVENTS.typingStart)).toEqual([
      { ticketId: 't1' },
    ]);
  });

  it('says nothing on joining when the person has stopped typing', () => {
    const { socket, result } = setup({ ready: false });

    act(() => result.current.signalTyping(true));
    act(() => result.current.signalTyping(false));
    act(() => socket.receive(REALTIME_EVENTS.connectionReady));
    act(() =>
      socket.receive(REALTIME_EVENTS.ticketJoined, frame({ ticketId: 't1' })),
    );

    expect(socket.sent(CLIENT_EVENTS.typingStart)).toEqual([]);
  });

  it('lists the agents viewing this ticket', () => {
    const { socket, result } = setup();
    const viewers = [{ id: 'ana', fullName: 'Ana Ruiz' }];

    act(() =>
      socket.receive(
        REALTIME_EVENTS.ticketViewers,
        frame({ ticketId: 'other', viewers }),
      ),
    );
    expect(result.current.viewers).toEqual([]);

    act(() =>
      socket.receive(
        REALTIME_EVENTS.ticketViewers,
        frame({ ticketId: 't1', viewers }),
      ),
    );
    expect(result.current.viewers).toEqual(viewers);
  });

  it('signals typing over the socket once ready', () => {
    const { socket, result } = setup();

    act(() => result.current.signalTyping(true));
    act(() => result.current.signalTyping(false));
    expect(socket.sent(CLIENT_EVENTS.typingStart)).toEqual([
      { ticketId: 't1' },
    ]);
    expect(socket.sent(CLIENT_EVENTS.typingStop)).toEqual([{ ticketId: 't1' }]);
  });

  it('sends no typing signal before the socket is ready', () => {
    const { socket, result } = setup({ ready: false });

    act(() => result.current.signalTyping(true));
    expect(socket.sent(CLIENT_EVENTS.typingStart)).toEqual([]);
  });

  it('sends a reply over REST when it does not ask the AI', async () => {
    const { calls, result } = setup();

    act(() => result.current.send('Hello', false));
    expect(result.current.pending).toMatchObject([
      { content: 'Hello', state: 'sending' },
    ]);
    await waitFor(() => expect(result.current.pending[0].messageId).toBe('m1'));
    expect(calls.at(-1)).toMatchObject({
      method: 'POST',
      url: '/api/v1/tickets/t1/messages',
      body: { content: 'Hello', isInternalNote: false, invokeAi: false },
    });
  });

  it('marks a reply that failed, and retries it with the same id', async () => {
    let attempts = 0;
    const { result } = setup({
      routes: {
        'POST /api/v1/tickets/t1/messages': () =>
          attempts++ === 0 ? fail(500, 'Down') : ok(stored('m2'), 201),
      },
    });

    act(() => result.current.send('Hello', false));
    await waitFor(() => expect(result.current.pending[0].state).toBe('failed'));
    const id = result.current.pending[0].clientMessageId;

    act(() => result.current.retry('nope'));
    act(() => result.current.retry(id));
    expect(result.current.pending[0].state).toBe('sending');
    await waitFor(() => expect(result.current.pending[0].messageId).toBe('m2'));
    expect(result.current.pending[0].clientMessageId).toBe(id);
  });

  it('asks the AI over the socket and streams its answer back', async () => {
    const { socket, result } = setup({ invokeAi: true });
    socket.acks[CLIENT_EVENTS.messageSend] = () =>
      frame({ messageId: 'm1', streamId: 's1', skippedAttachments: [] });

    act(() => result.current.send('Where is my refund?', false));
    await waitFor(() => expect(result.current.pending[0].messageId).toBe('m1'));
    expect(socket.sent(CLIENT_EVENTS.messageSend)[0]).toMatchObject({
      ticketId: 't1',
      content: 'Where is my refund?',
      invokeAi: true,
    });
    expect(result.current.answers).toMatchObject([
      { streamId: 's1', text: '', state: 'streaming' },
    ]);

    const chunk = (token: string, ticketId = 't1') =>
      act(() =>
        socket.receive(
          REALTIME_EVENTS.aiStreamChunk,
          frame({ streamId: 's1', ticketId, token }),
        ),
      );
    chunk('Refunds ');
    chunk('ignored', 'other');
    chunk('take 5 days.');
    expect(result.current.answers[0].text).toBe('Refunds take 5 days.');

    act(() =>
      socket.receive(
        REALTIME_EVENTS.aiStreamDone,
        frame({
          streamId: 's1',
          ticketId: 't1',
          messageId: 'm9',
          status: 'DOC_ANSWER',
        }),
      ),
    );
    expect(result.current.answers[0]).toMatchObject({
      state: 'done',
      messageId: 'm9',
    });

    // A late token never changes a finished answer.
    chunk(' more');
    expect(result.current.answers[0].text).toBe('Refunds take 5 days.');
    expect(result.current.notices).toEqual([]);
  });

  it('says the assistant is unavailable when the AI limit is reached', () => {
    const { socket, result } = setup({ invokeAi: true });

    act(() =>
      socket.receive(
        REALTIME_EVENTS.aiStreamDone,
        frame({
          streamId: 's1',
          ticketId: 't1',
          messageId: null,
          status: 'AT_CAP',
        }),
      ),
    );
    expect(result.current.notices).toMatchObject([
      { kind: 'ai-unavailable', id: 's1' },
    ]);
    expect(result.current.answers[0].messageId).toBeUndefined();
  });

  it('ignores stream frames for another ticket or without data', () => {
    const { socket, result } = setup({ invokeAi: true });

    for (const event of [
      REALTIME_EVENTS.aiStreamChunk,
      REALTIME_EVENTS.aiStreamDone,
      REALTIME_EVENTS.aiStreamError,
    ]) {
      act(() => socket.receive(event, frame(null)));
      act(() =>
        socket.receive(event, frame({ streamId: 's1', ticketId: 'other' })),
      );
    }
    expect(result.current.answers).toEqual([]);
    expect(result.current.notices).toEqual([]);
  });

  it('marks an answer that broke off as failed', () => {
    const { socket, result } = setup({ invokeAi: true });

    act(() =>
      socket.receive(
        REALTIME_EVENTS.aiStreamError,
        frame({ streamId: 's1', ticketId: 't1' }),
      ),
    );
    expect(result.current.answers).toMatchObject([
      { streamId: 's1', state: 'failed' },
    ]);
  });

  it('marks the reply failed when the socket refuses it', async () => {
    const { socket, result } = setup({ invokeAi: true });
    socket.acks[CLIENT_EVENTS.messageSend] = () => ({
      success: false,
      message: 'Not allowed',
      data: null,
    });

    act(() => result.current.send('Hi', false));
    await waitFor(() => expect(result.current.pending[0].state).toBe('failed'));
  });

  it('sends an internal note over REST without asking the AI', async () => {
    const { socket, calls, result } = setup({ invokeAi: true });

    act(() => result.current.send('Check Finance', true));
    await waitFor(() => expect(result.current.pending[0].messageId).toBe('m1'));
    expect(socket.sent(CLIENT_EVENTS.messageSend)).toEqual([]);
    expect(calls.at(-1)?.body).toMatchObject({
      isInternalNote: true,
      invokeAi: false,
    });
  });

  it('accepts a sent reply that started no answer', async () => {
    const { socket, result } = setup({ invokeAi: true });
    socket.acks[CLIENT_EVENTS.messageSend] = () =>
      frame({ messageId: 'm1', streamId: null, skippedAttachments: [] });

    act(() => result.current.send('Hi', false));
    await waitFor(() => expect(result.current.pending[0].messageId).toBe('m1'));
    expect(result.current.answers).toEqual([]);
  });

  it('stops a streaming answer when the server confirms it', async () => {
    const { socket, result } = setup({ invokeAi: true });
    socket.acks[CLIENT_EVENTS.aiStreamCancel] = () =>
      frame({ cancelled: true });

    act(() => result.current.stop('s1'));
    await waitFor(() =>
      expect(result.current.answers).toMatchObject([
        { streamId: 's1', state: 'stopped' },
      ]),
    );
    expect(socket.sent(CLIENT_EVENTS.aiStreamCancel)).toEqual([
      { streamId: 's1' },
    ]);
  });

  it('leaves the answer as it is when the stop is refused or times out', async () => {
    const { socket, result } = setup({ invokeAi: true });
    socket.acks[CLIENT_EVENTS.aiStreamCancel] = () =>
      frame({ cancelled: false });

    const stop = () => {
      result.current.stop('s1');
      return Promise.resolve();
    };
    await act(stop);
    delete socket.acks[CLIENT_EVENTS.aiStreamCancel];
    await act(stop);
    expect(result.current.answers).toEqual([]);
  });
});
