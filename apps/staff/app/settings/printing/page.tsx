'use client';

/**
 * 🖨️ إعدادات الطباعة ومصمّم القوالب.
 *
 * الشاشة القديمة كانت تعرض حقولاً متفرقة بلا معاينة حقيقية: خيار «ورق صغير» لا يغيّر
 * شيئاً، و«طابعة الكاشير» خانة نصّ لا تعرف طابعات الجهاز، و«اسم التقرير» و«مسار التقرير»
 * حقول سطح المكتب لا معنى لها في السحابة. وهذه الشاشة تعيد بناء التجربة على ثلاثة أعمدة:
 *
 *   1. **قالب يُختار**: كل ما يُطبع في النظام — إيصال الكاشير، الفواتير، المرتجعات،
 *      السندات، القيود، إغلاق الوردية، ثم كل تقرير مسجّل — في قائمة واحدة قابلة للبحث.
 *   2. **تصميمه يُعدَّل**: الورق والطابعات، القالب والألوان، الأقسام وترتيبها، الأعمدة
 *      وترتيبها وتسمياتها، الحقول الإضافية والشروط، والتوقيعات.
 *   3. **معاينة من الخادم**: الورقة تُرسم بنفس دوال الطباعة وبنفس CSS، وتُحدَّث مع كل
 *      تعديل غير محفوظ — فما تراه هو ما يخرج من الطابعة، ويشمل ذلك مقاس 80mm و58mm.
 */

import { FormActions, FormGrid, Panel, SegmentedTabs } from '@erp/ui';
import { useEffect, useMemo, useRef, useState } from 'react';

import { Notice } from '../../../components/data-view';
import { Screen } from '../../../components/screen';
import { apiErrorText } from '../../../lib/api';
import {
  PRINT_FONT_OPTIONS,
  PRINT_SCOPES,
  PRINT_TEMPLATE_OPTIONS,
  createPrinterLink,
  deletePrinterLink,
  fetchPrintableTemplates,
  fetchPrintSettings,
  fetchPrinterLinks,
  previewPrintableTemplate,
  resetPrintSettings,
  savePrintSettings,
  type PrintDesignColumn,
  type PrintDesignConfig,
  type PrintFont,
  type PrintSettings,
  type PrintTemplate,
  type PrintableTemplateEntry,
  type PrinterLink,
} from '../../../lib/reports';
import { Table } from '../../../components/ui/table';
import { useQuery } from '../../../lib/use-query';

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
  designConfig: {},
  saved: false,
};

const PAPER_OPTIONS: Array<{ key: string; label: string; hint: string }> = [
  { key: 'a4', label: 'A4 — فواتير وتقارير', hint: 'الورق الرسمي للفواتير الضريبية والتقارير (210×297 مم).' },
  { key: '80', label: 'حراري 80 مم — كاشير', hint: 'ورق صغير للطابعة الحرارية في نقطة البيع 80 مم.' },
  { key: '58', label: 'حراري 58 مم — كاشير', hint: 'طابعات الكاشير الصغيرة 58 مم (Bluetooth/USB).' },
];

const SECTION_TABS = [
  { key: 'paper', label: 'الورق والطابعات' },
  { key: 'design', label: 'الشكل والهوية' },
  { key: 'sections', label: 'الأقسام والترتيب' },
  { key: 'columns', label: 'الأعمدة' },
  { key: 'extras', label: 'إضافات وتوقيعات' },
  { key: 'desktop', label: 'سطح المكتب' },
];

/**
 * 📐 المعاينة تُرسم على «عرض سطح مكتب» ثابت ثم تُصغَّر لتناسب العمود. الرسم بعرض
 * العمود نفسه كان يضغط فاتورة A4 داخل نصف متر من البكسلات فتبدو مشوّهة.
 */
const LOGICAL_WIDTH = 820;
const LOGICAL_HEIGHT = 980;

const KNOWN_PRINTERS_KEY = 'erp.printers.known.v1';

type DetectedPrinter = { name: string; source: 'chrome' | 'system' | 'saved' | 'tenant' };

/**
 * 🖨️ طابعات الجهاز — المتصفح لا يعطي صفحة ويب قائمة طابعات النظام (خصوصية)، لكن
 * بعض البيئات توفّر واجهة: `chrome.printing.getPrinters` في ChromeOS، و`getPrinters`
 * في أغلفة الأجهزة، و`queryLocalPrinters` في تطبيقات الأندرويد المغلّفة. نجمع ما يُتاح،
 * ونضيف الطابعات المحفوظة سابقاً على هذا الجهاز، ثم يبقى الإدخال اليدوي متاحاً دائماً.
 */
async function detectDevicePrinters(): Promise<DetectedPrinter[]> {
  const scope = globalThis as unknown as Record<string, unknown>;
  const found: DetectedPrinter[] = [];

  const chromeApi = (scope.chrome as
    | { printing?: { getPrinters?: (callback: (printers: Array<{ id?: string; name?: string }>) => void) => void } }
    | undefined)?.printing;

  if (chromeApi?.getPrinters) {
    await new Promise<void>((resolve) => {
      try {
        chromeApi.getPrinters!((printers) => {
          for (const printer of printers ?? []) {
            const name = String(printer?.name ?? printer?.id ?? '').trim();
            if (name) found.push({ name, source: 'chrome' });
          }
          resolve();
        });
      } catch {
        resolve();
      }
    });
  }

  for (const key of ['getPrinters', 'queryLocalPrinters']) {
    const fn = scope[key];
    if (typeof fn !== 'function') continue;
    try {
      const result = await (fn as () => unknown)();
      if (Array.isArray(result)) {
        for (const entry of result) {
          const name =
            typeof entry === 'string' ? entry : String((entry as { name?: string })?.name ?? '');
          if (name.trim()) found.push({ name: name.trim(), source: 'system' });
        }
      }
    } catch {
      /* الواجهة غير مدعومة في هذا المتصفح */
    }
  }

  try {
    const remembered = JSON.parse(localStorage.getItem(KNOWN_PRINTERS_KEY) ?? '[]') as string[];
    for (const name of remembered) {
      if (typeof name === 'string' && name.trim()) found.push({ name: name.trim(), source: 'saved' });
    }
  } catch {
    /* تخزين محظور */
  }

  const seen = new Set<string>();
  return found.filter((printer) => {
    const key = printer.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function rememberPrinter(name: string): void {
  const trimmed = name.trim();
  if (!trimmed) return;
  try {
    const current = JSON.parse(localStorage.getItem(KNOWN_PRINTERS_KEY) ?? '[]') as string[];
    const next = Array.from(new Set([...current, trimmed])).slice(-24);
    localStorage.setItem(KNOWN_PRINTERS_KEY, JSON.stringify(next));
  } catch {
    /* ignore */
  }
}

function orderColumns(
  current: PrintDesignColumn[] | undefined,
  defaults: Array<{ key: string; labelAr: string }>,
): PrintDesignColumn[] {
  if (current && current.length > 0) {
    const known = new Map(defaults.map((column) => [column.key, column]));
    const ordered = current.filter((column) => known.has(column.key));
    for (const column of defaults) {
      if (!ordered.some((entry) => entry.key === column.key)) {
        ordered.push({ key: column.key, labelAr: undefined, visible: false });
      }
    }
    return ordered;
  }
  return defaults.map((column) => ({ key: column.key, labelAr: undefined, visible: true }));
}

export default function PrintingSettingsPage() {
  const settings = useQuery<PrintSettings[]>(() => fetchPrintSettings(), []);
  const catalog = useQuery<PrintableTemplateEntry[]>(() => fetchPrintableTemplates(), []);
  const printerLinks = useQuery<PrinterLink[]>(() => fetchPrinterLinks(), []);

  const [scope, setScope] = useState('doc:pos_receipt');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('paper');
  const [form, setForm] = useState<PrintSettings>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger' | 'info'; text: string }>();
  const [preview, setPreview] = useState<string>('');
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string>();
  const [printers, setPrinters] = useState<DetectedPrinter[]>([]);
  const [zoom, setZoom] = useState(1);
  const previewBoxRef = useRef<HTMLDivElement | null>(null);
  const [previewWidth, setPreviewWidth] = useState(560);
  const [linkForm, setLinkForm] = useState({ scope: 'default', printName: '', printerName: '', rptUrl: '', rptName: '' });
  const [linkBusy, setLinkBusy] = useState(false);
  const [linkNotice, setLinkNotice] = useState<{ kind: 'ok' | 'danger'; text: string }>();
  const previewSeq = useRef(0);

  const entries = useMemo(() => catalog.data ?? [], [catalog.data]);
  const entry = entries.find((row) => row.scope === scope);
  const rows = settings.data ?? [];
  const scopedRow = rows.find((row) => row.scope === scope);

  /** القوالب مجمّعة كما في القائمة: المستندات · القوالب العامة · تقارير بحسب مجموعاتها. */
  const grouped = useMemo(() => {
    const buckets = new Map<string, { label: string; rows: PrintableTemplateEntry[] }>();
    for (const row of entries) {
      const bucket = buckets.get(row.group) ?? { label: row.groupLabelAr, rows: [] };
      bucket.rows.push(row);
      buckets.set(row.group, bucket);
    }
    return [...buckets.entries()];
  }, [entries]);

  const filtered = useMemo(() => {
    const needle = search.trim();
    if (!needle) return grouped;
    return grouped
      .map(([group, bucket]) => [
        group,
        {
          label: bucket.label,
          rows: bucket.rows.filter(
            (row) => row.titleAr.includes(needle) || row.scope.includes(needle) || row.hintAr.includes(needle),
          ),
        },
      ] as const)
      .filter(([, bucket]) => bucket.rows.length > 0);
  }, [grouped, search]);

  // ── تحميل إعدادات القالب المختار
  //
  // هذا الأثر يعمل عند **تغيير القالب** لا عند كل تحديث لقائمة الإعدادات: وإلا محا
  // `settings.reload()` بعد الحفظ رسالة «تم الحفظ» وأعاد ملء النموذج من نسخةٍ قديمة،
  // فيبدو الحفظ كأنه لم يحدث. ولهذا لا يدخل `settings.data` في الاعتماديات.
  useEffect(() => {
    let cancelled = false;
    setNotice(undefined);
    setPreviewError(undefined);
    void (async () => {
      try {
        const { apiData } = await import('../../../lib/api');
        const loaded = await apiData<PrintSettings>(`/reports/print-settings/${encodeURIComponent(scope)}`);
        if (cancelled) return;
        setForm({ ...EMPTY, ...loaded, designConfig: loaded.designConfig ?? {} });
      } catch (error) {
        if (cancelled) return;
        // بلا قراءةٍ ناجحة نُظهر الافتراضي بدل شاشةٍ فارغة.
        setForm({ ...EMPTY, scope });
        setNotice({ kind: 'danger', text: apiErrorText(error) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scope]);

  // ── طابعات الجهاز
  useEffect(() => {
    void detectDevicePrinters().then(setPrinters);
  }, []);

  // ── قياس مساحة المعاينة
  //
  // الورقة تُرسم بعرض سطح مكتب حقيقي (≈820px) ثم تُصغَّر بصرياً لتلائم العمود؛
  // وإلا رُنِدت فاتورة A4 داخل ٥٠٠ بكسل فبدت مطموسة لا تشبه المطبوع.
  useEffect(() => {
    const element = previewBoxRef.current;
    if (!element) return;
    const update = () => setPreviewWidth(Math.max(240, element.clientWidth - 20));
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const columns = useMemo(() => orderColumns(form.designConfig.columns, entry?.defaultColumns ?? []), [form.designConfig.columns, entry]);

  const sections = useMemo(() => {
    const defaults = entry?.defaultSections ?? [];
    const declared = form.designConfig.sectionOrder ?? [];
    const ordered = [
      ...declared.filter((key) => defaults.some((section) => section.key === key)),
      ...defaults.filter((section) => !declared.includes(section.key)).map((section) => section.key),
    ];
    return ordered
      .map((key) => defaults.find((section) => section.key === key))
      .filter((section): section is { key: string; labelAr: string } => Boolean(section));
  }, [form.designConfig.sectionOrder, entry]);

  const patchDesign = (patch: Partial<PrintDesignConfig>) =>
    setForm((current) => ({ ...current, designConfig: { ...current.designConfig, ...patch } }));

  const patchField = <K extends keyof PrintSettings>(key: K, value: PrintSettings[K]) =>
    setForm((current) => ({ ...current, [key]: value }));

  const paperKey = form.printType === 2 ? (form.designConfig.paperWidthMm === 58 ? '58' : '80') : 'a4';

  const choosePaper = (key: string) => {
    if (key === 'a4') {
      setForm((current) => ({
        ...current,
        printType: 1,
        designConfig: { ...current.designConfig, paperWidthMm: undefined, orientation: current.designConfig.orientation ?? 'auto' },
      }));
      return;
    }
    setForm((current) => ({
      ...current,
      printType: 2,
      designConfig: { ...current.designConfig, paperWidthMm: key === '58' ? 58 : 80 },
    }));
  };

  // ── المعاينة الحيّة: كل تغيير غير محفوظ يُرسم على الخادم
  useEffect(() => {
    if (!scope) return;
    const seq = ++previewSeq.current;
    setPreviewBusy(true);
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const result = await previewPrintableTemplate(scope, {
            printType: form.printType,
            printHeader: form.printHeader,
            printFooter: form.printFooter,
            printStamp: form.printStamp,
            printItemType: form.printItemType,
            note: form.note,
            template: form.template,
            accentColor: form.accentColor,
            fontFamily: form.fontFamily,
            fontScale: form.fontScale,
            showSignatures: form.showSignatures,
            headerImageUrl: form.headerImageUrl,
            footerImageUrl: form.footerImageUrl,
            stampImageUrl: form.stampImageUrl,
            designConfig: form.designConfig,
          });
          if (seq !== previewSeq.current) return;
          setPreview(result.html);
          setPreviewError(undefined);
        } catch (error) {
          if (seq !== previewSeq.current) return;
          setPreviewError(apiErrorText(error, 'تعذّر تجهيز المعاينة.'));
        } finally {
          if (seq === previewSeq.current) setPreviewBusy(false);
        }
      })();
    }, 420);
    return () => {
      clearTimeout(timer);
      setPreviewBusy(false);
    };
    // التبعيات مذكورة صراحةً: الحقول التي تُغيّر الورقة فقط، لا كائن النموذج كله
    // (وإلا أُعيد رسم المعاينة عند كتابة اسم الطابعة بلا سبب).
  }, [
    scope,
    form.printType,
    form.printHeader,
    form.printFooter,
    form.printStamp,
    form.printItemType,
    form.note,
    form.template,
    form.accentColor,
    form.fontFamily,
    form.fontScale,
    form.showSignatures,
    form.headerImageUrl,
    form.footerImageUrl,
    form.stampImageUrl,
    form.designConfig,
  ]);

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
        printItemType: Number(form.printItemType) || 1,
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
        designConfig: sanitizeDesignForSave(form.designConfig),
      });
      setForm({ ...(saved as PrintSettings), designConfig: (saved as PrintSettings).designConfig ?? {} });
      rememberPrinter(form.casherPrinter);
      rememberPrinter(form.kitchenPrinter);
      void detectDevicePrinters().then(setPrinters);
      setNotice({ kind: 'ok', text: 'تم حفظ القالب — سيُطبع كل مستند بهذا التصميم من الآن.' });
      settings.reload();
      catalog.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error) });
    } finally {
      setBusy(false);
    }
  }

  async function resetTemplate() {
    setBusy(true);
    setNotice(undefined);
    try {
      const cleared = await resetPrintSettings(scope);
      setForm({ ...EMPTY, ...cleared, designConfig: {} });
      setNotice({ kind: 'info', text: 'عاد القالب إلى التصميم الافتراضي المعتمد.' });
      settings.reload();
      catalog.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error) });
    } finally {
      setBusy(false);
    }
  }

  function openPrintWindow() {
    if (!preview) return;
    const win = window.open('', '_blank', 'width=900,height=1200');
    if (!win) return;
    win.document.open();
    win.document.write(preview);
    win.document.close();
  }

  function moveSection(index: number, direction: -1 | 1) {
    const next = [...sections];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    patchDesign({ sectionOrder: next.map((section) => section.key) });
  }

  function moveColumn(index: number, direction: -1 | 1) {
    const next = [...columns];
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    patchDesign({ columns: next });
  }

  function updateColumn(index: number, patch: Partial<PrintDesignColumn>) {
    const next = columns.map((column, i) => (i === index ? { ...column, ...patch } : column));
    patchDesign({ columns: next });
  }

  const previewScale = Math.min(1.6, Math.max(0.25, (previewWidth / LOGICAL_WIDTH) * zoom));

  const design = form.designConfig;
  const customFields = design.customFields ?? [];
  const signatureLabels = design.signatureLabels ?? entry?.defaultSignatures ?? [];

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
      setLinkForm((current) => ({ ...current, printName: '', printerName: '', rptUrl: '', rptName: '' }));
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
      title="إعدادات الطباعة ومصمّم القوالب"
      subtitle="اختر القالب الذي تريد تعديله من كل ما يُطبع في النظام، ثم عدّل ورقته وأعمدةه وشكله — والمعاينة على اليسار هي الورقة نفسها التي ستخرج من الطابعة."
      crumbs={['الإعدادات', 'الطباعة والقوالب']}
      actions={
        <span className="chip">
          {entries.filter((row) => row.saved).length} قالب مخصّص من {entries.length}
        </span>
      }
    >
      <div className="grid cols-2" style={{ alignItems: 'start', gap: 16 }}>
        <div style={{ display: 'grid', gap: 16 }}>
          <Panel
            title="اسم التقرير / القالب"
            hint="كل ما يُطبع: إيصال الكاشير، الفواتير والمرتجعات، السندات والقيود، إغلاق الوردية، ثم كل تقارير النظام."
          >
        <label className="field wide">
          <span>بحث في القوالب</span>
          <input
            className="input"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="اكتب اسم التقرير… مثال: كاشير، مبيعات، مشتريات، سند قبض، ميزان"
          />
        </label>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
          <label className="field wide">
            <span>القالب المختار</span>
            <select className="input" value={scope} onChange={(event) => setScope(event.target.value)}>
              {filtered.map(([group, bucket]) => (
                <optgroup key={group} label={bucket.label}>
                  {bucket.rows.map((row) => (
                    <option key={row.scope} value={row.scope}>
                      {row.saved ? '★ ' : ''}
                      {row.titleAr}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>

          {entry ? (
            <div className="small muted">
              {entry.hintAr}
              <span className="chip" style={{ marginInlineStart: 8 }}>
                {entry.saved ? 'مخصّص ومحفوظ' : 'يعرض الافتراضي'}
              </span>
            </div>
          ) : null}
        </div>

        <div className="toolbar" style={{ flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {PRINT_SCOPES.map((preset) => (
            <button
              key={preset.scope}
              type="button"
              className={scope === preset.scope ? 'btn primary sm' : 'btn sm'}
              onClick={() => setScope(preset.scope)}
              title={`القالب العام المشترك — ${preset.labelAr}`}
            >
              {preset.labelAr}
            </button>
          ))}
        </div>
          </Panel>

          <Panel title={`تعديل قالب: ${entry?.titleAr ?? scope}`} hint="كل ما تغيّره يظهر في المعاينة قبل الحفظ.">
            <form onSubmit={save}>
              <SegmentedTabs
                value={tab}
                onChange={setTab}
                label="أقسام تعديل القالب"
                items={SECTION_TABS.map((item) => ({ key: item.key, label: item.label }))}
              />

              {tab === 'paper' && (
                <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
                  <div>
                    <div className="small muted" style={{ marginBottom: 6 }}>
                      نوع الورق — يغيّر مقاس الورقة في المعاينة والطباعة فوراً.
                    </div>
                    <div className="toolbar" style={{ flexWrap: 'wrap', gap: 8 }}>
                      {PAPER_OPTIONS.map((option) => (
                        <label
                          key={option.key}
                          className="check"
                          title={option.hint}
                          style={{
                            border: `1px solid ${paperKey === option.key ? 'var(--brand, #111)' : '#d7d7df'}`,
                            borderRadius: 8,
                            padding: '6px 10px',
                            cursor: 'pointer',
                          }}
                        >
                          <input
                            type="radio"
                            name="paper-size"
                            checked={paperKey === option.key}
                            onChange={() => choosePaper(option.key)}
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                    </div>
                    <div className="small muted" style={{ marginTop: 4 }}>
                      {PAPER_OPTIONS.find((option) => option.key === paperKey)?.hint}
                    </div>
                  </div>

                  <FormGrid cols={3}>
                    <label className="field">
                      <span>اتجاه الورقة</span>
                      <select
                        className="input"
                        value={design.orientation ?? 'auto'}
                        onChange={(event) =>
                          patchDesign({ orientation: event.target.value as PrintDesignConfig['orientation'] })
                        }
                      >
                        <option value="auto">تلقائي (حسب نوع المستند)</option>
                        <option value="portrait">عمودي — Portrait</option>
                        <option value="landscape">أفقي — Landscape</option>
                      </select>
                    </label>
                    <label className="field">
                      <span>هوامش الورقة (مم)</span>
                      <input
                        className="input"
                        type="number"
                        min={2}
                        max={25}
                        value={design.marginMm ?? (form.printType === 2 ? 3 : 10)}
                        onChange={(event) => patchDesign({ marginMm: Number(event.target.value) })}
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
                        onChange={(event) => patchField('printNo', Number(event.target.value))}
                      />
                    </label>
                    <label className="field">
                      <span>ترتيب بنود المستند</span>
                      <select
                        className="input"
                        value={form.printItemType}
                        onChange={(event) => patchField('printItemType', Number(event.target.value))}
                      >
                        <option value={1}>1 — ترتيب الإدخال</option>
                        <option value={2}>2 — حسب الرمز</option>
                        <option value={3}>3 — حسب اسم الصنف</option>
                        <option value={4}>4 — حسب الكمية تنازلي</option>
                        <option value={5}>5 — حسب السعر تنازلي</option>
                      </select>
                    </label>
                  </FormGrid>

                  <PrinterField
                    label="طابعة الكاشير"
                    hint="طابعة الإيصالات الحرارية في نقطة البيع. اختر من طابعات هذا الجهاز أو اكتب اسمها كما هو في النظام."
                    value={form.casherPrinter}
                    onChange={(value) => patchField('casherPrinter', value)}
                    printers={printers}
                    onDetect={() => void detectDevicePrinters().then(setPrinters)}
                  />

                  <PrinterField
                    label="طابعة المطبخ / الفواتير"
                    hint="تُستخدم للفواتير والتقارير على ورق A4 — افتراضياً A4، ويمكن ربطها بأي طابعة في الجهاز."
                    value={form.kitchenPrinter}
                    onChange={(value) => patchField('kitchenPrinter', value)}
                    printers={printers}
                    onDetect={() => void detectDevicePrinters().then(setPrinters)}
                    suggested="A4"
                  />

                  <div className="small muted">
                    لا يسمح المتصفح لأي صفحة ويب بقراءة قائمة طابعات النظام مباشرةً (خصوصية). نعرض ما تسمح به
                    البيئة (ChromeOS / أغلفة الأجهزة / تطبيقات الأندرويد)، مع حفظ آخر أسماء استخدمتها؛ ويبقى
                    اختيار الطابعة النهائي في نافذة الطباعة نفسها.
                  </div>
                </div>
              )}

              {tab === 'design' && (
                <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
                  <div className="field wide">
                    <span>القالب البصري</span>
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
                            onChange={() => patchField('template', option.value as PrintTemplate)}
                          />
                          <span>{option.labelAr}</span>
                        </label>
                      ))}
                    </div>
                  </div>

                  <FormGrid cols={2}>
                    <label className="field">
                      <span>لون التمييز</span>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                          type="color"
                          aria-label="لون التمييز"
                          value={/^#[0-9a-fA-F]{6}$/.test(form.accentColor) ? form.accentColor : '#111111'}
                          onChange={(event) => patchField('accentColor', event.target.value)}
                          style={{ width: 44, height: 34, padding: 2 }}
                        />
                        <input
                          className="input"
                          dir="ltr"
                          value={form.accentColor}
                          onChange={(event) => patchField('accentColor', event.target.value)}
                          placeholder="فارغ = لون هوية المنشأة"
                        />
                      </div>
                    </label>

                    <label className="field">
                      <span>لون ترويسة جدول الأصناف</span>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <input
                          type="color"
                          aria-label="لون ترويسة الجدول"
                          value={/^#[0-9a-fA-F]{6}$/.test(design.headerBgColor ?? '') ? design.headerBgColor! : '#dfe3e8'}
                          onChange={(event) => patchDesign({ headerBgColor: event.target.value })}
                          style={{ width: 44, height: 34, padding: 2 }}
                        />
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => patchDesign({ headerBgColor: undefined })}
                        >
                          لون افتراضي
                        </button>
                      </div>
                    </label>

                    <label className="field">
                      <span>الخط</span>
                      <select
                        className="input"
                        value={form.fontFamily}
                        onChange={(event) => patchField('fontFamily', event.target.value as PrintFont)}
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
                        onChange={(event) => patchField('fontScale', Number(event.target.value))}
                      />
                    </label>

                    <label className="field">
                      <span>نمط الجدول</span>
                      <select
                        className="input"
                        value={design.tableStyle ?? 'grid'}
                        onChange={(event) =>
                          patchDesign({ tableStyle: event.target.value as PrintDesignConfig['tableStyle'] })
                        }
                      >
                        <option value="grid">مربّع بحدود كاملة</option>
                        <option value="striped">صفوف متبادلة الألوان</option>
                        <option value="clean">خطوط أفقية فقط</option>
                      </select>
                    </label>

                    <label className="field">
                      <span>موضع الشعار</span>
                      <select
                        className="input"
                        value={design.logoPosition ?? 'center'}
                        onChange={(event) =>
                          patchDesign({ logoPosition: event.target.value as PrintDesignConfig['logoPosition'] })
                        }
                      >
                        <option value="center">وسط الترويسة</option>
                        <option value="right">يمين الترويسة</option>
                        <option value="left">يسار الترويسة</option>
                        <option value="hidden">بلا شعار</option>
                      </select>
                    </label>

                    <label className="field">
                      <span>حجم الشعار: {design.logoSizePx ?? 76}px</span>
                      <input
                        type="range"
                        min={36}
                        max={140}
                        step={4}
                        value={design.logoSizePx ?? 76}
                        onChange={(event) => patchDesign({ logoSizePx: Number(event.target.value) })}
                      />
                    </label>

                    <label className="field">
                      <span>حجم رمز QR: {design.qrSizePx ?? (form.printType === 2 ? 150 : 118)}px</span>
                      <input
                        type="range"
                        min={70}
                        max={190}
                        step={5}
                        value={design.qrSizePx ?? (form.printType === 2 ? 150 : 118)}
                        onChange={(event) => patchDesign({ qrSizePx: Number(event.target.value) })}
                      />
                    </label>

                    <label className="field">
                      <span>عنوان مخصص للورقة</span>
                      <input
                        className="input"
                        value={design.customTitleAr ?? ''}
                        onChange={(event) => patchDesign({ customTitleAr: event.target.value })}
                        placeholder="فارغ = العنوان الرسمي (فاتورة ضريبية مبسطة…)"
                      />
                    </label>

                    <label className="field">
                      <span>عنوان فرعي (إنجليزي أو وصف)</span>
                      <input
                        className="input"
                        dir="auto"
                        value={design.customSubtitleAr ?? ''}
                        onChange={(event) => patchDesign({ customSubtitleAr: event.target.value })}
                        placeholder="Simplified Tax Invoice"
                      />
                    </label>

                    <label className="field wide">
                      <span>أسطر ترويسة إضافية (سطر في كل مرة)</span>
                      <textarea
                        className="input"
                        rows={2}
                        value={(design.customHeaderLines ?? []).join('\n')}
                        onChange={(event) =>
                          patchDesign({
                            customHeaderLines: event.target.value.split('\n').map((line) => line.trim()).filter(Boolean),
                          })
                        }
                        placeholder="مثال: فرع العليا — هاتف 0112345678"
                      />
                    </label>

                    <label className="field">
                      <span>علامة مائية (نص باهت خلف الورقة)</span>
                      <input
                        className="input"
                        value={design.watermarkText ?? ''}
                        onChange={(event) => patchDesign({ watermarkText: event.target.value })}
                        placeholder="مثال: نسخة معاينة / أصل"
                      />
                    </label>
                  </FormGrid>

                  <div className="toolbar" style={{ flexWrap: 'wrap', gap: 12 }}>
                    <ToggleLine
                      label="طباعة ترويسة المنشأة"
                      checked={form.printHeader}
                      onChange={(value) => patchField('printHeader', value)}
                    />
                    <ToggleLine
                      label="طباعة تذييل المنشأة"
                      checked={form.printFooter}
                      onChange={(value) => patchField('printFooter', value)}
                    />
                    <ToggleLine
                      label="طباعة الختم"
                      checked={form.printStamp}
                      onChange={(value) => patchField('printStamp', value)}
                    />
                    <ToggleLine
                      label="سطر التوقيعات"
                      checked={form.showSignatures}
                      onChange={(value) => patchField('showSignatures', value)}
                    />
                    <ToggleLine
                      label="جدول العنوان الوطني للمنشأة"
                      checked={design.showNationalAddress !== false}
                      onChange={(value) => patchDesign({ showNationalAddress: value })}
                    />
                    <ToggleLine
                      label="الحسابات البنكية في الترويسة"
                      checked={design.showCompanyBanks !== false}
                      onChange={(value) => patchDesign({ showCompanyBanks: value })}
                    />
                    <ToggleLine
                      label="جدول بيانات المستند"
                      checked={design.showMetaGrid !== false}
                      onChange={(value) => patchDesign({ showMetaGrid: value })}
                    />
                    <ToggleLine
                      label="بيانات العميل / المورد"
                      checked={design.showPartyBox !== false}
                      onChange={(value) => patchDesign({ showPartyBox: value })}
                    />
                    <ToggleLine
                      label="تفقيط المبلغ بالحروف"
                      checked={design.showTafqeet !== false}
                      onChange={(value) => patchDesign({ showTafqeet: value })}
                    />
                    <ToggleLine
                      label="سياسة الاسترجاع والاستبدال"
                      checked={design.showReturnPolicy !== false}
                      onChange={(value) => patchDesign({ showReturnPolicy: value })}
                    />
                  </div>
                </div>
              )}

              {tab === 'sections' && (
                <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                  <p className="small muted" style={{ margin: 0 }}>
                    رتّب أقسام الورقة كما تريد. الأقسام التي لا تحمل بياناتاً في مستند بعينه لا تُطبع تلقائياً،
                    ولا يمكن إخفاء جدول الأصناف ولا الإجماليات ولا رمز QR — فهي محتوى المستند لا زينته.
                  </p>
                  {sections.map((section, index) => (
                    <div
                      key={section.key}
                      className="row"
                      style={{
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        border: '1px solid #e5e7eb',
                        borderRadius: 8,
                        padding: '6px 10px',
                      }}
                    >
                      <span style={{ fontSize: '0.86rem', fontWeight: 600 }}>
                        {index + 1}. {section.labelAr}
                      </span>
                      <span className="row" style={{ gap: 4 }}>
                        <button type="button" className="btn sm" onClick={() => moveSection(index, -1)} disabled={index === 0}>
                          ↑
                        </button>
                        <button
                          type="button"
                          className="btn sm"
                          onClick={() => moveSection(index, 1)}
                          disabled={index === sections.length - 1}
                        >
                          ↓
                        </button>
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {tab === 'columns' && (
                <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
                  {columns.length === 0 ? (
                    <p className="small muted">
                      هذا القالب لا يحمل جدول أعمدة (مثل السندات والقيود) — حقوله ثابتة في المستند نفسه.
                    </p>
                  ) : (
                    <>
                      <p className="small muted" style={{ margin: 0 }}>
                        اختر الأعمدة الظاهرة، وسمّها كما تحب، ورتّبها. إخفاء عمود لا يحذف مبلغه من الإجماليات.
                      </p>
                      {columns.map((column, index) => (
                        <div
                          key={column.key}
                          className="row"
                          style={{
                            gap: 6,
                            alignItems: 'center',
                            border: '1px solid #e5e7eb',
                            borderRadius: 8,
                            padding: '6px 10px',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={column.visible}
                            onChange={(event) => updateColumn(index, { visible: event.target.checked })}
                            aria-label={`إظهار العمود ${column.key}`}
                          />
                          <span className="small muted" dir="ltr" style={{ minWidth: 92 }}>
                            {column.key}
                          </span>
                          <input
                            className="input"
                            value={column.labelAr ?? ''}
                            placeholder={
                              entry?.defaultColumns.find((defaultColumn) => defaultColumn.key === column.key)?.labelAr ??
                              column.key
                            }
                            onChange={(event) => updateColumn(index, { labelAr: event.target.value })}
                            style={{ flex: 1 }}
                          />
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() => moveColumn(index, -1)}
                            disabled={index === 0}
                          >
                            ↑
                          </button>
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() => moveColumn(index, 1)}
                            disabled={index === columns.length - 1}
                          >
                            ↓
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              )}

              {tab === 'extras' && (
                <FormGrid cols={1} className="mt-3">
                  <div className="field wide">
                    <span>حقول وخانات إضافية تظهر على الورقة</span>
                    <div style={{ display: 'grid', gap: 6 }}>
                      {customFields.map((field, index) => (
                        <div key={`${field.label}-${index}`} className="row" style={{ gap: 6, alignItems: 'center' }}>
                          <input
                            className="input"
                            value={field.label}
                            placeholder="اسم الحقل — مثال: رقم أمر الشراء"
                            onChange={(event) =>
                              patchDesign({
                                customFields: customFields.map((entryField, i) =>
                                  i === index ? { ...entryField, label: event.target.value } : entryField,
                                ),
                              })
                            }
                            style={{ flex: 1 }}
                          />
                          <input
                            className="input"
                            value={field.value}
                            placeholder="القيمة — مثال: PO-9988"
                            onChange={(event) =>
                              patchDesign({
                                customFields: customFields.map((entryField, i) =>
                                  i === index ? { ...entryField, value: event.target.value } : entryField,
                                ),
                              })
                            }
                            style={{ flex: 1 }}
                          />
                          <select
                            className="input"
                            value={field.placement}
                            onChange={(event) =>
                              patchDesign({
                                customFields: customFields.map((entryField, i) =>
                                  i === index
                                    ? { ...entryField, placement: event.target.value as typeof field.placement }
                                    : entryField,
                                ),
                              })
                            }
                            style={{ width: 130 }}
                          >
                            <option value="meta">مع البيانات</option>
                            <option value="above_table">قبل الجدول</option>
                            <option value="below_table">بعد الجدول</option>
                          </select>
                          <button
                            type="button"
                            className="btn sm"
                            onClick={() => patchDesign({ customFields: customFields.filter((_, i) => i !== index) })}
                          >
                            حذف
                          </button>
                        </div>
                      ))}
                      <button
                        type="button"
                        className="btn sm"
                        onClick={() =>
                          patchDesign({
                            customFields: [...customFields, { label: '', value: '', placement: 'meta' }],
                          })
                        }
                      >
                        + إضافة حقل
                      </button>
                    </div>
                  </div>

                  <label className="field wide">
                    <span>شروط وأحكام تُطبع أسفل الورقة</span>
                    <textarea
                      className="input"
                      rows={3}
                      value={design.customTerms ?? ''}
                      onChange={(event) => patchDesign({ customTerms: event.target.value })}
                      placeholder="مثال: البضاعة المباعة لا تُرد بعد 3 أيام — الضمان سنة كاملة من تاريخ الفاتورة."
                    />
                  </label>

                  <label className="field wide">
                    <span>مسمّيات التوقيعات (سطر لكل توقيع، حتى 5)</span>
                    <textarea
                      className="input"
                      rows={3}
                      value={signatureLabels.join('\n')}
                      onChange={(event) =>
                        patchDesign({
                          signatureLabels: event.target.value
                            .split('\n')
                            .map((line) => line.trim())
                            .filter(Boolean)
                            .slice(0, 5),
                        })
                      }
                    />
                  </label>

                  <label className="field wide">
                    <span>ملاحظة تُطبع أسفل الورقة</span>
                    <input
                      className="input"
                      value={form.note}
                      onChange={(event) => patchField('note', event.target.value)}
                      placeholder="تظهر في صندوق «ملاحظات التقرير» أسفل الجدول"
                    />
                  </label>

                  <FormGrid cols={3}>
                    <label className="field">
                      <span>صورة الترويسة (https)</span>
                      <input
                        className="input"
                        dir="ltr"
                        value={form.headerImageUrl}
                        onChange={(event) => patchField('headerImageUrl', event.target.value)}
                        placeholder="https://…/header.png"
                      />
                    </label>
                    <label className="field">
                      <span>صورة التذييل</span>
                      <input
                        className="input"
                        dir="ltr"
                        value={form.footerImageUrl}
                        onChange={(event) => patchField('footerImageUrl', event.target.value)}
                        placeholder="https://…/footer.png"
                      />
                    </label>
                    <label className="field">
                      <span>صورة الختم</span>
                      <input
                        className="input"
                        dir="ltr"
                        value={form.stampImageUrl}
                        onChange={(event) => patchField('stampImageUrl', event.target.value)}
                        placeholder="https://…/stamp.png"
                      />
                    </label>
                  </FormGrid>
                </FormGrid>
              )}

              {tab === 'desktop' && (
                <div style={{ marginTop: 12, display: 'grid', gap: 12 }}>
                  <p className="small muted" style={{ margin: 0 }}>
                    هذه الحقول تخصّ <strong>تطبيق سطح المكتب</strong> فقط: هناك يحدّد المشغّل ملف قالب
                    <span dir="ltr"> .repx </span> ومجلد التقارير على القرص. وفي السحابة لا يوجد ملف على جهاز
                    العميل، فالتصميم هو الذي يحدّد شكل الورقة. تُحفظ القيم لأي نسخةٍ من سطح المكتب تقرأ نفس
                    الإعدادات.
                  </p>
                  <FormGrid cols={2}>
                    <label className="field">
                      <span>اسم ملف التقرير (سطح المكتب)</span>
                      <input
                        className="input"
                        dir="ltr"
                        value={form.rptName}
                        onChange={(event) => patchField('rptName', event.target.value)}
                        placeholder="RptSalesInPeriod1.repx"
                      />
                    </label>
                    <label className="field">
                      <span>مسار التقارير على القرص (سطح المكتب)</span>
                      <input
                        className="input"
                        dir="ltr"
                        value={form.rptUrl}
                        onChange={(event) => patchField('rptUrl', event.target.value)}
                        placeholder="C:\SmartAuditERP\Reports"
                      />
                    </label>
                  </FormGrid>
                  <div className="small muted">
                    بنود خاصة بإصدار سطح المكتب: تفاصيل الأصناف، مجموعات الأصناف، مكونات الأصناف المركبة، و
                    <span dir="ltr"> make pay </span>. لا تؤثر على ورق السحابة، وتُحفظ كما هي للتوافق.
                  </div>
                  <div className="toolbar" style={{ flexWrap: 'wrap', gap: 12 }}>
                    <ToggleLine
                      label="طباعة تفاصيل الأصناف"
                      checked={form.printItemDetails}
                      onChange={(value) => patchField('printItemDetails', value)}
                    />
                    <ToggleLine
                      label="طباعة مجموعات الأصناف"
                      checked={form.printItemGroups}
                      onChange={(value) => patchField('printItemGroups', value)}
                    />
                    <ToggleLine
                      label="مكونات الأصناف المركبة منفردة"
                      checked={form.printComponentsIndividually}
                      onChange={(value) => patchField('printComponentsIndividually', value)}
                    />
                    <ToggleLine
                      label="طباعة make pay"
                      checked={form.printMakePay}
                      onChange={(value) => patchField('printMakePay', value)}
                    />
                  </div>
                </div>
              )}

              <Notice notice={notice} />
              <FormActions>
                <button className="btn" type="button" disabled={busy || !scopedRow?.saved} onClick={() => void resetTemplate()}>
                  إرجاع إلى الافتراضي
                </button>
                <button className="btn primary" type="submit" disabled={busy}>
                  {busy ? 'جارٍ الحفظ…' : 'حفظ القالب'}
                </button>
              </FormActions>
            </form>
          </Panel>
        </div>

        <div style={{ position: 'sticky', top: 12, display: 'grid', gap: 10 }}>
          <Panel
            title="معاينة الورقة — كما تُطبع"
            hint="تُرسم على الخادم بنفس دوال الطباعة وبنفس CSS، وتتحدث مع كل تعديل قبل الحفظ."
            flush
          >
            <div
              className="toolbar"
              style={{ flexWrap: 'wrap', gap: 6, padding: '8px 10px', borderBottom: '1px solid #e5e7eb' }}
            >
              <button type="button" className="btn sm" onClick={() => setZoom(1)}>
                100%
              </button>
              <button type="button" className="btn sm" onClick={() => setZoom(0.75)}>
                75%
              </button>
              <button type="button" className="btn sm" onClick={() => setZoom(1.25)}>
                125%
              </button>
              <span className="chip">
                {paperKey === 'a4' ? 'A4' : `حراري ${paperKey} مم`}
              </span>
              <span className="chip">{form.template === 'modern' ? 'عصري' : form.template === 'minimal' ? 'مختصر' : 'كلاسيكي'}</span>
              {previewBusy ? <span className="small muted">جارٍ التحديث…</span> : null}
              <button type="button" className="btn sm primary" onClick={openPrintWindow} disabled={!preview}>
                طباعة تجريبية
              </button>
            </div>

            {previewError ? (
              <div style={{ padding: 12 }}>
                <Notice notice={{ kind: 'danger', text: previewError }} />
              </div>
            ) : null}

            <div
              ref={previewBoxRef}
              style={{ background: '#eef0f4', padding: 10, overflow: 'hidden', maxHeight: '72vh' }}
            >
              {preview ? (
                <div
                  style={{
                    width: LOGICAL_WIDTH,
                    height: LOGICAL_HEIGHT * previewScale,
                    transform: `scale(${previewScale})`,
                    transformOrigin: 'top right',
                    marginInlineStart: 'auto',
                    direction: 'rtl',
                  }}
                >
                  <iframe
                    title="معاينة الورقة"
                    srcDoc={preview}
                    style={{
                      width: LOGICAL_WIDTH,
                      height: LOGICAL_HEIGHT,
                      border: 'none',
                      background: '#fff',
                      display: 'block',
                    }}
                  />
                </div>
              ) : (
                <div className="small muted" style={{ padding: 24, textAlign: 'center' }}>
                  جارٍ تجهيز المعاينة…
                </div>
              )}
            </div>
          </Panel>

          <Panel
            title="ربط الطابعات بالتقارير"
            hint="اسم طباعة يظهر بجانب زر الطباعة، وطابعة يختارها المتصفح، وملف تقرير لسطح المكتب."
            flush
          >
            <form className="toolbar" onSubmit={addLink} style={{ flexWrap: 'wrap', gap: 6, padding: 10 }}>
              <select
                className="input"
                value={linkForm.scope}
                onChange={(event) => setLinkForm((current) => ({ ...current, scope: event.target.value }))}
                style={{ minWidth: 130 }}
              >
                {PRINT_SCOPES.map((preset) => (
                  <option key={preset.scope} value={preset.scope}>
                    {preset.labelAr}
                  </option>
                ))}
                <option value={scope}>القالب المختار</option>
              </select>
              <input
                className="input"
                placeholder="اسم الطباعة"
                value={linkForm.printName}
                onChange={(event) => setLinkForm((current) => ({ ...current, printName: event.target.value }))}
                style={{ minWidth: 120 }}
              />
              <input
                className="input"
                placeholder="اسم الطابعة"
                list="device-printers"
                value={linkForm.printerName}
                onChange={(event) => setLinkForm((current) => ({ ...current, printerName: event.target.value }))}
                style={{ minWidth: 130 }}
              />
              <datalist id="device-printers">
                {printers.map((printer) => (
                  <option key={printer.name} value={printer.name} />
                ))}
              </datalist>
              <button className="btn primary sm" type="submit" disabled={linkBusy}>
                {linkBusy ? '…' : 'إضافة'}
              </button>
            </form>
            {linkNotice ? (
              <div style={{ padding: '0 10px 8px' }}>
                <Notice notice={linkNotice} />
              </div>
            ) : null}
            <Table
              bare
              empty="لا روابط محفوظة بعد."
              columns={[
                { key: 'printName', header: 'اسم الطباعة', cell: (link) => link.printName },
                { key: 'printer', header: 'الطابعة', cell: (link) => link.printerName },
                {
                  key: 'scope',
                  header: 'النطاق',
                  cell: (link) => <span className="small">{link.scopeLabelAr}</span>,
                },
                {
                  key: 'actions',
                  header: '',
                  cell: (link) => (
                    <button className="btn sm" disabled={linkBusy} onClick={() => void removeLink(link.id)}>
                      حذف
                    </button>
                  ),
                },
              ]}
              rows={printerLinks.data ?? []}
              rowKey={(link) => link.id}
            />
          </Panel>
        </div>
      </div>
    </Screen>
  );
}

/**
 * تنظيف التصميم قبل الحفظ: الحقول الإضافية الفارغة تُحذف (لا معنى لسطرٍ بلا اسم)،
 * وقائمة توقيعات فارغة تعني «توقيعات القالب الافتراضية» فلا تُرسل.
 */
function sanitizeDesignForSave(design: PrintDesignConfig): PrintDesignConfig {
  const cleaned: PrintDesignConfig = { ...design };
  const fields = (design.customFields ?? []).filter((field) => field.label.trim().length > 0);
  cleaned.customFields = fields.length > 0 ? fields : undefined;
  const labels = (design.signatureLabels ?? []).map((label) => label.trim()).filter(Boolean);
  cleaned.signatureLabels = labels.length > 0 ? labels : undefined;
  if (!cleaned.customTitleAr?.trim()) cleaned.customTitleAr = undefined;
  if (!cleaned.customSubtitleAr?.trim()) cleaned.customSubtitleAr = undefined;
  if (!cleaned.customTerms?.trim()) cleaned.customTerms = undefined;
  if (!cleaned.watermarkText?.trim()) cleaned.watermarkText = undefined;
  return cleaned;
}

function ToggleLine({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="check" style={{ cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="small">{label}</span>
    </label>
  );
}

function PrinterField({
  label,
  hint,
  value,
  onChange,
  printers,
  onDetect,
  suggested,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  printers: DetectedPrinter[];
  onDetect: () => void;
  suggested?: string;
}) {
  const listId = `printers-${label.replace(/\s+/g, '-')}`;
  return (
    <label className="field wide">
      <span>{label}</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        <input
          className="input"
          list={listId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={suggested ? `مثال: ${suggested} — أو اختر من طابعات الجهاز` : 'اسم الطابعة كما هو في النظام'}
          style={{ flex: 1, minWidth: 200 }}
        />
        <datalist id={listId}>
          {printers.map((printer) => (
            <option key={`${printer.source}:${printer.name}`} value={printer.name} />
          ))}
        </datalist>
        <button type="button" className="btn sm" onClick={onDetect}>
          تحديث طابعات الجهاز ({printers.length})
        </button>
      </div>
      <span className="small muted">{hint}</span>
      {printers.length > 0 ? (
        <span className="small muted" dir="auto">
          المكتشف: {printers.map((printer) => printer.name).join(' · ')}
        </span>
      ) : null}
    </label>
  );
}
