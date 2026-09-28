/**
 * Supabase Realtime subscription with automatic recovery (spec 16.2):
 * - subscribes in useEffect and removes the channel on cleanup;
 * - on CHANNEL_ERROR / TIMED_OUT / CLOSED it re-subscribes after 3 seconds;
 * - every time it (re)connects it calls onChange (now and again 2 s later), so
 *   changes missed while disconnected - or in the short gap between "subscribed"
 *   and Supabase actually streaming changes - are picked up by refetching.
 * RLS decides which rows each user receives - the browser never sees other rows.
 */
import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { supabase } from './supabase';

interface Options {
  table: string;
  filter?: string;          // e.g. "session_id=eq.<uuid>"
  enabled?: boolean;
  onChange: () => void;
}

export function useRealtime({ table, filter, enabled = true, onChange }: Options) {
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let channel: RealtimeChannel | null = null;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let catchUp: ReturnType<typeof setTimeout> | undefined;

    const subscribe = () => {
      channel = supabase
        .channel(`rt-${table}-${filter ?? 'all'}-${Math.random().toString(36).slice(2)}`)
        .on('postgres_changes', { event: '*', schema: 'public', table, ...(filter ? { filter } : {}) }, () => onChangeRef.current())
        .subscribe((status, err) => {
          if (import.meta.env.DEV) console.debug(`[realtime] ${table}${filter ? ` (${filter})` : ''}: ${status}`, err?.message ?? '');
          if (!active) return;
          if (status === 'SUBSCRIBED') {
            onChangeRef.current(); // catch up on anything missed ...
            clearTimeout(catchUp);
            catchUp = setTimeout(() => active && onChangeRef.current(), 2000); // ... including the start-up gap
          }
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') {
            const dead = channel;
            channel = null;
            if (dead) void supabase.removeChannel(dead);
            clearTimeout(retry);
            retry = setTimeout(() => active && subscribe(), 3000);
          }
        });
    };
    subscribe();

    return () => {
      active = false;
      clearTimeout(retry);
      clearTimeout(catchUp);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [table, filter, enabled]);
}
