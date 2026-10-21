'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useState } from 'react';
import type {
  PlatformRoleMatrixEntry,
  PlatformSessionView,
  PlatformUserDetailResponse,
} from '@erp/contracts';
import { Panel } from '@erp/ui';

import { Empty, ErrorBox, Loading, Screen } from '../../../components/screen';
import { Table, type Column } from '../../../components/ui/table';
import { ApiError, apiData, apiDelete, apiPost } from '../../../lib/api';
import { useSession } from '../../../lib/session';
import { useQuery } from '../../../lib/use-query';

/**
 * بطاقة المستخدم — `/users/[id]` (P-C3 «الهوية والوصول على المنصة»).
 *
 * The plan asks this card to answer: *his memberships · his roles · his sessions · reset
 * 2FA · revoke sessions*. It does exactly that, and nothing is a picture: every button
 * calls a real endpoint and every table renders a field the API returns —
 * `GET /platform/users/:id` · `POST/DELETE …/:id/roles[/:code]` · `POST …/:id/mfa/reset` ·
 * `DELETE /platform/sessions/:id`.
 *
 * Three rules, learned in P-C2 and kept here:
 *
 *  1. **A destructive act asks for its reason first.** Resetting 2FA and revoking a session
 *     both demand «السبب» before the click; the API refuses a missing one, and the reason
 *     ends up in the audit trail of the person it happened to.
 *  2. **The session is a device, not a row.** A refresh-token *family* is one login on one
 *     device; the card shows the IP and the user agent, because «أيّ جهاز أبطل؟» is the
 *     whole question when an account is suspected.
 *  3. **A revoked role is shown, greyed.** Losing a role is part of the history; hiding it
 *     would make the card look like the grant never existed.
 */

type RoleOption = Pick<PlatformRoleMatrixEntry, 'code' | 'nameAr'>;

const USER_STATUS_AR: Record<string, string> = {
  active: 'نشط',
  invited: 'مدعو',
  suspended: 'موقوف',
  archived: 'مؤرشف',
};

const PLATFORM_ROLE_AR: Record<string, string> = {
  platform_owner: 'مالك المنصة',
  platform_operations: 'تشغيل المنصة',
  platform_billing: 'فوترة المنصة',
  platform_support: 'دعم المنصة',
  platform_auditor: 'مدقّق المنصة',
};

export default function PlatformUserCardPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? '';
  const session = useSession();
  const canManage = session.canConsole('console.users.manage');

  const detail = useQuery<PlatformUserDetailResponse>(
    () => apiData<PlatformUserDetailResponse>(`/platform/users/${id}`),
    [id],
  );
  const roles = useQuery<RoleOption[]>(() => apiData<RoleOption[]>('/platform/roles'));
  const sessions = useQuery<PlatformSessionView[]>(
    () => apiData<PlatformUserDetailResponse>(`/platform/users/${id}`).then((payload) => payload.sessions),
    [id],
  );

  const [busy, setBusy] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [notice, setNotice] = useState<string | undefined>();
  const [grantRole, setGrantRole] = useState('platform_operations');
  const [mfaReason, setMfaReason] = useState('');
  const [revokeReasons, setRevokeReasons] = useState<Record<string, string>>({});

  async function run(key: string, action: () => Promise<void>) {
    setBusy(key);
    setError(undefined);
    setNotice(undefined);
    try {
      await action();
      await detail.reload();
      await sessions.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'تعذّر تنفيذ العملية');
    } finally {
      setBusy(undefined);
    }
  }

  const data = detail.data;
  const catalogue = roles.data ?? [];
  const activeRoles = data?.platformRoles ?? [];
  const revokedRoles = data?.revokedPlatformRoles ?? [];
  const openSessions = (sessions.data ?? []).filter((entry) => !entry.revoked);
  const closedSessions = (sessions.data ?? []).filter((entry) => entry.revoked);

  const membershipColumns: Array<Column<PlatformUserDetailResponse['memberships'][number]>> = [
    {
      key: 'tenant',
      header: 'المنشأة',
      grow: true,
      cell: (member) => (
        <>
          <Link href={`/tenants/${member.tenantId}`}>{member.tenantName}</Link>
          {member.isOwner && (
            <span className="tag tenant" style={{ marginInlineStart: 6 }}>
              مالك
            </span>
          )}
        </>
      ),
    },
    { key: 'code', header: 'الرمز', ltr: true, cell: (member) => member.tenantCode },
    { key: 'display', header: 'الاسم داخلها', cell: (member) => member.displayName },
    {
      key: 'memberStatus',
      header: 'حالة العضوية',
      cell: (member) => (
        <span className={`badge ${member.status}`}>{USER_STATUS_AR[member.status] ?? member.status}</span>
      ),
    },
    {
      key: 'tenantStatus',
      header: 'حالة المنشأة',
      cell: (member) => (
        <span className={`badge ${member.tenantStatus}`}>
          {USER_STATUS_AR[member.tenantStatus] ?? member.tenantStatus}
        </span>
      ),
    },
    {
      key: 'joined',
      header: 'الانضمام',
      ltr: true,
      cell: (member) => new Date(member.createdAt).toLocaleString('ar-SA-u-ca-gregory-nu-latn'),
    },
  ];

  const sessionColumns: Array<Column<PlatformSessionView>> = [
    {
      key: 'device',
      header: 'الجهاز',
      cell: (entry) => (
        <span style={{ display: 'inline-block', maxWidth: 240 }} title={entry.userAgent ?? ''}>
          {entry.userAgent ? entry.userAgent.slice(0, 48) : '— غير معروف'}
        </span>
      ),
    },
    { key: 'ip', header: 'الآيبي', ltr: true, cell: (entry) => entry.ip ?? '—' },
    { key: 'tenant', header: 'المنشأة', cell: (entry) => entry.tenantCode ?? 'منصة' },
    {
      key: 'started',
      header: 'بدأت',
      ltr: true,
      cell: (entry) => new Date(entry.createdAt).toLocaleString('ar-SA-u-ca-gregory-nu-latn'),
    },
    {
      key: 'seen',
      header: 'آخر ظهور',
      ltr: true,
      cell: (entry) => new Date(entry.lastSeenAt).toLocaleString('ar-SA-u-ca-gregory-nu-latn'),
    },
    {
      key: 'expires',
      header: 'تنتهي',
      ltr: true,
      cell: (entry) => new Date(entry.expiresAt).toLocaleString('ar-SA-u-ca-gregory-nu-latn'),
    },
    { key: 'rotations', header: 'تدويرات', numeric: true, cell: (entry) => entry.rotationCount },
    {
      key: 'revoke',
      header: 'السبب والإبطال',
      cell: (entry) =>
        canManage ? (
          <div className="row" style={{ gap: 6 }}>
            <input
              className="input"
              style={{ maxWidth: 200 }}
              placeholder="السبب (٣ أحرف)"
              value={revokeReasons[entry.id] ?? ''}
              onChange={(event) => setRevokeReasons({ ...revokeReasons, [entry.id]: event.target.value })}
            />
            <button
              className="btn danger"
              type="button"
              disabled={busy === `session:${entry.id}` || (revokeReasons[entry.id] ?? '').trim().length < 3}
              onClick={() =>
                run(`session:${entry.id}`, async () => {
                  await apiDelete(
                    `/platform/sessions/${entry.id}?reason=${encodeURIComponent((revokeReasons[entry.id] ?? '').trim())}`,
                  );
                  setNotice('أُبطلت الجلسة.');
                })
              }
            >
              إبطال
            </button>
          </div>
        ) : (
          '—'
        ),
    },
  ];

  const closedColumns: Array<Column<PlatformSessionView>> = [
    {
      key: 'device',
      header: 'الجهاز',
      grow: true,
      cell: (entry) => (entry.userAgent ? entry.userAgent.slice(0, 48) : '—'),
    },
    { key: 'ip', header: 'الآيبي', ltr: true, cell: (entry) => entry.ip ?? '—' },
    {
      key: 'seen',
      header: 'آخر ظهور',
      ltr: true,
      cell: (entry) => new Date(entry.lastSeenAt).toLocaleString('ar-SA-u-ca-gregory-nu-latn'),
    },
    {
      key: 'revoked',
      header: 'أُبطلت',
      ltr: true,
      cell: (entry) =>
        entry.revokedAt ? new Date(entry.revokedAt).toLocaleString('ar-SA-u-ca-gregory-nu-latn') : '—',
    },
  ];

  return (
    <Screen
      title={data ? data.user.fullName : 'بطاقة مستخدم'}
      subtitle={data ? data.user.email : '—'}
      crumbs={['المنصة', 'المستخدمون']}
    >
      <p className="no-print">
        <Link href="/users">عودة إلى المستخدمين</Link>
      </p>

      {detail.status === 'loading' && <Loading />}
      {detail.status === 'error' && <ErrorBox message={detail.error} onRetry={detail.reload} />}
      {error && <p className="alert danger">{error}</p>}
      {notice && <p className="alert ok">{notice}</p>}

      {data && (
        <>
          <Panel title="التعرّف">
            <div className="grid cols">
              <div>
                <div className="muted">الحالة</div>
                <div>
                  <span className={`badge ${data.user.status}`}>
                    {USER_STATUS_AR[data.user.status] ?? data.user.status}
                  </span>
                  {data.user.mustChangePassword && (
                    <span className="badge pending" style={{ marginInlineStart: 4 }}>
                      تغيير كلمة المرور
                    </span>
                  )}
                </div>
              </div>
              <div>
                <div className="muted">البريد</div>
                <div dir="ltr">{data.user.email}</div>
              </div>
              <div>
                <div className="muted">الجوال</div>
                <div dir="ltr">{data.user.phone ?? '—'}</div>
              </div>
              <div>
                <div className="muted">آخر دخول</div>
                <div dir="ltr">
                  {data.user.lastLoginAt
                    ? new Date(data.user.lastLoginAt).toLocaleString('ar-SA-u-ca-gregory-nu-latn')
                    : '—'}
                </div>
              </div>
              <div>
                <div className="muted">أُنشئ في</div>
                <div dir="ltr">
                  {new Date(data.user.createdAt).toLocaleString('ar-SA-u-ca-gregory-nu-latn')}
                </div>
              </div>
              <div>
                <div className="muted">مقفول حتى</div>
                <div dir="ltr">
                  {data.user.lockedUntil
                    ? new Date(data.user.lockedUntil).toLocaleString('ar-SA-u-ca-gregory-nu-latn')
                    : '—'}
                </div>
              </div>
            </div>
          </Panel>

          <Panel
            title="أدوار المنصة"
            hint={
              <>
                الأدوار تحدّد ما يستطيع هذا الحساب فعله في اللوحة. صفوف الأدوار المسحوبة تبقى ظاهرة باهتة —
                تاريخ المنح جزء من الصورة.
              </>
            }
          >
            <div>
              {activeRoles.length === 0 && <span className="muted">لا دور فعّال</span>}
              {activeRoles.map((code) => (
                <span key={code} className="badge active" style={{ marginInlineEnd: 6 }}>
                  <span>{PLATFORM_ROLE_AR[code] ?? code}</span>
                  {canManage && (
                    <button
                      className="btn sm"
                      type="button"
                      style={{ marginInlineStart: 6 }}
                      disabled={busy === `revoke:${code}`}
                      onClick={() =>
                        run(`revoke:${code}`, async () => {
                          await apiDelete(`/platform/users/${id}/roles/${code}`);
                        })
                      }
                    >
                      سحب
                    </button>
                  )}
                </span>
              ))}
              {revokedRoles.map((code) => (
                <span key={`revoked:${code}`} className="badge" style={{ marginInlineEnd: 6, opacity: 0.55 }}>
                  <span>{PLATFORM_ROLE_AR[code] ?? code}</span>
                </span>
              ))}
            </div>
            {canManage && (
              <div className="row" style={{ marginTop: 12 }}>
                <select
                  className="input"
                  style={{ maxWidth: 240 }}
                  value={grantRole}
                  onChange={(event) => setGrantRole(event.target.value)}
                >
                  {catalogue.map((role) => (
                    <option key={role.code} value={role.code}>
                      {role.nameAr}
                    </option>
                  ))}
                </select>
                <button
                  className="btn primary"
                  type="button"
                  disabled={busy === 'grant'}
                  onClick={() =>
                    run('grant', async () => {
                      await apiPost(`/platform/users/${id}/roles`, { roleCode: grantRole });
                    })
                  }
                >
                  منح الدور
                </button>
              </div>
            )}
          </Panel>

          <Panel title="العضويات" flush>
            {data.memberships.length === 0 ? (
              <Empty title="لا عضويات" detail="حساب منصة بحت — لا ينتمي إلى أي منشأة." />
            ) : (
              <Table
                bare
                columns={membershipColumns}
                rows={data.memberships}
                rowKey={(member) => member.id}
              />
            )}
          </Panel>

          <Panel
            title="الجلسات"
            hint={
              <>
                الجلسة هنا **جهاز واحد**: عائلة دوران توكن التجديد. إبطال الجلسة ينفّذ خروجًا فوريًّا على ذلك
                الجهاز.
              </>
            }
            flush
          >
            {openSessions.length === 0 ? (
              <Empty title="لا جلسات مفتوحة" />
            ) : (
              <Table bare columns={sessionColumns} rows={openSessions} rowKey={(entry) => entry.id} />
            )}

            {canManage && openSessions.length > 1 && (
              <div className="row" style={{ marginTop: 12 }}>
                <input
                  className="input"
                  style={{ maxWidth: 240 }}
                  placeholder="سبب إبطال كل الجلسات"
                  value={revokeReasons.all ?? ''}
                  onChange={(event) => setRevokeReasons({ ...revokeReasons, all: event.target.value })}
                />
                <button
                  className="btn danger"
                  type="button"
                  disabled={busy === 'sessions:all' || (revokeReasons.all ?? '').trim().length < 3}
                  onClick={() =>
                    run('sessions:all', async () => {
                      const reason = (revokeReasons.all ?? '').trim();
                      for (const entry of openSessions) {
                        // One reason, one act per device: the audit trail stays per-session.
                        await apiDelete(
                          `/platform/sessions/${entry.id}?reason=${encodeURIComponent(reason)}`,
                        );
                      }
                      setNotice(`أُبطلت ${openSessions.length} جلسة.`);
                    })
                  }
                >
                  إبطال كل الجلسات
                </button>
              </div>
            )}

            {closedSessions.length > 0 && (
              <details style={{ marginTop: 12 }}>
                <summary className="muted">جلسات مُبطَلة ({closedSessions.length})</summary>
                <Table bare columns={closedColumns} rows={closedSessions} rowKey={(entry) => entry.id} />
              </details>
            )}
          </Panel>

          <Panel title="التحقّق بخطوتين (2FA)">
            <p>
              الحالة:{' '}
              {data.user.mfaEnabled ? (
                <span className="tag platform">مُفعَّلة</span>
              ) : data.user.mfaEnrolled ? (
                <span className="tag default">مُسجَّلة ولم تُفعَّل</span>
              ) : (
                <span className="tag default">غير مُفعَّلة</span>
              )}
            </p>
            {canManage ? (
              <div className="row" style={{ gap: 6 }}>
                <input
                  className="input"
                  style={{ maxWidth: 240 }}
                  placeholder="سبب إعادة التعيين"
                  value={mfaReason}
                  onChange={(event) => setMfaReason(event.target.value)}
                />
                <button
                  className="btn danger"
                  type="button"
                  disabled={busy === 'mfa' || mfaReason.trim().length < 3}
                  onClick={() =>
                    run('mfa', async () => {
                      const result = await apiPost<{ hadMfa: boolean }>(`/platform/users/${id}/mfa/reset`, {
                        reason: mfaReason.trim(),
                      });
                      setNotice(
                        result.hadMfa
                          ? 'أُعيد تعيين 2FA وسيُطلب من المستخدم تسجيلها من جديد.'
                          : 'لم يكن على الحساب 2FA فعّالة — سُجّل الفعل في التدقيق.',
                      );
                      setMfaReason('');
                    })
                  }
                >
                  إعادة تعيين 2FA
                </button>
              </div>
            ) : (
              <p className="muted">قراءة فقط — تحتاج `console.users.manage` لإعادة التعيين.</p>
            )}
          </Panel>
        </>
      )}
    </Screen>
  );
}
