'use client';

import { FormActions, FormGrid, Page, PageHead, Panel } from '@erp/ui';
import { useState } from 'react';

import { ApiError, apiPost } from '../../../../lib/api';

export default function NewEmployeeRequestPage() {
  const [type, setType] = useState('leave');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [reason, setReason] = useState('');
  const [advanceValue, setAdvanceValue] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <Page>
      <PageHead
        title="طلب جديد"
        description="إجازة أو استئذان أو سلفة أو عهدة — يُرسل الطلب إلى مديرك مباشرة."
        breadcrumbs={['تطبيق الموظف', 'طلب جديد']}
      />
      <Panel title="بيانات الطلب">
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setBusy(true);
            setMessage('');
            void apiPost('/employee/requests', { type, from, to, reason, amount: advanceValue || undefined })
              .then(() => {
                setReason('');
                setMessage('أُرسل الطلب إلى المدير.');
              })
              .catch((error: unknown) =>
                setMessage(error instanceof ApiError ? error.message : 'تعذر إرسال الطلب'),
              )
              .finally(() => setBusy(false));
          }}
        >
          <FormGrid cols={2}>
            <label className="field">
              <span>النوع</span>
              <select className="input" value={type} onChange={(event) => setType(event.target.value)}>
                <option value="leave">إجازة</option>
                <option value="permission">استئذان</option>
                <option value="custody">عهدة</option>
                <option value="advance">سلفة</option>
              </select>
            </label>
            <label className="field">
              <span>من</span>
              <input
                className="input"
                type="date"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </label>
            <label className="field">
              <span>إلى</span>
              <input
                className="input"
                type="date"
                value={to}
                onChange={(event) => setTo(event.target.value)}
              />
            </label>
            {type === 'advance' ? (
              <label className="field">
                <span>المبلغ</span>
                <input
                  className="input"
                  inputMode="decimal"
                  value={advanceValue}
                  onChange={(event) => setAdvanceValue(event.target.value)}
                />
              </label>
            ) : null}
            <label className="field wide">
              <span>السبب</span>
              <textarea
                className="input"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                required
              />
            </label>
          </FormGrid>
          {message ? <p className="alert info mt-3">{message}</p> : null}
          <FormActions>
            <button className="btn primary" type="submit" disabled={busy || !reason.trim()}>
              إرسال الطلب
            </button>
          </FormActions>
        </form>
      </Panel>
    </Page>
  );
}
