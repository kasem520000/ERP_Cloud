'use client';

import { Panel } from '@erp/ui';
import { useMemo, useState } from 'react';

import { Empty, ErrorBox, Forbidden, Loading, Screen } from '../../../../components/screen';
import { Table } from '../../../../components/ui/table';
import { money } from '../../../../lib/lookups';
import { useQuery } from '../../../../lib/use-query';
import {
  ACCOUNT_TYPE_LABELS,
  balanceOf,
  listAccountDirectory,
  nameOf,
  parentOf,
  postableOf,
  typeOf,
  type Account,
} from '../../../../lib/accounts';

/** شجرة الحسابات — `frmAccountsDirectory.xaml`: `MaxLevel = 3`, `ExpandToLevel(0..3)`. */
const LEVELS = [
  { id: '0', label: '0' },
  { id: '1', label: '1' },
  { id: '2', label: '2' },
  { id: '3', label: '3' },
] as const;

type TreeNode = Account & { children: TreeNode[] };

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

type VisibleNode = { node: TreeNode; depth: number };

/** الشجرة تُعرض بترتيبها نفسِه، لكن صفوفاً مسطَّحة: التوسعة تحدد ما يُعرض لا بنية DOM. */
function flatten(
  nodes: TreeNode[],
  expanded: Set<string>,
  depth = 0,
  out: VisibleNode[] = [],
): VisibleNode[] {
  for (const node of nodes) {
    out.push({ node, depth });
    if (expanded.has(node.id) && node.children.length > 0) flatten(node.children, expanded, depth + 1, out);
  }
  return out;
}

export default function AccountTreePage() {
  const accounts = useQuery<Account[]>(() => listAccountDirectory(), []);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [level, setLevel] = useState('1');

  const tree = useMemo(() => buildTree(accounts.data ?? []), [accounts.data]);
  const visible = useMemo(() => flatten(tree, expanded), [tree, expanded]);

  const toggle = (id: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const expandAll = () => setExpanded(new Set((accounts.data ?? []).map((account) => account.id)));

  /** مستويات التوسعة — open the tree down to the level the desktop caps at (3). */
  const expandToLevel = (target: number) => {
    const ids = new Set<string>();
    const walk = (id: string, depth: number) => {
      ids.add(id);
      if (depth >= target) return;
      for (const child of accounts.data ?? []) {
        if (parentOf(child) === id) walk(child.id, depth + 1);
      }
    };
    for (const account of accounts.data ?? []) {
      if (!parentOf(account)) walk(account.id, 0);
    }
    setExpanded(ids);
  };

  return (
    <Screen
      title="شجرة الحسابات"
      subtitle="عرض هرمي لدليل الحسابات بالمستويات، وكل فرع برصيده من القيود المرحّلة فقط."
      crumbs={['المحاسبة', 'تعاريف']}
      actions={
        <>
          <button className="btn" type="button" onClick={expandAll}>
            توسيع الكل
          </button>
          <button className="btn" type="button" onClick={() => setExpanded(new Set())}>
            طي الكل
          </button>
          <span className="muted small" style={{ alignSelf: 'center' }}>
            مستويات التوسعة:
          </span>
          {LEVELS.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`btn sm${level === entry.id ? ' primary' : ''}`}
              onClick={() => {
                setLevel(entry.id);
                expandToLevel(Number(entry.id));
              }}
            >
              {entry.label}
            </button>
          ))}
          <button className="btn" type="button" onClick={() => window.print()}>
            طباعة
          </button>
        </>
      }
    >
      {accounts.status === 'loading' && <Loading />}
      {accounts.status === 'forbidden' && <Forbidden />}
      {accounts.status === 'error' && <ErrorBox message={accounts.error} onRetry={accounts.reload} />}
      {accounts.status === 'success' &&
        (tree.length === 0 ? (
          <Empty title="لا توجد حسابات بعد" />
        ) : (
          <Panel flush title="شجرة الحسابات">
            <Table
              bare
              columns={[
                {
                  key: 'code',
                  header: 'الرمز',
                  ltr: true,
                  cell: ({ node, depth: rowDepth }) => (
                    <span style={{ paddingInlineStart: rowDepth * 20, display: 'inline-flex', gap: 6 }}>
                      {node.children.length > 0 ? (
                        <button
                          className="btn sm"
                          type="button"
                          onClick={() => toggle(node.id)}
                          aria-expanded={expanded.has(node.id)}
                        >
                          {expanded.has(node.id) ? '−' : '+'}
                        </button>
                      ) : (
                        <span style={{ display: 'inline-block', width: 22 }} />
                      )}
                      <span dir="ltr">{node.code}</span>
                    </span>
                  ),
                },
                { key: 'name', header: 'الاسم', cell: ({ node }) => nameOf(node) },
                {
                  key: 'type',
                  header: 'النوع',
                  cell: ({ node }) => ACCOUNT_TYPE_LABELS[typeOf(node)] ?? typeOf(node),
                },
                {
                  key: 'postable',
                  header: 'الحالة',
                  cell: ({ node }) =>
                    postableOf(node) ? (
                      <span className="badge active">ترحيل</span>
                    ) : (
                      <span className="badge">تجميعي</span>
                    ),
                },
                {
                  key: 'children',
                  header: 'فروع',
                  numeric: true,
                  cell: ({ node }) => node.children.length || '',
                },
                {
                  key: 'balance',
                  header: 'الرصيد',
                  numeric: true,
                  ltr: true,
                  cell: ({ node }) => money(balanceOf(node).toFixed(4)),
                },
              ]}
              rows={visible}
              rowKey={({ node }) => node.id}
            />
          </Panel>
        ))}
    </Screen>
  );
}
