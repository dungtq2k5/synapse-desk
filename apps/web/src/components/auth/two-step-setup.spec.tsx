import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, ok, stubApi, type Reply } from '@/test/api';
import '@/test/dom';
import { manualKey, TwoStepSetup } from './two-step-setup';

const GENERATE = 'POST /api/v1/auth/2fa/setup';
const ENABLE = 'POST /api/v1/auth/2fa/enable';
const SECRET = ok({
  otpauthUri: 'otpauth://totp/SynapseDesk:priya?secret=JBSWY3DPEHPK3PXP',
  qrCodeDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
});
const CODES = ['AAAAA-11111', 'BBBBB-22222'];

const setup = (routes: Record<string, Reply>) => {
  const calls = stubApi(routes);
  const onEnrolled = jest.fn();
  const onBack = jest.fn();
  render(<TwoStepSetup onEnrolled={onEnrolled} onBack={onBack} />);
  return { calls, onEnrolled, onBack, user: userEvent.setup() };
};

const code = () => screen.getByLabelText('Enter the 6-digit code from the app');

/** A blob's text: jsdom's `Blob` has no `text()`. */
const textOf = (blob: Blob | undefined) =>
  new Promise<unknown>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsText(blob as Blob);
  });

describe('the manual key', () => {
  it('is the secret in groups of four', () => {
    expect(
      manualKey('otpauth://totp/SynapseDesk:a?secret=JBSWY3DPEHPK3PXP'),
    ).toBe('JBSW Y3DP EHPK 3PXP');
  });

  it('is empty when the URI has no secret', () => {
    expect(manualKey('otpauth://totp/SynapseDesk:a')).toBe('');
  });
});

describe('two-step setup', () => {
  it('shows the QR code and the key to type, and copies the key', async () => {
    setup({ [GENERATE]: SECRET });
    const writeText = jest.spyOn(navigator.clipboard, 'writeText');

    expect(
      await screen.findByAltText(
        'QR code for setting up two-step verification',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();

    // A plain click: moving focus off the code field starts input-otp's own
    // timers, which update it outside act.
    fireEvent.click(screen.getByRole('button', { name: 'Copy key' }));

    expect(
      await screen.findByRole('button', { name: 'Key copied' }),
    ).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith('JBSWY3DPEHPK3PXP');
  });

  it('waits for the secret before the code can be sent', async () => {
    setup({ [GENERATE]: SECRET });
    expect(
      screen.getByRole('button', { name: 'Verify and continue' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Copy key' })).toBeDisabled();

    await screen.findByText('JBSW Y3DP EHPK 3PXP');
    expect(
      screen.getByRole('button', { name: 'Verify and continue' }),
    ).toBeEnabled();
  });

  it('says setup couldn’t start, with a way back', async () => {
    const { onBack, user } = setup({
      [GENERATE]: fail(403, 'Two-step is already on'),
    });

    expect(await screen.findByText('Couldn’t start setup')).toBeInTheDocument();
    expect(screen.getByText('Two-step is already on')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(onBack).toHaveBeenCalled();
  });

  it('a short code is not sent', async () => {
    const { calls, user } = setup({ [GENERATE]: SECRET });
    await screen.findByText('JBSW Y3DP EHPK 3PXP');

    await user.type(code(), '123');
    await user.click(
      screen.getByRole('button', { name: 'Verify and continue' }),
    );

    expect(calls).toHaveLength(1);
  });

  it('clears a code that didn’t match and says why', async () => {
    const { user } = setup({
      [GENERATE]: SECRET,
      [ENABLE]: fail(400, 'Invalid code'),
    });
    await screen.findByText('JBSW Y3DP EHPK 3PXP');

    await user.type(code(), '123456');
    await user.click(
      screen.getByRole('button', { name: 'Verify and continue' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That code didn’t match. Check the time on your phone is set automatically, then try the current code.',
    );
    expect(code()).toHaveValue('');
  });

  it('shows the server’s message when activation fails on its side', async () => {
    const { user } = setup({
      [GENERATE]: SECRET,
      [ENABLE]: fail(503, 'Auth is down for maintenance'),
    });
    await screen.findByText('JBSW Y3DP EHPK 3PXP');

    await user.type(code(), '123456');
    await user.click(
      screen.getByRole('button', { name: 'Verify and continue' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Auth is down for maintenance',
    );
  });

  describe('then the backup codes', () => {
    const toCodes = async () => {
      const ready = setup({
        [GENERATE]: SECRET,
        [ENABLE]: ok({ backupCodes: CODES }),
      });
      await screen.findByText('JBSW Y3DP EHPK 3PXP');
      await ready.user.type(code(), '123456');
      await ready.user.click(
        screen.getByRole('button', { name: 'Verify and continue' }),
      );
      await screen.findByRole('heading', { name: 'Save your backup codes' });
      return ready;
    };

    it('lists each code, shown once', async () => {
      await toCodes();
      expect(screen.getByText('Step 2 of 2')).toBeInTheDocument();
      expect(screen.getByText('AAAAA-11111')).toBeInTheDocument();
      expect(screen.getByText('BBBBB-22222')).toBeInTheDocument();
    });

    it('continues only once the codes are saved', async () => {
      const { onEnrolled, user } = await toCodes();
      const next = screen.getByRole('button', { name: 'Continue' });

      expect(next).toHaveAttribute('aria-disabled', 'true');
      await user.click(next);
      expect(onEnrolled).not.toHaveBeenCalled();

      await user.click(
        screen.getByRole('checkbox', {
          name: 'I’ve saved my backup codes somewhere safe',
        }),
      );
      await user.click(next);
      expect(onEnrolled).toHaveBeenCalled();
    });

    it('copies the codes, one per line', async () => {
      const { user } = await toCodes();

      await user.click(screen.getByRole('button', { name: 'Copy codes' }));

      expect(
        screen.getByRole('button', { name: 'Copied' }),
      ).toBeInTheDocument();
      await expect(navigator.clipboard.readText()).resolves.toBe(
        'AAAAA-11111\nBBBBB-22222',
      );
    });

    it('downloads the codes as a text file', async () => {
      const { user } = await toCodes();
      let saved: Blob | undefined;
      URL.createObjectURL = jest.fn((blob: Blob) => {
        saved = blob;
        return 'blob:codes';
      });
      URL.revokeObjectURL = jest.fn();
      const click = jest
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => {});

      await user.click(screen.getByRole('button', { name: 'Download' }));

      const clicked = click.mock.contexts[0];
      expect(clicked?.download).toBe('synapsedesk-backup-codes.txt');
      expect(clicked?.href).toBe('blob:codes');
      await expect(textOf(saved)).resolves.toBe('AAAAA-11111\nBBBBB-22222\n');
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:codes');
      click.mockRestore();
    });
  });
});
