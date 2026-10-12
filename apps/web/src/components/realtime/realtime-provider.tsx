'use client';

import { browserFetch } from '@synapsedesk/api-client';
import { REALTIME_EVENTS } from '@synapsedesk/contracts';
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

/**
 * One Socket.IO connection per tab: namespace `/ws`, on this origin's
 * `/socket.io` path (the Ingress, or the dev server's proxy, sends it to the
 * gateway), websocket only, authenticated by the same `access_token` cookie
 * as REST.
 *
 * - **Nothing is emitted before `connection:ready`.** The transport is up
 *   before the server has checked the cookie and joined the identity rooms.
 * - **A refused handshake is a 401:** a call through the browser fetcher
 *   refreshes the cookies (or goes to sign-in), then the socket reconnects.
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
      : // The gateway's one namespace (`RealtimeServerConfig`): the root
        // namespace answers "Invalid namespace" and never says it's ready.
        io('/ws', {
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
    let refreshing = false;

    const reauthenticate = async () => {
      if (refreshing) return;
      refreshing = true;
      try {
        // Refreshes on a 401; a refresh that fails navigates to sign-in.
        await browserFetch('/api/v1/users/me', { method: 'GET' });
        socket.connect();
      } catch {
        // Signed out, or offline: socket.io's own retry takes it from here.
      } finally {
        refreshing = false;
      }
    };

    const lists = () =>
      void queryClient.invalidateQueries({ queryKey: ['/api/v1/tickets'] });

    socket.on(REALTIME_EVENTS.connectionReady, () => {
      everReady = true;
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
      // The server closed it: the cookie was refused or has expired.
      if (reason === 'io server disconnect') void reauthenticate();
    });
    socket.on('connect_error', () => void reauthenticate());

    socket.on(REALTIME_EVENTS.ticketCreated, lists);
    socket.on(REALTIME_EVENTS.ticketUpdated, lists);
    socket.on(REALTIME_EVENTS.ticketAssigned, lists);
    // A reply to the viewer's ticket arrives as a notification, which is
    // what moves its unread count.
    socket.on(REALTIME_EVENTS.notificationNew, lists);
    socket.on(REALTIME_EVENTS.notificationUpdated, lists);

    socket.connect();
    return () => {
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
