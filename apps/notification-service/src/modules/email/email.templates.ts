import {
  EmailTemplateName,
  NotificationOrigin,
  SendEmailCommand,
} from '@synapsedesk/common';

/** Everything a template needs that comes from config rather than the event. */
export type TemplateBranding = {
  appName: string;
  appWebUrl: string;
  supportEmail: string;
};

export type RenderedEmail = {
  subject: string;
  html: string;
  /** Plain-text alternative. Some clients render it, and spam filters weigh
   * multipart messages more kindly than HTML-only ones. */
  text: string;
};

/**
 * Templates as functions rather than .hbs files on purpose: a templating engine
 * would need its files copied into `dist` via nest-cli assets config, and a
 * missing asset only fails at send time in production. These fail at compile
 * time instead, and the discriminated `SendEmailCommand` means each renderer can
 * only reach the variables its own template actually has.
 */
export function renderEmail(
  command: SendEmailCommand,
  branding: TemplateBranding,
): RenderedEmail {
  switch (command.template) {
    case EmailTemplateName.WELCOME:
      return welcome(command.data, branding);
    case EmailTemplateName.EMAIL_VERIFICATION:
      return emailVerification(command.data, branding);
    case EmailTemplateName.PASSWORD_RESET:
      return passwordReset(command.data, branding);
    case EmailTemplateName.PASSWORD_CHANGED:
      return passwordChanged(command.data, branding);
    case EmailTemplateName.INVITATION:
      return invitation(command.data, branding);
    case EmailTemplateName.SECURITY_ALERT:
      return securityAlert(command.data, branding);
    case EmailTemplateName.INBOUND_REJECTED:
      return inboundRejected(command.data, branding);
    case EmailTemplateName.QUOTA_ALERT:
      return quotaAlert(command.data, branding);
  }
}

/**
 * Escapes user-controlled values before interpolation.
 *
 * `fullName` comes straight from a registration form, so without this a name of
 * `<img onerror=...>` becomes live markup in whatever webmail renders the
 * message. Email HTML is still HTML.
 */
function esc(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/**
 * Inline styles and a table-free single column: Outlook ignores `<style>` blocks
 * and most clients strip external CSS, so anything not inlined simply does not
 * apply.
 */
function layout(
  branding: TemplateBranding,
  heading: string,
  bodyHtml: string,
): string {
  return `<div style="margin:0;padding:24px;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(16,24,40,.1);">
    <div style="padding:20px 28px;background:#111827;color:#ffffff;font-size:18px;font-weight:600;">
      ${esc(branding.appName)}
    </div>
    <div style="padding:28px;color:#111827;font-size:15px;line-height:1.6;">
      <h1 style="margin:0 0 16px;font-size:20px;font-weight:600;color:#111827;">${esc(heading)}</h1>
      ${bodyHtml}
    </div>
    <div style="padding:18px 28px;background:#f9fafb;color:#6b7280;font-size:12px;line-height:1.5;">
      Need help? Contact
      <a href="mailto:${esc(branding.supportEmail)}" style="color:#2563eb;text-decoration:none;">${esc(branding.supportEmail)}</a>.
      <br />This is an automated message — please do not reply directly.
    </div>
  </div>
</div>`;
}

function button(url: string, label: string): string {
  return `<p style="margin:24px 0;">
  <a href="${esc(url)}" style="display:inline-block;padding:12px 22px;background:#2563eb;color:#ffffff;font-weight:600;font-size:15px;border-radius:8px;text-decoration:none;">${esc(label)}</a>
</p>
<p style="margin:0 0 8px;color:#6b7280;font-size:13px;">If the button does not work, paste this into your browser:</p>
<p style="margin:0;word-break:break-all;font-size:13px;"><a href="${esc(url)}" style="color:#2563eb;">${esc(url)}</a></p>`;
}

function codeBlock(code: string): string {
  return `<p style="margin:24px 0;font-size:30px;font-weight:700;letter-spacing:6px;color:#111827;">${esc(code)}</p>`;
}

/** The "if this wasn't you" footer that makes security mail actionable. */
function originNotice(
  origin: NotificationOrigin,
  branding: TemplateBranding,
  action: string,
): string {
  return `<div style="margin-top:28px;padding:14px 16px;background:#fef2f2;border-left:3px solid #dc2626;border-radius:6px;">
  <p style="margin:0 0 6px;font-weight:600;color:#991b1b;font-size:14px;">Wasn't you?</p>
  <p style="margin:0;color:#7f1d1d;font-size:13px;line-height:1.5;">
    This ${esc(action)} came from <strong>${esc(origin.userAgent || 'an unknown device')}</strong>
    at IP <strong>${esc(origin.ip || 'unknown')}</strong>.
    If you did not do this, change your password immediately and contact
    <a href="mailto:${esc(branding.supportEmail)}" style="color:#991b1b;">${esc(branding.supportEmail)}</a>.
  </p>
</div>`;
}

function textOrigin(origin: NotificationOrigin, action: string): string {
  return `\n\nWasn't you? This ${action} came from ${origin.userAgent || 'an unknown device'} at IP ${origin.ip || 'unknown'}. If you did not do this, change your password immediately.`;
}

type Data<T extends EmailTemplateName> = Extract<
  SendEmailCommand,
  { template: T }
>['data'];

function welcome(
  data: Data<EmailTemplateName.WELCOME>,
  branding: TemplateBranding,
): RenderedEmail {
  const workspace = data.organizationName
    ? `the <strong>${esc(data.organizationName)}</strong> workspace`
    : 'your new workspace';

  return {
    subject: `Welcome to ${branding.appName}`,
    html: layout(
      branding,
      `Welcome, ${data.fullName}`,
      `<p style="margin:0 0 12px;">Your ${branding.appName} account is ready. You have been added to ${workspace}.</p>
       <p style="margin:0;">Verify your email address to unlock everything — we will send a code the first time you need it.</p>
       ${button(branding.appWebUrl, 'Open ' + branding.appName)}
       ${originNotice(data.origin, branding, 'registration')}`,
    ),
    text:
      `Welcome, ${data.fullName}.\n\nYour ${branding.appName} account is ready.\n${branding.appWebUrl}` +
      textOrigin(data.origin, 'registration'),
  };
}

function emailVerification(
  data: Data<EmailTemplateName.EMAIL_VERIFICATION>,
  branding: TemplateBranding,
): RenderedEmail {
  return {
    subject: `Your ${branding.appName} verification code`,
    html: layout(
      branding,
      'Verify your email address',
      `<p style="margin:0 0 4px;">Hi ${esc(data.fullName)}, enter this code to confirm your email address:</p>
       ${codeBlock(data.code)}
       <p style="margin:0;color:#6b7280;font-size:13px;">It expires in ${data.expiresInMinutes} minutes. If you did not request it, you can ignore this email.</p>`,
    ),
    text: `Hi ${data.fullName}, your ${branding.appName} verification code is ${data.code}. It expires in ${data.expiresInMinutes} minutes.`,
  };
}

function passwordReset(
  data: Data<EmailTemplateName.PASSWORD_RESET>,
  branding: TemplateBranding,
): RenderedEmail {
  // One address may hold accounts in several tenants, so this is a LIST. A
  // single-tenant user gets one entry and the message reads exactly as before;
  // the alternative — one email per account — arrives as near-identical
  // messages the recipient cannot tell apart.
  const multi = data.links.length > 1;

  const linksHtml = data.links
    .map((link) =>
      multi
        ? `<p style="margin:18px 0 6px;font-weight:600;">${esc(link.organizationName)}</p>${button(link.url, 'Choose a new password')}`
        : button(link.url, 'Choose a new password'),
    )
    .join('');

  const intro = multi
    ? `Hi ${esc(data.fullName)}, this address is used by ${data.links.length} workspaces. Choose the one you want to reset — each link works once and expires in ${data.expiresInMinutes} minutes.`
    : `Hi ${esc(data.fullName)}, use the link below to choose a new password. It expires in ${data.expiresInMinutes} minutes and can be used once.`;

  return {
    subject: `Reset your ${branding.appName} password`,
    html: layout(
      branding,
      'Reset your password',
      `<p style="margin:0 0 4px;">${intro}</p>
       ${linksHtml}
       ${originNotice(data.origin, branding, 'password reset request')}`,
    ),
    text:
      `Hi ${data.fullName}, reset your ${branding.appName} password:\n` +
      data.links
        .map((link) => `${link.organizationName}: ${link.url}`)
        .join('\n') +
      `\n\nEach link expires in ${data.expiresInMinutes} minutes and is single use.` +
      textOrigin(data.origin, 'password reset request'),
  };
}

function invitation(
  data: Data<EmailTemplateName.INVITATION>,
  branding: TemplateBranding,
): RenderedEmail {
  const roles = data.roleNames.length
    ? ` as ${data.roleNames.map(esc).join(', ')}`
    : '';

  return {
    subject: `${data.inviterName} invited you to ${data.organizationName} on ${branding.appName}`,
    html: layout(
      branding,
      `Join ${esc(data.organizationName)}`,
      // The inviter's name leads, deliberately: an invitation from an
      // unfamiliar domain is indistinguishable from phishing without it.
      `<p style="margin:0 0 12px;"><strong>${esc(data.inviterName)}</strong> has invited you to join
       <strong>${esc(data.organizationName)}</strong> on ${esc(branding.appName)}${roles}.</p>
       <p style="margin:0;">Accepting creates your account and signs you in — there is no separate registration step.</p>
       ${button(data.acceptUrl, 'Accept invitation')}
       <p style="margin:16px 0 0;color:#6b7280;font-size:13px;">This invitation expires on ${esc(data.expiresAt)}. If you were not expecting it, you can ignore this email — nothing happens until you accept.</p>`,
    ),
    text:
      `${data.inviterName} invited you to join ${data.organizationName} on ${branding.appName}${roles}.\n` +
      `${data.acceptUrl}\n\nExpires ${data.expiresAt}.`,
  };
}

function passwordChanged(
  data: Data<EmailTemplateName.PASSWORD_CHANGED>,
  branding: TemplateBranding,
): RenderedEmail {
  return {
    subject: `Your ${branding.appName} password was changed`,
    html: layout(
      branding,
      'Your password was changed',
      `<p style="margin:0 0 12px;">Hi ${esc(data.fullName)}, your password has been updated.</p>
       <p style="margin:0;">For your safety we signed you out of <strong>${data.revokedSessionCount}</strong> device(s). You will need to sign in again.</p>
       ${originNotice(data.origin, branding, 'password change')}`,
    ),
    text:
      `Hi ${data.fullName}, your ${branding.appName} password was changed and ${data.revokedSessionCount} device(s) were signed out.` +
      textOrigin(data.origin, 'password change'),
  };
}

function securityAlert(
  data: Data<EmailTemplateName.SECURITY_ALERT>,
  branding: TemplateBranding,
): RenderedEmail {
  return {
    subject: `${branding.appName} security alert: ${data.headline}`,
    html: layout(
      branding,
      data.headline,
      `<p style="margin:0 0 12px;">Hi ${esc(data.fullName)},</p>
       <p style="margin:0;">${esc(data.detail)}</p>
       ${originNotice(data.origin, branding, 'action')}`,
    ),
    text:
      `Hi ${data.fullName}, ${data.detail}` + textOrigin(data.origin, 'action'),
  };
}

/**
 * The one-time reply to mail this system refused
 *
 * **Says what to do, and does not say why in detail.** "Your address is not
 * permitted in this workspace" tells an outsider which tenants exist and who
 * belongs to them; "we could not accept this message, please use the portal"
 * tells the actual sender everything they can act on. The difference is an
 * enumeration oracle at a public address.
 */
function inboundRejected(
  data: Data<EmailTemplateName.INBOUND_REJECTED>,
  branding: TemplateBranding,
): RenderedEmail {
  const headline = 'We could not accept your email';
  const body =
    'Your message did not reach our support team. Please open a request ' +
    'through the portal instead, and we will pick it up from there.';

  return {
    subject: `${branding.appName}: ${headline}`,
    html: layout(
      branding,
      headline,
      `<p style="margin:0 0 12px;">${esc(body)}</p>
       <p style="margin:0;"><a href="${esc(data.portalUrl)}">${esc(data.portalUrl)}</a></p>`,
    ),
    text: `${headline}\n\n${body}\n\n${data.portalUrl}`,
  };
}

/**
 * A budget threshold crossing.
 *
 * Deliberately plain — the value is entirely in `detail`, which the producer
 * writes to say what happens at 100% rather than merely which percentage was
 * crossed. Decorating it would bury the one sentence that makes it actionable.
 */
function quotaAlert(
  data: Data<EmailTemplateName.QUOTA_ALERT>,
  branding: TemplateBranding,
): RenderedEmail {
  return {
    subject: `${branding.appName}: ${data.headline}`,
    html: layout(
      branding,
      data.headline,
      `<p style="margin:0 0 12px;">Hi ${esc(data.fullName)},</p>
       <p style="margin:0;">${esc(data.detail)}</p>`,
    ),
    text: `${data.headline}\n\nHi ${data.fullName},\n\n${data.detail}`,
  };
}
