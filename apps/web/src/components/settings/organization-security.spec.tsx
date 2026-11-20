import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fail, ok, stubApi } from '@/test/api';
import {
  ORGANIZATION,
  SETTINGS,
  renderSettings,
  stubMatchMedia,
  viewer,
} from '@/test/settings';
import { SecurityCard, UploadLimitsCard } from './organization-security';

beforeAll(stubMatchMedia);

const ADMIN = ['organization.read', 'organization.update'];
const MB = 1024 * 1024;

describe('Security', () => {
  const domains = () => screen.getByPlaceholderText('Add a domain');

  it('adds a domain on Enter or a comma, refuses one that isn’t, and Backspace takes the last back', async () => {
    stubApi(viewer(ADMIN));
    renderSettings(
      <SecurityCard organization={ORGANIZATION} settings={SETTINGS} />,
    );
    await screen.findByPlaceholderText('Add a domain');
    await userEvent.type(domains(), 'Acme.org{Enter}');
    expect(
      screen.getByRole('button', { name: 'Remove acme.org' }),
    ).toBeInTheDocument();
    await userEvent.type(domains(), 'beta.test,');
    expect(
      screen.getByRole('button', { name: 'Remove beta.test' }),
    ).toBeInTheDocument();
    // Again: nothing doubles.
    await userEvent.type(domains(), 'beta.test{Enter}');
    expect(
      screen.getAllByRole('button', { name: 'Remove beta.test' }),
    ).toHaveLength(1);

    await userEvent.type(domains(), 'not a domain{Enter}');
    expect(
      screen.getByText('“not a domain” isn’t a valid domain.'),
    ).toBeInTheDocument();
    expect(domains()).toHaveAttribute('aria-invalid', 'true');

    await userEvent.clear(domains());
    await userEvent.type(domains(), '{Backspace}');
    expect(
      screen.queryByRole('button', { name: 'Remove beta.test' }),
    ).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole('button', { name: 'Remove acme.org' }),
    );
    expect(
      screen.queryByRole('button', { name: 'Remove acme.org' }),
    ).not.toBeInTheDocument();
  });

  it('saves the domains, and shows the server’s warning for a public one', async () => {
    const calls = stubApi({
      ...viewer(ADMIN),
      'PATCH /api/v1/organizations/current/settings': ok({
        ...SETTINGS,
        allowedEmailDomains: ['acme.test', 'gmail.com'],
        publicDomainWarnings: ['gmail.com'],
      }),
      'GET /api/v1/organizations/current/settings': ok(SETTINGS),
      'GET /api/v1/organizations/current': ok(ORGANIZATION),
    });
    renderSettings(
      <SecurityCard organization={ORGANIZATION} settings={SETTINGS} />,
    );
    await screen.findByPlaceholderText('Add a domain');
    await userEvent.type(domains(), 'gmail.com{Enter}');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText(/gmail\.com is a public email domain/),
    ).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      allowedEmailDomains: ['acme.test', 'gmail.com'],
    });
  });

  it('asks before requiring two-step, then sends it; a failed save says so', async () => {
    const calls = stubApi({
      ...viewer(ADMIN),
      'PATCH /api/v1/organizations/current/settings': fail(500, 'Down!'),
    });
    renderSettings(
      <SecurityCard organization={ORGANIZATION} settings={SETTINGS} />,
    );
    await userEvent.click(
      screen.getByRole('switch', {
        name: 'Require two-step verification for everyone',
      }),
    );
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Require it' }),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText('Couldn’t save security settings'),
    ).toBeInTheDocument();
    expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
      enforceTwoFactor: true,
      allowedEmailDomains: ['acme.test'],
    });
  });

  it('turning two-step off needs no question', async () => {
    stubApi(viewer(ADMIN));
    renderSettings(
      <SecurityCard
        organization={ORGANIZATION}
        settings={{ ...SETTINGS, enforceTwoFactor: true }}
      />,
    );
    const toggle = screen.getByRole('switch', {
      name: 'Require two-step verification for everyone',
    });
    await userEvent.click(toggle);
    expect(toggle).not.toBeChecked();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('is read-only without organization.update', async () => {
    stubApi(viewer(['organization.read']));
    renderSettings(
      <SecurityCard organization={ORGANIZATION} settings={SETTINGS} />,
    );
    await waitFor(() =>
      expect(
        screen.queryByPlaceholderText('Add a domain'),
      ).not.toBeInTheDocument(),
    );
    expect(
      screen.queryByRole('button', { name: 'Remove acme.test' }),
    ).not.toBeInTheDocument();
  });
});

describe('Upload limits', () => {
  const field = (name: string) => screen.getByLabelText(name);

  it('refuses what isn’t a whole number within the product’s limit', async () => {
    const calls = stubApi(viewer(ADMIN));
    renderSettings(
      <UploadLimitsCard organization={ORGANIZATION} settings={SETTINGS} />,
    );
    await userEvent.type(field('Largest document'), '500');
    await userEvent.type(field('Attachments per message'), '2.5');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(screen.getByText('Choose 100 MB or less.')).toBeInTheDocument();
    expect(screen.getByText('Choose 5 or less.')).toBeInTheDocument();
    expect(calls.filter((call) => call.method === 'PATCH')).toHaveLength(0);
  });

  it('sends megabytes as bytes, an emptied field as null, and an unchanged one not at all', async () => {
    const calls = stubApi({
      ...viewer(ADMIN),
      'PATCH /api/v1/organizations/current/settings': ok(SETTINGS),
      'GET /api/v1/organizations/current/settings': ok(SETTINGS),
      'GET /api/v1/organizations/current': ok(ORGANIZATION),
    });
    renderSettings(
      <UploadLimitsCard
        organization={ORGANIZATION}
        settings={{
          ...SETTINGS,
          maxAttachmentBytesOverride: 10 * MB,
          maxAttachmentsPerMessageOverride: 3,
        }}
      />,
    );
    await userEvent.type(field('Largest document'), '25');
    await userEvent.clear(field('Largest attachment'));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() =>
      expect(calls.find((call) => call.method === 'PATCH')?.body).toEqual({
        maxDocumentBytesOverride: 25 * MB,
        maxAttachmentBytesOverride: null,
      }),
    );
  });

  it('says when saving failed', async () => {
    stubApi({
      ...viewer(ADMIN),
      'PATCH /api/v1/organizations/current/settings': fail(500, 'Down!'),
    });
    renderSettings(
      <UploadLimitsCard organization={ORGANIZATION} settings={SETTINGS} />,
    );
    await userEvent.type(field('Attachments per message'), '2');
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(
      await screen.findByText('Couldn’t save upload limits'),
    ).toBeInTheDocument();
  });
});
