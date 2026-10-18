'use client';

import { browserFetch } from '@synapsedesk/api-client';
import {
  CONNECTION_REFUSED_CODES,
  REALTIME_EVENTS,
  REALTIME_SOCKET,
} from '@synapsedesk/contracts';
import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { io, type Socket } from 'socket.io-client';
import { toast } from 'sonner';

type Realtime = { socket: Socket | null; ready: boolean };

const RealtimeContext = createContext<Realtime>({ socket: null, ready: false });

/** The tab's socket, and whether the server has said it may talk yet. */
export function useRealtime(): Realtime {
  return useContext(RealtimeContext);
}

/**
 * Subscribes to one server event while mounted.
 *
 * @example useRealtimeEvent(REALTIME_EVENTS.typing, (frame) => …);
 */
export function useRealtimeEvent<T>(
  event: string,
  handler: (frame: T) => void,
): void {
  const { socket } = useRealtime();
  useEffect(() => {
    if (!socket) return;
    socket.on(event, handler);
    return () => {
      socket.off(event, handler);
    };
  }, [socket, event, handler]);
}

const LOST_TOAST = 'realtime-lost';

const FIRST_RETRY_MS = 1_000;
const LAST_RETRY_MS = 30_000;

/**
 * How long to wait before reconnecting after the `attempt`th refusal in a row:
 * 1 s, doubling, up to 30 s, shortened by up to half at random so tabs
 * refused together don't come back together.
 *
 * @example reconnectDelay(2, () => 0) // 4000
 */
export function reconnectDelay(
  attempt: number,
  random: () => number = Math.random,
): number {
  const delay = Math.min(LAST_RETRY_MS, FIRST_RETRY_MS * 2 ** attempt);
  return delay - delay * 0.5 * random();
}

/**
 * One Socket.IO connection per tab: the gateway's namespace
 * (`REALTIME_SOCKET.namespace`) on this origin's `/socket.io` path (the
 * Ingress, or the dev server's proxy, sends it to the gateway), websocket
 * only, authenticated by the same `access_token` cookie as REST.
 *
 * - **Nothing is emitted before `connection:ready`.** The transport is up
 *   before the server has checked the cookie and joined the identity rooms.
 * - **A refusal says why** (`connection:refused`, then the disconnect).
 *   `UNAUTHENTICATED`: a call through the browser fetcher refreshes the
 *   cookies (or goes to sign-in), then the socket reconnects once. Anything
 *   else, or a second refusal in a row, waits {@link reconnectDelay} first;
 *   being ready again resets the wait.
 * - **Events update the query cache;** they aren't a second store. What the
 *   list needs is invalidated here; a ticket's page handles its own room.
 */
export function RealtimeProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  // Built once, unconnected: the effect connects it. None while rendering
  // on the server, which has no socket to open.
  const [socket] = useState(() =>
    typeof window === 'undefined'
      ? null
      : io(REALTIME_SOCKET.namespace, {
          path: '/socket.io',
          transports: ['websocket'],
          withCredentials: true,
          autoConnect: false,
        }),
  );
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!socket) return;
    let everReady = false;
    // The refusals since the socket was last ready: how long the next wait
    // is, and whether this run of them has already refreshed the session.
    let attempt = 0;
    let refreshed = false;
    let refusedFor: string | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const reconnectLater = () => {
      clearTimeout(retry);
      retry = setTimeout(() => socket.connect(), reconnectDelay(attempt));
      attempt += 1;
    };

    const reauthenticate = async () => {
      refreshed = true;
      try {
        // Refreshes on a 401; a refresh that fails navigates to sign-in.
        await browserFetch('/api/v1/users/me', { method: 'GET' });
        socket.connect();
      } catch {
        // Signed out, or offline.
        reconnectLater();
      }
    };

    const lists = () =>
      void queryClient.invalidateQueries({ queryKey: ['/api/v1/tickets'] });

    socket.on(REALTIME_EVENTS.connectionReady, () => {
      everReady = true;
      attempt = 0;
      refreshed = false;
      toast.dismiss(LOST_TOAST);
      setReady(true);
    });
    socket.on('disconnect', (reason) => {
      setReady(false);
      if (everReady) {
        toast.info('Live updates paused', {
          id: LOST_TOAST,
          description:
            'Reconnecting… New messages will appear when you’re back online.',
          duration: Infinity,
        });
      }
      // The server closed it, which socket.io never retries on its own.
      if (reason !== 'io server disconnect') return;
      const code = refusedFor;
      refusedFor = undefined;
      if (code === CONNECTION_REFUSED_CODES.unauthenticated && !refreshed) {
        void reauthenticate();
      } else {
        reconnectLater();
      }
    });
    socket.on(
      REALTIME_EVENTS.connectionRefused,
      (frame?: { data?: { code?: string } }) => {
        refusedFor = frame?.data?.code;
      },
    );
    // The transport failed: socket.io retries on its own backoff while it's
    // still active, and only an inactive socket needs this one.
    socket.on('connect_error', () => {
      if (!socket.active) reconnectLater();
    });

    socket.on(REALTIME_EVENTS.ticketCreated, lists);
    socket.on(REALTIME_EVENTS.ticketUpdated, lists);
    socket.on(REALTIME_EVENTS.ticketAssigned, lists);
    // A reply to the viewer's ticket arrives as a notification, which is
    // what moves its unread count.
    socket.on(REALTIME_EVENTS.notificationNew, lists);
    socket.on(REALTIME_EVENTS.notificationUpdated, lists);

    socket.connect();
    return () => {
      clearTimeout(retry);
      socket.removeAllListeners();
      socket.disconnect();
      toast.dismiss(LOST_TOAST);
    };
  }, [socket, queryClient]);

  const value = useMemo(() => ({ socket, ready }), [socket, ready]);
  return (
    <RealtimeContext.Provider value={value}>
      {children}
    </RealtimeContext.Provider>
  );
}
