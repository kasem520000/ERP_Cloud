'use client';

import { FormActions, FormGrid, Panel } from '@erp/ui';
import { useEffect, useState } from 'react';

import { Notice } from '../../../components/data-view';
import { Forbidden, Screen } from '../../../components/screen';
import { apiErrorText, apiList } from '../../../lib/api';
import {
  deactivateApprovalWorkflow,
  listApprovalWorkflows,
  saveApprovalWorkflow,
  type ApprovalCondition,
  type ApprovalEntity,
  type ApprovalStep,
  type ApprovalWorkflow,
  type ApprovalWorkflowInput,
} from '../../../lib/approvals';
import { listBranches, listCostCenters } from '../../../lib/lookups';
import { useSession } from '../../../lib/session';
import { useQuery } from '../../../lib/use-query';

const entityLabels: Record<ApprovalEntity, string> = {
  sales_invoice: 'فاتورة مبيعات',
  purchase_invoice: 'فاتورة مشتريات',
  voucher: 'سند خزينة',
  expense: 'مصروف',
  leave: 'إجازة',
};

type NoticeState = { kind: 'ok' | 'danger' | 'info' | 'warn'; text: string };
type RoleOption = { id: string; name: string };
type MembershipOption = { id: string; userId?: string; displayName: string; status?: string };
type DraftStep = {
  approver_role: string;
  approver_user_id: string;
  min_amount: string;
  max_amount: string;
  branch_id: string;
  cost_center_id: string;
  action: 'approve' | 'notify';
};

const emptyStep = (): DraftStep => ({
  approver_role: '',
  approver_user_id: '',
  min_amount: '',
  max_amount: '',
  branch_id: '',
  cost_center_id: '',
  action: 'approve',
});

function stepToDraft(step: ApprovalStep): DraftStep {
  return {
    approver_role: step.approverRole ?? '',
    approver_user_id: step.approverUserId ?? '',
    min_amount: step.condition.min_amount === undefined ? '' : String(step.condition.min_amount),
    max_amount: step.condition.max_amount === undefined ? '' : String(step.condition.max_amount),
    branch_id: step.condition.branch_id ?? '',
    cost_center_id: step.condition.cost_center_id ?? '',
    action: step.action,
  };
}

export default function ApprovalSettingsPage() {
  const { can } = useSession();
  const [workflows, setWorkflows] = useState<ApprovalWorkflow[]>([]);
  const [editingId, setEditingId] = useState<string | undefined>();
  const [entity, setEntity] = useState<ApprovalEntity>('purchase_invoice');
  const [name, setName] = useState('');
  const [active, setActive] = useState(true);
  const [steps, setSteps] = useState<DraftStep[]>([emptyStep()]);
  const [notice, setNotice] = useState<NoticeState>();
  const [busy, setBusy] = useState(false);
  const roles = useQuery<RoleOption[]>(() => apiList('/memberships/assignable-roles'), []);
  const members = useQuery<MembershipOption[]>(() => apiList('/memberships'), []);
  const branches = useQuery(listBranches, []);
  const costCenters = useQuery(listCostCenters, []);

  const reload = async (): Promise<void> => setWorkflows(await listApprovalWorkflows());

  useEffect(() => {
    void reload().catch((error: unknown) => setNotice({ kind: 'danger', text: apiErrorText(error) }));
  }, []);

  if (!can('approval.manage')) {
    return (
      <Screen
        title="مسارات الموافقات"
        subtitle="إدارة التسلسل والشروط لكل مستند."
        crumbs={['الإعدادات', 'الموافقات']}
      >
        <Forbidden />
      </Screen>
    );
  }

  const reset = (): void => {
    setEditingId(undefined);
    setEntity('purchase_invoice');
    setName('');
    setActive(true);
    setSteps([emptyStep()]);
  };

  const edit = (workflow: ApprovalWorkflow): void => {
    setEditingId(workflow.id);
    setEntity(workflow.entity);
    setName(workflow.name);
    setActive(workflow.isActive);
    setSteps(workflow.steps.map(stepToDraft));
    setNotice(undefined);
  };

  const updateStep = (index: number, patch: Partial<DraftStep>): void =>
    setSteps((current) =>
      current.map((step, stepIndex) => (stepIndex === index ? { ...step, ...patch } : step)),
    );

  const buildInput = (): ApprovalWorkflowInput => ({
    entity,
    name: name.trim(),
    is_active: active,
    steps: steps.map((step, index) => {
      const condition: ApprovalCondition = {};
      if (step.min_amount.trim()) condition.min_amount = step.min_amount.trim();
      if (step.max_amount.trim()) condition.max_amount = step.max_amount.trim();
      if (step.branch_id.trim()) condition.branch_id = step.branch_id.trim();
      if (step.cost_center_id.trim()) condition.cost_center_id = step.cost_center_id.trim();
      return {
        step_order: index + 1,
        ...(step.approver_role.trim() ? { approver_role: step.approver_role.trim() } : {}),
        ...(step.approver_user_id.trim() ? { approver_user_id: step.approver_user_id.trim() } : {}),
        condition,
        action: step.action,
        is_required: true,
      };
    }),
  });

  const save = async (): Promise<void> => {
    setBusy(true);
    setNotice(undefined);
    try {
      await saveApprovalWorkflow(buildInput(), editingId);
      await reload();
      reset();
      setNotice({ kind: 'ok', text: 'تم حفظ مسار الموافقات.' });
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error) });
    } finally {
      setBusy(false);
    }
  };

  const deactivate = async (workflow: ApprovalWorkflow): Promise<void> => {
    setBusy(true);
    try {
      await deactivateApprovalWorkflow(workflow.id);
      await reload();
      setNotice({ kind: 'ok', text: 'تم إيقاف المسار مع إبقاء سجله.' });
    } catch (error) {
      setNotice({ kind: 'danger', text: apiErrorText(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="مسارات الموافقات"
      subtitle="قائمة خطوات مرتبة: عندما ينطبق الشرط، يتوقف الترحيل حتى يقرر المراجع الحالي."
      crumbs={['الإعدادات', 'الموافقات']}
      actions={<span className="chip">{workflows.length} مسار</span>}
    >
      <Notice notice={notice} />

      <Panel
        title={editingId ? 'تعديل مسار' : 'مسار جديد'}
        hint="لا توجد موافقات متوازية؛ التنفيذ متسلسل من الأعلى إلى الأسفل."
        actions={
          editingId ? (
            <button className="btn" type="button" onClick={reset}>
              إلغاء التعديل
            </button>
          ) : null
        }
      >
        <FormGrid cols={3}>
          <label className="field">
            <span>نوع المستند</span>
            <select
              className="input"
              value={entity}
              onChange={(event) => setEntity(event.target.value as ApprovalEntity)}
            >
              {(Object.keys(entityLabels) as ApprovalEntity[]).map((key) => (
                <option key={key} value={key}>
                  {entityLabels[key]}
                </option>
              ))}
            </select>
          </label>
          <label className="field wide">
            <span>اسم المسار</span>
            <input
              className="input"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="مثال: مشتريات أعلى من 5,000"
            />
          </label>
          <label className="check">
            <input type="checkbox" checked={active} onChange={(event) => setActive(event.target.checked)} />
            <span>مسار نشط</span>
          </label>
        </FormGrid>

        <div className="grid gap-3 mt-4">
          {steps.map((step, index) => (
            <div className="rounded-xl border border-line bg-surface-2 p-3 grid gap-3" key={index}>
              <div className="flex items-center justify-between gap-2">
                <strong>الخطوة {index + 1}</strong>
                {steps.length > 1 ? (
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setSteps((current) => current.filter((_, i) => i !== index))}
                  >
                    حذف
                  </button>
                ) : null}
              </div>
              <FormGrid cols={4}>
                <label className="field">
                  <span>دور المراجع</span>
                  <select
                    className="input"
                    value={step.approver_role}
                    onChange={(event) => updateStep(index, { approver_role: event.target.value })}
                  >
                    <option value="">أي دور</option>
                    {step.approver_role &&
                    !(roles.data ?? []).some((role) => role.name === step.approver_role) ? (
                      <option value={step.approver_role}>{step.approver_role}</option>
                    ) : null}
                    {(roles.data ?? []).map((role) => (
                      <option key={role.id} value={role.name}>
                        {role.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>المراجع بعينه (اختياري)</span>
                  <select
                    className="input"
                    value={step.approver_user_id}
                    onChange={(event) => updateStep(index, { approver_user_id: event.target.value })}
                  >
                    <option value="">حسب الدور</option>
                    {step.approver_user_id &&
                    !(members.data ?? []).some((member) => (member.userId ?? member.id) === step.approver_user_id) ? (
                      <option value={step.approver_user_id}>عضو سابق</option>
                    ) : null}
                    {(members.data ?? [])
                      .filter((member) => member.status !== 'suspended')
                      .map((member) => (
                        <option key={member.id} value={member.userId ?? member.id}>
                          {member.displayName}
                        </option>
                      ))}
                  </select>
                </label>
                <label className="field">
                  <span>الحد الأدنى</span>
                  <input
                    className="input"
                    dir="ltr"
                    value={step.min_amount}
                    onChange={(event) => updateStep(index, { min_amount: event.target.value })}
                    placeholder="10000"
                  />
                </label>
                <label className="field">
                  <span>الحد الأعلى</span>
                  <input
                    className="input"
                    dir="ltr"
                    value={step.max_amount}
                    onChange={(event) => updateStep(index, { max_amount: event.target.value })}
                    placeholder="اتركه بلا حد"
                  />
                </label>
                <label className="field">
                  <span>الفرع (اختياري)</span>
                  <select
                    className="input"
                    value={step.branch_id}
                    onChange={(event) => updateStep(index, { branch_id: event.target.value })}
                  >
                    <option value="">كل الفروع</option>
                    {(branches.data ?? []).map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.nameAr ?? branch.name_ar ?? branch.code}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>مركز التكلفة (اختياري)</span>
                  <select
                    className="input"
                    value={step.cost_center_id}
                    onChange={(event) => updateStep(index, { cost_center_id: event.target.value })}
                  >
                    <option value="">كل المراكز</option>
                    {(costCenters.data ?? []).map((center) => (
                      <option key={center.id} value={center.id}>
                        {center.nameAr ?? center.name_ar ?? center.code}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>الإجراء</span>
                  <select
                    className="input"
                    value={step.action}
                    onChange={(event) =>
                      updateStep(index, { action: event.target.value as 'approve' | 'notify' })
                    }
                  >
                    <option value="approve">موافقة مطلوبة</option>
                    <option value="notify">إشعار فقط</option>
                  </select>
                </label>
              </FormGrid>
            </div>
          ))}
        </div>
        <FormActions note={`${steps.length} خطوة`}>
          <button
            className="btn"
            type="button"
            onClick={() => setSteps((current) => [...current, emptyStep()])}
          >
            إضافة خطوة
          </button>
          <button
            className="btn primary"
            type="button"
            disabled={busy || !name.trim()}
            onClick={() => void save()}
          >
            {busy ? 'جارٍ الحفظ…' : 'حفظ المسار'}
          </button>
        </FormActions>
      </Panel>

      <Panel title="المسارات الحالية" hint="كل مسار يُطبَّق على مستنداته هو فقط، وتُقرأ شروطه بالترتيب.">
        {workflows.length === 0 ? (
          <p className="muted m-0">لا توجد مسارات بعد.</p>
        ) : (
          <div className="grid gap-3">
            {workflows.map((workflow) => (
              <article className="rounded-xl border border-line p-4 grid gap-2" key={workflow.id}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <strong>{workflow.name}</strong>
                    <span className="muted"> · {entityLabels[workflow.entity]}</span>
                  </div>
                  <span className={`chip ${workflow.isActive ? 'success' : ''}`}>
                    {workflow.isActive ? 'نشط' : 'متوقف'}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {workflow.steps.map((step) => (
                    <span className="chip" key={step.id}>
                      {step.stepOrder}. {step.approverRole ?? step.approverUserId ?? '—'} ·{' '}
                      {step.action === 'approve' ? 'موافقة' : 'إشعار'}
                    </span>
                  ))}
                </div>
                <div className="toolbar">
                  <button className="btn" type="button" onClick={() => edit(workflow)}>
                    تعديل
                  </button>
                  {workflow.isActive ? (
                    <button className="btn" type="button" onClick={() => void deactivate(workflow)}>
                      إيقاف
                    </button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        )}
      </Panel>
    </Screen>
  );
}
