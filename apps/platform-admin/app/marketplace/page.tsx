'use client';

import { useEffect, useState } from 'react';

import { Screen } from '../../components/screen';
import { ApiError, apiData, apiPut } from '../../lib/api';
import { useSession } from '../../lib/session';

type CatalogApp = {
  code: string;
  nameAr: string;
  descriptionAr: string;
  monthlyPrice: string;
  isCore: boolean;
  isActive: boolean;
  screens: string[];
};

export default function PlatformMarketplacePage() {
  const { canConsole } = useSession();
  const canWrite = canConsole('console.marketplace.manage');
  const [apps, setApps] = useState<CatalogApp[]>([]);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState('');

  async function reload() {
    const next = await apiData<CatalogApp[]>('/platform/marketplace/apps');
    setApps(next);
    setDrafts(Object.fromEntries(next.map((app) => [app.code, app.monthlyPrice])));
  }

  useEffect(() => {
    reload().catch((error: unknown) => setMessage(messageOf(error)));
  }, []);

  async function save(app: CatalogApp, isActive: boolean) {
    setBusy(app.code);
    setMessage('');
    try {
      await apiPut(`/platform/marketplace/apps/${app.code}`, {
        monthlyPrice: drafts[app.code] ?? app.monthlyPrice,
        isActive,
      });
      setMessage(`حُفظت ${app.nameAr}.`);
      await reload();
    } catch (error) {
      setMessage(messageOf(error));
    } finally {
      setBusy('');
    }
  }

  return (
    <Screen
      title="سوق الإضافات"
      subtitle="تسعير الإضافات المُراجَعة فقط. لا يُسجَّل هنا كود طرف ثالث، ولا تُصدر شهادة لدومين العميل."
      crumbs={['المنصة', 'سوق الإضافات']}
    >
      {message ? <p>{message}</p> : null}
      <div className="grid" style={{ gap: 12 }}>
        {apps.map((app) => (
          <article key={app.code} className="card" style={{ display: 'grid', gap: 8 }}>
            <strong>
              {app.nameAr} <span dir="ltr">({app.code})</span>
            </strong>
            <p className="muted" style={{ margin: 0 }}>
              {app.descriptionAr}
              {app.isCore ? ' · مشحونة مع النظام' : ''}
            </p>
            <label className="field">
              <span>السعر الشهري</span>
              <input
                className="input"
                dir="ltr"
                value={drafts[app.code] ?? app.monthlyPrice}
                disabled={!canWrite}
                onChange={(event) => setDrafts({ ...drafts, [app.code]: event.target.value })}
              />
            </label>
            <span>
              <button className="btn primary" type="button" disabled={!canWrite || busy === app.code} onClick={() => save(app, app.isActive)}>
                حفظ السعر
              </button>{' '}
              <button className="btn" type="button" disabled={!canWrite || busy === app.code} onClick={() => save(app, !app.isActive)}>
                {app.isActive ? 'إيقاف البيع' : 'إعادة البيع'}
              </button>
            </span>
          </article>
        ))}
      </div>
    </Screen>
  );
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : 'تعذر إكمال الطلب';
}
