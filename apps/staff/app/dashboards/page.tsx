'use client';

import { Panel } from '@erp/ui';
import Link from 'next/link';
import { Plus, Star, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { Screen } from '../../components/screen';
import {
  createDashboard,
  deleteDashboard,
  listDashboards,
  setDefaultDashboard,
  type DashboardSummary,
} from '../../lib/bi-dashboards';
import { useSession } from '../../lib/session';

export default function DashboardsPage() {
  const { can } = useSession();
  const [boards, setBoards] = useState<DashboardSummary[]>([]);
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const manage = can('dashboards.manage');

  async function reload() {
    setBoards(await listDashboards());
  }

  useEffect(() => {
    reload()
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'تعذر تحميل اللوحات'))
      .finally(() => setLoading(false));
  }, []);

  async function create() {
    setError('');
    try {
      await createDashboard(name.trim() || 'لوحة جديدة');
      setName('');
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر إنشاء اللوحة');
    }
  }

  async function makeDefault(id: string) {
    setError('');
    try {
      await setDefaultDashboard(id);
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر تعيين اللوحة');
    }
  }

  async function remove(id: string) {
    setError('');
    try {
      await deleteDashboard(id);
      await reload();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'تعذر حذف اللوحة');
    }
  }

  return (
    <Screen
      title="لوحات المؤشرات"
      subtitle="لوحة شخصية لكل مستخدم تُبنى من كتالوج المؤشرات، وتُحفظ تلقائياً."
      crumbs={['لوحات المؤشرات']}
    >
      {error ? (
        <p className="m-0 rounded-xl border border-danger-line bg-danger-soft px-3 py-2 text-[13px] text-danger-ink">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-[13px] text-muted">جاري التحميل…</p>
      ) : boards.length === 0 ? (
        <Panel title="اللوحات">
          <p className="m-0 text-sm text-muted">لا توجد لوحات بعد — أنشئ لوحة من الشريط أعلاه.</p>
        </Panel>
      ) : (
        <Panel flush title="لوحاتي" hint={`${boards.length} لوحة`}>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>اللوحة</th>
                  <th>المؤشرات</th>
                  <th>الحالة</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {boards.map((board) => (
                  <tr key={board.id}>
                    <td className="font-semibold">
                      <Link className="text-brand-700 hover:underline" href={`/dashboards/${board.id}`}>
                        {board.name}
                      </Link>
                    </td>
                    <td>{board.widgetCount}</td>
                    <td>
                      {board.isDefault ? (
                        <span className="badge ok">افتراضية</span>
                      ) : (
                        <span className="text-muted">—</span>
                      )}
                    </td>
                    <td>
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Link href={`/dashboards/${board.id}`} className="btn primary">
                          فتح
                        </Link>
                        {manage && !board.isDefault ? (
                          <button type="button" className="btn" onClick={() => void makeDefault(board.id)}>
                            <Star size={14} aria-hidden /> اجعلها افتراضية
                          </button>
                        ) : null}
                        {manage && boards.length > 1 ? (
                          <button type="button" className="btn danger" onClick={() => void remove(board.id)}>
                            <Trash2 size={14} aria-hidden /> حذف
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      {manage ? (
        <Panel title="لوحة جديدة" hint="تُحفظ اللوحة فارغة ثم تُبنى من كتالوج المؤشرات.">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <label className="field" style={{ flex: '1 1 260px' }}>
              <span>اسم اللوحة</span>
              <input className="input" value={name} onChange={(event) => setName(event.target.value)} />
            </label>
            <button type="submit" className="btn primary">
              <Plus size={16} aria-hidden />
              إنشاء
            </button>
          </form>
        </Panel>
      ) : null}
    </Screen>
  );
}
