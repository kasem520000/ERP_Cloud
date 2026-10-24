'use client';

import { useState } from 'react';
import { Panel } from '@erp/ui';

import { Empty, ErrorBox, Forbidden, Loading, Screen } from '../../../components/screen';
import { apiData, apiDelete, apiErrorText, apiPatch, apiPost } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { useQuery } from '../../../lib/use-query';
import { Table } from '../../../components/ui/table';

/**
 * إدارة الفترات المحاسبية — `Form_WPF/FrmAccountingPeriods.xaml`.
 *
 * The window is one card above one grid. The card is
 * `رقم الفترة:` (read-only) · `اسم الفترة:` · `تاريخ من:` · `تاريخ إلى:` ·
 * `✔️ فترة نشطة حالياً` · `ملاحظات:`; the action bar is
 * ` إضافة · تعديل · تفعيل · إغلاق الفترة · إعادة فتح · جديد · حذف ·
 * تحديث`; and the grid is
 * `الرقم · اسم الفترة · تاريخ البداية · تاريخ النهاية · نشطة · مغلقة · أغلقت بواسطة ·
 * تاريخ الإغلاق · ملاحظات`. The header carries `الفترة النشطة: …` or «لا توجد فترة نشطة».
 *
 * `Class/AccountingPeriodManager.cs` is every statement behind it, and the refusals the
 * operator sees here are that class's own sentences.
 */
type Period = {
  id: string;
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  isActive: boolean;
  notes: string | null;
  closedBy: string | null;
  closedByName: string | null;
  closedAt: string | null;
  yearName: string | null;
};

type FiscalYear = {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  closingEntryId?: string | null;
};

/** MF-05 — استجابة `GET /fiscal-periods/:id/close-preflight`. */
type Preflight = {
  checks: Array<{ key: string; labelAr: string; severity: 'blocker' | 'warning'; count: number }>;
  blockers: string[];
};

/** MF-04 — استجابة `GET /fiscal-years/:id/close-preview`. */
type YearPreview = {
  netIncome: string;
  openPeriods: string[];
  blockingErrors: string[];
  retainedAccount: { code: string; nameAr: string } | null;
  lines: Array<{ code: string; nameAr: string; balance: string; actionAr: string }>;
};

/** أخطاء الحجب في المعاينة بجُملتها مفهومة للمشغّل. */
const YEAR_BLOCK_AR: Record<string, string> = {
  FISCAL_YEAR_PERIODS_OPEN: 'توجد فترات غير مُقفلة في السنة',
  RETAINED_EARNINGS_ACCOUNT_MISSING: 'حساب الوجهة «2130001 أرباح و خسائر» غير جاهز في الدليل',
  FISCAL_YEAR_NO_PERIODS: 'السنة بلا فترات',
};

const EMPTY_FORM = { id: '', name: '', startDate: '', endDate: '', isActive: false, notes: '' };

const firstOfYear = `${new Date().getFullYear()}-01-01`;
const lastOfYear = `${new Date().getFullYear()}-12-31`;

const stamp = (value: string | null) =>
  value ? new Date(value).toLocaleString('ar-SA-u-ca-gregory-nu-latn') : '—';

export default function FiscalPeriodsPage() {
  const { can } = useSession();
  const periods = useQuery<Period[]>(() => apiData<Period[]>('/fiscal-periods'), []);
  const years = useQuery<FiscalYear[]>(() => apiData<FiscalYear[]>('/fiscal-years'), []);

  const [form, setForm] = useState({ ...EMPTY_FORM, startDate: firstOfYear, endDate: lastOfYear });
  const [busy, setBusy] = useState<string | undefined>();
  const [message, setMessage] = useState<{ kind: 'ok' | 'danger'; text: string } | undefined>();

  const rows = periods.data ?? [];
  const active = rows.find((row) => row.isActive);
  const canManage = can('accounting.period.close');
  const editing = form.id !== '';

  const reload = () => {
    periods.reload();
    years.reload();
  };

  const fail = (error: unknown) => {
    setMessage({
      kind: 'danger',
      text: apiErrorText(error),
    });
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy('form');
    setMessage(undefined);
    try {
      const body = {
        name: form.name,
        startDate: form.startDate,
        endDate: form.endDate,
        isActive: form.isActive,
        notes: form.notes || null,
      };
      if (editing) await apiPatch(`/fiscal-periods/${form.id}`, body);
      else await apiPost('/fiscal-periods', body);
      setMessage({
        kind: 'ok',
        text: editing ? 'تم تحديث الفترة المحاسبية بنجاح' : 'تم إضافة الفترة المحاسبية بنجاح',
      });
      setForm({ ...EMPTY_FORM, startDate: firstOfYear, endDate: lastOfYear });
      reload();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(undefined);
    }
  };

  const act = async (period: Period, action: 'activate' | 'close' | 'reopen' | 'delete') => {
    setBusy(period.id);
    setMessage(undefined);
    try {
      if (action === 'activate') await apiPost(`/fiscal-periods/${period.id}/activate`, {});
      else if (action === 'close') {
        // MF-05 — الفحص أولاً: المانع يوقف الإغلاق بجملة مفهومة قبل نافذة التأكيد،
        // والتحذيرات تُعرض داخل تأكيد التشغيل («هل أنت متأكد … بعد الإغلاق لن تستطيع»).
        const pre = await apiData<Preflight>(`/fiscal-periods/${period.id}/close-preflight`);
        const blockerLabels = pre.blockers.map((key) => pre.checks.find((check) => check.key === key)?.labelAr ?? key);
        if (blockerLabels.length > 0) {
          setMessage({ kind: 'danger', text: `تعذّر إغلاق الفترة «${period.name}»: ${blockerLabels.join('، ')}.` });
          setBusy(undefined);
          return;
        }
        const warnLabels = pre.checks
          .filter((check) => check.severity === 'warning' && check.count > 0)
          .map((check) => `${check.labelAr} (${check.count})`);
        const confirmText =
          `هل أنت متأكد من إغلاق الفترة المحاسبية «${period.name}»؟` +
          (warnLabels.length > 0 ? `\nتحذيرات قبل الإغلاق: ${warnLabels.join('، ')}.` : '');
        if (!window.confirm(confirmText)) {
          setBusy(undefined);
          return;
        }
        await apiPost(`/fiscal-periods/${period.id}/close`, {});
      } else if (action === 'reopen') {
        const reason = window.prompt('سبب إعادة الفتح (إلزامي):');
        if (!reason) {
          setBusy(undefined);
          return;
        }
        await apiPost(`/fiscal-periods/${period.id}/reopen`, { reason });
      } else {
        if (!window.confirm(`هل أنت متأكد من حذف الفترة المحاسبية «${period.name}»؟`)) {
          setBusy(undefined);
          return;
        }
        await apiDelete(`/fiscal-periods/${period.id}`);
      }
      setMessage({
        kind: 'ok',
        text:
          action === 'activate'
            ? 'تم تفعيل الفترة المحاسبية بنجاح'
            : action === 'close'
              ? 'تم إغلاق الفترة المحاسبية بنجاح'
              : action === 'reopen'
                ? 'تم إعادة فتح الفترة المحاسبية بنجاح'
                : 'تم حذف الفترة المحاسبية بنجاح',
      });
      if (form.id === period.id) setForm({ ...EMPTY_FORM, startDate: firstOfYear, endDate: lastOfYear });
      reload();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(undefined);
    }
  };

  /** MF-04 — إقفال/إعادة فتح السنة: المعاينة إلزامية قبل التأكيد، والسبب عند الفتح. */
  const yearAct = async (year: FiscalYear, action: 'close' | 'reopen') => {
    const busyKey = `y:${year.id}`;
    setBusy(busyKey);
    setMessage(undefined);
    try {
      if (action === 'close') {
        const preview = await apiData<YearPreview>(`/fiscal-years/${year.id}/close-preview`);
        const blockers = (preview.blockingErrors ?? []).map((code) => YEAR_BLOCK_AR[code] ?? code);
        if (blockers.length > 0) {
          setMessage({ kind: 'danger', text: `تعذّر إقفال السنة «${year.name}»: ${blockers.join('، ')}.` });
          setBusy(undefined);
          return;
        }
        const retained = preview.retainedAccount ? `${preview.retainedAccount.code} ${preview.retainedAccount.nameAr}` : '—';
        const confirmText =
          `هل أنت متأكد من إقفال السنة المالية «${year.name}»؟\n` +
          `صافي الدخل: ${preview.netIncome} عبر ${preview.lines.length} أسطر تصفية ← ${retained}.\n` +
          'بعد الإقفال يُرحَّل قيد الإقفال وتُفتح السنة التالية تلقائياً (بلا قيد افتتاح).';
        if (!window.confirm(confirmText)) {
          setBusy(undefined);
          return;
        }
        const closed = await apiPost<{ closingEntry: { id: string; number: string | null } | null }>(
          `/fiscal-years/${year.id}/close`,
          {},
        );
        setMessage({
          kind: 'ok',
          text: closed.closingEntry?.number
            ? `تم إقفال السنة المالية «${year.name}» — قيد الإقفال رقم ${closed.closingEntry.number}`
            : `تم إقفال السنة المالية «${year.name}» (بلا نشاط دخل)`,
        });
      } else {
        const reason = window.prompt(`سبب إعادة فتح السنة المالية «${year.name}» (إلزامي):`);
        if (!reason) {
          setBusy(undefined);
          return;
        }
        await apiPost(`/fiscal-years/${year.id}/reopen`, { reason });
        setMessage({ kind: 'ok', text: `تم إعادة فتح السنة المالية «${year.name}» وعكس قيد إقفالها` });
      }
      reload();
    } catch (error) {
      fail(error);
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <Screen
      title="إدارة الفترات المحاسبية"
      subtitle={
        active
          ? `الفترة النشطة: ${active.name} (${active.startDate} - ${active.endDate})`
          : 'لا توجد فترة نشطة'
      }
      crumbs={['المحاسبة', 'العمليات']}
      actions={
        <>
          <button className="btn" type="button" onClick={reload} disabled={periods.status === 'loading'}>
            تحديث
          </button>
          <button
            className="btn"
            type="button"
            onClick={() => setForm({ ...EMPTY_FORM, startDate: firstOfYear, endDate: lastOfYear })}
          >
            جديد
          </button>
        </>
      }
    >
      {message && <p className={`alert ${message.kind}`}>{message.text}</p>}

      <Panel title={<>{editing ? `تعديل — ${form.name}` : 'إضافة فترة محاسبية'}</>}>
        <form className="form-grid" onSubmit={submit}>
          <label className="field">
            <span>رقم الفترة</span>
            <input
              className="input"
              value={form.id ? String(rows.find((row) => row.id === form.id)?.number ?? '') : ''}
              readOnly
              placeholder="—"
            />
          </label>
          <label className="field">
            <span>اسم الفترة *</span>
            <input
              className="input"
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
              required
            />
          </label>
          <label className="field">
            <span>تاريخ من *</span>
            <input
              className="input"
              type="date"
              value={form.startDate}
              onChange={(event) => setForm({ ...form, startDate: event.target.value })}
              required
            />
          </label>
          <label className="field">
            <span>تاريخ إلى *</span>
            <input
              className="input"
              type="date"
              value={form.endDate}
              onChange={(event) => setForm({ ...form, endDate: event.target.value })}
              required
            />
          </label>
          <label className="field">
            <span>ملاحظات</span>
            <input
              className="input"
              value={form.notes}
              onChange={(event) => setForm({ ...form, notes: event.target.value })}
            />
          </label>
          <label className="check" style={{ alignSelf: 'end' }}>
            <input
              type="checkbox"
              checked={form.isActive}
              onChange={(event) => setForm({ ...form, isActive: event.target.checked })}
            />
            فترة نشطة حالياً
          </label>
          {canManage && (
            <div className="toolbar">
              <button className="btn primary" type="submit" disabled={busy === 'form'}>
                {busy === 'form' ? '…' : editing ? 'تعديل' : 'إضافة'}
              </button>
              {editing && (
                <button
                  className="btn"
                  type="button"
                  onClick={() => setForm({ ...EMPTY_FORM, startDate: firstOfYear, endDate: lastOfYear })}
                >
                  إلغاء
                </button>
              )}
            </div>
          )}
        </form>
      </Panel>

      <Panel title="الفترات المحاسبية" flush>
        {periods.status === 'loading' && <Loading rows={3} />}
        {periods.status === 'forbidden' && <Forbidden />}
        {periods.status === 'error' && <ErrorBox message={periods.error} onRetry={periods.reload} />}
        {periods.status === 'success' &&
          (rows.length === 0 ? (
            <Empty title="لا توجد فترات محاسبية" detail="أنشئ فترة ليُعرف أين تُرحَّل القيود." />
          ) : (
            <Table
              bare
              columns={[
                {
                  key: 'c0',
                  header: 'الرقم',
                  ltr: true,
                  cell: (period) => period.number,
                },
                {
                  key: 'c1',
                  header: 'اسم الفترة',
                  cell: (period) => period.name,
                },
                {
                  key: 'c2',
                  header: 'السنة',
                  ltr: true,
                  cell: (period) => period.yearName ?? '—',
                },
                {
                  key: 'c3',
                  header: 'تاريخ البداية',
                  ltr: true,
                  cell: (period) => period.startDate,
                },
                {
                  key: 'c4',
                  header: 'تاريخ النهاية',
                  ltr: true,
                  cell: (period) => period.endDate,
                },
                {
                  key: 'c5',
                  header: 'نشطة',
                  cell: (period) => (period.isActive ? '' : '—'),
                },
                {
                  key: 'c6',
                  header: 'مغلقة',
                  cell: (period) => (period.status === 'closed' ? '' : '—'),
                },
                {
                  key: 'c7',
                  header: 'أغلقت بواسطة',
                  cell: (period) => period.closedByName ?? '—',
                },
                {
                  key: 'c8',
                  header: 'تاريخ الإغلاق',
                  ltr: true,
                  cell: (period) => stamp(period.closedAt),
                },
                {
                  key: 'c9',
                  header: 'ملاحظات',
                  cell: (period) => period.notes ?? '—',
                },
                {
                  key: 'c10',
                  header: '',
                  cell: (period) => (
                    <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                      {canManage && period.status !== 'closed' && (
                        <>
                          <button
                            className="btn sm"
                            type="button"
                            disabled={busy === period.id}
                            onClick={() => {
                              setForm({
                                id: period.id,
                                name: period.name,
                                startDate: period.startDate,
                                endDate: period.endDate,
                                isActive: period.isActive,
                                notes: period.notes ?? '',
                              });
                            }}
                          >
                            تعديل
                          </button>
                          {!period.isActive && (
                            <button
                              className="btn sm"
                              type="button"
                              disabled={busy === period.id}
                              onClick={() => void act(period, 'activate')}
                            >
                              تفعيل
                            </button>
                          )}
                          <button
                            className="btn sm"
                            type="button"
                            disabled={busy === period.id}
                            onClick={() => void act(period, 'close')}
                          >
                            إغلاق الفترة
                          </button>
                          <button
                            className="btn sm"
                            type="button"
                            disabled={busy === period.id}
                            onClick={() => void act(period, 'delete')}
                          >
                            حذف
                          </button>
                        </>
                      )}
                      {can('accounting.period.reopen') && period.status === 'closed' && (
                        <button
                          className="btn sm"
                          type="button"
                          disabled={busy === period.id}
                          onClick={() => void act(period, 'reopen')}
                        >
                          إعادة فتح
                        </button>
                      )}
                    </div>
                  ),
                },
              ]}
              rows={rows}
              rowKey={(period) => period.id}
            />
          ))}
      </Panel>

      <Panel title="السنوات المالية" flush>
        {years.status === 'loading' && <Loading rows={2} />}
        {years.status === 'success' &&
          ((years.data ?? []).length === 0 ? (
            <p className="muted">لا توجد سنة مالية بعد — أضف فترة لتبدأ، وستُفتح سنتها وحدها.</p>
          ) : (
            <Table
              bare
              maxHeight={240}
              columns={[
                {
                  key: 'c0',
                  header: 'الاسم',
                  cell: (year) => year.name,
                },
                {
                  key: 'c1',
                  header: 'من',
                  ltr: true,
                  cell: (year) => year.startDate,
                },
                {
                  key: 'c2',
                  header: 'إلى',
                  ltr: true,
                  cell: (year) => year.endDate,
                },
                {
                  key: 'c3',
                  header: 'الحالة',
                  cell: (year) => (
                    <span className={`badge ${year.status === 'open' ? 'active' : ''}`}>
                      {year.status === 'open' ? 'مفتوحة' : 'مغلقة'}
                    </span>
                  ),
                },
                {
                  key: 'c4',
                  header: '',
                  cell: (year) => (
                    <div className="row" style={{ gap: 4, flexWrap: 'wrap' }}>
                      {canManage && year.status === 'open' && (
                        <button
                          className="btn sm"
                          type="button"
                          disabled={busy === `y:${year.id}`}
                          onClick={() => void yearAct(year, 'close')}
                        >
                          إقفال السنة
                        </button>
                      )}
                      {can('accounting.period.reopen') && year.status === 'closed' && (
                        <button
                          className="btn sm"
                          type="button"
                          disabled={busy === `y:${year.id}`}
                          onClick={() => void yearAct(year, 'reopen')}
                        >
                          إعادة فتح السنة
                        </button>
                      )}
                    </div>
                  ),
                },
              ]}
              rows={years.data ?? []}
              rowKey={(year) => year.id}
            />
          ))}
      </Panel>
    </Screen>
  );
}
