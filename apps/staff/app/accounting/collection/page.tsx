'use client';

import Link from 'next/link';
import { useState } from 'react';

import { Directory, type Tile } from '../../../components/directory';
import { apiData, apiErrorText, apiList, apiPost } from '../../../lib/api';
import { accountLabel, listAccounts, postableOf, typeOf, type Account } from '../../../lib/accounts';
import { useQuery } from '../../../lib/use-query';

type ReminderRule = {
  id: string;
  minDays: number;
  maxDays: number | null;
  channel: 'whatsapp' | 'email' | 'log_only';
  cooldownDays: number;
  enabled: boolean;
};

type Party = { id: string; kind: string; name: string; phone?: string | null };

type ReminderEvent = {
  id: string;
  invoiceId: string | null;
  bandDays: number | null;
  channel: string;
  dispatchStatus: string;
  message: string;
  error?: string | null;
  dispatchedAt: string;
};

type Writeoff = {
  id: string;
  partyId: string;
  invoiceId: string;
  amount: string;
  status: 'draft' | 'approved';
  lossAccountId: string;
  allowanceUsed: string;
  lossUsed: string;
  recoveredAmount: string;
  reason: string;
};

type Provision = {
  id: string;
  partyId: string;
  percent: string;
  basisAmount: string;
  amount: string;
  expenseAccountId: string;
  allowanceAccountId: string;
  entryDate: string;
};

type Statement = {
  receivable: string;
  open: Array<{
    entryId: string;
    sourceId: string | null;
    debit: string;
    credit: string;
    date: string;
    allocated: string;
  }>;
  reminders: ReminderEvent[];
  writeoffs: Writeoff[];
};

type CashLocation = { id: string; nameAr: string; kind: string };

const CHANNEL_LABELS: Record<string, string> = { whatsapp: 'واتساب', email: 'بريد', log_only: 'سجل فقط' };
const STATUS_LABELS: Record<string, string> = { draft: 'مسوّدة', approved: 'معتمد' };

/**
 * MF-17 — إدارة التحصيل (D9): الدورة كاملة في شاشة واحدة.
 *
 *  • دليل القواعد: شرائح التأخر ⇐ قناة + هدوء (parties.manage).
 *  • لوح الطرف: كشف مصادقة (parties.view) + إرسال تذكير **يُسجَّل دائماً** + مخصص بنسبة
 *    + شطب مسوّدة ثم اعتماد بقيد (accounting.journal.post) + استرداد بسند قبض.
 *  • لا مساواة بين رسالة نجاح ودليل: كل حالة/خطأ يعود من الخادم يُعرض نصّاً.
 */
export default function CollectionPage() {
  const rules = useQuery<ReminderRule[]>(() => apiList<ReminderRule>('/ar-reminders'), []);
  const parties = useQuery<Party[]>(() => apiList<Party>('/parties'), []);
  const accounts = useQuery<Account[]>(() => listAccounts(), []);
  const provisions = useQuery<Provision[]>(() => apiList<Provision>('/ar-provisions'), []);
  const cashLocations = useQuery<CashLocation[]>(() => apiList<CashLocation>('/cash-locations'), []);

  const [partyId, setPartyId] = useState('');
  const [statement, setStatement] = useState<Statement | null>(null);
  const [loadMsg, setLoadMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [invoiceId, setInvoiceId] = useState('');
  const [woAmount, setWoAmount] = useState('');
  const [woReason, setWoReason] = useState('');
  const [provisionPercent, setProvisionPercent] = useState('10');
  const [recoveryByWriteoff, setRecoveryByWriteoff] = useState<Record<string, string>>({});

  const customers = (parties.data ?? []).filter((party) => party.kind === 'customer' || party.kind === 'both');
  const expenseAccounts = (accounts.data ?? []).filter((account) => postableOf(account) && typeOf(account) === 'expense');
  const allowanceAccounts = (accounts.data ?? []).filter(
    (account) => postableOf(account) && typeOf(account) === 'asset' && (account.normalBalance ?? 'debit') === 'credit',
  );
  const lossAccounts = expenseAccounts;
  const safes = (cashLocations.data ?? []).filter((location) => location.kind === 'safe');
  const rows = rules.data ?? [];

  const enabled = rows.filter((row) => row.enabled);
  const tiles: Tile[] = [
    { label: 'قواعد التأخر', value: rows.length, hint: `مفعّلة ${enabled.length}` },
    { label: 'شطوبات الطرف', value: (statement?.writeoffs ?? []).length, hint: 'في كشف الطرف المحمّل' },
    { label: 'رصيد الطرف المحمّل', value: statement ? Number(statement.receivable).toFixed(2) : '—', hint: partyId ? 'مصادَق عليه' : 'اختر طرفاً' },
  ];

  const loadStatement = async (id: string) => {
    if (!id) return;
    setBusy(true);
    setLoadMsg(null);
    try {
      const loaded = await apiData<Statement>(`/parties/${id}/statement`);
      setStatement(loaded);
      setInvoiceId('');
      setWoAmount('');
    } catch (error) {
      setStatement(null);
      setLoadMsg(apiErrorText(error));
    } finally {
      setBusy(false);
    }
  };

  const openInvoices = (statement?.open ?? []).filter(
    (row) => Number(row.debit) - Number(row.allocated) > 0.0001 && row.sourceId,
  );

  const act = async (fn: () => Promise<unknown>, ok: (result: unknown) => string) => {
    setBusy(true);
    setLoadMsg(null);
    try {
      const result = await fn();
      setLoadMsg(ok(result));
      await loadStatement(partyId);
      rules.reload();
      provisions.reload();
    } catch (error) {
      setLoadMsg(apiErrorText(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Directory<ReminderRule>
      listTitle="قواعد التذكير"
      title="قاعدة تذكير"
      subtitle="MF-17 — شرائح تأخر السداد ⇐ قناة الإرسال و هدوء إعادة المحاولة. الإرسال خارجي أفضل جهد، والتسجيل في سجل الطرف إجباري في كل الحالات."
      crumbs={['المحاسبة', 'العمليات', 'إدارة التحصيل']}
      listHint={
        <>
          الدورة الكاملة (تذكير ← مخصص ← شطب ← استرداد) في اللوح أسفله؛ تقرير «مصادقة رصيد»
          قابل للطباعة من <Link href="/reports">التقارير</Link>.
        </>
      }
      query={rules}
      tiles={tiles}
      createLabel="شريحة جديدة"
      formTitle="شريحة تأخر"
      empty="لا قواعد تذكير بعد"
      emptyDetail="أنشئ شريحة (مثال: من30 إلى89 يوماً — قناة واتساب) ليُسجَّل التذكير للطرف المتأخر."
      fields={[
        { name: 'minDays', label: 'من (يوم)', type: 'number', required: true, hint: 'الحد الأدنى لأيام التأخر (شموله).' },
        { name: 'maxDays', label: 'إلى (يوم)', type: 'number', hint: 'اتركه فارغاً لشريحة مفتوحة.' },
        {
          name: 'channel',
          label: 'القناة',
          type: 'select',
          required: true,
          options: [
            { id: 'whatsapp', label: 'واتساب' },
            { id: 'email', label: 'بريد (غير موصول بعد — يُسجَّل غير مُهيّأ)' },
            { id: 'log_only', label: 'سجل فقط' },
          ],
        },
        { name: 'cooldownDays', label: 'الهدوء (أيام)', type: 'number', required: true, hint: 'أيام بين تذكيرين للطرف نفسه.' },
        { name: 'enabled', label: 'مفعّلة', type: 'checkbox', hint: 'القواعد الموقوفة تُتجاوز في الإرسال.' },
      ]}
      onCreate={(values) =>
        apiPost('/ar-reminders', {
          minDays: Number(values.minDays || 0),
          maxDays: values.maxDays ? Number(values.maxDays) : null,
          channel: String(values.channel || 'whatsapp'),
          cooldownDays: Number(values.cooldownDays || 7),
          enabled: values.enabled !== false,
        })
      }
      footer={(ruleRows) => [
        <span key="count">القواعد: {ruleRows.length}</span>,
        <span key="hint">أي تأخر بلا شريحة يُرفض بـ REMINDER_NO_RULE — لا إرسال صامت.</span>,
      ]}
      rowLabel={(row) => `شريحة ${row.minDays}${row.maxDays != null ? `-${row.maxDays}` : '+'} يوم`}
      successText={(values) => `حُفظت شريحة التأخر من ${String(values.minDays)} يوم — ستُطبَّق على أول فاتورة متأخرة تدخلها.`}
      columns={[
        { key: 'band', header: 'الشريحة (يوم)', cell: (row) => (row.maxDays != null ? `${row.minDays} – ${row.maxDays}` : `${row.minDays}+`) },
        { key: 'channel', header: 'القناة', cell: (row) => CHANNEL_LABELS[row.channel] ?? row.channel },
        { key: 'cooldown', header: 'الهدوء', align: 'num', cell: (row) => `${row.cooldownDays} يوم` },
        { key: 'enabled', header: 'الحالة', cell: (row) => (row.enabled ? 'مفعّلة' : 'موقوفة') },
      ]}
      rowKey={(row) => row.id}
    >
      {/* لوح الدورة: كشف طرف + تذكير + مخصص + شطب + استرداد (MF-17). */}
      <section aria-label="إجراءات التحصيل" style={{ marginTop: 24 }}>
        <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>طرف ودورة التحصيل</h2>
        <p style={{ color: 'var(--muted, #667)', fontSize: 13, margin: '0 0 10px' }}>
          اختر عميلاً لعرض كشفه (الرصيد المصادَق عليه + الفواتير المتأخرة + سجل التذكير +
          الشطوبات)، ثم نفّذ الإجراءات — كل حالة/رفض من الخادم تظهر نصّاً كما هي.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
          <label htmlFor="party" style={{ fontSize: 13 }}>العميل</label>
          <select
            id="party"
            className="input"
            style={{ minWidth: 220 }}
            value={partyId}
            onChange={(event) => {
              setPartyId(event.target.value);
              setStatement(null);
            }}
          >
            <option value="">— اختر عميلاً —</option>
            {customers.map((party) => (
              <option key={party.id} value={party.id}>
                {party.name}
              </option>
            ))}
          </select>
          <button type="button" className="btn" disabled={!partyId || busy} onClick={() => loadStatement(partyId)}>
            {busy ? 'جارٍ…' : 'تحميل الكشف'}
          </button>
          {partyId ? (
            <Link href={`/reports/balance-confirmation?partyId=${partyId}`} style={{ fontSize: 13 }}>
              طباعة «مصادقة رصيد» ↗
            </Link>
          ) : null}
          {loadMsg ? (
            <span role="status" style={{ fontSize: 13 }}>
              {loadMsg}
            </span>
          ) : null}
        </div>

        {statement ? (
          <>
            <p style={{ fontSize: 14, margin: '0 0 10px' }}>
              <strong>الرصيد المصادَق عليه:</strong>{' '}
              <span style={{ fontFamily: 'monospace' }}>{statement.receivable}</span>
            </p>

            {/* إجراءات التحصيل الثلاثة */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() =>
                  act(
                    () => apiPost<ReminderEvent>(`/parties/${partyId}/send-reminder`, {}),
                    (result) => {
                      const event = result as ReminderEvent;
                      return `التذكير مُسجَّل: ${event.dispatchStatus}${event.error ? ` — ${event.error}` : ''}`;
                    },
                  )
                }
              >
                إرسال تذكير (يُسجَّل دائماً)
              </button>
              <span style={{ fontSize: 12, color: 'var(--muted, #667)' }}>
                بدون بوابة واتساب مُهيّأة يُسجَّل الحدث not_configured — لا ادّعاء إرسال.
              </span>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
              <label htmlFor="prov-percent" style={{ fontSize: 13 }}>مخصص</label>
              <input
                id="prov-percent"
                className="input"
                style={{ width: 70 }}
                type="number"
                min={1}
                max={100}
                value={provisionPercent}
                onChange={(event) => setProvisionPercent(event.target.value)}
              />
              <span style={{ fontSize: 13 }}>% من الرصيد</span>
              <button
                type="button"
                className="btn"
                disabled={busy || !statement || Number(statement.receivable) <= 0}
                onClick={() =>
                  act(
                    () =>
                      apiPost('/ar-provisions', {
                        partyId,
                        basis: statement?.receivable ?? '0',
                        percent: provisionPercent,
                        expenseAccountId: expenseAccounts[0]?.id ?? '',
                        allowanceAccountId: allowanceAccounts[0]?.id ?? '',
                      }),
                    (result) => `مُستوفى قيد المخصص بمبلغ ${String((result as Provision)?.amount ?? '')} — Dr مصروف / Cr مخصص.`,
                  )
                }
              >
                احتساب المخصص
              </button>
              {expenseAccounts.length === 0 || allowanceAccounts.length === 0 ? (
                <span style={{ fontSize: 12, color: 'var(--muted, #667)' }}>
                  يلزم حساب مصروف مخصص + حساب مخصص (دائن) في الدليل.
                </span>
              ) : null}
            </div>

            {/* شطب: اختيار الفاتورة المتأخرة + القيمة المتبقية */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
              <label htmlFor="wo-invoice" style={{ fontSize: 13 }}>شطب فاتورة</label>
              <select
                id="wo-invoice"
                className="input"
                style={{ minWidth: 240 }}
                value={invoiceId}
                onChange={(event) => {
                  const id = event.target.value;
                  setInvoiceId(id);
                  const row = openInvoices.find((candidate) => candidate.sourceId === id);
                  if (row) setWoAmount((Number(row.debit) - Number(row.allocated)).toFixed(4));
                }}
              >
                <option value="">— اختر فاتورة مدينة —</option>
                {openInvoices.map((row) => (
                  <option key={row.entryId} value={row.sourceId ?? ''}>
                    {`فاتورة ${(row.sourceId ?? '').slice(0, 8)} · متاح ${(Number(row.debit) - Number(row.allocated)).toFixed(4)}`}
                  </option>
                ))}
              </select>
              <input
                className="input"
                style={{ width: 110 }}
                type="number"
                placeholder="المبلغ"
                value={woAmount}
                onChange={(event) => setWoAmount(event.target.value)}
                aria-label="مبلغ الشطب"
              />
              <input
                className="input"
                style={{ width: 200 }}
                placeholder="السبب (ميؤوس منه…)"
                value={woReason}
                onChange={(event) => setWoReason(event.target.value)}
                aria-label="سبب الشطب"
              />
              <button
                type="button"
                className="btn"
                disabled={busy || !invoiceId || !woAmount || !woReason}
                onClick={() =>
                  act(
                    () =>
                      apiPost('/ar-writeoffs', {
                        partyId,
                        invoiceId,
                        amount: woAmount,
                        lossAccountId: lossAccounts[0]?.id ?? '',
                        reason: woReason,
                      }),
                    (result) => {
                      const wo = result as Writeoff;
                      return `مسوّدة شطب ${wo.id.slice(0, 8)} بمبلغ ${wo.amount} — بلا قيد حتى الاعتماد من صلاحية accounting.journal.post.`;
                    },
                  )
                }
              >
                إنشاء مسوّدة شطب
              </button>
            </div>

            {/* الشطوبات: اعتماد + استرداد */}
            <h3 style={{ fontSize: 14, margin: '14px 0 6px' }}>مستندات الشطب</h3>
            {statement.writeoffs.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--muted, #667)' }}>لا شطوبات على هذا الطرف بعد.</p>
            ) : (
              <table className="table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th scope="col">المبلغ</th>
                    <th scope="col">الحالة</th>
                    <th scope="col">مخصص مستهلك</th>
                    <th scope="col">خسارة</th>
                    <th scope="col">مسترد</th>
                    <th scope="col">السبب</th>
                    <th scope="col">إجراء</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.writeoffs.map((wo) => (
                    <tr key={wo.id}>
                      <td style={{ textAlign: 'left', fontFamily: 'monospace' }}>{wo.amount}</td>
                      <td>{STATUS_LABELS[wo.status] ?? wo.status}</td>
                      <td style={{ textAlign: 'left', fontFamily: 'monospace' }}>{wo.allowanceUsed}</td>
                      <td style={{ textAlign: 'left', fontFamily: 'monospace' }}>{wo.lossUsed}</td>
                      <td style={{ textAlign: 'left', fontFamily: 'monospace' }}>{wo.recoveredAmount}</td>
                      <td>{wo.reason}</td>
                      <td>
                        <span style={{ display: 'inline-flex', gap: 6, flexWrap: 'wrap' }}>
                          {wo.status === 'draft' ? (
                            <button
                              type="button"
                              className="btn"
                              disabled={busy}
                              onClick={() =>
                                act(
                                  () => apiPost(`/ar-writeoffs/${wo.id}/approve`, {}),
                                  () => 'رُحّل قيد الشطب: Dr مخصص/خسارة + Cr ذمة العميل — الرصيد أُصفّر.',
                                )
                              }
                            >
                              اعتماد وترحيل
                            </button>
                          ) : null}
                          {wo.status === 'approved' && Number(wo.recoveredAmount) < Number(wo.amount) ? (
                            <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                              <input
                                className="input"
                                style={{ width: 90 }}
                                type="number"
                                placeholder="استرداد"
                                aria-label={`مبلغ استرداد ${wo.id.slice(0, 8)}`}
                                value={recoveryByWriteoff[wo.id] ?? ''}
                                onChange={(event) =>
                                  setRecoveryByWriteoff((current) => ({ ...current, [wo.id]: event.target.value }))
                                }
                              />
                              <button
                                type="button"
                                className="btn"
                                disabled={busy || !recoveryByWriteoff[wo.id]}
                                onClick={() =>
                                  act(
                                    () =>
                                      apiPost(`/ar-writeoffs/${wo.id}/recovery`, {
                                        amount: recoveryByWriteoff[wo.id],
                                        cashLocationId: safes[0]?.id ?? '',
                                      }),
                                    (result) =>
                                      `سند قبض استرداد ${(result as { voucher?: { number?: string } })?.voucher?.number ?? ''} — Dr نقد / Cr الخسارة.`,
                                  )
                                }
                              >
                                استرداد
                              </button>
                            </span>
                          ) : null}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            {/* سجل التذكير — AC: يظهر في سجل الطرف. */}
            <h3 style={{ fontSize: 14, margin: '14px 0 6px' }}>سجل التذكير</h3>
            {statement.reminders.length === 0 ? (
              <p style={{ fontSize: 13, color: 'var(--muted, #667)' }}>لا تذكيرات مسجّلة على هذا الطرف بعد.</p>
            ) : (
              <table className="table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th scope="col">التاريخ</th>
                    <th scope="col">التأخر</th>
                    <th scope="col">القناة</th>
                    <th scope="col">حالة الإرسال</th>
                    <th scope="col">البيان</th>
                  </tr>
                </thead>
                <tbody>
                  {statement.reminders.map((event) => (
                    <tr key={event.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{event.dispatchedAt.slice(0, 16).replace('T', ' ')}</td>
                      <td>{event.bandDays ?? '—'} يوم</td>
                      <td>{CHANNEL_LABELS[event.channel] ?? event.channel}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{event.dispatchStatus}</td>
                      <td style={{ fontSize: 12 }}>{event.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </>
        ) : null}

        {/* آخر المخصصات — قيود مرحّلة بلا أثر على رصيد الكشف. */}
        <h3 style={{ fontSize: 14, margin: '18px 0 6px' }}>المخصصات المرحّلة</h3>
        {(provisions.data ?? []).length === 0 ? (
          <p style={{ fontSize: 13, color: 'var(--muted, #667)' }}>لا مخصصات بعد — تُحتسب بنسبة لكل شريحة تأخر.</p>
        ) : (
          <table className="table" style={{ width: '100%' }}>
            <thead>
              <tr>
                <th scope="col">التاريخ</th>
                <th scope="col">الأساس</th>
                <th scope="col">النسبة</th>
                <th scope="col">المبلغ</th>
                <th scope="col">مصروف</th>
                <th scope="col">مخصص</th>
              </tr>
            </thead>
            <tbody>
              {(provisions.data ?? []).map((provision) => (
                <tr key={provision.id}>
                  <td style={{ fontFamily: 'monospace', fontSize: 12 }}>{provision.entryDate}</td>
                  <td style={{ textAlign: 'left', fontFamily: 'monospace' }}>{provision.basisAmount}</td>
                  <td style={{ textAlign: 'left', fontFamily: 'monospace' }}>{provision.percent}%</td>
                  <td style={{ textAlign: 'left', fontFamily: 'monospace' }}>{provision.amount}</td>
                  <td style={{ fontSize: 12 }}>
                    {(() => {
                      const account = (accounts.data ?? []).find((candidate) => candidate.id === provision.expenseAccountId);
                      return account ? accountLabel(account) : '—';
                    })()}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    {(() => {
                      const account = (accounts.data ?? []).find((candidate) => candidate.id === provision.allowanceAccountId);
                      return account ? accountLabel(account) : '—';
                    })()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </Directory>
  );
}
