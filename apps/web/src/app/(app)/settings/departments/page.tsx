import type { Metadata } from 'next';
import { DepartmentsView } from '@/components/settings/departments/departments-view';

export const metadata: Metadata = { title: 'Departments · SynapseDesk' };

/** Settings › Departments. */
export default function DepartmentsPage() {
  return <DepartmentsView />;
}
