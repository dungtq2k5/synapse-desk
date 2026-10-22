import { EmailTemplateName } from '@synapsedesk/contracts';
import { renderEmail } from './email.templates';

describe('the organization-created email', () => {
  const rendered = renderEmail(
    {
      template: EmailTemplateName.ORGANIZATION_CREATED,
      to: 'ada@acme.test',
      data: {
        fullName: '<Ada>',
        organizationName: 'Acme & Co',
        setPasswordUrl: 'https://app.example.test/reset-password?token=t',
        expiresInDays: 7,
      },
    },
    {
      appName: 'SynapseDesk',
      appWebUrl: 'https://app.example.test',
      supportEmail: 'support@example.test',
    },
  );

  it('says who created what, and links to set the password, in both parts', () => {
    expect(rendered.text).toContain(
      'SynapseDesk created Acme & Co for you. Set your password to sign in',
    );
    expect(rendered.html).toContain(
      'SynapseDesk created <strong>Acme &amp; Co</strong> for you. Set your password to sign in.',
    );
    for (const part of [rendered.html, rendered.text]) {
      expect(part).toContain('https://app.example.test/reset-password?token=t');
      expect(part).toContain('expires in 7 days');
    }
  });

  it('escapes the names in the HTML', () => {
    expect(rendered.html).toContain('&lt;Ada&gt;');
    expect(rendered.html).toContain('Acme &amp; Co');
    expect(rendered.html).not.toContain('<Ada>');
  });
});
