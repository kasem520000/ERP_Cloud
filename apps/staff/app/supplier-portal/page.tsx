'use client';

import { useEffect, useState } from 'react';
import { KpiStrip, Panel } from '@erp/ui';

import { Empty } from '../../components/screen';
import { Table } from '../../components/ui/table';
import { money } from '../../lib/lookups';
import {
  SupplierError,
  readSupplierSession,
  supplierFetch,
  writeSupplierSession,
} from '../../lib/supplier-portal';

type Invoice = {
  id: string;
  number: string | null;
  paymentStatus: string;
  currency: string;
  total: string;
  paidTotal: string;
};
type Payment = { id: string; number: string | null; day: string; value: string; currency: string };
type Quote = {
  id: string;
  number: string;
  title: string;
  note: string;
  status: string;
  offer: string | null;
  responseNote: string | null;
};

const STATUS: Record<string, string> = { open: 'بانتظار الرد', responded: 'تم الرد', closed: 'مغلق' };

export default function SupplierPortalPage() {
  const [token, setToken] = useState<string | undefined>();
  const [ready, setReady] = useState(false);
  const [tenantCode, setTenantCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [offers, setOffers] = useState<Record<string, { offer: string; note: string }>>({});
  const [referenceNo, setReferenceNo] = useState('');
  const [declared, setDeclared] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    const stored = readSupplierSession()?.token;
    setToken(stored);
    setReady(true);
    if (stored) {
      load(stored).catch(() => {
        writeSupplierSession(undefined);
        setToken(undefined);
        setError('انتهت الجلسة. ادخل من جديد.');
      });
    }
  }, []);

  async function load(current = token) {
    if (!current) return;
    const [invoiceRows, paymentRows, quoteRows] = await Promise.all([
      supplierFetch<Invoice[]>('/supplier-portal/invoices', {}, current),
      supplierFetch<Payment[]>('/supplier-portal/payments', {}, current),
      supplierFetch<Quote[]>('/supplier-portal/quotations', {}, current),
    ]);
    setInvoices(invoiceRows);
    setPayments(paymentRows);
    setQuotes(quoteRows);
  }

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const session = await supplierFetch<{ token: string }>('/supplier-portal/auth/login', {
        method: 'POST',
        body: JSON.stringify({ tenantCode, email, password }),
      });
      writeSupplierSession(session.token);
      setToken(session.token);
      setPassword('');
      await load(session.token);
    } catch (caught) {
      setError(caught instanceof SupplierError ? caught.message : 'تعذّر الدخول');
    } finally {
      setBusy(false);
    }
  }

  function logout() {
    writeSupplierSession(undefined);
    setToken(undefined);
    setInvoices([]);
    setPayments([]);
    setQuotes([]);
  }

  async function respond(row: Quote) {
    const draft = offers[row.id] ?? { offer: '', note: '' };
    setBusy(true);
    setError('');
    try {
      await supplierFetch(`/supplier-portal/quotations/${row.id}/respond`, {
        method: 'POST',
        body: JSON.stringify({ price: draft.offer, note: draft.note }),
      });
      await load();
    } catch (caught) {
      setError(caught instanceof SupplierError ? caught.message : 'تعذّر إرسال الرد');
    } finally {
      setBusy(false);
    }
  }

  async function upload(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await supplierFetch('/supplier-portal/invoices', {
        method: 'POST',
        body: JSON.stringify({ referenceNo, declaredTotal: declared, note }),
      });
      setReferenceNo('');
      setDeclared('');
      setNote('');
      setError('');
      await load();
    } catch (caught) {
      setError(caught instanceof SupplierError ? caught.message : 'تعذّر رفع الفاتورة');
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <div className="boot">جارٍ التحميل…</div>;

  if (!token) {
    return (
      <main className="public-page">
        <div className="public-wrap">
          <header className="row public-head">
            <span className="logo-mark">م</span>
            <div>
              <strong>بوابة الموردين</strong>
              <p className="muted small">
                فواتيرك ومدفوعاتك وطلبات عروض الأسعار. الدخول لا يفتح شاشات الموظفين.
              </p>
            </div>
          </header>

          <Panel title="الدخول" hint="برمز المنشأة والبريد وكلمة المرور التي منحك إياها المشتري.">
            {error ? <p className="alert danger">{error}</p> : null}
            <form onSubmit={login}>
              <div className="form-grid">
                <label className="field">
                  <span>رمز المنشأة</span>
                  <input
                    className="input"
                    value={tenantCode}
                    onChange={(event) => setTenantCode(event.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  <span>البريد</span>
                  <input
                    className="input"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </label>
                <label className="field">
                  <span>كلمة المرور</span>
                  <input
                    className="input"
                    type="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                  />
                </label>
              </div>
              <div className="row" style={{ justifyContent: 'flex-start', marginTop: 12 }}>
                <button className="btn primary" type="submit" disabled={busy}>
                  {busy ? 'جارٍ الدخول…' : 'دخول'}
                </button>
              </div>
            </form>
          </Panel>
        </div>
      </main>
    );
  }

  const unpaid = invoices.reduce(
    (sum, row) => sum + Math.max(0, Number(row.total) - Number(row.paidTotal)),
    0,
  );
  const openQuotes = quotes.filter((row) => row.status === 'open').length;

  return (
    <main className="public-page">
      <div className="public-wrap">
        <header className="row public-head">
          <span className="row" style={{ gap: 10 }}>
            <span className="logo-mark">م</span>
            <div>
              <strong>بوابة الموردين</strong>
              <p className="muted small">فواتيرك ومدفوعاتك وطلبات عروض الأسعار — بلا شاشات داخلية.</p>
            </div>
          </span>
          <button className="btn sm" type="button" onClick={logout}>
            خروج
          </button>
        </header>

        {error ? <p className="alert danger">{error}</p> : null}

        <KpiStrip
          items={[
            { label: 'فواتير مرحّلة', value: String(invoices.length), hint: 'باسمكم وفي الدفاتر' },
            {
              label: 'متبقٍّ غير مسدّد',
              value: money(unpaid.toFixed(2)),
              tone: unpaid > 0 ? 'warn' : 'neutral',
              hint: 'الإجمالي ناقص المسدّد',
            },
            { label: 'طلبات عروض مفتوحة', value: String(openQuotes), hint: 'بانتظار سعركم' },
          ]}
        />

        <Panel title="فواتير الشراء" hint={`${invoices.length} فاتورة`} flush>
          {invoices.length === 0 ? (
            <Empty
              bare
              title="لا فواتير مرحّلة"
              detail="تظهر هنا الفواتير التي رحّلها المشتري باسم منشأتكم، بعد قيدها في الدفاتر."
            />
          ) : (
            <Table
              bare
              columns={[
                { key: 'c0', header: 'الرقم', ltr: true, cell: (row) => row.number ?? '—' },
                {
                  key: 'c1',
                  header: 'الإجمالي',
                  numeric: true,
                  cell: (row) => money(row.total, row.currency),
                },
                {
                  key: 'c2',
                  header: 'المسدّد',
                  numeric: true,
                  cell: (row) => money(row.paidTotal, row.currency),
                },
                { key: 'c3', header: 'الحالة', cell: (row) => row.paymentStatus },
              ]}
              rows={invoices}
              rowKey={(row) => row.id}
            />
          )}
        </Panel>

        <Panel title="المدفوعات" hint={`${payments.length} سند`} flush>
          {payments.length === 0 ? (
            <Empty bare title="لا مدفوعات بعد" detail="كل سند صرف يُقيَّد لكم يظهر هنا بتاريخه ومبلغه." />
          ) : (
            <Table
              bare
              columns={[
                { key: 'c0', header: 'السند', ltr: true, cell: (row) => row.number ?? '—' },
                { key: 'c1', header: 'التاريخ', ltr: true, cell: (row) => row.day },
                {
                  key: 'c2',
                  header: 'المبلغ',
                  numeric: true,
                  cell: (row) => money(row.value, row.currency),
                },
              ]}
              rows={payments}
              rowKey={(row) => row.id}
            />
          )}
        </Panel>

        <Panel title="طلبات عروض الأسعار" hint={`${quotes.length} طلب`} flush>
          {quotes.length === 0 ? (
            <Empty bare title="لا طلبات عروض" detail="يرسلها المشتري حين يريد سعركم على أصناف محددة." />
          ) : (
            quotes.map((row) => (
              <div key={row.id} className="quote-row">
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <strong>
                      {row.number} — {row.title}
                    </strong>
                    <p className="muted small" style={{ margin: 0 }}>
                      {row.note || 'بلا ملاحظة'}
                    </p>
                  </div>
                  <span className="badge">{STATUS[row.status] ?? row.status}</span>
                </div>
                {row.status === 'open' ? (
                  <div className="form-grid" style={{ marginTop: 10 }}>
                    <label className="field">
                      <span>السعر</span>
                      <input
                        className="input"
                        inputMode="decimal"
                        value={offers[row.id]?.offer ?? ''}
                        onChange={(event) =>
                          setOffers((current) => ({
                            ...current,
                            [row.id]: { offer: event.target.value, note: current[row.id]?.note ?? '' },
                          }))
                        }
                      />
                    </label>
                    <label className="field">
                      <span>ملاحظة</span>
                      <input
                        className="input"
                        value={offers[row.id]?.note ?? ''}
                        onChange={(event) =>
                          setOffers((current) => ({
                            ...current,
                            [row.id]: { offer: current[row.id]?.offer ?? '', note: event.target.value },
                          }))
                        }
                      />
                    </label>
                    <div className="row" style={{ alignItems: 'flex-end' }}>
                      <button
                        className="btn primary"
                        type="button"
                        disabled={busy}
                        onClick={() => respond(row)}
                      >
                        إرسال الرد
                      </button>
                    </div>
                  </div>
                ) : (
                  <p style={{ margin: '8px 0 0' }}>
                    العرض: {row.offer ? money(row.offer) : '—'}
                    {row.responseNote ? ` — ${row.responseNote}` : ''}
                  </p>
                )}
              </div>
            ))
          )}
        </Panel>

        <Panel title="رفع فاتورة" hint="التقديم يصل إلى الموظف ولا يُرحَّل في الدفاتر حتى يقيّده.">
          <form onSubmit={upload}>
            <div className="form-grid">
              <label className="field">
                <span>رقم الفاتورة *</span>
                <input
                  className="input"
                  value={referenceNo}
                  onChange={(event) => setReferenceNo(event.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>الإجمالي *</span>
                <input
                  className="input"
                  inputMode="decimal"
                  value={declared}
                  onChange={(event) => setDeclared(event.target.value)}
                  required
                />
              </label>
              <label className="field">
                <span>ملاحظة</span>
                <input className="input" value={note} onChange={(event) => setNote(event.target.value)} />
              </label>
            </div>
            <div className="row" style={{ justifyContent: 'flex-start', marginTop: 12 }}>
              <button className="btn primary" type="submit" disabled={busy}>
                {busy ? 'جارٍ الإرسال…' : 'إرسال الفاتورة'}
              </button>
            </div>
          </form>
        </Panel>
      </div>
    </main>
  );
}
