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
  type Column,
} from '@erp/ui';
import { apiErrorText, apiList, apiPatch, apiPost } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';

import { listState, rowKeyFrom } from '../../lib/ui-kit';

type UnitRow = Record<string, unknown> & {
  id: string;
  code: string;
  nameAr: string;
};

export default function BakeryUnitsPage() {
  const { can } = useSession();
  const canManage = can('catalog.unit.manage');

  const [rows, setRows] = useState<UnitRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<UnitRow | null>(null);
  const [code, setCode] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await apiList<UnitRow>('/organization/catalog/units');
      setRows(list);
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر قراءة وحدات القياس'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openEditor = (row?: UnitRow) => {
    setEditing(row ?? null);
    setCode(row?.code ?? '');
    setNameAr(row?.nameAr ?? '');
    setModalOpen(true);
  };

  const saveUnit = async () => {
    if (!code.trim() || !nameAr.trim()) return;
    setSaving(true);
    setNotice(null);
    try {
      const body = { code: code.trim(), nameAr: nameAr.trim() };
      if (editing) {
        await apiPatch(`/organization/catalog/units/${encodeURIComponent(editing.id)}`, body);
      } else {
        await apiPost('/organization/catalog/units', body);
      }
      setModalOpen(false);
      setNotice({ tone: 'ok', text: 'تم حفظ وحدة القياس بنجاح.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر حفظ وحدة القياس') });
    } finally {
      setSaving(false);
    }
  };

  const columns: Column<UnitRow>[] = [
    { key: 'code', header: 'الرمز', ltr: true, cell: (r) => r.code },
    { key: 'nameAr', header: 'اسم الوحدة', cell: (r) => r.nameAr },
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
          <h1 className="ui-page-title">وحدات القياس</h1>
          <p className="ui-page-sub">تعريف الوحدات المعتمدة (كيلوجرام، كيس، كرتون، ربطة، حبة) للأصناف والإنتاج.</p>
        </div>
        <div className="ui-page-actions">
          {canManage ? (
            <Button onClick={() => openEditor()} variant="primary">
              + وحدة جديدة
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
          <CardHeader subtitle="تُربط كل بطاقة صنف بوحدتها الأساسية." title="قائمة وحدات القياس" />
          <CardBody>
            <DataTable
              columns={columns}
              empty="لا وحدات قياس مسجلة"
              rows={rows}
              rowKey={rowKeyFrom(['id'])}
              state={listState({ loading, error })}
            />
          </CardBody>
        </Card>
      </div>

      <Modal onClose={() => setModalOpen(false)} open={modalOpen} title={editing ? 'تعديل وحدة قياس' : 'وحدة قياس جديدة'}>
        <div className="grid gap-3">
          <Input label="الرمز (مثل KG أو BAG)" onChange={(e) => setCode(e.target.value)} value={code} />
          <Input label="الاسم بالعربية" onChange={(e) => setNameAr(e.target.value)} value={nameAr} />
          <div className="flex justify-end gap-2">
            <Button onClick={() => setModalOpen(false)} size="sm">
              إلغاء
            </Button>
            <Button disabled={saving || !code.trim() || !nameAr.trim()} onClick={() => void saveUnit()} variant="primary">
              {saving ? 'جارٍ الحفظ…' : 'حفظ'}
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
