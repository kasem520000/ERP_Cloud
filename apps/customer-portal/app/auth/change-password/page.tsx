import { ContentPanel, PageFrame, PageHeader } from '@erp/ui/page';

import { ChangePasswordForm } from '../../../components/forms';

export default function ChangePasswordPage() {
  return (
    <PageFrame className="portal-auth">
      <PageHeader
        eyebrow="أمان الحساب"
        title="تغيير كلمة المرور"
        description="كلمة المرور المؤقتة التي زوّدك بها المورد تُستخدم مرة واحدة. اختر كلمة مرور من 12 حرفاً على الأقل."
      />
      <ContentPanel>
        <ChangePasswordForm />
      </ContentPanel>
    </PageFrame>
  );
}
