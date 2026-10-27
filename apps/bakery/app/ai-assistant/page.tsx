'use client';

import Link from 'next/link';
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
} from '@erp/ui';
import { apiData, apiErrorText, apiList, apiPost } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';

type ChatTurn = { id: string; role: 'user' | 'assistant'; content: string };

type SuggestionRow = { id?: string; title?: string; summary?: string; severity?: string };
type ConversationSummary = { id: string; title?: string; updatedAt?: string };

export default function BakeryAiAssistantPage() {
  const { can } = useSession();
  const canManageSettings = can('ai.settings.manage');

  const [messages, setMessages] = useState<ChatTurn[]>([]);
  const [conversationId, setConversationId] = useState<string>('');
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [suggestions, setSuggestions] = useState<SuggestionRow[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadContext = useCallback(async () => {
    const [sug, conv] = await Promise.all([
      apiList<SuggestionRow>('/ai/suggestions').catch(() => []),
      apiList<ConversationSummary>('/ai/conversations').catch(() => []),
    ]);
    setSuggestions(sug);
    setConversations(conv);
  }, []);

  useEffect(() => {
    void loadContext();
  }, [loadContext]);

  const openConversation = async (id: string) => {
    try {
      const stored = await apiData<{
        id: string;
        messages?: Array<{ id?: string; role: 'user' | 'assistant'; content: string }>;
      }>(`/ai/conversations/${encodeURIComponent(id)}`);
      setConversationId(stored.id);
      setMessages(
        (stored.messages ?? []).map((m, idx) => ({
          id: m.id ?? `m-${idx}`,
          role: m.role,
          content: m.content,
        })),
      );
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر فتح المحادثة السابقة'));
    }
  };

  const sendMessage = async (textOverride?: string) => {
    const text = (textOverride ?? draft).trim();
    if (!text || sending) return;
    if (!textOverride) setDraft('');
    setSending(true);
    setError(null);
    setMessages((prev) => [...prev, { id: `u-${Date.now()}`, role: 'user', content: text }]);
    try {
      const res = await apiPost<{ conversationId?: string; text?: string; reply?: string }>('/ai/chat', {
        message: text,
        ...(conversationId ? { conversationId } : {}),
        stream: false,
      });
      if (res.conversationId) setConversationId(res.conversationId);
      setMessages((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: res.text ?? res.reply ?? 'تمت معالجة السؤال بنجاح.',
        },
      ]);
      void loadContext();
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر الاتصال بالمساعد الذكي — تحقق من إعدادات المزود'));
    } finally {
      setSending(false);
    }
  };

  const refreshSuggestions = async () => {
    setGenerating(true);
    try {
      await apiPost('/ai/suggest', {});
      await loadContext();
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر توليد تنبيهات اليوم الذكية'));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <section className="ui-page">
      <header className="ui-page-head">
        <div className="ui-page-head-copy">
          <h1 className="ui-page-title">المساعد الذكي للمخبز</h1>
          <p className="ui-page-sub">
            تحليل فوري لمبيعات اليوم والإنتاج وعهد المناديب والأرصدة المحاسبية باللغة العربية.
          </p>
        </div>
        <div className="ui-page-actions">
          <Button disabled={generating} onClick={() => void refreshSuggestions()} size="sm">
            {generating ? 'جارٍ التوليد…' : 'توليد تنبيهات اليوم'}
          </Button>
          {canManageSettings ? (
            <Link className="bak-link-btn" href="/ai-settings">
              إعدادات الذكاء الاصطناعي
            </Link>
          ) : null}
        </div>
      </header>

      <div className="ui-screen-body">
        {error ? (
          <Card>
            <CardBody>
              <Badge status="rejected">{error}</Badge>
            </CardBody>
          </Card>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-12">
          <div className="grid gap-3 lg:col-span-4">
            <Panel title="تنبيهات واقتراحات ذكية" hint="مقروءة من مؤشرات المخبز">
              {suggestions.length === 0 ? (
                <p className="m-0 text-[12.5px] text-muted">لا تنبيهات جديدة حالياً — اضغط توليد تنبيهات اليوم.</p>
              ) : (
                <div className="grid gap-2">
                  {suggestions.slice(0, 6).map((s, idx) => (
                    <div className="rounded-lg border border-line bg-surface-2 p-2.5 text-[12.5px]" key={s.id ?? idx}>
                      <div className="font-bold text-ink">{s.title ?? 'تنبيه تشغيلي'}</div>
                      <p className="m-0 mt-1 text-muted">{s.summary ?? ''}</p>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel title="المحادثات السابقة" hint={`${conversations.length} محادثة`}>
              <div className="grid gap-1.5">
                <Button
                  onClick={() => {
                    setConversationId('');
                    setMessages([]);
                  }}
                  size="sm"
                >
                  + بدء محادثة جديدة
                </Button>
                {conversations.slice(0, 8).map((c) => (
                  <button
                    className="rounded-lg border border-line bg-surface px-2.5 py-2 text-start text-[12.5px] hover:bg-surface-2"
                    key={c.id}
                    onClick={() => void openConversation(c.id)}
                    type="button"
                  >
                    <div className="font-semibold text-ink">{c.title ?? 'محادثة تحليلية'}</div>
                    <div className="text-[11px] text-muted" dir="ltr">
                      {String(c.updatedAt ?? '').slice(0, 16).replace('T', ' ')}
                    </div>
                  </button>
                ))}
              </div>
            </Panel>
          </div>

          <div className="lg:col-span-8">
            <Card>
              <CardHeader
                subtitle="اسأل عن مبيعات اليوم أو أعلى الأصناف أو ذمم العملاء أو أداء المناديب."
                title="مساحة المحادثة الذكية"
              />
              <CardBody>
                <div className="mb-3 flex flex-wrap gap-1.5">
                  {[
                    'لخّص مبيعات وتحصيلات المخبز اليوم',
                    'ما الأصناف المقاربة لنفاد المخزون؟',
                    'اعرض حالة عهد المناديب غير المقفلة',
                  ].map((prompt) => (
                    <Button key={prompt} onClick={() => void sendMessage(prompt)} size="sm">
                      {prompt}
                    </Button>
                  ))}
                </div>

                <div className="mb-3 grid max-h-[420px] gap-2.5 overflow-y-auto rounded-xl border border-line bg-surface-2 p-3">
                  {messages.length === 0 ? (
                    <EmptyState
                      description="اكتب سؤالك بالأسفل أو اختر أحد الأسئلة السريعة أعلاه."
                      icon={<span aria-hidden="true">✦</span>}
                      title="جاهز للإجابة عن بيانات منشأتك"
                    />
                  ) : (
                    messages.map((m) => (
                      <div
                        className={`rounded-xl border p-3 text-[13px] ${
                          m.role === 'user'
                            ? 'border-brand/30 bg-brand-soft/40 font-semibold text-ink'
                            : 'border-line bg-surface text-ink'
                        }`}
                        key={m.id}
                      >
                        <div className="mb-1 text-[11px] font-bold text-muted">
                          {m.role === 'user' ? 'أنت' : 'المساعد الذكي'}
                        </div>
                        <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
                      </div>
                    ))
                  )}
                </div>

                <div className="flex gap-2">
                  <div className="flex-1">
                    <Input
                      label="اكتب سؤالك المحاسبي أو التشغيلي"
                      onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void sendMessage();
                      }}
                      placeholder="مثال: كم صافي المبيعات والتحصيل النقدي اليوم؟"
                      value={draft}
                    />
                  </div>
                  <div className="self-end">
                    <Button disabled={sending || !draft.trim()} onClick={() => void sendMessage()} variant="primary">
                      {sending ? 'جارٍ التحليل…' : 'إرسال'}
                    </Button>
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
}
