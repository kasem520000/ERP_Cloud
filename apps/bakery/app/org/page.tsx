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
  SegmentedTabs,
  Select,
  type Column,
} from '@erp/ui';
import { apiData, apiErrorText, apiList, apiPatch, apiPost } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';

import { listState, rowKeyFrom } from '../../lib/ui-kit';

type BranchRow = Record<string, unknown> & {
  id: string;
  code: string;
  nameAr: string;
  isDefault?: boolean;
  isActive?: boolean;
};

type WarehouseRow = Record<string, unknown> & {
  id: string;
  code: string;
  name: string;
  branchId?: string | null;
  isDefault?: boolean;
  isActive?: boolean;
};

export default function BakeryOrgPage() {
  const { can } = useSession();
  const canBranch = can('organization.branch.manage');
  const canWarehouse = can('organization.warehouse.manage');

  const [tab, setTab] = useState<'branches' | 'warehouses' | 'company'>('branches');
  const [branches, setBranches] = useState<BranchRow[]>([]);
  const [warehouses, setWarehouses] = useState<WarehouseRow[]>([]);
  const [company, setCompany] = useState<{ nameAr?: string; taxNo?: string; phone?: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const [branchModal, setBranchModal] = useState(false);
  const [editingBranch, setEditingBranch] = useState<BranchRow | null>(null);
  const [brCode, setBrCode] = useState('');
  const [brNameAr, setBrNameAr] = useState('');
  const [brDefault, setBrDefault] = useState(false);
  const [brActive, setBrActive] = useState(true);

  const [whModal, setWhModal] = useState(false);
  const [editingWh, setEditingWh] = useState<WarehouseRow | null>(null);
  const [whCode, setWhCode] = useState('');
  const [whName, setWhName] = useState('المستودع الرئيسي');
  const [whBranchId, setWhBranchId] = useState('');
  const [whDefault, setWhDefault] = useState(false);
  const [whActive, setWhActive] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [br, wh, cp] = await Promise.all([
        apiList<BranchRow>('/branches'),
        apiList<WarehouseRow>('/warehouses'),
        apiData<{ nameAr?: string; taxNo?: string; phone?: string }>('/company-profile').catch(() => null),
      ]);
      setBranches(br);
      setWarehouses(wh);
      setCompany(cp);
      setWhBranchId((prev) => prev || br[0]?.id || '');
    } catch (caught) {
      setError(apiErrorText(caught, 'تعذّر قراءة الفروع والمستودعات'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveBranch = async () => {
    if (!brNameAr.trim() || (!editingBranch && !brCode.trim())) return;
    setSaving(true);
    setNotice(null);
    try {
      if (editingBranch) {
        await apiPatch(`/branches/${encodeURIComponent(editingBranch.id)}`, {
          nameAr: brNameAr.trim(),
          isDefault: brDefault,
          isActive: brActive,
        });
      } else {
        await apiPost('/branches', {
          code: brCode.trim(),
          nameAr: brNameAr.trim(),
          isDefault: brDefault,
        });
      }
      setBranchModal(false);
      setNotice({ tone: 'ok', text: 'تم حفظ بيانات الفرع بنجاح.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر حفظ الفرع') });
    } finally {
      setSaving(false);
    }
  };

  const saveWarehouse = async () => {
    if (!whName.trim() || (!editingWh && !whCode.trim())) return;
    setSaving(true);
    setNotice(null);
    try {
      if (editingWh) {
        await apiPatch(`/warehouses/${encodeURIComponent(editingWh.id)}`, {
          name: whName.trim(),
          ...(whBranchId ? { branchId: whBranchId } : {}),
          isDefault: whDefault,
          isActive: whActive,
        });
      } else {
        await apiPost('/warehouses', {
          code: whCode.trim(),
          name: whName.trim(),
          ...(whBranchId ? { branchId: whBranchId } : {}),
          isDefault: whDefault,
        });
      }
      setWhModal(false);
      setNotice({ tone: 'ok', text: 'تم حفظ بيانات المستودع بنجاح.' });
      await load();
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر حفظ المستودع') });
    } finally {
      setSaving(false);
    }
  };

  const branchCols: Column<BranchRow>[] = [
    { key: 'code', header: 'الرمز', ltr: true, cell: (r) => r.code },
    { key: 'nameAr', header: 'اسم الفرع', cell: (r) => r.nameAr },
    {
      key: 'default',
      header: 'افتراضي',
      cell: (r) => <Badge status={r.isDefault ? 'active' : 'pending'}>{r.isDefault ? 'افتراضي' : 'فرعي'}</Badge>,
    },
    {
      key: 'edit',
      header: 'إجراء',
      cell: (r) =>
        canBranch ? (
          <Button
            onClick={() => {
              setEditingBranch(r);
              setBrCode(r.code);
              setBrNameAr(r.nameAr);
              setBrDefault(Boolean(r.isDefault));
              setBrActive(r.isActive !== false);
              setBranchModal(true);
            }}
            size="sm"
          >
            تعديل
          </Button>
        ) : (
          '—'
        ),
    },
  ];

  const whCols: Column<WarehouseRow>[] = [
    { key: 'code', header: 'الرمز', ltr: true, cell: (r) => r.code },
    {
      key: 'name',
      header: 'اسم المستودع',
      cell: (r) => (r.name === 'Main Warehouse' ? 'المستودع الرئيسي' : r.name),
    },
    {
      key: 'branch',
      header: 'الفرع',
      cell: (r) => branches.find((b) => b.id === r.branchId)?.nameAr ?? '—',
    },
    {
      key: 'edit',
      header: 'إجراء',
      cell: (r) =>
        canWarehouse ? (
          <Button
            onClick={() => {
              setEditingWh(r);
              setWhCode(r.code);
              setWhName(r.name === 'Main Warehouse' ? 'المستودع الرئيسي' : r.name);
              setWhBranchId(String(r.branchId ?? branches[0]?.id ?? ''));
              setWhDefault(Boolean(r.isDefault));
              setWhActive(r.isActive !== false);
              setWhModal(true);
            }}
            size="sm"
          >
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
          <h1 className="ui-page-title">هيكل المنشأة والفروع والمستودعات</h1>
          <p className="ui-page-sub">
            إدارة فروع المخبز والمستودع الرئيسي ومستودعات سيارات التوزيع وبيانات ملف المنشأة الضريبي.
          </p>
        </div>
        <div className="ui-page-actions">
          {tab === 'branches' && canBranch ? (
            <Button
              onClick={() => {
                setEditingBranch(null);
                setBrCode('');
                setBrNameAr('');
                setBrDefault(false);
                setBrActive(true);
                setBranchModal(true);
              }}
              variant="primary"
            >
              + فرع جديد
            </Button>
          ) : null}
          {tab === 'warehouses' && canWarehouse ? (
            <Button
              onClick={() => {
                setEditingWh(null);
                setWhCode('');
                setWhName('');
                setWhDefault(false);
                setWhActive(true);
                setWhModal(true);
              }}
              variant="primary"
            >
              + مستودع جديد
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

        <SegmentedTabs
          onChange={(next) => setTab(next as typeof tab)}
          items={[
            { key: 'branches', label: `الفروع (${branches.length})` },
            { key: 'warehouses', label: `المستودعات (${warehouses.length})` },
            { key: 'company', label: 'ملف المنشأة الضريبي' },
          ]}
          value={tab}
        />

        <Card>
          <CardHeader subtitle="الهيكل التنظيمي المعتمد للمنشأة." title={tab === 'branches' ? 'قائمة الفروع' : tab === 'warehouses' ? 'قائمة المستودعات' : 'هوية المنشأة'} />
          <CardBody>
            {tab === 'branches' ? (
              <DataTable
                columns={branchCols}
                empty="لا فروع مسجلة"
                rows={branches}
                rowKey={rowKeyFrom(['id'])}
                state={listState({ loading, error })}
              />
            ) : tab === 'warehouses' ? (
              <DataTable
                columns={whCols}
                empty="لا مستودعات مسجلة"
                rows={warehouses}
                rowKey={rowKeyFrom(['id'])}
                state={listState({ loading, error })}
              />
            ) : (
              <div className="grid gap-2 text-[13.5px]">
                <div>
                  اسم المنشأة: <strong>{company?.nameAr ?? '—'}</strong>
                </div>
                <div>
                  الرقم الضريبي: <strong dir="ltr">{company?.taxNo ?? '—'}</strong>
                </div>
                <div>
                  الهاتف: <strong dir="ltr">{company?.phone ?? '—'}</strong>
                </div>
                <div>
                  المنطقة الزمنية المعتمدة: <strong>توقيت مكة المكرمة (Asia/Riyadh)</strong>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <Modal onClose={() => setBranchModal(false)} open={branchModal} title={editingBranch ? 'تعديل فرع' : 'فرع جديد'}>
        <div className="grid gap-3">
          {!editingBranch ? <Input label="رمز الفرع" onChange={(e) => setBrCode(e.target.value)} value={brCode} /> : null}
          <Input label="اسم الفرع بالعربية" onChange={(e) => setBrNameAr(e.target.value)} value={brNameAr} />
          <label className="flex items-center gap-2 text-[12.5px] font-semibold">
            <input checked={brDefault} onChange={(e) => setBrDefault(e.target.checked)} type="checkbox" />
            تعيين كفرع افتراضي
          </label>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setBranchModal(false)} size="sm">
              إلغاء
            </Button>
            <Button disabled={saving} onClick={() => void saveBranch()} variant="primary">
              حفظ
            </Button>
          </div>
        </div>
      </Modal>

      <Modal onClose={() => setWhModal(false)} open={whModal} title={editingWh ? 'تعديل مستودع' : 'مستودع جديد'}>
        <div className="grid gap-3">
          {!editingWh ? <Input label="رمز المستودع" onChange={(e) => setWhCode(e.target.value)} value={whCode} /> : null}
          <Input label="اسم المستودع بالعربية" onChange={(e) => setWhName(e.target.value)} value={whName} />
          <Select
            label="الفرع التابع له"
            onChange={(e) => setWhBranchId(e.target.value)}
            options={branches.map((b) => ({ value: b.id, label: b.nameAr }))}
            value={whBranchId}
          />
          <label className="flex items-center gap-2 text-[12.5px] font-semibold">
            <input checked={whDefault} onChange={(e) => setWhDefault(e.target.checked)} type="checkbox" />
            تعيين كمستودع افتراضي
          </label>
          <div className="flex justify-end gap-2">
            <Button onClick={() => setWhModal(false)} size="sm">
              إلغاء
            </Button>
            <Button disabled={saving} onClick={() => void saveWarehouse()} variant="primary">
              حفظ
            </Button>
          </div>
        </div>
      </Modal>
    </section>
  );
}
