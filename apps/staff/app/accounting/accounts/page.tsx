'use client';

import { Panel } from '@erp/ui';
import { useMemo, useState } from 'react';

/**
 * دليل الحسابات — `Form_WPF/frmAccountsDirectory.xaml` («دليل الحسابات»).
 *
 * The window is two things at once, and so is this screen:
 *
 * شجرة الحسابات — every node carries `trBalance` (`.xaml.cs` L149 `LoadTreeView`,
 *      `BuildTreeHierarchy` joining `trParentCode`), with `مستويات التوسعة` and `الكل`
 *      (L26 `MaxLevel = 3`, L308–L323 `ExpandToLevel(0..3)`);
 * تفاصيل الحسابات — the grid filled from the selected node, columns
 *      `الحساب الرئيسي` · `رمز الحساب` · `اسم الحساب` · `الفرع` · `الرصيد` ·
 *      `كشف حساب` · `تعديل`.
 *
 * The balance is the part the cloud was missing: it is read from **posted** entries only
 * and rolled up the account's `ltree` path, so a parent shows its whole branch and a
 * ميزان and a كشف can never disagree. And 🔍 searches the server (the window's own
 * `frmAccountSrch`), not the page the browser happens to have loaded.
 */
import { Empty, ErrorBox, Forbidden, Loading, Screen } from '../../../components/screen';
import { apiData, apiDelete, apiErrorText, apiPatch, apiPost } from '../../../lib/api';
import {
  ACCOUNT_TYPE_LABELS,
  balanceOf,
  downloadCsv,
  listAccountDirectory,
  nameOf,
  parentOf,
  postableOf,
  typeOf,
  type Account,
} from '../../../lib/accounts';
import { money } from '../../../lib/lookups';
import { useSession } from '../../../lib/session';
import { useQuery } from '../../../lib/use-query';
import { Table } from '../../../components/ui/table';

type TreeNode = Account & { children: TreeNode[] };

/** `MaxLevel = 3` in the desktop: a node deeper than that is never opened by default. */
const LEVELS = [
  { id: 'all', label: 'الكل' },
  { id: '0', label: '0' },
  { id: '1', label: '1' },
  { id: '2', label: '2' },
  { id: '3', label: '3' },
] as const;

function buildTree(accounts: Account[]): TreeNode[] {
  const byId = new Map<string, TreeNode>();
  for (const account of accounts) byId.set(account.id, { ...account, children: [] });
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    const parentId = parentOf(node);
    const parent = parentId ? byId.get(parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const sort = (nodes: TreeNode[]) => {
    nodes.sort((left, right) => left.code.localeCompare(right.code));
    for (const node of nodes) sort(node.children);
  };
  sort(roots);
  return roots;
}

/**
 * One node of شجرة الحسابات. The desktop binds `trAccount` and `trBalance` on every
 * row; the balance here is the rolled-up one, so a parent reads as the sum of its branch.
 */
function TreeNodes({
  nodes,
  depth,
  open,
  selectedId,
  onToggle,
  onSelect,
}: {
  nodes: TreeNode[];
  depth: number;
  open: Set<string>;
  selectedId: string;
  onToggle: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <>
      {nodes.map((node) => {
        const expanded = open.has(node.id);
        return (
          <div key={node.id}>
            <div
              className={`tree-row${selectedId === node.id ? ' active' : ''}`}
              style={{ paddingInlineStart: 8 + depth * 18 }}
            >
              {node.children.length > 0 ? (
                <button
                  className="btn sm"
                  type="button"
                  aria-expanded={expanded}
                  onClick={() => onToggle(node.id)}
                >
                  {expanded ? '−' : '+'}
                </button>
              ) : (
                <span style={{ display: 'inline-block', width: 26 }} />
              )}
              <button
                className="tree-label"
                type="button"
                onClick={() => onSelect(node.id === selectedId ? '' : node.id)}
                title={`${node.code} — ${nameOf(node)}`}
              >
                <span dir="ltr">{node.code}</span> {nameOf(node)}
                {postableOf(node) ? null : <span className="badge">تجميعي</span>}
              </button>
              <span className="tree-balance num" dir="ltr">
                {money(balanceOf(node).toFixed(4))}
              </span>
            </div>
            {expanded && node.children.length > 0 ? (
              <TreeNodes
                nodes={node.children}
                depth={depth + 1}
                open={open}
                selectedId={selectedId}
                onToggle={onToggle}
                onSelect={onSelect}
              />
            ) : null}
          </div>
        );
      })}
    </>
  );
}

export default function ChartOfAccountsPage() {
  const { can } = useSession();
  // معايير البحث — sent to the server, like the window's own search form.
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');
  const [branchId, setBranchId] = useState('');
  const [applied, setApplied] = useState({ search: '', type: '', branchId: '' });
  const [selectedId, setSelectedId] = useState('');
  const [level, setLevel] = useState<string>('1');
  const [manual, setManual] = useState<Set<string>>(new Set());

  const accounts = useQuery<Account[]>(
    () => listAccountDirectory({ q: applied.search, type: applied.type, branchId: applied.branchId }),
    [applied.search, applied.type, applied.branchId],
  );
  const branches = useQuery<Array<{ id: string; nameAr?: string; name?: string }>>(
    () => apiData('/branches'),
    [],
  );
  const branchRows = branches.data ?? [];
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Account | undefined>();
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger'; text: string } | undefined>();

  function startEdit(account: Account) {
    setEditing(account);
    setCreating(true);
    setNotice(undefined);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function remove(account: Account) {
    if (!window.confirm(`هل تريد حذف الحساب ${account.code} — ${nameOf(account)}؟`)) return;
    setNotice(undefined);
    try {
      await apiDelete(`/accounts/${account.id}`);
      setNotice({ kind: 'ok', text: `تم حذف الحساب ${account.code}.` });
      accounts.reload();
    } catch (error) {
      // The API refuses to delete an account that carries entries or sub-accounts, and
      // says which of the two it is — that message is more useful than a generic failure.
      setNotice({ kind: 'danger', text: apiErrorText(error) });
    }
  }

  const rows = useMemo(() => {
    const list = accounts.data ?? [];
    // 🔍 typed but not yet sent: narrowing the loaded page is friendlier than a reload.
    const needle = search.trim().toLowerCase();
    return list
      .filter((account) => (applied.type || type ? typeOf(account) === (applied.type || type) : true))
      .filter((account) =>
        needle.length === 0
          ? true
          : account.code.toLowerCase().includes(needle) || nameOf(account).toLowerCase().includes(needle),
      )
      .sort((left, right) => left.code.localeCompare(right.code));
  }, [accounts.data, search, type, applied.type]);

  const tree = useMemo(() => buildTree(rows), [rows]);
  const selected = rows.find((account) => account.id === selectedId);

  /** Which nodes are open: `الكل` opens everything, a level opens to that depth. */
  const open = useMemo(() => {
    const ids = new Set<string>();
    const walk = (nodes: TreeNode[], depth: number) => {
      for (const node of nodes) {
        if (level === 'all' || depth <= Number(level)) ids.add(node.id);
        walk(node.children, depth + 1);
      }
    };
    walk(tree, 0);
    for (const id of manual) ids.add(id);
    return ids;
  }, [tree, level, manual]);

  /** تفاصيل الحسابات — the selected node and everything beneath it. */
  const details = useMemo(() => {
    if (!selected) return rows;
    const under = new Set<string>([selected.id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const account of rows) {
        const parentId = parentOf(account);
        if (parentId && under.has(parentId) && !under.has(account.id)) {
          under.add(account.id);
          grew = true;
        }
      }
    }
    return rows.filter((account) => under.has(account.id));
  }, [rows, selected]);

  const totals = useMemo(() => {
    // Roots only — counting every node would count the same money once per level.
    const roots = rows.filter((account) => !parentOf(account));
    return {
      count: rows.length,
      debit: roots.reduce((sum, account) => sum + Math.max(balanceOf(account), 0), 0),
      credit: roots.reduce((sum, account) => sum + Math.max(-balanceOf(account), 0), 0),
      balances: rows.filter((account) => balanceOf(account) !== 0).length,
    };
  }, [rows]);

  return (
    <Screen
      title="دليل الحسابات"
      subtitle="كل حسابات المنشأة مع النوع وقابلية الترحيل."
      crumbs={['المحاسبة', 'تعاريف']}
      kpis={[
        { label: 'عدد الحسابات', value: totals.count, hint: 'في نتيجة البحث الحالية' },
        { label: 'مجموع الأرصدة المدينة', value: money(totals.debit.toFixed(4)), tone: 'up' },
        { label: 'مجموع الأرصدة الدائنة', value: money(totals.credit.toFixed(4)) },
        {
          label: 'حسابات بلا حركة',
          value: totals.count - totals.balances,
          hint: 'رصيدها صفر',
          tone: totals.count - totals.balances > 0 ? 'warn' : 'up',
        },
      ]}
      actions={
        <>
          {can('accounting.account.manage') && (
            <button
              className="btn primary"
              type="button"
              onClick={() => {
                setEditing(undefined);
                setCreating(!creating);
              }}
            >
              {creating ? 'إغلاق النموذج' : 'حساب جديد'}
            </button>
          )}
          <button className="btn" type="button" onClick={() => window.print()}>
            طباعة
          </button>
          <button
            className="btn"
            type="button"
            onClick={() =>
              downloadCsv(
                'chart-of-accounts.csv',
                ['الرمز', 'الاسم', 'النوع', 'ترحيل'],
                rows.map((row) => [row.code, nameOf(row), typeOf(row), postableOf(row) ? 'نعم' : 'لا']),
              )
            }
          >
            تصدير CSV
          </button>
        </>
      }
    >
      {notice && <p className={`alert ${notice.kind}`}>{notice.text}</p>}

      <div className="ui-filter-bar">
        <div className="ui-filter-fields">
          <label className="field" style={{ marginBottom: 0 }}>
            <span>بحث</span>
            <input
              className="input"
              placeholder="بحث بالرمز أو الاسم"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </label>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>النوع</span>
            <select className="input" value={type} onChange={(event) => setType(event.target.value)}>
              <option value="">كل الأنواع</option>
              {Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ marginBottom: 0 }}>
            <span>الفرع</span>
            <select className="input" value={branchId} onChange={(event) => setBranchId(event.target.value)}>
              <option value="">كل الفروع</option>
              {branchRows.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.nameAr ?? branch.name ?? branch.id}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="ui-filter-actions">
          <span className="ui-filter-summary">{rows.length} حساب</span>
          <button
            className="btn primary"
            type="button"
            onClick={() => setApplied({ search, type, branchId })}
          >
            عرض البيانات
          </button>
        </div>
      </div>

      {creating && (
        <AccountForm
          key={editing?.id ?? 'new'}
          accounts={accounts.data ?? []}
          editing={editing}
          onCancel={() => {
            setEditing(undefined);
            setCreating(false);
          }}
          onDone={() => {
            setEditing(undefined);
            setCreating(false);
            accounts.reload();
          }}
        />
      )}

      {/* شجرة الحسابات — `frmAccountsDirectory`: every node carries its balance. */}
      <div className="ui-panel">
        <div className="ui-panel-head">
          <div className="ui-panel-copy">
            <h2 className="ui-panel-title">شجرة الحسابات</h2>
            <p className="ui-panel-hint">كل مستوى يعرض رصيده المجمّع — افتح المستوى للتفصيل.</p>
          </div>
          <div className="ui-panel-actions">
            <span className="row" style={{ gap: 6 }}>
              <span className="muted small" style={{ alignSelf: 'center' }}>
                مستويات التوسعة:
              </span>
              {LEVELS.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  className={`btn sm${level === entry.id ? ' primary' : ''}`}
                  onClick={() => setLevel(entry.id)}
                >
                  {entry.label}
                </button>
              ))}
              {selected ? (
                <button className="btn sm" type="button" onClick={() => setSelectedId('')}>
                  كل الدليل
                </button>
              ) : null}
            </span>
          </div>
        </div>
        <div className="ui-panel-body">
          <div className="tree">
            <TreeNodes
              nodes={tree}
              depth={0}
              open={open}
              selectedId={selectedId}
              onToggle={(id) =>
                setManual((current) => {
                  const next = new Set(current);
                  if (next.has(id)) next.delete(id);
                  else next.add(id);
                  return next;
                })
              }
              onSelect={setSelectedId}
            />
          </div>
        </div>
      </div>

      {accounts.status === 'loading' && <Loading />}
      {accounts.status === 'forbidden' && <Forbidden />}
      {accounts.status === 'error' && <ErrorBox message={accounts.error} onRetry={accounts.reload} />}
      {/* تفاصيل الحسابات — filled from the node selected in the tree. */}
      {accounts.status === 'success' && selected ? (
        <p className="muted small">
          تفاصيل الحسابات —{' '}
          <strong>
            {selected.code} {nameOf(selected)}
          </strong>{' '}
          وما تحته ({details.length} حساب).
        </p>
      ) : null}

      {accounts.status === 'success' &&
        (rows.length === 0 ? (
          <Empty
            title="لا توجد حسابات"
            detail="ابدأ بإنشاء دليل الحسابات أو استوردها من النظام القديم عبر أداة الهجرة."
          />
        ) : (
          <Panel flush title="دليل الحسابات">
            <Table
              bare
              columns={[
                {
                  key: 'c0',
                  header: 'الحساب الرئيسي',
                  cell: (account) => account.parentName ?? '— رئيسي —',
                },
                {
                  key: 'c1',
                  header: 'رمز الحساب',
                  ltr: true,
                  cell: (account) => account.code,
                },
                {
                  key: 'c2',
                  header: 'اسم الحساب',
                  cell: (account) => nameOf(account),
                },
                {
                  key: 'c3',
                  header: 'الفرع',
                  cell: (account) =>
                    account.branchId
                      ? (branchRows.find((branch) => branch.id === account.branchId)?.nameAr ??
                        account.branchId)
                      : '—',
                },
                {
                  key: 'c4',
                  header: 'الرصيد',
                  numeric: true,
                  ltr: true,
                  cell: (account) => money(balanceOf(account).toFixed(4)),
                },
                {
                  key: 'c5',
                  header: 'كشف حساب',
                  cell: (account) => (
                    <>
                      <a className="btn sm" href={`/accounting/ledger?account=${account.id}`}>
                        كشف حساب
                      </a>
                    </>
                  ),
                },
                ...(can('accounting.account.manage')
                  ? [
                      {
                        key: 'c6',
                        header: 'تعديل',
                        cell: (account: Account) => (
                          <>
                            <span className="row">
                              <button className="btn sm" type="button" onClick={() => startEdit(account)}>
                                تعديل
                              </button>
                              <button
                                className="btn sm danger"
                                type="button"
                                onClick={() => void remove(account)}
                              >
                                حذف
                              </button>
                            </span>
                          </>
                        ),
                      },
                    ]
                  : []),
              ]}
              rows={details}
              rowKey={(account) => account.id}
            />
          </Panel>
        ))}
    </Screen>
  );
}

/**
 * One form for both creating and correcting an account. In edit mode the API still has
 * the final word: the number, nature and side of an account that already carries journal
 * entries are refused server-side, and the refusal is shown here as-is.
 */
function AccountForm({
  accounts,
  editing,
  onDone,
  onCancel,
}: {
  accounts: Account[];
  editing?: Account;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [code, setCode] = useState(editing?.code ?? '');
  const [nameAr, setNameAr] = useState(editing ? nameOf(editing) : '');
  const [nameEn, setNameEn] = useState(editing?.nameEn ?? editing?.name_en ?? '');
  const [type, setType] = useState(editing ? typeOf(editing) || 'asset' : 'asset');
  const [parentId, setParentId] = useState(editing ? (parentOf(editing) ?? '') : '');
  const [isPostable, setIsPostable] = useState(editing ? postableOf(editing) : true);
  /** طبيعة الحساب · تاريخ فتح الحساب · الرصيد الافتتاحي · مركز التكلفة. */
  const [normalBalance, setNormalBalance] = useState(editing?.normalBalance ?? '');
  const [openedAt, setOpenedAt] = useState(String(editing?.openedAt ?? '').slice(0, 10));
  const [openingBalance, setOpeningBalance] = useState(editing?.openingBalance ?? '0');
  const [costCenterId, setCostCenterId] = useState(editing?.costCenterId ?? '');
  const costCenters = useQuery<Array<{ id: string; nameAr?: string; name?: string; code?: string }>>(
    () => apiData('/cost-centers'),
    [],
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'danger'; text: string } | undefined>();

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(undefined);
    const payload = {
      code: code.trim(),
      nameAr: nameAr.trim(),
      nameEn: nameEn.trim() || undefined,
      type,
      parentId: parentId || undefined,
      isPostable,
      ...(normalBalance ? { normalBalance } : {}),
      openedAt: openedAt || null,
      openingBalance: openingBalance.trim() || '0',
      costCenterId: costCenterId || null,
    };
    try {
      if (editing) {
        await apiPatch(`/accounts/${editing.id}`, { ...payload, parentId: parentId || null });
        setMessage({ kind: 'ok', text: 'تم حفظ التعديل.' });
      } else {
        await apiPost('/accounts', payload);
        setMessage({ kind: 'ok', text: 'تم إنشاء الحساب.' });
        setCode('');
        setNameAr('');
        setNameEn('');
      }
      onDone();
    } catch (error) {
      setMessage({
        kind: 'danger',
        text: apiErrorText(error),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Panel title={<>{editing ? `تعديل الحساب ${editing.code}` : 'حساب جديد'}</>}>
        <div className="form-grid">
          <label className="field">
            <span>الرمز *</span>
            <input
              className="input"
              dir="ltr"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>الاسم بالعربية *</span>
            <input
              className="input"
              value={nameAr}
              onChange={(event) => setNameAr(event.target.value)}
              required
            />
          </label>
          <label className="field">
            <span>الاسم بالإنجليزية</span>
            <input
              className="input"
              dir="ltr"
              value={nameEn}
              onChange={(event) => setNameEn(event.target.value)}
            />
          </label>
          <label className="field">
            <span>النوع *</span>
            <select className="input" value={type} onChange={(event) => setType(event.target.value)}>
              {Object.entries(ACCOUNT_TYPE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>الحساب الأب</span>
            <select className="input" value={parentId} onChange={(event) => setParentId(event.target.value)}>
              <option value="">— بدون (حساب رئيسي)</option>
              {accounts
                .filter((account) => account.id !== editing?.id)
                .map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.code} — {nameOf(account)}
                  </option>
                ))}
            </select>
          </label>
          <label className="field">
            <span>طبيعة الحساب</span>
            <select
              className="input"
              value={normalBalance}
              onChange={(event) => setNormalBalance(event.target.value)}
            >
              <option value="">حسب النوع</option>
              <option value="debit">مدين</option>
              <option value="credit">دائن</option>
            </select>
          </label>
          <label className="field">
            <span>تاريخ فتح الحساب</span>
            <input
              className="input"
              type="date"
              value={openedAt}
              onChange={(event) => setOpenedAt(event.target.value)}
            />
          </label>
          <label className="field">
            <span>الرصيد الافتتاحي</span>
            <input
              className="input"
              dir="ltr"
              inputMode="decimal"
              value={openingBalance}
              onChange={(event) => setOpeningBalance(event.target.value)}
            />
          </label>
          <label className="field">
            <span>مركز التكلفة</span>
            <select
              className="input"
              value={costCenterId}
              onChange={(event) => setCostCenterId(event.target.value)}
            >
              <option value="">— بدون —</option>
              {(costCenters.data ?? []).map((center) => (
                <option key={center.id} value={center.id}>
                  {center.nameAr ?? center.name ?? center.code ?? center.id}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>قابل للترحيل</span>
            <select
              className="input"
              value={isPostable ? '1' : '0'}
              onChange={(event) => setIsPostable(event.target.value === '1')}
            >
              <option value="1">نعم — تُرحّل عليه القيود</option>
              <option value="0">لا — حساب تجميعي</option>
            </select>
          </label>
        </div>
        {message && <p className={`alert ${message.kind}`}>{message.text}</p>}
        <div className="toolbar">
          <button className="btn primary" type="submit" disabled={busy}>
            {busy ? 'جارٍ الحفظ…' : editing ? 'حفظ التعديل' : 'حفظ'}
          </button>
          <button className="btn" type="button" onClick={onCancel} disabled={busy}>
            إلغاء
          </button>
        </div>
      </Panel>
    </form>
  );
}
