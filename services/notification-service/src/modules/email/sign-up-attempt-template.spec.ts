import { EmailTemplateName } from '@synapsedesk/contracts';
import { renderEmail } from './email.templates';

describe('the sign-up attempt email', () => {
  const rendered = renderEmail(
    {
      template: EmailTemplateName.SIGN_UP_ATTEMPT,
      to: 'ada@acme.test',
      data: {
        fullName: '<Ada>',
        origin: { ip: '203.0.113.7', userAgent: 'Firefox' },
      },
    },
    {
      appName: 'SynapseDesk',
      appWebUrl: 'https://app.example.test',
      supportEmail: 'support@example.test',
    },
  );

  it('links to sign in and to reset the password, in both parts', () => {
    for (const part of [rendered.html, rendered.text]) {
      expect(part).toContain('https://app.example.test/login');
      expect(part).toContain('https://app.example.test/forgot-password');
    }
  });

  it('says where the attempt came from, and escapes the name', () => {
    expect(rendered.html).toContain('203.0.113.7');
    expect(rendered.html).toContain('&lt;Ada&gt;');
    expect(rendered.html).not.toContain('<Ada>');
  });
});
