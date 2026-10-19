import type { Metadata } from 'next';
import { BillingView } from '@/components/billing/billing-view';

export const metadata: Metadata = { title: 'Billing · SynapseDesk' };

/** Settings › Billing: the plan, the plans, the portal and the invoices. */
export default function BillingPage() {
  return <BillingView />;
}
