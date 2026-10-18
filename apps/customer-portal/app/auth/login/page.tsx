import { LoginForm } from '../../../components/forms';

/**
 * `?handoff=failed` يعني أنّ رابط الدخول المسلَّم من واجهةٍ أخرى رُفض: رمزٌ منتهٍ أو
 * مُستعملٌ سابقًا. يُقال ذلك صراحةً بدل شاشة دخولٍ صامتة توحي بأنّ الخطأ من المستخدم.
 */
export default async function LoginPage({ searchParams }: { searchParams: Promise<{ handoff?: string }> }) {
  const params = await searchParams;
  const handoffFailed = params?.handoff === 'failed';
  return (
    <section className="card ui-auth-card">
      <h1>تسجيل الدخول</h1>
      {handoffFailed ? (
        <p className="alert danger" role="alert">
          رابط الدخول المسلَّم منتهٍ أو مُستعمل سابقاً — سجّل الدخول مباشرةً برمز الشركة والبريد وكلمة المرور.
        </p>
      ) : null}
      <p className="muted">
        رموز الدخول تحفظ في الذاكرة أثناء الجلسة؛ لا يتم تخزينها في localStorage عند نمط cookie.
      </p>
      <LoginForm />
    </section>
  );
}
