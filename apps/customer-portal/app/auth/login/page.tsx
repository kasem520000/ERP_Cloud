import { ContentPanel, PageFrame, PageHeader } from '@erp/ui/page';

import { LoginForm } from '../../../components/forms';

/**
 * `?handoff=failed` يعني أنّ رابط الدخول المسلَّم من واجهةٍ أخرى رُفض: رمزٌ منتهٍ أو
 * مُستعملٌ سابقًا. يُقال ذلك صراحةً بدل شاشة دخولٍ صامتة توحي بأنّ الخطأ من المستخدم.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ handoff?: string }> }) {
  const params = await searchParams;
  const handoffFailed = params?.handoff === 'failed';
  return (
    <PageFrame className="portal-auth">
      <PageHeader
        eyebrow="بوابة العملاء"
        title="تسجيل الدخول"
        description="ادخل إلى فواتيرك وكشف حسابك لدى المورد."
      />
      <ContentPanel>
        {handoffFailed ? (
          <p className="alert danger" role="alert">
            رابط الدخول المسلَّم منتهٍ أو مُستعمل سابقاً — سجّل الدخول مباشرةً برمز الشركة والبريد وكلمة
            المرور.
          </p>
        ) : null}
        <p className="muted">أدخل رمز الشركة الذي زوّدك به المورد لتصل إلى مستندات حسابك بأمان.</p>
        <LoginForm />
      </ContentPanel>
    </PageFrame>
  );
}
