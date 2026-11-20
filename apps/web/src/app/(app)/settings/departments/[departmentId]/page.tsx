import type { Metadata } from 'next';
import { DepartmentView } from '@/components/settings/departments/department-view';

export const metadata: Metadata = { title: 'Department · SynapseDesk' };

/** Settings › Departments › one department. */
export default async function DepartmentPage({
  params,
}: {
  params: Promise<{ departmentId: string }>;
}) {
  const { departmentId } = await params;
  return <DepartmentView departmentId={departmentId} />;
}
