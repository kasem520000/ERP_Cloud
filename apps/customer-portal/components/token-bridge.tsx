'use client';

import { useEffect } from 'react';

import { storeToken } from '../lib/api';

/**
 * Consumes a `?token=` session bridge handed over by the marketing smart login.
 *
 * The marketing site authenticates the buyer against the same API and redirects
 * here with the fresh access token. This component stores it in the portal cookie
 * and reloads onto the stripped URL so the token never lingers in history —
 * the visitor lands authenticated, without typing twice.
 */
export function TokenBridge() {
  useEffect(() => {
    const url = new URL(globalThis.location.href);
    const token = url.searchParams.get('token');
    if (!token) return;
    storeToken(token);
    url.searchParams.delete('token');
    url.searchParams.delete('refresh');
    globalThis.location.assign(url.toString());
  }, []);

  return null;
}
