'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DataTable,
  Input,
  Modal,
  Select,
  type Column,
} from '@erp/ui';
import { apiErrorText, apiList, apiPatch, apiPost } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';

import { listState, rowKeyFrom } from '../../lib/ui-kit';

type CategoryRow = Record<string, unknown> & {
  id: string;
  code: string;
  nameAr: string;
  parentId?: string | null;
};

export default function BakeryCategoriesPage() {
  const { can } = useSession();
  const canManage = can('catalog.category.manage');

  const [rows, setRows] = useState<CategoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<CategoryRow | null>(null);
  const [code, setCode] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [parentId, setParentId] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await apiList<CategoryRow>('/organization/catalog/categories');
      setRows(list);
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر قراءة فئات الأصناف'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openEditor = (row?: CategoryRow) => {
    setEditing(row ?? null);
    setCode(row?.code ?? '');
    setNameAr(row?.nameAr ?? '');
    setParentId(String(row?.parentId ?? ''));
    setModalOpen(true);
  };

  const saveCategory = async () => {
    if (!code.trim() || !nameAr.trim()) return;
    setSaving(true);
    setNotice(null);
    try {
      const body: Record<string, unknown> = {
        code: code.trim(),
        nameAr: nameAr.trim(),
        ...(parentId ? { parentId } : editing?.parentId ? { parentId: null } : {}),
      };
      if (editing) {
        await apiPatch(`/organization/catalog/categories/${encodeURIComponent(editing.id)}`, body);
      } else {
        await apiPost('/organization/catalog/categories', body);
      }
      setModalOpen(false);
      setNotice({ tone: 'ok', text: 'تم حفظ الفئة بنجاح.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر حفظ الفئة') });
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<CategoryRow>[] = [
    { key: 'code', header: 'الرمز', ltr: true, cell: (r) => r.code },
    { key: 'nameAr', header: 'اسم الفئة', cell: (r) => r.nameAr },
    {
      key: 'parent',
      header: 'الفئة الأب',
      cell: (r) => rows.find((p) => p.id === r.parentId)?.nameAr ?? 'فئة رئيسية',
    },
    {
      key: 'actions',
      header: 'إجراء',
      cell: (r) =>
        canManage ? (
          <Button onClick={() => openEditor(r)} size="sm">
            تعديل
          </Button>
        ) : (
          '—'
        ),
    },
  ];

  return (
    <section className="ui-page">
      <header className="ui-page-head">
        <div className="ui-page-head-copy">
          <h1 className="ui-page-title">فئات ومجموعات الأصناف</h1>
          <p className="ui-page-sub">تصنيف منتجات المخبز والحلويات والمواد الأولية في شجرة فئات منظمة.</p>
        </div>
        <div className="ui-page-actions">
          {canManage ? (
            <Button onClick={() => openEditor()} variant="primary">
              + فئة جديدة
            </Button>
          ) : null}
          <Button onClick={() => void load()} size="sm">
            تحديث
          </Button>
        </div>
      </header>

      <div className="ui-screen-body">
        {notice ? (
          <Card>
            <CardBody>
              <Badge status={notice.tone === 'ok' ? 'active' : 'rejected'}>{notice.text}</Badge>
            </CardBody>
          </Card>
        ) : null}

        <Card>
          <CardHeader subtitle="تظهر هذه الفئات كمرشّحات سريعة في شاشة نقطة البيع والكتالوج." title="فئات الأصناف" />
          <CardBody>
            <DataTable
              columns={columns}
              empty="لا فئات مسجلة"
              rows={rows}
              rowKey={rowKeyFrom(['id'])}
              state={listState({ loading, error })}
            />
          </CardBody>
        </Card>
      </div>

      <Modal onClose={() => setModalOpen(false)} open={modalOpen} title={editing ? 'تعديل فئة' : 'فئة جديدة'}>
        <div className="grid gap-3">
          <Input label="رمز الفئة" onChange={(e) => setCode(e.target.value)} value={code} />
          <Input label="الاسم بالعربية" onChange={(e) => setNameAr(e.target.value)} value={nameAr} />
          <Select
            label="الفئة الأب (اختياري)"
            onChange={(e) => setParentId(e.target.value)}
            options={[
              { value: '', label: 'فئة رئيسية (بدون أب)' },
              ...rows
                .filter((r) => r.id !== editing?.id)
                .map((r) => ({ value: r.id, label: r.nameAr })),
            ]}
            value={parentId}
          />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setModalOpen(false)} size="sm">
              إلغاء
            </Button>
            <Button disabled={saving || !code.trim() || !nameAr.trim()} onClick={() => void saveCategory()} variant="primary">
              {saving ? 'جارٍ الحفظ…' : 'حفظ'}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
