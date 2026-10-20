'use client';

import { useEffect, useRef, useState } from 'react';
import { Building2, ImagePlus, Trash2 } from 'lucide-react';
import { Panel } from '@erp/ui';

import { Empty, ErrorBox, Forbidden, Loading, Screen } from '../../../components/screen';
import { ApiError, apiData, apiErrorText, apiPut } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { useQuery } from '../../../lib/use-query';

type Address = {
  plot?: string;
  building?: string;
  street?: string;
  addStreet?: string;
  district?: string;
  city?: string;
  postal?: string;
  additional?: string;
  unit?: string;
  countryCode?: string;
};

type Profile = {
  nameAr: string;
  nameEn: string | null;
  taxNo: string | null;
  crNo: string | null;
  logoFileId: string | null;
  logoDataUrl: string | null;
  address: Address | null;
  phones: string[];
  email: string | null;
  countryCode: string | null;
  einvoiceFlags: { zatca?: boolean; eta?: boolean };
  version: number;
} | null;

type AddressKey = keyof Address;

type Draft = {
  nameAr: string;
  nameEn: string;
  taxNo: string;
  crNo: string;
  phones: string;
  email: string;
  countryCode: string;
  logoDataUrl: string;
  address: Required<Omit<Address, 'countryCode'>>;
};

const EMPTY_ADDRESS: Draft['address'] = {
  plot: '',
  building: '',
  street: '',
  addStreet: '',
  district: '',
  city: '',
  postal: '',
  additional: '',
  unit: '',
};

const EMPTY_DRAFT: Draft = {
  nameAr: '',
  nameEn: '',
  taxNo: '',
  crNo: '',
  phones: '',
  email: '',
  countryCode: 'SA',
  logoDataUrl: '',
  address: EMPTY_ADDRESS,
};

const LABELS = {
  nameAr: 'الاسم القانوني (عربي)',
  nameEn: 'الاسم القانوني (إنجليزي)',
  taxNo: 'الرقم الضريبي',
  crNo: 'السجل التجاري',
  email: 'البريد الإلكتروني',
  countryCode: 'الدولة',
} as const;

/**
 * ترتيب العنوان الوطني — نفس ترتيب «العنوان الوطني» في منصة العنوان الوطني السعودي:
 * رقم المبنى، الشارع، الحي، المدينة، الرمز البريدي، الرقم الإضافي، ثم رقم الوحدة.
 * (كانت الحقول مرتّبة بترتيبٍ عشوائي فتظهر «مختلطة» في البطاقة وفي الطباعة.)
 */
const ADDRESS_FIELDS: Array<{ key: AddressKey; label: string; hint?: string; dir?: 'ltr'; wide?: boolean }> =
  [
    { key: 'building', label: 'رقم المبنى', hint: '٤ خانات', dir: 'ltr' },
    { key: 'street', label: 'الشارع' },
    { key: 'district', label: 'الحي' },
    { key: 'city', label: 'المدينة' },
    { key: 'postal', label: 'الرمز البريدي', hint: '٥ خانات', dir: 'ltr' },
    { key: 'additional', label: 'الرقم الإضافي', hint: '٤ خانات', dir: 'ltr' },
    { key: 'unit', label: 'رقم الوحدة', dir: 'ltr' },
    { key: 'plot', label: 'الرقم الفرعي', dir: 'ltr' },
    { key: 'addStreet', label: 'الشارع الإضافي', wide: true },
  ];

/** سطر العنوان كما يُطبع: الصيغة نفسها التي يبنيها قالب الطباعة. */
function addressLine(address: Address | null | undefined): string {
  if (!address) return '';
  const order: AddressKey[] = [
    'building',
    'street',
    'addStreet',
    'district',
    'city',
    'postal',
    'additional',
    'unit',
    'plot',
  ];
  const labels: Partial<Record<AddressKey, string>> = {
    building: 'مبنى',
    street: 'شارع',
    district: 'حي',
    postal: 'الرمز البريدي',
    additional: 'الرقم الإضافي',
    unit: 'الوحدة',
    plot: 'الرقم الفرعي',
  };
  return order
    .map((key) => {
      const value = String(address[key] ?? '').trim();
      if (!value) return '';
      return labels[key] ? `${labels[key]} ${value}` : value;
    })
    .filter(Boolean)
    .join('، ');
}

/** حدود الشعار: صورةٌ أكبر من ٢ ميجابايت تُرفض قبل قراءتها، والناتج ≤ ٦٩٠ ألف حرف. */
const LOGO_INPUT_MAX_BYTES = 2 * 1024 * 1024;
const LOGO_DATA_MAX_CHARS = 690_000;
const LOGO_MAX_SIDE = 512;

/**
 * يُصغّر الصورة في المتصفّح ثم يُرمّزها data URL.
 *
 * ولماذا لا يُرفع الملف إلى التخزين؟ لأن الوثيقة المطبوعة مكتفية بذاتها: رابطٌ موقّع
 * تنتهي صلاحيته أو يحتاج جلسةً يجعل الشعار مربّعاً فارغاً في PDF. الشعار هنا جزءٌ من
 * الصفحة نفسها، ويعمل في كل نشرة حتى التي لا تخزين كائنات فيها.
 */
async function fileToLogo(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('اختر صورة (PNG أو JPEG أو WebP).');
  }
  if (file.size > LOGO_INPUT_MAX_BYTES) {
    throw new Error('حجم الصورة أكبر من ٢ ميجابايت — صغّرها ثم أعد المحاولة.');
  }
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, LOGO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('تعذّر تجهيز الصورة في هذا المتصفّح.');
    // خلفية بيضاء قبل الرسم: JPEG لا يحمل شفافية، فشعارٌ شفّاف يصبح أسود بلا هذا السطر.
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let encoded = canvas.toDataURL('image/png');
    if (encoded.length > LOGO_DATA_MAX_CHARS) {
      encoded = canvas.toDataURL('image/jpeg', 0.85);
    }
    if (encoded.length > LOGO_DATA_MAX_CHARS) {
      throw new Error('الشعار كبير بعد التصغير — استخدم صورة أبسط أو أقل تفصيلاً.');
    }
    return encoded;
  } finally {
    bitmap.close();
  }
}

export default function CompanyProfilePage() {
  const { me, can } = useSession();
  const canManage = can('organization.companyprofile.manage');
  const profile = useQuery<Profile>(async () => {
    try {
      return await apiData<Profile>('/company-profile');
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) return null;
      throw error;
    }
  }, []);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [logoBusy, setLogoBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'ok' | 'danger'; text: string }>();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const logoInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (profile.status !== 'success') return;
    const row = profile.data;
    setDraft(
      row
        ? {
            nameAr: row.nameAr,
            nameEn: row.nameEn ?? '',
            taxNo: row.taxNo ?? '',
            crNo: row.crNo ?? '',
            phones: row.phones.join(', '),
            email: row.email ?? '',
            countryCode: row.countryCode ?? 'SA',
            logoDataUrl: row.logoDataUrl ?? '',
            address: {
              ...EMPTY_ADDRESS,
              ...Object.fromEntries(
                Object.entries(row.address ?? {}).map(([key, value]) => [key, value ?? '']),
              ),
            } as Draft['address'],
          }
        : EMPTY_DRAFT,
    );
  }, [profile.status, profile.data]);

  const setAddress = (key: AddressKey, value: string): void =>
    setDraft((current) => ({ ...current, address: { ...current.address, [key]: value } }));

  async function pickLogo(file: File | undefined): Promise<void> {
    if (!file) return;
    setLogoBusy(true);
    setNotice(undefined);
    try {
      const logoDataUrl = await fileToLogo(file);
      setDraft((current) => ({ ...current, logoDataUrl }));
      setNotice({ kind: 'ok', text: 'تم تجهيز الشعار — احفظ البيانات لتثبيته على المنشأة.' });
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error) });
    } finally {
      setLogoBusy(false);
      if (logoInput.current) logoInput.current.value = '';
    }
  }

  const save = async (event: React.FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setBusy(true);
    setNotice(undefined);
    try {
      const address = Object.fromEntries(
        Object.entries(draft.address).filter(([, value]) => value.trim().length > 0),
      );
      await apiPut('/company-profile', {
        nameAr: draft.nameAr.trim(),
        nameEn: draft.nameEn.trim() || null,
        taxNo: draft.taxNo.trim() || null,
        crNo: draft.crNo.trim() || null,
        address: Object.keys(address).length > 0 ? address : null,
        phones: draft.phones
          .split(/[,،\n]/)
          .map((phone) => phone.trim())
          .filter(Boolean),
        email: draft.email.trim() || null,
        countryCode: draft.countryCode.trim().toUpperCase() || null,
        logoFileId: profile.data?.logoFileId ?? null,
        logoDataUrl: draft.logoDataUrl || null,
        einvoiceFlags: profile.data?.einvoiceFlags ?? {},
        ...(profile.data ? { version: profile.data.version } : {}),
      });
      setNotice({
        kind: 'ok',
        text: 'تم حفظ بيانات المنشأة، وسيظهر الشعار والعنوان على كل التقارير والفواتير.',
      });
      setEditing(false);
      profile.reload();
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error) });
    } finally {
      setBusy(false);
    }
  };

  const logo = editing ? draft.logoDataUrl : profile.data?.logoDataUrl;

  return (
    <Screen
      title="بطاقة المنشأة"
      subtitle="البيانات القانونية والعنوان الوطني والشعار المطبوعة على الفواتير والتقارير."
      crumbs={['الإعدادات', 'تعاريف المنشأة']}
    >
      <Panel title="حساب المنشأة على المنصة">
        <dl className="kv">
          <dt>اسم المنشأة</dt>
          <dd>{me?.membership.tenantName}</dd>
          <dt>رمز المنشأة</dt>
          <dd dir="ltr">{me?.membership.tenantCode}</dd>
          <dt>دورك</dt>
          <dd>{me?.membership.isOwner ? 'مالك' : 'مستخدم'}</dd>
        </dl>
      </Panel>

      {profile.status === 'loading' && <Loading rows={3} />}
      {profile.status === 'forbidden' && <Forbidden />}
      {profile.status === 'error' && <ErrorBox message={profile.error} onRetry={profile.reload} />}
      {profile.status === 'success' && !editing && (
        <Panel>
          <div className="row">
            <h2>البيانات القانونية</h2>
            {canManage && (
              <button
                type="button"
                className="btn primary"
                onClick={() => {
                  setNotice(undefined);
                  setEditing(true);
                }}
              >
                {profile.data ? 'تعديل البيانات' : 'إضافة بيانات المنشأة'}
              </button>
            )}
          </div>
          {notice && <p className={`alert ${notice.kind}`}>{notice.text}</p>}
          {!profile.data ? (
            <Empty
              title="لم تُسجَّل بيانات المنشأة بعد"
              detail={
                canManage
                  ? 'أضف الاسم القانوني والرقم الضريبي والعنوان الوطني والشعار.'
                  : 'اطلب من مالك المنشأة إدخال بياناتها القانونية.'
              }
            />
          ) : (
            <>
              <div className="company-identity">
                {profile.data.logoDataUrl ? (
                  <img src={profile.data.logoDataUrl} alt="شعار المنشأة" className="company-logo" />
                ) : (
                  <span className="company-logo company-logo-empty" aria-hidden>
                    <Building2 size={26} strokeWidth={1.6} />
                  </span>
                )}
                <div>
                  <strong>{profile.data.nameAr}</strong>
                  {profile.data.nameEn && <p className="muted small">{profile.data.nameEn}</p>}
                  <p className="muted small">
                    {profile.data.logoDataUrl
                      ? 'الشعار مثبّت على الفواتير والتقارير.'
                      : 'لم يُرفع شعار للمنشأة بعد.'}
                  </p>
                </div>
              </div>
              <dl className="kv">
                <dt>{LABELS.nameAr}</dt>
                <dd>{profile.data.nameAr}</dd>
                <dt>{LABELS.nameEn}</dt>
                <dd>{profile.data.nameEn ?? '—'}</dd>
                <dt>{LABELS.taxNo}</dt>
                <dd dir="ltr">{profile.data.taxNo ?? '—'}</dd>
                <dt>{LABELS.crNo}</dt>
                <dd dir="ltr">{profile.data.crNo ?? '—'}</dd>
                <dt>العنوان الوطني</dt>
                <dd>{addressLine(profile.data.address) || '—'}</dd>
                <dt>الهاتف</dt>
                <dd dir="ltr">{profile.data.phones.join('، ') || '—'}</dd>
                <dt>{LABELS.email}</dt>
                <dd dir="ltr">{profile.data.email ?? '—'}</dd>
                <dt>{LABELS.countryCode}</dt>
                <dd dir="ltr">{profile.data.countryCode ?? '—'}</dd>
              </dl>
            </>
          )}
        </Panel>
      )}

      {profile.status === 'success' && editing && canManage && (
        <form className="ui-doc-form" onSubmit={(event) => void save(event)}>
          <Panel title={profile.data ? 'تعديل البيانات القانونية' : 'إضافة بيانات المنشأة'}>
            {notice && <p className={`alert ${notice.kind}`}>{notice.text}</p>}
            <div className="form-grid">
              <label className="field">
                <span>الاسم القانوني (عربي) *</span>
                <input
                  className="input"
                  required
                  maxLength={200}
                  value={draft.nameAr}
                  onChange={(event) => setDraft({ ...draft, nameAr: event.target.value })}
                />
              </label>
              <label className="field">
                <span>الاسم القانوني (إنجليزي)</span>
                <input
                  className="input"
                  maxLength={200}
                  value={draft.nameEn}
                  onChange={(event) => setDraft({ ...draft, nameEn: event.target.value })}
                  dir="auto"
                />
              </label>
              <label className="field">
                <span>الرقم الضريبي</span>
                <input
                  className="input"
                  maxLength={15}
                  inputMode="numeric"
                  value={draft.taxNo}
                  onChange={(event) => setDraft({ ...draft, taxNo: event.target.value })}
                  dir="ltr"
                  placeholder="300000000000003"
                />
                <span className="muted small">١٥ رقماً — يظهر في رأس كل فاتورة وتقرير.</span>
              </label>
              <label className="field">
                <span>السجل التجاري</span>
                <input
                  className="input"
                  maxLength={20}
                  value={draft.crNo}
                  onChange={(event) => setDraft({ ...draft, crNo: event.target.value })}
                  dir="ltr"
                />
              </label>
              <label className="field">
                <span>{LABELS.email}</span>
                <input
                  className="input"
                  type="email"
                  maxLength={320}
                  value={draft.email}
                  onChange={(event) => setDraft({ ...draft, email: event.target.value })}
                  dir="ltr"
                />
              </label>
              <label className="field">
                <span>أرقام الهاتف (افصل بينها بفاصلة)</span>
                <input
                  className="input"
                  value={draft.phones}
                  onChange={(event) => setDraft({ ...draft, phones: event.target.value })}
                  dir="ltr"
                />
              </label>
              <label className="field">
                <span>{LABELS.countryCode}</span>
                <input
                  className="input"
                  maxLength={2}
                  value={draft.countryCode}
                  onChange={(event) => setDraft({ ...draft, countryCode: event.target.value })}
                  dir="ltr"
                />
              </label>
            </div>
          </Panel>

          <Panel title="شعار المنشأة">
            <div className="company-logo-row">
              <div className="company-logo-preview">
                {logo ? (
                  <img src={logo} alt="معاينة شعار المنشأة" />
                ) : (
                  <span className="company-logo-empty">
                    <ImagePlus size={24} strokeWidth={1.6} aria-hidden />
                    <span className="muted small">لا شعار</span>
                  </span>
                )}
              </div>
              <div className="stack-sm">
                <p className="muted small">
                  صورة مربّعة أو أفقية بخلفية فاتحة. تُصغَّر إلى ٥١٢ بكسل وتُحفظ مع الوثيقة، فتظهر في كل
                  الفواتير والتقارير المطبوعة وملفات PDF.
                </p>
                <div className="row">
                  <button
                    type="button"
                    className="btn"
                    disabled={logoBusy || busy}
                    onClick={() => logoInput.current?.click()}
                  >
                    <ImagePlus size={15} aria-hidden />{' '}
                    {logoBusy ? 'جارٍ التجهيز…' : logo ? 'استبدال الشعار' : 'رفع شعار'}
                  </button>
                  {logo && (
                    <button
                      type="button"
                      className="btn"
                      disabled={logoBusy || busy}
                      onClick={() => setDraft((current) => ({ ...current, logoDataUrl: '' }))}
                    >
                      <Trash2 size={15} aria-hidden /> إزالة
                    </button>
                  )}
                </div>
                <input
                  ref={logoInput}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  hidden
                  onChange={(event) => void pickLogo(event.target.files?.[0])}
                />
              </div>
            </div>
          </Panel>

          <Panel title="العنوان الوطني">
            <p className="muted small" style={{ marginTop: 0 }}>
              بيانات العنوان الوطني السعودي — تُطبع في رأس الفواتير والتقارير بجانب اسم المنشأة.
            </p>
            <div className="form-grid">
              {ADDRESS_FIELDS.map((field) => (
                <label
                  className="field"
                  key={field.key}
                  style={field.wide ? { gridColumn: '1 / -1' } : undefined}
                >
                  <span>{field.label}</span>
                  <input
                    className="input"
                    value={draft.address[field.key as keyof Draft['address']] ?? ''}
                    dir={field.dir}
                    onChange={(event) => setAddress(field.key, event.target.value)}
                  />
                  {field.hint && <span className="muted small">{field.hint}</span>}
                </label>
              ))}
            </div>
            <p className="muted small">المعاينة: {addressLine(draft.address) || '—'}</p>
          </Panel>

          <div className="row">
            <button type="submit" className="btn primary" disabled={busy || !draft.nameAr.trim()}>
              {busy ? 'جارٍ الحفظ…' : 'حفظ البيانات'}
            </button>
            <button
              type="button"
              className="btn"
              disabled={busy}
              onClick={() => {
                setNotice(undefined);
                setEditing(false);
                if (profile.data) {
                  setDraft((current) => ({ ...current, logoDataUrl: profile.data?.logoDataUrl ?? '' }));
                }
              }}
            >
              إلغاء
            </button>
          </div>
        </form>
      )}
    </Screen>
  );
}
