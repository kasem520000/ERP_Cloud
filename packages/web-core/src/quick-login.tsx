'use client';
/* global BufferSource */

import { useCallback, useEffect, useState } from 'react';

export type QuickLoginSurface = 'staff' | 'bakery' | 'platform' | 'marketing' | 'portal';

export type QuickLoginSecret = {
  tenantCode: string;
  email: string;
  password: string;
  staffTarget?: 'staff' | 'bakery';
};

export type QuickLoginMeta = {
  surface: QuickLoginSurface;
  maskedEmail: string;
  maskedTenant: string;
  savedAt: string;
  staffTarget?: 'staff' | 'bakery';
};

type EncryptedPayloadRecord = {
  surface: QuickLoginSurface;
  ivBase64: string;
  cipherBase64: string;
  meta: QuickLoginMeta;
};

const DB_NAME = 'erp_quick_login_vault_v1';
const DB_VERSION = 1;
const KEY_STORE = 'crypto_keys';
const RECORD_STORE = 'encrypted_entries';
const MASTER_KEY_ID = 'device_aes_gcm_256';
const META_PREFIX = 'erp.quick_login.meta.v1.';
const PREF_PREFIX = 'erp.quick_login.remember_pref.v1.';

let fallbackCryptoKeyPromise: Promise<CryptoKey> | null = null;
const fallbackEncryptedRecords = new Map<QuickLoginSurface, EncryptedPayloadRecord>();

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

function getSubtle(): SubtleCrypto | null {
  if (typeof globalThis !== 'undefined' && globalThis.crypto?.subtle) {
    return globalThis.crypto.subtle;
  }
  return null;
}

export function maskEmail(rawEmail: string): string {
  const trimmed = rawEmail.trim();
  const atIdx = trimmed.indexOf('@');
  if (atIdx <= 0) {
    if (trimmed.length <= 2) return '•••';
    return `${trimmed.slice(0, 2)}•••`;
  }
  const local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx + 1);
  const visibleLocal =
    local.length <= 2 ? `${local.slice(0, 1)}•••` : `${local.slice(0, 2)}•••${local.slice(-1)}`;
  return `${visibleLocal}@${domain}`;
}

export function maskTenantCode(rawTenant: string): string {
  const trimmed = rawTenant.trim();
  if (!trimmed) return '—';
  if (trimmed.length <= 3) return `${trimmed.slice(0, 1)}•••`;
  return `${trimmed.slice(0, 2)}•••${trimmed.slice(-2)}`;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function openVaultDb(): Promise<IDBDatabase | null> {
  if (!isBrowser() || typeof indexedDB === 'undefined') {
    return Promise.resolve(null);
  }
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(KEY_STORE)) {
          db.createObjectStore(KEY_STORE);
        }
        if (!db.objectStoreNames.contains(RECORD_STORE)) {
          db.createObjectStore(RECORD_STORE, { keyPath: 'surface' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function getOrCreateDeviceKey(db: IDBDatabase | null): Promise<CryptoKey | null> {
  const subtle = getSubtle();
  if (!subtle) return null;

  if (!db) {
    if (!fallbackCryptoKeyPromise) {
      fallbackCryptoKeyPromise = subtle.generateKey(
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt'],
      );
    }
    return fallbackCryptoKeyPromise;
  }

  const existing = await new Promise<CryptoKey | null>((resolve) => {
    try {
      const tx = db.transaction(KEY_STORE, 'readonly');
      const getReq = tx.objectStore(KEY_STORE).get(MASTER_KEY_ID);
      getReq.onsuccess = () => resolve((getReq.result as CryptoKey | undefined) ?? null);
      getReq.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  if (existing) return existing;

  // Non-extractable AES-GCM-256 key: cannot be exported out of WebCrypto!
  const generated = await subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(KEY_STORE, 'readwrite');
      tx.objectStore(KEY_STORE).put(generated, MASTER_KEY_ID);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });

  return generated;
}

export function readRememberPreference(surface: QuickLoginSurface): boolean {
  if (!isBrowser()) return true;
  try {
    const raw = localStorage.getItem(`${PREF_PREFIX}${surface}`);
    if (raw === '0') return false;
    return true;
  } catch {
    return true;
  }
}

export function writeRememberPreference(surface: QuickLoginSurface, enabled: boolean): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(`${PREF_PREFIX}${surface}`, enabled ? '1' : '0');
  } catch {
    /* ignore private-mode quota */
  }
}

export function readQuickLoginMeta(surface: QuickLoginSurface): QuickLoginMeta | null {
  const fallback = fallbackEncryptedRecords.get(surface);
  if (!isBrowser()) {
    return fallback?.meta ?? null;
  }
  try {
    const raw = localStorage.getItem(`${META_PREFIX}${surface}`);
    if (!raw) return fallback?.meta ?? null;
    const parsed = JSON.parse(raw) as Partial<QuickLoginMeta>;
    if (!parsed.maskedEmail) return null;
    return {
      surface,
      maskedEmail: String(parsed.maskedEmail),
      maskedTenant: String(parsed.maskedTenant ?? '—'),
      savedAt: String(parsed.savedAt ?? ''),
      ...(parsed.staffTarget === 'bakery' || parsed.staffTarget === 'staff'
        ? { staffTarget: parsed.staffTarget }
        : {}),
    };
  } catch {
    return fallback?.meta ?? null;
  }
}

export async function saveQuickLogin(
  surface: QuickLoginSurface,
  secret: QuickLoginSecret,
): Promise<QuickLoginMeta | null> {
  const subtle = getSubtle();
  if (!subtle) return null;

  const db = await openVaultDb();
  try {
    const key = await getOrCreateDeviceKey(db);
    if (!key) return null;

    const iv = new Uint8Array(12);
    globalThis.crypto.getRandomValues(iv);

    const encoded = new TextEncoder().encode(
      JSON.stringify({
        tenantCode: secret.tenantCode.trim(),
        email: secret.email.trim(),
        password: secret.password,
        ...(secret.staffTarget ? { staffTarget: secret.staffTarget } : {}),
      }),
    );

    const cipherBuf = await subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
    const meta: QuickLoginMeta = {
      surface,
      maskedEmail: maskEmail(secret.email),
      maskedTenant: maskTenantCode(secret.tenantCode),
      savedAt: new Date().toISOString(),
      ...(secret.staffTarget ? { staffTarget: secret.staffTarget } : {}),
    };

    const record: EncryptedPayloadRecord = {
      surface,
      ivBase64: bytesToBase64(iv),
      cipherBase64: bytesToBase64(new Uint8Array(cipherBuf)),
      meta,
    };

    if (db) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(RECORD_STORE, 'readwrite');
        tx.objectStore(RECORD_STORE).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error ?? new Error('Vault write failed'));
      });
    } else {
      fallbackEncryptedRecords.set(surface, record);
    }

    if (isBrowser()) {
      try {
        localStorage.setItem(`${META_PREFIX}${surface}`, JSON.stringify(meta));
      } catch {
        /* ignore */
      }
    }
    return meta;
  } finally {
    db?.close();
  }
}

export async function loadQuickLoginSecret(
  surface: QuickLoginSurface,
): Promise<QuickLoginSecret | null> {
  const subtle = getSubtle();
  if (!subtle) return null;

  const db = await openVaultDb();
  try {
    const key = await getOrCreateDeviceKey(db);
    if (!key) return null;

    const record = db
      ? await new Promise<EncryptedPayloadRecord | null>((resolve) => {
          try {
            const tx = db.transaction(RECORD_STORE, 'readonly');
            const req = tx.objectStore(RECORD_STORE).get(surface);
            req.onsuccess = () => resolve((req.result as EncryptedPayloadRecord | undefined) ?? null);
            req.onerror = () => resolve(null);
          } catch {
            resolve(null);
          }
        })
      : (fallbackEncryptedRecords.get(surface) ?? null);

    if (!record) return null;

    const iv = base64ToBytes(record.ivBase64);
    const cipherBytes = base64ToBytes(record.cipherBase64);
    const plainBuf = await subtle.decrypt(
      { name: 'AES-GCM', iv: iv as BufferSource },
      key,
      cipherBytes as BufferSource,
    );
    const parsed = JSON.parse(new TextDecoder().decode(plainBuf)) as Partial<QuickLoginSecret>;
    if (!parsed.email || typeof parsed.password !== 'string') return null;
    return {
      tenantCode: String(parsed.tenantCode ?? ''),
      email: String(parsed.email),
      password: parsed.password,
      ...(parsed.staffTarget === 'bakery' || parsed.staffTarget === 'staff'
        ? { staffTarget: parsed.staffTarget }
        : {}),
    };
  } catch {
    return null;
  } finally {
    db?.close();
  }
}

export async function clearQuickLogin(surface: QuickLoginSurface): Promise<void> {
  fallbackEncryptedRecords.delete(surface);
  if (isBrowser()) {
    try {
      localStorage.removeItem(`${META_PREFIX}${surface}`);
    } catch {
      /* ignore */
    }
  }
  const db = await openVaultDb();
  if (!db) return;
  try {
    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(RECORD_STORE, 'readwrite');
        tx.objectStore(RECORD_STORE).delete(surface);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  } finally {
    db.close();
  }
}

export function useQuickLogin(surface: QuickLoginSurface) {
  const [meta, setMeta] = useState<QuickLoginMeta | null>(null);
  const [rememberMe, setRememberMeState] = useState<boolean>(true);

  useEffect(() => {
    setRememberMeState(readRememberPreference(surface));
    setMeta(readQuickLoginMeta(surface));
    // Also sync from IndexedDB in case localStorage meta was cleared separately
    void (async () => {
      const db = await openVaultDb();
      if (!db) return;
      try {
        const record = await new Promise<EncryptedPayloadRecord | null>((resolve) => {
          try {
            const tx = db.transaction(RECORD_STORE, 'readonly');
            const req = tx.objectStore(RECORD_STORE).get(surface);
            req.onsuccess = () => resolve((req.result as EncryptedPayloadRecord | undefined) ?? null);
            req.onerror = () => resolve(null);
          } catch {
            resolve(null);
          }
        });
        if (record?.meta) {
          setMeta(record.meta);
        } else {
          setMeta(null);
        }
      } finally {
        db.close();
      }
    })();
  }, [surface]);

  const setRememberMe = useCallback(
    (next: boolean) => {
      setRememberMeState(next);
      writeRememberPreference(surface, next);
    },
    [surface],
  );

  const persistIfRemembered = useCallback(
    async (secret: QuickLoginSecret) => {
      if (rememberMe) {
        const saved = await saveQuickLogin(surface, secret);
        if (saved) setMeta(saved);
      }
    },
    [rememberMe, surface],
  );

  const forget = useCallback(async () => {
    await clearQuickLogin(surface);
    setMeta(null);
  }, [surface]);

  return {
    meta,
    rememberMe,
    setRememberMe,
    persistIfRemembered,
    loadSecret: () => loadQuickLoginSecret(surface),
    forget,
  };
}

export function QuickLoginPanel({
  meta,
  busy,
  onQuickSignIn,
  onForget,
  hideTenant = false,
}: {
  meta: QuickLoginMeta | null;
  busy?: boolean;
  onQuickSignIn: () => void;
  onForget: () => void;
  hideTenant?: boolean;
}) {
  if (!meta) return null;

  return (
    <div
      dir="rtl"
      role="region"
      aria-label="الدخول السريع بالبيانات المحفوظة"
      style={{
        border: '1px solid var(--color-primary-300, rgba(16, 185, 129, 0.35))',
        background: 'var(--surface-2, rgba(16, 185, 129, 0.06))',
        borderRadius: 12,
        padding: '12px 14px',
        marginBottom: 14,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>
            دخول سريع بحساب محفوظ على هذا الجهاز
          </div>
          <div
            style={{
              fontSize: '0.82rem',
              opacity: 0.85,
              marginTop: 2,
              display: 'flex',
              flexWrap: 'wrap',
              gap: '4px 10px',
            }}
          >
            <span>
              البريد: <b dir="ltr">{meta.maskedEmail}</b>
            </span>
            {!hideTenant && meta.maskedTenant !== '—' ? (
              <span>
                المنشأة: <b dir="ltr">{meta.maskedTenant}</b>
              </span>
            ) : null}
          </div>
          <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: 2 }}>
            بيانات الدخول مشفّرة محلياً ولا يتم إظهارها في الحقول.
          </div>
        </div>
        <button
          type="button"
          onClick={onForget}
          disabled={busy}
          style={{
            background: 'transparent',
            border: '1px solid rgba(150, 150, 150, 0.35)',
            borderRadius: 8,
            padding: '4px 9px',
            fontSize: '0.76rem',
            cursor: busy ? 'not-allowed' : 'pointer',
            color: 'inherit',
            whiteSpace: 'nowrap',
          }}
        >
          حذف المحفوظ
        </button>
      </div>

      <button
        type="button"
        className="btn primary block"
        disabled={busy}
        onClick={onQuickSignIn}
        style={{ width: '100%', fontWeight: 700 }}
      >
        {busy ? 'جارٍ تسجيل الدخول السريع…' : 'دخول سريع باستخدام البيانات المحفوظة'}
      </button>
    </div>
  );
}

export function RememberMeCheckbox({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <label
      dir="rtl"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        fontSize: '0.84rem',
        cursor: disabled ? 'not-allowed' : 'pointer',
        userSelect: 'none',
        margin: '4px 0 8px',
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        style={{ width: 16, height: 16, accentColor: 'var(--brand, #0f766e)' }}
      />
      <span>تذكّرني — حفظ بيانات الدخول تلقائياً للدخول السريع دون إظهارها</span>
    </label>
  );
}
