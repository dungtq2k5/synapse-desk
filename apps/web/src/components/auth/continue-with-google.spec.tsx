import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, ok, stubApi } from '@/test/api';
import { googleIdToken } from '@/lib/google-sign-in';
import { CredentialsForm } from './credentials-form';

jest.mock('@/lib/google-sign-in', () => ({
  ...jest.requireActual('@/lib/google-sign-in'),
  googleIdToken: jest.fn(),
}));
const popup = jest.mocked(googleIdToken);

const FIREBASE = {
  apiKey: 'fake-api-key',
  authDomain: 'localhost',
  projectId: 'synapsedesk-test',
  emulatorUrl: 'http://localhost:9099',
};

const setup = (firebase: typeof FIREBASE | null = FIREBASE) => {
  const onAnswer = jest.fn();
  render(
    <CredentialsForm
      notice={null}
      email=""
      onEmail={() => undefined}
      onAnswer={onAnswer}
      firebase={firebase}
    />,
  );
  return { onAnswer, user: userEvent.setup() };
};

const google = () =>
  screen.getByRole('button', { name: 'Continue with Google' });

describe('continue with Google', () => {
  beforeEach(() => popup.mockReset());

  it('sends the popup’s ID token and continues with the answer', async () => {
    popup.mockResolvedValue('id-token');
    const calls = stubApi({
      'POST /api/v1/auth/google': ok({
        requiresTwoFactor: true,
        requiresTwoFactorSetup: false,
      }),
    });
    const { onAnswer, user } = setup();

    await user.click(google());

    expect(calls[0]).toMatchObject({
      url: '/api/v1/auth/google',
      body: { idToken: 'id-token' },
    });
    expect(onAnswer).toHaveBeenCalledWith({ kind: 'code' });
  });

  it('says nothing when the person closes the popup', async () => {
    popup.mockRejectedValue({ code: 'auth/popup-closed-by-user' });
    stubApi({});
    const { onAnswer, user } = setup();

    await user.click(google());

    expect(screen.queryByRole('alert')).toBeNull();
    expect(google()).toBeEnabled();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('says it couldn’t sign in when the gateway refuses the token', async () => {
    popup.mockResolvedValue('id-token');
    stubApi({ 'POST /api/v1/auth/google': fail(401, 'Invalid Google token') });
    const { onAnswer, user } = setup();

    await user.click(google());

    expect(
      await screen.findByText('Couldn’t sign in with Google'),
    ).toBeInTheDocument();
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('isn’t offered when Google sign-in isn’t configured', () => {
    stubApi({});
    setup(null);

    expect(
      screen.queryByRole('button', { name: 'Continue with Google' }),
    ).toBeNull();
    expect(screen.queryByText('or')).toBeNull();
  });
});
