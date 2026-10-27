'use client';

import Decimal from 'decimal.js';
import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  Input,
  Panel,
  Select,
} from '@erp/ui';
import { apiData, apiErrorText, apiList, apiPut } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';

type ShortagePolicyPayload = {
  shortageValuationBasis?: string;
  shortageUnitPrice?: string | null;
  valuationSource?: string;
  preventSelfApproval?: boolean;
  chargeReadiness?: {
    ready?: boolean;
    blockingReason?: string | null;
    employeeAccountReady?: boolean;
    offsetAccountReady?: boolean;
  };
};

export default function BakeryPolicyPage() {
  const { can } = useSession();
  const canOverride = can('van_sales.override.approve');

  const [policy, setPolicy] = useState<ShortagePolicyPayload | null>(null);
  const [salesmen, setSalesmen] = useState<Array<{ id: string; name?: string; employeeName?: string }>>([]);
  const [selectedSalesmanId, setSelectedSalesmanId] = useState('');
  const [basis, setBasis] = useState('sale_price');
  const [unitPrice, setUnitPrice] = useState('');
  const [preventSelfApproval, setPreventSelfApproval] = useState(true);

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const load = useCallback(async (salesmanId = '') => {
    setLoading(true);
    setError(null);
    try {
      const qs = salesmanId ? `?salesmanId=${encodeURIComponent(salesmanId)}` : '';
      const [pol, sm] = await Promise.all([
        apiData<ShortagePolicyPayload>(`/van-sales/policy${qs}`),
        apiList<{ id: string; name?: string; employeeName?: string }>('/van-sales/salesmen').catch(() => []),
      ]);
      setPolicy(pol);
      setSalesmen(sm);
      setBasis(pol.shortageValuationBasis ?? 'sale_price');
      setUnitPrice(pol.shortageUnitPrice ?? '');
      setPreventSelfApproval(pol.preventSelfApproval !== false);
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر قراءة سياسة تقييم العجز'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(selectedSalesmanId);
  }, [load, selectedSalesmanId]);

  const savePolicy = async () => {
    setSaving(true);
    setNotice(null);
    try {
      await apiPut('/van-sales/policy', {
        shortageValuationBasis: basis,
        ...(unitPrice.trim() ? { shortageUnitPrice: new Decimal(unitPrice).toString() } : {}),
        preventSelfApproval,
      });
      setNotice({ tone: 'ok', text: 'تم تحديث سياسة تقييم عجز العهدة بنجاح.' });
      await load(selectedSalesmanId);
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر حفظ السياسة') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="ui-page">
      <header className="ui-page-head">
        <div className="ui-page-head-copy">
          <h1 className="ui-page-title">سياسة تقييم العجز وجاهزية التحميل</h1>
          <p className="ui-page-sub">
            تحديد أساس تقييم العجز عند إقفال عهدة المندوب وفحص جاهزية الحسابات المحاسبية لتحميل العجز.
          </p>
        </div>
        <div className="ui-page-actions">
          <Button onClick={() => void load(selectedSalesmanId)} size="sm">
            تحديث القراءة
          </Button>
        </div>
      </header>

      <div className="ui-screen-body">
        {notice ? (
          <Card>
            <CardBody>
              <Badge status={notice.tone === 'ok' ? 'active' : 'rejected'}>{notice.text}</Badge>
            </CardBody>
          </Card>
        ) : null}

        {loading ? (
          <Panel title="سياسة العجز" hint="جارٍ القراءة من الخادم…">
            <p className="text-[13px] text-muted">تُقرأ السياسة وجاهزية الحسابات…</p>
          </Panel>
        ) : error ? (
          <Panel title="تعذّر القراءة" hint={error}>
            <EmptyState
              action={
                <Button onClick={() => void load(selectedSalesmanId)} size="sm">
                  إعادة المحاولة
                </Button>
              }
              description={error}
              icon={<span aria-hidden="true">!</span>}
              title="خطأ في تحميل السياسة"
              tone="danger"
            />
          </Panel>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader subtitle="يُشترط إذن اعتماد التجاوزات والسياسة لتعديل هذه الإعدادات." title="إعدادات تقييم العجز" />
              <CardBody>
                <div className="grid gap-3">
                  <Select
                    label="أساس تقييم العجز"
                    onChange={(e) => setBasis(e.target.value)}
                    options={[
                      { value: 'sale_price', label: 'سعر البيع المعتمد للصنف' },
                      { value: 'cost_price', label: 'متوسط تكلفة الصنف في المستودع' },
                    ]}
                    value={basis}
                  />
                  <Input
                    inputMode="decimal"
                    label="سعر وحدة ثابت للعجز (اختياري — يتقدّم على الأساس أعلاه)"
                    onChange={(e) => setUnitPrice(e.target.value)}
                    placeholder="اتركه فارغاً لاستعمال أساس التقييم"
                    value={unitPrice}
                  />
                  <label className="flex items-center gap-2 text-[12.5px] font-semibold">
                    <input
                      checked={preventSelfApproval}
                      onChange={(e) => setPreventSelfApproval(e.target.checked)}
                      type="checkbox"
                    />
                    منع الاعتماد الذاتي لإقفال العهدة من نفس حساب مقدم الإقفال
                  </label>
                  <div>
                    <Button disabled={!canOverride || saving} onClick={() => void savePolicy()} variant="primary">
                      {saving ? 'جارٍ الحفظ…' : 'حفظ السياسة'}
                    </Button>
                  </div>
                </div>
              </CardBody>
            </Card>

            <Card>
              <CardHeader subtitle="اختر مندوباً لفحص جاهزية تحميل العجز على ذمته في دليل الحسابات." title="فحص الجاهزية المحاسبية" />
              <CardBody>
                <div className="grid gap-3">
                  <Select
                    label="المندوب المراد فحص جاهزيته"
                    onChange={(e) => setSelectedSalesmanId(e.target.value)}
                    options={[
                      { value: '', label: 'فحص السياسة العامة للمنشأة' },
                      ...salesmen.map((s) => ({
                        value: s.id,
                        label: s.name ?? s.employeeName ?? s.id,
                      })),
                    ]}
                    value={selectedSalesmanId}
                  />

                  <div className="grid gap-2 rounded-xl border border-line bg-surface-2 p-3 text-[13px]">
                    <div className="flex items-center justify-between">
                      <span>مصدر التقييم الفعلي:</span>
                      <strong>{policy?.valuationSource ?? basis}</strong>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>حالة جاهزية قيد تحميل العجز:</span>
                      <Badge status={policy?.chargeReadiness?.ready ? 'active' : 'pending'}>
                        {policy?.chargeReadiness?.ready ? 'جاهز للتحميل' : 'يتهيأ عند أول اعتماد أو يحتاج ربطاً'}
                      </Badge>
                    </div>
                    {policy?.chargeReadiness?.blockingReason ? (
                      <p className="m-0 text-[12.5px] text-muted">{policy.chargeReadiness.blockingReason}</p>
                    ) : null}
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>
        )}
      </div>
    </section>
  );
}
