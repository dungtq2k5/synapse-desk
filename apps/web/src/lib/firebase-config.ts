/**
 * Firebase's web config: public values, read from the web server's
 * environment on each request and handed to the browser, so one image serves
 * every environment (a `NEXT_PUBLIC_` value would be baked into the build).
 * `emulatorUrl` is set in development and tests, where sign-in goes to the
 * Auth emulator; unset, the SDK talks to Firebase.
 */
export type FirebaseWebConfig = {
  apiKey: string;
  authDomain: string;
  projectId: string;
  emulatorUrl: string | null;
};

/**
 * The config these variables describe, or null when Google sign-in isn't
 * configured (no API key, auth domain or project), so the button isn't shown.
 *
 * @example firebaseWebConfig({ FIREBASE_API_KEY: 'k', FIREBASE_AUTH_DOMAIN: 'localhost', FIREBASE_PROJECT_ID: 'p' })
 * // { apiKey: 'k', authDomain: 'localhost', projectId: 'p', emulatorUrl: null }
 */
export function firebaseWebConfig(
  env: Record<string, string | undefined> = process.env,
): FirebaseWebConfig | null {
  const apiKey = env.FIREBASE_API_KEY;
  const authDomain = env.FIREBASE_AUTH_DOMAIN;
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!apiKey || !authDomain || !projectId) return null;
  return {
    apiKey,
    authDomain,
    projectId,
    emulatorUrl: env.FIREBASE_AUTH_EMULATOR_URL || null,
  };
}

/**
 * Where the browser talks to for Google sign-in, for the page's policy: the
 * emulator, or Google's two token endpoints and the auth domain's frame.
 *
 * @example firebaseOrigins({ …, emulatorUrl: 'http://localhost:9099' }) // { connect: ['http://localhost:9099'], frame: ['http://localhost:9099'] }
 */
export function firebaseOrigins(config: FirebaseWebConfig | null): {
  connect: string[];
  frame: string[];
} {
  if (!config) return { connect: [], frame: [] };
  if (config.emulatorUrl) {
    const emulator = new URL(config.emulatorUrl).origin;
    return { connect: [emulator], frame: [emulator] };
  }
  return {
    connect: [
      'https://identitytoolkit.googleapis.com',
      'https://securetoken.googleapis.com',
    ],
    frame: [`https://${config.authDomain}`],
  };
}
