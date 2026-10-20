'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Panel } from '@erp/ui';

import { DataTable, QueryView } from '../../../../components/data-view';
import { Screen } from '../../../../components/screen';
import { apiData, apiList } from '../../../../lib/api';
import { listParties, money, partyLabel, quantity, shortDate, type Party } from '../../../../lib/lookups';
import { useSession } from '../../../../lib/session';
import { useQuery } from '../../../../lib/use-query';

type Line = {
  id: string;
  lineNo: number;
  description: string | null;
  quantity: string;
  unitPrice: string;
  total: string;
};

type Quotation = {
  id: string;
  number: string | null;
  kind: string;
  status: string;
  partyId: string | null;
  cashCustomerName: string | null;
  currency: string;
  total: string;
  validUntil: string | null;
  lines: Line[];
};

type SignatureRequest = {
  id: string;
  signerEmail: string;
  signerName: string;
  status: string;
  signedAt: string | null;
  expiresAt: string;
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'مفتوح',
  converted: 'حُوِّل إلى فاتورة',
  voided: 'ملغى',
  signed: 'موقّع',
};

const SIGN_LABELS: Record<string, string> = {
  sent: 'أُرسل',
  viewed: 'شُوهد',
  signed: 'موقّع',
  declined: 'مرفوض',
};

export default function QuotationDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const { can } = useSession();
  const canSign = can('esign.manage');
  const quotation = useQuery<Quotation>(() => apiData<Quotation>(`/sales/invoices/${id}`), [id]);
  const requests = useQuery<SignatureRequest[]>(
    () => (canSign ? apiList<SignatureRequest>(`/esign/requests?entityId=${id}`) : Promise.resolve([])),
    [id, canSign],
  );
  const parties = useQuery<Party[]>(() => listParties('customer'), []);

  const row = quotation.data;
  const customer = row?.cashCustomerName
    ? `${row.cashCustomerName} (نقدي)`
    : partyLabel((parties.data ?? []).find((party) => party.id === row?.partyId) ?? { id: '', name: '—' });

  return (
    <Screen
      title={row?.number ? `عرض سعر ${row.number}` : 'عرض سعر'}
      subtitle="عرض مسعّر بلا أثر مخزني. التوقيع هنا رسم ورمز لمرة واحدة، وليس توقيعاً مؤهلاً."
      crumbs={['المبيعات', 'عرض سعر']}
      actions={
        row?.kind === 'quotation' && row.status === 'draft' && can('esign.manage') ? (
          <Link className="btn primary" href={`/sales/quotations/${id}/esign`}>
            إرسال للتوقيع
          </Link>
        ) : (
          <Link className="btn" href="/sales/quotations">
            العودة للقائمة
          </Link>
        )
      }
    >
      <QueryView query={quotation} empty="عرض السعر غير موجود">
        {(document) =>
          document.kind !== 'quotation' ? (
            <p className="m-0 rounded-[10px] border border-warn-line bg-warn-soft px-4 py-2.5 text-[13px] font-semibold text-warn-ink">
              هذا المستند ليس عرض سعر. <Link href="/sales/quotations">العودة إلى القائمة</Link>
            </p>
          ) : (
            <>
              <Panel title="بيانات العرض" hint="الحالة والصالحية كما رجعت من الخادم.">
                <div className="ui-kpi-grid">
                  <div className="ui-kpi-cell">
                    <span className="ui-kpi-label">العميل</span>
                    <span className="ui-kpi-value" style={{ fontSize: 15 }}>
                      {customer}
                    </span>
                  </div>
                  <div className="ui-kpi-cell">
                    <span className="ui-kpi-label">الحالة</span>
                    <span className="ui-kpi-value" style={{ fontSize: 15 }}>
                      {STATUS_LABELS[document.status] ?? document.status}
                    </span>
                  </div>
                  <div className="ui-kpi-cell">
                    <span className="ui-kpi-label">صالح حتى</span>
                    <span className="ui-kpi-value" style={{ fontSize: 15 }}>
                      {document.validUntil ? shortDate(document.validUntil) : 'غير محدّد'}
                    </span>
                  </div>
                  <div className="ui-kpi-cell">
                    <span className="ui-kpi-label">الإجمالي</span>
                    <span className="ui-kpi-value num" dir="ltr">
                      {money(document.total, document.currency)}
                    </span>
                  </div>
                </div>
              </Panel>
              <Panel flush title="أسطر العرض" hint="الكمية والسعر والإجمالي لكل سطر.">
                <DataTable
                  columns={[
                    { key: 'line', header: '#', cell: (line: Line) => line.lineNo },
                    { key: 'description', header: 'البيان', cell: (line: Line) => line.description || '—' },
                    {
                      key: 'quantity',
                      header: 'الكمية',
                      align: 'num',
                      cell: (line: Line) => quantity(line.quantity),
                    },
                    {
                      key: 'unit',
                      header: 'سعر الوحدة',
                      align: 'num',
                      cell: (line: Line) => money(line.unitPrice, document.currency),
                    },
                    {
                      key: 'lineTotal',
                      header: 'الإجمالي',
                      align: 'num',
                      cell: (line: Line) => money(line.total, document.currency),
                    },
                  ]}
                  rows={document.lines}
                  rowKey={(line) => line.id}
                />
              </Panel>
            </>
          )
        }
      </QueryView>

      {canSign ? (
        <QueryView query={requests} empty="لم يُرسل هذا العرض للتوقيع بعد">
          {(rows) => (
            <Panel flush title="التوقيع الإلكتروني" hint="الموقّع وحالته وتاريخ التوقيع من الخادم.">
              <DataTable
                columns={[
                  {
                    key: 'email',
                    header: 'الموقّع',
                    cell: (entry: SignatureRequest) => entry.signerName || entry.signerEmail,
                  },
                  { key: 'mail', header: 'البريد', cell: (entry: SignatureRequest) => entry.signerEmail },
                  {
                    key: 'status',
                    header: 'الحالة',
                    cell: (entry: SignatureRequest) => SIGN_LABELS[entry.status] ?? entry.status,
                  },
                  {
                    key: 'signed',
                    header: 'وُقّع في',
                    cell: (entry: SignatureRequest) => (entry.signedAt ? shortDate(entry.signedAt) : '—'),
                  },
                  {
                    key: 'expires',
                    header: 'ينتهي',
                    cell: (entry: SignatureRequest) => shortDate(entry.expiresAt),
                  },
                ]}
                rows={rows}
                rowKey={(entry) => entry.id}
              />
            </Panel>
          )}
        </QueryView>
      ) : null}
    </Screen>
  );
}
