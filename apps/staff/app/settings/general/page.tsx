'use client';

import { FormActions, FormGrid, Panel } from '@erp/ui';
import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';

import { ErrorBox, Forbidden, Loading, Screen } from '../../../components/screen';
import { Button } from '../../../components/ui/button';
import { Labeled } from '../../../components/ui/input';
import { Table } from '../../../components/ui/table';
import { Toggle } from '../../../components/ui/toggle';
import { apiData, apiErrorText, apiPut } from '../../../lib/api';
import { listUnits, type Unit } from '../../../lib/lookups';
import { useQuery } from '../../../lib/use-query';

type Settings = Record<string, unknown>;

/**
 * إعدادات الكاشير — نافذة `frmCasherSetting.xaml` (٣٠٧ أسطر) بترويساتها الحرفية:
 * «الباركود أوتوماتيك» (س239) · «تاتش سكرين» (س252) · «عرض المجموعات والأصناف» (س265) ·
 * «قيمة التوصيل» (س271) · «التأمين» (س279) · «الوحدة» (س287) — وزرّ «حفظ» (س300) هو
 * `PUT /settings/pos.*` نفسها. والشاشة تقرأ ما هو مكتوبٌ بالفعل وتعرضه بجانب حقوله، فلا
 * تظهر خانةٌ فارغة وكأنّ الإعداد غير قائم.
 */
const CASHER_FIELDS: Array<{
  key: string;
  label: string;
  kind: 'boolean' | 'number' | 'text';
  hint?: string;
}> = [
  // النصوص حرفيةٌ من `frmCasherSetting.xaml` — بالأيقونة واللفظ الذي يراه المشرف هناك.
  {
    key: 'sales.saveAsDraft',
    label: 'حفظ فاتورة المبيعات كمسودة قبل الترحيل',
    kind: 'boolean',
    hint: 'عند إيقاف هذا الخيار (الوضع الافتراضي السحابي)، يتم حفظ وترحيل فاتورة المبيعات فوراً وإصدار رقمها الضريبي وباركود QR مباشرة.',
  },
  {
    key: 'pos.barcodeAuto',
    label: 'الباركود أوتوماتيك',
    kind: 'boolean',
    hint: 'يُسجَّل الباركود تلقائياً عند فتح شاشة البيع.',
  },
  {
    key: 'pos.touchScreen',
    label: 'الشاشة تدعم التاتش سكرين',
    kind: 'boolean',
    hint: 'تكبير أزرار شاشة اللمس وتبسيط التنقل.',
  },
  {
    key: 'pos.showGroups',
    label: 'عرض المجموعات والأصناف',
    kind: 'boolean',
    hint: 'عرض المجموعات كأزرار سريعة أعلى لوحة الأصناف.',
  },
  { key: 'pos.defaultDeliveryFee', label: 'قيمة التوصيل الافتراضية', kind: 'number' },
  { key: 'pos.defaultInsurance', label: 'قيمة التأمين الافتراضية', kind: 'number' },
  { key: 'pos.defaultUnitId', label: 'الوحدة الافتراضية', kind: 'text' },
];

export default function GeneralSettingsPage() {
  const settings = useQuery<Settings>(() => apiData<Settings>('/settings'), []);
  const units = useQuery<Unit[]>(() => listUnits(), []);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger'; text: string } | undefined>();

  useEffect(() => {
    if (settings.status !== 'success') return;
    const next: Record<string, string> = {};
    for (const field of CASHER_FIELDS) {
      const value = settings.data?.[field.key];
      if (field.key === 'sales.saveAsDraft') {
        next[field.key] = value === true || value === 'true' ? 'true' : 'false';
      } else {
        next[field.key] = value === undefined || value === null ? '' : String(value);
      }
    }
    setDraft(next);
  }, [settings.status, settings.data]);

  async function saveCasher() {
    setBusy(true);
    setNotice(undefined);
    try {
      for (const field of CASHER_FIELDS) {
        const raw = draft[field.key] ?? '';
        const value =
          field.kind === 'boolean' ? raw === 'true' : field.kind === 'number' ? Number(raw || 0) : raw;
        await apiPut(`/settings/${field.key}`, { value });
      }
      setNotice({ kind: 'ok', text: 'تم حفظ إعدادات الكاشير.' });
      settings.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error) });
    } finally {
      setBusy(false);
    }
  }

  const entries = Object.entries(settings.data ?? {}).map(([key, value]) => ({ key, value }));

  return (
    <Screen
      title="إعدادات عامة"
      subtitle="الإعدادات المطبقة على هذه المنشأة (إعدادات الكاشير، العملة، الضريبة، سياسة الترقيم…)."
      crumbs={['الإعدادات', 'إعدادات عامة']}
      actions={
        <Button variant="secondary" onClick={settings.reload}>
          تحديث
        </Button>
      }
    >
      {settings.status === 'loading' && <Loading rows={5} />}
      {settings.status === 'forbidden' && <Forbidden />}
      {settings.status === 'error' && <ErrorBox message={settings.error} onRetry={settings.reload} />}
      {settings.status === 'success' && (
        <Panel title="إعدادات الكاشير" hint="تُطبَّق مباشرة على شاشة نقطة البيع.">
          <FormGrid cols={3}>
            {CASHER_FIELDS.filter((field) => field.kind === 'boolean').map((field) => (
              <Toggle
                key={field.key}
                label={field.label}
                hint={field.hint}
                checked={draft[field.key] !== 'false'}
                onChange={(checked) => setDraft((current) => ({ ...current, [field.key]: String(checked) }))}
              />
            ))}
          </FormGrid>
          <FormGrid cols={3} className="mt-4">
            {CASHER_FIELDS.filter((field) => field.kind !== 'boolean').map((field) =>
              field.key === 'pos.defaultUnitId' ? (
                <Labeled key={field.key} label={field.label}>
                  <select
                    className="input"
                    value={draft[field.key] ?? ''}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, [field.key]: event.target.value }))
                    }
                  >
                    <option value="">بلا وحدة افتراضية</option>
                    {(units.data ?? []).map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.nameAr ?? unit.name_ar ?? unit.code}
                      </option>
                    ))}
                  </select>
                </Labeled>
              ) : (
                <Labeled key={field.key} label={field.label}>
                  <input
                    dir={field.kind === 'number' ? 'ltr' : undefined}
                    inputMode={field.kind === 'number' ? 'decimal' : undefined}
                    value={draft[field.key] ?? ''}
                    placeholder={field.kind === 'number' ? '0.00' : undefined}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, [field.key]: event.target.value }))
                    }
                    className="input"
                  />
                </Labeled>
              ),
            )}
          </FormGrid>
          <FormActions
            note={
              notice ? (
                <span className={notice.kind === 'ok' ? 'text-ok-ink' : 'text-danger'}>{notice.text}</span>
              ) : (
                'الحفظ يحدّث كل المفاتيح أعلاه دفعة واحدة.'
              )
            }
          >
            <Button
              variant="primary"
              icon={<Save size={15} />}
              loading={busy}
              onClick={() => void saveCasher()}
            >
              حفظ
            </Button>
          </FormActions>
        </Panel>
      )}

      {settings.status === 'success' && (
        <Panel
          flush
          title={`كل المفاتيح المخزنة (${entries.length})`}
          hint="مراجعة متقدمة للمفاتيح التي يقرؤها النظام — لا تُعدَّل من هنا."
        >
          <Table
            rows={entries}
            rowKey={(row) => row.key}
            dense
            columns={[
              {
                key: 'key',
                header: 'المفتاح',
                ltr: true,
                width: 260,
                cell: (row) => <span className="font-semibold text-ink-2">{row.key}</span>,
              },
              {
                key: 'value',
                header: 'القيمة',
                ltr: true,
                cell: (row) => (
                  <span className="text-[12.5px] text-ink-2 break-all">
                    {typeof row.value === 'object' && row.value !== null
                      ? JSON.stringify(row.value)
                      : String(row.value)}
                  </span>
                ),
              },
            ]}
          />
        </Panel>
      )}
    </Screen>
  );
}
