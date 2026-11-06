import { handle } from './src/index';

const SITE = 'https://synapsedeskapp.com';
const page = (path = '/tickets') =>
  new Request(`${SITE}${path}`, {
    headers: { accept: 'text/html,application/xhtml+xml' },
  });
const answering = (status: number) => () =>
  Promise.resolve(new Response('origin', { status }));
const throwing = () => Promise.reject(new Error('connection refused'));

describe('the offline page', () => {
  it.each([502, 503, 504, 530])(
    'answers a page load when the origin answers %i',
    async (status) => {
      const response = await handle(page(), answering(status));
      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).toBe('300');
      expect(await response.text()).toContain(
        'The SynapseDesk demo is offline right now',
      );
    },
  );

  it('answers a page load when the origin throws', async () => {
    expect((await handle(page(), throwing)).status).toBe(503);
  });

  it('passes a 200 through untouched', async () => {
    const response = await handle(page(), answering(200));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('origin');
  });

  it.each([
    ['the API', page('/api/v1/users/me')],
    ['GraphQL', page('/graphql')],
    ['the socket', page('/socket.io/?EIO=4')],
    [
      'a POST',
      new Request(`${SITE}/login`, {
        method: 'POST',
        headers: { accept: 'text/html' },
      }),
    ],
    [
      'a JSON request',
      new Request(`${SITE}/tickets`, {
        headers: { accept: 'application/json' },
      }),
    ],
  ])("keeps the origin's own error for %s", async (_label, request) => {
    const response = await handle(request, answering(502));
    expect(response.status).toBe(502);
    expect(await response.text()).toBe('origin');
  });
});
