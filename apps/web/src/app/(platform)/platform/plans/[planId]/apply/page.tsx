import type { Metadata } from 'next';
import { PlanApply } from '@/components/platform/plan-apply';

export const metadata: Metadata = {
  title: 'Platform · Apply a plan · SynapseDesk',
};

/** Apply a plan to its subscribers: the preview first. */
export default async function ApplyPlanPage({
  params,
}: {
  params: Promise<{ planId: string }>;
}) {
  const { planId } = await params;
  return <PlanApply planId={planId} />;
}
