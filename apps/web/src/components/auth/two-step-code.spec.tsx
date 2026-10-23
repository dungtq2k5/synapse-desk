import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, ok, stubApi } from '@/test/api';
import '@/test/dom';
import { TwoStepCode } from './two-step-code';

const AUTHENTICATE = 'POST /api/v1/auth/2fa/authenticate';

const setup = (justEnrolled = false) => {
  const onSignedIn = jest.fn();
  const onBack = jest.fn();
  render(
    <TwoStepCode
      justEnrolled={justEnrolled}
      onSignedIn={onSignedIn}
      onBack={onBack}
    />,
  );
  return { onSignedIn, onBack, user: userEvent.setup() };
};

const code = () => screen.getByLabelText('Verification code');

describe('the two-step code', () => {
  it('has no "Remember this device" for a Super Admin, and says why', async () => {
    const calls = stubApi({
      [AUTHENTICATE]: ok({ accessTokenExpiresIn: 900 }),
    });
    render(
      <TwoStepCode
        justEnrolled={false}
        canRememberDevice={false}
        onSignedIn={jest.fn()}
        onBack={jest.fn()}
      />,
    );

    expect(screen.queryByLabelText('Remember this device')).toBeNull();
    expect(
      screen.getByText('Super Admins enter a code every time they sign in.'),
    ).toBeVisible();
    await userEvent.setup().type(code(), '123456');
    expect(calls[0].body).toMatchObject({ rememberDevice: false });
  });

  it('verifies as soon as the sixth digit is typed', async () => {
    const calls = stubApi({
      [AUTHENTICATE]: ok({ accessTokenExpiresIn: 900 }),
    });
    const { onSignedIn, user } = setup();

    await user.type(code(), '123456');

    expect(onSignedIn).toHaveBeenCalledWith(null);
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toMatchObject({
      code: '123456',
      rememberDevice: false,
    });
  });

  it('passes on the warning a sign-in answers with', async () => {
    stubApi({
      [AUTHENTICATE]: ok({ warning: 'Only 2 backup codes left.' }),
    });
    const { onSignedIn, user } = setup();

    await user.type(code(), '123456');

    expect(onSignedIn).toHaveBeenCalledWith('Only 2 backup codes left.');
  });

  it('remembers the device when asked', async () => {
    const calls = stubApi({ [AUTHENTICATE]: ok({}) });
    const { user } = setup();

    await user.click(
      screen.getByRole('checkbox', { name: 'Remember this device' }),
    );
    await user.type(code(), '123456');

    expect(calls[0].body).toMatchObject({ rememberDevice: true });
  });

  it('a short code is not sent', async () => {
    const calls = stubApi({});
    const { user } = setup();

    await user.type(code(), '123');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(calls).toEqual([]);
  });

  it('clears a wrong code and says so', async () => {
    stubApi({ [AUTHENTICATE]: fail(400, 'Invalid code') });
    const { onSignedIn, user } = setup();

    await user.type(code(), '123456');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That code is wrong or has expired. Enter the current code from your app.',
    );
    expect(code()).toHaveValue('');
    expect(code()).toHaveAttribute('aria-invalid', 'true');
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it('pauses after too many attempts', async () => {
    stubApi({
      [AUTHENTICATE]: fail(429, 'Too many requests', { 'retry-after': '30' }),
    });
    const { user } = setup();

    await user.type(code(), '123456');

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'For your security, verification is paused. Try again in 1 minute.',
    );
  });

  it('takes a backup code instead, trimmed', async () => {
    const calls = stubApi({ [AUTHENTICATE]: ok({}) });
    const { onSignedIn, user } = setup();

    await user.click(
      screen.getByRole('button', { name: 'Use a backup code instead' }),
    );
    expect(
      screen.getByText(
        'Enter one of the backup codes you saved when you set up two-step verification.',
      ),
    ).toBeInTheDocument();

    // An empty backup code is not sent.
    await user.click(screen.getByRole('button', { name: 'Verify' }));
    expect(calls).toEqual([]);

    await user.type(screen.getByLabelText('Backup code'), ' ABCDE-12345 ');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(calls[0].body).toMatchObject({ backupCode: 'ABCDE-12345' });
    expect(onSignedIn).toHaveBeenCalledWith(null);
  });

  it('says a used backup code is wrong, and the app is a click away', async () => {
    stubApi({ [AUTHENTICATE]: fail(400, 'Invalid backup code') });
    const { user } = setup();

    await user.click(
      screen.getByRole('button', { name: 'Use a backup code instead' }),
    );
    await user.type(screen.getByLabelText('Backup code'), 'ABCDE-12345');
    await user.click(screen.getByRole('button', { name: 'Verify' }));

    expect(
      await screen.findByText(
        'That backup code is wrong or has already been used.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Backup code')).toHaveFocus();

    await user.click(
      screen.getByRole('button', {
        name: 'Use your authenticator app instead',
      }),
    );
    expect(code()).toBeInTheDocument();
    expect(
      screen.queryByText('That backup code is wrong or has already been used.'),
    ).toBeNull();
  });

  it('says two-step verification is on right after setup', () => {
    setup(true);
    expect(screen.getByRole('status')).toHaveTextContent(
      'Two-step verification is on',
    );
  });

  it('goes back to sign-in', async () => {
    const { onBack, user } = setup();
    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(onBack).toHaveBeenCalled();
  });
});
