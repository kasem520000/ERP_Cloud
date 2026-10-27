'use client';

import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Input,
} from '@erp/ui';
import { apiErrorText, apiPost } from '@erp/web-core/api';
import { useSession } from '@erp/web-core/session';

export default function BakeryChangePasswordPage() {
  const { signOut } = useSession();

  const [current, setCurrent] = useState('');
  const [nextPass, setNextPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'ok' | 'danger'; text: string } | null>(null);

  const checks = useMemo(() => {
    const lenOk = nextPass.length >= 12;
    let classes = 0;
    if (/[a-z]/.test(nextPass)) classes += 1;
    if (/[A-Z]/.test(nextPass)) classes += 1;
    if (/\d/.test(nextPass)) classes += 1;
    if (/[^A-Za-z0-9]/.test(nextPass)) classes += 1;
    const matchOk = Boolean(nextPass) && nextPass === confirmPass;
    return { lenOk, classesOk: classes >= 3, matchOk, allOk: Boolean(current) && lenOk && classes >= 3 && matchOk };
  }, [current, nextPass, confirmPass]);

  const submit = async () => {
    if (!checks.allOk) return;
    setSaving(true);
    setNotice(null);
    try {
      await apiPost('/auth/change-password', {
        current,
        new: nextPass,
      });
      setNotice({
        tone: 'ok',
        text: 'تم تغيير كلمة المرور بنجاح وإبطال الجلسات السابقة — سيعاد توجيهك لتسجيل الدخول.',
      });
      window.setTimeout(() => {
        void signOut();
      }, 1200);
    } catch (caught) {
      setNotice({ tone: 'danger', text: apiErrorText(caught, 'تعذّر تغيير كلمة المرور') });
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="ui-page">
      <header className="ui-page-head">
        <div className="ui-page-head-copy">
          <h1 className="ui-page-title">تغيير كلمة المرور وأمان الحساب</h1>
          <p className="ui-page-sub">
            تحديث كلمة المرور وفق سياسة الأمان المعتمدة (12 محرفاً على الأقل مع 3 فئات متنوعة).
          </p>
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
          <CardHeader
            subtitle="عند نجاح التغيير تُنهى جميع الجلسات المفتوحة لحماية حسابك."
            title="بيانات كلمة المرور الجديدة"
          />
          <CardBody>
            <div className="grid max-w-md gap-3">
              <Input
                label="كلمة المرور الحالية"
                onChange={(e) => setCurrent(e.target.value)}
                type="password"
                value={current}
              />
              <Input
                label="كلمة المرور الجديدة"
                onChange={(e) => setNextPass(e.target.value)}
                type="password"
                value={nextPass}
              />
              <Input
                label="تأكيد كلمة المرور الجديدة"
                onChange={(e) => setConfirmPass(e.target.value)}
                type="password"
                value={confirmPass}
              />

              <div className="grid gap-1 rounded-lg border border-line bg-surface-2 p-2.5 text-[12px]">
                <div className={checks.lenOk ? 'text-ok' : 'text-muted'}>
                  {checks.lenOk ? '✓' : '•'} لا تقل عن 12 محرفاً
                </div>
                <div className={checks.classesOk ? 'text-ok' : 'text-muted'}>
                  {checks.classesOk ? '✓' : '•'} تجمع 3 فئات على الأقل (أحرف صغيرة / كبيرة / أرقام / رموز)
                </div>
                <div className={checks.matchOk ? 'text-ok' : 'text-muted'}>
                  {checks.matchOk ? '✓' : '•'} تطابق كلمة المرور الجديدة مع التأكيد
                </div>
              </div>

              <div>
                <Button disabled={!checks.allOk || saving} onClick={() => void submit()} variant="primary">
                  {saving ? 'جارٍ التحديث…' : 'تحديث كلمة المرور'}
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      </div>
    </section>
  );
}
