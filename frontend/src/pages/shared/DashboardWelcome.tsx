import type { ReactNode } from 'react';
import { useAuth } from '@/auth/useAuth';
import { Card } from '@/components/ui/Card';

/** Temporary dashboard body until the role dashboards are built (Phase 10). */
export function DashboardWelcome({ subtitle, children }: { subtitle: string; children?: ReactNode }) {
  const { profile } = useAuth();
  const firstName = profile?.full_name.split(' ')[0] ?? '';
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">Welcome, {firstName}</h1>
        <p className="mt-1 text-sm text-slate-500">{subtitle}</p>
      </div>
      <Card title="Getting started">
        <p className="text-sm text-slate-600">{children}</p>
      </Card>
    </div>
  );
}
