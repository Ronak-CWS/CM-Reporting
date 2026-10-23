'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { appPath } from './app-path.js';
import { reportingFetch } from './reporting-fetch';
import type { ReportPage } from './report-filters';

interface PageState extends ReportPage { key: string; loading: boolean; error: string }
const emptyPage: PageState = { key: '', records: [], total: 0, nextCursor: null, loading: false, error: '' };

export function useRecordPage(query: string, revision: number, enabled = true) {
  const key = `${query}:${revision}`;
  const [state, setState] = useState<PageState>(emptyPage);
  const activeRequest = useRef<AbortController | null>(null);
  const busy = useRef(false);
  const loadPage = useCallback(async (cursor: string | null = null) => {
    if (!enabled || busy.current) return;
    busy.current = true;
    const controller = new AbortController();
    activeRequest.current = controller;
    setState((previous) => ({ ...(cursor && previous.key === key ? previous : emptyPage), key, loading: true, error: '' }));
    try {
      const params = new URLSearchParams(query);
      if (cursor) params.set('cursor', cursor);
      const response = await reportingFetch(appPath(`/api/records?${params}`), { cache: 'no-store', signal: controller.signal });
      const result = await response.json() as ReportPage & { error?: string };
      if (!response.ok) throw new Error(result.error || 'The records could not be loaded. Please try again.');
      if (controller.signal.aborted) return;
      setState((previous) => {
        const existing = cursor && previous.key === key ? previous.records : [];
        const ids = new Set(existing.map((record) => record.id));
        return { key, records: [...existing, ...result.records.filter((record) => !ids.has(record.id))],
          total: result.total, nextCursor: result.nextCursor, loading: false, error: '' };
      });
    } catch (error) {
      if (!controller.signal.aborted) setState((previous) => ({ ...previous, loading: false,
        error: error instanceof Error ? error.message : 'The records could not be loaded. Please try again.' }));
    } finally {
      if (activeRequest.current === controller) { activeRequest.current = null; busy.current = false; }
    }
  }, [enabled, key, query]);

  useEffect(() => {
    // Debounce a search before querying the complete register.
    const delay = new URLSearchParams(query).get('q') ? 300 : 0;
    const timer = window.setTimeout(() => { void loadPage(); }, delay);
    return () => {
      window.clearTimeout(timer);
      activeRequest.current?.abort();
      activeRequest.current = null;
      busy.current = false;
    };
  }, [loadPage, query]);

  // Do not display records from a previous search while its replacement loads.
  const page = state.key === key && enabled ? state : emptyPage;
  return { ...page, loading: enabled && (state.key !== key || state.loading),
    loadMore: () => { if (page.nextCursor) void loadPage(page.nextCursor); },
    retry: () => { void loadPage(page.records.length ? page.nextCursor : null); },
  };
}
