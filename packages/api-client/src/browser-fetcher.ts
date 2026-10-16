import { ApiError } from './api-error';
import { SESSION_ROUTES } from './generated/session-routes';
import { readResponse } from './read-response';

const REFRESH_URL = '/api/v1/auth/refresh';

/** The refresh in flight, shared by every call that hits a 401 meanwhile. */
let refreshing: Promise<boolean> | null = null;

/**
 * How many refreshes have succeeded. A call notes it when sent: a 401 on a
 * call sent before the latest refresh finished carried the old cookie, so it
 * retries with the new one rather than refreshing again. Two refreshes for one
 * expiry would spend a refresh token twice, and reuse signs the session out.
 */
let generation = 0;

/**
 * The browser's fetcher: same-origin, cookies only.
 *
 * On a 401 from a call the access cookie authorises, it refreshes **once** for
 * every call waiting at that moment, then retries the call once. A call sent
 * before a refresh that has since finished just retries (`generation`). A
 * refresh that fails sends the browser to `/login?next=…`. A 401 from any other call
 * (a sign-in leg) is returned as it is: refreshing can't fix a wrong password.
 *
 * @example
 * const tickets = await browserFetch<TicketsPage>('/api/v1/tickets', { method: 'GET' });
 */
export async function browserFetch<T>(
  url: string,
  init: RequestInit,
): Promise<T> {
  const sentAt = generation;
  let response = await send(url, init);
  if (response.status !== 401 || !needsSession(init.method ?? 'GET', url)) {
    return readResponse<T>(response);
  }

  if (generation !== sentAt) {
    // A refresh finished after this was sent: the cookie it carried is old.
    response = await send(url, init);
    if (response.status !== 401) return readResponse<T>(response);
  }

  if (await refreshOnce()) {
    return readResponse<T>(await send(url, init));
  }

  goToSignIn();
  throw new ApiError(401, await bodyOf(response));
}

function send(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, credentials: 'same-origin' });
}

/** Whether the document secures this call with the access cookie. */
export function needsSession(method: string, url: string): boolean {
  const path = url.split('?')[0];
  const verb = method.toUpperCase();
  return SESSION_ROUTES.some(
    ([routeMethod, pattern]) => routeMethod === verb && pattern.test(path),
  );
}

/** One `POST /auth/refresh` for every caller waiting now; `true` if it worked. */
export function refreshOnce(): Promise<boolean> {
  refreshing ??= send(REFRESH_URL, { method: 'POST' })
    .then((response) => {
      if (response.ok) generation += 1;
      return response.ok;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

function goToSignIn(): void {
  const { pathname, search } = globalThis.location;
  globalThis.location.assign(
    `/login?next=${encodeURIComponent(pathname + search)}`,
  );
}

async function bodyOf(response: Response): Promise<unknown> {
  try {
    return await response.clone().json();
  } catch {
    return null;
  }
}
