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

/**
 * R-47: ترقيم المستندات المخصص — بادئة ورقم البداية لكل عائلة مستندات.
 * عميلٌ انتقل من نظامٍ آخر يريد متابعة تسلسل فواتيره: يضع «رقم البداية» = آخر رقم
 * أصدره + ١ في النظام القديم، ويُصدَر الرقم التالي تلقائياً.
 */
const NUMBERING_GROUPS: Array<{
  title: string;
  hint: string;
  fields: Array<{ key: string; label: string; kind: 'text' | 'number'; hint?: string }>;
}> = [
  {
    title: 'فواتير المبيعات',
    hint: 'ترقيم فواتير المبيعات (المستندات نوع بيع).',
    fields: [
      {
        key: 'invoice.number_prefix',
        label: 'البادئة',
        kind: 'text',
        hint: 'مثال: SI- أو INV-',
      },
      {
        key: 'invoice.padding',
        label: 'عدد الأصفار',
        kind: 'number',
        hint: 'مثال: 6 يعني 000001',
      },
      {
        key: 'invoice.start_at',
        label: 'رقم البداية',
        kind: 'number',
        hint: 'الرقم التالي لإصدار الفواتير (متابعة تسلسل نظامٍ سابق).',
      },
    ],
  },
  {
    title: 'طلبات نقاط البيع',
    hint: 'ترقيم طلبات الكاشير (يُضاف له اليوم التجاري).',
    fields: [
      {
        key: 'pos.number_prefix',
        label: 'البادئة',
        kind: 'text',
        hint: 'مثال: POS- (يُلحق به اليوم).',
      },
      { key: 'pos.padding', label: 'عدد الأصفار', kind: 'number' },
      {
        key: 'pos.start_at',
        label: 'رقم البداية',
        kind: 'number',
        hint: 'يُبدأ كل يوم تجاري من هذا الرقم.',
      },
    ],
  },
  {
    title: 'فواتير المشتريات',
    hint: 'ترقيم فواتير المشتريات (والمستندات ذات الصلة).',
    fields: [
      {
        key: 'purchases.number_prefix',
        label: 'البادئة',
        kind: 'text',
        hint: 'مثال: PI- أو PO-',
      },
      { key: 'purchases.padding', label: 'عدد الأصفار', kind: 'number' },
      {
        key: 'purchases.start_at',
        label: 'رقم البداية',
        kind: 'number',
        hint: 'الرقم التالي لإصدار فواتير المشتريات.',
      },
    ],
  },
];

/** العربية لكل مفتاح — تُعرض في جدول «كل المفاتيح المخزنة» بدل المفتاح الإنجليزي. */
const KEY_LABELS: Record<string, string> = {
  'allow_negative_stock': 'السماح بحركة مخزون سالبة',
  'default_currency_code': 'عملة افتراضية',
  'fiscal_year_start_month': 'شهر بدء السنة المالية',
  timezone: 'المنطقة الزمنية',
  'branding.primary_color': 'لون العلامة الرئيسي',
  'purchases.require_return_reference': 'اشتراط مرجع مردود المشتريات',
  'invoice.number_prefix': 'بادئة فواتير المبيعات',
  'invoice.padding': 'تعبئة فواتير المبيعات',
  'invoice.start_at': 'رقم بداية فواتير المبيعات',
  'money.rounding_digits': 'أرقام التقريب المالية',
  'pricing.price_includes_vat': 'شمول السعر للضريبة',
  'sales.saveAsDraft': 'حفظ المبيعات كمسودة',
  'vat.default_rate_percent': 'نسبة الضريبة الافتراضية',
  'locale.timezone': 'منطقة زمنية',
  'locale.code': 'لغة العرض',
  'pos.barcodeAuto': 'الباركود أوتوماتيك',
  'pos.touchScreen': 'شاشة تاتش',
  'pos.showGroups': 'عرض المجموعات',
  'pos.defaultDeliveryFee': 'توصيل افتراضي',
  'pos.defaultInsurance': 'تأمين افتراضي',
  'pos.defaultUnitId': 'وحدة افتراضية',
  'pos.requireShift': 'اشتراط فتح دورة',
  'pos.number_prefix': 'بادئة طلبات الكاشير',
  'pos.padding': 'تعبئة طلبات الكاشير',
  'pos.start_at': 'رقم بداية طلبات الكاشير',
  'feature.pos': 'حزمة الكاشير',
  'feature.projects': 'حزمة المشروعات',
  'feature.hrm': 'حزمة الموارد البشرية',
  'feature.niche': 'حزمة التخصصات',
  'purchases.number_prefix': 'بادئة فواتير المشتريات',
  'purchases.padding': 'تعبئة فواتير المشتريات',
  'purchases.start_at': 'رقم بداية فواتير المشتريات',
};

export default function GeneralSettingsPage() {
  const settings = useQuery<Settings>(() => apiData<Settings>('/settings'), []);
  const units = useQuery<Unit[]>(() => listUnits(), []);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [numberingDraft, setNumberingDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger'; text: string } | undefined>();

  useEffect(() => {
    if (settings.status !== 'success') return;
    const next: Record<string, string> = {};
    for (const field of CASHER_FIELDS) {
      const value = settings.data?.[field.key];
      if (field.kind === 'boolean') {
        next[field.key] = value === true || value === 'true' ? 'true' : 'false';
      } else {
        next[field.key] = value === undefined || value === null ? '' : String(value);
      }
    }
    setDraft(next);
  }, [settings.status, settings.data]);

  useEffect(() => {
    if (settings.status !== 'success') return;
    const next: Record<string, string> = {};
    for (const group of NUMBERING_GROUPS) {
      for (const field of group.fields) {
        const value = settings.data?.[field.key];
        next[field.key] = value === undefined || value === null ? '' : String(value);
      }
    }
    setNumberingDraft(next);
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

  async function saveNumbering() {
    setBusy(true);
    setNotice(undefined);
    try {
      for (const group of NUMBERING_GROUPS) {
        for (const field of group.fields) {
          const raw = numberingDraft[field.key] ?? '';
          const value = field.kind === 'number' ? Number(raw || 0) : raw;
          await apiPut(`/settings/${field.key}`, { value });
        }
      }
      setNotice({ kind: 'ok', text: 'تم حفظ إعدادات الترقيم.' });
      settings.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error) });
    } finally {
      setBusy(false);
    }
  }

  const entries = Object.entries(settings.data ?? {}).map(([key, value]) => ({ key, value }));

  function formatSettingValue(key: string, value: unknown): string {
    if (key === 'pos.defaultUnitId' && typeof value === 'string' && value) {
      const unit = (units.data ?? []).find((u) => u.id === value);
      if (unit) return unit.nameAr ?? unit.name_ar ?? unit.code;
    }
    if (typeof value === 'boolean') return value ? 'نعم' : 'لا';
    if (typeof value === 'object' && value !== null) return JSON.stringify(value);
    return String(value);
  }

  return (
    <Screen
      title="إعدادات عامة"
      subtitle="الإعدادات المطبقة على هذه المنشأة (إعدادات الكاشير، الترقيم، العملة، الضريبة، سياسة الترقيم…)."
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
        <Panel title="ترقيم المستندات" hint="تخصيص الترقيم لفواتير المبيعات، طلبات نقاط البيع، وفواتير المشتريات.">
          {NUMBERING_GROUPS.map((group) => (
            <div key={group.title} className="mb-5">
              <div className="mb-2 text-sm font-bold text-ink">
                {group.title}
                <span className="ml-2 text-xs font-normal text-muted">{group.hint}</span>
              </div>
              <FormGrid cols={3}>
                {group.fields.map((field) => (
                  <Labeled key={field.key} label={field.label} hint={field.hint}>
                    <input
                      dir={field.kind === 'number' ? 'ltr' : undefined}
                      inputMode={field.kind === 'number' ? 'numeric' : undefined}
                      value={numberingDraft[field.key] ?? ''}
                      placeholder={field.kind === 'number' ? '0' : ''}
                      onChange={(event) =>
                        setNumberingDraft((current) => ({ ...current, [field.key]: event.target.value }))
                      }
                      className="input"
                    />
                  </Labeled>
                ))}
              </FormGrid>
            </div>
          ))}
          <FormActions
            note={
              notice ? (
                <span className={notice.kind === 'ok' ? 'text-ok-ink' : 'text-danger'}>{notice.text}</span>
              ) : (
                'الحفظ يحدّث كل خيارات الترقيم أعلاه دفعة واحدة.'
              )
            }
          >
            <Button
              variant="primary"
              icon={<Save size={15} />}
              loading={busy}
              onClick={() => void saveNumbering()}
            >
              حفظ الترقيم
            </Button>
          </FormActions>
        </Panel>
      )}

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
                ltr: false,
                width: 280,
                cell: (row) => (
                  <span className="font-semibold text-ink-2">
                    {KEY_LABELS[row.key] ?? row.key}
                    <span className="ml-2 text-[11px] font-normal text-muted">{row.key}</span>
                  </span>
                ),
              },
              {
                key: 'value',
                header: 'القيمة',
                ltr: false,
                cell: (row) => (
                  <span className="text-[12.5px] text-ink-2 break-all">
                    {formatSettingValue(row.key, row.value)}
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
