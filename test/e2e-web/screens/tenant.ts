import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  request as newRequest,
  type APIRequestContext,
  type Page,
} from '@playwright/test';
import { PrismaClient as AuthPrisma } from '../../../services/auth-service/src/generated/prisma/client';
import { PrismaClient as TicketPrisma } from '../../../services/ticket-service/src/generated/prisma/client';
import { REPO_ROOT } from '../../system/services';
import { WEB_URL } from '../ingress';
import { api, clearThrottles, DEMO_PASSWORD } from '../support';

/**
 * A tenant the screen rows draw: the same people, names and tickets on every
 * run, so a baseline changes only when the screen does. What still varies
 * (ids, emails, ticket numbers, times) is masked by `look()`.
 *
 * Built through the gateway as people would make it: Maya Chen founds
 * "Northwind Health", Priya Shah joins as a member, Jordan Lee joins and is
 * made a Support Agent. Maya works in Workplace and Facilities, Jordan in
 * Workplace. Tickets are raised on Priya's behalf. The AI's
 * answers and an attachment are written to ticket-service's database
 * directly: the AI needs a model, and an upload needs object storage.
 *
 * `tenant(name)` builds one per name and per run, so a row that changes its
 * tenant (a reply, a new ticket) has its own and the rest stay as drawn.
 */
export type Person = { id: string; email: string; fullName: string };
export type Tenant = {
  maya: Person;
  jordan: Person;
  priya: Person;
  departmentId: string;
  facilitiesId: string;
  tickets: Record<TicketKey, string>;
};
type TicketKey = keyof typeof TICKETS;

const run = Date.now();
const built = new Map<string, Promise<Tenant>>();

export function tenant(name: string): Promise<Tenant> {
  let tenantPromise = built.get(name);
  if (!tenantPromise) {
    tenantPromise = build(`${name}-${run}`);
    built.set(name, tenantPromise);
  }
  return tenantPromise;
}

/**
 * An API session signed in as `person`, on this machine. (The browser runs in
 * a container, where a context's own `request` can't reach the ingress.)
 */
export async function sessionAs(person: Person): Promise<APIRequestContext> {
  await clearThrottles();
  const session = await newRequest.newContext({ baseURL: WEB_URL });
  await api(session, 'POST', '/auth/login', {
    email: person.email,
    password: DEMO_PASSWORD,
  });
  return session;
}

/** Signs the page's context in as `person`, through the same cookies. */
export async function signInAs(page: Page, person: Person): Promise<void> {
  const session = await sessionAs(person);
  await page.context().addCookies((await session.storageState()).cookies);
  await session.dispose();
}

/**
 * The tickets, oldest first, so the list (newest activity first) reads them
 * bottom up. `desk` carries the full thread.
 */
const TICKETS = {
  printer: {
    title: 'Printer on floor 3 is jammed',
    description: 'It shows a paper jam, but the tray is empty.',
    priority: 'LOW',
    finally: 'CLOSED',
  },
  billing: {
    title: 'Update my billing address',
    description: 'We moved offices last month.',
    priority: 'LOW',
    finally: 'RESOLVED',
  },
  vpn: {
    title: 'VPN drops every hour',
    description: 'The connection resets on the hour, every hour.',
    priority: 'URGENT',
    finally: 'ESCALATED',
  },
  laptop: {
    title: 'Laptop won’t charge',
    description: 'The light on the charger is on, but the battery stays at 3%.',
    priority: 'HIGH',
    finally: 'OPEN',
  },
  mobile: {
    title: 'Can’t sign in on mobile',
    description: 'The app says my session has expired every time.',
    priority: 'MEDIUM',
    finally: null,
  },
  desk: {
    title: 'Allowance for a standing desk',
    description:
      'Is a standing desk covered by the home-office allowance? The one I want is €450.',
    priority: 'MEDIUM',
    finally: 'OPEN',
  },
} as const;

async function build(slug: string): Promise<Tenant> {
  const domain = `${slug}.example.test`;

  const mayaSession = await register(`maya@${domain}`, 'Maya Chen');
  await api(mayaSession, 'PATCH', '/organizations/current', {
    name: 'Northwind Health',
  });
  await api(mayaSession, 'PATCH', '/organizations/current/settings', {
    allowedEmailDomains: [domain],
  });
  const priyaSession = await register(`priya@${domain}`, 'Priya Shah');
  const jordanSession = await register(`jordan@${domain}`, 'Jordan Lee');

  const maya = await me(mayaSession);
  const priya = await me(priyaSession);
  const jordan = await me(jordanSession);
  // Verified, as a team at work would be: a code can't be read back from the
  // database, and the verify-email banner is drawn by the row that needs it.
  await setEmailVerified([maya, priya, jordan], true);

  const { items: roles } = await api<{ items: { id: string; name: string }[] }>(
    mayaSession,
    'GET',
    '/roles?limit=50&includeSystem=true',
  );
  const agentRole = roles.find(
    (role) => role.name === 'Support Agent (Tier 2)',
  );
  if (!agentRole) throw new Error('No Support Agent role');
  await api(mayaSession, 'PUT', `/users/${jordan.id}/roles`, {
    roleIds: [agentRole.id],
  });
  const { id: departmentId } = await api<{ id: string }>(
    mayaSession,
    'POST',
    '/departments',
    { name: 'Workplace' },
  );
  const { id: facilitiesId } = await api<{ id: string }>(
    mayaSession,
    'POST',
    '/departments',
    { name: 'Facilities' },
  );
  // Maya works in both, Jordan in Workplace: "Assign to me" asks which, and
  // the Assign dialog has people to list.
  await api(mayaSession, 'POST', `/departments/${departmentId}/members`, {
    userIds: [maya.id, jordan.id],
  });
  await api(mayaSession, 'POST', `/departments/${facilitiesId}/members`, {
    userIds: [maya.id],
  });
  // Set up, as a team at work would be: the setup checklist is drawn by the
  // rows that need it.
  await api(mayaSession, 'POST', '/organizations/current/onboarding/complete');

  const tickets = {} as Record<TicketKey, string>;
  for (const [key, spec] of Object.entries(TICKETS) as [
    TicketKey,
    (typeof TICKETS)[TicketKey],
  ][]) {
    const { id } = await api<{ id: string }>(mayaSession, 'POST', '/tickets', {
      title: spec.title,
      description: spec.description,
      priority: spec.priority,
      authorId: priya.id,
    });
    tickets[key] = id;
    if (key === 'laptop') {
      await api(mayaSession, 'POST', `/tickets/${id}/assign`, {
        assigneeId: jordan.id,
        departmentId,
      });
    } else if (spec.finally !== null) {
      await api(mayaSession, 'POST', `/tickets/${id}/assign/self`, {
        departmentId,
      });
    }
    // NEW → OPEN first, then each final status by its own route.
    if (spec.finally !== null) {
      await api(mayaSession, 'POST', `/tickets/${id}/status`, {
        status: 'OPEN',
        reason: 'Screens fixture',
      });
    }
    if (spec.finally === 'ESCALATED') {
      await api(mayaSession, 'POST', `/tickets/${id}/escalate`, {
        reason: 'Screens fixture',
      });
    }
    if (spec.finally === 'RESOLVED' || spec.finally === 'CLOSED') {
      await api(mayaSession, 'POST', `/tickets/${id}/resolve`, {
        reason: 'Screens fixture',
      });
    }
    if (spec.finally === 'CLOSED') {
      await api(mayaSession, 'POST', `/tickets/${id}/close`, {
        reason: 'Screens fixture',
      });
    }
  }

  await thread(mayaSession, priyaSession, tickets.desk);

  for (const session of [mayaSession, priyaSession, jordanSession]) {
    await session.dispose();
  }
  return { maya, jordan, priya, departmentId, facilitiesId, tickets };
}

/** Every kind of entry, in the order a reader meets them. */
async function thread(
  agent: APIRequestContext,
  requester: APIRequestContext,
  ticketId: string,
): Promise<void> {
  const post = async (
    session: APIRequestContext,
    content: string,
    note = false,
  ) =>
    (
      await api<{ message: { id: string } }>(
        session,
        'POST',
        `/tickets/${ticketId}/messages`,
        { content, isInternalNote: note, invokeAi: false },
      )
    ).message;

  const reply = await post(
    agent,
    'Thanks, Priya. Let me check the allowance policy for you.',
  );
  await api(agent, 'PATCH', `/tickets/${ticketId}/messages/${reply.id}`, {
    content:
      'Thanks, Priya. Let me check the home-office allowance policy for you.',
  });
  await post(agent, 'Finance confirmed desks are in scope this year.', true);
  const removed = await post(requester, 'Wrong ticket, sorry.');
  await api(agent, 'DELETE', `/tickets/${ticketId}/messages/${removed.id}`);
  const quote = await post(requester, 'Here’s the quote from the shop.');

  await ai(ticketId, quote.id);
  await backdate(ticketId);
}

/**
 * Moves the ticket an hour back (its creation, thread and history together,
 * so their order holds), past the 15-minute edit window: what a baseline
 * draws can't depend on how long ago the run started. A row that draws Edit
 * posts its own message.
 */
async function backdate(ticketId: string): Promise<void> {
  const earlier = (at: Date) => new Date(at.getTime() - 60 * 60 * 1000);
  const prisma = ticketPrisma();
  try {
    const ticket = await prisma.ticket.findUniqueOrThrow({
      where: { id: ticketId },
      select: { createdAt: true },
    });
    await prisma.ticket.update({
      where: { id: ticketId },
      data: { createdAt: earlier(ticket.createdAt) },
    });
    for (const { id, createdAt } of await prisma.ticketMessage.findMany({
      where: { ticketId },
    })) {
      await prisma.ticketMessage.update({
        where: { id },
        data: { createdAt: earlier(createdAt) },
      });
    }
    for (const { id, changedAt } of await prisma.ticketStatusChange.findMany({
      where: { ticketId },
    })) {
      await prisma.ticketStatusChange.update({
        where: { id },
        data: { changedAt: earlier(changedAt) },
      });
    }
    for (const row of await prisma.ticketAssignment.findMany({
      where: { ticketId },
    })) {
      await prisma.ticketAssignment.update({
        where: { id: row.id },
        data: {
          assignedAt: earlier(row.assignedAt),
          createdAt: earlier(row.createdAt),
          unassignedAt: row.unassignedAt && earlier(row.unassignedAt),
        },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}

/** The AI's answers in each status, and an attachment, straight to the database. */
async function ai(ticketId: string, attachTo: string): Promise<void> {
  const prisma = ticketPrisma();
  try {
    await prisma.messageAttachment.create({
      data: {
        messageId: attachTo,
        fileName: 'standing-desk-quote.pdf',
        fileUrl: `tickets/${ticketId}/standing-desk-quote.pdf`,
        fileSizeBytes: 182_400n,
        mimeType: 'application/pdf',
      },
    });
    const answers: [string, string, unknown?][] = [
      [
        'GREETING',
        'Hello! I’m the SynapseDesk assistant. I can help with policies and how-tos.',
      ],
      [
        'DOC_ANSWER',
        'Yes. The home-office allowance covers desks and chairs up to €500 a year.',
        [
          {
            documentId: '00000000-0000-4000-8000-00000000d0c1',
            documentTitle: 'Home-office allowance policy',
            pageNumber: 2,
            chunkId: 'c1',
            vectorPointId: 'v1',
          },
        ],
      ],
      ['DOC_MISSING', 'I couldn’t find that in our documents.'],
      ['REFUSED', 'I can’t help with that request.'],
      // No AT_CAP: an answer at the limit is never stored (the page shows a
      // notice from the stream's `done` frame instead).
    ];
    // A second apart, so the thread's order never rests on a tie.
    const start = Date.now();
    for (const [
      index,
      [answerStatus, content, citations],
    ] of answers.entries()) {
      await prisma.ticketMessage.create({
        data: {
          ticketId,
          content,
          isAiGenerated: true,
          answerStatus,
          citations: citations ?? undefined,
          createdAt: new Date(start + (index + 1) * 1000),
        },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Marks these people's emails verified or not, in auth-service's database, as
 * verifying the emailed code does.
 */
export async function setEmailVerified(
  people: Person[],
  verified: boolean,
): Promise<void> {
  const prisma = new AuthPrisma({
    adapter: new PrismaPg({ connectionString: databaseUrl('auth-service') }),
  });
  try {
    await prisma.user.updateMany({
      where: { id: { in: people.map(({ id }) => id) } },
      data: { isEmailVerified: verified },
    });
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Gives this person a verified phone number, in auth-service's database, as
 * verifying a texted code does. (Texting one needs a provider.)
 */
export async function setPhone(
  person: Person,
  phoneNumber: string,
): Promise<void> {
  const prisma = new AuthPrisma({
    adapter: new PrismaPg({ connectionString: databaseUrl('auth-service') }),
  });
  try {
    await prisma.user.update({
      where: { id: person.id },
      data: { phoneNumber, isPhoneVerified: true },
    });
  } finally {
    await prisma.$disconnect();
  }
}

/** Each person's password hash, kept while `setAccount` has removed it. */
const savedHashes = new Map<string, string>();

/**
 * Sets this person's account as a security screen draws it, in auth-service's
 * database: two-step on or off, a password or none (Google only), and
 * whether their organization requires two-step. Call it with the defaults
 * before signing in, then with the screen's state: two-step on, or no
 * password, would stop the demo password signing in.
 */
export async function setAccount(
  person: Person,
  { twoStep = false, password = true, required = false } = {},
): Promise<void> {
  const prisma = new AuthPrisma({
    adapter: new PrismaPg({ connectionString: databaseUrl('auth-service') }),
  });
  try {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: person.id },
      select: { passwordHash: true, organizationId: true },
    });
    if (user.passwordHash) savedHashes.set(person.id, user.passwordHash);
    await prisma.user.update({
      where: { id: person.id },
      data: {
        isTwoFactorEnabled: twoStep,
        passwordHash: password ? savedHashes.get(person.id) : null,
      },
    });
    if (user.organizationId) {
      await prisma.organization.update({
        where: { id: user.organizationId },
        data: { enforceTwoFactor: required },
      });
    }
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * Gives this person a profile photo as the profile page does: an upload URL
 * from the gateway, the bytes sent there with the method it names, then the
 * confirm.
 */
export async function givePhoto(person: Person): Promise<void> {
  const file = readFileSync(join(REPO_ROOT, 'test/fixtures/images/avatar.png'));
  const session = await sessionAs(person);
  try {
    const signed = await api<{
      uploadUrl: string;
      uploadMethod: string;
      objectPath: string;
    }>(session, 'POST', '/users/me/avatar/upload-url', {
      contentType: 'image/png',
      sizeBytes: file.length,
      fileName: 'me.png',
    });
    const sent = await fetch(signed.uploadUrl, {
      method: signed.uploadMethod,
      headers: { 'Content-Type': 'image/png' },
      body: new Uint8Array(file),
    });
    if (!sent.ok) throw new Error(`Upload answered ${sent.status}`);
    await api(session, 'POST', '/users/me/avatar/confirm', {
      objectPath: signed.objectPath,
    });
  } finally {
    await session.dispose();
  }
}

/** A service's database, as its own `.env` names it. */
/**
 * Marks a ticket as started from a chat (or by email), as `POST /chat/conversations`
 * would have: without asking the AI for an answer, which needs a model.
 */
export async function startedAs(
  ticketId: string,
  source: 'CHAT' | 'EMAIL',
): Promise<void> {
  const prisma = ticketPrisma();
  try {
    await prisma.ticket.update({ where: { id: ticketId }, data: { source } });
  } finally {
    await prisma.$disconnect();
  }
}

export function databaseUrl(service: string): string {
  const env = readFileSync(join(REPO_ROOT, `services/${service}/.env`), 'utf8');
  const url = /^DATABASE_URL\s*=\s*(.*)$/m.exec(env)?.[1]?.trim();
  if (!url) throw new Error(`No DATABASE_URL in ${service}/.env`);
  return url;
}

function ticketPrisma(): TicketPrisma {
  return new TicketPrisma({
    adapter: new PrismaPg({ connectionString: databaseUrl('ticket-service') }),
  });
}

async function register(email: string, fullName: string) {
  await clearThrottles();
  const session = await newRequest.newContext({ baseURL: WEB_URL });
  await api(session, 'POST', '/auth/register', {
    email,
    password: DEMO_PASSWORD,
    fullName,
  });
  await api(session, 'POST', '/auth/login', { email, password: DEMO_PASSWORD });
  return session;
}

async function me(session: APIRequestContext): Promise<Person> {
  const { user } = await api<{ user: Person }>(session, 'GET', '/users/me');
  return { id: user.id, email: user.email, fullName: user.fullName };
}
