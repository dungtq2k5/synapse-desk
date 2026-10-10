import { EmailTemplateName } from '@synapsedesk/common';
import { renderEmail, type TemplateBranding } from './email.templates';

/**
 * The three billing templates, and the one property each exists for.
 *
 * `renderEmail`'s exhaustive switch already makes a template with no renderer a
 * COMPILE error — that guard is real and it is not this file's job. What it
 * cannot check is whether the rendered text says the thing that makes the
 * message actionable, which is the whole reason these were written separately
 * rather than as one "billing notice".
 */
describe('The billing email templates', () => {
  const branding: TemplateBranding = {
    appName: 'SynapseDesk',
    appWebUrl: 'https://app.example.test',
    supportEmail: 'support@example.test',
  };

  describe('a failed payment', () => {
    const failure = (nextAttempt: string | null) =>
      renderEmail(
        {
          template: EmailTemplateName.PAYMENT_FAILED,
          to: 'admin@acme.test',
          data: {
            fullName: 'Ada',
            nextAttempt,
            reason: 'Your card was declined.',
          },
        },
        branding,
      );

    it('**1. carries the RETRY DATE in the subject, not just "payment failed"**', () => {
      // The field that makes it actionable. "A payment problem" is a subject
      // people archive; a date is one they act on today.
      const rendered = failure('2026-03-14');

      expect(rendered.subject).toContain('2026-03-14');
      expect(rendered.text).toContain('2026-03-14');
    });

    it('**2. says FINAL ATTEMPT when there is no retry — a different email**', () => {
      // The two cases must not collapse: a tenant who cannot tell "we will try
      // again" from "this was the last try" cannot decide whether to act now.
      const rendered = failure(null);

      expect(rendered.subject).toMatch(/final attempt/i);
      expect(rendered.text).toMatch(/suspended/i);
      // And it must not promise a retry it will not make.
      expect(rendered.text).not.toMatch(/will try again/i);
    });

    it("3. passes Stripe's reason through, ESCAPED", () => {
      // Shown because "declined" and "expired" need different things done —
      // and escaped because it is a third party's string in HTML.
      const rendered = renderEmail(
        {
          template: EmailTemplateName.PAYMENT_FAILED,
          to: 'admin@acme.test',
          data: {
            fullName: 'Ada',
            nextAttempt: '2026-03-14',
            reason: '<img onerror="alert(1)">',
          },
        },
        branding,
      );

      expect(rendered.html).toContain('&lt;img');
      expect(rendered.html).not.toContain('<img onerror');
    });
  });

  it('**4. a plan change says "updated", never "you upgraded"**', () => {
    // One apply notifies every tenant on the plan, and most of them did
    // nothing. Wording that implies they acted turns a routine notice into a
    // support ticket.
    const rendered = renderEmail(
      {
        template: EmailTemplateName.PLAN_CHANGED,
        to: 'admin@acme.test',
        data: {
          fullName: 'Ada',
          planName: 'Professional',
          summary: 'Your workspace now includes 25 agent seats.',
        },
      },
      branding,
    );

    expect(rendered.subject).toMatch(/updated/i);
    expect(rendered.text).not.toMatch(/you upgraded|you changed|you switched/i);
    expect(rendered.text).toContain('Professional');
  });

  it('5. a limit alert says what is refused at 100%, not just the percentage', () => {
    // The sentence that makes it actionable, in the same position as the
    // budget alert's — a tenant who gets both should not learn two layouts.
    const rendered = renderEmail(
      {
        template: EmailTemplateName.LIMIT_ALERT,
        to: 'admin@acme.test',
        data: {
          fullName: 'Ada',
          headline: 'Document storage 80% used',
          detail: 'At 100%, new uploads are refused.',
        },
      },
      branding,
    );

    expect(rendered.subject).toContain('80%');
    expect(rendered.text).toContain('At 100%, new uploads are refused.');
  });

  it('6. every billing template escapes the name it was handed', () => {
    // `fullName` comes from a registration form. Email HTML is still HTML.
    for (const rendered of [
      failureFor('<script>x</script>'),
      renderEmail(
        {
          template: EmailTemplateName.PLAN_CHANGED,
          to: 'a@b.test',
          data: {
            fullName: '<script>x</script>',
            planName: 'Pro',
            summary: 'ok',
          },
        },
        branding,
      ),
      renderEmail(
        {
          template: EmailTemplateName.LIMIT_ALERT,
          to: 'a@b.test',
          data: {
            fullName: '<script>x</script>',
            headline: 'h',
            detail: 'd',
          },
        },
        branding,
      ),
    ]) {
      expect(rendered.html).not.toContain('<script>');
      expect(rendered.html).toContain('&lt;script&gt;');
    }
  });

  function failureFor(fullName: string) {
    return renderEmail(
      {
        template: EmailTemplateName.PAYMENT_FAILED,
        to: 'a@b.test',
        data: { fullName, nextAttempt: '2026-03-14', reason: 'declined' },
      },
      branding,
    );
  }
});
