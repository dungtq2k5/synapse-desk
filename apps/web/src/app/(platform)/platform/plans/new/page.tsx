import type { Metadata } from 'next';
import { PlanCreate } from '@/components/platform/plan-form';

export const metadata: Metadata = {
  title: 'Platform · New plan · SynapseDesk',
};

/** A new plan, every grant required. */
export default function NewPlanPage() {
  return <PlanCreate />;
}
