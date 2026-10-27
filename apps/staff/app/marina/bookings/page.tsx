'use client';

import { FilterBand, FormSection, Panel } from '@erp/ui';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { todayInMakkah } from '@erp/web-core/date';

import { Empty, ErrorBox, Forbidden, Loading, Screen } from '../../../components/screen';
import { apiDelete, apiFetch, apiList, apiPatch, apiPost } from '../../../lib/api';
import { listBranches, listParties, type Branch, type Party } from '../../../lib/lookups';
import { useSession } from '../../../lib/session';
import { useQuery } from '../../../lib/use-query';
import { Table } from '../../../components/ui/table';

/**
 * الحجوزات — `Form_WPF/frmBookingM.xaml` («الحجوزات»).
 *
 * « بيانات الحجوزات» is the card: الرقم · التاريخ · الفئة · حالة الحجز
 * («مؤكد»/«غير مؤكد») · نوع الحجز («حجز عادي»/«بحر مفتوح») · تاريخ الحجز و وقته ·
 * العميل · المركب · القيمة · ⏱ المدة ساعة/دقيقة · الإضافات (الكمية · السعر ·
 * الإجمالي) — ثم مجاميع `CalcuAll`: «إجمالي الإضافات» · «الإجمالي» · «ضريبة 15%» ·
 * «الصافي». «🔍 البحث» is the second tab: رقم الحجز · اسم العميل · رقم الجوال · من
 * تاريخ/إلى تاريخ، و«📋 نتائج البحث» تحته.
 *
 * ورفضها الأول قبل أي صفٍّ: «يجب تحديد مدة الحجز» — ساعةٌ ودقيقة يقفان على صفر.
 *
 * «📝 ملاحظات» مكتوبة في الشاشة عند الديسكتوب ولا تُحفظ (`txtNotes` تُمحى ولا تُقرأ)،
 * فلم تُنقل. و«🖨️ طباعة» مؤجَّلة مع ملفّات `Reports/*.repx`.
 *
 * الإضافات تُقرأ من تعريفاتها (`Additions` — `Form_WPF/frmAdditions.xaml`): اختيارٌ
 * منها يكتب «السعر» من `SalePrice` كما يفعل `cmbAdditions_SelectionChanged`، و«➕» بجوارها
 * يفتح شاشة «📋 إضافات». و«— بلا تعريف —» لصفٍّ يُكتب وصفه باليد، وهو تسميةٌ مخترَعة:
 * النافذة عند الديسكتوب لا تقبل إلا ما في القائمة.
 */
type Addition = {
  id: string;
  additionId: string | null;
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
};
type Draft = { id?: string; additionId?: string; description: string; quantity: string; unitPrice: string };
/** الإضافة — تعريفها من `Additions` (`Form_WPF/frmAdditions.xaml`): الرقم · الاسم · القيمة. */
type AdditionDefinition = {
  id: string;
  number: number;
  name: string;
  salePrice: string;
  usageCount: number;
  version: number;
};

type Booking = {
  id: string;
  number: string | null;
  branchId: string;
  partyId: string;
  customerName: string;
  customerPhone: string;
  vesselId: string;
  vesselName: string;
  vesselCode: string;
  documentDate: string;
  startsAt: string;
  endsAt: string;
  bookingType: string;
  periodHours: number;
  periodMinutes: number;
  rentalPeriod: number;
  rentalAmount: string;
  insuranceAmount: string;
  companions: number;
  status: string;
  statusText: string;
  additions: Addition[];
  additionsTotal: string;
  total: string;
  taxAmount: string;
  netAmount: string;
  vatRate: number;
  version: number;
};

type Card = {
  id?: string;
  version?: number;
  branchId: string;
  partyId: string;
  vesselId: string;
  documentDate: string;
  startsAt: string;
  endsAt: string;
  bookingType: string;
  status: string;
  periodHours: string;
  periodMinutes: string;
  rentalAmount: string;
  insuranceAmount: string;
  companions: string;
  additions: Draft[];
};

type Vessel = { id: string; code: string; name: string; groupId?: string | null };
type Marina = { groups: Array<{ id: string; name: string }>; vessels: Vessel[] };

const today = () => todayInMakkah();
const stamp = (dateTime: string) => dateTime.slice(0, 16);

const emptyCard = (branchId = '', partyId = '', vesselId = ''): Card => ({
  branchId,
  partyId,
  vesselId,
  documentDate: today(),
  startsAt: `${today()}T08:00`,
  endsAt: `${today()}T10:00`,
  bookingType: 'حجز عادي',
  status: 'مؤكد',
  periodHours: '2',
  periodMinutes: '0',
  rentalAmount: '0',
  insuranceAmount: '0',
  companions: '0',
  additions: [],
});

const cardOf = (booking: Booking): Card => ({
  id: booking.id,
  version: booking.version,
  branchId: booking.branchId,
  partyId: booking.partyId,
  vesselId: booking.vesselId,
  documentDate: booking.documentDate,
  startsAt: stamp(booking.startsAt),
  endsAt: stamp(booking.endsAt),
  bookingType: booking.bookingType,
  status: booking.status,
  periodHours: String(booking.periodHours),
  periodMinutes: String(booking.periodMinutes),
  rentalAmount: booking.rentalAmount,
  insuranceAmount: booking.insuranceAmount,
  companions: String(booking.companions),
  additions: booking.additions.map((row) => ({
    id: row.id,
    ...(row.additionId ? { additionId: row.additionId } : {}),
    description: row.description,
    quantity: Number(row.quantity).toString(),
    unitPrice: Number(row.unitPrice).toString(),
  })),
});

const num = (value: string): number => {
  const parsed = Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : 0;
};

/** `CalcuAll` — الإضافات، فالإجمالي، فالضريبة، فالصافي. */
const totalsOf = (card: Card, vatRate: number) => {
  const additionsSum = card.additions.reduce(
    (sum, line) => sum + num(line.quantity) * num(line.unitPrice),
    0,
  );
  // الإجمالي، ثم الضريبة عليه، ثم الصافي — `CalcuAll` بحذافيره.
  const gross = additionsSum + num(card.rentalAmount) + num(card.insuranceAmount);
  const vat = Math.round(gross * (vatRate / 100) * 100) / 100;
  return { additionsTotal: additionsSum, total: gross, taxAmount: vat, netAmount: gross + vat };
};

const fmt = (value: number, digits = 2) => value.toFixed(digits).replace(/\.00$/, '');

function MarinaBookings() {
  const { can } = useSession();
  const canManage = can('marina.manage');
  const canInvoice = can('marina.invoice');

  const [filters, setFilters] = useState({ number: '', customer: '', from: '', to: '' });
  const [applied, setApplied] = useState<typeof filters | null>(null);
  const [card, setCard] = useState<Card | null>(null);
  const [line, setLine] = useState<Draft>({ description: '', quantity: '1', unitPrice: '0' });
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);

  const bookings = useQuery<Booking[]>(() => {
    const params = new URLSearchParams();
    if (applied) {
      if (applied.number.trim()) params.set('number', applied.number.trim());
      if (applied.customer.trim()) params.set('customer', applied.customer.trim());
      if (applied.from) params.set('from', applied.from);
      if (applied.to) params.set('to', applied.to);
    }
    const query = params.toString();
    return apiList<Booking>(`/marina/bookings${query ? `?${query}` : ''}`);
  }, [applied]);

  const marina = useQuery<Marina>(
    () => apiFetch<Marina>('/marina').then((body) => ((body as { data?: Marina }).data ?? body) as Marina),
    [],
  );
  // «🎁 الإضافات» — `LoadAdditions`: select id, Name from Additions where IsDeleted=0.
  const definitions = useQuery<AdditionDefinition[]>(
    () => apiList<AdditionDefinition>('/marina/additions'),
    [],
  );
  const parties = useQuery<Party[]>(() => listParties(), []);
  const branches = useQuery<Branch[]>(() => listBranches(), []);

  const rows = bookings.data ?? [];
  const vessels = marina.data?.vessels ?? [];
  const vatRate = 15;

  const setField = (patch: Partial<Card>) =>
    setCard((current) => (current ? { ...current, ...patch } : current));
  const totals = card ? totalsOf(card, vatRate) : null;

  async function save() {
    if (!card) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const payload = {
        branchId: card.branchId,
        partyId: card.partyId,
        vesselId: card.vesselId,
        documentDate: card.documentDate,
        startsAt: new Date(card.startsAt).toISOString(),
        endsAt: new Date(card.endsAt).toISOString(),
        bookingType: card.bookingType,
        status: card.status,
        periodHours: Number(card.periodHours || 0),
        periodMinutes: Number(card.periodMinutes || 0),
        rentalAmount: card.rentalAmount || '0',
        insuranceAmount: card.insuranceAmount || '0',
        companions: Number(card.companions || 0),
        additions: card.additions.map((row) => ({
          ...(row.additionId ? { additionId: row.additionId } : {}),
          description: row.description,
          quantity: row.quantity,
          unitPrice: row.unitPrice,
        })),
      };
      await (card.id
        ? apiPatch(`/marina/bookings/${card.id}`, {
            ...payload,
            ...(card.version ? { version: card.version } : {}),
          })
        : apiPost('/marina/bookings', payload));
      setNotice('تم حفظ الحجز');
      setCard(null);
      bookings.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function remove(booking: Booking) {
    if (
      !window.confirm(`هل أنت متأكد من حذف هذا الحجز؟\n\n${booking.number ?? ''} — ${booking.customerName}`)
    )
      return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiDelete(`/marina/bookings/${booking.id}`);
      setNotice('تم الحذف');
      bookings.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  async function invoice(booking: Booking) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await apiPost(`/marina/bookings/${booking.id}/rental-invoice`, {});
      setNotice('تم إصدار فاتورة التأجير');
      bookings.reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }

  const openNew = () => {
    setError('');
    setNotice('');
    setCard(emptyCard(branches.data?.[0]?.id ?? '', parties.data?.[0]?.id ?? '', vessels[0]?.id ?? ''));
  };

  return (
    <Screen
      title="الحجوزات"
      subtitle="حجز مركب لعميل مع تحديد المدة والإضافات واحتساب الإجمالي والضريبة والصافي وإصدار فاتورة التأجير."
      crumbs={['إدارة المراسي', 'الحجوزات']}
      actions={
        <div className="row" style={{ gap: 6 }}>
          <Link className="btn" href="/marina/violations">
            المخالفات
          </Link>
          {/* «» بجوار «الإضافات» — `btnAddObj_Click` يفتح `frmAdditions`. */}
          <Link className="btn" href="/marina/additions">
            إضافات
          </Link>
          {canManage && (
            <button className="btn primary" type="button" onClick={openNew}>
              حجز جديد
            </button>
          )}
        </div>
      }
    >
      {error && <p className="alert danger">{error}</p>}
      {notice && <p className="alert ok">{notice}</p>}

      {/* «البحث» — رقم الحجز · اسم العميل أو جواله · من تاريخ وإلى تاريخ. */}
      <FilterBand className="no-print">
        <div className="row" style={{ flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="field" style={{ margin: 0, minWidth: 130 }}>
            <span>رقم الحجز</span>
            <input
              className="input"
              value={filters.number}
              placeholder="BK-000001"
              onChange={(event) => setFilters({ ...filters, number: event.target.value })}
            />
          </label>
          <label className="field" style={{ margin: 0, minWidth: 200 }}>
            <span>اسم العميل / رقم الجوال</span>
            <input
              className="input"
              value={filters.customer}
              placeholder="الجوال أو الاسم..."
              onChange={(event) => setFilters({ ...filters, customer: event.target.value })}
            />
          </label>
          <label className="field" style={{ margin: 0, minWidth: 150 }}>
            <span>من تاريخ</span>
            <input
              className="input"
              type="date"
              value={filters.from}
              onChange={(event) => setFilters({ ...filters, from: event.target.value })}
            />
          </label>
          <label className="field" style={{ margin: 0, minWidth: 150 }}>
            <span>إلى تاريخ</span>
            <input
              className="input"
              type="date"
              value={filters.to}
              onChange={(event) => setFilters({ ...filters, to: event.target.value })}
            />
          </label>
          <button className="btn primary" type="button" onClick={() => setApplied(filters)}>
            بحث
          </button>
          {applied && (
            <button
              className="btn"
              type="button"
              onClick={() => {
                setFilters({ number: '', customer: '', from: '', to: '' });
                setApplied(null);
              }}
            >
              تصفية الحقول
            </button>
          )}
        </div>
      </FilterBand>

      {bookings.status === 'loading' && <Loading rows={6} />}
      {bookings.status === 'forbidden' && <Forbidden />}
      {bookings.status === 'error' && <ErrorBox message={bookings.error} onRetry={bookings.reload} />}
      {bookings.status === 'success' && (
        <>
          <Panel title="بيانات الحجوزات" hint={<>عدد السجلات: {rows.length}</>} flush>
            {rows.length === 0 ? (
              <Empty
                bare
                title="لا توجد حجوزات"
                detail="ابدأ بـ «حجز جديد»: مركب وعميل وقيمة ومدة — والمدة شرط الحفظ."
              />
            ) : (
              <Table
                bare
                columns={[
                  {
                    key: 'c0',
                    header: 'الرقم',
                    ltr: true,
                    cell: (row) => row.number ?? '—',
                  },
                  {
                    key: 'c1',
                    header: 'التاريخ',
                    ltr: true,
                    cell: (row) => row.documentDate,
                  },
                  {
                    key: 'c2',
                    header: 'العميل',
                    cell: (row) => row.customerName,
                  },
                  {
                    key: 'c3',
                    header: 'المركب',
                    cell: (row) => (
                      <>
                        {row.vesselCode} — {row.vesselName}
                      </>
                    ),
                  },
                  {
                    key: 'c4',
                    header: 'نوع الحجز',
                    cell: (row) => row.bookingType,
                  },
                  {
                    key: 'c5',
                    header: 'المدة',
                    numeric: true,
                    ltr: true,
                    cell: (row) => (
                      <>
                        {row.periodHours}س {row.periodMinutes}د
                      </>
                    ),
                  },
                  {
                    key: 'c6',
                    header: 'القيمة',
                    numeric: true,
                    ltr: true,
                    cell: (row) => fmt(Number(row.rentalAmount)),
                  },
                  {
                    key: 'c7',
                    header: 'الإضافات',
                    numeric: true,
                    ltr: true,
                    cell: (row) => fmt(Number(row.additionsTotal)),
                  },
                  {
                    key: 'c8',
                    header: 'الإجمالي',
                    numeric: true,
                    ltr: true,
                    cell: (row) => fmt(Number(row.total)),
                  },
                  {
                    key: 'c9',
                    header: 'الصافي',
                    numeric: true,
                    ltr: true,
                    cell: (row) => fmt(Number(row.netAmount)),
                  },
                  {
                    key: 'c10',
                    header: 'حالة الحجز',
                    cell: (row) => (
                      <>
                        <span className={`badge${row.statusText === 'مؤكد' ? '' : ' danger'}`}>
                          {row.statusText}
                        </span>
                      </>
                    ),
                  },
                  ...(canManage || canInvoice
                    ? [
                        {
                          key: 'c11',
                          header: 'إجراءات',
                          cell: (row: Booking) => (
                            <>
                              <div className="row" style={{ gap: 4 }}>
                                {canManage && (
                                  <button
                                    className="btn sm"
                                    type="button"
                                    onClick={() => setCard(cardOf(row))}
                                  >
                                    تعديل
                                  </button>
                                )}
                                {canInvoice && (
                                  <button className="btn sm" type="button" onClick={() => invoice(row)}>
                                    فاتورة
                                  </button>
                                )}
                                {canManage && (
                                  <button className="btn sm danger" type="button" onClick={() => remove(row)}>
                                    حذف
                                  </button>
                                )}
                              </div>
                            </>
                          ),
                        },
                      ]
                    : []),
                ]}
                rows={rows}
                rowKey={(row) => row.id}
              />
            )}
          </Panel>
        </>
      )}

      {card && (
        <div className="modal-backdrop" role="dialog" aria-modal="true">
          <div className="modal-card" style={{ maxWidth: 860 }}>
            <div className="modal-head">
              <span className="modal-title">{card.id ? 'تعديل الحجز' : 'بيانات الحجوزات'}</span>
              <button className="btn sm" type="button" onClick={() => setCard(null)}>
                خروج
              </button>
            </div>
            <div style={{ padding: 16, display: 'grid', gap: 12, maxHeight: '70vh', overflow: 'auto' }}>
              <div className="form-grid">
                <label className="field">
                  <span>الرقم</span>
                  <input className="input" value={card.id ? 'يُصدر عند الحفظ' : 'يُصدر عند الحفظ'} disabled />
                </label>
                <label className="field">
                  <span>التاريخ</span>
                  <input
                    className="input"
                    type="date"
                    value={card.documentDate}
                    onChange={(event) => setField({ documentDate: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>الفرع</span>
                  <select
                    className="input"
                    value={card.branchId}
                    onChange={(event) => setField({ branchId: event.target.value })}
                  >
                    <option value="">— اختر فرعاً —</option>
                    {(branches.data ?? []).map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.nameAr ?? branch.code ?? branch.id}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>العميل *</span>
                  <select
                    className="input"
                    value={card.partyId}
                    onChange={(event) => setField({ partyId: event.target.value })}
                  >
                    <option value="">— اختر عميلاً —</option>
                    {(parties.data ?? []).map((party) => (
                      <option key={party.id} value={party.id}>
                        {party.name}
                        {party.phone ? ` · ${party.phone}` : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>المركب *</span>
                  <select
                    className="input"
                    value={card.vesselId}
                    onChange={(event) => setField({ vesselId: event.target.value })}
                  >
                    <option value="">— اختر مركباً —</option>
                    {vessels.map((vessel) => (
                      <option key={vessel.id} value={vessel.id}>
                        {vessel.code} — {vessel.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>حالة الحجز</span>
                  <select
                    className="input"
                    value={card.status}
                    onChange={(event) => setField({ status: event.target.value })}
                  >
                    <option value="مؤكد">مؤكد</option>
                    <option value="غير مؤكد">غير مؤكد</option>
                  </select>
                </label>
                <label className="field">
                  <span>تاريخ الحجز</span>
                  <input
                    className="input"
                    type="datetime-local"
                    value={card.startsAt}
                    onChange={(event) => setField({ startsAt: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>حتى</span>
                  <input
                    className="input"
                    type="datetime-local"
                    value={card.endsAt}
                    onChange={(event) => setField({ endsAt: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>القيمة</span>
                  <input
                    className="input numeric"
                    value={card.rentalAmount}
                    onChange={(event) => setField({ rentalAmount: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>المدة ساعة</span>
                  <input
                    className="input numeric"
                    value={card.periodHours}
                    onChange={(event) => setField({ periodHours: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>دقيقة</span>
                  <input
                    className="input numeric"
                    value={card.periodMinutes}
                    onChange={(event) => setField({ periodMinutes: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>التأمين</span>
                  <input
                    className="input numeric"
                    value={card.insuranceAmount}
                    onChange={(event) => setField({ insuranceAmount: event.target.value })}
                  />
                </label>
                <label className="field">
                  <span>المرافقون</span>
                  <input
                    className="input numeric"
                    value={card.companions}
                    onChange={(event) => setField({ companions: event.target.value })}
                  />
                </label>
              </div>

              <FormSection title="نوع الحجز">
                <div className="row" style={{ gap: 12 }}>
                  {['حجز عادي', 'بحر مفتوح'].map((type) => (
                    <label key={type} className="row" style={{ gap: 6 }}>
                      <input
                        type="radio"
                        name="bookingType"
                        checked={card.bookingType === type}
                        onChange={() => setField({ bookingType: type })}
                      />
                      <span>{type}</span>
                    </label>
                  ))}
                </div>
              </FormSection>

              {/* الإضافات — الوصف · العدد · السعر · الإجمالي · حذف */}
              <FormSection title="الإضافات">
                <div className="row" style={{ gap: 6, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <label className="field" style={{ margin: 0, flex: 1, minWidth: 180 }}>
                    <span>الإضافات</span>
                    <select
                      className="input"
                      value={line.additionId ?? ''}
                      onChange={(event) => {
                        const chosen = (definitions.data ?? []).find((row) => row.id === event.target.value);
                        // `cmbAdditions_SelectionChanged` — «السعر» يُكتب من `SalePrice`.
                        setLine(
                          chosen
                            ? {
                                additionId: chosen.id,
                                description: chosen.name,
                                quantity: line.quantity,
                                unitPrice: String(Number(chosen.salePrice)),
                              }
                            : { description: '', quantity: line.quantity, unitPrice: '0' },
                        );
                      }}
                    >
                      <option value="">— بلا تعريف —</option>
                      {(definitions.data ?? []).map((row) => (
                        <option key={row.id} value={row.id}>
                          {row.number} · {row.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field" style={{ margin: 0, flex: 1, minWidth: 160 }}>
                    <span>الوصف</span>
                    <input
                      className="input"
                      value={line.description}
                      onChange={(event) => setLine({ ...line, description: event.target.value })}
                    />
                  </label>
                  <label className="field" style={{ margin: 0, width: 90 }}>
                    <span>الكمية</span>
                    <input
                      className="input numeric"
                      value={line.quantity}
                      onChange={(event) => setLine({ ...line, quantity: event.target.value })}
                    />
                  </label>
                  <label className="field" style={{ margin: 0, width: 110 }}>
                    <span>السعر</span>
                    <input
                      className="input numeric"
                      value={line.unitPrice}
                      onChange={(event) => setLine({ ...line, unitPrice: event.target.value })}
                    />
                  </label>
                  <button
                    className="btn primary"
                    type="button"
                    title="إضافة"
                    onClick={() => {
                      if (!line.description.trim()) return;
                      // `Add2Dgv` — إضافةٌ في الشبكة أصلاً تُجمَع كمّيتها على صفّها.
                      const at = line.additionId
                        ? card.additions.findIndex((row) => row.additionId === line.additionId)
                        : -1;
                      const additions =
                        at >= 0
                          ? card.additions.map((row, index) =>
                              index === at
                                ? { ...row, quantity: (num(row.quantity) + num(line.quantity)).toString() }
                                : row,
                            )
                          : [...card.additions, { ...line }];
                      setCard({ ...card, additions });
                      setLine({ description: '', quantity: '1', unitPrice: '0' });
                    }}
                  ></button>
                </div>
                {card.additions.length > 0 && (
                  <div style={{ marginTop: 8 }}>
                    <Table
                      columns={[
                        {
                          key: 'c0',
                          header: 'الإضافة',
                          ltr: true,
                          cell: (row) =>
                            (definitions.data ?? []).find((item) => item.id === row.additionId)?.number ??
                            '—',
                        },
                        {
                          key: 'c1',
                          header: 'الوصف',
                          cell: (row) => row.description,
                        },
                        {
                          key: 'c2',
                          header: 'العدد',
                          numeric: true,
                          ltr: true,
                          cell: (row) => row.quantity,
                        },
                        {
                          key: 'c3',
                          header: 'السعر',
                          numeric: true,
                          ltr: true,
                          cell: (row) => row.unitPrice,
                        },
                        {
                          key: 'c4',
                          header: 'الإجمالي',
                          numeric: true,
                          ltr: true,
                          cell: (row) => fmt(num(row.quantity) * num(row.unitPrice)),
                        },
                        {
                          key: 'c5',
                          header: '',
                          cell: (_, index) => (
                            <>
                              <button
                                className="btn sm danger"
                                type="button"
                                onClick={() =>
                                  setCard({
                                    ...card,
                                    additions: card.additions.filter((_, i) => i !== index),
                                  })
                                }
                              >
                                حذف
                              </button>
                            </>
                          ),
                        },
                      ]}
                      rows={card.additions}
                      rowKey={(row, index) => `${row.description}-${index}`}
                    />
                  </div>
                )}
              </FormSection>

              {totals && (
                <div className="row" style={{ gap: 16, flexWrap: 'wrap', fontWeight: 700 }}>
                  <span>
                    إجمالي الإضافات: <span dir="ltr">{fmt(totals.additionsTotal)}</span>
                  </span>
                  <span>
                    الإجمالي: <span dir="ltr">{fmt(totals.total)}</span>
                  </span>
                  <span>
                    ضريبة {vatRate}%: <span dir="ltr">{fmt(totals.taxAmount)}</span>
                  </span>
                  <span>
                    الصافي: <span dir="ltr">{fmt(totals.netAmount)}</span>
                  </span>
                </div>
              )}
              <p className="muted" style={{ margin: 0 }}>
                «يجب تحديد مدة الحجز» — الساعة والدقيقة لا يقفان معاً على صفر.
              </p>
            </div>
            <div className="modal-foot">
              <button className="btn primary" type="button" onClick={() => void save()} disabled={busy}>
                حفظ
              </button>
              {/* «جديد» = `CLR` — كل الصناديق تعود فارغة. */}
              <button
                className="btn"
                type="button"
                disabled={busy}
                onClick={() => setCard(emptyCard(card.branchId, card.partyId, card.vesselId))}
              >
                جديد
              </button>
              <button className="btn danger" type="button" onClick={() => setCard(null)} disabled={busy}>
                خروج
              </button>
            </div>
          </div>
        </div>
      )}
    </Screen>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<Loading rows={6} />}>
      <MarinaBookings />
    </Suspense>
  );
}
