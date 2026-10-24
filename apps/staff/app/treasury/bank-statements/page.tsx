'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Panel } from '@erp/ui';

import { DataTable, Notice, QueryView } from '../../../components/data-view';
import { Screen } from '../../../components/screen';
import { FilterBar } from '../../../components/ui';
import { apiErrorText, apiList, apiPost } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { useQuery } from '../../../lib/use-query';

type BankAccount = { id: string; bankName: string; accountNo: string | null; iban: string | null };
type BankStatement = {
  id: string;
  bankAccountId: string;
  periodFrom: string;
  periodTo: string;
  status: string;
  sourceFileName: string | null;
  rowCount: number;
  openingBalance: string | null;
  closingBalance: string | null;
  createdAt: string;
};

const STATUS: Record<string, string> = {
  processing: 'قيد المعالجة',
  processed: 'جاهز للمطابقة',
  reconciled: 'تمت التسوية',
  approved: 'معتمَد (مُقفل)',
  error: 'خطأ',
};

export default function BankStatementsPage() {
  const params = useSearchParams();
  const initialAccount = params.get('bank_account_id') ?? '';
  const { can } = useSession();
  const [bankAccountId, setBankAccountId] = useState(initialAccount);
  const [selectedFile, setSelectedFile] = useState<File>();
  const [csv, setCsv] = useState('');
  const [openingBalance, setOpeningBalance] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger'; text: string }>();

  const accounts = useQuery<BankAccount[]>(() => apiList<BankAccount>('/treasury/bank-accounts'), []);
  const query = useMemo(
    () =>
      bankAccountId
        ? `/treasury/bank-statements?bank_account_id=${encodeURIComponent(bankAccountId)}`
        : '/treasury/bank-statements',
    [bankAccountId],
  );
  const statements = useQuery<BankStatement[]>(() => apiList<BankStatement>(query), [query]);
  const manage = can('treasury.bank.manage');

  async function chooseFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setSelectedFile(file);
    setCsv(await file.text());
  }

  async function importStatement(event: React.FormEvent) {
    event.preventDefault();
    if (!bankAccountId) {
      setNotice({ kind: 'danger', text: 'اختر الحساب البنكي أولاً.' });
      return;
    }
    if (!csv.trim()) {
      setNotice({ kind: 'danger', text: 'اختر ملف CSV أو الصق محتواه.' });
      return;
    }
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await apiPost<{ importedLines: number }>('/treasury/bank-statements/import', {
        bankAccountId,
        csv,
        fileName: selectedFile?.name,
        openingBalance: openingBalance.trim() || undefined,
      });
      setCsv('');
      setSelectedFile(undefined);
      setOpeningBalance('');
      statements.reload();
      setNotice({ kind: 'ok', text: `تم استيراد ${result.importedLines} حركة بنكية. راجعها قبل المطابقة.` });
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error) });
    } finally {
      setBusy(false);
    }
  }

  /** MF-15 (D4): الاعتماد يقفل الكشف على كل الكتابات، وفك الاعتماد يعيد المحسوب. */
  async function runApprove(statement: BankStatement) {
    if (!window.confirm(`اعتماد وقفل كشف الفترة ${statement.periodFrom} — ${statement.periodTo}؟ بعد الاعتماد تُرفض أي كتابة على أسطره حتى فك الاعتماد.`)) return;
    setBusy(true);
    setNotice(undefined);
    try {
      await apiPost(`/treasury/bank-statements/${statement.id}/approve`, {});
      statements.reload();
      setNotice({ kind: 'ok', text: 'اعتُمد الكشف وقُفل على الكتابات.' });
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error) });
    } finally {
      setBusy(false);
    }
  }

  async function runUnapprove(statement: BankStatement) {
    setBusy(true);
    setNotice(undefined);
    try {
      await apiPost(`/treasury/bank-statements/${statement.id}/unapprove`, {});
      statements.reload();
      setNotice({ kind: 'ok', text: 'فُك قفل الكشف — عاد جاهزاً للتعديل والمطابقة.' });
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error) });
    } finally {
      setBusy(false);
    }
  }

  async function runAutoMatch(statement: BankStatement) {
    setBusy(true);
    setNotice(undefined);
    try {
      const result = await apiPost<{ matched: number; suggested: number }>(
        '/treasury/bank-statements/' + statement.id + '/auto-match',
        {},
      );
      statements.reload();
      setNotice({
        kind: 'ok',
        text: `اكتملت المطابقة: ${result.matched} حركات مطابقة و${result.suggested} اقتراح قاعدة.`,
      });
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen
      title="كشوف الحساب البنكي"
      subtitle="رفع CSV، مراجعة الحركات ثم تشغيل المطابقة التلقائية. لا يُنشئ الاستيراد قيداً محاسبياً من تلقاء نفسه."
      crumbs={['الخزينة', 'التغذية البنكية']}
      actions={
        <Link className="btn sm" href="/treasury/bank-reconciliation">
          فتح شاشة التسوية
        </Link>
      }
    >
      <Notice notice={notice} />
      {manage ? (
        <form onSubmit={importStatement}>
          <Panel
            title="معالج استيراد كشف الحساب"
            hint="الخطوة 1 رفع الملف · الخطوة 2 تأكيد الحساب · الخطوة 3 مراجعة الحركات."
            footer={
              <>
                <span className="text-[12px] text-muted">
                  {csv ? `${csv.split(/\r?\n/).filter(Boolean).length - 1} سطر تقريباً` : 'لم يُرفع ملف بعد'}
                </span>
                <button className="btn primary" disabled={busy} type="submit">
                  {busy ? 'جارٍ الاستيراد…' : 'رفع ومراجعة الكشف'}
                </button>
              </>
            }
          >
            <FilterBar>
              <label className="field">
                <span>الحساب البنكي</span>
                <select
                  className="input"
                  required
                  value={bankAccountId}
                  onChange={(event) => setBankAccountId(event.target.value)}
                >
                  <option value="">اختر الحساب</option>
                  {(accounts.data ?? []).map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.bankName} — {account.accountNo ?? account.iban ?? account.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>ملف CSV</span>
                <input
                  className="input"
                  style={{ blockSize: 'auto', paddingBlock: 6, maxWidth: 320 }}
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  onChange={chooseFile}
                />
              </label>
              <label className="field">
                <span>رصيد بداية الكشف، اختياري</span>
                <input
                  className="input"
                  dir="ltr"
                  inputMode="decimal"
                  value={openingBalance}
                  onChange={(event) => setOpeningBalance(event.target.value)}
                  placeholder="0.00"
                />
              </label>
            </FilterBar>
            <label className="field">
              <span>المحتوى — للمعاينة أو اللصق اليدوي</span>
              <textarea
                className="input"
                dir="ltr"
                rows={5}
                value={csv}
                onChange={(event) => setCsv(event.target.value)}
                placeholder="Date,Description,Amount,Balance"
              />
            </label>
          </Panel>
        </form>
      ) : null}

      <QueryView
        panel="الكشوف المستوردة"
        query={statements}
        empty="لا توجد كشوف مستوردة"
        emptyDetail="ارفع CSV من المعالج أعلاه لتظهر حركات البنك هنا."
      >
        {(rows) => (
          <DataTable
            rows={rows}
            rowKey={(row) => row.id}
            columns={[
              {
                key: 'bank',
                header: 'الحساب البنكي',
                cell: (row) =>
                  accounts.data?.find((account) => account.id === row.bankAccountId)?.bankName ??
                  row.bankAccountId.slice(0, 8),
              },
              {
                key: 'period',
                header: 'الفترة',
                cell: (row) => (
                  <span dir="ltr">
                    {row.periodFrom} — {row.periodTo}
                  </span>
                ),
              },
              { key: 'file', header: 'الملف', cell: (row) => row.sourceFileName ?? 'إدخال مباشر' },
              { key: 'rows', header: 'الحركات', align: 'num', cell: (row) => row.rowCount },
              {
                key: 'status',
                header: 'الحالة',
                cell: (row) => (
                  <span
                    className={`status ${row.status === 'reconciled' || row.status === 'approved' ? 'posted' : row.status === 'error' ? 'voided' : 'draft'}`}
                  >
                    {STATUS[row.status] ?? row.status}
                  </span>
                ),
              },
              {
                key: 'actions',
                header: 'إجراءات',
                cell: (row) => (
                  <div className="flex gap-2">
                    <Link
                      className="btn sm"
                      href={`/treasury/bank-reconciliation?statement_id=${row.id}&bank_account_id=${row.bankAccountId}`}
                    >
                      مراجعة
                    </Link>
                    {manage && row.status !== 'reconciled' && row.status !== 'approved' ? (
                      <button
                        className="btn sm"
                        disabled={busy}
                        type="button"
                        onClick={() => runAutoMatch(row)}
                      >
                        مطابقة تلقائية
                      </button>
                    ) : null}
                    {manage && row.status !== 'approved' ? (
                      <button className="btn sm" disabled={busy} type="button" onClick={() => runApprove(row)}>
                        اعتماد وقفل
                      </button>
                    ) : null}
                    {manage && row.status === 'approved' ? (
                      <button className="btn sm" disabled={busy} type="button" onClick={() => runUnapprove(row)}>
                        فك الاعتماد
                      </button>
                    ) : null}
                  </div>
                ),
              },
            ]}
          />
        )}
      </QueryView>
    </Screen>
  );
}
