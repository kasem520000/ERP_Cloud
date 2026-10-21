'use client';

import { Panel } from '@erp/ui';
import { useMemo, useState } from 'react';

import { Empty, ErrorBox, Forbidden, Loading, Screen } from '../../components/screen';
import { Table, type Column } from '../../components/ui/table';
import { useSession } from '../../lib/session';
import { useQuery } from '../../lib/use-query';

/**
 * مستكشف الـAPI — وثيقة OpenAPI كما يُصدرها الخادم نفسه (P-C11).
 *
 * الشاشة تقرأ `/api/docs/openapi.json` (عبر نفس أصل اللوحة، فلا CORS ولا منفذٌ مفتوح في
 * المتصفّح) وتعرض المسارات مجموعةً ومُرشَّحة. وهذا اختيارٌ مقصود: **لا نسخة ثانية من
 * الوثيقة** تُكتب هنا وتتخلّف عن الكود — ما يظهر هو ما ولّده الخادم من الديكوريترات لحظة
 * الإقلاع. وواجهة Swagger الكاملة تبعد نقرةً واحدة (`/api/docs`) لمن يريد التجربة اليدوية.
 *
 * وتُبرز الشاشة أولاً ما يهمّ المطوّر: **سطح التكامل** الذي يعمل بمفتاح الـAPI
 * (`/api/v1/integration/v1/*`) وسطح **بوابة المطوّر** في اللوحة — لا الخمسمائة مسار دفعةً
 * واحدة بلا سياق.
 */

type Operation = {
  summary?: string;
  tags?: string[];
  deprecated?: boolean;
};

type OpenApiDocument = {
  info?: { title?: string; version?: string };
  paths?: Record<string, Record<string, Operation>>;
};

const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

type OperationRow = { path: string; method: string; summary: string; group: string };

const operationColumns: Array<Column<OperationRow>> = [
  {
    key: 'method',
    header: 'الطريقة',
    width: 90,
    cell: (row) => <code className="badge ltr">{row.method}</code>,
  },
  { key: 'path', header: 'المسار', ltr: true, grow: true, cell: (row) => <code>{row.path}</code> },
  { key: 'summary', header: 'الوصف', cell: (row) => <span className="small">{row.summary}</span> },
];

export default function ApiExplorerPage() {
  const { canConsole } = useSession();
  const [query, setQuery] = useState('');

  const allowed = canConsole('console.apikeys.manage');

  const document = useQuery(async () => {
    const response = await fetch('/api/docs/openapi.json', { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`الوثيقة غير متاحة (${response.status})`);
    return (await response.json()) as OpenApiDocument;
  }, []);

  const groups = useMemo(() => {
    const paths = document.data?.paths ?? {};
    const needle = query.trim().toLowerCase();
    const rows: OperationRow[] = [];

    for (const [path, operations] of Object.entries(paths)) {
      for (const method of METHODS) {
        const operation = operations[method];
        if (!operation) continue;
        const haystack = `${method} ${path} ${operation.summary ?? ''}`.toLowerCase();
        if (needle.length > 0 && !haystack.includes(needle)) continue;
        rows.push({
          path,
          method: method.toUpperCase(),
          summary: operation.summary ?? '',
          group: groupOf(path),
        });
      }
    }

    const byGroup = new Map<string, OperationRow[]>();
    for (const row of rows) {
      byGroup.set(row.group, [...(byGroup.get(row.group) ?? []), row]);
    }
    return [...byGroup.entries()].sort((left, right) => right[1].length - left[1].length);
  }, [document.data, query]);

  if (!allowed) {
    return (
      <Screen title="مستكشف الـAPI" subtitle="الوثيقة كما يُصدرها الخادم">
        <Forbidden />
      </Screen>
    );
  }

  return (
    <Screen
      title="مستكشف الـAPI"
      subtitle="وثيقة OpenAPI الحيّة: ما ينشره الخادم فعلاً، مرتّبةً بحسب سطح العقد"
      actions={
        <a className="btn" href="/api/docs" target="_blank" rel="noreferrer">
          واجهة Swagger الكاملة
        </a>
      }
    >
      <Panel>
        <div className="form-grid">
          <label>
            بحث في المسارات والأوصاف
            <input
              className="input"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="integration أو invoice أو webhook"
            />
          </label>
        </div>
        {document.data?.info && (
          <p className="muted">
            {document.data.info.title} — الإصدار <code>{document.data.info.version}</code> ·{' '}
            {Object.keys(document.data.paths ?? {}).length} مساراً ·{' '}
            {groups.reduce((sum, entry) => sum + entry[1].length, 0)} عملية
          </p>
        )}
        <p className="muted">
          سطح التكامل: <code>/api/v1/integration/v1/me</code> و<code>/invoices</code> و<code>/signature</code>{' '}
          — تُنادى بترويسة <code>Authorization: Bearer erp_live_…</code> ونطاقات المفتاح هي سقفها.
        </p>
      </Panel>

      {document.status === 'loading' && <Loading rows={5} />}
      {document.status === 'error' && <ErrorBox message={document.error} onRetry={() => document.reload()} />}
      {document.status === 'success' && groups.length === 0 && (
        <Empty title="لا مسارات مطابقة" detail="جرّب كلمةً أعمّ." />
      )}

      {groups.map(([group, rows]) => (
        <Panel key={group}>
          <div className="row">
            <strong>{group}</strong>
            <span className="badge">{rows.length}</span>
          </div>
          <Table
            bare
            dense
            columns={operationColumns}
            rows={rows.slice(0, 60)}
            rowKey={(row) => `${row.method} ${row.path}`}
          />
          {rows.length > 60 && (
            <p className="muted">…و{rows.length - 60} عملية أخرى — استعمل البحث لتصفيتها.</p>
          )}
        </Panel>
      ))}
    </Screen>
  );
}

/** سطح العقد: التكامل · بوابة المطوّر · المنصة · العميل — كما يقرؤها المطوّر لا كما تُخزَّن. */
function groupOf(path: string): string {
  if (path.includes('/integration/')) return 'سطح التكامل (مفتاح API)';
  if (path.startsWith('/api/v1/platform/tenants/{id}/api-keys') || path.includes('/platform/webhooks')) {
    return 'بوابة المطوّر في اللوحة';
  }
  if (path.includes('/api-keys') || path.includes('/webhooks')) return 'بوابة المطوّر في اللوحة';
  if (path.startsWith('/api/v1/platform')) return 'سطح المنصة (لوحة المشغّل)';
  return 'سطح العميل والموظفين';
}
