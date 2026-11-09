/**
 * The gateway's two session cookies, by name. The root page reads only whether
 * each is present, to choose between the landing page and the app; it never
 * reads their values.
 *
 * The gateway names them in its env (`JWT_ACCESS_NAME`, `JWT_REFRESH_NAME`);
 * `packages/config/src/web-client.spec.ts` holds these equal to its env
 * examples, so a rename on one side alone fails a test instead of showing
 * signed-in people the landing page.
 *
 * @example (await cookies()).has(ACCESS_COOKIE)
 */
export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';
