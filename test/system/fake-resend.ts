/**
 * @file Resend, for the test stack: a server the services send mail to instead
 * of the real API.
 *
 * The services reach it through `RESEND_BASE_URL`, which the stock Resend SDK
 * reads itself, so nothing in a service knows it is talking to a fake. Every
 * send is recorded, and `GET /__sent` answers the record, so a row in another
 * process can assert on a mail that went out.
 *
 * **A route it doesn't serve answers `501` and is recorded**, not a status a
 * service would act on: a new call to Resend shows up as a refused request
 * naming itself, not as mail that silently vanished. An error body carries its
 * own `statusCode`, because the SDK takes a JSON error body as the error and
 * never reads the HTTP status.
 */
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

/** Where it listens: beside the fake Stripe's 12111. */
export const FAKE_RESEND_PORT = Number(process.env.FAKE_RESEND_PORT ?? 12112);
export const FAKE_RESEND_URL = `http://localhost:${FAKE_RESEND_PORT}`;

/** A key that looks like Resend's and can't authenticate anywhere. */
export const FAKE_RESEND_API_KEY = 're_fake_resend_for_the_stack';

/** One mail the stack sent, as the service asked Resend to send it. */
export type SentMail = {
  to: string[];
  from: string;
  subject: string;
  /** The `Idempotency-Key` header, which the services set per send. */
  idempotencyKey?: string;
};

/** What the fake has seen: the mail sent, and the calls it doesn't serve. */
export type FakeResendRecord = { sent: SentMail[]; refused: string[] };

let server: Server | null = null;
const record: FakeResendRecord = { sent: [], refused: [] };

const readJson = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    let text = '';
    req.setEncoding('utf8');
    req.on('data', (chunk: string) => (text += chunk));
    req.on('end', () => {
      try {
        resolve(text ? JSON.parse(text) : {});
      } catch (error) {
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
    req.on('error', reject);
  });

const answer = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const asList = (value: unknown): string[] =>
  (Array.isArray(value) ? value : [value]).filter(
    (item): item is string => typeof item === 'string',
  );

function recordSend(body: unknown, idempotencyKey?: string): string {
  const mail = (body ?? {}) as {
    to?: unknown;
    from?: unknown;
    subject?: unknown;
  };
  record.sent.push({
    to: asList(mail.to),
    from: typeof mail.from === 'string' ? mail.from : '',
    subject: typeof mail.subject === 'string' ? mail.subject : '',
    idempotencyKey,
  });
  return `fake_email_${record.sent.length}`;
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const path = (req.url ?? '').split('?')[0];
  const key = req.headers['idempotency-key'];
  const idempotencyKey = typeof key === 'string' ? key : undefined;

  if (req.method === 'GET' && path === '/__sent') {
    return answer(res, 200, record);
  }
  if (req.method === 'POST' && path === '/emails') {
    return answer(res, 200, {
      id: recordSend(await readJson(req), idempotencyKey),
    });
  }
  if (req.method === 'POST' && path === '/emails/batch') {
    const mails = await readJson(req);
    const ids = (Array.isArray(mails) ? mails : []).map((mail) => ({
      id: recordSend(mail, idempotencyKey),
    }));
    return answer(res, 200, { data: ids });
  }

  record.refused.push(`${req.method} ${path}`);
  return answer(res, 501, {
    statusCode: 501,
    name: 'not_implemented',
    message: `The fake Resend doesn't serve ${req.method} ${path}.`,
  });
}

/** Starts the fake; a second call while it runs does nothing. */
export async function startFakeResend(): Promise<void> {
  if (server) return;
  const starting = createServer((req, res) => {
    handle(req, res).catch(() =>
      answer(res, 400, {
        statusCode: 400,
        name: 'validation_error',
        message: 'Unreadable body.',
      }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    starting.once('error', reject);
    starting.listen(FAKE_RESEND_PORT, '0.0.0.0', () => resolve());
  });
  // It serves the stack's services, and never by itself keeps this process
  // alive: a run that stops early, or a spec that starts the stack, exits.
  starting.unref();
  server = starting;
}

/**
 * Stops the fake, and says what it saw: the sends it recorded, and any call it
 * refused, which a service made and the fake doesn't serve.
 */
export async function stopFakeResend(): Promise<void> {
  const running = server;
  server = null;
  if (!running) return;
  console.log(
    `Fake Resend: ${record.sent.length} sent, ${record.refused.length} refused${record.refused.length > 0 ? ` (${[...new Set(record.refused)].join(', ')})` : ''}.`,
  );
  running.closeAllConnections();
  await new Promise<void>((resolve) => running.close(() => resolve()));
}

/** What the running fake has recorded, from any process. */
export async function fakeResendRecord(): Promise<FakeResendRecord> {
  const response = await fetch(`${FAKE_RESEND_URL}/__sent`);
  return (await response.json()) as FakeResendRecord;
}
