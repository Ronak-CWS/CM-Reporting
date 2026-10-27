'use client';

import { useEffect, useState } from 'react';
import { appPath } from './app-path.js';
import { reportingFetch } from './reporting-fetch';
import type { ReportWeeks } from './report-weeks';

const empty = { weeks: [], total: 0, key: '', query: '', loading: false, error: '' } as ReportWeeks & {
  key: string; query: string; loading: boolean; error: string;
};

export function useReportWeeks(query: string, revision: number, enabled = true) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState(empty);
  const key = `${query}:${revision}:${attempt}`;
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    const params = new URLSearchParams(query);
    params.set('groupBy', 'week');
    const timer = window.setTimeout(async () => {
      setState((previous) => ({ ...(previous.query === query ? previous : empty), key, query, loading: true, error: '' }));
      try {
        const response = await reportingFetch(appPath(`/api/records?${params}`), { cache: 'no-store', signal: controller.signal });
        const result = await response.json() as ReportWeeks & { error?: string };
        if (!response.ok) throw new Error(result.error || 'The report weeks could not be loaded. Please try again.');
        if (!controller.signal.aborted) setState({ weeks: result.weeks, total: result.total, key, query, loading: false, error: '' });
      } catch (error) {
        if (!controller.signal.aborted) setState((previous) => ({ ...previous, key, query, loading: false, error: error instanceof Error ? error.message : 'The report weeks could not be loaded.' }));
      }
    }, params.get('q') ? 300 : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [enabled, key, query]);
  const result = state.query === query && enabled ? state : empty;
  return { ...result, loading: enabled && (state.key !== key || state.loading), retry: () => setAttempt((value) => value + 1) };
}
