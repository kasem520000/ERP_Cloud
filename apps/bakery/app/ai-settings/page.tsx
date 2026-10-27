'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
  Select,
} from '@erp/ui';
import { apiData, apiErrorText, apiPost, apiPut } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';

type AiSettingsDto = {
  enabled?: boolean;
  provider?: string | null;
  model?: string | null;
  baseUrl?: string | null;
  hasTenantApiKey?: boolean;
  monthlyTokenLimit?: number | null;
  monthlyCostLimit?: string | null;
};

export default function BakeryAiSettingsPage() {
  const { can } = useSession();
  const canManage = can('ai.settings.manage');

  const [enabled, setEnabled] = useState(true);
  const [provider, setProvider] = useState('openai');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [hasKey, setHasKey] = useState(false);
  const [tokenLimit, setTokenLimit] = useState('');
  const [costLimit, setCostLimit] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const s = await apiData<AiSettingsDto>('/ai/settings');
      setEnabled(Boolean(s.enabled));
      setProvider(s.provider ?? 'openai');
      setModel(s.model ?? '');
      setBaseUrl(s.baseUrl ?? '');
      setHasKey(Boolean(s.hasTenantApiKey));
      setTokenLimit(s.monthlyTokenLimit != null ? String(s.monthlyTokenLimit) : '');
      setCostLimit(s.monthlyCostLimit ?? '');
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر قراءة إعدادات الذكاء الاصطناعي') });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveSettings = async (clearKey = false) => {
    setSaving(true);
    setNotice(null);
    try {
      await apiPut('/ai/settings', {
        enabled,
        provider: provider || null,
        model: model.trim() || null,
        baseUrl: baseUrl.trim() || null,
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(clearKey ? { clearApiKey: true } : {}),
        monthlyTokenLimit: tokenLimit.trim() ? Number(tokenLimit) : null,
        monthlyCostLimit: costLimit.trim() || null,
      });
      setApiKey('');
      setNotice({ tone: 'ok', text: 'تم حفظ إعدادات مزود الذكاء الاصطناعي بنجاح.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر حفظ الإعدادات') });
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    setTesting(true);
    setNotice(null);
    try {
      const res = await apiPost<{ ok?: boolean; message?: string; latencyMs?: number }>('/ai/settings/test', {});
      setNotice({
        tone: res.ok !== false ? 'ok' : 'danger',
        text: res.message ?? `الاتصال سليم (${res.latencyMs ?? 0} مللي ثانية).`,
      });
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'فشل فحص الاتصال بالمزود') });
    } finally {
      setTesting(false);
    }
  };

  return (
    <section className="ui-page">
      <header className="ui-page-head">
        <div className="ui-page-head-copy">
          <h1 className="ui-page-title">إعدادات الذكاء الاصطناعي</h1>
          <p className="ui-page-sub">
            ضبط مزود النموذج الذكي ومفتاح الربط المشفّر وسقف الاستهلاك الشهري لمنشأتك.
          </p>
        </div>
        <div className="ui-page-actions">
          <Button disabled={testing || !canManage} onClick={() => void testConnection()} size="sm">
            {testing ? 'جارٍ الفحص…' : 'فحص الاتصال'}
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

        <Card>
          <CardHeader
            subtitle={loading ? 'جارٍ القراءة…' : hasKey ? 'مفتاح خاص محفوظ ومشفّر للمنشأة.' : 'تستعمل المنشأة المزود الافتراضي للمنصة إن وُجد.'}
            title="إعدادات المزود والنموذج"
          />
          <CardBody>
            <div className="grid max-w-2xl gap-3">
              <label className="flex items-center gap-2 text-[13px] font-semibold">
                <input checked={enabled} onChange={(e) => setEnabled(e.target.checked)} type="checkbox" />
                تفعيل المساعد الذكي لمستخدمي المنشأة
              </label>
              <div className="grid gap-2 sm:grid-cols-2">
                <Select
                  label="المزود"
                  onChange={(e) => setProvider(e.target.value)}
                  options={[
                    { value: 'openai', label: 'OpenAI / متوافق' },
                    { value: 'anthropic', label: 'Anthropic Claude' },
                    { value: 'gemini', label: 'Google Gemini' },
                  ]}
                  value={provider}
                />
                <Input label="اسم النموذج" onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o-mini" value={model} />
              </div>
              <Input
                label="عنوان الخادم المخصص (اختياري)"
                onChange={(e) => setBaseUrl(e.target.value)}
                placeholder="https://api.openai.com/v1"
                value={baseUrl}
              />
              <Input
                label={hasKey ? 'مفتاح API جديد (اتركه فارغاً للإبقاء على المفتاح المحفوظ)' : 'مفتاح API'}
                onChange={(e) => setApiKey(e.target.value)}
                type="password"
                value={apiKey}
              />
              <div className="grid gap-2 sm:grid-cols-2">
                <Input
                  inputMode="numeric"
                  label="سقف الرموز الشهري (اختياري)"
                  onChange={(e) => setTokenLimit(e.target.value)}
                  value={tokenLimit}
                />
                <Input
                  inputMode="decimal"
                  label="سقف التكلفة الشهرية"
                  onChange={(e) => setCostLimit(e.target.value)}
                  value={costLimit}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={!canManage || saving} onClick={() => void saveSettings(false)} variant="primary">
                  {saving ? 'جارٍ الحفظ…' : 'حفظ الإعدادات'}
                </Button>
                {hasKey && canManage ? (
                  <Button disabled={saving} onClick={() => void saveSettings(true)} size="sm">
                    مسح المفتاح المحفوظ
                  </Button>
                ) : null}
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </section>
  );
}
