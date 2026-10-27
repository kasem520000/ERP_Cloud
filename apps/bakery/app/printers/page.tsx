'use client';

import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Select,
} from '@erp/ui';

import { openHtmlPrintWindow } from '../../lib/server-print';

const STORAGE_KEY = 'erp.bakery.printerPrefs.v1';

type PrinterPrefs = {
  posFormat: '80mm' | 'a4';
  salesFormat: 'a4' | '80mm';
  copies: '1' | '2';
  autoPrintPos: boolean;
  printerHint: string;
};

const DEFAULT_PREFS: PrinterPrefs = {
  posFormat: '80mm',
  salesFormat: 'a4',
  copies: '2',
  autoPrintPos: true,
  printerHint: '',
};

export default function BakeryPrintersPage() {
  const [prefs, setPrefs] = useState<PrinterPrefs>(DEFAULT_PREFS);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) setPrefs({ ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<PrinterPrefs>) });
    } catch {
      // ignore storage errors
    }
  }, []);

  const save = () => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 3000);
    } catch {
      // ignore
    }
  };

  const printSample = (mode: '80mm' | 'a4') => {
    const html = `<!doctype html>
<html dir="rtl" lang="ar">
<head>
  <meta charset="utf-8" />
  <title>اختبار طباعة المخبز</title>
  <style>
    body { font-family: 'Cairo', 'Tajawal', sans-serif; margin: ${mode === '80mm' ? '4mm' : '14mm'}; color: #111; }
    .box { max-width: ${mode === '80mm' ? '74mm' : '180mm'}; margin: 0 auto; border: 1px dashed #333; padding: 12px; }
    h2 { margin: 0 0 6px; font-size: 16px; text-align: center; }
    p { margin: 4px 0; font-size: 12px; text-align: center; }
  </style>
</head>
<body>
  <div class="box">
    <h2>فاتورة ضريبية مبسطة — اختبار</h2>
    <p>مقاس الورق: ${mode === '80mm' ? 'حراري 80mm (rptInv)' : 'ورق رسمي A4 (rptInvA4)'}</p>
    <p>عدد النسخ الافتراضي للمندوب: ${prefs.copies}</p>
    <p>توقيت مكة المكرمة (Asia/Riyadh)</p>
  </div>
</body>
</html>`;
    openHtmlPrintWindow(html);
  };

  return (
    <section className="ui-page">
      <header className="ui-page-head">
        <div className="ui-page-head-copy">
          <h1 className="ui-page-title">إعدادات الطابعات وقوالب الفواتير</h1>
          <p className="ui-page-sub">
            تخصيص مقاس إيصال الكاشير الحراري 80mm وفواتير وتقارير A4 الرسمية واختبار الطباعة المباشرة على هذا الجهاز.
          </p>
        </div>
        <div className="ui-page-actions">
          <Button onClick={() => printSample('80mm')} size="sm">
            اختبار إيصال 80mm
          </Button>
          <Button onClick={() => printSample('a4')} size="sm">
            اختبار صفحة A4
          </Button>
        </div>
      </header>

      <div className="ui-screen-body">
        {saved ? (
          <Card>
            <CardBody>
              <Badge status="active">تم حفظ تفضيلات الطابعة لهذا المتصفح بنجاح.</Badge>
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader
            subtitle="تلتزم جميع الفواتير بقوالب الخادم المعتمدة ورمز الاستجابة السريعة الضريبي."
            title="تفضيلات الطباعة المحلية"
          />
          <CardBody>
            <div className="grid max-w-2xl gap-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <Select
                  label="قالب نقطة البيع الافتراضي"
                  onChange={(e) => setPrefs((p) => ({ ...p, posFormat: e.target.value as '80mm' | 'a4' }))}
                  options={[
                    { value: '80mm', label: 'إيصال حراري 80mm' },
                    { value: 'a4', label: 'فاتورة A4 كاملة' },
                  ]}
                  value={prefs.posFormat}
                />
                <Select
                  label="قالب فواتير المبيعات والتقارير"
                  onChange={(e) => setPrefs((p) => ({ ...p, salesFormat: e.target.value as 'a4' | '80mm' }))}
                  options={[
                    { value: 'a4', label: 'قالب A4 رسمي' },
                    { value: '80mm', label: 'إيصال حراري 80mm' },
                  ]}
                  value={prefs.salesFormat}
                />
                <Select
                  label="نسخ إيصال المندوب"
                  onChange={(e) => setPrefs((p) => ({ ...p, copies: e.target.value as '1' | '2' }))}
                  options={[
                    { value: '2', label: 'نسختان (للعميل وللعهدة)' },
                    { value: '1', label: 'نسخة واحدة' },
                  ]}
                  value={prefs.copies}
                />
              </div>
              <Input
                label="اسم الطابعة المرجعي على هذا الجهاز (تذكيري)"
                onChange={(e) => setPrefs((p) => ({ ...p, printerHint: e.target.value }))}
                placeholder="مثال: Epson TM-T20III الكاشير الأول"
                value={prefs.printerHint}
              />
              <label className="flex items-center gap-2 text-[12.5px] font-semibold">
                <input
                  checked={prefs.autoPrintPos}
                  onChange={(e) => setPrefs((p) => ({ ...p, autoPrintPos: e.target.checked }))}
                  type="checkbox"
                />
                فتح نافذة الطباعة تلقائياً فور إتمام قبض الكاشير
              </label>
              <div>
                <Button onClick={save} variant="primary">
                  حفظ تفضيلات الطباعة
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </section>
  );
}
