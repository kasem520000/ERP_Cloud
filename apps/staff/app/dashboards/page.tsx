'use client';

import Link from 'next/link';
import { Plus, Star, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';

import { createDashboard, deleteDashboard, listDashboards, setDefaultDashboard, type DashboardSummary } from '../../lib/bi-dashboards';
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
    <div className="grid gap-5">
      <header className="page-head">
        <div className="page-head-copy">
          <nav className="crumbs" aria-label="مسار الصفحة">
            <span>لوحات المؤشرات</span>
          </nav>
          <h1 className="page-head-title">لوحات المؤشرات</h1>
          <p className="page-head-sub">لوحة شخصية لكل مستخدم تُبنى من كتالوج المؤشرات، وتُحفظ تلقائياً.</p>
        </div>
      </header>

      {error ? <p className="m-0 rounded-xl border border-danger-line bg-danger-soft px-3 py-2 text-[13px] text-danger-ink">{error}</p> : null}

      {manage ? (
        <form
          className="toolbar panel"
          style={{ padding: 'var(--space-3)' }}
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <input
            className="input"
            style={{ flex: '1 1 260px' }}
            placeholder="اسم اللوحة الجديدة"
            aria-label="اسم اللوحة الجديدة"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" className="btn primary">
            <Plus size={16} aria-hidden />
            لوحة جديدة
          </button>
        </form>
      ) : null}

      {loading ? <p className="text-[13px] text-muted">جاري التحميل…</p> : null}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {boards.map((board) => (
          <article key={board.id} className="panel">
            <div className="panel-head">
              <div>
                <h2>{board.name}</h2>
                <p>{board.widgetCount} مؤشرات</p>
              </div>
              {board.isDefault ? <span className="badge ok">افتراضية</span> : null}
            </div>
            <div className="toolbar" style={{ padding: '0 var(--space-4) var(--space-4)' }}>
              <Link href={`/dashboards/${board.id}`} className="btn primary">
                فتح
              </Link>
              {manage && !board.isDefault ? (
                <button type="button" className="btn" onClick={() => void makeDefault(board.id)}>
                  <Star size={14} aria-hidden />
                  اجعلها افتراضية
                </button>
              ) : null}
              {manage && boards.length > 1 ? (
                <button type="button" className="btn danger" onClick={() => void remove(board.id)}>
                  <Trash2 size={14} aria-hidden />
                  حذف
                </button>
              ) : null}
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
