import type { Metadata } from 'next';
import { PlanEdit } from '@/components/platform/plan-form';

export const metadata: Metadata = { title: 'Platform · Plan · SynapseDesk' };

/** A plan's catalog row. */
export default async function PlanPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;
  return <PlanEdit planId={planId} />;
}
