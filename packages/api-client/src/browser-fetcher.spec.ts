import { ApiError } from './api-error';
import { browserFetch, needsSession } from './browser-fetcher';

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('browserFetch', () => {
  const fetchMock = jest.fn<Promise<Response>, [string, RequestInit]>();
  const assign = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    assign.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    Object.defineProperty(globalThis, 'location', {
      configurable: true,
      value: { pathname: '/tickets', search: '?page=2', assign },
    });
  });

  const refreshCalls = () =>
    fetchMock.mock.calls.filter(([url]) => url === '/api/v1/auth/refresh');

  it('returns the parsed body, sending cookies same-origin', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { success: true, data: [] }));

    await expect(
      browserFetch('/api/v1/tickets', { method: 'GET' }),
    ).resolves.toEqual({ success: true, data: [] });
    expect(fetchMock.mock.calls[0][1].credentials).toBe('same-origin');
  });

  it('two concurrent 401s share ONE refresh, then each retries once', async () => {
    let releaseRefresh!: () => void;
    fetchMock.mockImplementation((url) => {
      if (url === '/api/v1/auth/refresh') {
        return new Promise((resolve) => {
          releaseRefresh = () => resolve(json(200, { success: true }));
        });
      }
      const retried =
        fetchMock.mock.calls.filter(([seen]) => seen === url).length > 1;
      return Promise.resolve(
        retried ? json(200, { url }) : json(401, { statusCode: 401 }),
      );
    });

    const first = browserFetch('/api/v1/tickets', { method: 'GET' });
    const second = browserFetch('/api/v1/users/me', { method: 'GET' });
    await new Promise((resolve) => setImmediate(resolve));
    releaseRefresh();

    await expect(first).resolves.toEqual({ url: '/api/v1/tickets' });
    await expect(second).resolves.toEqual({ url: '/api/v1/users/me' });
    expect(refreshCalls()).toHaveLength(1);
    expect(assign).not.toHaveBeenCalled();
  });

  it('a 401 arriving AFTER the refresh finished retries without a second refresh', async () => {
    // The first call's 401 starts the refresh; the second call was sent
    // before it finished, and its 401 lands after.
    let releaseLate!: () => void;
    let refreshed = false;
    fetchMock.mockImplementation((url) => {
      if (url === '/api/v1/auth/refresh') {
        refreshed = true;
        return Promise.resolve(json(200, { success: true }));
      }
      if (url === '/api/v1/users/me' && !refreshed) {
        // Sent with the old cookie; answered late.
        return new Promise((resolve) => {
          releaseLate = () => resolve(json(401, { statusCode: 401 }));
        });
      }
      const retried =
        fetchMock.mock.calls.filter(([seen]) => seen === url).length > 1;
      return Promise.resolve(
        retried || refreshed
          ? json(200, { url })
          : json(401, { statusCode: 401 }),
      );
    });

    const late = browserFetch('/api/v1/users/me', { method: 'GET' });
    await expect(
      browserFetch('/api/v1/tickets', { method: 'GET' }),
    ).resolves.toEqual({ url: '/api/v1/tickets' });
    releaseLate();

    await expect(late).resolves.toEqual({ url: '/api/v1/users/me' });
    expect(refreshCalls()).toHaveLength(1);
  });

  it('a 401 arriving DURING the refresh joins it', async () => {
    let releaseRefresh!: () => void;
    fetchMock.mockImplementation((url) => {
      if (url === '/api/v1/auth/refresh') {
        return new Promise((resolve) => {
          releaseRefresh = () => resolve(json(200, { success: true }));
        });
      }
      const retried =
        fetchMock.mock.calls.filter(([seen]) => seen === url).length > 1;
      return Promise.resolve(
        retried ? json(200, { url }) : json(401, { statusCode: 401 }),
      );
    });

    const first = browserFetch('/api/v1/tickets', { method: 'GET' });
    await new Promise((resolve) => setImmediate(resolve));
    // Sent while the refresh is in flight.
    const during = browserFetch('/api/v1/users/me', { method: 'GET' });
    await new Promise((resolve) => setImmediate(resolve));
    releaseRefresh();

    await expect(first).resolves.toEqual({ url: '/api/v1/tickets' });
    await expect(during).resolves.toEqual({ url: '/api/v1/users/me' });
    expect(refreshCalls()).toHaveLength(1);
  });

  it('a failed refresh sends the browser to sign-in, keeping where it was', async () => {
    fetchMock.mockImplementation((url) =>
      Promise.resolve(
        url === '/api/v1/auth/refresh'
          ? json(401, { statusCode: 401 })
          : json(401, { statusCode: 401, message: 'Unauthorized!' }),
      ),
    );

    await expect(
      browserFetch('/api/v1/tickets', { method: 'GET' }),
    ).rejects.toMatchObject({ status: 401 });
    expect(assign).toHaveBeenCalledWith('/login?next=%2Ftickets%3Fpage%3D2');
  });

  it('a 401 from a sign-in leg is returned as it is: no refresh, no redirect', async () => {
    fetchMock.mockResolvedValueOnce(
      json(401, { statusCode: 401, message: 'Invalid credentials' }),
    );

    const failure = browserFetch('/api/v1/auth/login', { method: 'POST' });

    await expect(failure).rejects.toBeInstanceOf(ApiError);
    await expect(failure).rejects.toMatchObject({
      status: 401,
      message: 'Invalid credentials',
      body: { statusCode: 401, message: 'Invalid credentials' },
    });
    expect(refreshCalls()).toHaveLength(0);
    expect(assign).not.toHaveBeenCalled();
  });

  it('any other error keeps the gateway envelope, unrewritten', async () => {
    const envelope = {
      success: false,
      statusCode: 404,
      message: 'Ticket not found',
    };
    fetchMock.mockResolvedValueOnce(json(404, envelope));

    await expect(
      browserFetch('/api/v1/tickets/x', { method: 'GET' }),
    ).rejects.toMatchObject({
      status: 404,
      body: envelope,
      message: 'Ticket not found',
    });
  });

  it('an empty 2xx body is undefined', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(
      browserFetch('/api/v1/tickets/x', { method: 'DELETE' }),
    ).resolves.toBeUndefined();
  });
});

describe('needsSession', () => {
  it('reads the document: the access cookie secures tickets, not the sign-in legs', () => {
    expect(needsSession('GET', '/api/v1/tickets?page=1')).toBe(true);
    expect(needsSession('GET', '/api/v1/tickets/123')).toBe(true);
    expect(needsSession('POST', '/api/v1/auth/login')).toBe(false);
    expect(needsSession('POST', '/api/v1/auth/refresh')).toBe(false);
    expect(needsSession('POST', '/api/v1/auth/2fa/authenticate')).toBe(false);
  });
});

describe('a 429', () => {
  it("keeps Retry-After's seconds, and null when it wasn't sent", async () => {
    globalThis.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response('{"statusCode":429}', {
          status: 429,
          headers: { 'retry-after': '120' },
        }),
      )
      .mockResolvedValueOnce(
        new Response('{"statusCode":429}', { status: 429 }),
      );

    await expect(
      browserFetch('/api/v1/auth/login', { method: 'POST' }),
    ).rejects.toMatchObject({ status: 429, retryAfterSeconds: 120 });
    await expect(
      browserFetch('/api/v1/auth/login', { method: 'POST' }),
    ).rejects.toMatchObject({ status: 429, retryAfterSeconds: null });
  });
});
