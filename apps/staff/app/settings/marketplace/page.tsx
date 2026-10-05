'use client';

import { useEffect, useState } from 'react';

import { Notice } from '../../../components/data-view';
import { Screen } from '../../../components/screen';
import { ApiError, apiDelete, apiData, apiPost } from '../../../lib/api';

type AppRow = {
  code: string;
  nameAr: string;
  descriptionAr: string;
  icon: string;
  version: string;
  monthlyPrice: string;
  isCore: boolean;
  isActive: boolean;
  enabled: boolean;
  screens: string[];
};

type Catalog = { apps: AppRow[] };

export default function MarketplacePage() {
  const [apps, setApps] = useState<AppRow[]>([]);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger' | 'info'; text: string }>();
  const [busy, setBusy] = useState('');

  async function reload() {
    const catalog = await apiData<Catalog>('/marketplace/apps');
    setApps(catalog.apps ?? []);
  }

  useEffect(() => {
    reload().catch((error: unknown) => setNotice({ kind: 'danger', text: messageOf(error) }));
  }, []);

  async function toggle(app: AppRow) {
    setBusy(app.code);
    setNotice(undefined);
    try {
      if (app.enabled) {
        await apiDelete(`/marketplace/apps/${app.code}`);
        setNotice({ kind: 'ok', text: `أُوقفت ${app.nameAr}. الشاشة تختفي والإعدادات تبقى.` });
      } else {
        await apiPost(`/marketplace/apps/${app.code}/install`, {});
        setNotice({ kind: 'ok', text: `فُعّلت ${app.nameAr}.` });
      }
      window.dispatchEvent(new Event('erp:apps-changed'));
      await reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: messageOf(error) });
    } finally {
      setBusy('');
    }
  }

  return (
    <Screen
      title="سوق الإضافات"
      subtitle="تفعيل إضافة مُراجَعة يُظهر شاشتها. الإيقاف يخفيها ولا يمسح بياناتها. لا يُثبَّت كود طرف ثالث."
      crumbs={['الإعدادات', 'سوق الإضافات']}
    >
      {notice ? <Notice notice={notice} /> : null}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
        {apps.map((app) => (
          <article key={app.code} className="card" style={{ display: 'grid', gap: 8 }}>
            <strong>
              {app.icon} {app.nameAr}
            </strong>
            <p className="muted" style={{ margin: 0 }}>
              {app.descriptionAr}
            </p>
            <p className="muted" style={{ margin: 0 }} dir="ltr">
              {app.version} · {app.monthlyPrice} / شهر
              {app.isCore ? ' · مشحونة' : ''}
              {!app.isActive ? ' · متوقفة من المنصة' : ''}
            </p>
            {app.screens.length > 0 ? (
              <p className="muted" style={{ margin: 0 }} dir="ltr">
                {app.screens.join(' · ')}
              </p>
            ) : null}
            <button className={app.enabled ? 'btn' : 'btn primary'} type="button" disabled={busy === app.code || !app.isActive} onClick={() => toggle(app)}>
              {app.enabled ? 'إيقاف' : 'تفعيل'}
            </button>
          </article>
        ))}
      </div>
    </Screen>
  );
}

function messageOf(error: unknown): string {
  if (error instanceof ApiError) return error.detail || error.message;
  return error instanceof Error ? error.message : 'تعذر إكمال الطلب';
}
