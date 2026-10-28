import type {
  MessageResponseDto,
  TicketResponseDto,
} from '@synapsedesk/api-client';
import { CLIENT_EVENTS, REALTIME_EVENTS } from '@synapsedesk/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import { RealtimeProvider } from '@/components/realtime/realtime-provider';
import { TooltipProvider } from '@/components/ui/tooltip';
import { fail, ok, stubApi } from '@/test/api';
import { lastSocket } from '@/test/socket';
import { TicketView } from './ticket-view';

jest.mock('socket.io-client', () => jest.requireActual('@/test/socket'));
const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
// The header needs the sidebar's provider; its crumbs are all this page sets.
jest.mock('@/components/shell/app-header', () => ({
  useTicketsCrumb: () => ({ label: 'Tickets', href: '/tickets' }),
  AppHeader: ({ crumbs }: { crumbs: { label: string }[] }) => (
    <nav aria-label="Breadcrumb">
      {crumbs.map((crumb) => crumb.label).join(' / ')}
    </nav>
  ),
}));

const PRIYA = { id: 'priya', fullName: 'Priya Shah', avatarUrl: null };
const ANA = { id: 'ana', fullName: 'Ana Ruiz', avatarUrl: null };
const AT = '2026-10-10T09:00:00Z';

const ticketOf = (
  over: Partial<TicketResponseDto> = {},
): TicketResponseDto => ({
  id: 't1',
  ticketNumber: 1042,
  organizationId: 'o1',
  authorId: PRIYA.id,
  author: PRIYA,
  source: 'WEB',
  status: 'OPEN',
  priority: 'MEDIUM',
  title: 'Refund not received',
  description: 'I was charged twice.',
  currentAssigneeId: null,
  assignee: null,
  currentDepartmentId: null,
  department: null,
  escalatedAt: null,
  resolvedAt: null,
  unreadCount: 0,
  createdAt: AT,
  updatedAt: AT,
  deletedAt: null,
  deletedById: null,
  attachments: [],
  openingFilesDeletableUntil: null,
  ...over,
});

let at = 1;
const messageOf = (over: Partial<MessageResponseDto>): MessageResponseDto => ({
  id: `m${at}`,
  ticketId: 't1',
  senderId: ANA.id,
  sender: ANA,
  content: 'Hello',
  isAiGenerated: false,
  isInternalNote: false,
  modelName: null,
  promptTokens: null,
  completionTokens: null,
  editedAt: null,
  redactedAt: null,
  // Each one a minute after the last, so the thread keeps this order.
  createdAt: new Date(Date.parse(AT) + 60_000 * at++).toISOString(),
  attachments: [],
  excludedFromAiContext: false,
  answerStatus: null,
  citations: null,
  editableUntil: null,
  ...over,
});

const page = (items: MessageResponseDto[]) =>
  ok({ items: [...items].reverse(), total: items.length, page: 1, limit: 100 });

type Setup = {
  viewer?: typeof PRIYA;
  agent?: boolean;
  /** The viewer's permissions; an agent without them holds `ticket.read.all`. */
  codes?: string[];
  ticket?: TicketResponseDto;
  messages?: MessageResponseDto[];
  routes?: Parameters<typeof stubApi>[0];
};

function setup({
  viewer = PRIYA,
  agent = false,
  codes = agent ? ['ticket.read.all'] : [],
  ticket = ticketOf(),
  messages = [],
  routes = {},
}: Setup = {}) {
  const state = { ticket: ok(ticket), messages };
  const calls = stubApi({
    'GET /api/v1/users/me': ok({
      user: viewer,
      permissionCodes: codes,
      departmentIds: [],
    }),
    'GET /api/v1/tickets/t1': () => state.ticket,
    'GET /api/v1/tickets/t1/messages': () => page(state.messages),
    'GET /api/v1/tickets/t1/history': ok([]),
    'POST /api/v1/tickets/t1/read': ok(null),
    ...routes,
  });
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RealtimeProvider>
        <TooltipProvider>
          <TicketView ticketId="t1" />
        </TooltipProvider>
      </RealtimeProvider>
    </QueryClientProvider>,
  );
  const socket = lastSocket();
  act(() => socket.receive(REALTIME_EVENTS.connectionReady));
  return { socket, calls, state, user: userEvent.setup() };
}

let queryClient: QueryClient;

/** The ticket on screen, and the viewer known (who may write depends on it). */
const loaded = async () => {
  await screen.findByRole('heading', { level: 1, name: 'Refund not received' });
  await waitFor(() =>
    expect(queryClient.getQueryState(['/api/v1/users/me'])?.status).toBe(
      'success',
    ),
  );
};
const frame = (data: unknown) => ({ success: true, message: 'OK', data });

beforeAll(() => {
  // jsdom lays nothing out, so it has no scrolling.
  Element.prototype.scrollIntoView = jest.fn();
});
afterEach(() => jest.restoreAllMocks());

describe('the ticket page', () => {
  it('shows a placeholder while the ticket loads, then the ticket', async () => {
    setup();

    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading conversation',
    );
    expect(screen.getByRole('navigation')).toHaveTextContent('Tickets / …');
    await loaded();
    expect(screen.getByRole('navigation')).toHaveTextContent('Tickets / #1042');
    expect(screen.getByText('I was charged twice.')).toBeInTheDocument();
  });

  it.each([404, 403, 400])(
    'says the ticket cannot be found on a %s',
    async (status) => {
      setup({ routes: { 'GET /api/v1/tickets/t1': fail(status, 'Nope') } });

      expect(
        await screen.findByRole('heading', {
          name: 'We can’t find that ticket',
        }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'Back to tickets' }),
      ).toHaveAttribute('href', '/tickets');
    },
  );

  describe('who may write', () => {
    it('gives the requester a composer', async () => {
      setup();
      await loaded();

      expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    });

    it('gives the current assignee a composer with internal notes', async () => {
      setup({
        viewer: ANA,
        agent: true,
        ticket: ticketOf({ currentAssigneeId: ANA.id, assignee: ANA }),
      });
      await loaded();

      expect(
        screen.getByRole('radio', { name: 'Internal note' }),
      ).toBeInTheDocument();
    });

    it('tells any other agent that only the assignee can reply', async () => {
      setup({
        viewer: ANA,
        agent: true,
        ticket: ticketOf({ currentAssigneeId: 'ben' }),
      });
      await loaded();

      expect(
        screen.getByText('Only the assignee can reply or add notes.'),
      ).toBeInTheDocument();
      expect(screen.queryByRole('textbox')).toBeNull();
    });

    it('offers no composer on a closed ticket, even to its author', async () => {
      setup({ ticket: ticketOf({ status: 'CLOSED' }) });
      await loaded();

      expect(screen.getByText('This ticket is closed.')).toBeInTheDocument();
      expect(screen.queryByRole('textbox')).toBeNull();
    });
  });

  describe('presence', () => {
    it('names the other agents viewing the ticket, never the viewer', async () => {
      const { socket } = setup({ viewer: ANA, agent: true });
      await loaded();

      const viewers = (list: { id: string; fullName: string | null }[]) =>
        act(() =>
          socket.receive(
            REALTIME_EVENTS.ticketViewers,
            frame({ ticketId: 't1', viewers: list }),
          ),
        );

      viewers([ANA, { id: 'ben', fullName: 'Ben Okafor' }]);
      expect(
        screen.getByText('Ben Okafor is also viewing'),
      ).toBeInTheDocument();

      viewers([
        ANA,
        { id: 'ben', fullName: 'Ben Okafor' },
        { id: 'x', fullName: null },
      ]);
      expect(
        screen.getByText('Ben Okafor, Someone are also viewing'),
      ).toBeInTheDocument();

      viewers([ANA]);
      expect(screen.queryByText(/also viewing/)).toBeNull();
    });

    it('says who is typing, by the name the thread knows', async () => {
      const { socket } = setup({
        viewer: ANA,
        agent: true,
        ticket: ticketOf({ currentAssigneeId: ANA.id, assignee: ANA }),
        messages: [
          messageOf({
            senderId: 'ben',
            sender: { id: 'ben', fullName: 'Ben Okafor', avatarUrl: null },
          }),
        ],
      });
      await loaded();
      const typing = (userId: string) =>
        act(() =>
          socket.receive(
            REALTIME_EVENTS.typing,
            frame({ ticketId: 't1', userId, isTyping: true, ttlMs: 5000 }),
          ),
        );

      typing(ANA.id);
      expect(screen.queryByText(/typing…/)).toBeNull();
      typing(PRIYA.id);
      expect(screen.getByText('Priya Shah is typing…')).toBeInTheDocument();
      typing('ben');
      typing('stranger');
      expect(
        screen.getByText('Priya Shah, Ben Okafor, Someone are typing…'),
      ).toBeInTheDocument();
    });
  });

  describe('the thread', () => {
    it('a new conversation: the first answer is being written, until it lands', async () => {
      const { state, socket } = setup({
        ticket: ticketOf({
          source: 'CHAT',
          createdAt: new Date().toISOString(),
        }),
      });
      await loaded();
      const log = await screen.findByRole('log');
      expect(
        await within(log).findByText('Writing an answer…'),
      ).toBeInTheDocument();

      state.messages = [
        messageOf({
          isAiGenerated: true,
          senderId: null,
          sender: null,
          content: 'It resets in January.',
          answerStatus: 'DOC_ANSWER',
        }),
      ];
      act(() =>
        socket.receive(REALTIME_EVENTS.messageNew, {
          ticketId: 't1',
          pattern: 'ticket.message_created',
        }),
      );
      expect(
        await within(log).findByText('It resets in January.'),
      ).toBeInTheDocument();
      expect(within(log).queryByText('Writing an answer…')).toBeNull();
    });

    it('once the wait is over with no answer, it says the answer stopped and offers a person', async () => {
      // Created long ago: the 90-second wait is already over.
      setup({ ticket: ticketOf({ source: 'CHAT' }) });
      await loaded();
      const log = await screen.findByRole('log');
      expect(
        await within(log).findByText(
          'The answer stopped before it finished. Ask again, or ask a person to take over.',
        ),
      ).toBeInTheDocument();
      expect(within(log).queryByText('Writing an answer…')).toBeNull();
      expect(
        within(log).getByRole('button', { name: 'Ask a person' }),
      ).toBeInTheDocument();
    });

    it('shows replies, notes, removed messages and attachments', async () => {
      setup({
        viewer: ANA,
        agent: true,
        ticket: ticketOf({ currentAssigneeId: ANA.id, assignee: ANA }),
        messages: [
          messageOf({
            senderId: PRIYA.id,
            sender: PRIYA,
            content: 'Any news?',
          }),
          messageOf({
            content: 'Here is the receipt.',
            editedAt: AT,
            attachments: [
              {
                id: 'a1',
                fileName: 'receipt.pdf',
                fileUrl: 'https://files.test/receipt.pdf',
                fileSizeBytes: 2048,
              } as MessageResponseDto['attachments'][number],
            ],
          }),
          messageOf({ isInternalNote: true, content: 'Check with Finance.' }),
          messageOf({ senderId: 'gone', sender: null, redactedAt: AT }),
        ],
        routes: {
          'GET /api/v1/attachments/a1/download': ok({
            downloadUrl: 'https://files.test/signed/receipt.pdf',
            expiresAt: AT,
          }),
        },
      });
      await loaded();
      const log = await screen.findByRole('log', { name: 'Conversation' });

      expect(within(log).getByText('Any news?')).toBeInTheDocument();
      // A file opens through a fresh download link, never its stored path.
      const tab = { opener: {}, location: { href: '' }, close: jest.fn() };
      const open = jest
        .spyOn(window, 'open')
        .mockReturnValue(tab as unknown as Window);
      await userEvent.click(
        within(log).getByRole('button', { name: /^receipt\.pdf/ }),
      );
      await waitFor(() =>
        expect(tab.location.href).toBe('https://files.test/signed/receipt.pdf'),
      );
      expect(tab.opener).toBeNull();
      open.mockRestore();
      expect(within(log).getByText('Edited')).toBeInTheDocument();
      expect(
        within(log).getByText('INTERNAL NOTE · Only agents can see this'),
      ).toBeInTheDocument();
      expect(
        within(log).getByText('This message was removed.'),
      ).toBeInTheDocument();
      expect(within(log).getAllByText('Unknown user').length).toBeGreaterThan(
        0,
      );
    });

    it('**the opening shows its files, and the ones that didn’t attach**; only a moderator may delete them', async () => {
      sessionStorage.setItem(
        'synapsedesk.opening-skipped',
        JSON.stringify({ ticketId: 't1', names: ['old.png'] }),
      );
      setup({
        ticket: ticketOf({
          attachments: [
            {
              id: 'o1',
              messageId: null,
              ticketId: 't1',
              fileName: 'screen.png',
              fileUrl: 'organizations/o/ticket-openings/priya/a.png',
              fileSizeBytes: 2048,
              mimeType: 'image/png',
              createdAt: AT,
            },
          ],
        }),
      });
      await loaded();
      const log = await screen.findByRole('log', { name: 'Conversation' });

      expect(
        within(log).getByRole('button', { name: /^screen\.png/ }),
      ).toBeInTheDocument();
      expect(
        within(log).getByText(
          'We couldn’t attach old.png, so the answer doesn’t use it. You can attach it again below.',
        ),
      ).toBeInTheDocument();
      // The requester isn't a moderator: the server would refuse the delete.
      expect(
        within(log).queryByRole('button', { name: 'Delete screen.png' }),
      ).not.toBeInTheDocument();
    });

    describe('Delete on a file follows the server’s window', () => {
      const SOON = new Date(Date.now() + 10 * 60_000).toISOString();
      const FILE = {
        id: 'f1',
        fileName: 'receipt.pdf',
        fileUrl: 'organizations/o/tickets/t1/attachments/a.pdf',
        fileSizeBytes: 2048,
        mimeType: 'application/pdf',
        createdAt: AT,
      };
      const opening = {
        ...FILE,
        id: 'o1',
        fileName: 'screen.png',
        messageId: null,
        ticketId: 't1',
      };
      const sent = (editableUntil: string | null) =>
        messageOf({
          senderId: PRIYA.id,
          sender: PRIYA,
          content: 'Here it is.',
          editableUntil,
          attachments: [{ ...FILE, messageId: 'mx', ticketId: 't1' }],
        });

      it('**its sender, while they may still edit**: shown; after: hidden', async () => {
        setup({ messages: [sent(SOON)] });
        await loaded();
        const log = await screen.findByRole('log', { name: 'Conversation' });
        expect(
          within(log).getByRole('button', { name: 'Delete receipt.pdf' }),
        ).toBeInTheDocument();
      });

      it('its sender once the window has closed: hidden', async () => {
        setup({ messages: [sent(null)] });
        await loaded();
        const log = await screen.findByRole('log', { name: 'Conversation' });
        expect(within(log).getByText('Here it is.')).toBeInTheDocument();
        expect(
          within(log).queryByRole('button', { name: 'Delete receipt.pdf' }),
        ).not.toBeInTheDocument();
      });

      it('**the opening’s author inside the window**: shown, and the dialog says “this ticket”', async () => {
        setup({
          ticket: ticketOf({
            attachments: [opening],
            openingFilesDeletableUntil: SOON,
          }),
        });
        await loaded();
        const log = await screen.findByRole('log', { name: 'Conversation' });

        await userEvent.click(
          within(log).getByRole('button', { name: 'Delete screen.png' }),
        );

        expect(
          await screen.findByText(
            'It’s removed from this ticket for everyone. This can’t be undone.',
          ),
        ).toBeInTheDocument();
      });

      it('a message’s file: the dialog says “this message”', async () => {
        setup({ messages: [sent(SOON)] });
        await loaded();
        const log = await screen.findByRole('log', { name: 'Conversation' });

        await userEvent.click(
          within(log).getByRole('button', { name: 'Delete receipt.pdf' }),
        );

        expect(
          await screen.findByText(
            'It’s removed from this message for everyone. This can’t be undone.',
          ),
        ).toBeInTheDocument();
      });
    });

    it('a moderator may delete a file on the opening', async () => {
      setup({
        viewer: ANA,
        agent: true,
        codes: ['ticket.read.all', 'ticket.message.moderate'],
        ticket: ticketOf({
          attachments: [
            {
              id: 'o1',
              messageId: null,
              ticketId: 't1',
              fileName: 'screen.png',
              fileUrl: 'organizations/o/ticket-openings/priya/a.png',
              fileSizeBytes: 2048,
              mimeType: 'image/png',
              createdAt: AT,
            },
          ],
        }),
        routes: { 'DELETE /api/v1/attachments/o1': ok(null) },
      });
      await loaded();
      const log = await screen.findByRole('log', { name: 'Conversation' });

      await userEvent.click(
        within(log).getByRole('button', { name: 'Delete screen.png' }),
      );
      await userEvent.click(
        await screen.findByRole('button', { name: 'Delete file' }),
      );

      await waitFor(() =>
        expect(globalThis.fetch as jest.Mock).toHaveBeenCalledWith(
          '/api/v1/attachments/o1',
          expect.objectContaining({ method: 'DELETE' }),
        ),
      );
    });

    it('shows the AI’s answers, their sources and its non-answers', async () => {
      setup({
        messages: [
          messageOf({
            isAiGenerated: true,
            senderId: null,
            sender: null,
            content: 'Refunds take 5 days.',
            answerStatus: 'DOC_ANSWER',
            citations: [
              {
                chunkId: 'c1',
                documentId: 'd1',
                documentTitle: 'Refund policy',
                pageNumber: 2,
              },
              {
                chunkId: 'c2',
                documentId: 'd2',
                documentTitle: 'FAQ',
                pageNumber: null,
              },
            ] as MessageResponseDto['citations'],
          }),
          messageOf({
            isAiGenerated: true,
            senderId: null,
            sender: null,
            content: 'I can’t say.',
            answerStatus: 'REFUSED',
          }),
          messageOf({
            isAiGenerated: true,
            senderId: null,
            sender: null,
            content: 'Nothing found.',
            answerStatus: 'DOC_MISSING',
          }),
        ],
      });
      await loaded();
      const log = await screen.findByRole('log');
      await within(log).findByText('Refunds take 5 days.');

      // Each source opens the reader at its passage.
      expect(
        within(log).getByRole('link', {
          name: 'Refund policy, page 2, source 1',
        }),
      ).toHaveAttribute('href', '/knowledge/articles/d1?passage=c1');
      expect(
        within(log).getByRole('link', { name: 'FAQ, source 2' }),
      ).toHaveAttribute('href', '/knowledge/articles/d2?passage=c2');
      expect(within(log).getByText(/from 2 sources/)).toBeInTheDocument();
      expect(
        within(log).getByText(
          'You can rephrase your message, or ask a person to take over.',
        ),
      ).toBeInTheDocument();
      expect(
        within(log).getByText(
          'Not what you needed? A person from the support team can take over.',
        ),
      ).toBeInTheDocument();
      // Only the latest non-answer carries the offer.
      expect(
        within(log).getAllByRole('button', { name: 'Ask a person' }),
      ).toHaveLength(1);
    });

    it('hands the ticket to a person when the requester asks', async () => {
      const escalated = ticketOf({ status: 'ESCALATED' });
      let escalatedAt: string | null = null;
      const { calls, state, user } = setup({
        messages: [
          messageOf({
            isAiGenerated: true,
            senderId: null,
            sender: null,
            content: 'Nothing found.',
            answerStatus: 'DOC_MISSING',
          }),
        ],
        routes: {
          'POST /api/v1/tickets/t1/escalate': () => {
            state.ticket = ok(escalated);
            escalatedAt = new Date(Date.parse(AT) + 3_600_000).toISOString();
            return ok(escalated);
          },
          'GET /api/v1/tickets/t1/history': () =>
            ok(
              escalatedAt
                ? [
                    {
                      id: 'h1',
                      ticketId: 't1',
                      fromStatus: 'OPEN',
                      toStatus: 'ESCALATED',
                      changedById: PRIYA.id,
                      reason: null,
                      changedAt: escalatedAt,
                    },
                  ]
                : [],
            ),
        },
      });
      await loaded();

      await user.click(
        await screen.findByRole('button', { name: 'Ask a person' }),
      );
      await waitFor(() =>
        expect(
          screen.getByText(
            'The support team has your question and will reply here.',
          ),
        ).toBeInTheDocument(),
      );
      // Focus moves to the notice that says what happened.
      const notice = await screen.findByText(
        'Escalated to the support team. A person will reply here.',
      );
      await waitFor(() => expect(notice.parentElement).toHaveFocus());
      expect(
        calls.some((call) => call.url === '/api/v1/tickets/t1/escalate'),
      ).toBe(true);
      expect(screen.queryByRole('button', { name: 'Ask a person' })).toBeNull();
    });

    it('says so when the support team can’t be reached', async () => {
      const error = jest.spyOn(toast, 'error').mockImplementation(() => 'id');
      const { user } = setup({
        messages: [
          messageOf({
            isAiGenerated: true,
            senderId: null,
            sender: null,
            answerStatus: 'REFUSED',
          }),
        ],
        routes: { 'POST /api/v1/tickets/t1/escalate': fail(500, 'Down') },
      });
      await loaded();

      await user.click(
        await screen.findByRole('button', { name: 'Ask a person' }),
      );
      await waitFor(() =>
        expect(error).toHaveBeenCalledWith(
          'Couldn’t reach the support team',
          expect.objectContaining({ description: 'Try again in a moment.' }),
        ),
      );
      expect(
        screen.getByRole('button', { name: 'Ask a person' }),
      ).toBeEnabled();
    });

    it('streams the AI’s answer to a requester’s reply, and stops it', async () => {
      const { socket, user } = setup();
      socket.acks[CLIENT_EVENTS.messageSend] = () =>
        frame({ messageId: 'm-new', streamId: 's1', skippedAttachments: [] });
      socket.acks[CLIENT_EVENTS.aiStreamCancel] = () =>
        frame({ cancelled: true });
      await loaded();

      await user.type(screen.getByRole('textbox'), 'Where is my refund?');
      await user.click(screen.getByRole('button', { name: 'Send' }));
      const log = screen.getByRole('log');
      expect(await within(log).findByText('Sent')).toBeInTheDocument();
      expect(within(log).getByText('Writing an answer…')).toBeInTheDocument();

      act(() =>
        socket.receive(
          REALTIME_EVENTS.aiStreamChunk,
          frame({ streamId: 's1', ticketId: 't1', token: 'Refunds take' }),
        ),
      );
      expect(within(log).getByText('Refunds take')).toBeInTheDocument();
      // No offer while the answer is still coming.
      expect(screen.queryByRole('button', { name: 'Ask a person' })).toBeNull();

      await user.click(within(log).getByRole('button', { name: 'Stop' }));
      expect(
        await within(log).findByText(
          'Answer stopped. Ask again, or ask a person to take over.',
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'Ask a person' }),
      ).toBeInTheDocument();
    });

    it('says an answer broke off, and that the assistant is out', async () => {
      const { socket, user } = setup();
      socket.acks[CLIENT_EVENTS.messageSend] = () =>
        frame({ messageId: 'm-new', streamId: 's1', skippedAttachments: [] });
      await loaded();

      await user.type(screen.getByRole('textbox'), 'Hello?');
      await user.click(screen.getByRole('button', { name: 'Send' }));
      await screen.findByText('Writing an answer…');

      act(() =>
        socket.receive(
          REALTIME_EVENTS.aiStreamError,
          frame({ streamId: 's1', ticketId: 't1' }),
        ),
      );
      expect(
        screen.getByText(
          'The answer stopped before it finished. Ask again, or ask a person to take over.',
        ),
      ).toBeInTheDocument();

      act(() =>
        socket.receive(
          REALTIME_EVENTS.aiStreamDone,
          frame({
            streamId: 's2',
            ticketId: 't1',
            messageId: null,
            status: 'AT_CAP',
          }),
        ),
      );
      expect(
        await screen.findByText('The assistant isn’t available right now.'),
      ).toBeInTheDocument();
    });

    it('marks a reply that didn’t go, and sends it again on Retry', async () => {
      let attempts = 0;
      const { user } = setup({
        viewer: ANA,
        agent: true,
        ticket: ticketOf({ currentAssigneeId: ANA.id, assignee: ANA }),
        routes: {
          'POST /api/v1/tickets/t1/messages': () =>
            attempts++ === 0
              ? fail(500, 'Down')
              : ok({ message: messageOf({}), skippedAttachments: [] }, 201),
        },
      });
      await loaded();

      await user.type(screen.getByRole('textbox'), 'On it.');
      await user.click(screen.getByRole('button', { name: 'Send reply' }));
      expect(await screen.findByText('Not sent.')).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Retry' }));
      expect(await screen.findByText('Sent')).toBeInTheDocument();
      expect(attempts).toBe(2);
    });

    it('counts new messages that arrive while the reader is scrolled up', async () => {
      let report: (entries: { isIntersecting: boolean }[]) => void = () => {};
      globalThis.IntersectionObserver = class {
        constructor(callback: typeof report) {
          report = callback;
        }
        observe() {}
        disconnect() {}
      } as unknown as typeof IntersectionObserver;
      try {
        const { socket, state } = setup();
        await loaded();
        await screen.findByText('I was charged twice.');

        act(() => report([{ isIntersecting: false }]));
        state.messages = [messageOf({ content: 'We are on it.' })];
        act(() =>
          socket.receive(REALTIME_EVENTS.messageNew, { ticketId: 't1' }),
        );
        const pill = await screen.findByRole('button', {
          name: '1 new message',
        });

        await userEvent.click(pill);
        expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
          behavior: 'smooth',
          block: 'end',
        });
        expect(
          screen.queryByRole('button', { name: /new message/ }),
        ).toBeNull();
      } finally {
        delete (globalThis as { IntersectionObserver?: unknown })
          .IntersectionObserver;
      }
    });
  });

  describe('details', () => {
    it('shows the assignee, department and source to an agent', async () => {
      setup({
        viewer: ANA,
        agent: true,
        ticket: ticketOf({
          currentAssigneeId: 'ben',
          assignee: null,
          currentDepartmentId: 'd1',
          department: null,
          escalatedAt: AT,
        }),
      });
      await loaded();
      const details = screen.getByRole('tabpanel', { name: 'Details' });

      expect(within(details).getByText('Unknown user')).toBeInTheDocument();
      expect(
        within(details).getByText('Unknown department'),
      ).toBeInTheDocument();
      expect(within(details).getByText('Web')).toBeInTheDocument();
    });

    it('shows a requester no source, and an unassigned ticket as such', async () => {
      setup({
        ticket: ticketOf({
          currentDepartmentId: 'd1',
          department: { id: 'd1', name: 'Billing' },
        }),
      });
      await loaded();
      const details = screen.getByRole('region', { name: 'Details' });

      expect(within(details).getByText('Unassigned')).toBeInTheDocument();
      expect(within(details).getByText('Billing')).toBeInTheDocument();
      expect(within(details).queryByText('Source')).toBeNull();
    });

    it('announces a change of status, priority and assignee', async () => {
      const polite = document.createElement('div');
      polite.id = 'announcer-polite';
      document.body.append(polite);
      try {
        const { socket, state } = setup();
        await loaded();

        state.ticket = ok(
          ticketOf({
            status: 'PENDING_AGENT',
            currentAssigneeId: ANA.id,
            assignee: ANA,
          }),
        );
        act(() =>
          socket.receive(REALTIME_EVENTS.ticketUpdated, { ticketId: 't1' }),
        );
        await waitFor(() =>
          expect(polite).toHaveTextContent('Assigned to Ana Ruiz'),
        );

        state.ticket = ok(
          ticketOf({
            status: 'PENDING_AGENT',
            priority: 'URGENT',
            currentAssigneeId: ANA.id,
            assignee: ANA,
          }),
        );
        act(() =>
          socket.receive(REALTIME_EVENTS.ticketUpdated, { ticketId: 't1' }),
        );
        await waitFor(() =>
          expect(polite).toHaveTextContent('Priority changed to Urgent'),
        );
      } finally {
        polite.remove();
      }
    });
  });
  describe('the action bar', () => {
    it('offers an agent only what their permissions allow', async () => {
      const { user } = setup({ viewer: ANA, agent: true });
      await loaded();
      const bar = screen.getByRole('toolbar', { name: 'Ticket actions' });

      // From Open, escalating needs no permission; the rest need theirs.
      expect(within(bar).getAllByRole('button')).toHaveLength(1);
      await user.click(
        within(bar).getByRole('button', {
          name: 'Status: Open. Change status',
        }),
      );
      expect(
        (await screen.findAllByRole('menuitem')).map(
          (item) => item.textContent,
        ),
      ).toEqual(['Escalate…']);
    });

    it('is not there for the person who raised the ticket', async () => {
      setup();
      await loaded();

      expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    });

    it('Undo after Unassign assigns the same person in the same department', async () => {
      const success = jest
        .spyOn(toast, 'success')
        .mockImplementation(() => 'id');
      const { calls, user } = setup({
        viewer: ANA,
        agent: true,
        codes: ['ticket.read.all', 'ticket.assign'],
        ticket: ticketOf({
          currentAssigneeId: 'ben',
          assignee: { id: 'ben', fullName: 'Ben Ito', avatarUrl: null },
          currentDepartmentId: 'd1',
          department: { id: 'd1', name: 'Billing' },
        }),
        routes: {
          'DELETE /api/v1/tickets/t1/assign': { status: 204 },
          'POST /api/v1/tickets/t1/assign': ok({}),
          'GET /api/v1/tickets/t1/assignments': ok([]),
          'GET /api/v1/tickets': ok({ items: [] }),
        },
      });
      await loaded();

      await user.click(screen.getByRole('button', { name: 'More actions' }));
      await user.click(
        await screen.findByRole('menuitem', { name: 'Unassign' }),
      );
      await waitFor(() =>
        expect(success).toHaveBeenCalledWith(
          'Ticket #1042 is unassigned',
          expect.anything(),
        ),
      );
      const [, options] = success.mock.calls[0] as [
        string,
        { action: { label: string; onClick: () => void } },
      ];
      expect(options.action.label).toBe('Undo');
      act(() => options.action.onClick());

      await waitFor(() =>
        expect(
          calls.find(
            (call) => call.method === 'POST' && call.url.endsWith('/assign'),
          )?.body,
        ).toEqual({ assigneeId: 'ben', departmentId: 'd1' }),
      );
      success.mockRestore();
    });
  });
});
