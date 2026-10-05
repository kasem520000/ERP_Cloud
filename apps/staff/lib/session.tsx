'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import {
  ApiError,
  consumeSupportFragment,
  fetchMe,
  login as apiLogin,
  logout as apiLogout,
  readSession,
  writeSession,
  type MePayload,
} from './api';

export type SessionState = {
  status: 'loading' | 'anonymous' | 'authenticated';
  me?: MePayload;
  error?: string;
};

type SessionContextValue = SessionState & {
  can: (permission?: string) => boolean;
  isPlatformAdmin: boolean;
  signIn: (email: string, password: string, tenantCode: string, mfaCode?: string) => Promise<void>;
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
};

const SessionContext = createContext<SessionContextValue | undefined>(undefined);

/**
 * Canonical ↔ legacy permission alias pairs, mirrored from
 * `@erp/contracts` (`permission-aliases.ts`). The API now emits canonical
 * `tenant.*` codes, but `can()` still honours the old `platform.*` spellings
 * (and vice versa) so web clients keep working across mixed-version deploys.
 */
const PERMISSION_ALIASES: Record<string, string> = {
  'platform.tenant.view': 'tenant.profile.view',
  'platform.tenant.manage': 'tenant.profile.manage',
  'platform.billing.view': 'tenant.billing.view',
  'platform.billing.manage': 'tenant.subscription.manage',
  'platform.users.view': 'tenant.users.view',
  'platform.users.manage': 'tenant.users.manage',
  'platform.roles.view': 'tenant.roles.view',
  'platform.roles.manage': 'tenant.roles.manage',
  'platform.devices.view': 'tenant.devices.view',
  'platform.devices.manage': 'tenant.devices.manage',
  'platform.audit.view': 'tenant.audit.view',
};

function resolveAlias(permission: string): string | undefined {
  const direct = PERMISSION_ALIASES[permission];
  if (direct) return direct;
  for (const [legacy, canonical] of Object.entries(PERMISSION_ALIASES)) {
    if (canonical === permission) return legacy;
  }
  return undefined;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<SessionState>({ status: 'loading' });

  const load = useCallback(async () => {
    // P-C8: رمز الدخول المؤقّت يصل في جزء العنوان من شاشة اللوحة — يُلتقط قبل أول نداء.
    consumeSupportFragment();
    if (!readSession()) {
      setState({ status: 'anonymous' });
      return;
    }
    try {
      const me = await fetchMe();
      setState({ status: 'authenticated', me });
    } catch (error) {
      if (error instanceof ApiError && error.isAuthError) {
        writeSession(undefined);
        setState({ status: 'anonymous' });
        return;
      }
      // The API is unreachable or misconfigured — say so rather than bouncing the user
      // back to a login form that will also fail.
      setState({
        status: 'anonymous',
        error: error instanceof Error ? error.message : 'تعذر الاتصال بالخادم',
      });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const signIn = useCallback(
    async (email: string, password: string, tenantCode: string, mfaCode?: string) => {
      await apiLogin(email, password, tenantCode, mfaCode);
      const me = await fetchMe();
      setState({ status: 'authenticated', me });
    },
    [],
  );

  const signOut = useCallback(async () => {
    await apiLogout();
    setState({ status: 'anonymous' });
  }, []);

  const value = useMemo<SessionContextValue>(() => {
    const permissions = state.me?.permissions ?? [];
    return {
      ...state,
      isPlatformAdmin: state.me?.user.isPlatformAdmin === true,
      can: (permission?: string) => {
        if (!permission) return true;
        if (permissions.includes('*') || permissions.includes(permission)) return true;
        const alias = resolveAlias(permission);
        return alias !== undefined && permissions.includes(alias);
      },
      signIn,
      signOut,
      reload: load,
    };
  }, [state, signIn, signOut, load]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside <SessionProvider>');
  return context;
}
