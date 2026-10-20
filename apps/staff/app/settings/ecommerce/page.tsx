'use client';

import { Panel } from '@erp/ui';
import { useEffect, useMemo, useState } from 'react';

import { Notice } from '../../../components/data-view';
import { Empty, Screen } from '../../../components/screen';
import { apiErrorText } from '../../../lib/api';
import { useQuery } from '../../../lib/use-query';
import { branchOptions, listBranches, type Branch } from '../../../lib/lookups';
import {
  connectEcommerceStore,
  deleteEcommerceStore,
  ecommerceProviders,
  ecommerceStores,
  syncEcommerceStore,
  type EcommerceProvider,
  type EcommerceProviderView,
  type EcommerceStore,
} from '../../../lib/ecommerce';

const labels: Record<EcommerceProvider, string> = { salla: 'سلة', zid: 'زد', shopify: 'Shopify' };

export default function EcommerceSettingsPage() {
  const [providers, setProviders] = useState<EcommerceProviderView[]>([]);
  const [stores, setStores] = useState<EcommerceStore[]>([]);
  const [provider, setProvider] = useState<EcommerceProvider>('salla');
  const [apiKey, setApiKey] = useState('');
  const [storeUrl, setStoreUrl] = useState('');
  const [webhookSecret, setWebhookSecret] = useState('');
  const [branchId, setBranchId] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger' | 'info' | 'warn'; text: string }>();
  const branches = useQuery<Branch[]>(() => listBranches(), []);
  const branchChoices = useMemo(() => branchOptions(branches.data ?? []), [branches.data]);

  async function reload() {
    const [nextProviders, nextStores] = await Promise.all([ecommerceProviders(), ecommerceStores()]);
    setProviders(nextProviders);
    setStores(nextStores);
  }

  useEffect(() => {
    void reload().catch((error: unknown) => setNotice({ kind: 'danger', text: apiErrorText(error) }));
  }, []);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setNotice(undefined);
    try {
      await action();
      await reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error) });
    } finally {
      setBusy('');
    }
  }

  return (
    <Screen
      title="تكامل المتاجر الإلكترونية"
      subtitle="متجري في سلة · متجري في زد · Shopify — اربط المتجر، اختبر الرمز، ثم ابدأ مزامنة الطلبات والمخزون. مفاتيح الربط لا تُعرض بعد الحفظ."
      crumbs={['الإعدادات', 'التجارة الإلكترونية']}
      actions={<span className="badge">{stores.length} متجر مرتبط</span>}
    >
      <Notice notice={notice} />

      <Panel
        title={<>ربط متجر</>}
        hint={<>اختر المنصة وأدخل مفتاح الوصول؛ يُشفَّر المفتاح عند الحفظ ولا يُعرض بعدها.</>}
      >
        <div className="form-section">
          <div className="form-grid">
            <label className="field">
              <span>المزوّد</span>
              <select
                className="input"
                value={provider}
                onChange={(event) => setProvider(event.target.value as EcommerceProvider)}
              >
                {(providers.length
                  ? providers
                  : (['salla', 'zid', 'shopify'] as EcommerceProvider[]).map((value) => ({
                      provider: value,
                      label: labels[value],
                      supports: [],
                    }))
                ).map((item) => (
                  <option key={item.provider} value={item.provider}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field wide">
              <span>{provider === 'shopify' ? 'مفتاح الوصول' : 'مفتاح الربط أو رمز OAuth'}</span>
              <input
                className="input"
                dir="ltr"
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="يُشفّر ولا يُعرض بعد الحفظ"
              />
            </label>
            {provider === 'shopify' ? (
              <label className="field wide">
                <span>عنوان المتجر</span>
                <input
                  className="input"
                  dir="ltr"
                  value={storeUrl}
                  onChange={(event) => setStoreUrl(event.target.value)}
                  placeholder="https://shop.example.com"
                />
              </label>
            ) : null}
            <label className="field">
              <span>رمز التحقق من الإشعارات (اختياري)</span>
              <input
                className="input"
                dir="ltr"
                type="password"
                value={webhookSecret}
                onChange={(event) => setWebhookSecret(event.target.value)}
                placeholder="إن تركته فارغاً يُستخدم الرمز"
              />
            </label>
            <label className="field">
              <span>الفرع الافتراضي (اختياري)</span>
              <select
                className="input"
                value={branchId}
                onChange={(event) => setBranchId(event.target.value)}
              >
                <option value="">— بدون فرع افتراضي —</option>
                {branchChoices.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>
        <div className="panel-foot">
          <button
            className="btn primary"
            type="button"
            disabled={busy !== '' || apiKey.trim() === ''}
            onClick={() =>
              void run('connect', async () => {
                const saved = await connectEcommerceStore({
                  provider,
                  apiKey,
                  ...(storeUrl ? { storeUrl } : {}),
                  ...(webhookSecret ? { webhookSecret } : {}),
                  ...(branchId ? { settings: { branchId } } : {}),
                });
                setApiKey('');
                setWebhookSecret('');
                setNotice({
                  kind: saved.status === 'active' ? 'ok' : 'warn',
                  text:
                    saved.status === 'active'
                      ? `تم ربط متجر ${labels[provider]}`
                      : `تم الحفظ لكن حالة الرمز: ${saved.lastError ?? 'error'}`,
                });
              })
            }
          >
            ربط واختبار
          </button>
          {busy ? <span className="badge">جارٍ التنفيذ…</span> : null}
        </div>
      </Panel>

      <Panel
        title={<>المتاجر المرتبطة</>}
        hint={<>حالة كل متجر وآخر مزامنة، مع إمكانية المزامنة أو الفصل.</>}
        actions={
          <>
            <button className="btn" type="button" onClick={() => void run('reload', reload)}>
              تحديث
            </button>
          </>
        }
      >
        {stores.length === 0 ? (
          <Empty
            title="لا توجد متاجر مرتبطة"
            detail="اربط متجرك من النموذج أعلاه ليبدأ استيراد الطلبات والمخزون."
          />
        ) : (
          <div className="stack">
            {stores.map((store) => (
              <Panel key={store.id} className="inset">
                <div className="toolbar">
                  <div>
                    <strong>
                      {labels[store.provider]} —{' '}
                      <span dir="ltr">{store.storeUrl ?? store.remoteStoreId ?? store.id.slice(0, 8)}</span>
                    </strong>
                    <div className="muted">
                      الرمز: {store.accessTokenMasked} · آخر مزامنة:{' '}
                      {store.lastSyncAt ? new Date(store.lastSyncAt).toLocaleString('ar') : 'لم تبدأ'}
                    </div>
                  </div>
                  <span className={`badge ${store.status === 'active' ? 'ok' : 'warn'}`}>
                    {store.status === 'active' ? 'مفعّل' : 'يحتاج مراجعة'}
                  </span>
                </div>
                {store.lastError ? <p className="notice danger">{store.lastError}</p> : null}
                <div className="toolbar">
                  <button
                    className="btn primary"
                    type="button"
                    disabled={busy !== ''}
                    onClick={() =>
                      void run(`sync-${store.id}`, async () => {
                        const result = await syncEcommerceStore(store.id);
                        setNotice({
                          kind: result.failed ? 'warn' : 'ok',
                          text: `مزامنة الطلبات: جُلب ${result.fetched} · أُنشئ ${result.created} · استورد ${result.imported}`,
                        });
                      })
                    }
                  >
                    مزامنة الطلبات
                  </button>
                  <button
                    className="btn danger"
                    type="button"
                    disabled={busy !== ''}
                    onClick={() => {
                      if (window.confirm('حذف ربط المتجر؟'))
                        void run(`delete-${store.id}`, async () => deleteEcommerceStore(store.id));
                    }}
                  >
                    حذف الربط
                  </button>
                </div>
              </Panel>
            ))}
          </div>
        )}
      </Panel>
    </Screen>
  );
}
