'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  Input,
  Kpi,
  Select,
  type Column,
} from '@erp/ui';
import { apiData, apiErrorText, apiList } from '@erp/web-core/api';

import { listState, rowKeyFrom } from '../../lib/ui-kit';
import { numberText } from '../../lib/lookups';

type StatementLine = Record<string, unknown> & {
  id?: string;
  date?: string;
  description?: string;
  debit?: string;
  credit?: string;
  runningBalance?: string;
};

type StatementPayload = {
  openingBalance?: string;
  closingBalance?: string;
  totalDebit?: string;
  totalCredit?: string;
  rows?: StatementLine[];
  lines?: StatementLine[];
};

export default function BakeryEmployeeAccountPage() {
  const [employees, setEmployees] = useState<Array<{ id: string; name: string }>>([]);
  const [employeeId, setEmployeeId] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [statement, setStatement] = useState<StatementPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiList<{ id: string; name: string }>('/hrm/employees')
      .then((list) => {
        setEmployees(list);
        if (list[0]?.id) setEmployeeId(list[0].id);
        else setLoading(false);
      })
      .catch((caught) => {
        setError(apiErrorText(caught, 'تعذّر قراءة قائمة الموظفين'));
        setLoading(false);
      });
  }, []);

  const loadStatement = useCallback(async () => {
    if (!employeeId) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ employee_id: employeeId, full_period: '1' });
      if (fromDate) {
        qs.set('from', fromDate);
        qs.delete('full_period');
      }
      if (toDate) {
        qs.set('to', toDate);
        qs.delete('full_period');
      }
      const res = await apiData<StatementPayload>(`/hrm/employee-statement?${qs.toString()}`);
      setStatement(res);
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر قراءة كشف حساب الموظف'));
    } finally {
      setLoading(false);
    }
  }, [employeeId, fromDate, toDate]);

  useEffect(() => {
    if (employeeId) void loadStatement();
  }, [employeeId, loadStatement]);

  const rows = statement?.rows ?? statement?.lines ?? [];

  const columns: Column<StatementLine>[] = [
    { key: 'date', header: 'التاريخ', ltr: true, cell: (r) => String(r.date ?? '').slice(0, 10) || '—' },
    { key: 'desc', header: 'البيان', cell: (r) => String(r.description ?? '—') },
    { key: 'debit', header: 'مدين (ر.س)', numeric: true, cell: (r) => numberText(String(r.debit ?? '0')) },
    { key: 'credit', header: 'دائن (ر.س)', numeric: true, cell: (r) => numberText(String(r.credit ?? '0')) },
    {
      key: 'bal',
      header: 'الرصيد المتحرّك',
      numeric: true,
      cell: (r) => numberText(String(r.runningBalance ?? '0')),
    },
  ];

  return (
    <section className="ui-page">
      <header className="ui-page-head">
        <div className="ui-page-head-copy">
          <h1 className="ui-page-title">كشف حساب موظف / مندوب</h1>
          <p className="ui-page-sub">
            حركة ذمة الموظف في الأستاذ العام شاملةً الرواتب والسُّلَف وتحميل فروقات وعجز العهدة.
          </p>
        </div>
        <div className="ui-page-actions">
          <Button onClick={() => void loadStatement()} size="sm">
            تحديث الكشف
          </Button>
        </div>
      </header>

      <div className="ui-screen-body">
        {statement ? (
          <div className="ui-kpi-grid">
            <Kpi title="رصيد أول المدة" tone="neutral" value={`${numberText(statement.openingBalance ?? '0')} ر.س`} />
            <Kpi title="إجمالي المدين" tone="warn" value={`${numberText(statement.totalDebit ?? '0')} ر.س`} />
            <Kpi title="إجمالي الدائن" tone="ok" value={`${numberText(statement.totalCredit ?? '0')} ر.س`} />
            <Kpi title="الرصيد الختامي" tone="brand" value={`${numberText(statement.closingBalance ?? '0')} ر.س`} />
          </div>
        ) : null}

        <Card>
          <CardHeader subtitle="اختر الموظف وحدد الفترة الزمنية لعرض كشف حسابه التفصيلي." title="كشف الحساب التفصيلي" />
          <CardBody>
            <div className="mb-3 grid gap-2 sm:grid-cols-3">
              <Select
                label="الموظف"
                onChange={(e) => setEmployeeId(e.target.value)}
                options={employees.map((e) => ({ value: e.id, label: e.name }))}
                value={employeeId}
              />
              <Input label="من تاريخ" onChange={(e) => setFromDate(e.target.value)} type="date" value={fromDate} />
              <Input label="إلى تاريخ" onChange={(e) => setToDate(e.target.value)} type="date" value={toDate} />
            </div>

            <DataTable
              columns={columns}
              empty="لا حركات مسجلة في ذمة هذا الموظف"
              rows={rows}
              rowKey={rowKeyFrom(['id'])}
              state={listState({ loading, error })}
            />
          </CardBody>
        </Card>
      </div>
    </section>
  );
}
