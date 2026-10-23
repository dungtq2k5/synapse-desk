/**
 * @file A fake Stripe for the test stack: the calls this repo makes, its
 * Checkout and portal "pages", and the webhooks Stripe would send after them.
 *
 * The same rules as the model-free modes: auth-service and the plans seed reach
 * it through `STRIPE_API_BASE_URL`, which the setup sets and which production
 * refuses. Nothing here needs a Stripe key or the network, so the suite runs
 * offline and in CI with no secret.
 *
 * **Its catalog is the suite's only catalog.** `scripts/seed-plans.mjs` reads
 * `products.list` and `prices.list` from here, so every price id in the
 * database is one this fake knows.
 *
 * **It confirms by webhook, as Stripe does.** A Checkout paid on its page sends
 * `customer.subscription.created`; a plan change and a portal cancel toggle send
 * `customer.subscription.updated`. Entitlements move the way they do in
 * production: on the event, never on the redirect.
 *
 * **What a journey asks of it** goes through `/__fake/...`, keyed by the
 * organization id auth puts on the customer's metadata:
 *
 * - `POST /__fake/organizations/{id}/next-change` with `{ outcome }`: the next
 *   plan change is `declined`, needs `authentication` (3-D Secure), or is
 *   paid with a proration that is a `credit`, a `charge`, or `unknown` (an
 *   invoice the change can't be read from). Default: `charge`.
 * - `POST /__fake/organizations/{id}/payment-failed`: the renewal fails, as
 *   Stripe's dunning sends it (`invoice.payment_failed`, then the subscription
 *   `past_due`), leaving an open invoice.
 * - `POST /__fake/organizations/{id}/ended`: the subscription is canceled and
 *   ended (`customer.subscription.deleted`).
 */

import { createHmac } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';

/** Where it listens. Stripe's own `stripe-mock` uses this port too. */
export const FAKE_STRIPE_PORT = Number(process.env.FAKE_STRIPE_PORT ?? 12111);
export const FAKE_STRIPE_URL = `http://localhost:${FAKE_STRIPE_PORT}`;

/** The stack's keys: any secret key passes here; the webhook secret is shared. */
export const FAKE_STRIPE_SECRET_KEY = 'sk_test_fake_stripe';
export const FAKE_STRIPE_WEBHOOK_SECRET = 'whsec_fake_stripe_for_the_stack';

/** The plans seed's marker on a Product, and the portal's on its configuration. */
const PLAN_MARKER = 'synapsedesk_plan';
const PORTAL_MARKER = 'synapsedesk_portal';

/**
 * The catalog: the seeded plans, at the handoff's sample prices (the real
 * ones are Stripe's). Ids are stable so a journey can name one.
 */
export const FAKE_CATALOG = [
  { key: 'starter', name: 'Starter', month: 2_900, year: 29_000 },
  { key: 'pro', name: 'Pro', month: 9_900, year: 99_000 },
  { key: 'enterprise', name: 'Enterprise', month: 49_900, year: 499_000 },
].map((plan) => ({
  product: { id: `prod_fake_${plan.key}`, name: plan.name, key: plan.key },
  prices: (['month', 'year'] as const).map((interval) => ({
    id: `price_fake_${plan.key}_${interval}ly`,
    product: `prod_fake_${plan.key}`,
    interval,
    unitAmount: plan[interval],
  })),
}));

/**
 * A price no seeded plan holds, for a journey that creates a plan of its own:
 * a price belongs to one plan, so it can't borrow the catalog's. Readable by
 * id only; no product lists it.
 */
export const FAKE_SPARE_PRICE = {
  id: 'price_fake_team_monthly',
  product: 'prod_fake_team',
  interval: 'month' as const,
  unitAmount: 4_900,
};

/** A catalog price as Stripe answers one. */
function priceJson(price: (typeof FAKE_CATALOG)[number]['prices'][number]) {
  return {
    id: price.id,
    object: 'price',
    active: true,
    product: price.product,
    currency: 'usd',
    unit_amount: price.unitAmount,
    recurring: { interval: price.interval },
  };
}

/** How the next plan change for an organization goes. */
export type ChangeOutcome =
  'declined' | 'authentication' | 'credit' | 'charge' | 'unknown';

type Subscription = {
  id: string;
  customer: string;
  priceId: string;
  itemId: string;
  status: 'active' | 'past_due' | 'canceled';
  periodStart: number;
  periodEnd: number;
  cancelAtPeriodEnd: boolean;
};

type Invoice = {
  id: string;
  customer: string;
  amountDue: number;
  status: 'paid' | 'open';
  created: number;
};

type CheckoutSession = {
  id: string;
  customer: string;
  priceId: string;
  organizationId: string | undefined;
  successUrl: string;
  cancelUrl: string;
};

type PortalSession = { id: string; customer: string; returnUrl: string };

/** Seconds, as Stripe counts time. */
const now = () => Math.floor(Date.now() / 1000);
const DAY = 86_400;

/**
 * Starts the fake on {@link FAKE_STRIPE_PORT}.
 *
 * @param webhookUrl the gateway's `POST /webhooks/stripe`, where events go.
 */
export async function startFakeStripe(
  webhookUrl = 'http://127.0.0.1:3000/api/v1/webhooks/stripe',
): Promise<Server> {
  await stopFakeStripe();
  const customers = new Map<string, { organizationId?: string }>();
  const subscriptions = new Map<string, Subscription>();
  const invoices: Invoice[] = [];
  const checkouts = new Map<string, CheckoutSession>();
  const portals = new Map<string, PortalSession>();
  const nextChange = new Map<string, ChangeOutcome>();
  // Unique across runs as well: the databases outlive the fake, and a second
  // run's `cus_fake_1` would collide with the first's on a unique column.
  const run = Date.now().toString(36);
  let seq = 0;
  const id = (prefix: string) => `${prefix}_fake_${run}_${(seq += 1)}`;

  const priceById = (priceId: string) =>
    [...FAKE_CATALOG.flatMap((plan) => plan.prices), FAKE_SPARE_PRICE].find(
      (price) => price.id === priceId,
    );
  const customerOf = (organizationId: string) =>
    [...customers].find(([, c]) => c.organizationId === organizationId)?.[0];
  const subscriptionOf = (customer: string) =>
    [...subscriptions.values()].find(
      (subscription) =>
        subscription.customer === customer &&
        subscription.status !== 'canceled',
    );

  const subscriptionJson = (subscription: Subscription) => ({
    id: subscription.id,
    object: 'subscription',
    customer: subscription.customer,
    status: subscription.status,
    cancel_at_period_end: subscription.cancelAtPeriodEnd,
    items: {
      object: 'list',
      data: [
        {
          id: subscription.itemId,
          object: 'subscription_item',
          price: { id: subscription.priceId, object: 'price' },
          current_period_start: subscription.periodStart,
          current_period_end: subscription.periodEnd,
        },
      ],
    },
  });

  const invoiceJson = (invoice: Invoice) => ({
    id: invoice.id,
    object: 'invoice',
    number: invoice.id.toUpperCase(),
    customer: invoice.customer,
    amount_due: invoice.amountDue,
    total: invoice.amountDue,
    currency: 'usd',
    status: invoice.status,
    created: invoice.created,
    hosted_invoice_url: `${FAKE_STRIPE_URL}/invoices/${invoice.id}`,
  });

  /** Signs and sends one event, as Stripe does: `t=…,v1=HMAC(t.payload)`. */
  const send = async (type: string, object: unknown) => {
    const payload = JSON.stringify({
      id: id('evt'),
      object: 'event',
      api_version: '2026-07-29.dahlia',
      created: now(),
      type,
      data: { object },
    });
    const t = now();
    const v1 = createHmac('sha256', FAKE_STRIPE_WEBHOOK_SECRET)
      .update(`${t}.${payload}`)
      .digest('hex');

    const answer = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'stripe-signature': `t=${t},v1=${v1}`,
      },
      body: payload,
    });
    if (!answer.ok) {
      throw new Error(`The gateway answered ${type} with ${answer.status}`);
    }
  };

  const periodFor = (priceId: string, from = now()) => ({
    periodStart: from,
    periodEnd:
      from + (priceById(priceId)?.interval === 'year' ? 365 : 30) * DAY,
  });

  // ------------------------------------------------------------- the API

  const api = async (
    method: string,
    path: string,
    params: Params,
  ): Promise<[number, unknown]> => {
    const segments = path.split('/').filter(Boolean).slice(1);
    const [resource, key] = segments;
    const route = `${method} ${segments.length > 1 && resource !== 'checkout' && resource !== 'billing_portal' ? `${resource}/:id` : segments.join('/')}`;

    switch (route) {
      case 'POST customers': {
        const customer = id('cus');
        const metadata = (params.metadata ?? {}) as Record<string, string>;
        customers.set(customer, { organizationId: metadata.organizationId });
        return [200, { id: customer, object: 'customer', metadata }];
      }
      case 'POST checkout/sessions': {
        const lineItems = params.line_items as { price?: string }[] | undefined;
        const subscriptionData = params.subscription_data as Params | undefined;
        const metadata = subscriptionData?.metadata as
          Record<string, string> | undefined;
        const session: CheckoutSession = {
          id: id('cs'),
          customer: String(params.customer),
          priceId: lineItems?.[0]?.price ?? '',
          organizationId: metadata?.organizationId,
          successUrl: String(params.success_url),
          cancelUrl: String(params.cancel_url),
        };
        checkouts.set(session.id, session);
        return [
          200,
          {
            id: session.id,
            object: 'checkout.session',
            url: `${FAKE_STRIPE_URL}/checkout/${session.id}`,
          },
        ];
      }
      case 'GET billing_portal/configurations':
        return [
          200,
          {
            object: 'list',
            has_more: false,
            data: [
              {
                id: 'bpc_fake',
                object: 'billing_portal.configuration',
                metadata: { [PORTAL_MARKER]: 'true' },
                features: { subscription_update: { enabled: false } },
              },
            ],
          },
        ];
      case 'POST billing_portal/sessions': {
        const session: PortalSession = {
          id: id('bps'),
          customer: String(params.customer),
          returnUrl: String(params.return_url),
        };
        portals.set(session.id, session);
        return [
          200,
          {
            id: session.id,
            object: 'billing_portal.session',
            url: `${FAKE_STRIPE_URL}/portal/${session.id}`,
          },
        ];
      }
      case 'GET subscriptions':
        return [
          200,
          {
            object: 'list',
            has_more: false,
            data: [...subscriptions.values()].map(subscriptionJson),
          },
        ];
      case 'GET subscriptions/:id': {
        const subscription = subscriptions.get(key);
        return subscription
          ? [200, subscriptionJson(subscription)]
          : notFound('subscription', key);
      }
      case 'POST subscriptions/:id':
        return changePlan(key, params);
      case 'GET invoices': {
        const limit = Number(params.limit ?? 10);
        return [
          200,
          {
            object: 'list',
            has_more: false,
            data: invoices
              .filter((invoice) => invoice.customer === params.customer)
              // Newest first, by when it was written: two in one second tie.
              .reverse()
              .slice(0, limit)
              .map(invoiceJson),
          },
        ];
      }
      case 'GET products':
        return [
          200,
          {
            object: 'list',
            has_more: false,
            data: FAKE_CATALOG.map(({ product }) => ({
              id: product.id,
              object: 'product',
              name: product.name,
              active: true,
              metadata: { [PLAN_MARKER]: product.key },
            })),
          },
        ];
      case 'GET prices':
        return [
          200,
          {
            object: 'list',
            has_more: false,
            data: FAKE_CATALOG.flatMap((plan) => plan.prices)
              .filter((price) => price.product === params.product)
              .map(priceJson),
          },
        ];
      case 'GET prices/:id': {
        const price = priceById(key);
        return price ? [200, priceJson(price)] : notFound('price', key);
      }
      default:
        return notFound('route', `${method} ${path}`);
    }
  };

  /** `subscriptions.update`: refused, or applied and confirmed by webhook. */
  const changePlan = async (
    subscriptionId: string,
    params: Params,
  ): Promise<[number, unknown]> => {
    const subscription = subscriptions.get(subscriptionId);
    if (!subscription) return notFound('subscription', subscriptionId);

    const organizationId = customers.get(subscription.customer)?.organizationId;
    const outcome =
      (organizationId && nextChange.get(organizationId)) || 'charge';
    if (organizationId) nextChange.delete(organizationId);

    // `error_if_incomplete`: an unpaid change is refused whole, with a 402.
    if (outcome === 'declined' || outcome === 'authentication') {
      return [
        402,
        {
          error: {
            type: 'card_error',
            code:
              outcome === 'declined'
                ? 'card_declined'
                : 'subscription_payment_intent_requires_action',
            message:
              outcome === 'declined'
                ? 'Your card was declined.'
                : 'This payment requires additional user action.',
          },
        },
      ];
    }

    const items = params.items as { price?: string }[] | undefined;
    const priceId = items?.[0]?.price ?? subscription.priceId;
    const before = priceById(subscription.priceId);
    const after = priceById(priceId);
    // Stripe resets the anchor when the interval changes.
    const period =
      before?.interval === after?.interval
        ? {
            periodStart: subscription.periodStart,
            periodEnd: subscription.periodEnd,
          }
        : periodFor(priceId);
    Object.assign(subscription, { priceId, ...period });

    const invoice: Invoice = {
      id: id('in'),
      customer: subscription.customer,
      amountDue:
        outcome === 'credit'
          ? -Math.abs((before?.unitAmount ?? 0) - (after?.unitAmount ?? 0))
          : Math.abs((after?.unitAmount ?? 0) - (before?.unitAmount ?? 0)),
      status: 'paid',
      created: now(),
    };
    invoices.push(invoice);

    await send('customer.subscription.updated', subscriptionJson(subscription));

    return [
      200,
      {
        ...subscriptionJson(subscription),
        // `unknown`: the invoice left unexpanded, as when the proration lands
        // somewhere `latest_invoice` doesn't point.
        latest_invoice:
          outcome === 'unknown' ? invoice.id : invoiceJson(invoice),
      },
    ];
  };

  // ------------------------------------------------------------ the pages

  const pages = async (
    method: string,
    path: string,
    response: ServerResponse,
  ): Promise<boolean> => {
    const [kind, sessionId, action] = path.split('/').filter(Boolean);

    if (kind === 'checkout') {
      const session = checkouts.get(sessionId);
      if (!session) return false;
      if (method === 'GET' && !action) {
        page(response, 'Checkout', [
          ['Pay', `/checkout/${session.id}/pay`],
          ['Cancel', `/checkout/${session.id}/cancel`],
        ]);
        return true;
      }
      if (action === 'cancel') {
        redirect(response, session.cancelUrl);
        return true;
      }
      if (action === 'pay') {
        checkouts.delete(session.id);
        const subscription: Subscription = {
          id: id('sub'),
          customer: session.customer,
          priceId: session.priceId,
          itemId: id('si'),
          status: 'active',
          cancelAtPeriodEnd: false,
          ...periodFor(session.priceId),
        };
        subscriptions.set(subscription.id, subscription);
        invoices.push({
          id: id('in'),
          customer: session.customer,
          amountDue: priceById(session.priceId)?.unitAmount ?? 0,
          status: 'paid',
          created: now(),
        });
        // Back on the success page first; the event follows, as it does.
        redirect(response, session.successUrl);
        void send(
          'customer.subscription.created',
          subscriptionJson(subscription),
        );
        return true;
      }
    }

    if (kind === 'portal') {
      const session = portals.get(sessionId);
      if (!session) return false;
      const subscription = subscriptionOf(session.customer);
      if (method === 'GET' && !action) {
        page(response, 'Billing portal', [
          ['Cancel plan', `/portal/${session.id}/cancel`],
          ['Keep plan', `/portal/${session.id}/keep`],
          ['Return', session.returnUrl],
        ]);
        return true;
      }
      if ((action === 'cancel' || action === 'keep') && subscription) {
        subscription.cancelAtPeriodEnd = action === 'cancel';
        await send(
          'customer.subscription.updated',
          subscriptionJson(subscription),
        );
        redirect(response, session.returnUrl);
        return true;
      }
    }

    return false;
  };

  // ---------------------------------------------------------- the controls

  const control = async (
    path: string,
    params: Params,
  ): Promise<[number, unknown]> => {
    const [, , organizationId, action] = path.split('/').filter(Boolean);
    const customer = customerOf(organizationId);

    if (action === 'next-change') {
      nextChange.set(organizationId, params.outcome as ChangeOutcome);
      return [200, { ok: true }];
    }

    const subscription = customer && subscriptionOf(customer);
    if (!customer || !subscription) {
      return notFound('subscription for organization', organizationId);
    }

    if (action === 'payment-failed') {
      const invoice: Invoice = {
        id: id('in'),
        customer,
        amountDue: priceById(subscription.priceId)?.unitAmount ?? 0,
        status: 'open',
        created: now(),
      };
      invoices.push(invoice);
      await send('invoice.payment_failed', {
        ...invoiceJson(invoice),
        attempt_count: 1,
        next_payment_attempt: now() + 3 * DAY,
      });
      subscription.status = 'past_due';
      await send(
        'customer.subscription.updated',
        subscriptionJson(subscription),
      );
      return [200, { ok: true }];
    }

    if (action === 'ended') {
      subscription.status = 'canceled';
      await send(
        'customer.subscription.deleted',
        subscriptionJson(subscription),
      );
      return [200, { ok: true }];
    }

    return notFound('control', path);
  };

  const server = createServer((request, response) => {
    void (async () => {
      const url = new URL(request.url ?? '/', FAKE_STRIPE_URL);
      const body = await readBody(request);
      const params = {
        ...parseForm(url.searchParams.toString()),
        ...(request.headers['content-type']?.includes('json')
          ? (JSON.parse(body || '{}') as Params)
          : parseForm(body)),
      };
      const method = request.method ?? 'GET';

      if (url.pathname.startsWith('/v1/')) {
        const [status, json] = await api(method, url.pathname, params);
        return send_(response, status, json);
      }
      if (url.pathname.startsWith('/__fake/')) {
        const [status, json] = await control(url.pathname, params);
        return send_(response, status, json);
      }
      if (await pages(method, url.pathname, response)) return;
      send_(response, 404, { error: { message: `No ${url.pathname}` } });
    })().catch((error: unknown) => {
      send_(response, 500, { error: { message: String(error) } });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(FAKE_STRIPE_PORT, '0.0.0.0', resolve);
  });
  running = server;
  return server;
}

/** The one this process started, if any. */
let running: Server | undefined;

/** Stops the fake this process started. A no-op when none is running. */
export async function stopFakeStripe(): Promise<void> {
  const server = running;
  running = undefined;
  if (!server) return;
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
}

/**
 * Points this process's environment, and so every service and seed it starts,
 * at the fake: the host, a secret key, and the webhook secret it signs with.
 */
export function useFakeStripe(): void {
  process.env.STRIPE_API_BASE_URL = FAKE_STRIPE_URL;
  process.env.STRIPE_SECRET_KEY = FAKE_STRIPE_SECRET_KEY;
  process.env.STRIPE_RESTRICT_KEY = FAKE_STRIPE_SECRET_KEY;
  process.env.STRIPE_WEBHOOK_SECRET = FAKE_STRIPE_WEBHOOK_SECRET;
}

// ---------------------------------------------------------------- helpers

type Params = Record<string, unknown>;

/**
 * Stripe's form encoding (`items[0][price]=…`, `expand[]=…`) as an object,
 * arrays for numeric and empty keys.
 */
export function parseForm(body: string): Params {
  const out: Params = {};
  for (const [name, value] of new URLSearchParams(body)) {
    const keys = name.replace(/\]/g, '').split('[');
    let target: Record<string, unknown> | unknown[] = out;
    keys.forEach((key, index) => {
      const last = index === keys.length - 1;
      const nextIsIndex = /^\d*$/.test(keys[index + 1] ?? 'x');
      const container = target as Record<string, unknown>;
      if (Array.isArray(target) && key === '') {
        if (last) target.push(value);
        else target.push((target = nextIsIndex ? [] : {}));
        return;
      }
      if (last) {
        container[key] = value;
        return;
      }
      container[key] ??= nextIsIndex ? [] : {};
      target = container[key] as Record<string, unknown>;
    });
  }
  return out;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer) => chunks.push(chunk));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function send_(response: ServerResponse, status: number, json: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(json));
}

function notFound(what: string, key: string): [number, unknown] {
  return [
    404,
    {
      error: {
        type: 'invalid_request_error',
        code: 'resource_missing',
        message: `No such ${what}: '${key}'`,
      },
    },
  ];
}

function redirect(response: ServerResponse, location: string): void {
  response.writeHead(303, { location });
  response.end();
}

/** One page of links, as a button each: Stripe's page, in miniature. */
function page(
  response: ServerResponse,
  title: string,
  actions: [label: string, href: string][],
): void {
  const buttons = actions
    .map(([label, href]) => `<a role="button" href="${href}">${label}</a>`)
    .join('\n');
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(
    `<!doctype html><html lang="en"><title>${title} — fake Stripe</title>` +
      `<main><h1>${title}</h1>${buttons}</main></html>`,
  );
}
