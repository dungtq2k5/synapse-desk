import type { Metadata } from 'next';
import { EndpointView } from '@/components/settings/webhooks/endpoint-view';

export const metadata: Metadata = { title: 'Endpoint · SynapseDesk' };

/** Settings › Webhooks › one endpoint. */
export default async function EndpointPage({
  params,
}: {
  params: Promise<{ endpointId: string }>;
}) {
  const { endpointId } = await params;
  return <EndpointView endpointId={endpointId} />;
}
