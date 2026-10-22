import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import Stripe from 'stripe';
import { STRIPE_API_VERSION } from '@synapsedesk/contracts';
import {
  FAKE_STRIPE_PORT,
  FAKE_STRIPE_URL,
  FAKE_STRIPE_WEBHOOK_SECRET,
  parseForm,
  startFakeStripe,
  stopFakeStripe,
} from './fake-stripe';

/**
 * The fake Stripe, driven by the real `stripe-node` client the services use:
 * if the SDK can't read an answer, neither can auth-service. Its webhooks are
 * verified the way auth verifies Stripe's.
 */
describe('the fake Stripe (unit)', () => {
  let receiver: Server;
  const events: Stripe.Event[] = [];
  let stripe: Stripe;

  beforeAll(async () => {
    receiver = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        events.push(
          Stripe.webhooks.constructEvent(
            Buffer.concat(chunks),
            String(request.headers['stripe-signature']),
            FAKE_STRIPE_WEBHOOK_SECRET,
          ),
        );
        response.end('{}');
      });
    });
    await new Promise<void>((resolve) => receiver.listen(0, resolve));
    const { port } = receiver.address() as AddressInfo;

    await startFakeStripe(`http://127.0.0.1:${port}/webhooks/stripe`);
    stripe = new Stripe('sk_test_anything', {
      apiVersion: STRIPE_API_VERSION,
      host: 'localhost',
      port: FAKE_STRIPE_PORT,
      protocol: 'http',
    });
  });

  afterAll(async () => {
    await stopFakeStripe();
    await new Promise((resolve) => receiver.close(resolve));
  });

  beforeEach(() => {
    events.length = 0;
  });

  /** A customer with a paid Pro subscription, through the Checkout page. */
  const subscribed = async (organizationId: string) => {
    const customer = await stripe.customers.create({
      metadata: { organizationId },
    });
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.id,
      line_items: [{ price: 'price_fake_pro_monthly', quantity: 1 }],
      success_url: 'https://app.test/ok',
      cancel_url: 'https://app.test/no',
      subscription_data: { metadata: { organizationId } },
    });

    const page = await fetch(`${session.url}`);
    expect(await page.text()).toContain('Pay');

    const paid = await fetch(`${session.url}/pay`, { redirect: 'manual' });
    expect(paid.status).toBe(303);
    expect(paid.headers.get('location')).toBe('https://app.test/ok');

    await waitForEvent('customer.subscription.created');
    const [subscription] = (await stripe.subscriptions.list()).data.filter(
      (each) => each.customer === customer.id,
    );
    return { customer, subscription };
  };

  const waitForEvent = async (type: string) => {
    for (let i = 0; i < 100 && !events.some((e) => e.type === type); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    const event = events.find((e) => e.type === type);
    if (!event) throw new Error(`No ${type} arrived`);
    return event;
  };

  it('serves the catalog the plans seed reads, with amounts and the marker', async () => {
    const products = await stripe.products.list({ limit: 100, active: true });
    expect(products.data.map((p) => p.metadata.synapsedesk_plan)).toEqual([
      'starter',
      'pro',
      'enterprise',
    ]);

    const prices = await stripe.prices.list({
      product: 'prod_fake_pro',
      active: true,
    });
    expect(
      prices.data.map((p) => [p.id, p.unit_amount, p.recurring?.interval]),
    ).toEqual([
      ['price_fake_pro_monthly', 9_900, 'month'],
      ['price_fake_pro_yearly', 99_000, 'year'],
    ]);
  });

  it('reads one price by id, and refuses an unknown one', async () => {
    const price = await stripe.prices.retrieve('price_fake_starter_yearly');
    expect([price.unit_amount, price.currency]).toEqual([29_000, 'usd']);

    await expect(stripe.prices.retrieve('price_nope')).rejects.toMatchObject({
      statusCode: 404,
    });
  });

  it('a paid Checkout confirms by a signed subscription.created, with the period', async () => {
    const { subscription } = await subscribed('org-checkout');
    const event = await waitForEvent('customer.subscription.created');
    const object = event.data.object as Stripe.Subscription;

    expect(object.id).toBe(subscription.id);
    expect(object.items.data[0].price.id).toBe('price_fake_pro_monthly');
    expect(object.items.data[0].current_period_end).toBeGreaterThan(
      object.items.data[0].current_period_start,
    );
    expect(
      (await stripe.invoices.list({ customer: object.customer as string }))
        .data,
    ).toHaveLength(1);
  });

  it('a canceled Checkout goes back to the cancel address', async () => {
    const customer = await stripe.customers.create();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customer.id,
      line_items: [{ price: 'price_fake_starter_monthly', quantity: 1 }],
      success_url: 'https://app.test/ok',
      cancel_url: 'https://app.test/no',
    });

    const back = await fetch(`${session.url}/cancel`, { redirect: 'manual' });
    expect(back.headers.get('location')).toBe('https://app.test/no');
  });

  it('a plan change is applied and confirmed, its proration read as asked', async () => {
    const { subscription } = await subscribed('org-change');
    const itemId = subscription.items.data[0].id;
    const change = (price: string) =>
      stripe.subscriptions.update(subscription.id, {
        items: [{ id: itemId, price }],
        proration_behavior: 'always_invoice',
        payment_behavior: 'error_if_incomplete',
        expand: ['latest_invoice'],
      });
    const next = (outcome: string) =>
      fetch(`${FAKE_STRIPE_URL}/__fake/organizations/org-change/next-change`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ outcome }),
      });

    events.length = 0;
    const charged = await change('price_fake_enterprise_monthly');
    expect((charged.latest_invoice as Stripe.Invoice).total).toBeGreaterThan(0);
    const updated = await waitForEvent('customer.subscription.updated');
    expect(
      (updated.data.object as Stripe.Subscription).items.data[0].price.id,
    ).toBe('price_fake_enterprise_monthly');

    await next('credit');
    const credited = await change('price_fake_pro_monthly');
    expect((credited.latest_invoice as Stripe.Invoice).total).toBeLessThan(0);

    await next('unknown');
    const unknown = await change('price_fake_starter_monthly');
    expect(typeof unknown.latest_invoice).toBe('string');

    // An interval switch moves the period's end.
    const yearly = await change('price_fake_starter_yearly');
    expect(yearly.items.data[0].current_period_end).toBeGreaterThan(
      unknown.items.data[0].current_period_end + 300 * 86_400,
    );
  });

  it('a declined card, and one needing 3-D Secure, are 402 card errors, and nothing moves', async () => {
    const { subscription } = await subscribed('org-declined');

    for (const outcome of ['declined', 'authentication']) {
      await fetch(
        `${FAKE_STRIPE_URL}/__fake/organizations/org-declined/next-change`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ outcome }),
        },
      );
      const error = await stripe.subscriptions
        .update(subscription.id, {
          items: [
            {
              id: subscription.items.data[0].id,
              price: 'price_fake_starter_monthly',
            },
          ],
        })
        .then(
          () => undefined,
          (caught: unknown) => caught,
        );
      expect(error).toBeInstanceOf(Stripe.errors.StripeCardError);
      expect((error as Stripe.errors.StripeCardError).statusCode).toBe(402);
    }

    const after = await stripe.subscriptions.retrieve(subscription.id);
    expect(after.items.data[0].price.id).toBe('price_fake_pro_monthly');
  });

  it('the portal is the marked configuration, and its cancel toggle sends the flag', async () => {
    const configurations = await stripe.billingPortal.configurations.list();
    expect(configurations.data).toHaveLength(1);
    expect(configurations.data[0].metadata?.synapsedesk_portal).toBeTruthy();
    expect(configurations.data[0].features.subscription_update.enabled).toBe(
      false,
    );

    const { customer } = await subscribed('org-portal');
    const session = await stripe.billingPortal.sessions.create({
      customer: customer.id,
      return_url: 'https://app.test/billing',
    });
    events.length = 0;

    const back = await fetch(`${session.url}/cancel`, { redirect: 'manual' });
    expect(back.headers.get('location')).toBe('https://app.test/billing');
    const event = await waitForEvent('customer.subscription.updated');
    expect(
      (event.data.object as Stripe.Subscription).cancel_at_period_end,
    ).toBe(true);
  });

  it('a failed payment sends dunning then past_due, with an open invoice; ended sends deleted', async () => {
    const { customer } = await subscribed('org-dunning');
    events.length = 0;

    await fetch(
      `${FAKE_STRIPE_URL}/__fake/organizations/org-dunning/payment-failed`,
      { method: 'POST' },
    );
    expect(events.map((e) => e.type)).toEqual([
      'invoice.payment_failed',
      'customer.subscription.updated',
    ]);
    expect((events[1].data.object as Stripe.Subscription).status).toBe(
      'past_due',
    );
    const open = (await stripe.invoices.list({ customer: customer.id })).data;
    expect(open[0].status).toBe('open');

    await fetch(`${FAKE_STRIPE_URL}/__fake/organizations/org-dunning/ended`, {
      method: 'POST',
    });
    expect(events.at(-1)?.type).toBe('customer.subscription.deleted');
  });

  it('reads Stripe’s form encoding', () => {
    expect(
      parseForm(
        'items[0][id]=si_1&items[0][price]=p&expand[]=latest_invoice&metadata[organizationId]=o',
      ),
    ).toEqual({
      items: [{ id: 'si_1', price: 'p' }],
      expand: ['latest_invoice'],
      metadata: { organizationId: 'o' },
    });
  });
});
