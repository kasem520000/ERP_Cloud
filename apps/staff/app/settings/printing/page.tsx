'use client';

import { FormActions, FormGrid, Panel, Tabs } from '@erp/ui';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

import { Notice } from '../../../components/data-view';
import { Screen } from '../../../components/screen';
import { apiErrorText } from '../../../lib/api';
import {
  fetchReportCatalog,
  fetchPrintSettings,
  fetchPrinterLinks,
  createPrinterLink,
  deletePrinterLink,
  PRINT_FONT_OPTIONS,
  PRINT_SCOPES,
  PRINT_TEMPLATE_OPTIONS,
  resetPrintSettings,
  savePrintSettings,
  type PrintFont,
  type PrintSettings,
  type PrinterLink,
  type PrintTemplate,
} from '../../../lib/reports';
import { useQuery } from '../../../lib/use-query';
import { Table } from '../../../components/ui/table';

const EMPTY: PrintSettings = {
  scope: 'default',
  printType: 1,
  printHeader: true,
  printFooter: false,
  printStamp: true,
  printItemDetails: false,
  printItemGroups: false,
  printComponentsIndividually: false,
  printMakePay: false,
  printNo: 1,
  printItemType: 1,
  casherPrinter: '',
  kitchenPrinter: '',
  rptName: '',
  rptUrl: '',
  note: '',
  headerImageUrl: '',
  footerImageUrl: '',
  stampImageUrl: '',
  template: 'classic',
  accentColor: '',
  fontFamily: 'segoe',
  fontScale: 100,
  showSignatures: true,
  saved: false,
};

/**
 * 🎨 معاينة المصمّم.
 *
 * ترسم نفس بنية الورقة التي يبنيها الخادم (ترويسة، جدول بنود، إجماليات) وتستعمل نفس
 * متغيّري `--accent` و`--scale` ونفس أصناف القوالب — فما تراه هنا هو ما يخرج من الطابعة،
 * لا صورةً تسويقيةً تفترق عن الورقة بعد أول تغيير في الخادم.
 */
function SheetPreview({ settings }: { settings: PrintSettings }) {
  const accent = /^#[0-9a-fA-F]{6}$/.test(settings.accentColor) ? settings.accentColor : '#111';
  const fontFamily =
    settings.fontFamily === 'naskh'
      ? '"Noto Naskh Arabic", "Traditional Arabic", serif'
      : settings.fontFamily === 'sans'
        ? 'system-ui, Arial, sans-serif'
        : '"Segoe UI", Tahoma, sans-serif';
  const scale = Math.min(1.3, Math.max(0.85, settings.fontScale / 100));
  const modern = settings.template === 'modern';
  const minimal = settings.template === 'minimal';
  const cellBorder = modern ? '0' : minimal ? '0' : '1px solid #ccc';
  const rowBorder = modern || minimal ? '1px solid #e7e7ea' : 'none';

  return (
    <div
      dir="rtl"
      aria-label="معاينة الورقة"
      style={{
        background: '#fff',
        border: minimal ? '1px solid #eee' : 'none',
        borderTop: modern ? `5px solid ${accent}` : 'none',
        borderRadius: 10,
        boxShadow: minimal ? 'none' : '0 1px 10px rgba(0,0,0,.10)',
        padding: '14px 16px',
        fontFamily,
        fontSize: `${12 * scale}px`,
        color: '#111',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, borderBottom: modern ? '1px solid #e5e7eb' : '2px solid ' + accent, paddingBottom: 8 }}>
        <div>
          <div style={{ fontSize: '1.5em', fontWeight: 700, color: modern ? accent : '#111' }}>مؤسسة الأفق للتجارة</div>
          <div style={{ color: '#555', fontSize: '.9em' }}>Al Ofoq Trading</div>
          <div style={{ color: '#333', fontSize: '.9em', marginTop: 2 }}>الرقم الضريبي: 310000000000003</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '1.33em', fontWeight: 700, color: modern ? accent : '#111' }}>فاتورة مبيعات</div>
          <div style={{ color: '#666', fontSize: '.85em' }}>SALES INVOICE</div>
          <div style={{ fontSize: '.9em', marginTop: 2 }}>رقم المستند: INV-1042</div>
          <div style={{ fontSize: '.9em' }}>التاريخ: 2026/10/20</div>
        </div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 10, fontSize: '.95em' }}>
        <thead>
          <tr>
            {['#', 'الصنف', 'الكمية', 'السعر', 'الإجمالي'].map((label) => (
              <th
                key={label}
                style={{
                  border: cellBorder,
                  borderBottom: rowBorder,
                  padding: '4px 6px',
                  textAlign: label === 'الصنف' ? 'right' : 'left',
                  background: modern ? accent : minimal ? '#fff' : '#f0f1f4',
                  color: modern ? '#fff' : '#111',
                  fontWeight: 600,
                }}
              >
                {label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {[
            ['1', 'أرز بسمتي ٥ كجم', '12', '27.50', '330.00'],
            ['2', 'زيت زيتون ١ لتر', '6', '42.00', '252.00'],
          ].map((row) => (
            <tr key={row[0]}>
              {row.map((cell, index) => (
                <td key={index} style={{ border: cellBorder, borderBottom: rowBorder, padding: '4px 6px', textAlign: index === 1 ? 'right' : 'left' }}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div
        style={{
          marginTop: 8,
          padding: '5px 9px',
          border: modern ? '0' : '2px solid ' + accent,
          borderTop: modern ? `2px solid ${accent}` : undefined,
          background: modern ? '#fafbfe' : undefined,
          fontSize: '1.15em',
          display: 'flex',
          gap: 18,
        }}
      >
        <span>الإجمالي: <b>669.90</b></span>
        <span>الضريبة: <b>87.38</b></span>
      </div>
      {settings.showSignatures ? (
        <table style={{ width: '100%', marginTop: 12, borderCollapse: 'collapse', fontSize: '.9em' }}>
          <tbody>
            <tr>
              {['أعده', 'راجعه', 'المدير'].map((label) => (
                <td key={label} style={{ border: minimal ? 0 : '1px solid #ccc', borderTop: minimal ? '1px solid #ccc' : undefined, padding: '12px 4px 4px', textAlign: 'center', color: '#555' }}>
                  {label}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

export default function PrintingSettingsPage() {
  const settings = useQuery<PrintSettings[]>(() => fetchPrintSettings(), []);
  const catalog = useQuery<Array<{ key: string; titleAr: string }>>(() => fetchReportCatalog(), []);
  const printerLinks = useQuery<PrinterLink[]>(() => fetchPrinterLinks(), []);
  const [scope, setScope] = useState('default');
  const [form, setForm] = useState<PrintSettings>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger' | 'info'; text: string } | undefined>();
  const [linkForm, setLinkForm] = useState({
    scope: 'default',
    printName: '',
    printerName: '',
    rptUrl: '',
    rptName: '',
  });
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkNotice, setLinkNotice] = useState<{ kind: 'ok' | 'danger'; text: string } | undefined>();

  const rows = settings.data ?? [];
  const current = rows.find((row) => row.scope === scope) ?? EMPTY;

  useEffect(() => {
    setForm({ ...EMPTY, ...current, scope });
    setNotice(undefined);
  }, [
    scope,
    current.printNo,
    current.note,
    current.saved,
    current.printType,
    current.casherPrinter,
    current.template,
    current.accentColor,
    current.fontFamily,
    current.fontScale,
    current.showSignatures,
  ]);

  const reports = useMemo(() => (catalog.data ?? []).slice(0, 200), [catalog.data]);

  const set = <K extends keyof PrintSettings>(key: K, value: PrintSettings[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setNotice(undefined);
    try {
      const saved = await savePrintSettings(scope, {
        printType: form.printType,
        printHeader: form.printHeader,
        printFooter: form.printFooter,
        printStamp: form.printStamp,
        printItemDetails: form.printItemDetails,
        printItemGroups: form.printItemGroups,
        printComponentsIndividually: form.printComponentsIndividually,
        printMakePay: form.printMakePay,
        printNo: Number(form.printNo) || 1,
        printItemType: Number((form as any).printItemType) || 1,
        casherPrinter: form.casherPrinter,
        kitchenPrinter: form.kitchenPrinter,
        rptName: form.rptName,
        rptUrl: form.rptUrl,
        note: form.note,
        headerImageUrl: form.headerImageUrl,
        footerImageUrl: form.footerImageUrl,
        stampImageUrl: form.stampImageUrl,
        template: form.template,
        accentColor: form.accentColor,
        fontFamily: form.fontFamily,
        fontScale: Number(form.fontScale) || 100,
        showSignatures: form.showSignatures,
      });
      setForm(saved);
      setNotice({ kind: 'ok', text: 'تم حفظ إعدادات الطباعة.' });
      settings.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error) });
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    setNotice(undefined);
    try {
      const cleared = await resetPrintSettings(scope);
      setForm(cleared);
      setNotice({ kind: 'info', text: 'عادت الإعدادات إلى القيم الافتراضية المعتمدة.' });
      settings.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error) });
    } finally {
      setBusy(false);
    }
  }

  async function addLink(event: React.FormEvent) {
    event.preventDefault();
    if (!linkForm.printName.trim() || !linkForm.printerName.trim()) {
      setLinkNotice({ kind: 'danger', text: 'أدخل اسم الطباعة واسم الطابعة.' });
      return;
    }
    setLinkBusy(true);
    setLinkNotice(undefined);
    try {
      await createPrinterLink({
        scope: linkForm.scope,
        printName: linkForm.printName.trim(),
        printerName: linkForm.printerName.trim(),
        rptUrl: linkForm.rptUrl.trim(),
        rptName: linkForm.rptName.trim(),
      });
      setLinkForm((p) => ({ ...p, printName: '', printerName: '', rptUrl: '', rptName: '' }));
      setLinkNotice({ kind: 'ok', text: 'تم حفظ ربط الطابعة.' });
      printerLinks.reload();
    } catch (error) {
      setLinkNotice({ kind: 'danger', text: apiErrorText(error) });
    } finally {
      setLinkBusy(false);
    }
  }

  async function removeLink(id: string) {
    setLinkBusy(true);
    try {
      await deletePrinterLink(id);
      printerLinks.reload();
    } catch (error) {
      setLinkNotice({ kind: 'danger', text: apiErrorText(error) });
    } finally {
      setLinkBusy(false);
    }
  }

  return (
    <Screen
      title="إعدادات الطباعة"
      subtitle="ما تُطبع به الفواتير والتقارير: الترويسة والتذييل والختم وعدد النسخ ونوع الورق — لكل قسم على حدة، وما لا يُحدَّد يرجع إلى «الافتراضي»."
      crumbs={['الإعدادات', 'إعدادات الطباعة']}
      actions={
        <span className="chip">
          محفوظ: {rows.filter((row) => row.saved).length} من {PRINT_SCOPES.length}
        </span>
      }
    >
      <Tabs
        value={scope}
        onChange={(key) => setScope(key as (typeof PRINT_SCOPES)[number]['scope'])}
        label="نطاق إعدادات الطباعة"
        items={PRINT_SCOPES.map((entry) => ({ key: entry.scope, label: entry.labelAr }))}
      />

      <Panel
        title={`إعدادات ${PRINT_SCOPES.find((entry) => entry.scope === scope)?.labelAr ?? scope}`}
        hint="ما لا يُحدَّد هنا يرجع إلى إعدادات «الافتراضي»."
      >
        <form onSubmit={save}>
          <FormGrid cols={4}>
            <label className="field">
              <span>طابعة الكاشير</span>
              <input
                className="input"
                value={form.casherPrinter}
                onChange={(event) => set('casherPrinter', event.target.value)}
                placeholder="HP LaserJet"
              />
            </label>
            <label className="field">
              <span>طابعة المطبخ</span>
              <input
                className="input"
                value={form.kitchenPrinter}
                onChange={(event) => set('kitchenPrinter', event.target.value)}
                placeholder="EPSON TM-T82"
              />
            </label>
            <label className="field">
              <span>عدد النسخ</span>
              <input
                className="input"
                type="number"
                min={1}
                max={50}
                value={form.printNo}
                onChange={(event) => set('printNo', Number(event.target.value))}
              />
            </label>
            <label className="field">
              <span>ترتيب بنود الفاتورة</span>
              <select
                className="input"
                value={(form as any).printItemType ?? 1}
                onChange={(e) => set('printItemType' as any, Number(e.target.value) as any)}
              >
                <option value={1}>1 — ترتيب الإدخال</option>
                <option value={2}>2 — حسب الرمز</option>
                <option value={3}>3 — حسب اسم الصنف</option>
                <option value={4}>4 — حسب الكمية تنازلي</option>
                <option value={5}>5 — حسب السعر تنازلي</option>
              </select>
            </label>
            <label className="field">
              <span>اسم التقرير</span>
              <input
                className="input"
                value={form.rptName}
                onChange={(event) => set('rptName', event.target.value)}
                placeholder="RptSalesInPeriod1.repx"
                dir="ltr"
              />
            </label>
            <label className="field">
              <span>مسار التقرير</span>
              <input
                className="input"
                value={form.rptUrl}
                onChange={(event) => set('rptUrl', event.target.value)}
                placeholder="C:\\SmartAuditERP\\Reports"
                dir="ltr"
              />
            </label>
            <label className="field wide">
              <span>ملاحظات التقرير</span>
              <input
                className="input"
                value={form.note}
                onChange={(event) => set('note', event.target.value)}
                placeholder="تُطبع تحت الجدول"
              />
            </label>
          </FormGrid>

          <h3>نوع الورق — «افتراضي طباعة الفواتير»</h3>
          <div className="toolbar">
            <label className="check">
              <input
                type="radio"
                name="paper"
                checked={form.printType === 1}
                onChange={() => set('printType', 1)}
              />
              <span>ورقة A4</span>
            </label>
            <label className="check">
              <input
                type="radio"
                name="paper"
                checked={form.printType === 2}
                onChange={() => set('printType', 2)}
              />
              <span>ورق صغير</span>
            </label>
          </div>

          <h3>ما يُطبع على الورقة</h3>
          <div className="toolbar">
            <label className="check">
              <input
                type="checkbox"
                checked={form.printHeader}
                onChange={(event) => set('printHeader', event.target.checked)}
              />
              <span>طباعة ترويسة الفاتورة</span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.printFooter}
                onChange={(event) => set('printFooter', event.target.checked)}
              />
              <span>طباعة تذييل الفاتورة</span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.printStamp}
                onChange={(event) => set('printStamp', event.target.checked)}
              />
              <span>طباعة الختم</span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.printItemDetails}
                onChange={(event) => set('printItemDetails', event.target.checked)}
              />
              <span>طباعة تفاصيل الأصناف</span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.printItemGroups}
                onChange={(event) => set('printItemGroups', event.target.checked)}
              />
              <span>طباعة مجموعات الأصناف مع إغلاق اليومية</span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.printComponentsIndividually}
                onChange={(event) => set('printComponentsIndividually', event.target.checked)}
              />
              <span>طباعة مكونات الأصناف المركبة بشكل منفرد</span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.printMakePay}
                onChange={(event) => set('printMakePay', event.target.checked)}
              />
              <span>طباعة make pay</span>
            </label>
          </div>

          <h3>مصمّم القوالب — شكل الورقة</h3>
          <p className="small muted">
            القالب لا يحذف حقلاً ولا بنداً: يغيّر الحدود والتعبئة والعناوين فقط. الورقة تُفتح
            للطباعة في بيئةٍ قد لا تصل إلى الإنترنت، لذلك الخطوط كلها خطوط نظام.
          </p>
          <div className="form-grid">
            <div className="field wide">
              <span>القالب</span>
              <div className="toolbar" style={{ gap: 8, flexWrap: 'wrap' }}>
                {PRINT_TEMPLATE_OPTIONS.map((option) => (
                  <label
                    key={option.value}
                    className="check"
                    title={option.hintAr}
                    style={{
                      border: `1px solid ${form.template === option.value ? 'var(--brand, #111)' : '#d7d7df'}`,
                      borderRadius: 8,
                      padding: '6px 10px',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="radio"
                      name="print-template"
                      checked={form.template === option.value}
                      onChange={() => set('template', option.value as PrintTemplate)}
                    />
                    <span>{option.labelAr}</span>
                  </label>
                ))}
              </div>
              <span className="small muted">
                {PRINT_TEMPLATE_OPTIONS.find((option) => option.value === form.template)?.hintAr}
              </span>
            </div>
            <label className="field">
              <span>لون التمييز</span>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input
                  type="color"
                  aria-label="لون التمييز"
                  value={/^#[0-9a-fA-F]{6}$/.test(form.accentColor) ? form.accentColor : '#111111'}
                  onChange={(event) => set('accentColor', event.target.value)}
                  style={{ width: 44, height: 34, padding: 2 }}
                />
                <input
                  className="input"
                  dir="ltr"
                  value={form.accentColor}
                  onChange={(event) => set('accentColor', event.target.value)}
                  placeholder="فارغ = لون هوية المنشأة"
                />
              </div>
            </label>
            <label className="field">
              <span>الخط</span>
              <select
                className="input"
                value={form.fontFamily}
                onChange={(event) => set('fontFamily', event.target.value as PrintFont)}
              >
                {PRINT_FONT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.labelAr}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>حجم الخط: {form.fontScale}%</span>
              <input
                type="range"
                min={85}
                max={130}
                step={5}
                value={form.fontScale}
                onChange={(event) => set('fontScale', Number(event.target.value))}
              />
              <span className="small muted">85٪ إلى 130٪ — يكبّر الورقة كلها لا الفقرات وحدها.</span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.showSignatures}
                onChange={(event) => set('showSignatures', event.target.checked)}
              />
              <span>طباعة سطر التوقيعات في التقارير</span>
            </label>
          </div>

          <h3>معاينة</h3>
          <SheetPreview settings={form} />

          <h3>الصور — الترويـسة · التـذيـيـل · الخـتـم</h3>
          <p className="small muted">
            أدخل روابط صور الترويسة والتذييل والختم بصيغة <span dir="ltr">https://</span> ليتم إدراجها تلقائياً في المستند المطبوع.
          </p>
          <div className="form-grid">
            <label className="field">
              <span>الترويـسة</span>
              <input
                className="input"
                dir="ltr"
                value={form.headerImageUrl}
                onChange={(event) => set('headerImageUrl', event.target.value)}
                placeholder="https://…/header.png"
              />
            </label>
            <label className="field">
              <span>التـذيـيـل</span>
              <input
                className="input"
                dir="ltr"
                value={form.footerImageUrl}
                onChange={(event) => set('footerImageUrl', event.target.value)}
                placeholder="https://…/footer.png"
              />
            </label>
            <label className="field">
              <span>الخـتـم</span>
              <input
                className="input"
                dir="ltr"
                value={form.stampImageUrl}
                onChange={(event) => set('stampImageUrl', event.target.value)}
                placeholder="https://…/stamp.png"
              />
            </label>
          </div>

          <Notice notice={notice} />
          <FormActions>
            <button
              className="btn"
              type="button"
              disabled={busy || !current.saved}
              onClick={() => void reset()}
            >
              إرجاع إلى الافتراضي
            </button>
            <button className="btn primary" type="submit" disabled={busy}>
              {busy ? 'جارٍ الحفظ…' : 'حفظ'}
            </button>
          </FormActions>
        </form>
      </Panel>

      {/* شبكة ربط الطابعات — `PrinterSettings` L2163-L2180 (`Inv_Id, PrintName, Printer, RptUrl, RptName`) */}
      <Panel
        title="ربط الطابعات بالتقارير"
        hint="حدّد لكل تقرير أو شاشة اسم الطباعة والطابعة ومسار ملف التقرير؛ تظهر هذه الروابط بجانب زر الطباعة، والطابعة الفعلية يختارها المتصفح."
        flush
      >
        <form className="toolbar" onSubmit={addLink} style={{ flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
          <select
            className="input"
            value={linkForm.scope}
            onChange={(e) => setLinkForm((p) => ({ ...p, scope: e.target.value }))}
            style={{ minWidth: 120 }}
          >
            {PRINT_SCOPES.map((s) => (
              <option key={s.scope} value={s.scope}>
                {s.labelAr}
              </option>
            ))}
            {reports.slice(0, 40).map((r) => (
              <option key={`report:${r.key}`} value={`report:${r.key}`}>
                تقرير:{r.key}
              </option>
            ))}
          </select>
          <input
            className="input"
            placeholder="اسم الطباعة"
            value={linkForm.printName}
            onChange={(e) => setLinkForm((p) => ({ ...p, printName: e.target.value }))}
            style={{ minWidth: 140 }}
          />
          <input
            className="input"
            placeholder="اسم الطابعة"
            value={linkForm.printerName}
            onChange={(e) => setLinkForm((p) => ({ ...p, printerName: e.target.value }))}
            style={{ minWidth: 140 }}
          />
          <input
            className="input"
            placeholder="مسار التقرير"
            dir="ltr"
            value={linkForm.rptUrl}
            onChange={(e) => setLinkForm((p) => ({ ...p, rptUrl: e.target.value }))}
            style={{ minWidth: 160 }}
          />
          <input
            className="input"
            placeholder="اسم الملف"
            dir="ltr"
            value={linkForm.rptName}
            onChange={(e) => setLinkForm((p) => ({ ...p, rptName: e.target.value }))}
            style={{ minWidth: 160 }}
          />
          <button className="btn primary" type="submit" disabled={linkBusy}>
            {linkBusy ? 'جارٍ الحفظ…' : 'إضافة'}
          </button>
        </form>

        {linkNotice ? <Notice notice={linkNotice} /> : null}

        <Table
          bare
          empty="لا روابط محفوظة — اختر نطاقاً واسم طباعة ثم أضف الربط أعلاه."
          columns={[
            {
              key: 'scope',
              header: 'النطاق',
              cell: (link) => (
                <>
                  {link.scopeLabelAr}{' '}
                  <span dir="ltr" className="small muted">
                    ({link.scope})
                  </span>
                </>
              ),
            },
            { key: 'printName', header: 'اسم الطباعة', cell: (link) => link.printName },
            { key: 'printer', header: 'الطابعة', cell: (link) => link.printerName },
            {
              key: 'rptUrl',
              header: 'مسار التقرير',
              ltr: true,
              cell: (link) => <span className="small">{link.rptUrl || '—'}</span>,
            },
            {
              key: 'rptName',
              header: 'اسم الملف',
              ltr: true,
              cell: (link) => <span className="small">{link.rptName || '—'}</span>,
            },
            {
              key: 'actions',
              header: 'إجراء',
              cell: (link) => (
                <button className="btn" disabled={linkBusy} onClick={() => void removeLink(link.id)}>
                  حذف
                </button>
              ),
            },
          ]}
          rows={printerLinks.data ?? []}
          rowKey={(link) => link.id}
        />
      </Panel>

      {scope === 'reports' && (
        <Panel
          title="إعدادات تقرير بعينه"
          hint={
            <>
              كل تقرير يقرأ إعداداته أولاً، ثم «تقارير»، ثم «الافتراضي». افتح التقرير من{' '}
              <Link href="/reports">التقارير</Link> واضغط «معاينة الطباعة» لترى الورقة بهذه الإعدادات.
            </>
          }
          flush
        >
          <Table
            bare
            columns={[
              {
                key: 'c0',
                header: 'التقرير',
                cell: (report) => (
                  <>
                    <Link href={`/reports/${report.key}`}>{report.titleAr}</Link>
                  </>
                ),
              },
              {
                key: 'c1',
                header: 'المفتاح',
                ltr: true,
                cell: (report) => <>report:{report.key}</>,
              },
              {
                key: 'c2',
                header: 'الإعدادات',
                cell: () => 'من «تقارير» ثم «الافتراضي»',
              },
            ]}
            rows={reports.slice(0, 12)}
            rowKey={(report) => report.key}
          />
        </Panel>
      )}
    </Screen>
  );
}
