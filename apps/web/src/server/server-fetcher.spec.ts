/**
 * @jest-environment node
 */
jest.mock('server-only', () => ({}));
jest.mock('next/headers', () => ({ headers: jest.fn() }));

import { forRequest, Unauthenticated } from './server-fetcher';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status });

describe('the server fetcher', () => {
  const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();

  beforeEach(() => {
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    process.env.GATEWAY_URL = 'http://api-gateway:3000';
  });

  const incoming = new Headers({
    cookie: 'access_token=a; refresh_token=r',
    'user-agent': 'Mozilla/5.0 test',
    'x-forwarded-for': '198.51.100.7, 203.0.113.9',
    'x-something-else': 'never forwarded',
  });

  it('forwards Cookie, User-Agent and X-Forwarded-For unchanged, and nothing else', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { data: [] }));

    await forRequest(incoming)('/api/v1/tickets', { method: 'GET' });

    const [url, init] = fetchMock.mock.calls[0];
    const sent = new Headers(init.headers);
    expect(url).toBe('http://api-gateway:3000/api/v1/tickets');
    expect(sent.get('cookie')).toBe('access_token=a; refresh_token=r');
    expect(sent.get('user-agent')).toBe('Mozilla/5.0 test');
    expect(sent.get('x-forwarded-for')).toBe('198.51.100.7, 203.0.113.9');
    expect(sent.get('x-something-else')).toBeNull();
  });

  it('adds no X-Forwarded-For of its own when none arrived', async () => {
    fetchMock.mockResolvedValueOnce(json(200, {}));

    await forRequest(new Headers({ cookie: 'access_token=a' }))(
      '/api/v1/users/me',
      {},
    );

    expect(
      new Headers(fetchMock.mock.calls[0][1].headers).has('x-forwarded-for'),
    ).toBe(false);
  });

  it("sets cache: 'no-store' on every call, even if a caller asked otherwise", async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json(200, {})));
    const fetcher = forRequest(incoming);

    await fetcher('/api/v1/tickets', { method: 'GET' });
    await fetcher('/api/v1/users/me', { method: 'GET', cache: 'force-cache' });

    expect(fetchMock.mock.calls.map(([, init]) => init.cache)).toEqual([
      'no-store',
      'no-store',
    ]);
  });

  it('never refreshes: a 401 throws Unauthenticated after the one call', async () => {
    fetchMock.mockResolvedValueOnce(json(401, { statusCode: 401 }));

    await expect(
      forRequest(incoming)('/api/v1/tickets', { method: 'GET' }),
    ).rejects.toBeInstanceOf(Unauthenticated);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(
      fetchMock.mock.calls.some(([url]) => url.includes('/auth/refresh')),
    ).toBe(false);
  });

  it('any other refusal keeps the gateway envelope', async () => {
    fetchMock.mockResolvedValueOnce(
      json(404, { statusCode: 404, message: 'Ticket not found' }),
    );

    await expect(
      forRequest(incoming)('/api/v1/tickets/x', { method: 'GET' }),
    ).rejects.toMatchObject({ status: 404, message: 'Ticket not found' });
  });
});
