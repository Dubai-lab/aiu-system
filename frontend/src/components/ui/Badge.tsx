import type { ReactNode } from 'react';

type Tone = 'green' | 'red' | 'amber' | 'slate' | 'blue' | 'purple';

const TONES: Record<Tone, string> = {
  green: 'bg-green-100 text-green-800',
  red: 'bg-red-100 text-red-800',
  amber: 'bg-amber-100 text-amber-800',
  slate: 'bg-slate-100 text-slate-700',
  blue: 'bg-sky-100 text-sky-800',
  purple: 'bg-purple-100 text-purple-800',
};

export function Badge({ tone = 'slate', children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${TONES[tone]}`}>
      {children}
    </span>
  );
}
