'use client';

import {
  messagesControllerCreateV1,
  ticketsControllerMarkReadV1,
} from '@synapsedesk/api-client';
import {
  CLIENT_EVENTS,
  REALTIME_EVENTS,
  type TicketDomainEvent,
} from '@synapsedesk/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import {
  useRealtime,
  useRealtimeEvent,
} from '@/components/realtime/realtime-provider';
import type { LiveAnswer, Notice, PendingSend } from '@/lib/thread';
import { announce } from '@/lib/toast';

/** The gateway's own frames (typing, the answer stream, acks) come wrapped. */
type Frame<T> = { success: boolean; message: string; data: T | null };
type TypingData = {
  ticketId: string;
  userId: string;
  isTyping: boolean;
  ttlMs: number;
};
type ChunkData = { streamId: string; ticketId: string; token: string };
type DoneData = {
  streamId: string;
  ticketId: string;
  messageId: string | null;
  status: string;
};
type StreamIdData = { streamId: string; ticketId: string };
type SendAck = {
  messageId: string;
  streamId: string | null;
  skippedAttachments: string[];
};

const ACK_TIMEOUT_MS = 10_000;

/**
 * One ticket, live: its room joined while open, a reply that asks the AI sent
 * over the socket (so the answer streams back to it), and the thread
 * refetched when the room says something changed. What isn't stored (a reply still
 * sending, an answer still streaming, the AI-unavailable notice) lives here,
 * for this tab.
 */
export function useLiveTicket(
  ticketId: string,
  { invokeAi }: { invokeAi: boolean },
) {
  const { socket, ready } = useRealtime();
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<PendingSend[]>([]);
  const [answers, setAnswers] = useState<LiveAnswer[]>([]);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [typing, setTyping] = useState<Record<string, number>>({});

  const refetch = useCallback(
    (what: { messages?: boolean; ticket?: boolean }) => {
      if (what.messages) {
        void queryClient.invalidateQueries({
          queryKey: [`/api/v1/tickets/${ticketId}/messages`],
        });
      }
      if (what.ticket) {
        void queryClient.invalidateQueries({
          queryKey: [`/api/v1/tickets/${ticketId}`],
        });
        void queryClient.invalidateQueries({
          queryKey: [`/api/v1/tickets/${ticketId}/history`],
        });
      }
    },
    [queryClient, ticketId],
  );

  const markRead = useCallback(() => {
    void ticketsControllerMarkReadV1(ticketId, {})
      .then(() =>
        queryClient.invalidateQueries({ queryKey: ['/api/v1/tickets'] }),
      )
      .catch(() => undefined);
  }, [queryClient, ticketId]);

  useEffect(markRead, [markRead]);

  // The room, joined once the server says the socket may talk, and again
  // after every reconnect.
  useEffect(() => {
    if (!socket || !ready) return;
    socket.emit(CLIENT_EVENTS.ticketJoin, { ticketId });
    return () => {
      socket.emit(CLIENT_EVENTS.ticketLeave, { ticketId });
    };
  }, [socket, ready, ticketId]);

  const onMessage = useCallback(
    (event: TicketDomainEvent) => {
      if (event.ticketId !== ticketId) return;
      refetch({ messages: true });
      if (event.pattern === 'ticket.message_created') markRead();
    },
    [ticketId, refetch, markRead],
  );
  useRealtimeEvent(REALTIME_EVENTS.messageNew, onMessage);
  useRealtimeEvent(REALTIME_EVENTS.messageUpdated, onMessage);
  useRealtimeEvent(REALTIME_EVENTS.messageDeleted, onMessage);
  useRealtimeEvent(
    REALTIME_EVENTS.ticketUpdated,
    useCallback(
      (event: TicketDomainEvent) => {
        if (event.ticketId === ticketId) refetch({ ticket: true });
      },
      [ticketId, refetch],
    ),
  );

  useRealtimeEvent(
    REALTIME_EVENTS.typing,
    useCallback(
      (frame: Frame<TypingData>) => {
        const data = frame.data;
        if (!data || data.ticketId !== ticketId) return;
        setTyping((current) => {
          const next = { ...current };
          if (data.isTyping) next[data.userId] = Date.now() + data.ttlMs;
          else delete next[data.userId];
          return next;
        });
      },
      [ticketId],
    ),
  );
  // The client expires typing: a closed tab never sends `typing:stop`.
  useEffect(() => {
    const expiries = Object.values(typing);
    if (expiries.length === 0) return;
    const timer = globalThis.setTimeout(
      () =>
        setTyping((current) =>
          Object.fromEntries(
            Object.entries(current).filter(([, until]) => until > Date.now()),
          ),
        ),
      Math.max(0, Math.min(...expiries) - Date.now()) + 50,
    );
    return () => globalThis.clearTimeout(timer);
  }, [typing]);

  const upsertAnswer = useCallback(
    (streamId: string, change: (answer: LiveAnswer) => LiveAnswer) =>
      setAnswers((current) => {
        const found = current.find((answer) => answer.streamId === streamId);
        const base: LiveAnswer = found ?? {
          streamId,
          text: '',
          startedAt: new Date().toISOString(),
          state: 'streaming',
        };
        const next = change(base);
        return found
          ? current.map((answer) =>
              answer.streamId === streamId ? next : answer,
            )
          : [...current, next];
      }),
    [],
  );

  useRealtimeEvent(
    REALTIME_EVENTS.aiStreamChunk,
    useCallback(
      (frame: Frame<ChunkData>) => {
        const data = frame.data;
        if (!data || data.ticketId !== ticketId) return;
        upsertAnswer(data.streamId, (answer) =>
          answer.state === 'streaming'
            ? { ...answer, text: answer.text + data.token }
            : answer,
        );
      },
      [ticketId, upsertAnswer],
    ),
  );
  useRealtimeEvent(
    REALTIME_EVENTS.aiStreamDone,
    useCallback(
      (frame: Frame<DoneData>) => {
        const data = frame.data;
        if (!data || data.ticketId !== ticketId) return;
        upsertAnswer(data.streamId, (answer) => ({
          ...answer,
          state: 'done',
          messageId: data.messageId ?? undefined,
        }));
        if (data.status === 'AT_CAP') {
          // Nothing is stored; the ticket escalated itself, and the history
          // brings that notice.
          setNotices((current) => [
            ...current,
            {
              kind: 'ai-unavailable',
              at: new Date().toISOString(),
              id: data.streamId,
            },
          ]);
        } else {
          announce('The assistant answered.');
        }
        refetch({ messages: true, ticket: true });
      },
      [ticketId, upsertAnswer, refetch],
    ),
  );
  useRealtimeEvent(
    REALTIME_EVENTS.aiStreamError,
    useCallback(
      (frame: Frame<StreamIdData>) => {
        const data = frame.data;
        if (!data || data.ticketId !== ticketId) return;
        upsertAnswer(data.streamId, (answer) => ({
          ...answer,
          state: 'failed',
        }));
      },
      [ticketId, upsertAnswer],
    ),
  );

  const deliver = useCallback(
    async (send: PendingSend) => {
      const settle = (change: Partial<PendingSend>) =>
        setPending((current) =>
          current.map((item) =>
            item.clientMessageId === send.clientMessageId
              ? { ...item, ...change }
              : item,
          ),
        );
      const askAi = invokeAi && !send.isInternalNote;
      try {
        // Over the socket only when the reply asks for an answer: the stream
        // comes back on the socket that sent it. Everything else is REST,
        // which also lets any agent post (the socket admits only the author
        // and the current assignee).
        if (askAi && socket && ready) {
          const ack = (await socket
            .timeout(ACK_TIMEOUT_MS)
            .emitWithAck(CLIENT_EVENTS.messageSend, {
              ticketId,
              content: send.content,
              clientMessageId: send.clientMessageId,
              isInternalNote: send.isInternalNote,
              invokeAi: true,
            })) as Frame<SendAck>;
          if (!ack.success || !ack.data) throw new Error(ack.message);
          settle({ state: 'sending', messageId: ack.data.messageId });
          if (ack.data.streamId)
            upsertAnswer(ack.data.streamId, (answer) => answer);
        } else {
          const answer = await messagesControllerCreateV1(ticketId, {
            content: send.content,
            isInternalNote: send.isInternalNote,
            invokeAi: askAi,
          });
          settle({ state: 'sending', messageId: answer.data?.message.id });
        }
        refetch({ messages: true });
      } catch {
        settle({ state: 'failed' });
        announce('Your reply wasn’t sent.', 'assertive');
      }
    },
    [socket, ready, ticketId, invokeAi, upsertAnswer, refetch],
  );

  const send = useCallback(
    (content: string, isInternalNote: boolean) => {
      const item: PendingSend = {
        clientMessageId: crypto.randomUUID(),
        content,
        isInternalNote,
        createdAt: new Date().toISOString(),
        state: 'sending',
      };
      setPending((current) => [...current, item]);
      void deliver(item);
    },
    [deliver],
  );

  /** Sends a failed reply again, with its id, so the server can't keep two. */
  const retry = useCallback(
    (clientMessageId: string) => {
      const item = pending.find(
        (send) => send.clientMessageId === clientMessageId,
      );
      if (!item) return;
      setPending((current) =>
        current.map((send) =>
          send.clientMessageId === clientMessageId
            ? { ...send, state: 'sending' }
            : send,
        ),
      );
      void deliver({ ...item, state: 'sending' });
    },
    [pending, deliver],
  );

  const stop = useCallback(
    (streamId: string) => {
      if (!socket) return;
      void socket
        .timeout(ACK_TIMEOUT_MS)
        .emitWithAck(CLIENT_EVENTS.aiStreamCancel, { streamId })
        .then((ack: Frame<{ cancelled: boolean }>) => {
          if (ack.data?.cancelled) {
            upsertAnswer(streamId, (answer) => ({
              ...answer,
              state: 'stopped',
            }));
          }
        })
        .catch(() => undefined);
    },
    [socket, upsertAnswer],
  );

  const signalTyping = useCallback(
    (isTyping: boolean) => {
      if (!socket || !ready) return;
      socket.emit(
        isTyping ? CLIENT_EVENTS.typingStart : CLIENT_EVENTS.typingStop,
        { ticketId },
      );
    },
    [socket, ready, ticketId],
  );

  return {
    pending,
    answers,
    notices,
    typingUserIds: Object.keys(typing),
    send,
    retry,
    stop,
    signalTyping,
    refetch,
  };
}
