import { useEffect, useState } from 'react';

/** Seconds left until `until` (ISO time), ticking every second; 0 when passed. */
function secondsUntil(until: string | null | undefined): number {
  return until ? Math.max(0, Math.round((new Date(until).getTime() - Date.now()) / 1000)) : 0;
}

export function useCountdown(until: string | null | undefined): number {
  const [left, setLeft] = useState(() => secondsUntil(until));
  useEffect(() => {
    setLeft(secondsUntil(until));
    if (!until) return;
    const t = setInterval(() => setLeft(secondsUntil(until)), 1000);
    return () => clearInterval(t);
  }, [until]);
  return left;
}

export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
