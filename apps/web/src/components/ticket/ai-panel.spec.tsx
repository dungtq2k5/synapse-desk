import type { TicketResponseDto } from '@synapsedesk/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, ok, stubApi } from '@/test/api';
import { AiPanel } from './ai-panel';

const TICKET = { id: 't1', ticketNumber: 1042 } as TicketResponseDto;

function show() {
  const calls = stubApi({
    'GET /api/v1/users/me': ok({
      user: { id: 'maya', fullName: 'Maya Chen', email: 'maya@acme.test' },
      permissionCodes: [
        'ticket.read.all',
        'ticket.ai.use',
        'ticket.assign',
        'department.read',
      ],
      departmentIds: [],
    }),
    'GET /api/v1/departments': ok({
      items: [{ id: 'd1', name: 'Facilities' }],
      meta: {},
    }),
    'GET /api/v1/tickets/t1/ai/summary': fail(404, 'No summary'),
    'GET /api/v1/tickets/t1/similar': ok([]),
    'POST /api/v1/tickets/t1/ai/suggestions': ok({
      nextSteps: [
        {
          title: 'Confirm the allowance',
          body: 'Reply.',
          confidenceScore: 0.7,
        },
      ],
      articles: [],
      degraded: null,
    }),
    'POST /api/v1/tickets/t1/ai/classify': ok({
      suggestedDepartmentId: 'd1',
      suggestedPriority: 'HIGH',
      confidenceScore: 0.82,
    }),
  });
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <AiPanel ticket={TICKET} />
    </QueryClientProvider>,
  );
  return { calls, user: userEvent.setup() };
}

const posts = (calls: ReturnType<typeof stubApi>, path: string) =>
  calls.filter(({ method, url }) => method === 'POST' && url.endsWith(path))
    .length;

describe('the AI tab', () => {
  it('**spends nothing on opening**: suggestions and routing run once each, when asked', async () => {
    const { calls, user } = show();
    await screen.findByText('No similar resolved tickets.');
    expect(
      await screen.findByRole('button', { name: 'Get suggestions' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Suggests a department and a priority. Uses the AI allowance.',
      ),
    ).toBeInTheDocument();
    expect(posts(calls, '/ai/suggestions')).toBe(0);
    expect(posts(calls, '/ai/classify')).toBe(0);

    await user.click(screen.getByRole('button', { name: 'Get suggestions' }));
    expect(
      await screen.findByText('1. Confirm the allowance'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Suggest routing' }));
    expect(await screen.findByText('Facilities')).toBeInTheDocument();

    await waitFor(() => {
      expect(posts(calls, '/ai/suggestions')).toBe(1);
      expect(posts(calls, '/ai/classify')).toBe(1);
    });
  });
});
