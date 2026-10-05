'use client';

import { useEffect } from 'react';

import { writeSession } from '../lib/api';
import { useSession } from '../lib/session';

/**
 * Consumes a `?token=` session bridge handed over by the marketing smart login.
 *
 * The marketing site authenticates the visitor against the same API and redirects
 * here with the fresh tokens. This component stores them as the local session,
 * strips them from the address bar (tokens must never linger in history), and
 * reloads the session — the visitor lands authenticated, without typing twice.
 */
export function TokenBridge() {
  const { status, reload } = useSession();

  useEffect(() => {
    if (status !== 'anonymous') return;
    const url = new URL(globalThis.location.href);
    const token = url.searchParams.get('token');
    if (!token) return;
    writeSession({
      accessToken: token,
      refreshToken: url.searchParams.get('refresh') ?? '',
      tenantCode: url.searchParams.get('tenant') ?? '',
      expiresAt: Date.now() + 14 * 60 * 1000,
    });
    url.searchParams.delete('token');
    url.searchParams.delete('refresh');
    globalThis.history.replaceState(null, '', url.toString());
    void reload();
  }, [status, reload]);

  return null;
}
