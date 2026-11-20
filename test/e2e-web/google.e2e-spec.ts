import { expect, test, type Page } from './coverage';
import { emulatorIdToken, signInInPopup } from './firebase';
import { clearThrottles, seededActors } from './support';

/**
 * Google sign-in against Firebase's Auth emulator: no Google account, no
 * OAuth client. Each run's new people are its own, because the emulator and
 * the databases outlive a run.
 */
test.beforeEach(clearThrottles);

const run = Date.now();

/** `POST /auth/google` with the emulator's token for this identity, as the button sends it. */
async function continueWithGoogle(page: Page, email: string, name: string) {
  const idToken = await emulatorIdToken(email, name);
  const answer = await page.request.post('/api/v1/auth/google', {
    data: { idToken, deviceName: 'Chrome on Linux' },
  });
  expect(answer.ok(), await answer.text()).toBe(true);
  return ((await answer.json()) as { data: Record<string, unknown> }).data;
}

test('Google, through the emulator: a new person gets an account and lands in the app', async ({
  page,
}) => {
  const email = `sam@google-${run}.example.test`;

  // A new domain founds a new organization, so Sam is its admin.
  expect(await continueWithGoogle(page, email, 'Sam Rivera')).toMatchObject({
    requiresTwoFactor: false,
    user: { email },
  });

  // The founder is the organization's admin: home is the queue, with the
  // setup checklist above it.
  await page.goto('/');
  await expect(page).toHaveURL(/\/tickets$/);
  await expect(
    page.getByRole('heading', { name: 'Tickets', level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: /^Set up / })).toBeVisible();
});

test('Google, through the emulator: an existing person signs in to their account', async ({
  page,
}) => {
  const { colleague } = await seededActors();

  expect(
    await continueWithGoogle(page, colleague.email, 'Seeded Colleague'),
  ).toMatchObject({ user: { id: colleague.id } });

  await page.goto('/tickets');
  await expect(page).toHaveURL(/\/tickets$/);
});

test('the Google button opens the popup, and the popup’s account signs in', async ({
  page,
}) => {
  const email = `jo@google-popup-${run}.example.test`;
  await page.goto('/login');

  const opened = page.waitForEvent('popup');
  await page.getByRole('button', { name: 'Continue with Google' }).click();
  // The emulator's own sign-in page, standing in for Google's.
  await signInInPopup(await opened, email, 'Jo Park');

  // A new domain: Jo founds it, so home is the queue.
  await expect(page).toHaveURL(/\/tickets$/);
  await expect(
    page.getByRole('heading', { name: 'Tickets', level: 1 }),
  ).toBeVisible();
});
