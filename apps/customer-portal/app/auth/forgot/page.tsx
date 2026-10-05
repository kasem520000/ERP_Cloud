export default function ForgotPage() {
  return (
    <section className="card">
      <h1>نسيت كلمة المرور</h1>
      <p className="muted">
        حسابات بوابة العملاء يصدرها المورد نفسه. لإعادة تعيين كلمة المرور تواصل مع المورد ليصدر لك كلمة مرور مؤقتة جديدة من بطاقة العميل، ثم غيّرها من صفحة تغيير كلمة المرور بعد الدخول.
      </p>
      <div className="toolbar">
        <a className="btn primary" href="/auth/login">
          رجوع لتسجيل الدخول
        </a>
        <a className="btn" href="/portal/profile">
          بيانات التواصل مع المورد
        </a>
      </div>
    </section>
  );
}
