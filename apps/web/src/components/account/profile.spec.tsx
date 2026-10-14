import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserResponseDto } from '@synapsedesk/api-client';
import { fail, ok, stubApi, type Reply } from '@/test/api';
import '@/test/dom';
import { PhoneDialog } from './phone-dialog';
import { ProfileForm } from './profile-form';
import { ProfilePhoto } from './profile-photo';

const push = jest.fn();
jest.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
jest.mock('sonner', () => ({ toast: { success: jest.fn() } }));

const USER = {
  id: 'u1',
  fullName: 'Maya Chen',
  email: 'maya@northwind.health',
  isEmailVerified: true,
  phoneNumber: null,
  isPhoneVerified: false,
  avatarUrl: null,
  dob: '1990-03-14',
  gender: 'FEMALE',
} as unknown as UserResponseDto;

const PATCH = 'PATCH /api/v1/users/me';

function wrap(node: React.ReactNode, routes: Record<string, Reply> = {}) {
  const calls = stubApi(routes);
  render(
    <QueryClientProvider client={new QueryClient()}>
      {node}
    </QueryClientProvider>,
  );
  return { calls, user: userEvent.setup() };
}

describe('the profile form', () => {
  it('saves only once something changed, and says where it is', async () => {
    const { calls, user } = wrap(<ProfileForm user={USER} />, {
      [PATCH]: ok({ ...USER, fullName: 'Maya L. Chen' }),
    });
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled();

    await user.clear(screen.getByLabelText('Full name'));
    await user.type(screen.getByLabelText('Full name'), 'Maya L. Chen');
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();

    await user.click(save);

    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(calls[0].body).toEqual({
      fullName: 'Maya L. Chen',
      dob: '1990-03-14',
      gender: 'FEMALE',
    });
  });

  it('keeps the changes when saving fails', async () => {
    const { user } = wrap(<ProfileForm user={USER} />, {
      [PATCH]: fail(500, 'Internal server error!'),
    });

    await user.type(screen.getByLabelText('Full name'), 'x');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(
      await screen.findByText('Couldn’t save your profile'),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Full name')).toHaveValue('Maya Chenx');
  });

  it('says how to write a date it can’t read', async () => {
    const { calls, user } = wrap(<ProfileForm user={USER} />);

    await user.clear(screen.getByLabelText('Date of birth'));
    await user.type(screen.getByLabelText('Date of birth'), '02/30/1990');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(
      screen.getByText('Enter a date like 03/14/1990.'),
    ).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('asks before leaving with unsaved changes, and stays when told', async () => {
    const { user } = wrap(
      <>
        <a href="/tickets">Tickets</a>
        <ProfileForm user={USER} />
      </>,
    );

    await user.type(screen.getByLabelText('Full name'), 'x');
    await user.click(screen.getByRole('link', { name: 'Tickets' }));

    expect(
      await screen.findByRole('alertdialog', {
        name: 'Discard unsaved changes?',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep editing' })).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(push).toHaveBeenCalledWith('/tickets');
  });

  it('marks an unverified email, and links to verifying it', () => {
    wrap(<ProfileForm user={{ ...USER, isEmailVerified: false }} />);

    expect(screen.getByText('Not verified')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Verify email' })).toHaveAttribute(
      'href',
      '/verify-email?next=%2Fprofile',
    );
  });
});

describe('the profile photo', () => {
  const choose = async (
    user: ReturnType<typeof userEvent.setup>,
    file: File,
  ) => {
    const input = document.querySelector<HTMLInputElement>('input[type=file]')!;
    await user.upload(input, file);
  };

  it('refuses a photo over 2 MB before uploading anything', async () => {
    const { calls, user } = wrap(<ProfilePhoto user={USER} />);

    await choose(
      user,
      new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', {
        type: 'image/png',
      }),
    );

    expect(screen.getByText('That photo is too large')).toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('removes the photo when asked', async () => {
    const { calls, user } = wrap(
      <ProfilePhoto user={{ ...USER, avatarUrl: 'http://img/a.png' }} />,
      { 'DELETE /api/v1/users/me/avatar': ok(USER) },
    );

    await user.click(screen.getByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(calls[0].method).toBe('DELETE'));
  });
});

describe('the phone dialog', () => {
  it('asks for the country code, then sends the code to the number', async () => {
    const { calls, user } = wrap(
      <PhoneDialog open onOpenChange={() => undefined} current={null} />,
      {
        'POST /api/v1/auth/phone/verify/request': ok(
          { target: '+44******1234', expiresInMinutes: 10, codeLength: 6 },
          202,
        ),
      },
    );

    await user.type(screen.getByLabelText('Phone number'), '07700 900123');
    await user.click(screen.getByRole('button', { name: 'Send code' }));
    expect(
      screen.getByText('Enter the number with its country code, like +1.'),
    ).toBeInTheDocument();
    expect(calls).toEqual([]);

    await user.clear(screen.getByLabelText('Phone number'));
    await user.type(screen.getByLabelText('Phone number'), '+44 7700 901234');
    await user.click(screen.getByRole('button', { name: 'Send code' }));

    expect(
      await screen.findByRole('heading', { name: 'Enter the code' }),
    ).toBeInTheDocument();
    expect(calls[0].body).toEqual({ phoneNumber: '+447700901234' });
  });
});
