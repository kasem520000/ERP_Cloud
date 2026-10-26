'use client';

import { FormActions, FormGrid, Panel } from '@erp/ui';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Building2, Printer, Save } from 'lucide-react';

import { ErrorBox, Forbidden, Loading, Screen } from '../../../components/screen';
import { Button } from '../../../components/ui/button';
import { Labeled } from '../../../components/ui/input';
import { Table } from '../../../components/ui/table';
import { Toggle } from '../../../components/ui/toggle';
import { apiData, apiErrorText, apiPut } from '../../../lib/api';
import { listUnits, type Unit } from '../../../lib/lookups';
import { useQuery } from '../../../lib/use-query';

import { extractEffectiveSettings, type SettingsPayload } from './settings-helpers';

const POLICY_FIELDS: Array<{
  key: string;
  label: string;
  kind: 'boolean' | 'number' | 'text';
  defaultValue: boolean | number | string;
  hint?: string;
}> = [
  {
    key: 'allow_negative_stock',
    label: 'السماح بحركة مخزون سالبة',
    kind: 'boolean',
    defaultValue: false,
    hint: 'عند التفعيل يُسمح بترحيل المستندات حتى لو انخفض رصيد الصنف دون الصفر.',
  },
  {
    key: 'purchases.require_return_reference',
    label: 'اشتراط مرجع فاتورة لمرتجع المشتريات',
    kind: 'boolean',
    defaultValue: true,
    hint: 'يلزم ربط مرتجع المورد بفاتورة شراء مرحّلة لضبط سقف الكمية والسعر.',
  },
  {
    key: 'pricing.price_includes_vat',
    label: 'شمول الأسعار لضريبة القيمة المضافة افتراضياً',
    kind: 'boolean',
    defaultValue: false,
    hint: 'القيمة الافتراضية لخيار «السعر شامل الضريبة» عند إنشاء مستند جديد.',
  },
  {
    key: 'pos.requireShift',
    label: 'اشتراط فتح وردية قبل البيع النقدي',
    kind: 'boolean',
    defaultValue: false,
    hint: 'يلزم أمين الصندوق بفتح وردية كاشير نشطة قبل إصدار طلبات نقطة البيع.',
  },
  {
    key: 'vat.default_rate_percent',
    label: 'نسبة الضريبة الافتراضية (%)',
    kind: 'number',
    defaultValue: 15,
    hint: 'تُطبَّق تلقائياً عند عدم تحديد مجموعة ضريبية للصنف (0 إلى 100).',
  },
  {
    key: 'fiscal_year_start_month',
    label: 'شهر بداية السنة المالية (1 - 12)',
    kind: 'number',
    defaultValue: 1,
    hint: '1 = يناير، 12 = ديسمبر.',
  },
  {
    key: 'money.rounding_digits',
    label: 'عدد خانات التقريب المالية',
    kind: 'number',
    defaultValue: 2,
    hint: 'عدد الخانات العشرية المعتمدة لتقريب المبالغ (عادةً 2).',
  },
];

const CASHER_FIELDS: Array<{
  key: string;
  label: string;
  kind: 'boolean' | 'number' | 'text';
  defaultValue: boolean | number | string;
  hint?: string;
}> = [
  {
    key: 'sales.saveAsDraft',
    label: 'حفظ فاتورة المبيعات كمسودة قبل الترحيل',
    kind: 'boolean',
    defaultValue: false,
    hint: 'عند إيقاف هذا الخيار (الوضع الافتراضي السحابي)، يتم حفظ وترحيل فاتورة المبيعات فوراً وإصدار رقمها الضريبي وباركود QR مباشرة.',
  },
  {
    key: 'pos.barcodeAuto',
    label: 'الباركود أوتوماتيك',
    kind: 'boolean',
    defaultValue: true,
    hint: 'تركيز المؤشر تلقائياً في حقل الباركود عند فتح شاشة البيع.',
  },
  {
    key: 'pos.touchScreen',
    label: 'واجهة شاشة اللمس',
    kind: 'boolean',
    defaultValue: false,
    hint: 'تكبير أزرار الأصناف وتبسيط التنقل لشاشات اللمس.',
  },
  {
    key: 'pos.showGroups',
    label: 'عرض المجموعات والأصناف',
    kind: 'boolean',
    defaultValue: true,
    hint: 'عرض مجموعات الأصناف كأزرار سريعة أعلى لوحة نقطة البيع.',
  },
  { key: 'pos.defaultDeliveryFee', label: 'قيمة التوصيل الافتراضية', kind: 'number', defaultValue: 0 },
  { key: 'pos.defaultInsurance', label: 'قيمة التأمين الافتراضية', kind: 'number', defaultValue: 0 },
  { key: 'pos.defaultUnitId', label: 'الوحدة الافتراضية', kind: 'text', defaultValue: '' },
];

const NUMBERING_GROUPS: Array<{
  title: string;
  hint: string;
  fields: Array<{
    key: string;
    label: string;
    kind: 'text' | 'number';
    defaultValue: string | number;
    requiredNonEmpty?: boolean;
    min?: number;
    max?: number;
    hint?: string;
  }>;
}> = [
  {
    title: 'فواتير المبيعات',
    hint: 'ترقيم فواتير المبيعات الضريبية والمبسّطة.',
    fields: [
      {
        key: 'invoice.number_prefix',
        label: 'البادئة',
        kind: 'text',
        defaultValue: 'SI-',
        requiredNonEmpty: true,
        hint: 'مثال: SI- أو INV-',
      },
      {
        key: 'invoice.padding',
        label: 'عدد الأصفار',
        kind: 'number',
        defaultValue: 6,
        min: 1,
        max: 20,
        hint: 'مثال: 6 يعني 000001',
      },
      {
        key: 'invoice.start_at',
        label: 'رقم البداية',
        kind: 'number',
        defaultValue: 1,
        min: 1,
        hint: 'الرقم التالي لإصدار الفواتير (متابعة تسلسل سابق).',
      },
    ],
  },
  {
    title: 'طلبات نقاط البيع',
    hint: 'ترقيم طلبات الكاشير (يُلحق به تاريخ اليوم التجاري).',
    fields: [
      {
        key: 'pos.number_prefix',
        label: 'البادئة',
        kind: 'text',
        defaultValue: 'POS-',
        hint: 'مثال: POS- (يُلحق به اليوم).',
      },
      { key: 'pos.padding', label: 'عدد الأصفار', kind: 'number', defaultValue: 4, min: 1, max: 20 },
      {
        key: 'pos.start_at',
        label: 'رقم البداية',
        kind: 'number',
        defaultValue: 1,
        min: 1,
        hint: 'يبدأ كل يوم تجاري من هذا الرقم.',
      },
    ],
  },
  {
    title: 'فواتير المشتريات',
    hint: 'ترقيم فواتير المشتريات والمستندات المرتبطة بها.',
    fields: [
      {
        key: 'purchases.number_prefix',
        label: 'البادئة',
        kind: 'text',
        defaultValue: 'PI-',
        hint: 'مثال: PI- أو PO-',
      },
      { key: 'purchases.padding', label: 'عدد الأصفار', kind: 'number', defaultValue: 6, min: 1, max: 20 },
      {
        key: 'purchases.start_at',
        label: 'رقم البداية',
        kind: 'number',
        defaultValue: 1,
        min: 1,
        hint: 'الرقم التالي لإصدار فواتير المشتريات.',
      },
    ],
  },
];

/** التسميات العربية الكاملة لكل مفتاح مسجّل في إعدادات المنشأة. */
const KEY_LABELS: Record<string, string> = {
  allow_negative_stock: 'السماح بحركة مخزون سالبة',
  default_currency_code: 'العملة الافتراضية',
  fiscal_year_start_month: 'شهر بدء السنة المالية',
  timezone: 'المنطقة الزمنية الأساسية',
  'branding.primary_color': 'لون الهوية الرئيسي',
  'purchases.require_return_reference': 'اشتراط مرجع لمرتجع المشتريات',
  'invoice.number_prefix': 'بادئة فواتير المبيعات',
  'invoice.padding': 'عدد أصفار فواتير المبيعات',
  'invoice.start_at': 'رقم بداية فواتير المبيعات',
  'money.rounding_digits': 'خانات التقريب المالية',
  'pricing.price_includes_vat': 'شمول الأسعار للضريبة',
  'sales.saveAsDraft': 'حفظ فاتورة المبيعات كمسودة',
  'vat.default_rate_percent': 'نسبة الضريبة الافتراضية (%)',
  'locale.timezone': 'المنطقة الزمنية للتقارير والتاريخ التجاري',
  'locale.code': 'لغة العرض الافتراضية',
  'pos.barcodeAuto': 'الباركود أوتوماتيك في الكاشير',
  'pos.touchScreen': 'واجهة شاشة اللمس في الكاشير',
  'pos.showGroups': 'عرض المجموعات في الكاشير',
  'pos.defaultDeliveryFee': 'رسوم التوصيل الافتراضية',
  'pos.defaultInsurance': 'قيمة التأمين الافتراضية',
  'pos.defaultUnitId': 'الوحدة الافتراضية للكاشير',
  'pos.requireShift': 'اشتراط فتح وردية كاشير',
  'pos.number_prefix': 'بادئة طلبات نقاط البيع',
  'pos.padding': 'عدد أصفار طلبات نقاط البيع',
  'pos.start_at': 'رقم بداية طلبات نقاط البيع',
  'feature.pos': 'تفعيل حزمة نقاط البيع',
  'feature.projects': 'تفعيل حزمة المشاريع والمقاولات',
  'feature.hrm': 'تفعيل حزمة الموارد البشرية والرواتب',
  'feature.niche': 'تفعيل حزمة الأنشطة المتخصصة',
  'purchases.number_prefix': 'بادئة فواتير المشتريات',
  'purchases.padding': 'عدد أصفار فواتير المشتريات',
  'purchases.start_at': 'رقم بداية فواتير المشتريات',
  'van_sales.policy.allowInternalDeliveryWithoutTax': 'السماح بإشعار تسليم داخلي دون ضريبة (التوزيع)',
  'report.return_policy': 'نص سياسة الاسترجاع والاستبدال في الفواتير',
  'report.default_notes': 'ملاحظات الفواتير الافتراضية',
  'report.field_ar': 'مجال عمل المنشأة بالعربية (ترويسة التقارير)',
  'report.field_en': 'مجال عمل المنشأة بالإنجليزية (ترويسة التقارير)',
  'report.address_ar': 'عنوان المنشأة المختصر بالعربية (ترويسة وتذييل التقارير)',
  'report.address_en': 'عنوان المنشأة المختصر بالإنجليزية (ترويسة الفواتير A4)',
  'report.crn': 'الرقم الموحد (700) / السجل الفرعي في جدول العنوان الوطني',
  'report.bank1_name': 'البنك الأول في الفواتير الضريبية A4',
  'report.bank1_iban': 'آيبان / حساب البنك الأول',
  'report.bank2_name': 'البنك الثاني في الفواتير الضريبية A4',
  'report.bank2_iban': 'آيبان / حساب البنك الثاني',
  'report.bank3_name': 'البنك الثالث في الفواتير الضريبية A4',
  'report.bank3_iban': 'آيبان / حساب البنك الثالث',
  'report.stamp_url': 'رابط صورة ختم المنشأة الرسمي',
};

const REPORT_DATA_KEYS = [
  'report.return_policy',
  'report.default_notes',
  'report.field_ar',
  'report.field_en',
  'report.address_ar',
  'report.address_en',
  'report.crn',
  'report.bank1_name',
  'report.bank1_iban',
  'report.bank2_name',
  'report.bank2_iban',
  'report.bank3_name',
  'report.bank3_iban',
  'report.stamp_url',
] as const;

export default function GeneralSettingsPage() {
  const settings = useQuery<SettingsPayload>(() => apiData<SettingsPayload>('/settings'), []);
  const units = useQuery<Unit[]>(() => listUnits(), []);
  const [policyDraft, setPolicyDraft] = useState<Record<string, string>>({});
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [numberingDraft, setNumberingDraft] = useState<Record<string, string>>({});
  const [reportDraft, setReportDraft] = useState<Record<string, string>>({});
  const [busySection, setBusySection] = useState<'policies' | 'numbering' | 'cashier' | 'reports' | null>(null);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger'; text: string } | undefined>();

  const effectiveSettings = useMemo(() => extractEffectiveSettings(settings.data), [settings.data]);

  useEffect(() => {
    if (settings.status !== 'success') return;
    const nextPolicies: Record<string, string> = {};
    for (const field of POLICY_FIELDS) {
      const value = effectiveSettings[field.key] ?? field.defaultValue;
      if (field.kind === 'boolean') {
        nextPolicies[field.key] = value === true || value === 'true' ? 'true' : 'false';
      } else {
        nextPolicies[field.key] = value === undefined || value === null ? '' : String(value);
      }
    }
    setPolicyDraft(nextPolicies);

    const nextCashier: Record<string, string> = {};
    for (const field of CASHER_FIELDS) {
      const value = effectiveSettings[field.key] ?? field.defaultValue;
      if (field.kind === 'boolean') {
        nextCashier[field.key] = value === true || value === 'true' ? 'true' : 'false';
      } else {
        nextCashier[field.key] = value === undefined || value === null ? '' : String(value);
      }
    }
    setDraft(nextCashier);

    const nextNumbering: Record<string, string> = {};
    for (const group of NUMBERING_GROUPS) {
      for (const field of group.fields) {
        const value = effectiveSettings[field.key] ?? field.defaultValue;
        nextNumbering[field.key] = value === undefined || value === null ? '' : String(value);
      }
    }
    setNumberingDraft(nextNumbering);

    const nextReport: Record<string, string> = {};
    for (const key of REPORT_DATA_KEYS) {
      const value = effectiveSettings[key];
      nextReport[key] = value === undefined || value === null ? '' : String(value);
    }
    setReportDraft(nextReport);
  }, [settings.status, effectiveSettings]);

  async function savePolicies() {
    setBusySection('policies');
    setNotice(undefined);
    try {
      const vatRate = Number(policyDraft['vat.default_rate_percent'] ?? 15);
      if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) {
        setNotice({ kind: 'danger', text: 'نسبة الضريبة الافتراضية يجب أن تكون بين 0 و 100.' });
        return;
      }
      const fiscalMonth = Number(policyDraft['fiscal_year_start_month'] ?? 1);
      if (!Number.isInteger(fiscalMonth) || fiscalMonth < 1 || fiscalMonth > 12) {
        setNotice({ kind: 'danger', text: 'شهر بداية السنة المالية يجب أن يكون رقماً صحيحاً بين 1 و 12.' });
        return;
      }
      const roundingDigits = Number(policyDraft['money.rounding_digits'] ?? 2);
      if (!Number.isInteger(roundingDigits) || roundingDigits < 0 || roundingDigits > 6) {
        setNotice({ kind: 'danger', text: 'عدد خانات التقريب المالية يجب أن يكون بين 0 و 6.' });
        return;
      }

      for (const field of POLICY_FIELDS) {
        const raw = policyDraft[field.key] ?? String(field.defaultValue);
        const value =
          field.kind === 'boolean' ? raw === 'true' : field.kind === 'number' ? Number(raw) : raw.trim();
        await apiPut(`/settings/${encodeURIComponent(field.key)}`, { value });
      }
      await settings.reload();
      setNotice({ kind: 'ok', text: 'تم حفظ السياسات العامة للمنشأة بنجاح.' });
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error, 'تعذر حفظ السياسات العامة') });
    } finally {
      setBusySection(null);
    }
  }

  async function saveCasher() {
    setBusySection('cashier');
    setNotice(undefined);
    try {
      for (const field of CASHER_FIELDS) {
        const raw = draft[field.key] ?? '';
        let value: boolean | number | string;
        if (field.kind === 'boolean') {
          value = raw === 'true';
        } else if (field.kind === 'number') {
          const parsed = raw.trim() === '' ? 0 : Number(raw);
          if (!Number.isFinite(parsed) || parsed < 0) {
            setNotice({ kind: 'danger', text: `أدخل قيمة رقمية صحيحة لحقل «${field.label}».` });
            return;
          }
          value = parsed;
        } else {
          value = raw.trim();
        }
        await apiPut(`/settings/${encodeURIComponent(field.key)}`, { value });
      }
      await settings.reload();
      setNotice({ kind: 'ok', text: 'تم حفظ إعدادات الكاشير والمبيعات بنجاح.' });
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error, 'تعذر حفظ إعدادات الكاشير') });
    } finally {
      setBusySection(null);
    }
  }

  async function saveNumbering() {
    setBusySection('numbering');
    setNotice(undefined);
    try {
      const updates: Array<{ key: string; value: string | number }> = [];
      for (const group of NUMBERING_GROUPS) {
        for (const field of group.fields) {
          const raw = (numberingDraft[field.key] ?? '').trim();
          if (field.kind === 'number') {
            const parsed = raw === '' ? Number(field.defaultValue) : Number(raw);
            if (
              !Number.isInteger(parsed) ||
              (field.min !== undefined && parsed < field.min) ||
              (field.max !== undefined && parsed > field.max)
            ) {
              setNotice({
                kind: 'danger',
                text: `قيمة «${field.label}» في قسم «${group.title}» يجب أن تكون رقماً صحيحاً لا يقل عن ${field.min ?? 1}.`,
              });
              return;
            }
            updates.push({ key: field.key, value: parsed });
          } else {
            if (field.requiredNonEmpty && raw.length === 0) {
              setNotice({
                kind: 'danger',
                text: `حقل «${field.label}» في قسم «${group.title}» مطلوب ولا يمكن تركه فارغاً.`,
              });
              return;
            }
            if (raw.length > 12) {
              setNotice({
                kind: 'danger',
                text: `حقل «${field.label}» في قسم «${group.title}» يجب ألا يتجاوز 12 حرفاً.`,
              });
              return;
            }
            updates.push({ key: field.key, value: raw });
          }
        }
      }
      for (const item of updates) {
        await apiPut(`/settings/${encodeURIComponent(item.key)}`, { value: item.value });
      }
      await settings.reload();
      setNotice({ kind: 'ok', text: 'تم حفظ إعدادات الترقيم بنجاح.' });
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error, 'تعذر حفظ إعدادات الترقيم') });
    } finally {
      setBusySection(null);
    }
  }

  async function saveReportData() {
    setBusySection('reports');
    setNotice(undefined);
    try {
      for (const key of REPORT_DATA_KEYS) {
        const raw = (reportDraft[key] ?? '').trim();
        await apiPut(`/settings/${encodeURIComponent(key)}`, { value: raw });
      }
      await settings.reload();
      setNotice({ kind: 'ok', text: 'تم حفظ بيانات التقارير والفواتير وسياسة الإرجاع بنجاح.' });
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error, 'تعذر حفظ بيانات التقارير والفواتير') });
    } finally {
      setBusySection(null);
    }
  }

  const entries = useMemo(
    () =>
      Object.entries(effectiveSettings)
        .filter(([key, value]) => key !== 'settings' && key !== 'registry' && (typeof value !== 'object' || value === null))
        .map(([key, value]) => ({ key, label: KEY_LABELS[key] ?? key, value })),
    [effectiveSettings],
  );

  function formatSettingValue(key: string, value: unknown): string {
    if (key === 'pos.defaultUnitId') {
      if (!value || (typeof value === 'string' && value.trim() === '')) return 'غير محدد';
      if (typeof value === 'string') {
        const unit = (units.data ?? []).find((u) => u.id === value);
        if (unit) return unit.nameAr ?? unit.name_ar ?? unit.code;
      }
    }
    if (key === 'locale.code') {
      if (value === 'ar') return 'العربية';
      if (value === 'en') return 'الإنجليزية';
    }
    if (typeof value === 'boolean') return value ? 'مفعّل (نعم)' : 'غير مفعّل (لا)';
    if (value === null || value === undefined || value === '') return '—';
    return String(value);
  }

      return (
    <Screen
      title="إعدادات عامة"
      subtitle="السياسات العامة للمنشأة، ترقيم المستندات، إعدادات الكاشير، وبيانات التقارير والفواتير وسياسة الإرجاع."
      crumbs={['الإعدادات', 'إعدادات عامة']}
      actions={
        <Button variant="secondary" onClick={() => void settings.reload()}>
          تحديث
        </Button>
      }
    >
      {notice ? (
        <div
          role={notice.kind === 'danger' ? 'alert' : 'status'}
          className={`mb-4 rounded-xl border px-4 py-3 text-[13px] font-semibold ${
            notice.kind === 'ok'
              ? 'border-ok-line bg-ok-soft text-ok-ink'
              : 'border-danger-line bg-danger-soft text-danger-ink'
          }`}
        >
          {notice.text}
        </div>
      ) : null}

      {settings.status === 'loading' && <Loading rows={5} />}
      {settings.status === 'forbidden' && <Forbidden />}
      {settings.status === 'error' && <ErrorBox message={settings.error} onRetry={settings.reload} />}

      {settings.status === 'success' && (
        <Panel
          title="السياسات المحاسبية والمخزنية والضريبية"
          hint="الضوابط الافتراضية لحركة المخزون والمرتجعات والضريبة والسنة المالية."
        >
          <FormGrid cols={2}>
            {POLICY_FIELDS.filter((field) => field.kind === 'boolean').map((field) => (
              <Toggle
                key={field.key}
                label={field.label}
                hint={field.hint}
                checked={policyDraft[field.key] === 'true'}
                onChange={(checked) =>
                  setPolicyDraft((current) => ({ ...current, [field.key]: String(checked) }))
                }
              />
            ))}
          </FormGrid>
          <FormGrid cols={3} className="mt-4">
            {POLICY_FIELDS.filter((field) => field.kind !== 'boolean').map((field) => (
              <Labeled key={field.key} label={field.label} hint={field.hint}>
                <input
                  dir="ltr"
                  inputMode="decimal"
                  value={policyDraft[field.key] ?? ''}
                  onChange={(event) =>
                    setPolicyDraft((current) => ({ ...current, [field.key]: event.target.value }))
                  }
                  className="input"
                />
              </Labeled>
            ))}
          </FormGrid>
          <FormActions note="يُطبَّق التغيير فوراً على المستندات الجديدة بعد الحفظ.">
            <Button
              variant="primary"
              icon={<Save size={15} />}
              loading={busySection === 'policies'}
              disabled={busySection !== null}
              onClick={() => void savePolicies()}
            >
              حفظ السياسات العامة
            </Button>
          </FormActions>
        </Panel>
      )}

      {settings.status === 'success' && (
        <Panel title="ترقيم المستندات" hint="تخصيص البادئة ورقم البداية لفواتير المبيعات وطلبات الكاشير وفواتير المشتريات.">
          {NUMBERING_GROUPS.map((group) => (
            <div key={group.title} className="mb-5">
              <div className="mb-2 text-sm font-bold text-ink">
                {group.title}
                <span className="mr-2 text-xs font-normal text-muted">{group.hint}</span>
              </div>
              <FormGrid cols={3}>
                {group.fields.map((field) => (
                  <Labeled key={field.key} label={field.label} hint={field.hint}>
                    <input
                      dir="ltr"
                      inputMode={field.kind === 'number' ? 'numeric' : undefined}
                      value={numberingDraft[field.key] ?? ''}
                      placeholder={String(field.defaultValue)}
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
          <FormActions note="الحفظ يحدّث خيارات الترقيم أعلاه ويرفع التسلسل للأمام عند زيادة رقم البداية.">
            <Button
              variant="primary"
              icon={<Save size={15} />}
              loading={busySection === 'numbering'}
              disabled={busySection !== null}
              onClick={() => void saveNumbering()}
            >
              حفظ الترقيم
            </Button>
          </FormActions>
        </Panel>
      )}

      {settings.status === 'success' && (
        <Panel title="إعدادات الكاشير والمبيعات" hint="تُطبَّق مباشرة على شاشة نقطة البيع وفواتير المبيعات.">
          <FormGrid cols={2}>
            {CASHER_FIELDS.filter((field) => field.kind === 'boolean').map((field) => (
              <Toggle
                key={field.key}
                label={field.label}
                hint={field.hint}
                checked={draft[field.key] === 'true'}
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
                    dir="ltr"
                    inputMode="decimal"
                    value={draft[field.key] ?? ''}
                    placeholder="0.00"
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, [field.key]: event.target.value }))
                    }
                    className="input"
                  />
                </Labeled>
              ),
            )}
          </FormGrid>
          <FormActions note="الحفظ يحدّث خيارات الكاشير والمبيعات أعلاه دفعة واحدة.">
            <Button
              variant="primary"
              icon={<Save size={15} />}
              loading={busySection === 'cashier'}
              disabled={busySection !== null}
              onClick={() => void saveCasher()}
            >
              حفظ إعدادات الكاشير
            </Button>
          </FormActions>
        </Panel>
      )}

      {settings.status === 'success' && (
        <Panel
          title="بيانات التقارير والفواتير وسياسة الإرجاع"
          hint="تظهر هذه الحقول تلقائياً في فواتير الكاشير الحرارية (80 مم) والفواتير الضريبية والتقارير الرسمية (A4) في الويب وبوابة العملاء وتطبيقات أندرويد."
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-surface-2 px-4 py-3 text-xs text-muted">
            <span>
              يُقرأ الاسم الرسمي، الشعار، الرقم الضريبي، السجل التجاري، والعنوان الوطني التفصيلي (الشارع · الحي · المدينة · رقم المبنى · الرمز البريدي) من بطاقة المنشأة مباشرةً.
            </span>
            <div className="flex flex-wrap gap-2">
              <Link href="/organization/company" className="btn btn-secondary btn-sm inline-flex items-center gap-1.5">
                <Building2 size={14} /> بطاقة المنشأة والعنوان الوطني
              </Link>
              <Link href="/settings/printing" className="btn btn-ghost btn-sm inline-flex items-center gap-1.5">
                <Printer size={14} /> خيارات الطباعة والورق
              </Link>
            </div>
          </div>

          <FormGrid cols={2}>
            <Labeled
              label="نص سياسة الاسترجاع والاستبدال"
              hint="يُطبع في أسفل إيصال الكاشير (80 مم) والفاتورة الضريبية (A4)."
            >
              <textarea
                rows={4}
                className="input min-h-[96px]"
                value={reportDraft['report.return_policy'] ?? ''}
                onChange={(e) =>
                  setReportDraft((cur) => ({ ...cur, 'report.return_policy': e.target.value }))
                }
                placeholder="مثال: البضاعة المباعة تُسترجع أو تُستبدل خلال 7 أيام من تاريخ الفاتورة بشرط إحضار أصل الفاتورة وسلامة الغلاف الأصلي..."
              />
            </Labeled>

            <Labeled
              label="ملاحظات الفواتير الافتراضية"
              hint="تظهر في خانة الملاحظات عندما لا تُكتب ملاحظة خاصة على المستند."
            >
              <textarea
                rows={4}
                className="input min-h-[96px]"
                value={reportDraft['report.default_notes'] ?? ''}
                onChange={(e) =>
                  setReportDraft((cur) => ({ ...cur, 'report.default_notes': e.target.value }))
                }
                placeholder="مثال: نشكركم لتعاملكم معنا — يُرجى مراجعة الأصناف والكميات قبل مغادرة الفرع."
              />
            </Labeled>
          </FormGrid>

          <FormGrid cols={2} className="mt-4">
            <Labeled label="مجال عمل المنشأة بالعربية (ترويسة التقارير)" hint="يظهر أسفل اسم المنشأة العربي في ترويسة A4.">
              <input
                className="input"
                value={reportDraft['report.field_ar'] ?? ''}
                onChange={(e) => setReportDraft((cur) => ({ ...cur, 'report.field_ar': e.target.value }))}
                placeholder="مثال: للتجارة العامة والمواد الغذائية والتوريدات"
              />
            </Labeled>
            <Labeled label="مجال عمل المنشأة بالإنجليزية (Business Activity)" hint="يظهر في الجهة اليسرى من ترويسة A4.">
              <input
                dir="ltr"
                className="input"
                value={reportDraft['report.field_en'] ?? ''}
                onChange={(e) => setReportDraft((cur) => ({ ...cur, 'report.field_en': e.target.value }))}
                placeholder="General Trading & Foodstuff Supply"
              />
            </Labeled>
            <Labeled label="عنوان المنشأة المختصر بالعربية" hint="يظهر في ترويسة الكاشير وتذييل تقارير A4.">
              <input
                className="input"
                value={reportDraft['report.address_ar'] ?? ''}
                onChange={(e) => setReportDraft((cur) => ({ ...cur, 'report.address_ar': e.target.value }))}
                placeholder="مثال: المملكة العربية السعودية - الرياض - حي العليا - طريق الملك فهد"
              />
            </Labeled>
            <Labeled label="عنوان المنشأة المختصر بالإنجليزية" hint="يظهر في الجهة اليسرى من ترويسة فاتورة A4.">
              <input
                dir="ltr"
                className="input"
                value={reportDraft['report.address_en'] ?? ''}
                onChange={(e) => setReportDraft((cur) => ({ ...cur, 'report.address_en': e.target.value }))}
                placeholder="Riyadh - Al Olaya Dist. - King Fahd Rd."
              />
            </Labeled>
            <Labeled label="الرقم الموحد (700) / السجل الفرعي (CRN)" hint="يُعرض في الخانة الثامنة لجدول العنوان الوطني للمنشأة.">
              <input
                dir="ltr"
                className="input"
                value={reportDraft['report.crn'] ?? ''}
                onChange={(e) => setReportDraft((cur) => ({ ...cur, 'report.crn': e.target.value }))}
                placeholder="7001234567"
              />
            </Labeled>
            <Labeled label="رابط صورة ختم المنشأة (اختياري)" hint="تُعرض داخل مربع «الختم» أسفل الفاتورة الضريبية A4.">
              <input
                dir="ltr"
                className="input"
                value={reportDraft['report.stamp_url'] ?? ''}
                onChange={(e) => setReportDraft((cur) => ({ ...cur, 'report.stamp_url': e.target.value }))}
                placeholder="https://..."
              />
            </Labeled>
          </FormGrid>

          <div className="mt-5 mb-2 text-sm font-bold text-ink">
            الحسابات البنكية المطبوعة في ترويسة فواتير A4
            <span className="mr-2 text-xs font-normal text-muted">تظهر حتى 3 حسابات بنكية (اسم البنك + رقم الآيبان) في ترويسة الفاتورة الضريبية.</span>
          </div>
          <FormGrid cols={2}>
            <Labeled label="اسم البنك الأول">
              <input
                className="input"
                value={reportDraft['report.bank1_name'] ?? ''}
                onChange={(e) => setReportDraft((cur) => ({ ...cur, 'report.bank1_name': e.target.value }))}
                placeholder="مثال: مصرف الراجحي"
              />
            </Labeled>
            <Labeled label="آيبان / حساب البنك الأول">
              <input
                dir="ltr"
                className="input"
                value={reportDraft['report.bank1_iban'] ?? ''}
                onChange={(e) => setReportDraft((cur) => ({ ...cur, 'report.bank1_iban': e.target.value }))}
                placeholder="SA00 0000 0000 0000 0000 0000"
              />
            </Labeled>
            <Labeled label="اسم البنك الثاني">
              <input
                className="input"
                value={reportDraft['report.bank2_name'] ?? ''}
                onChange={(e) => setReportDraft((cur) => ({ ...cur, 'report.bank2_name': e.target.value }))}
                placeholder="مثال: البنك الأهلي السعودي"
              />
            </Labeled>
            <Labeled label="آيبان / حساب البنك الثاني">
              <input
                dir="ltr"
                className="input"
                value={reportDraft['report.bank2_iban'] ?? ''}
                onChange={(e) => setReportDraft((cur) => ({ ...cur, 'report.bank2_iban': e.target.value }))}
                placeholder="SA00 0000 0000 0000 0000 0000"
              />
            </Labeled>
            <Labeled label="اسم البنك الثالث">
              <input
                className="input"
                value={reportDraft['report.bank3_name'] ?? ''}
                onChange={(e) => setReportDraft((cur) => ({ ...cur, 'report.bank3_name': e.target.value }))}
                placeholder="مثال: بنك الرياض"
              />
            </Labeled>
            <Labeled label="آيبان / حساب البنك الثالث">
              <input
                dir="ltr"
                className="input"
                value={reportDraft['report.bank3_iban'] ?? ''}
                onChange={(e) => setReportDraft((cur) => ({ ...cur, 'report.bank3_iban': e.target.value }))}
                placeholder="SA00 0000 0000 0000 0000 0000"
              />
            </Labeled>
          </FormGrid>

          <FormActions note="تُحفظ البيانات فوراً وتنعكس في جميع قوالب طباعة الكاشير وتقارير A4 والتطبيقات.">
            <Button
              variant="primary"
              icon={<Save size={15} />}
              loading={busySection === 'reports'}
              disabled={busySection !== null}
              onClick={() => void saveReportData()}
            >
              حفظ بيانات التقارير وسياسة الإرجاع
            </Button>
          </FormActions>
        </Panel>
      )}

      {settings.status === 'success' && (
        <Panel
          flush
          title={`كل المفاتيح المخزنة (${entries.length})`}
          hint="ملخص القيم المعتمدة حالياً في إعدادات هذه المنشأة."
        >
          <Table
            rows={entries}
            rowKey={(row) => row.key}
            dense
            columns={[
              {
                key: 'key',
                header: 'الإعداد',
                ltr: false,
                width: 300,
                cell: (row) => <span className="font-semibold text-ink-2">{row.label}</span>,
              },
              {
                key: 'value',
                header: 'القيمة الحالية',
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
