'use client';

import { Panel, Split } from '@erp/ui';
import { useEffect, useState } from 'react';

import { ErrorBox, Forbidden, Loading, Screen } from '../../../components/screen';
import { Input, Select, Textarea } from '../../../components/ui/input';
import {
  createCustomField,
  deleteCustomField,
  listCustomFields,
  type CustomField,
  type CustomFieldEntity,
  type CustomFieldType,
} from '../../../lib/custom-fields';
import { useSession } from '../../../lib/session';

const entities: Array<{ value: CustomFieldEntity; label: string }> = [
  { value: 'party', label: 'العملاء والموردون' },
  { value: 'item', label: 'الأصناف' },
  { value: 'invoice', label: 'الفواتير' },
  { value: 'employee', label: 'الموظفون' },
];

const types: Array<{ value: CustomFieldType; label: string }> = [
  { value: 'text', label: 'نص' },
  { value: 'number', label: 'رقم' },
  { value: 'date', label: 'تاريخ' },
  { value: 'select', label: 'قائمة اختيار' },
  { value: 'boolean', label: 'نعم / لا' },
];

export default function CustomFieldsSettingsPage() {
  const { can } = useSession();
  const [entity, setEntity] = useState<CustomFieldEntity>('item');
  const [fields, setFields] = useState<CustomField[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();
  const [label, setLabel] = useState('');
  const [key, setKey] = useState('');
  const [type, setType] = useState<CustomFieldType>('text');
  const [options, setOptions] = useState('');
  const [required, setRequired] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string>();

  const reload = async (): Promise<void> => {
    setLoading(true);
    try {
      setFields(await listCustomFields(entity));
      setError(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void reload();
  }, [entity]);

  if (!can('custom_fields.view')) {
    return (
      <Screen title="الحقول الإضافية" crumbs={['الإعدادات', 'الحقول الإضافية']}>
        <Forbidden />
      </Screen>
    );
  }

  const reset = (): void => {
    setLabel('');
    setKey('');
    setType('text');
    setOptions('');
    setRequired(false);
  };
  const save = async (): Promise<void> => {
    setBusy(true);
    setNotice(undefined);
    try {
      await createCustomField({
        entity,
        key: key.trim(),
        label: label.trim(),
        type,
        options:
          type === 'select'
            ? options
                .split('\n')
                .map((value) => value.trim())
                .filter(Boolean)
            : undefined,
        required,
      });
      reset();
      await reload();
      setNotice('تم إنشاء الحقل الإضافي.');
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };
  const remove = async (field: CustomField): Promise<void> => {
    if (!window.confirm(`إيقاف الحقل «${field.label}»؟`)) return;
    setBusy(true);
    try {
      await deleteCustomField(field.id);
      await reload();
      setNotice('تم إيقاف الحقل مع إبقاء قيمه التاريخية.');
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen
      title="الحقول الإضافية"
      subtitle="أضف حقولاً typed للعميل أو الصنف أو الفاتورة أو الموظف، وتظهر تلقائياً في البطاقات والتقارير."
      crumbs={['الإعدادات', 'الحقول الإضافية']}
    >
      <Split
        className="is-rail-wide"
        rail={
          can('custom_fields.manage') ? (
            <Panel title="حقل جديد">
              <div className="grid gap-3">
                <Input
                  label="الاسم الظاهر"
                  value={label}
                  onChange={(event) => setLabel(event.target.value)}
                  placeholder="تاريخ الضمان"
                />
                <Input
                  label="المفتاح البرمجي"
                  dir="ltr"
                  className="font-mono"
                  value={key}
                  onChange={(event) => setKey(event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_'))}
                  placeholder="warranty_date"
                />
                <Select
                  label="النوع"
                  value={type}
                  onChange={(event) => setType(event.target.value as CustomFieldType)}
                >
                  {types.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </Select>
                {type === 'select' ? (
                  <Textarea
                    label="الخيارات، كل خيار في سطر"
                    value={options}
                    onChange={(event) => setOptions(event.target.value)}
                  />
                ) : null}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={required}
                    onChange={(event) => setRequired(event.target.checked)}
                  />{' '}
                  <span>حقل مطلوب عند الحفظ</span>
                </label>
                <button
                  className="btn primary justify-self-start"
                  type="button"
                  disabled={busy || !label.trim() || !key.trim()}
                  onClick={() => void save()}
                >
                  حفظ الحقل
                </button>
                {notice ? <p className="m-0 text-sm text-ink-2">{notice}</p> : null}
              </div>
            </Panel>
          ) : null
        }
      >
        <Panel
          flush
          title="الحقول المعرفة"
          actions={
            <label className="flex items-center gap-2 text-[12px] font-bold text-muted">
              الكيان
              <select
                className="input w-44"
                value={entity}
                onChange={(event) => setEntity(event.target.value as CustomFieldEntity)}
              >
                {entities.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          }
        >
          {loading ? (
            <Loading rows={4} />
          ) : error ? (
            <ErrorBox message={error} onRetry={() => void reload()} />
          ) : fields.length === 0 ? (
            <p className="text-sm text-muted p-5 m-0">لا توجد حقول لهذا الكيان بعد.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>الاسم</th>
                    <th>المفتاح</th>
                    <th>النوع</th>
                    <th>مطلوب</th>
                    <th>الحالة</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {fields.map((field) => (
                    <tr key={field.id}>
                      <td className="font-semibold">{field.label}</td>
                      <td className="font-mono text-xs" dir="ltr">
                        {field.key}
                      </td>
                      <td>{types.find((option) => option.value === field.type)?.label ?? field.type}</td>
                      <td>{field.required ? 'نعم' : 'لا'}</td>
                      <td>{field.active ? 'نشط' : 'متوقف'}</td>
                      <td className="text-start">
                        {can('custom_fields.manage') && field.active ? (
                          <button
                            className="text-danger hover:underline"
                            type="button"
                            disabled={busy}
                            onClick={() => void remove(field)}
                          >
                            إيقاف
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
      </Split>
    </Screen>
  );
}
